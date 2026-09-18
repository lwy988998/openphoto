import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'server.js',
  'public/studio.html',
  'public/reference.html',
  'public/app.js',
  'public/reference.js',
  'public/progress.js',
  'README.md',
];
const forbidden = /upscale4k|upscale8k|enhanceTo4K|four-k|localLossless4K|AI 高清细节增强|4K 增强|resultRoot|resultTtl/i;
for (const relative of files) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  assert.doesNotMatch(source, forbidden, `${relative} 仍包含已删除的 4K 功能`);
}
assert.equal(fs.existsSync(path.join(root, 'four-k.js')), false, '4K 专用模块仍存在');
console.log('COLOR_ONLY no4KEntry=true no4KApi=true no4KStage=true no4KModule=true');
