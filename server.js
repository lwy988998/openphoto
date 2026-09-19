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
let processingQueue = Promise.resolve();
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
    '以用户上传的原图为唯一内容依据。保持主体身份、五官、姿态、物体、文字、构图和画面边界；禁止新增、删除、替换、移动、重绘或重新生成任何人物、物体、文字、标志、背景元素或环境结构。',
    '根据用户选择的预设执行本次任务：调色预设可以调整色彩与影调；修复预设只改善原图已有的图像质量，除明确要求外不改变色彩与摄影质感；动感氛围预设可在原有光线与景深关系上克制地调整背景虚化、柔光或动感，不得改变主体结构或凭空制造光源与场景。',
    '所有调整以原图可辨认的信息为依据；无法可靠恢复的细节保持自然，不编造。具体任务要求与通用风格描述冲突时，以具体任务和原图真实性为准。',
    '',
    '在以上内容锁定规则下执行以下处理要求：',
    `<处理要求>${userPrompt?.trim() || '自然后期：准确肤色、柔和高光和有层次的明暗，不改变照片内容。'}</处理要求>`,
    '',
    '最终输出必须像同一张真实照片经过专业后期后的版本；若效果与原图一致性冲突，优先保留原图。',
  ].join('\n');
}

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
  if (!response.ok) {
    if (size !== 'auto' && response.status === 400 && /size|dimension/i.test(data?.error?.message || text)) {
      return requestEdit(buffer, mime, name, prompt, { apiKey, model, size: 'auto', quality, outputFormat });
    }
    const error = new Error(data?.error?.message || (data?.raw && !data.raw.trimStart().startsWith('<') ? data.raw.slice(0, 300) : '') || `上游请求失败：HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const image = data?.data?.[0];
  if (!image?.b64_json && !image?.url) throw new Error('上游没有返回图片。');
  return { image, usage: data.usage || null };
}

async function editOne(file, options) {
  const { apiKey, model, quality, size, requestOutputFormat, prompt, onStage } = options;
  onStage('styling');
  const first = await requestEdit(file.buffer, file.mimetype || 'image/png', file.originalname || 'input.png', prompt,
    { apiKey, model, size, quality, outputFormat: requestOutputFormat });
  return { image: first.image.b64_json ? `data:image/${requestOutputFormat};base64,${first.image.b64_json}` : first.image.url,
    outputFormat: requestOutputFormat, usage: first.usage };
}

async function referenceOne(file, { apiKey, reference, strength, onStage }) {
  const sourceMeta = await sharp(file.buffer).metadata();
  const format = sourceMeta.format === 'jpeg' ? 'jpeg' : sourceMeta.format === 'webp' ? 'webp' : 'png';
  if (strength === 0) return { image: `data:image/${format};base64,${file.buffer.toString('base64')}`, outputFormat: format, usage: null, styleSignals: ['原图保留'] };
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
    const gradeTask = processingQueue.then(() => gradeSource(file.buffer, candidateBytes, strength, 'png'));
    processingQueue = gradeTask.then(() => {}, () => {});
    graded = await gradeTask;
  } else graded = await sharp(file.buffer).rotate().png().toBuffer();
  const result = processingQueue.then(() => applyAtmosphere(graded, profile, strength, format));
  processingQueue = result.then(() => {}, () => {});
  const output = await result;
  return { image: `data:image/${format};base64,${output.toString('base64')}`, outputFormat: format, usage, styleSignals: profile.signals };
}

function safeJob(job) {
  return { id: job.id, status: job.status, stage: job.stage, total: job.items.length, completed: job.items.filter(x => x.status === 'completed').length, failed: job.items.filter(x => x.status === 'failed').length, items: job.items.map(({ file, ...item }) => item) };
}

async function runJob(job, options) {
  job.status = 'processing';
  try {
    for (const item of job.items) {
      if (job.status === 'cancelled') break;
      item.status = 'processing';
      const onStage = (stage, detailCompleted = 0, detailTotal = 0) => {
        item.stage = stage; item.detailCompleted = detailCompleted; item.detailTotal = detailTotal;
        job.stage = stage;
      };
      try {
        item.result = await (options.reference
          ? referenceOne(item.file, { ...options, jobId: job.id, imageId: item.imageId, onStage })
          : editOne(item.file, { ...options, jobId: job.id, imageId: item.imageId, onStage }));
        item.status = 'completed'; item.stage = 'completed';
      } catch (err) {
        const failedStage = item.stage;
        item.status = 'failed'; item.stage = 'failed';
        item.error = err?.name === 'AbortError' ? '上游处理超时，请稍后重试。' : (err.message || '处理失败');
        console.error(JSON.stringify({ event: 'job_item_failed', jobId: job.id, imageId: item.imageId,
          stage: failedStage, error: String(item.error).replace(/sk-[\w-]+|Bearer\s+[^\s]+/gi, '[已隐藏]').slice(0, 300) }));
      }
      item.file = null;
    }
    if (job.status !== 'cancelled') job.status = job.items.some(x => x.status === 'failed') ? 'completed_with_errors' : 'completed';
    setTimeout(() => jobs.delete(job.id), jobTtlMs).unref();
  } catch (error) {
    job.status = 'completed_with_errors';
    for (const item of job.items) {
      if (item.status === 'queued' || item.status === 'processing') {
        item.status = 'failed';
        item.error = error?.message || '后台任务失败';
        item.file = null;
      }
    }
  }
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

    const quality = String(body.quality || 'auto').trim();
    const size = String(body.size || 'auto').trim();
    const requestOutputFormat = String(body.outputFormat || 'png').trim();
    const userPrompt = String(body.prompt || '').trim();
    if (!allowedModels.has(model) || !allowedQuality.has(quality) || !allowedSizes.has(size) || !allowedOutputFormats.has(requestOutputFormat)) {
      return res.status(400).json({ error: '模型、质量、尺寸或输出格式参数无效。' });
    }

    for (const file of req.files) {
      let metadata;
      try { metadata = await sharp(file.buffer).metadata(); } catch { return res.status(400).json({ error: '图片内容损坏或格式无效。' }); }
      if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
        return res.status(400).json({ error: '只支持不超过 4000 万像素的 PNG、JPG、WEBP 图片。' });
      }
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
    runJob(job, { apiKey, model, quality, size, requestOutputFormat, prompt }).catch((err) => {
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
    runJob(job, { apiKey, reference: reference.buffer, strength }).catch(err => {
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
