import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'public/drop.js'), 'utf8');
const guard = {};
const windowStub = { addEventListener(type, handler) { (guard[type] ||= []).push(handler); } };
vm.runInNewContext(source, { window: windowStub });
const drop = windowStub.OpenphotoDrop;
assert.ok(drop, 'drop.js 没有导出 window.OpenphotoDrop');

const file = (name, type = 'image/png') => ({ isFile: true, isDirectory: false, file: resolve => resolve({ name, type, size: 8 }) });
const dir = children => ({
  isFile: false,
  isDirectory: true,
  createReader() {
    let index = 0;
    return { readEntries(resolve) { const chunk = children.slice(index, index + 100); index += chunk.length; resolve(chunk); } };
  },
});
const dropped = (...entries) => ({ items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry })) });
const dragEvent = (type, types) => {
  const event = new Event(type, { cancelable: true, bubbles: true });
  event.dataTransfer = { types, files: [], items: [], dropEffect: 'none' };
  return event;
};

// 1. 图片判定：MIME 优先，type 为空时按扩展名兜底
assert.equal(drop.isImageFile({ name: 'a.jpg', type: 'image/jpeg' }), true);
assert.equal(drop.isImageFile({ name: 'B.PNG', type: '' }), true);
assert.equal(drop.isImageFile({ name: 'c.webp', type: 'image/webp' }), true);
assert.equal(drop.isImageFile({ name: 'd.pdf', type: 'application/pdf' }), false);
assert.equal(drop.isImageFile({ name: 'e.txt', type: '' }), false);
assert.equal(drop.isImageFile(null), false);

// 2. 文件夹递归：跳过非图片，进入子目录
const nested = await drop.collectFiles(dropped(dir([
  file('IMG_10.png'), file('IMG_2.png'), dir([file('sub.jpg', 'image/jpeg'), file('readme.md', 'text/markdown')]), file('notes.txt', 'text/plain'),
])));
assert.equal(nested.map(item => item.name).join(','), 'IMG_10.png,IMG_2.png,sub.jpg');

// 2b. 统计回填：读出多少、跳过多少、进过几个目录
const summary = {};
const counted = await drop.collectFiles(dropped(dir([
  file('a.png'), file('b.txt', 'text/plain'), dir([file('c.jpg', 'image/jpeg'), file('d.pdf', 'application/pdf')]),
])), drop.MAX_SCAN, summary);
assert.equal(counted.length, 2);
assert.equal(summary.scanned, 4, 'scanned 计数不正确');
assert.equal(summary.skipped, 2, 'skipped 计数不正确');
assert.equal(summary.folders, 2, 'folders 计数不正确');

// 3. readEntries 每次最多 100 项，必须循环读到空
const many = Array.from({ length: 250 }, (_, index) => file(`p${index}.png`));
assert.equal((await drop.collectFiles(dropped(dir(many)), 250)).length, 250, '目录分批读取没有取全');
assert.equal((await drop.collectFiles(dropped(dir(many)), 240)).length, 240);
assert.equal((await drop.collectFiles(dropped(dir(many)))).length, drop.MAX_SCAN);

// 4. 深度上限内正常，超限不再深入
let deeper = dir([file('deep.png')]);
for (let level = 0; level < drop.MAX_DEPTH + 3; level += 1) deeper = dir([deeper]);
assert.equal((await drop.collectFiles(dropped(deeper))).length, 0, '超过深度上限仍继续读取');

// 5. 没有目录 API 时降级到 dataTransfer.files
const fallbackSummary = {};
const fallback = await drop.collectFiles({ items: [{ kind: 'file' }], files: [{ name: 'x.png', type: 'image/png', size: 8 }, { name: 'y.pdf', type: 'application/pdf', size: 3 }] }, drop.MAX_SCAN, fallbackSummary);
assert.equal(fallback.map(item => item.name).join(','), 'x.png');
assert.equal(fallbackSummary.scanned, 2);
assert.equal(fallbackSummary.skipped, 1);
assert.equal((await drop.collectFiles({})).length, 0);
assert.equal((await drop.collectFiles(null)).length, 0);

// 6. 拖放区：高亮、回调、非文件拖动不拦截
const classes = new Set();
const zone = new EventTarget();
zone.classList = { add: name => classes.add(name), remove: name => classes.delete(name) };
let received = null;
drop.enableDropZone(zone, dataTransfer => { received = dataTransfer; });
zone.dispatchEvent(dragEvent('dragenter', ['Files']));
assert.equal(classes.has(drop.DROP_CLASS), true, '拖入时没有高亮上传区');
zone.dispatchEvent(dragEvent('dragover', ['Files']));
zone.dispatchEvent(dragEvent('drop', ['Files']));
assert.ok(received, 'drop 没有触发回调');
assert.equal(classes.has(drop.DROP_CLASS), false, '放下后没有取消高亮');
const textDrag = dragEvent('drop', ['text/plain']);
zone.dispatchEvent(textDrag);
assert.equal(textDrag.defaultPrevented, false, '非文件拖动不应被上传区拦截');

// 7. 拖到上传区以外时阻止浏览器直接打开文件
assert.equal(typeof guard.dragover?.[0], 'function', '没有注册页面级 dragover 拦截');
assert.equal(typeof guard.drop?.[0], 'function', '没有注册页面级 drop 拦截');
const outside = dragEvent('drop', ['Files']);
guard.drop[0](outside);
assert.equal(outside.defaultPrevented, true, '拖到空白处没有阻止浏览器打开文件');
const outsideText = dragEvent('drop', ['text/plain']);
guard.drop[0](outsideText);
assert.equal(outsideText.defaultPrevented, false);

console.log(`DROP images=true nested=3 chunked=250 limited=240 depthBlocked=true summary=true fallback=1 zone=true guard=true maxScan=${drop.MAX_SCAN}`);
