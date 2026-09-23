import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';

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
const httpUuid = runInNewContext(`${uuidHelper}\ncreateUuid()`, {
  crypto: { getRandomValues(bytes) { bytes.forEach((_, index) => { bytes[index] = index; }); return bytes; } },
});
assert.match(httpUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const width = 96, height = 64;
const source = await sharp({ create: { width, height, channels: 3, background: '#7799aa' } }).png().toBuffer();
const rebuilt = await sharp({ create: { width: 41, height: 23, channels: 3, background: '#556677' } }).png().toBuffer();
let upstreamCalls = 0;
let failureStatuses = [];
let upstreamPrompt = '';
const upstream = http.createServer((req, res) => {
  upstreamCalls++;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    upstreamPrompt = Buffer.concat(chunks).toString('utf8');
    const failureStatus = failureStatuses.shift();
    res.writeHead(failureStatus || 200, { 'Content-Type': 'application/json' });
    res.end(failureStatus ? JSON.stringify({ error: { message: `测试上游故障 ${failureStatus}` } })
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
  assert.equal(aiJob.items[0].result.colorLocked, true);
  const aiFile = Buffer.from(await fetch(`${base}/api/repair/${ai.jobId}/file?format=png`).then(response => response.arrayBuffer()));
  assert.deepEqual([...await sharp(aiFile).removeAlpha().raw().toBuffer().then(data => data.subarray(0, 3))], [119, 153, 170]);
  assert.equal(upstreamCalls, 1);
  assert.match(upstreamPrompt, /AI 高清重建与清晰度修复任务/);
  const jpeg = await fetch(`${base}/api/repair/${ai.jobId}/file?format=jpeg`);
  assert.equal(jpeg.status, 200);
  assert.equal((await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata()).format, 'jpeg');

  const retryStart = upstreamCalls;
  failureStatuses = [502];
  const retried = await submit('ai');
  const retriedJob = await completed(retried.jobId);
  assert.equal(retriedJob.items[0].status, 'completed');
  assert.equal(retriedJob.items[0].result.attempt, 2);
  assert.equal(upstreamCalls - retryStart, 2);

  const authStart = upstreamCalls;
  failureStatuses = [401];
  const authFailed = await submit('ai');
  const authJob = await completed(authFailed.jobId);
  assert.equal(authJob.items[0].status, 'failed');
  assert.equal(upstreamCalls - authStart, 1);

  failureStatuses = [502, 502];
  const failed = await submit('ai');
  const failedJob = await completed(failed.jobId);
  assert.equal(failedJob.items[0].status, 'failed');
  assert.equal((await fetch(`${base}/api/repair/${failed.jobId}/file`)).status, 404);
  assert.equal((await fetch(`${base}/api/repair/${ai.jobId}/file`)).status, 200);
  console.log('REPAIR httpUuid=true prompt=true timeout=300s retry=true authNoRetry=true oldResultLabel=true colorLocked=true localOriginalSize=true aiNativeSize=true deduplicated=true download=true failedOldResult=true');
} finally {
  child.kill();
  upstream.close();
}
