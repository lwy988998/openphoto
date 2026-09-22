import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const width = 96, height = 64;
const source = await sharp({ create: { width, height, channels: 3, background: '#7799aa' } }).png().toBuffer();
const rebuilt = await sharp({ create: { width: 41, height: 23, channels: 3, background: '#556677' } }).png().toBuffer();
let upstreamCalls = 0;
let failUpstream = false;
let upstreamPrompt = '';
const upstream = http.createServer((req, res) => {
  upstreamCalls++;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    upstreamPrompt = Buffer.concat(chunks).toString('utf8');
    res.writeHead(failUpstream ? 502 : 200, { 'Content-Type': 'application/json' });
    res.end(failUpstream ? JSON.stringify({ error: { message: '测试上游故障' } })
      : JSON.stringify({ data: [{ b64_json: rebuilt.toString('base64') }] }));
  });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const port = 39192;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, OPENPHOTO_ENV_FILE: 'missing-repair-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let errors = '';
child.stderr.on('data', chunk => { errors += chunk; });

async function submit(mode, jobId = randomUUID(), imageId = randomUUID()) {
  const body = new FormData();
  body.append('source', new Blob([source], { type: 'image/png' }), 'input.png');
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
  assert.match(page, /AI 清晰重建/);
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
  assert.equal(aiJob.items[0].result.width, 41);
  assert.equal(aiJob.items[0].result.height, 23);
  const aiFile = Buffer.from(await fetch(`${base}/api/repair/${ai.jobId}/file?format=png`).then(response => response.arrayBuffer()));
  assert.deepEqual(aiFile, rebuilt);
  assert.equal(upstreamCalls, 1);
  assert.match(upstreamPrompt, /Conservative photographic deblurring/);
  const jpeg = await fetch(`${base}/api/repair/${ai.jobId}/file?format=jpeg`);
  assert.equal(jpeg.status, 200);
  assert.equal((await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata()).format, 'jpeg');

  failUpstream = true;
  const failed = await submit('ai');
  const failedJob = await completed(failed.jobId);
  assert.equal(failedJob.items[0].status, 'failed');
  assert.equal((await fetch(`${base}/api/repair/${failed.jobId}/file`)).status, 404);
  assert.equal((await fetch(`${base}/api/repair/${ai.jobId}/file`)).status, 200);
  console.log('REPAIR localOriginalSize=true aiNativeSize=true deduplicated=true download=true failedOldResult=true');
} finally {
  child.kill();
  upstream.close();
}
