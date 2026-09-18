import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.doesNotMatch(serverSource, /resultMaxBytes|成品存储空间已满/, '不能因累计存储额度拒绝无损成片');

process.env.NODE_ENV = 'test';
const source = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#68839b' } })
  .composite([{ input: Buffer.from('<svg width="320" height="240"><rect x="40" y="30" width="100" height="150" fill="#d9a982"/><circle cx="235" cy="110" r="62" fill="#304d38"/></svg>') }])
  .png().toBuffer();
const wrongDetails = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#ffffff' } }).png().toBuffer();
let calls = 0;
let detailCalls = 0;
let styleCalls = 0;
let persistent413 = false;
let style413At = Number.POSITIVE_INFINITY;
let wrongCandidate = false;
const detailUploadSizes = [];

function uploadedPng(input, filename) {
  const header = input.indexOf(Buffer.from(`filename="${filename}"`));
  const start = input.indexOf(Buffer.from('\r\n\r\n'), header) + 4;
  const end = input.indexOf(Buffer.from('\r\n--'), start);
  return input.subarray(start, end);
}

const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    calls += 1;
    const input = Buffer.concat(chunks);
    const body = input.toString('utf8');
    if (body.includes('photo-detail.png')) {
      detailCalls += 1;
      const uploaded = uploadedPng(input, 'photo-detail.png');
      detailUploadSizes.push(uploaded.length);
      if (persistent413 || detailCalls === 1) {
        res.writeHead(413, { 'content-type': 'text/plain' });
        res.end('Payload Too Large');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: (wrongCandidate ? wrongDetails : uploaded).toString('base64') }] }));
      return;
    }
    styleCalls += 1;
    if (styleCalls === style413At) {
      res.writeHead(413, { 'content-type': 'text/plain' });
      res.end('Payload Too Large');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: source.toString('base64') }] }));
  });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));

const port = 39116;
const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openphoto-4k-resilience-'));
const child = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
    OPENPHOTO_ENV_FILE: 'missing-test.env',
    OPENPHOTO_RESULT_DIR: resultDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function makeBody(jobId, imageId) {
  const body = new FormData();
  body.append('jobId', jobId);
  body.append('imageIds', JSON.stringify([imageId]));
  body.append('images', new Blob([source], { type: 'image/png' }), 'source.png');
  body.append('model', 'gpt-image-2.5-sunburst');
  body.append('quality', 'auto');
  body.append('size', 'auto');
  body.append('prompt', '自然调色');
  body.append('upscale4k', 'on');
  return body;
}

async function finish(jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/batch/${jobId}`);
    const { job } = await response.json();
    if (!['queued', 'processing'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('任务等待超时');
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 30000);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', code => reject(new Error(`服务提前退出：${code}`)));
  });

  const retryId = randomUUID();
  const retryResponse = await fetch(`http://127.0.0.1:${port}/api/batch`, {
    method: 'POST', body: makeBody(retryId, randomUUID()),
  });
  assert.equal(retryResponse.status, 202);
  const retried = await finish(retryId);
  assert.equal(retried.status, 'completed', retried.items[0]?.error);
  assert.ok(detailCalls >= 2, '413 后应自动重试细节请求');
  assert.match(retried.items[0].result.image, /\.png$/);
  assert.equal(retried.items[0].result.outputFormat, 'png');
  assert.equal(retried.items[0].result.upscale.aiEnhanced, true);

  persistent413 = true;
  const fallbackId = randomUUID();
  const fallbackResponse = await fetch(`http://127.0.0.1:${port}/api/batch`, {
    method: 'POST', body: makeBody(fallbackId, randomUUID()),
  });
  assert.equal(fallbackResponse.status, 202);
  const fallback = await finish(fallbackId);
  assert.equal(fallback.status, 'completed', fallback.items[0]?.error);
  assert.match(fallback.items[0].result.image, /\.png$/);
  assert.equal(fallback.items[0].result.outputFormat, 'png');
  assert.equal(fallback.items[0].result.upscale.aiEnhanced, false);
  assert.equal(fallback.items[0].result.upscale.fallback, 'local-lossless');
  const lossless = await fetch(`http://127.0.0.1:${port}${fallback.items[0].result.image}`);
  assert.equal(lossless.headers.get('content-type'), 'image/png');
  const metadata = await sharp(Buffer.from(await lossless.arrayBuffer())).metadata();
  assert.equal(metadata.width, 3840);
  assert.equal(metadata.height, 2880);
  assert.ok(detailUploadSizes.every(size => size < source.length * 2), '细节代理图不得无限膨胀');

  persistent413 = false;
  const styleCallsBeforeRetry = styleCalls;
  style413At = styleCallsBeforeRetry + 1;
  const styleRetryId = randomUUID();
  const styleRetryResponse = await fetch(`http://127.0.0.1:${port}/api/batch`, {
    method: 'POST', body: makeBody(styleRetryId, randomUUID()),
  });
  assert.equal(styleRetryResponse.status, 202);
  const styleRetried = await finish(styleRetryId);
  assert.equal(styleRetried.status, 'completed', styleRetried.items[0]?.error);
  assert.ok(styleCalls >= styleCallsBeforeRetry + 2, '第一次调色 413 后应使用代理图重试');
  assert.equal(styleRetried.items[0].result.upscale.aiEnhanced, true);

  style413At = Number.POSITIVE_INFINITY;
  wrongCandidate = true;
  const wrongId = randomUUID();
  const wrongResponse = await fetch(`http://127.0.0.1:${port}/api/batch`, {
    method: 'POST', body: makeBody(wrongId, randomUUID()),
  });
  assert.equal(wrongResponse.status, 202);
  const wrongJob = await finish(wrongId);
  assert.equal(wrongJob.status, 'completed', wrongJob.items[0]?.error);
  assert.equal(wrongJob.items[0].result.upscale.fallback, 'local-lossless');
  console.log(`4K_RESILIENCE retry=true fallback=true lossless=true calls=${calls}`);
} finally {
  child.kill();
  upstream.close();
  fs.rmSync(resultDir, { recursive: true, force: true });
}
