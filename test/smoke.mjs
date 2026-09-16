import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const testPng = (await sharp({ create: { width: 16, height: 16, channels: 3, background: '#778899' } }).png().toBuffer()).toString('base64');
const changedPng = (await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64');
let upstreamCalls = 0;
const upstreamBodies = [];
let changeDetails = false;
const upstream = http.createServer((req, res) => {
  upstreamCalls += 1;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => setTimeout(() => {
    const body = Buffer.concat(chunks).toString('utf8');
    upstreamBodies.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: changeDetails && body.includes('细节修复') ? changedPng : testPng }] }));
  }, 120));
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;
const port = 39106;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}`, OPENPHOTO_ENV_FILE: 'missing-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function makeBody(jobId, imageId, upscale8k = false) {
  const body = new FormData();
  body.append('jobId', jobId);
  body.append('imageIds', JSON.stringify([imageId]));
  body.append('images', new Blob([Buffer.from(tinyPng, 'base64')], { type: 'image/png' }), 'one.png');
  body.append('model', 'gpt-image-2.5-sunburst');
  body.append('quality', 'auto');
  body.append('size', 'auto');
  body.append('prompt', '自然调色');
  if (upscale8k) body.append('upscale8k', 'on');
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
  const appScript = await fetch(`http://127.0.0.1:${port}/app.js`).then(response => response.text());
  assert.match(root, /class="landingWordmark">Openphoto/);
  assert.match(root, /href="\/studio\.html">开始/);
  assert.match(root, /class="landingPage prismPage"/);
  assert.doesNotMatch(root, /accessPassword/);
  assert.match(studio, /id="photoGrid"/);
  assert.match(studio, /class="studioLayout"/);
  assert.match(studio, /id="resetDialog"/);
  assert.match(studio, /20260915-presets/);
  assert.equal((studio.match(/data-preset-category=/g) || []).length, 5);
  assert.equal((studio.match(/data-preset-panel=/g) || []).length, 5);
  assert.equal((studio.match(/data-preset="/g) || []).length, 50);
  const preservation = appScript.match(/const preservationFramework = `([^`]*)`;/)?.[1] || '';
  const finish = appScript.match(/const professionalFinish = `([^`]*)`;/)?.[1] || '';
  const presetTexts = [...appScript.matchAll(/^  [A-Za-z][A-Za-z0-9]*: `([^`]*)`,/gm)].map(match => `${preservation}\n${match[1]}\n${finish}`);
  assert.equal(presetTexts.length, 50);
  assert.ok(presetTexts.every(prompt => prompt.length >= 90));
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
  assert.match(upstreamBodies[0], /原图保真后期调色/);
  assert.match(upstreamBodies[0], /禁止新增、删除、替换、移动、重绘或重新生成/);
  assert.match(upstreamBodies[0], /<调色要求>自然调色<\/调色要求>/);

  const enhancedId = randomUUID();
  const enhanced = await fetch(`http://127.0.0.1:${port}/api/batch`, {
    method: 'POST', body: makeBody(enhancedId, randomUUID(), true),
  });
  assert.equal(enhanced.status, 202);
  let enhancedJob;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    enhancedJob = await fetch(`http://127.0.0.1:${port}/api/batch/${enhancedId}`).then(response => response.json()).then(data => data.job);
    if (enhancedJob.status !== 'processing' && enhancedJob.status !== 'queued') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(enhancedJob.status, 'completed', enhancedJob.items[0]?.error);
  assert.equal(enhancedJob.items[0].result.upscale.width, 7680);
  assert.equal(enhancedJob.items[0].result.upscale.aiEnhanced, true);
  assert.match(enhancedJob.items[0].result.image, /^data:image\/jpeg;base64,/);
  assert.equal(upstreamCalls, 3);
  assert.match(upstreamBodies[2], /只修复压缩损伤/);
  changeDetails = true;
  const rejectedId = randomUUID();
  const rejected = await fetch(`http://127.0.0.1:${port}/api/batch`, {
    method: 'POST', body: makeBody(rejectedId, randomUUID(), true),
  });
  assert.equal(rejected.status, 202);
  let rejectedJob;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    rejectedJob = await fetch(`http://127.0.0.1:${port}/api/batch/${rejectedId}`).then(response => response.json()).then(data => data.job);
    if (rejectedJob.status !== 'processing' && rejectedJob.status !== 'queued') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(rejectedJob.status, 'completed_with_errors');
  assert.match(rejectedJob.items[0].error, /差异过大/);
  assert.equal(rejectedJob.items[0].result, undefined);
  assert.equal(upstreamCalls, 5);
  console.log('SMOKE public=true idempotent=true mapped=true promptLocked=true ai8k=true rejectChanged=true upstreamCalls=5');
} finally {
  child.kill();
  upstream.close();
}
