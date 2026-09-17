import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeAtmosphere, applyAtmosphere, makeStyleChart } from '../reference-grade.js';

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
const chart = await makeStyleChart();
const hazyChart = await sharp(chart).blur(4).png().toBuffer();
const { data: chartPixels } = await sharp(chart).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const grainyPixels = Buffer.from(chartPixels);
for (let i = 0; i < grainyPixels.length; i += 3) {
  const noise = ((Math.imul(Math.floor(i / 3) + 1, 741103597) >>> 20) % 41) - 20;
  for (let c = 0; c < 3; c += 1) grainyPixels[i + c] = Math.max(0, Math.min(255, grainyPixels[i + c] + noise));
}
const grainyChart = await sharp(grainyPixels, { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
const grainRefPixels = Buffer.alloc(256 * 256 * 3);
for (let i = 0; i < grainRefPixels.length; i += 3) {
  const value = 125 + ((Math.imul(Math.floor(i / 3) + 1, 741103597) >>> 20) % 41) - 20;
  grainRefPixels.fill(value, i, i + 3);
}
const grainReference = await sharp(grainRefPixels, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
const motionChart = await sharp(chart).convolve({ width: 21, height: 3,
  kernel: [...Array(21).fill(0), ...Array(21).fill(1), ...Array(21).fill(0)], scale: 21 }).png().toBuffer();
const motionProfile = await analyzeAtmosphere(motionChart, motionChart, chart);
assert.ok(motionProfile.signals.includes('抓拍动感'));
assert.notDeepEqual(await applyAtmosphere(chart, motionProfile, 70, 'png'), chart);
let calls = 0;
let fail = false;
let style = 'clean';
const upstream = http.createServer((req, res) => {
  calls += 1;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const input = Buffer.concat(chunks);
    const body = input.toString('utf8');
    assert.match(body, /image\/png/);
    if (body.includes('SOURCE PHOTO')) assert.match(body, /source-and-reference\.png|style-chart-and-reference\.png/);
    if (fail === true || (fail === 'transfer' && body.includes('source-and-reference.png'))) {
      res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>bad gateway</html>'); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    let image = body.includes('style-chart-and-reference.png')
      ? style === 'hazy' ? hazyChart : style === 'film' ? grainyChart : chart : candidate;
    if (body.includes('photo-detail.png')) {
      const fileHeader = input.indexOf(Buffer.from('filename="photo-detail.png"'));
      const beginning = input.indexOf(Buffer.from('\r\n\r\n'), fileHeader) + 4;
      const ending = input.indexOf(Buffer.from('\r\n--'), beginning);
      image = input.subarray(beginning, ending);
    }
    res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
  });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const port = 39107;
const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openphoto-4k-reference-'));
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, NODE_ENV: 'test', OPENPHOTO_RESULT_DIR: resultDir, PORT: String(port), OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, OPENPHOTO_ENV_FILE: 'missing-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function body(jobId, imageId, strength = 70, upscale4k = false, reference = candidate) {
  const form = new FormData();
  form.append('jobId', jobId);
  form.append('imageId', imageId);
  form.append('strength', String(strength));
  form.append('source', new Blob([source], { type: 'image/png' }), 'photo.png');
  form.append('reference', new Blob([reference], { type: 'image/png' }), 'film.png');
  if (upscale4k) form.append('upscale4k', 'on');
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
  assert.equal(job.stage, 'finalizing');
  assert.equal(calls, 2);
  assert.deepEqual(job.items[0].result.styleSignals, ['光影层次']);
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
  const beforeZero = calls;
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(zeroId, randomUUID(), 0) });
  const zero = await finish(zeroId);
  const zeroPixels = await sharp(Buffer.from(zero.items[0].result.image.split(',')[1], 'base64')).raw().toBuffer();
  assert.deepEqual(zeroPixels, sourcePixels);
  assert.equal(calls, beforeZero);

  style = 'hazy';
  const hazyId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(hazyId, randomUUID()) });
  const hazy = await finish(hazyId);
  assert.equal(hazy.status, 'completed', hazy.items[0]?.error);
  assert.ok(hazy.items[0].result.styleSignals.includes('柔焦'));
  assert.ok(hazy.items[0].result.styleSignals.includes('高光漫射'));
  assert.notEqual(hazy.items[0].result.image, job.items[0].result.image);
  const hazyLowId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(hazyLowId, randomUUID(), 30) });
  const hazyLow = await finish(hazyLowId);
  const difference = async image => {
    const pixels = await sharp(Buffer.from(image.split(',')[1], 'base64')).raw().toBuffer();
    return pixels.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : Math.abs(value - sourcePixels[index])), 0);
  };
  assert.ok(await difference(hazy.items[0].result.image) > await difference(hazyLow.items[0].result.image));

  style = 'film';
  const filmId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(filmId, randomUUID(), 70, false, grainReference) });
  const film = await finish(filmId);
  assert.equal(film.status, 'completed', film.items[0]?.error);
  assert.ok(film.items[0].result.styleSignals.includes('胶片颗粒'));
  assert.notEqual(film.items[0].result.image, hazy.items[0].result.image);

  style = 'clean';

  fail = true;
  const failedId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(failedId, randomUUID()) });
  const failed = await finish(failedId);
  assert.equal(failed.status, 'completed_with_errors');
  assert.equal(failed.items[0].error, '上游请求失败：HTTP 502');

  fail = 'transfer';
  const secondFailedId = randomUUID();
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(secondFailedId, randomUUID()) });
  const secondFailed = await finish(secondFailedId);
  assert.equal(secondFailed.status, 'completed_with_errors');
  assert.equal(secondFailed.items[0].error, '上游请求失败：HTTP 502');

  fail = false;
  style = 'hazy';
  const upId = randomUUID();
  const beforeUp = calls;
  await fetch(`http://127.0.0.1:${port}/api/reference`, { method: 'POST', body: body(upId, randomUUID(), 70, true) });
  const up = await finish(upId);
  assert.equal(up.status, 'completed', up.items[0]?.error);
  assert.equal(up.items[0].result.upscale.width, 256);
  assert.equal(up.items[0].result.upscale.aiEnhanced, true);
  assert.ok(up.items[0].result.styleSignals.includes('柔焦'));
  assert.equal(calls - beforeUp, 3);
  const output = await fetch(`http://127.0.0.1:${port}${up.items[0].result.pngUrl}`);
  assert.equal(output.status, 200);
  assert.equal((await sharp(Buffer.from(await output.arrayBuffer())).metadata()).width, 256);
  console.log('REFERENCE idempotent=twoCalls originalGeometry=true alpha=true threeZones=true zero=noCalls hazy=true film=true motion=true failure=true ai4k=true');
} finally {
  child.kill();
  upstream.close();
  fs.rmSync(resultDir, { recursive: true, force: true });
}
