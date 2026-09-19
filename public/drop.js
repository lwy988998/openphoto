/* 拖动上传：支持拖入照片文件，也支持直接拖入整个文件夹（递归读取里面的图片）。
   Chromium / WebKit 走 DataTransferItem.webkitGetAsEntry 读取目录，其余浏览器降级到 dataTransfer.files。 */
(() => {
  const IMAGE_MIME = /^image\/(png|jpe?g|webp)$/i;
  const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;
  const MAX_SCAN = 240;
  const MAX_DEPTH = 12;
  const DROP_CLASS = 'dragging';

  function hasFiles(event) {
    const types = event?.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  }

  /* 有些系统拖进来的文件 type 为空，此时按扩展名兜底。 */
  function isImageFile(file) {
    if (!file) return false;
    if (IMAGE_MIME.test(file.type || '')) return true;
    return !file.type && IMAGE_EXTENSION.test(file.name || '');
  }

  function readFileEntry(entry) {
    return new Promise(resolve => {
      try { entry.file(resolve, () => resolve(null)); }
      catch { resolve(null); }
    });
  }

  /* readEntries 每次最多返回 100 项，必须反复读到空数组为止。 */
  function readDirectoryBatch(reader) {
    return new Promise(resolve => {
      try { reader.readEntries(resolve, () => resolve([])); }
      catch { resolve([]); }
    });
  }

  async function readEntry(entry, out, limit, depth, summary) {
    if (!entry || out.length >= limit || depth > MAX_DEPTH) return out;
    if (entry.isFile) {
      const file = await readFileEntry(entry);
      if (!file) return out;
      summary.scanned += 1;
      if (isImageFile(file)) out.push(file);
      else summary.skipped += 1;
      return out;
    }
    if (entry.isDirectory) {
      summary.folders += 1;
      const reader = entry.createReader();
      for (;;) {
        const batch = await readDirectoryBatch(reader);
        if (!batch.length) break;
        for (const child of batch) {
          if (out.length >= limit) break;
          await readEntry(child, out, limit, depth + 1, summary);
        }
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /* 必须在 drop 事件同步阶段取 entry，事件结束后 DataTransfer 就失效了。 */
  function entriesFrom(dataTransfer) {
    const items = dataTransfer?.items;
    if (!items) return [];
    const entries = [];
    for (const item of Array.from(items)) {
      if (item.kind !== 'file' || typeof item.webkitGetAsEntry !== 'function') continue;
      try {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      } catch { /* 忽略无法读取的条目 */ }
    }
    return entries;
  }

  /* summary 可选：回填 scanned / skipped / folders，便于页面提示忽略了什么。 */
  async function collectFiles(dataTransfer, limit = MAX_SCAN, summary = null) {
    const stats = summary || { scanned: 0, skipped: 0, folders: 0 };
    if (summary) {
      if (summary.scanned === undefined) summary.scanned = 0;
      if (summary.skipped === undefined) summary.skipped = 0;
      if (summary.folders === undefined) summary.folders = 0;
    }
    const entries = entriesFrom(dataTransfer);
    const out = [];
    if (entries.length) {
      for (const entry of entries) {
        if (out.length >= limit) break;
        await readEntry(entry, out, limit, 0, stats);
      }
      return out;
    }
    for (const file of Array.from(dataTransfer?.files || [])) {
      if (out.length >= limit) break;
      stats.scanned += 1;
      if (isImageFile(file)) out.push(file);
      else stats.skipped += 1;
    }
    return out;
  }

  function enableDropZone(element, onFiles, { className = DROP_CLASS } = {}) {
    if (!element) return;
    let depth = 0;
    const clear = () => { depth = 0; element.classList.remove(className); };
    element.addEventListener('dragenter', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      element.classList.add(className);
    });
    element.addEventListener('dragover', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      element.classList.add(className);
    });
    element.addEventListener('dragleave', event => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) element.classList.remove(className);
    });
    element.addEventListener('drop', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
      onFiles(event.dataTransfer);
    });
    return clear;
  }

  /* 拖到上传区以外的地方时，阻止浏览器直接打开这个文件。 */
  function guardWindow(target = window) {
    target.addEventListener('dragover', event => { if (hasFiles(event)) event.preventDefault(); });
    target.addEventListener('drop', event => { if (hasFiles(event)) event.preventDefault(); });
  }

  guardWindow();

  const api = { isImageFile, collectFiles, enableDropZone, guardWindow, hasFiles, MAX_SCAN, MAX_DEPTH, DROP_CLASS };
  if (typeof window !== 'undefined') window.OpenphotoDrop = api;
})();
