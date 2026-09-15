import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
let upstreamCalls = 0;
let upstreamBody = '';
const upstream = http.createServer((req, res) => {
  upstreamCalls += 1;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => setTimeout(() => {
    upstreamBody = Buffer.concat(chunks).toString('utf8');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: tinyPng }] }));
  }, 120));
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;
const port = 39106;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}`, OPENPHOTO_ENV_FILE: 'missing-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function makeBody(jobId, imageId) {
  const body = new FormData();
  body.append('jobId', jobId);
  body.append('imageIds', JSON.stringify([imageId]));
  body.append('images', new Blob([Buffer.from(tinyPng, 'base64')], { type: 'image/png' }), 'one.png');
  body.append('model', 'gpt-image-2.5-sunburst');
  body.append('quality', 'auto');
  body.append('size', 'auto');
  body.append('prompt', '自然调色');
  return body;
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 30000);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', code => reject(new Error(`服务提前退出：${code}`)));
  });

  const root = await fetch(`http://127.0.0.1:${port}/`).then(response => response.text());
  const studio = await fetch(`http://127.0.0.1:${port}/studio.html`).then(response => response.text());
  assert.match(root, /class="landingWordmark">Openphoto/);
  assert.match(root, /href="\/studio\.html">开始/);
  assert.match(root, /class="landingPage prismPage"/);
  assert.doesNotMatch(root, /accessPassword/);
  assert.match(studio, /id="photoGrid"/);
  assert.match(studio, /class="studioLayout"/);
  assert.match(studio, /id="resetDialog"/);
  assert.match(studio, /20260915-upload/);
  assert.match(studio, /20260915-uuid/);
  assert.doesNotMatch(studio, /accessPassword/);

  const access = await fetch(`http://127.0.0.1:${port}/api/access`);
  assert.equal(access.status, 404);
  const invalid = await fetch(`http://127.0.0.1:${port}/api/batch`, { method: 'POST', body: makeBody('bad-id', randomUUID()) });
  assert.equal(invalid.status, 400);

  const jobId = randomUUID();
  const imageId = randomUUID();
  const first = await fetch(`http://127.0.0.1:${port}/api/batch`, { method: 'POST', body: makeBody(jobId, imageId) });
  assert.equal(first.status, 202);
  const duplicate = await fetch(`http://127.0.0.1:${port}/api/batch`, { method: 'POST', body: makeBody(jobId, imageId) });
  assert.equal(duplicate.status, 202);

  let job;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    job = await fetch(`http://127.0.0.1:${port}/api/batch/${jobId}`).then(response => response.json()).then(data => data.job);
    if (job.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.items[0].imageId, imageId);
  assert.ok(job.items[0].result.image.startsWith('data:image/png;base64,'));
  assert.equal(upstreamCalls, 1);
  assert.match(upstreamBody, /原图保真后期调色/);
  assert.match(upstreamBody, /禁止新增、删除、替换、移动、重绘或重新生成/);
  assert.match(upstreamBody, /<调色要求>自然调色<\/调色要求>/);
  console.log('SMOKE public=true idempotent=true mapped=true promptLocked=true upstreamCalls=1');
} finally {
  child.kill();
  upstream.close();
}
