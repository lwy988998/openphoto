import assert from 'node:assert/strict';
import sharp from 'sharp';
import { enhanceTo4K } from '../four-k.js';

process.env.NODE_ENV = 'test';
const width = 1024, height = 768;
const raw = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
  const i = (y * width + x) * 4;
  raw[i] = x > 512 ? 192 : 55;
  raw[i + 1] = (x * 13 + y * 7) % 256;
  raw[i + 2] = y > 384 ? 220 : 45;
  raw[i + 3] = x < 32 ? 128 : 255;
}
const input = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
const identity = await enhanceTo4K(input, input);
assert.equal(identity.metadata.width, width);
assert.equal(identity.metadata.aiPasses, 1);
const pixels = await sharp(identity.output).ensureAlpha().raw().toBuffer();
for (let i = 0; i < pixels.length; i += 4) {
  assert.equal(pixels[i + 3], raw[i + 3], '透明度必须保持原样');
  if (i % 71 === 0) for (let c = 0; c < 3; c += 1) assert.equal(pixels[i + c], raw[i + c]);
}
const blurred = await sharp(input).blur(2).png().toBuffer();
const candidate = await sharp(blurred).sharpen(2).png().toBuffer();
const enhanced = await enhanceTo4K(blurred, candidate);
const score = async image => {
  const data = await sharp(image).greyscale().raw().toBuffer();
  let sum = 0;
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width; x += 1) {
    const i = y * width + x;
    sum += Math.abs(data[i] - data[i - 1]);
  }
  return sum;
};
assert.ok(await score(enhanced.output) > (await score(blurred)) * 1.005, '对齐细节应提升解析力');
const flat = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#808080' } }).png().toBuffer();
const noisyRaw = Buffer.alloc(256 * 256 * 3);
for (let i = 0; i < noisyRaw.length; i += 3) noisyRaw.set([i % 2 ? 140 : 116, 128, 128], i);
const noisy = await sharp(noisyRaw, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
const flatResult = await enhanceTo4K(flat, noisy);
assert.ok((await sharp(flatResult.output).removeAlpha().raw().toBuffer()).every(value => value === 128), '平坦区域不能产生伪纹理');
const wrong = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } }).png().toBuffer();
await assert.rejects(enhanceTo4K(flat, wrong), /差异过大/);
console.log('QUALITY 4kSinglePass=true alphaPreserved=true detailGain=true flatProtected=true changedRejected=true');
