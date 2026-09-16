import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const width = 48;
const height = 32;
const sourcePixels = Buffer.alloc(width * height * 4);
const candidatePixels = Buffer.alloc(width * height * 3);
for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
  const i = y * width + x;
  const level = x < 16 ? 38 : x < 32 ? 125 : 214;
  sourcePixels.set([level, level, level, x < 8 ? 180 : 255], i * 4);
  candidatePixels.set(x < 16 ? [42, 24, 72] : x < 32 ? [145, 111, 94] : [242, 202, 143], i * 3);
}
const source = await sharp(sourcePixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
const candidate = await sharp(candidatePixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
let calls = 0;
let fail = false;
const upstream = http.createServer((req, res) => {
  calls += 1;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    assert.match(body, /image\/png/);
    if (body.includes('SOURCE PHOTO')) assert.match(body, /source-and-reference\.png/);
    if (fail) { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>bad gateway</html>'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: candidate.toString('base64') }] }));
  });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const port = 39107;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, OPENPHOTO_ENV_FILE: 'missing-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function body(jobId, imageId, strength = 70, upscale8k = false) {
  const form = new FormData();
  form.append('jobId', jobId);
  form.append('imageId', imageId);
  form.append('strength', String(strength));
  form.append('source', new Blob([source], { type: 'image/png' }), 'photo.png');
  form.append('reference', new Blob([candidate], { type: 'image/png' }), 'film.png');
  if (upscale8k) form.append('upscale8k', 'on');
  return form;
}

async function finish(jobId) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/batch/${jobId}`);
    const { job } = await response.json();
    if (job.status !== 'queued' && job.status !== 'processing') return job;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('参考任务等待超时');
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 30000);
    child.stdout.on('data', chunk => { if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => reject(new Error(`服务提前退出：${code}`)));
  });
  const jobId = randomUUID();
  const imageId = randomUUID();
  const first = await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(jobId, imageId) });
  assert.equal(first.status, 202);
  const duplicate = await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(jobId, imageId) });
  assert.equal(duplicate.status, 202);
  const job = await finish(jobId);
  assert.equal(job.status, 'completed', job.items[0]?.error);
  assert.equal(job.items[0].imageId, imageId);
  assert.equal(calls, 1);
  const result = Buffer.from(job.items[0].result.image.split(',')[1], 'base64');
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  assert.equal(data[3], 180);
  assert.equal(data[16 * 4 + 3], 255);
  assert.notEqual(data[16 * 4], sourcePixels[16 * 4]);
  assert.ok(data[0] < data[16 * 4] && data[16 * 4] < data[40 * 4]);

  const invalid = await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(randomUUID(), randomUUID(), 101) });
  assert.equal(invalid.status, 400);
  const zeroId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(zeroId, randomUUID(), 0) });
  const zero = await finish(zeroId);
  const zeroPixels = await sharp(Buffer.from(zero.items[0].result.image.split(',')[1], 'base64')).raw().toBuffer();
  assert.deepEqual(zeroPixels, sourcePixels);

  fail = true;
  const failedId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(failedId, randomUUID()) });
  const failed = await finish(failedId);
  assert.equal(failed.status, 'completed_with_errors');
  assert.equal(failed.items[0].error, '上游请求失败：HTTP 502');

  fail = false;
  const upId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(upId, randomUUID(), 70, true) });
  const up = await finish(upId);
  assert.equal(up.status, 'completed', up.items[0]?.error);
  assert.equal(up.items[0].result.upscale.width, 7680);
  assert.equal(up.items[0].result.upscale.aiEnhanced, true);
  console.log('REFERENCE idempotent=true originalGeometry=true alpha=true threeZones=true failure=true ai8k=true');
} finally {
  child.kill();
  upstream.close();
}
