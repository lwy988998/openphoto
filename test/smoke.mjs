import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const testPng = (await sharp({ create: { width: 16, height: 16, channels: 3, background: '#778899' } }).png().toBuffer()).toString('base64');
const changedPng = (await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64');
let upstreamCalls = 0;
const upstreamBodies = [];
let changeDetails = false;
let failDetails = false;
const upstream = http.createServer((req, res) => {
  upstreamCalls += 1;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => setTimeout(() => {
    const input = Buffer.concat(chunks);
    const body = input.toString('utf8');
    upstreamBodies.push(body);
    if (failDetails && body.includes('细节修复')) {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<!DOCTYPE html><title>Bad gateway</title>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    let output = testPng;
    if (body.includes('photo-detail.png')) {
      const fileHeader = input.indexOf(Buffer.from('filename="photo-detail.png"'));
      const beginning = input.indexOf(Buffer.from('\r\n\r\n'), fileHeader) + 4;
      const ending = input.indexOf(Buffer.from('\r\n--'), beginning);
      output = changeDetails ? changedPng : input.subarray(beginning, ending).toString('base64');
    }
    res.end(JSON.stringify({ data: [{ b64_json: output }] }));
  }, 120));
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;
const port = 39106;
const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openphoto-4k-smoke-'));
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, NODE_ENV: 'test', OPENPHOTO_RESULT_DIR: resultDir, PORT: String(port), OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}`, OPENPHOTO_ENV_FILE: 'missing-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErrors = '';
child.stderr.on('data', chunk => { serverErrors += chunk; });

function makeBody(jobId, imageId) {
  const body = new FormData();
  body.append('jobId', jobId);
  body.append('imageIds', JSON.stringify([imageId]));
  body.append('images', new Blob([Buffer.from(testPng, 'base64')], { type: 'image/png' }), 'one.png');
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
  const referencePage = await fetch(`http://127.0.0.1:${port}/reference.html`).then(response => response.text());
  const referenceScript = await fetch(`http://127.0.0.1:${port}/reference.js`).then(response => response.text());
  const appScript = await fetch(`http://127.0.0.1:${port}/app.js`).then(response => response.text());
  assert.match(root, /class="landingWordmark">Openphoto/);
  assert.match(root, /href="\/studio\.html">开始/);
  assert.match(root, /class="landingPage prismPage"/);
  assert.doesNotMatch(root, /accessPassword/);
  assert.match(studio, /id="photoGrid"/);
  assert.match(studio, /href="\/reference\.html"/);
  assert.match(referencePage, /id="sourceInput"/);
  assert.match(referencePage, /id="referenceInput"/);
  assert.match(referencePage, /id="resultPreview"/);

  assert.match(referenceScript, /openphoto-reference/);
  assert.match(referenceScript, /openphoto\.reference\.job/);
  assert.match(studio, /class="studioLayout"/);
  assert.match(studio, /id="resetDialog"/);
  assert.match(studio, /20260918-color/);
  assert.match(studio, /id="goldProgress"/);
  assert.match(appScript, /class="cardError" role="alert"/);
  assert.equal((studio.match(/data-preset-category=/g) || []).length, 5);
  assert.equal((studio.match(/data-preset-panel=/g) || []).length, 5);
  assert.equal((studio.match(/data-preset="/g) || []).length, 51);
  const preservation = appScript.match(/const preservationFramework = `([^`]*)`;/)?.[1] || '';
  const finish = appScript.match(/const professionalFinish = `([^`]*)`;/)?.[1] || '';
  const presetTexts = [...appScript.matchAll(/^  [A-Za-z][A-Za-z0-9]*: `([^`]*)`,/gm)].map(match => `${preservation}\n${match[1]}\n${finish}`);
  assert.equal(presetTexts.length, 51);
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

  assert.equal(upstreamCalls, 1);
  assert.match(studio, /data-preset="repair4k">4K修复/);
  assert.match(appScript, /保真型照片修复和超分辨率任务/);
  assert.match(appScript, /2× 或 4× 超分辨率/);
  assert.match(appScript, /不把压缩噪声锐化成纹理/);
  assert.doesNotMatch(studio, /id="upscale4k"|upscale8k|AI 高清细节增强/);
  assert.doesNotMatch(referencePage, /4K|8K|upscale/i);
  console.log('SMOKE public=true idempotent=true mapped=true promptLocked=true colorOnly=true');
} finally {
  child.kill();
  upstream.close();
  fs.rmSync(resultDir, { recursive: true, force: true });
}
