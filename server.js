import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeAtmosphere, applyAtmosphere, gradeSource, makeMontage, makeStyleChart } from './reference-grade.js';
import { enhanceTo4K } from './four-k.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 39006);
const jobs = new Map();
let upscaleQueue = Promise.resolve();
let fourKQueue = Promise.resolve();
const jobTtlMs = 30 * 60 * 1000;
const resultTtlMs = 24 * 60 * 60 * 1000;
const resultMaxBytes = 8 * 1024 ** 3;
const resultRoot = process.env.OPENPHOTO_RESULT_DIR || (process.platform === 'win32' ? path.join(os.tmpdir(), 'openphoto-results') : '/var/lib/openphoto-ai-color/results');
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
  '请对输入的同一张照片进行一次超高清 4K 摄影细节修复，而不是重新生成、重新调色或重绘画面。',
  '严格锁定主体身份、五官、文字、物体边界、构图、相机角度、原有色彩、光线、影调、胶片颗粒、柔焦与抓拍动感；禁止新增、删除、替换或移动内容。',
  '仅改善原图确实存在的边缘、纹理与压缩损伤，提升局部解析力，呈现自然的 4K HDR 明暗层次与高光细节；不要凭空补造纹理、磨皮、过度锐化、加入光源或改变原有摄影质感。',
  '若清晰度与原片质感或真实性冲突，以原片为准；保留刻意拍摄的柔和朦胧。',
].join('\n');

async function requestEdit(buffer, mime, name, prompt, { apiKey, model, size, quality, outputFormat, fidelity = false }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('image', new Blob([buffer], { type: mime }), name);
  form.append('n', '1');
  form.append('size', size);
  form.append('quality', quality);
  form.append('output_format', outputFormat);
  if (fidelity) form.append('input_fidelity', 'high');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fidelity ? 180000 : 115000);
  const response = await fetch(`${configuredBaseUrl()}/images/edits`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    if (fidelity && response.status === 400 && /input_fidelity|unknown parameter|unsupported parameter/i.test(data?.error?.message || text)) {
      return requestEdit(buffer, mime, name, prompt, { apiKey, model, size, quality, outputFormat });
    }
    if (size !== 'auto' && response.status === 400 && /size|dimension/i.test(data?.error?.message || text)) {
      return requestEdit(buffer, mime, name, prompt, { apiKey, model, size: 'auto', quality, outputFormat, fidelity });
    }
    throw new Error(data?.error?.message || (data?.raw && !data.raw.trimStart().startsWith('<') ? data.raw.slice(0, 300) : '') || `上游请求失败：HTTP ${response.status}`);
  }
  const image = data?.data?.[0];
  if (!image?.b64_json && !image?.url) throw new Error('上游没有返回图片。');
  return { image, usage: data.usage || null };
}

async function cleanResults() {
  await fs.promises.mkdir(resultRoot, { recursive: true, mode: 0o700 });
  let used = 0;
  const now = Date.now();
  for (const entry of await fs.promises.readdir(resultRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !uuidPattern.test(entry.name)) continue;
    const directory = path.join(resultRoot, entry.name);
    for (const filename of await fs.promises.readdir(directory)) {
      const file = path.join(directory, filename);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) continue;
      if (now - stat.mtimeMs >= resultTtlMs) await fs.promises.unlink(file);
      else used += stat.size;
    }
    if (!(await fs.promises.readdir(directory)).length) await fs.promises.rmdir(directory);
  }
  return used;
}

async function saveEnhanced(jobId, imageId, png, metadata, extra = {}, preserveAlpha = false) {
  const jpeg = await sharp(png).flatten({ background: '#fff' }).jpeg({ quality: 98, chromaSubsampling: '4:4:4' }).toBuffer();
  const used = await cleanResults();
  if (used + png.length + jpeg.length > resultMaxBytes) throw new Error('4K 成品存储空间已满，请稍后重试。');
  const directory = path.join(resultRoot, jobId);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [ext, buffer] of [['png', png], ['jpeg', jpeg]]) {
    const target = path.join(directory, `${imageId}.${ext}`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await fs.promises.writeFile(temporary, buffer, { mode: 0o600 }); await fs.promises.rename(temporary, target); }
    finally { await fs.promises.rm(temporary, { force: true }).catch(() => {}); }
  }
  const prefix = `/api/results/${jobId}/${imageId}`;
  const outputFormat = preserveAlpha ? 'png' : 'jpeg';
  return { image: `${prefix}.${outputFormat}`, pngUrl: `${prefix}.png`, outputFormat,
    bytes: outputFormat === 'png' ? png.length : jpeg.length, pngBytes: png.length, upscale: metadata, ...extra };
}

async function enhanceOne(base, { apiKey, model, onStage }) {
  const { width, height } = await sharp(base).metadata();
  const scale = 3840 / Math.max(width, height);
  const targetWidth = Math.max(16, Math.round(width * scale / 16) * 16);
  const targetHeight = Math.max(16, Math.round(height * scale / 16) * 16);
  onStage('details', 0, 1);
  const response = await requestEdit(base, 'image/png', 'photo-detail.png', detailPrompt,
    { apiKey, model, size: `${targetWidth}x${targetHeight}`, quality: 'high', outputFormat: 'png', fidelity: true });
  if (!response.image.b64_json) throw new Error('4K AI 细节增强没有返回图片数据。');
  const candidate = Buffer.from(response.image.b64_json, 'base64');
  const result = await enhanceTo4K(base, candidate);
  const candidateMeta = await sharp(candidate).metadata();
  result.metadata.candidateWidth = candidateMeta.width;
  result.metadata.candidateHeight = candidateMeta.height;
  onStage('details', 1, 1);
  return result;
}

async function editOne(file, options) {
  const { apiKey, model, upscale4k, quality, size, requestOutputFormat, prompt, onStage, jobId, imageId } = options;
  const firstFormat = upscale4k ? 'png' : requestOutputFormat;
  onStage('styling');
  const first = await requestEdit(file.buffer, file.mimetype || 'image/png', file.originalname || 'input.png', prompt,
    { apiKey, model, size, quality, outputFormat: firstFormat });
  if (!upscale4k) {
    return { image: first.image.b64_json ? `data:image/${firstFormat};base64,${first.image.b64_json}` : first.image.url,
      outputFormat: firstFormat, upscale: null, usage: first.usage };
  }
  if (!first.image.b64_json) throw new Error('4K AI 增强需要上游返回图片数据，当前仅返回链接。');
  const candidate = Buffer.from(first.image.b64_json, 'base64');
  const base = await gradeSource(file.buffer, candidate, 100, 'png');
  const result = await enhanceOne(base, { apiKey, model: 'gpt-image-2.5-sunburst', onStage });
  onStage('exporting', 1, 1);
  return saveEnhanced(jobId, imageId, result.output, result.metadata, { usage: first.usage }, (await sharp(file.buffer).metadata()).hasAlpha);
}

async function referenceOne(file, { apiKey, reference, strength, upscale4k, onStage, jobId, imageId }) {
  const sourceMeta = await sharp(file.buffer).metadata();
  const format = sourceMeta.format === 'jpeg' ? 'jpeg' : sourceMeta.format === 'webp' ? 'webp' : 'png';
  if (strength === 0 && !upscale4k) return { image: `data:image/${format};base64,${file.buffer.toString('base64')}`, outputFormat: format, upscale: null, usage: null, styleSignals: ['原图保留'] };
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
  if (!upscale4k) {
    const result = upscaleQueue.then(() => applyAtmosphere(graded, profile, strength, format));
    upscaleQueue = result.then(() => {}, () => {});
    const output = await result;
    return { image: `data:image/${format};base64,${output.toString('base64')}`, outputFormat: format, upscale: null, usage, styleSignals: profile.signals };
  }

  const result = await enhanceOne(graded, { apiKey, model: 'gpt-image-2.5-sunburst', onStage });
  onStage('exporting', 1, 1);
  const output = await applyAtmosphere(result.output, profile, strength, 'png');
  return saveEnhanced(jobId, imageId, output, result.metadata, { usage, styleSignals: profile.signals }, sourceMeta.hasAlpha);
}

function safeJob(job) {
  return { id: job.id, status: job.status, stage: job.stage, total: job.items.length, completed: job.items.filter(x => x.status === 'completed').length, failed: job.items.filter(x => x.status === 'failed').length, items: job.items.map(({ file, ...item }) => item) };
}

async function runJob(job, options) {
  let release;
  if (options.upscale4k) {
    const previous = fourKQueue;
    fourKQueue = new Promise(resolve => { release = resolve; });
    await previous;
  }
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
  } finally {
    release?.();
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
    if (body.upscale8k === 'on' || body.upscale8k === 'true') return res.status(400).json({ error: '8K 已更换为 4K 增强，请刷新页面后重新提交。' });
    const upscale4k = String(body.upscale4k || '') === 'on' || String(body.upscale4k || '') === 'true';
    const quality = String(body.quality || 'auto').trim();
    const size = String(body.size || 'auto').trim();
    const requestOutputFormat = String(body.outputFormat || 'png').trim();
    const userPrompt = String(body.prompt || '').trim();
    if (!allowedModels.has(model) || !allowedQuality.has(quality) || !allowedSizes.has(size) || !allowedOutputFormats.has(requestOutputFormat)) {
      return res.status(400).json({ error: '模型、质量、尺寸或输出格式参数无效。' });
    }
    if (upscale4k && req.files.length > 3) return res.status(400).json({ error: '4K 批次最多处理 3 张照片。' });
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
    runJob(job, { apiKey, model, upscale4k, quality, size, requestOutputFormat, prompt }).catch((err) => {
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
    if (body.upscale8k === 'on' || body.upscale8k === 'true') return res.status(400).json({ error: '8K 已更换为 4K 增强，请刷新页面后重新提交。' });
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
      upscale4k: String(body.upscale4k || '') === 'on' || String(body.upscale4k || '') === 'true' }).catch(err => {
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

app.get('/api/results/:jobId/:imageId.:format', async (req, res) => {
  const { jobId, imageId, format } = req.params;
  if (!uuidPattern.test(jobId) || !uuidPattern.test(imageId) || !['png', 'jpeg'].includes(format)) return res.sendStatus(404);
  const file = path.join(resultRoot, jobId, `${imageId}.${format}`);
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile() || Date.now() - stat.mtimeMs >= resultTtlMs) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(file).pipe(res);
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err?.message || '请求格式错误' });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Openphoto AI Color listening on 0.0.0.0:${port}`);
});
cleanResults().catch(error => console.error('清理 4K 成品失败：', error));
setInterval(() => cleanResults().catch(error => console.error('清理 4K 成品失败：', error)), 60 * 60 * 1000).unref();
server.requestTimeout = 300000;
server.headersTimeout = 310000;
