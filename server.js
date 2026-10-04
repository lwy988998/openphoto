import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeAtmosphere, applyAtmosphere, gradeSource, makeMontage, makeStyleChart } from './reference-grade.js';
import { makeRepairTiles, mergeRepairTiles, repairPhoto } from './local-repair.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 39006);
const jobs = new Map();
let processingQueue = Promise.resolve();
let aiRepairQueue = Promise.resolve();
const jobTtlMs = 30 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedModels = new Set(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']);
const allowedQuality = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
const allowedSizes = new Set(['auto', '1024x1024', '1024x1536', '1536x1024']);
const allowedOutputFormats = new Set(['png', 'jpeg', 'jpg', 'webp']);
// 该模式生成整张候选画面，不宣称修复出了原片不存在的像素。
const aiRepairPrompt = `这是一次基于原图的 AI 高清重建与清晰度修复任务，不是重新创作或风格转换。

请以用户上传的原图为唯一内容和结构依据，修复因轻微失焦、相机抖动、运动模糊、噪点及压缩造成的清晰度损失。允许严格依据原图中已经存在的轮廓、边缘、明暗关系、材质趋势和上下文，对模糊细节进行自然、合理且克制的重建，以提高主体边缘、建筑结构、衣物、头发、植物及其他可辨认物体的解析力。

严格保持原始构图、裁切比例、相机视角、透视、景深、人物身份、五官比例、表情、姿态、物体数量、物体位置、背景结构、色彩关系、白平衡、曝光、阴影、高光和整体明暗不变。不得新增、删除、移动、替换或重新设计人物和物体，不得美颜、改变肤色、重新布光或进行风格化处理。

只允许根据原图已有视觉证据恢复细节。对于文字、标志、车牌、屏幕内容及其他无法可靠辨认的信息，保持原有形状和模糊程度，不得猜测、补写或生成新的字符。对于证据不足的纹理，使用自然、低强度、与周围一致的细节，不得编造具体结构。

适度降低亮度噪点、彩色噪点和压缩伪影，并恢复自然微对比度。边缘应清晰但不过度锐化，不产生白边、黑边、振铃、摩尔纹、重复纹理、塑料皮肤、蜡像感或明显的 AI 生成痕迹。

最终输出应当仍然是同一张照片，只表现为失焦和抖动得到改善、噪点降低、已有细节更清晰的专业修复版本。若清晰度增强与原图真实性发生冲突，优先保持原图真实性、身份、结构、色彩和明暗。`;
const retryableUpstreamStatuses = new Set([429, 502, 503, 504, 524]);
const maxRepairCandidateBytes = 40 * 1024 * 1024;
const maxRepairCandidatePixels = 40_000_000;
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

async function requestEdit(buffer, mime, name, prompt, { apiKey, model, size, quality, outputFormat, onAttempt = () => {}, logContext = {} }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    onAttempt(attempt, 2);
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('image', new Blob([buffer], { type: mime }), name);
    form.append('n', '1');
    form.append('size', size);
    form.append('quality', quality);
    form.append('output_format', outputFormat);
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), 300000);
    try {
      const response = await fetch(`${configuredBaseUrl()}/images/edits`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!response.ok) {
        if (size !== 'auto' && response.status === 400 && /size|dimension/i.test(data?.error?.message || text)) {
          return requestEdit(buffer, mime, name, prompt, { apiKey, model, size: 'auto', quality, outputFormat, onAttempt, logContext });
        }
        const error = new Error(data?.error?.message || (data?.raw && !data.raw.trimStart().startsWith('<') ? data.raw.slice(0, 300) : '') || `上游请求失败：HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const image = data?.data?.[0];
      if (!image?.b64_json && !image?.url) {
        if (Number.isInteger(logContext.tileIndex)) {
          console.warn(JSON.stringify({ event: 'upstream_empty_tile', ...logContext, attempt }));
          return { image: null, usage: data.usage || null, attempt };
        }
        throw new Error('上游没有返回图片。');
      }
      console.log(JSON.stringify({ event: 'upstream_completed', ...logContext, attempt, elapsedMs: Date.now() - startedAt }));
      return { image, usage: data.usage || null, attempt };
    } catch (error) {
      const retryable = error?.name === 'AbortError' || (!error?.status && error instanceof TypeError)
        || retryableUpstreamStatuses.has(error?.status);
      if (!retryable || attempt === 2) throw error;
      console.warn(JSON.stringify({ event: 'upstream_retry', ...logContext, attempt, status: error?.status || 'network_or_timeout',
        elapsedMs: Date.now() - startedAt }));
      await new Promise(resolve => setTimeout(resolve, 1500));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function editOne(file, options) {
  const { apiKey, model, quality, size, requestOutputFormat, prompt, onStage } = options;
  onStage('styling');
  const first = await requestEdit(file.buffer, file.mimetype || 'image/png', file.originalname || 'input.png', prompt,
    { apiKey, model, size, quality, outputFormat: requestOutputFormat });
  return { image: first.image.b64_json ? `data:image/${requestOutputFormat};base64,${first.image.b64_json}` : first.image.url,
    outputFormat: requestOutputFormat, usage: first.usage };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let next = 0, failure;
  const worker = async () => {
    while (!failure) {
      const index = next++;
      if (index >= values.length) return;
      try { results[index] = await mapper(values[index], index); }
      catch (error) { failure ||= error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  if (failure) throw failure;
  return results;
}

function isUnsupportedQuality(error) {
  return error?.status === 400 && /(?:quality.{0,64}(?:not supported|unsupported|invalid|unknown|unavailable)|(?:not supported|unsupported|invalid|unknown|unavailable|not allowed).{0,64}quality|invalid value.{0,40}(?:high|quality))/i.test(error.message || '');
}

function isUnsupportedImageSize(error) {
  return error?.status === 400 && /(?:image|input|file|request).{0,64}(?:size|dimension|resolution)|(?:size|dimension|resolution).{0,64}(?:image|input|file)/i.test(error.message || '');
}

async function encodeRepairTile(tile, maxEdge) {
  return sharp(tile.source).resize({ width: maxEdge, height: maxEdge, fit: 'inside',
    withoutEnlargement: true, kernel: sharp.kernel.lanczos3 }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function requestRepairTile(tile, prompt, { apiKey, onAttempt, onStage }) {
  const inputEdges = [2048, 1536, 1024];
  let edgeIndex = 0, quality = 'high';
  while (true) {
    const requestInput = await encodeRepairTile(tile, inputEdges[edgeIndex]);
    try {
      const result = await requestEdit(requestInput, 'image/jpeg', `repair-tile-${tile.index + 1}.jpg`, prompt,
        { apiKey, model: 'gpt-image-2.5-flare', size: 'auto', quality, outputFormat: 'png',
          logContext: { tileIndex: tile.index, tileTotal: 6, tileWidth: tile.width, tileHeight: tile.height,
            inputMaxEdge: inputEdges[edgeIndex] }, onAttempt });
      return { ...result, qualityUsed: quality, inputMaxEdge: inputEdges[edgeIndex] };
    } catch (error) {
      if (quality === 'high' && isUnsupportedQuality(error)) {
        quality = 'medium';
        console.warn(JSON.stringify({ event: 'repair_tile_quality_fallback', tileIndex: tile.index, from: 'high', to: 'medium' }));
        onStage('styling', tile.index, 6, 1, 2);
        continue;
      }
      if (edgeIndex < inputEdges.length - 1 && isUnsupportedImageSize(error)) {
        const from = inputEdges[edgeIndex];
        edgeIndex++;
        console.warn(JSON.stringify({ event: 'repair_tile_size_fallback', tileIndex: tile.index,
          fromMaxEdge: from, toMaxEdge: inputEdges[edgeIndex] }));
        continue;
      }
      throw error;
    }
  }
}

function candidateUrlAllowed(candidateUrl, apiBaseUrl) {
  if (candidateUrl.username || candidateUrl.password) return false;
  return candidateUrl.protocol === 'https:'
    || (candidateUrl.protocol === 'http:' && apiBaseUrl.protocol === 'http:' && candidateUrl.origin === apiBaseUrl.origin);
}

async function readCandidateUrl(imageUrl) {
  const apiBaseUrl = new URL(configuredBaseUrl());
  let currentUrl;
  try { currentUrl = new URL(imageUrl); } catch { throw new Error('候选图片 URL 无效。'); }
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    if (!candidateUrlAllowed(currentUrl, apiBaseUrl)) throw new Error('候选图片 URL 协议无效。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === 3) throw new Error('候选图片重定向无效。');
        currentUrl = new URL(location, currentUrl);
        continue;
      }
      if (!response.ok || !response.body) throw new Error(`候选图片下载失败：HTTP ${response.status}`);
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') throw new Error('候选图片内容类型无效。');
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxRepairCandidateBytes) {
        await response.body.cancel().catch(() => {});
        throw new Error('候选图片文件过大。');
      }
      const chunks = [];
      let totalBytes = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxRepairCandidateBytes) {
            await reader.cancel().catch(() => {});
            throw new Error('候选图片文件过大。');
          }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(chunks, totalBytes);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('候选图片重定向过多。');
}

async function readRepairCandidate(image) {
  if (image?.b64_json) {
    if (image.b64_json.length > Math.ceil(maxRepairCandidateBytes / 3) * 4) throw new Error('候选图片文件过大。');
    return Buffer.from(image.b64_json, 'base64');
  }
  if (image?.url) return readCandidateUrl(image.url);
  return null;
}

async function repairOne(file, { mode, denoise, sharpen, apiKey, onStage }) {
  if (mode === 'local') return repairPhoto(file.buffer, { denoise, sharpen, onStage });
  const task = aiRepairQueue.then(async () => {
    const prepared = await makeRepairTiles(file.buffer);
    const candidatePixels = [];
    let maxAttempt = 1, completedTiles = 0, qualityFallbackCount = 0;
    const candidates = await mapWithConcurrency(prepared.tiles, 2, async tile => {
      const prompt = `${aiRepairPrompt}\n\n这是原图第 ${tile.index + 1}/${prepared.tiles.length} 个带重叠边界的局部区域。必须完整保留当前裁切边界、物体位置和透视，只修复失焦、抖动、噪点与已有纹理；不要裁切、扩图或改变画面内容。`;
      const { image, attempt, qualityUsed } = await requestRepairTile(tile, prompt, { apiKey,
        onAttempt: (attempt, total) => onStage('styling', completedTiles, prepared.tiles.length, attempt, total), onStage });
      maxAttempt = Math.max(maxAttempt, attempt);
      if (qualityUsed === 'medium') qualityFallbackCount++;
      let candidate = null, metadata = null, rejection = 'candidate-missing';
      try {
        candidate = await readRepairCandidate(image);
        if (candidate) rejection = '';
      } catch (error) {
        rejection = 'candidate-download-failed';
        console.warn(JSON.stringify({ event: 'repair_tile_candidate_rejected', tileIndex: tile.index,
          tileWidth: tile.width, tileHeight: tile.height, reason: rejection }));
      }
      if (candidate && candidate.length <= 40 * 1024 * 1024) {
        try { metadata = await sharp(candidate).metadata(); } catch { rejection = 'candidate-decode-failed'; }
      } else if (candidate) rejection = 'candidate-too-large';
      if (metadata && (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height
        || metadata.width * metadata.height > maxRepairCandidatePixels)) {
        metadata = null; rejection = 'candidate-dimensions-invalid';
      }
      if (!metadata) candidate = null;
      else candidatePixels.push(metadata.width * metadata.height);
      completedTiles++;
      onStage('styling', completedTiles, prepared.tiles.length, attempt, 2);
      if (candidate === null) console.warn(JSON.stringify({ event: 'repair_tile_candidate_rejected', tileIndex: tile.index,
        tileWidth: tile.width, tileHeight: tile.height, reason: rejection }));
      return candidate;
    });
    onStage('finalizing', prepared.tiles.length, prepared.tiles.length, maxAttempt, 2);
    const result = await mergeRepairTiles(file.buffer, prepared, candidates);
    for (const tile of result.tileDiagnostics) console.log(JSON.stringify({ event: 'repair_tile_checked', ...tile }));
    return { ...result, attempt: maxAttempt, colorLocked: true,
      aiQualityUsed: qualityFallbackCount ? 'medium' : 'high', aiQualityFallbackCount: qualityFallbackCount,
      candidateMegapixels: Number((candidatePixels.reduce((sum, value) => sum + value, 0) / 1_000_000).toFixed(2)) };
  });
  aiRepairQueue = task.then(() => {}, () => {});
  return task;
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
      const onStage = (stage, detailCompleted = 0, detailTotal = 0, attemptCompleted = 0, attemptTotal = 0) => {
        item.stage = stage; item.detailCompleted = detailCompleted; item.detailTotal = detailTotal;
        item.attemptCompleted = attemptCompleted; item.attemptTotal = attemptTotal;
        job.stage = stage;
      };
      try {
        if (options.repair) {
          const result = await repairOne(item.file, { ...options.repair, onStage });
          job.repairOutput = result.output;
          item.result = { width: result.width, height: result.height, mode: item.mode, attempt: result.attempt || 1,
            colorLocked: Boolean(result.colorLocked), tileTotal: result.tileTotal,
            tileFallbackCount: result.fallbackCount || 0, tileFallbackIndexes: result.fallbackIndexes || [],
            candidateMegapixels: result.candidateMegapixels, colorLockMode: result.colorLockMode,
            aiQualityUsed: result.aiQualityUsed, aiQualityFallbackCount: result.aiQualityFallbackCount || 0 };
        } else {
          item.result = await (options.reference
            ? referenceOne(item.file, { ...options, jobId: job.id, imageId: item.imageId, onStage })
            : editOne(item.file, { ...options, jobId: job.id, imageId: item.imageId, onStage }));
        }
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

app.post('/api/repair', upload.single('source'), async (req, res) => {
  try {
    const { jobId, imageId } = req.body || {};
    const mode = String(req.body?.mode || 'local');
    if (!uuidPattern.test(String(jobId)) || !uuidPattern.test(String(imageId))) return res.status(400).json({ error: '任务编号无效。' });
    if (jobs.has(jobId)) return res.status(202).json({ job: safeJob(jobs.get(jobId)) });
    if (!['local', 'ai'].includes(mode)) return res.status(400).json({ error: '修复模式无效。' });
    const denoise = Number(req.body?.denoise);
    const sharpen = Number(req.body?.sharpen);
    if (mode === 'local' && (![denoise, sharpen].every(value => Number.isInteger(value) && value >= 0 && value <= 100))) {
      return res.status(400).json({ error: '降噪和锐化强度须为 0 到 100。' });
    }
    const source = req.file;
    if (!source) return res.status(400).json({ error: '请上传一张照片。' });
    let metadata;
    try { metadata = await sharp(source.buffer).metadata(); } catch { return res.status(400).json({ error: '图片无法解码。' }); }
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
      return res.status(400).json({ error: '只支持不超过 4000 万像素的 PNG、JPG、WEBP 图片。' });
    }
    if (jobs.size >= 20) return res.status(429).json({ error: '当前任务较多，请稍后重试。' });
    const apiKey = mode === 'ai' ? configuredKey() : '';
    if (mode === 'ai' && !apiKey) return res.status(503).json({ error: '服务器没有配置图像 API Key。' });
    const job = { id: jobId, status: 'queued', items: [{ index: 0, imageId, name: source.originalname, mode: mode === 'ai' ? 'ai-repair' : 'local-repair', status: 'queued', stage: 'queued', file: source }] };
    jobs.set(jobId, job);
    runJob(job, { repair: { mode, denoise, sharpen, apiKey } }).catch(error => {
      job.status = 'completed_with_errors';
      job.items[0].status = 'failed'; job.items[0].error = error?.message || '修复失败'; job.items[0].file = null;
      setTimeout(() => jobs.delete(job.id), jobTtlMs).unref();
    });
    res.status(202).json({ job: safeJob(job) });
  } catch (error) { res.status(500).json({ error: error?.message || '修复失败' }); }
});

app.get('/api/repair/:id/file', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.repairOutput) return res.status(404).json({ error: '结果尚未完成或已过期。' });
  const format = String(req.query.format || 'png');
  if (!['png', 'jpeg'].includes(format)) return res.status(400).json({ error: '只支持 PNG 或 JPG 下载。' });
  try {
    const output = format === 'png' ? job.repairOutput
      : await sharp(job.repairOutput).flatten({ background: '#ffffff' }).jpeg({ quality: 98, chromaSubsampling: '4:4:4' }).toBuffer();
    res.type(format === 'png' ? 'png' : 'jpeg').send(output);
  } catch { res.status(500).json({ error: '导出失败，请重试。' }); }
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
