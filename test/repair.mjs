import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';
import { assessRepairCandidate, makeRepairTiles, mergeRepairTiles } from '../local-repair.js';

const clientScript = readFileSync(new URL('../public/repair.js', import.meta.url), 'utf8');
const serverScript = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const uuidHelper = clientScript.match(/function createUuid\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(uuidHelper, '修复页需要 HTTP 可用的 UUID 生成器');
assert.equal((clientScript.match(/crypto\.randomUUID\(\)/g) || []).length, 1);
assert.match(clientScript, /const jobId = createUuid\(\)/);
assert.match(clientScript, /imageId: createUuid\(\)/);
assert.match(clientScript, /上次结果 · 本次处理中/);
assert.match(clientScript, /任务 \$\{jobId\}/);
assert.match(serverScript, /setTimeout\(\(\) => controller\.abort\(\), 300000\)/);
assert.doesNotMatch(serverScript, /115000/);
assert.match(serverScript, /允许严格依据原图中已经存在的轮廓/);
assert.match(serverScript, /不得猜测、补写或生成新的字符/);
assert.match(serverScript, /mapWithConcurrency\(prepared\.tiles, 2/);
assert.match(serverScript, /size: 'auto'/);
assert.match(serverScript, /quality = 'high'/);
assert.match(serverScript, /inputEdges = \[2048, 1536, 1024\]/);
assert.match(serverScript, /readRepairCandidate\(image\)/);
assert.match(serverScript, /qualityUsed/);
assert.doesNotMatch(serverScript, /size: '1024x1024'/);
assert.match(clientScript, /配准未通过，已保留原片/);
assert.match(clientScript, /AI 质量 high→medium/);
const httpUuid = runInNewContext(`${uuidHelper}\ncreateUuid()`, {
  crypto: { getRandomValues(bytes) { bytes.forEach((_, index) => { bytes[index] = index; }); return bytes; } },
});
assert.match(httpUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const width = 96, height = 64;
const source = await sharp({ create: { width, height, channels: 3, background: '#7799aa' } })
  .composite(Array.from({ length: 6 }, (_, index) => ({
    input: Buffer.from(`<svg width="8" height="48"><rect width="8" height="48" fill="${index % 2 ? '#ddeeff' : '#223344'}"/></svg>`),
    left: 8 + index * 13, top: 8,
  }))).png().toBuffer();
const rebuilt = await sharp({ create: { width: 41, height: 23, channels: 3, background: '#556677' } }).png().toBuffer();
const synthetic = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#667788' } })
  .composite(Array.from({ length: 10 }, (_, index) => ({
    input: Buffer.from(`<svg width="5" height="60"><rect width="5" height="60" fill="${index % 2 ? '#aabbcc' : '#334455'}"/></svg>`),
    left: 10 + index * 10, top: 10,
  }))).blur(1.4).png().toBuffer();
const preparedSynthetic = await makeRepairTiles(synthetic);
const syntheticCandidates = await Promise.all(preparedSynthetic.tiles.map(tile => sharp(tile.source)
  .sharpen({ sigma: 1.2, m1: 2, m2: 1 }).png().toBuffer()));
const mergedSynthetic = await mergeRepairTiles(synthetic, preparedSynthetic, syntheticCandidates);
const [syntheticRaw, mergedRaw] = await Promise.all([synthetic, mergedSynthetic.output]
  .map(image => sharp(image).removeAlpha().raw().toBuffer()));
const identityMerge = await mergeRepairTiles(synthetic, preparedSynthetic, preparedSynthetic.tiles.map(tile => tile.source));
assert.deepEqual(await sharp(identityMerge.output).removeAlpha().raw().toBuffer(), syntheticRaw);
let sourceEdges = 0, mergedEdges = 0, maxChromaDrift = 0;
for (let pixel = 1; pixel < 120 * 80; pixel++) {
  const offset = pixel * 3, previous = offset - 3;
  sourceEdges += Math.abs(syntheticRaw[offset] - syntheticRaw[previous]);
  mergedEdges += Math.abs(mergedRaw[offset] - mergedRaw[previous]);
  maxChromaDrift = Math.max(maxChromaDrift,
    Math.abs((syntheticRaw[offset + 1] - syntheticRaw[offset]) - (mergedRaw[offset + 1] - mergedRaw[offset])),
    Math.abs((syntheticRaw[offset + 2] - syntheticRaw[offset]) - (mergedRaw[offset + 2] - mergedRaw[offset])));
}
assert.equal(mergedSynthetic.width, 120);
assert.equal(mergedSynthetic.height, 80);
assert.equal(mergedSynthetic.tileTotal, 6);
assert.ok(mergedEdges > sourceEdges);
assert.ok(maxChromaDrift <= 2);
const mergedPixels = await sharp(mergedSynthetic.output).removeAlpha().raw().toBuffer();
let maxDetailDelta = 0;
for (let pixel = 0; pixel < 120 * 80; pixel++) {
  const offset = pixel * 3;
  maxDetailDelta = Math.max(maxDetailDelta, Math.abs(mergedPixels[offset] - syntheticRaw[offset]),
    Math.abs(mergedPixels[offset + 1] - syntheticRaw[offset + 1]),
    Math.abs(mergedPixels[offset + 2] - syntheticRaw[offset + 2]));
}
assert.ok(maxDetailDelta <= 16, `亮度细节超过限幅：${maxDetailDelta}`);
const [sourceLowFrequency, mergedLowFrequency] = await Promise.all([synthetic, mergedSynthetic.output]
  .map(image => sharp(image).greyscale().blur(12).raw().toBuffer()));
let lowFrequencyMaxDelta = 0;
for (let pixel = 0; pixel < sourceLowFrequency.length; pixel++) {
  lowFrequencyMaxDelta = Math.max(lowFrequencyMaxDelta, Math.abs(sourceLowFrequency[pixel] - mergedLowFrequency[pixel]));
}
assert.ok(lowFrequencyMaxDelta <= 2, `低频亮度漂移超过容差：${lowFrequencyMaxDelta}`);
function boundaryDetailDelta(rawOutput, rawSource) {
  let boundary = 0, other = 0, boundaryCount = 0, otherCount = 0;
  for (let y = 0; y < 80; y++) for (let x = 1; x < 120; x++) {
    const offset = (y * 120 + x) * 3;
    const delta = Math.abs((rawOutput[offset] - rawOutput[offset - 3]) - (rawSource[offset] - rawSource[offset - 3]));
    if (x === 40 || x === 80) { boundary += delta; boundaryCount++; }
    else { other += delta; otherCount++; }
  }
  return { boundary: boundary / boundaryCount, other: other / otherCount };
}
const seamSource = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#667788' } })
  .composite([13, 57, 99].map((left, index) => ({
    input: Buffer.from(`<svg width="4" height="58"><rect width="4" height="58" fill="${index % 2 ? '#ddeeff' : '#223344'}"/></svg>`),
    left, top: 11,
  }))).blur(1.4).png().toBuffer();
const seamPrepared = await makeRepairTiles(seamSource);
const seamCandidates = await Promise.all(seamPrepared.tiles.map(tile => sharp(tile.source)
  .sharpen({ sigma: 1.2, m1: 2, m2: 1 }).png().toBuffer()));
const seamMerged = await mergeRepairTiles(seamSource, seamPrepared, seamCandidates);
const [seamSourceRaw, seamOutputRaw] = await Promise.all([seamSource, seamMerged.output]
  .map(image => sharp(image).removeAlpha().raw().toBuffer()));
const seamDelta = boundaryDetailDelta(seamOutputRaw, seamSourceRaw);
assert.ok(seamDelta.boundary <= seamDelta.other + 3, `重叠边界细节变化过强：${JSON.stringify(seamDelta)}`);
const reversedPrepared = { ...preparedSynthetic, tiles: [...preparedSynthetic.tiles].reverse() };
const reversedMerge = await mergeRepairTiles(synthetic, reversedPrepared, [...syntheticCandidates].reverse());
assert.deepEqual(await sharp(reversedMerge.output).removeAlpha().raw().toBuffer(), mergedPixels);

async function makeFixture(width, height, format) {
  const image = sharp({ create: { width, height, channels: 3, background: '#556677' } });
  return format === 'jpeg' ? image.jpeg().toBuffer() : format === 'webp' ? image.webp().toBuffer() : image.png().toBuffer();
}
for (const { width: fixtureWidth, height: fixtureHeight, columns, rows } of [
  { width: 180, height: 100, columns: 3, rows: 2 },
  { width: 100, height: 180, columns: 2, rows: 3 },
  { width: 600, height: 100, columns: 6, rows: 1 },
  { width: 100, height: 600, columns: 1, rows: 6 },
  { width: 100, height: 100, columns: 3, rows: 2 },
]) {
  for (const format of ['png', 'jpeg', 'webp']) {
    const prepared = await makeRepairTiles(await makeFixture(fixtureWidth, fixtureHeight, format));
    assert.equal(prepared.tiles.length, 6);
    assert.equal(prepared.columns, columns);
    assert.equal(prepared.rows, rows);
    assert.equal(prepared.width, fixtureWidth);
    assert.equal(prepared.height, fixtureHeight);
  }
}
const orientedFixture = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#667788' } })
  .jpeg().withMetadata({ orientation: 6 }).toBuffer();
const orientedPrepared = await makeRepairTiles(orientedFixture);
assert.equal(orientedPrepared.width, 80);
assert.equal(orientedPrepared.height, 120);
assert.equal(orientedPrepared.columns, 2);
assert.equal(orientedPrepared.rows, 3);
assert.equal((await makeRepairTiles(await makeFixture(1, 1, 'png'))).tiles.length, 6);

const badCandidates = [...syntheticCandidates];
badCandidates[1] = await makeFixture(32, 32, 'png');
badCandidates[2] = Buffer.from('not-an-image');
async function shiftCandidate(buffer, shiftX, shiftY) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const shifted = Buffer.alloc(data.length);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const sourceX = Math.max(0, Math.min(info.width - 1, x - shiftX));
    const sourceY = Math.max(0, Math.min(info.height - 1, y - shiftY));
    const from = (sourceY * info.width + sourceX) * info.channels;
    const to = (y * info.width + x) * info.channels;
    data.copy(shifted, to, from, from + info.channels);
  }
  return sharp(shifted, { raw: info }).png().toBuffer();
}
badCandidates[3] = await shiftCandidate(preparedSynthetic.tiles[3].source, 8, 0);
const partialMerge = await mergeRepairTiles(synthetic, preparedSynthetic, badCandidates);
assert.deepEqual(partialMerge.fallbackIndexes, [1, 2, 3]);
assert.equal(partialMerge.fallbackCount, 3);
assert.equal((await assessRepairCandidate(preparedSynthetic.tiles[2], Buffer.from('broken'))).accepted, false);

let upstreamCalls = 0;
let activeUpstream = 0, maxUpstreamConcurrency = 0;
let failureStatuses = [];
let upstreamPrompt = '';
let responseMode = 'base64-wrong';
let rejectHighQuality = false;
let maxAcceptedInputEdge = Infinity;
let candidatePayloads = new Map();
let upstreamBase = '';
const observedQualities = [], observedInputEdges = [];
const preparedHttpSource = await makeRepairTiles(source);
for (const tile of preparedHttpSource.tiles) candidatePayloads.set(tile.index, tile.source);
const upstream = http.createServer((req, res) => {
  if (req.method === 'GET') {
    const candidateIndex = req.url?.match(/^\/candidate-(\d+)\.png$/)?.[1];
    if (candidateIndex !== undefined && candidatePayloads.has(Number(candidateIndex))) {
      const candidatePayload = candidatePayloads.get(Number(candidateIndex));
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': candidatePayload.length });
      res.end(candidatePayload);
    } else if (req.url === '/candidate-large') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 40 * 1024 * 1024 + 1 });
      res.end();
    } else res.writeHead(404).end();
    return;
  }
  if (req.method !== 'POST') { res.writeHead(404).end(); return; }
  upstreamCalls++;
  activeUpstream++;
  maxUpstreamConcurrency = Math.max(maxUpstreamConcurrency, activeUpstream);
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    const requestBody = Buffer.concat(chunks);
    upstreamPrompt = requestBody.toString('utf8');
    const failureStatus = failureStatuses.shift();
    let requestImageMetadata = null, tileIndex = 0;
    tileIndex = Number(requestBody.toString('latin1').match(/filename="repair-tile-(\d+)\.jpg"/)?.[1] || 1) - 1;
    const boundary = req.headers['content-type']?.match(/boundary=([^;]+)/)?.[1];
    const imageHeader = Buffer.from('Content-Type: image/jpeg\r\n\r\n');
    const imageHeaderIndex = requestBody.indexOf(imageHeader);
    if (boundary && imageHeaderIndex >= 0) {
      const imageStart = imageHeaderIndex + imageHeader.length;
      const imageEnd = requestBody.indexOf(Buffer.from(`\r\n--${boundary}`), imageStart);
      if (imageEnd > imageStart) {
        try { requestImageMetadata = await sharp(requestBody.subarray(imageStart, imageEnd)).metadata(); } catch {}
      }
    }
    const quality = requestBody.toString('latin1').match(/name="quality"\r\n\r\n([a-z]+)/)?.[1] || '';
    observedQualities.push(quality);
    if (requestImageMetadata) observedInputEdges.push(Math.max(requestImageMetadata.width, requestImageMetadata.height));
    let status = failureStatus || 200;
    let data;
    if (failureStatus) data = { error: { message: `测试上游故障 ${failureStatus}` } };
    else if (rejectHighQuality && quality === 'high') {
      status = 400;
      data = { error: { message: 'The quality parameter is not supported for this model.' } };
    } else if (Math.max(requestImageMetadata?.width || 0, requestImageMetadata?.height || 0) > maxAcceptedInputEdge) {
      status = 400;
      data = { error: { message: 'Input image dimensions are unsupported.' } };
    } else if (responseMode === 'url-source') data = { data: [{ url: `${upstreamBase}/candidate-${tileIndex}.png` }] };
    else if (responseMode === 'url-invalid') data = { data: [{ url: 'file:///not-an-image.png' }] };
    else if (responseMode === 'url-large') data = { data: [{ url: `${upstreamBase}/candidate-large` }] };
    else data = { data: [{ b64_json: rebuilt.toString('base64') }] };
    setTimeout(() => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      activeUpstream--;
    }, 30);
  });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const port = 39192;
const base = `http://127.0.0.1:${port}`;
upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, OPENPHOTO_ENV_FILE: 'missing-repair-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let errors = '';
child.stderr.on('data', chunk => { errors += chunk; });

async function submit(mode, jobId = randomUUID(), imageId = randomUUID(), sourceBuffer = source) {
  const body = new FormData();
  body.append('source', new Blob([sourceBuffer], { type: 'image/png' }), 'input.png');
  body.append('jobId', jobId);
  body.append('imageId', imageId);
  body.append('mode', mode);
  body.append('denoise', '30');
  body.append('sharpen', '25');
  const response = await fetch(`${base}/api/repair`, { method: 'POST', body });
  return { response, job: (await response.json()).job, jobId, imageId };
}

async function completed(id) {
  for (let count = 0; count < 100; count++) {
    const { job } = await fetch(`${base}/api/batch/${id}`).then(response => response.json());
    if (!['queued', 'processing'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('修复任务超时');
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务启动超时 ${errors}`)), 10000);
    child.stdout.on('data', chunk => { if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => reject(new Error(`服务异常退出 ${code} ${errors}`)));
  });
  const page = await fetch(`${base}/repair.html`).then(response => response.text());
  assert.match(page, /AI 分块清晰重建/);
  assert.match(page, /保真降噪锐化/);

  const local = await submit('local');
  assert.equal(local.response.status, 202);
  const localJob = await completed(local.jobId);
  assert.equal(localJob.items[0].mode, 'local-repair');
  assert.equal(localJob.items[0].result.width, width);
  assert.equal(localJob.items[0].result.height, height);
  const localFile = Buffer.from(await fetch(`${base}/api/repair/${local.jobId}/file?format=png`).then(response => response.arrayBuffer()));
  assert.deepEqual((await sharp(localFile).metadata()).width, width);
  assert.equal(upstreamCalls, 0);

  const ai = await submit('ai');
  assert.equal(ai.response.status, 202);
  const duplicate = await submit('ai', ai.jobId, ai.imageId);
  assert.equal(duplicate.response.status, 202);
  const aiJob = await completed(ai.jobId);
  assert.equal(aiJob.items[0].mode, 'ai-repair');
  assert.equal(aiJob.items[0].result.width, width);
  assert.equal(aiJob.items[0].result.height, height);
  assert.equal(aiJob.items[0].result.colorLocked, true);
  assert.equal(aiJob.items[0].result.tileTotal, 6);
  assert.equal(aiJob.items[0].result.aiQualityUsed, 'high');
  assert.equal(aiJob.items[0].result.aiQualityFallbackCount, 0);
  assert.equal(aiJob.items[0].result.tileFallbackCount, 6);
  assert.deepEqual(aiJob.items[0].result.tileFallbackIndexes, [0, 1, 2, 3, 4, 5]);
  assert.equal(aiJob.items[0].result.colorLockMode, 'source-chroma-ai-luminance-tiles');
  const aiFile = Buffer.from(await fetch(`${base}/api/repair/${ai.jobId}/file?format=png`).then(response => response.arrayBuffer()));
  assert.deepEqual(await sharp(aiFile).removeAlpha().raw().toBuffer(), await sharp(source).removeAlpha().raw().toBuffer());
  assert.equal(upstreamCalls, 6);
  assert.equal(maxUpstreamConcurrency, 2);
  assert.ok(observedQualities.slice(0, 6).every(quality => quality === 'high'));
  assert.match(upstreamPrompt, /AI 高清重建与清晰度修复任务/);
  assert.match(upstreamPrompt, /name="size"[\s\S]*?auto/);
  const jpeg = await fetch(`${base}/api/repair/${ai.jobId}/file?format=jpeg`);
  assert.equal(jpeg.status, 200);
  assert.equal((await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata()).format, 'jpeg');

  responseMode = 'url-source';
  const urlStart = upstreamCalls;
  const urlCandidate = await submit('ai');
  const urlCandidateJob = await completed(urlCandidate.jobId);
  assert.equal(urlCandidateJob.items[0].status, 'completed');
  assert.equal(urlCandidateJob.items[0].result.tileFallbackCount, 0);
  assert.equal(urlCandidateJob.items[0].result.aiQualityUsed, 'high');
  assert.equal(upstreamCalls - urlStart, 6);
  const urlCandidateFile = Buffer.from(await fetch(`${base}/api/repair/${urlCandidate.jobId}/file?format=png`).then(response => response.arrayBuffer()));
  assert.deepEqual(await sharp(urlCandidateFile).removeAlpha().raw().toBuffer(), await sharp(source).removeAlpha().raw().toBuffer());

  responseMode = 'url-invalid';
  const invalidUrlCandidate = await submit('ai');
  const invalidUrlJob = await completed(invalidUrlCandidate.jobId);
  assert.equal(invalidUrlJob.items[0].status, 'completed');
  assert.equal(invalidUrlJob.items[0].result.tileFallbackCount, 6);
  const invalidUrlFile = Buffer.from(await fetch(`${base}/api/repair/${invalidUrlCandidate.jobId}/file?format=png`).then(response => response.arrayBuffer()));
  assert.deepEqual(await sharp(invalidUrlFile).removeAlpha().raw().toBuffer(), await sharp(source).removeAlpha().raw().toBuffer());

  responseMode = 'url-large';
  const oversizedUrlCandidate = await submit('ai');
  const oversizedUrlJob = await completed(oversizedUrlCandidate.jobId);
  assert.equal(oversizedUrlJob.items[0].status, 'completed');
  assert.equal(oversizedUrlJob.items[0].result.tileFallbackCount, 6);

  responseMode = 'url-source';
  rejectHighQuality = true;
  const qualityFallbackStart = upstreamCalls;
  const qualityFallback = await submit('ai');
  const qualityFallbackJob = await completed(qualityFallback.jobId);
  assert.equal(qualityFallbackJob.items[0].status, 'completed');
  assert.equal(qualityFallbackJob.items[0].result.aiQualityUsed, 'medium');
  assert.equal(qualityFallbackJob.items[0].result.aiQualityFallbackCount, 6);
  assert.equal(qualityFallbackJob.items[0].result.tileFallbackCount, 0);
  assert.equal(upstreamCalls - qualityFallbackStart, 12);
  assert.ok(observedQualities.slice(-12).filter(quality => quality === 'high').length === 6);
  assert.ok(observedQualities.slice(-12).filter(quality => quality === 'medium').length === 6);
  rejectHighQuality = false;

  responseMode = 'base64-wrong';
  maxAcceptedInputEdge = 1536;
  const largeSource = await sharp({ create: { width: 6000, height: 2000, channels: 3, background: '#667788' } }).png().toBuffer();
  const dimensionsStart = upstreamCalls;
  const dimensionFallback = await submit('ai', randomUUID(), randomUUID(), largeSource);
  const dimensionFallbackJob = await completed(dimensionFallback.jobId);
  assert.equal(dimensionFallbackJob.items[0].status, 'completed');
  assert.equal(dimensionFallbackJob.items[0].result.width, 6000);
  assert.equal(dimensionFallbackJob.items[0].result.height, 2000);
  assert.equal(upstreamCalls - dimensionsStart, 12);
  assert.ok(observedInputEdges.slice(-12).includes(2048));
  assert.ok(observedInputEdges.slice(-12).includes(1536));
  maxAcceptedInputEdge = Infinity;
  responseMode = 'base64-wrong';

  const retryStart = upstreamCalls;
  failureStatuses = [502];
  const retried = await submit('ai');
  const retriedJob = await completed(retried.jobId);
  assert.equal(retriedJob.items[0].status, 'completed');
  assert.equal(retriedJob.items[0].result.attempt, 2);
  assert.equal(upstreamCalls - retryStart, 7);

  const authStart = upstreamCalls;
  failureStatuses = [401];
  const authFailed = await submit('ai');
  const authJob = await completed(authFailed.jobId);
  assert.equal(authJob.items[0].status, 'failed');
  assert.ok(upstreamCalls - authStart >= 1 && upstreamCalls - authStart <= 2);

  const failedStart = upstreamCalls;
  failureStatuses = [502, 502, 502, 502];
  const failed = await submit('ai');
  const failedJob = await completed(failed.jobId);
  assert.equal(failedJob.items[0].status, 'failed');
  assert.equal(upstreamCalls - failedStart, 4);
  assert.equal((await fetch(`${base}/api/repair/${failed.jobId}/file`)).status, 404);
  assert.equal((await fetch(`${base}/api/repair/${ai.jobId}/file`)).status, 200);
  console.log('REPAIR httpUuid=true prompt=true timeout=300s retry=true authNoRetry=true adaptiveSixGrid=true aspectPreserved=true alignmentFallback=true normalizedFusion=true lumaCap=16 lowFrequencyBlur=12 sourceChroma=true aiLuminanceTiles=6 maxConcurrency=2 qualityHigh=true qualityFallbackMedium=true sizeFallback2048To1536=true base64Candidate=true urlCandidate=true invalidUrlFallback=true oversizedUrlFallback=true localOriginalSize=true aiOriginalSize=true deduplicated=true download=true failedOldResult=true');
} finally {
  child.kill();
  upstream.close();
}
