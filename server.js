import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 39006);
sharp.cache(false);
sharp.concurrency(1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('只支持 PNG / JPG / WEBP 图片'));
  },
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));

function readEnvFile() {
  const file = process.env.OPENPHOTO_ENV_FILE || '/etc/openphtot-ai-color/openai.env';
  try {
    const text = fs.readFileSync(file, 'utf8');
    return Object.fromEntries(
      text.split(/\r?\n/)
        .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*['\"]?([^'\"\n\r#]+)['\"]?/))
        .filter(Boolean)
        .map(match => [match[1], match[2].trim()])
    );
  } catch {
    return {};
  }
}

function configuredKey() {
  const envFile = readEnvFile();
  return (process.env.OPENAI_API_KEY || envFile.OPENAI_API_KEY || '').trim();
}

function configuredBaseUrl() {
  const envFile = readEnvFile();
  return (process.env.OPENAI_BASE_URL || envFile.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    app: 'openphtot-ai-color',
    port,
    hasOpenAIKey: Boolean(configuredKey()),
    baseUrl: configuredBaseUrl(),
    defaultModel: 'gpt-image-2.5-sunburst',
  });
});

function buildPrompt(userPrompt) {
  return [
    '你是一名专业商业摄影后期调色师。任务是对用户上传的原始照片做图像编辑/调色。',
    '最高优先级：尽量完整保留原始照片的主体、脸部、五官、发型、服装、身体比例、姿势、构图、相机角度、透视、背景物体和真实摄影质感。',
    '只做提示词要求的色彩、光线、动态范围、局部对比度、颗粒、轻微闪光/光晕等后期效果。避免把照片重绘成插画、AI 艺术图或改变身份特征。',
    '如果提示词要求“电影感/胶片/卡片机/iPhone Smart HDR/ARRI/Kodak”等风格，请把它理解为自然调色参考，而不是改变照片内容。',
    '',
    userPrompt?.trim() || '保持原图内容不变，做自然电影感调色，准确肤色、丰富动态范围、轻微胶片颗粒。',
  ].join('\n');
}

async function upscaleTo8K(dataUrl, outputFormat) {
  const match = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) return { image: dataUrl, metadata: null };

  const input = Buffer.from(match[1], 'base64');
  const meta = await sharp(input).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return { image: dataUrl, metadata: null };

  const targetLongEdge = 7680;
  const scale = targetLongEdge / Math.max(width, height);
  if (scale <= 1) {
    return { image: dataUrl, metadata: { originalWidth: width, originalHeight: height, width, height, upscaled: false } };
  }

  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  let pipeline = sharp(input)
    .resize(targetWidth, targetHeight, {
      kernel: sharp.kernel.lanczos3,
      fit: 'fill',
      withoutEnlargement: false,
    })
    .sharpen({ sigma: 0.8, m1: 0.6, m2: 1.2, x1: 2, y2: 10, y3: 20 });

  if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
    pipeline = pipeline.jpeg({ quality: 94, mozjpeg: true });
  } else if (outputFormat === 'webp') {
    pipeline = pipeline.webp({ quality: 94 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 7 });
  }

  const output = await pipeline.toBuffer();
  const mime = outputFormat === 'jpg' ? 'jpeg' : outputFormat;
  return {
    image: `data:image/${mime};base64,${output.toString('base64')}`,
    metadata: { originalWidth: width, originalHeight: height, width: targetWidth, height: targetHeight, upscaled: true },
  };
}

app.post('/api/edit', upload.single('image'), async (req, res) => {
  try {
    const fallbackKey = configuredKey();
    const temporaryKey = String(req.body.temporaryApiKey || '').trim();
    const apiKey = fallbackKey || temporaryKey;
    if (!apiKey) {
      return res.status(503).json({
        error: 'OPENAI_API_KEY 未配置。请先在服务器 /etc/openphtot-ai-color/openai.env 配置，或在页面高级选项中临时输入 API Key。',
      });
    }
    if (!req.file) return res.status(400).json({ error: '请上传一张图片。' });

    const model = String(req.body.model || 'gpt-image-2.5-sunburst').trim();
    const upscale8k = String(req.body.upscale8k || '') === 'on' || String(req.body.upscale8k || '') === 'true';
    const quality = String(req.body.quality || 'auto').trim();
    const size = String(req.body.size || 'auto').trim();
    const requestOutputFormat = String(req.body.outputFormat || 'png').trim();
    const responseOutputFormat = upscale8k ? 'jpeg' : requestOutputFormat;
    const prompt = buildPrompt(String(req.body.prompt || ''));

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('image', new Blob([req.file.buffer], { type: req.file.mimetype || 'image/png' }), req.file.originalname || 'input.png');
    form.append('n', '1');
    form.append('size', size);
    form.append('quality', quality);
    form.append('output_format', requestOutputFormat);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    const response = await fetch(`${configuredBaseUrl()}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok) {
      const message = data?.error?.message || data?.raw || `OpenAI 请求失败：HTTP ${response.status}`;
      return res.status(response.status).json({ error: message, status: response.status });
    }

    const image = data?.data?.[0];
    if (!image?.b64_json && !image?.url) {
      return res.status(502).json({ error: 'OpenAI 返回中没有图片数据。', raw: data });
    }

    const editedImage = image.b64_json ? `data:image/${requestOutputFormat};base64,${image.b64_json}` : image.url;
    const upscaled = upscale8k && editedImage.startsWith('data:image/')
      ? await upscaleTo8K(editedImage, responseOutputFormat)
      : { image: editedImage, metadata: null };

    res.json({
      image: upscaled.image,
      outputFormat: responseOutputFormat,
      sourceOutputFormat: requestOutputFormat,
      model,
      upscale8k,
      upscale: upscaled.metadata,
      usage: data.usage || null,
      revisedPrompt: image.revised_prompt || null,
    });
  } catch (err) {
    const message = err?.name === 'AbortError' ? '请求超时：图像编辑可能超过 240 秒。请降低质量或图片尺寸后重试。' : (err?.message || '服务器处理失败');
    res.status(500).json({ error: message });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err?.message || '请求格式错误' });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Openphtot AI Color listening on 0.0.0.0:${port}`);
});
server.requestTimeout = 300000;
server.headersTimeout = 310000;
