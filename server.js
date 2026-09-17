import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeAtmosphere, applyAtmosphere, gradeSource, makeMontage, makeStyleChart } from './reference-grade.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 39006);
const jobs = new Map();
let upscaleQueue = Promise.resolve();
const jobTtlMs = 30 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedModels = new Set(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']);
const allowedQuality = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
const allowedSizes = new Set(['auto', '1024x1024', '1024x1536', '1536x1024']);
const allowedOutputFormats = new Set(['png', 'jpeg', 'jpg', 'webp']);
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
  const file = process.env.OPENPHOTO_ENV_FILE || '/etc/openphoto-ai-color/openai.env';
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
    app: 'openphoto-ai-color',
    port,
    hasOpenAIKey: Boolean(configuredKey()),
    baseUrl: configuredBaseUrl(),
    defaultModel: 'gpt-image-2.5-sunburst',
  });
});

function buildPrompt(userPrompt) {
  return [
    '你是一名专业商业摄影后期调色师。这是原图保真后期调色，不是重新生成图片、图像重绘或内容创作。',
    '最高优先级：把输入照片视为内容与构图已经锁定的原始摄影作品。必须保持主体身份、人物五官、脸型、肤色结构、发型、服装、身体比例、姿势、手部、物体数量与轮廓、物体位置、构图、裁切、相机角度、透视、景别、背景结构和画面边界不变。',
    '禁止新增、删除、替换、移动、重绘或重新生成任何人物、物体、文字、标志、背景元素或环境结构；禁止换脸、美颜换脸以及转换为插画、动漫、3D 渲染、AI 艺术图或虚构场景。',
    '只允许调整摄影后期参数：色相、饱和度、曝光、白平衡、色温、色调、曲线、对比度、高光、阴影、局部对比度、动态范围、清晰度、纹理、轻微锐化、轻微胶片颗粒和自然色彩分级。',
    '除非用户明确要求，否则不要添加光源、闪光、光粒子、体积光、雾、火花、反射或光晕。用户明确要求时，也只能依据原图已有的光线和高光区域做自然、低强度的局部增强。',
    '',
    '在以上内容锁定规则下执行以下调色要求：',
    `<调色要求>${userPrompt?.trim() || '自然电影感色彩分级：准确肤色、丰富动态范围、柔和高光与轻微胶片颗粒。'}</调色要求>`,
    '',
    '最终输出必须像同一张真实照片经过专业后期调色后的版本。若风格强度与原图一致性冲突，优先保留原图。',
  ].join('\n');
}

const detailPrompt = [
  '这是对同一张照片的细节修复，不是重新生成或重新调色。',
  '锁定主体身份、五官、文字、物体、轮廓、构图、色彩、光线和背景；禁止新增、删除、替换或移动任何内容。',
  '只修复压缩损伤、轻微噪点和已有纹理的清晰度；未知细节保持原样，不凭空补造纹理。',
  '若细节修复与原图一致性冲突，优先保留原图。',
].join('\n');

async function requestEdit(buffer, mime, name, prompt, { apiKey, model, size, quality, outputFormat }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('image', new Blob([buffer], { type: mime }), name);
  form.append('n', '1');
  form.append('size', size);
  form.append('quality', quality);
  form.append('output_format', outputFormat);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 115000);
  const response = await fetch(`${configuredBaseUrl()}/images/edits`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.error?.message || (data?.raw && !data.raw.trimStart().startsWith('<') ? data.raw.slice(0, 300) : '') || `上游请求失败：HTTP ${response.status}`);
  const image = data?.data?.[0];
  if (!image?.b64_json && !image?.url) throw new Error('上游没有返回图片。');
  return { image, usage: data.usage || null };
}

async function blendAiDetails(base, enhanced) {
  const { width, height } = await sharp(base).metadata();
  if (!width || !height) throw new Error('无法读取调色结果尺寸。');
  const [baseSmall, enhancedSmall] = await Promise.all([base, enhanced].map(buffer =>
    sharp(buffer).resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer()));
  const difference = baseSmall.reduce((sum, value, index) => sum + Math.abs(value - enhancedSmall[index]), 0) / baseSmall.length;
  if (difference > 30) throw new Error('AI 细节增强与原图差异过大，已取消 8K 输出，请保持原图并重试。');

  const [source, sourceBlur, details, detailsBlur] = await Promise.all([
    sharp(base).ensureAlpha().raw().toBuffer(),
    sharp(base).blur(1.4).removeAlpha().raw().toBuffer(),
    sharp(enhanced).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
    sharp(enhanced).resize(width, height, { fit: 'fill' }).blur(1.4).removeAlpha().raw().toBuffer(),
  ]);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const index = pixel * 3 + channel;
      const current = pixel * 4 + channel;
      const delta = (details[index] - detailsBlur[index]) - (source[current] - sourceBlur[index]);
      source[current] = Math.max(0, Math.min(255, Math.round(source[current] + delta * 0.6)));
    }
  }
  return sharp(source, { raw: { width, height, channels: 4 } }).png().toBuffer();
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

async function editOne(file, options) {
  const { apiKey, model, upscale8k, quality, size, requestOutputFormat, prompt } = options;
  const responseOutputFormat = upscale8k ? 'jpeg' : requestOutputFormat;
  const firstFormat = upscale8k ? 'png' : requestOutputFormat;
  const first = await requestEdit(file.buffer, file.mimetype || 'image/png', file.originalname || 'input.png', prompt,
    { apiKey, model, size, quality, outputFormat: firstFormat });
  if (!upscale8k) {
    return { image: first.image.b64_json ? `data:image/${firstFormat};base64,${first.image.b64_json}` : first.image.url,
      outputFormat: firstFormat, upscale: null, usage: first.usage };
  }
  if (!first.image.b64_json) throw new Error('8K AI 增强需要上游返回图片数据，当前仅返回链接。');
  const base = Buffer.from(first.image.b64_json, 'base64');
  const second = await requestEdit(base, 'image/png', 'detail.png', detailPrompt,
    { apiKey, model, size, quality: 'high', outputFormat: 'png' });
  if (!second.image.b64_json) throw new Error('8K AI 细节增强没有返回图片数据。');
  // 串行执行大图合成，避免并发任务同时占满服务器内存。
  const result = upscaleQueue.then(async () => {
    const merged = await blendAiDetails(base, Buffer.from(second.image.b64_json, 'base64'));
    return upscaleTo8K(`data:image/png;base64,${merged.toString('base64')}`, responseOutputFormat);
  });
  upscaleQueue = result.then(() => {}, () => {});
  const upscaled = await result;
  const actualFormat = upscaled.image.match(/^data:image\/([^;]+)/)?.[1] || responseOutputFormat;
  return { image: upscaled.image, outputFormat: actualFormat,
    upscale: { ...upscaled.metadata, aiEnhanced: true }, usage: first.usage };
}

async function referenceOne(file, { apiKey, reference, strength, upscale8k, onStage }) {
  const sourceMeta = await sharp(file.buffer).metadata();
  const format = sourceMeta.format === 'jpeg' ? 'jpeg' : sourceMeta.format === 'webp' ? 'webp' : 'png';
  if (strength === 0 && !upscale8k) return { image: `data:image/${format};base64,${file.buffer.toString('base64')}`, outputFormat: format, upscale: null, usage: null, styleSignals: ['原图保留'] };
  let graded, profile = { softness: 0, grain: 0, glow: 0, motion: 0, signals: ['原图保留'] }, usage = null;
  if (strength > 0) {
    onStage('analyzing');
    const chart = await makeStyleChart();
    const sample = await requestEdit(await makeMontage(chart, reference), 'image/png', 'style-chart-and-reference.png',
      'Left SOURCE PHOTO is a neutral test scene. Right REFERENCE defines the photographic feel. Return only the left scene with right light, softness, grain, glow and motion. Keep its objects.',
      { apiKey, model: 'gpt-image-2.5-sunburst', size: 'auto', quality: 'high', outputFormat: 'png' });
    if (!sample.image.b64_json) throw new Error('参考氛围分析没有返回图片数据。');
    onStage('matching');
    const candidate = await requestEdit(await makeMontage(file.buffer, reference), 'image/png', 'source-and-reference.png',
      'Left SOURCE PHOTO is source. Right REFERENCE is style. Return left photo with reference light, color and texture. Keep contents.',
      { apiKey, model: 'gpt-image-2.5-sunburst', size: 'auto', quality: 'high', outputFormat: 'png' });
    if (!candidate.image.b64_json) throw new Error('参考氛围迁移没有返回图片数据。');
    onStage('finalizing');
    const sampleBytes = Buffer.from(sample.image.b64_json, 'base64');
    const candidateBytes = Buffer.from(candidate.image.b64_json, 'base64');
    profile = await analyzeAtmosphere(reference, sampleBytes, chart);
    usage = candidate.usage;
    // 大图像素处理串行运行，避免并发占满内存。
    const gradeTask = upscaleQueue.then(() => gradeSource(file.buffer, candidateBytes, strength, 'png'));
    upscaleQueue = gradeTask.then(() => {}, () => {});
    graded = await gradeTask;
  } else graded = await sharp(file.buffer).rotate().png().toBuffer();
  if (!upscale8k) {
    const result = upscaleQueue.then(() => applyAtmosphere(graded, profile, strength, format));
    upscaleQueue = result.then(() => {}, () => {});
    const output = await result;
    return { image: `data:image/${format};base64,${output.toString('base64')}`, outputFormat: format, upscale: null, usage, styleSignals: profile.signals };
  }

  onStage('finalizing');
  const detail = await requestEdit(graded, 'image/png', 'graded.png', detailPrompt,
    { apiKey, model: 'gpt-image-2.5-sunburst', size: 'auto', quality: 'high', outputFormat: 'png' });
  if (!detail.image.b64_json) throw new Error('8K AI 细节增强没有返回图片数据。');
  // 与普通 8K 路径共用大图串行队列，避免并发占满内存。
  const result = upscaleQueue.then(async () => {
    const merged = await blendAiDetails(graded, Buffer.from(detail.image.b64_json, 'base64'));
    const upscaled = await upscaleTo8K(`data:image/png;base64,${merged.toString('base64')}`, 'png');
    const outputFormat = sourceMeta.hasAlpha ? 'png' : 'jpeg';
    const output = await applyAtmosphere(Buffer.from(upscaled.image.split(',')[1], 'base64'), profile, strength, outputFormat);
    return { output, outputFormat, metadata: upscaled.metadata };
  });
  upscaleQueue = result.then(() => {}, () => {});
  const { output, outputFormat, metadata } = await result;
  return { image: `data:image/${outputFormat};base64,${output.toString('base64')}`, outputFormat,
    upscale: { ...metadata, aiEnhanced: true }, usage, styleSignals: profile.signals };
}

function safeJob(job) {
  return { id: job.id, status: job.status, stage: job.stage, total: job.items.length, completed: job.items.filter(x => x.status === 'completed').length, failed: job.items.filter(x => x.status === 'failed').length, items: job.items.map(({ file, ...item }) => item) };
}

async function runJob(job, options) {
  job.status = 'processing';
  for (const item of job.items) {
    if (job.status === 'cancelled') break;
    item.status = 'processing';
    try { item.result = await (options.reference ? referenceOne(item.file, { ...options, onStage: stage => { job.stage = stage; } }) : editOne(item.file, options)); item.status = 'completed'; }
    catch (err) { item.status = 'failed'; item.error = err?.name === 'AbortError' ? '上游处理超过 115 秒，请稍后重试。' : (err.message || '处理失败'); }
    item.file = null;
  }
  if (job.status !== 'cancelled') job.status = job.items.some(x => x.status === 'failed') ? 'completed_with_errors' : 'completed';
  setTimeout(() => jobs.delete(job.id), jobTtlMs).unref();
}

app.post('/api/batch', upload.array('images', 10), async (req, res) => {
  try {
    const fallbackKey = configuredKey();
    const body = req.body || {};
    const suppliedJobId = String(body.jobId || '').trim();
    if (suppliedJobId && !uuidPattern.test(suppliedJobId)) return res.status(400).json({ error: 'jobId 必须是有效 UUID。' });
    if (suppliedJobId && jobs.has(suppliedJobId)) return res.status(202).json({ job: safeJob(jobs.get(suppliedJobId)) });
    const temporaryKey = String(body.temporaryApiKey || '').trim();
    const apiKey = fallbackKey || temporaryKey;
    if (!apiKey) {
      return res.status(503).json({
        error: 'OPENAI_API_KEY 未配置。请先在服务器 /etc/openphoto-ai-color/openai.env 配置，或在页面高级选项中临时输入 API Key。',
      });
    }
    if (!req.files?.length) return res.status(400).json({ error: '请至少上传一张图片。' });
    if (jobs.size >= 20) return res.status(429).json({ error: '当前任务较多，请稍后重试。' });

    const model = String(body.model || 'gpt-image-2.5-sunburst').trim();
    const upscale8k = String(body.upscale8k || '') === 'on' || String(body.upscale8k || '') === 'true';
    const quality = String(body.quality || 'auto').trim();
    const size = String(body.size || 'auto').trim();
    const requestOutputFormat = String(body.outputFormat || 'png').trim();
    const userPrompt = String(body.prompt || '').trim();
    if (!allowedModels.has(model) || !allowedQuality.has(quality) || !allowedSizes.has(size) || !allowedOutputFormats.has(requestOutputFormat)) {
      return res.status(400).json({ error: '模型、质量、尺寸或输出格式参数无效。' });
    }
    if (userPrompt.length > 4000) return res.status(400).json({ error: '调色提示词不能超过 4000 个字符。' });
    let imageIds = [];
    try { imageIds = JSON.parse(String(body.imageIds || '[]')); } catch { return res.status(400).json({ error: 'imageIds 必须是 JSON 数组。' }); }
    if (!Array.isArray(imageIds) || imageIds.length !== req.files.length || imageIds.some(id => !uuidPattern.test(String(id))) || new Set(imageIds).size !== imageIds.length) {
      return res.status(400).json({ error: 'imageIds 必须与图片一一对应且均为唯一 UUID。' });
    }
    const prompt = buildPrompt(userPrompt);
    const job = { id: suppliedJobId || randomUUID(), status: 'queued', items: req.files.map((file, index) => ({ index, imageId: imageIds[index], name: file.originalname, status: 'queued', file })) };
    jobs.set(job.id, job);
    runJob(job, { apiKey, model, upscale8k, quality, size, requestOutputFormat, prompt }).catch((err) => {
      job.status = 'completed_with_errors';
      for (const item of job.items) {
        if (item.status === 'queued' || item.status === 'processing') {
          item.status = 'failed';
          item.error = err?.message || '后台任务失败';
          item.file = null;
        }
      }
      setTimeout(() => jobs.delete(job.id), jobTtlMs).unref();
    });
    res.status(202).json({ job: safeJob(job) });
  } catch (err) {
    res.status(500).json({ error: err?.message || '服务器处理失败' });
  }
});

app.post('/api/reference', upload.fields([{ name: 'source', maxCount: 1 }, { name: 'reference', maxCount: 1 }]), async (req, res) => {
  try {
    const body = req.body || {};
    const jobId = String(body.jobId || '').trim();
    const imageId = String(body.imageId || '').trim();
    const strength = Number(body.strength ?? 70);
    if (!uuidPattern.test(jobId) || !uuidPattern.test(imageId)) return res.status(400).json({ error: 'jobId 和 imageId 必须是有效 UUID。' });
    if (jobs.has(jobId)) return res.status(202).json({ job: safeJob(jobs.get(jobId)) });
    const source = req.files?.source?.[0];
    const reference = req.files?.reference?.[0];
    if (!source || !reference) return res.status(400).json({ error: '请分别上传一张原图和参考图。' });
    if (!Number.isInteger(strength) || strength < 0 || strength > 100) return res.status(400).json({ error: '风格强度应为 0 到 100。' });
    if (jobs.size >= 20) return res.status(429).json({ error: '当前任务较多，请稍后重试。' });
    const apiKey = configuredKey() || String(body.temporaryApiKey || '').trim();
    if (!apiKey) return res.status(503).json({ error: 'OPENAI_API_KEY 未配置。' });
    for (const file of [source, reference]) {
      let metadata;
      try { metadata = await sharp(file.buffer).metadata(); } catch { return res.status(400).json({ error: '图片内容损坏或格式无效。' }); }
      if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
        return res.status(400).json({ error: '只支持不超过 4000 万像素的 PNG、JPG、WEBP 图片。' });
      }
    }
    const job = { id: jobId, status: 'queued', items: [{ index: 0, imageId, name: source.originalname, status: 'queued', file: source }] };
    jobs.set(jobId, job);
    runJob(job, { apiKey, reference: reference.buffer, strength,
      upscale8k: String(body.upscale8k || '') === 'on' || String(body.upscale8k || '') === 'true' }).catch(err => {
      job.status = 'completed_with_errors';
      job.items[0].status = 'failed';
      job.items[0].error = err?.message || '后台任务失败';
      job.items[0].file = null;
      setTimeout(() => jobs.delete(job.id), jobTtlMs).unref();
    });
    res.status(202).json({ job: safeJob(job) });
  } catch (err) {
    res.status(500).json({ error: err?.message || '服务器处理失败' });
  }
});

app.get('/api/batch/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在或已过期。' });
  res.json({ job: safeJob(job) });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err?.message || '请求格式错误' });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Openphoto AI Color listening on 0.0.0.0:${port}`);
});
server.requestTimeout = 300000;
server.headersTimeout = 310000;
