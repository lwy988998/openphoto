const DB_NAME = 'openphoto-repair';
const JOB_KEY = 'openphoto.repair.job';
const SETTINGS_KEY = 'openphoto.repair.settings';
const form = document.querySelector('#repairForm');
const sourceInput = document.querySelector('#sourceInput');
const progress = document.querySelector('#goldProgress');
const dialog = document.querySelector('#clearDialog');
const sliders = ['denoise', 'sharpen'].map(id => document.getElementById(id));
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const selectedMode = () => modeInputs.find(input => input.checked)?.value || 'local';
let record = null;
let activeJob = null;
let polling = false;
let urls = [];

function createUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('current', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function dbRequest(mode, action) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const request = action(db.transaction('current', mode).objectStore('current'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function message(value, error = false) {
  const node = document.querySelector('#message');
  node.textContent = value;
  node.classList.toggle('error', error);
}
async function persist() {
  try { if (record) await dbRequest('readwrite', store => store.put(record)); return true; }
  catch { message('浏览器存储不足；请下载已有结果，刷新后可能无法恢复。', true); return false; }
}
function render() {
  urls.forEach(url => URL.revokeObjectURL(url));
  urls = [];
  const busy = Boolean(activeJob);
  const mode = selectedMode();
  const result = record?.results?.[mode];
  const error = record?.errors?.[mode];
  sourceInput.disabled = busy;
  for (const input of modeInputs) input.disabled = busy;
  document.getElementById('localControls').hidden = mode !== 'local';
  document.getElementById('modeHint').textContent = mode === 'local'
    ? '基于 Sharp / libvips 处理原片已有像素；严重失焦的信息不能凭空找回。'
    : 'AI 会根据原图证据重建模糊细节，可能改变文字或局部纹理；按模型实际尺寸下载，不保证 4K。失败时最多重试一次。';
  document.querySelector('#repairSubmit span').textContent = mode === 'ai' ? '开始 AI 清晰重建' : '开始保真修复';
  document.querySelector('#repairSubmit small').textContent = mode === 'ai' ? '实际输出尺寸' : '原片尺寸';
  const resultPrefix = busy && result ? '上次结果 · 本次处理中' : error && result ? '上次结果 · 本次失败后保留' : '本次结果';
  document.getElementById('resultLabel').textContent = mode === 'ai'
    ? `${resultPrefix} · AI 重建实际尺寸` : `${resultPrefix} · 保真原片尺寸`;
  document.querySelector('#repairSubmit').disabled = busy || !record?.source;
  document.querySelector('#reprocess').disabled = busy || !record?.source;
  document.querySelector('#sourceName').textContent = record?.source?.name || '尚未选择';
  for (const [id, blob] of [['source', record?.source], ['result', result?.png]]) {
    const image = document.getElementById(`${id}Preview`);
    document.getElementById(`${id}Placeholder`).hidden = Boolean(blob);
    image.hidden = !blob;
    if (blob) { image.src = URL.createObjectURL(blob); urls.push(image.src); }
    else image.removeAttribute('src');
  }
  for (const [id, blob, extension] of [['downloadPng', result?.png, 'png'], ['downloadJpeg', result?.jpeg, 'jpg']]) {
    const anchor = document.getElementById(id);
    anchor.setAttribute('aria-disabled', String(!blob));
    if (blob) {
      anchor.href = URL.createObjectURL(blob);
      urls.push(anchor.href);
      anchor.download = `${record.source.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_')}-${mode === 'ai' ? 'ai-reconstruction' : 'faithful-repair'}-openphoto.${extension}`;
    } else { anchor.removeAttribute('href'); anchor.removeAttribute('download'); }
  }
  document.getElementById('jobStatus').textContent = busy ? (result ? '处理中（显示上次结果）' : '处理中')
    : error ? '处理失败（旧结果已保留）' : result?.png ? '已完成' : '等待上传';
  document.getElementById('resultInfo').textContent = result?.info || '';
  if (!busy && !result?.png && !error) progress.hidden = true;
}

async function poll(jobId) {
  if (polling || activeJob?.id !== jobId) return;
  polling = true;
  try {
    let misses = 0;
    while (activeJob?.id === jobId) {
      let response;
      try { response = await fetch(`/api/batch/${encodeURIComponent(jobId)}`, { cache: 'no-store' }); }
      catch { await new Promise(resolve => setTimeout(resolve, 1600)); continue; }
      if (response.status === 404 && misses++ < 4) { await new Promise(resolve => setTimeout(resolve, 1200)); continue; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '任务不存在或已过期，请再次提交。');
      const item = data.job?.items?.[0];
      if (item?.imageId !== record?.imageId || item.mode !== (activeJob.mode === 'ai' ? 'ai-repair' : 'local-repair')) throw new Error('任务与当前照片不匹配。');
      window.renderGoldProgress(progress, item);
      const attempt = item.mode === 'ai-repair' && item.stage === 'styling' && item.detailTotal
        ? `（第 ${item.detailCompleted}/${item.detailTotal} 次）` : '';
      document.getElementById('jobStatus').textContent = ({ denoising: '正在降噪', sharpening: '正在修复清晰度', styling: '正在 AI 重建', finalizing: '正在导出' }[item.stage] || '处理中') + attempt;
      if (['queued', 'processing'].includes(data.job.status)) { await new Promise(resolve => setTimeout(resolve, 1600)); continue; }
      if (item.status !== 'completed') throw new Error(item.error || '修复失败。');
      const outputs = await Promise.all(['png', 'jpeg'].map(async format => {
        const result = await fetch(`/api/repair/${encodeURIComponent(jobId)}/file?format=${format}`);
        if (!result.ok) throw new Error(`${format.toUpperCase()} 导出失败：HTTP ${result.status}`);
        return result.blob();
      }));
      record.results ||= {};
      const elapsedSeconds = Math.max(0, Math.round((Date.now() - (activeJob.startedAt || Date.now())) / 1000));
      record.results[activeJob.mode] = { png: outputs[0], jpeg: outputs[1],
        info: `任务 ${jobId} · ${new Date().toLocaleString('zh-CN')} · 用时 ${elapsedSeconds} 秒 · ${item.result.width} × ${item.result.height} 像素 · PNG ${(outputs[0].size / 1048576).toFixed(1)} MB · JPG ${(outputs[1].size / 1048576).toFixed(1)} MB · ${activeJob.mode === 'ai' ? 'AI 高清重建，已匹配原片色彩与明暗，可能推断细节，按原生尺寸导出' : '保真降噪锐化，原片尺寸'}` };
      record.errors ||= {};
      record.errors[activeJob.mode] = '';
      await persist();
      message('修复完成，可查看 100% 像素并分别下载。');
      break;
    }
  } catch (error) {
    if (record) {
      record.errors ||= {};
      record.errors[activeJob?.mode || selectedMode()] = error.message || '任务恢复失败。';
      await persist();
      message(`${record.errors[activeJob?.mode || selectedMode()]} 原图和旧结果已保留。`, true);
    }
  } finally {
    if (activeJob?.id === jobId) {
      activeJob = null;
      try { save(JOB_KEY, null); } catch { /* 浏览器存储暂不可用 */ }
    }
    polling = false;
    render();
  }
}

async function submit() {
  if (activeJob || !record?.source) return;
  const jobId = createUuid();
  const mode = selectedMode();
  activeJob = { id: jobId, imageId: record.imageId, mode, startedAt: Date.now() };
  try { save(JOB_KEY, activeJob); }
  catch { activeJob = null; message('任务无法保存到浏览器，请检查存储空间。', true); return; }
  record.errors ||= {};
  record.errors[mode] = '';
  await persist();
  render();
  window.renderGoldProgress(progress, { mode: mode === 'ai' ? 'ai-repair' : 'local-repair', status: 'queued', stage: 'queued' });
  message('正在上传原图…');
  const body = new FormData();
  body.append('source', record.source, record.source.name);
  body.append('jobId', jobId);
  body.append('imageId', record.imageId);
  body.append('mode', mode);
  for (const slider of sliders) body.append(slider.id, slider.value);
  try {
    const response = await fetch('/api/repair', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status < 500) {
      record.errors[mode] = data.error || `提交失败：HTTP ${response.status}`;
      await persist();
      activeJob = null;
      save(JOB_KEY, null);
      render();
      message(record.errors[mode], true);
      return;
    }
    if (!response.ok) message(`上传响应异常：HTTP ${response.status}，正在恢复任务…`, true);
    await poll(jobId);
  } catch {
    message('上传响应中断，正在尝试恢复原任务…', true);
    await poll(jobId);
  }
}

sourceInput.addEventListener('change', async () => {
  const file = sourceInput.files?.[0];
  sourceInput.value = '';
  if (!file || activeJob) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1048576) {
    message('只支持不超过 20 MB 的 PNG、JPG、WEBP 图片。', true); return;
  }
  record = { id: 'current', imageId: createUuid(), source: file, results: {}, errors: {} };
  const saved = await persist();
  render();
  if (saved) message('原图已保存；调整强度后可开始修复。');
});
for (const slider of sliders) {
  slider.addEventListener('input', () => { document.getElementById(`${slider.id}Value`).textContent = slider.value; });
  slider.addEventListener('change', () => {
    try { save(SETTINGS_KEY, { ...load(SETTINGS_KEY, {}), ...Object.fromEntries(sliders.map(item => [item.id, Number(item.value)])) }); }
    catch { message('强度设置无法保存到浏览器。', true); }
  });
}
for (const input of modeInputs) input.addEventListener('change', () => {
  try { save(SETTINGS_KEY, { ...load(SETTINGS_KEY, {}), mode: selectedMode() }); }
  catch { message('模式设置无法保存到浏览器。', true); }
  progress.hidden = true;
  render();
});
form.addEventListener('submit', event => { event.preventDefault(); submit(); });
document.getElementById('reprocess').addEventListener('click', submit);
document.getElementById('zoomToggle').addEventListener('click', event => {
  const actual = document.getElementById('sourceViewport').classList.toggle('actual');
  document.getElementById('resultViewport').classList.toggle('actual', actual);
  event.currentTarget.textContent = actual ? '适应窗口' : '查看 100% 像素';
});
document.getElementById('clearRepair').addEventListener('click', () => { if (record || activeJob) dialog.showModal(); });
dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'confirm') return;
  activeJob = null;
  try { save(JOB_KEY, null); await dbRequest('readwrite', store => store.clear()); }
  catch { message('清空浏览器存储失败。', true); return; }
  record = null;
  progress.hidden = true;
  render();
  message('修复记录已清空。');
});

(async () => {
  const settings = load(SETTINGS_KEY, {});
  if (settings.mode === 'ai') modeInputs.find(input => input.value === 'ai').checked = true;
  for (const slider of sliders) {
    if (Number.isInteger(settings[slider.id]) && settings[slider.id] >= 0 && settings[slider.id] <= 100) slider.value = settings[slider.id];
    document.getElementById(`${slider.id}Value`).textContent = slider.value;
  }
  try {
    record = await dbRequest('readonly', store => store.get('current')) || null;
    if (record && !record.results) {
      record.results = record.png ? { local: { png: record.png, jpeg: record.jpeg, info: record.info || '' } } : {};
      record.errors = { local: record.error || '' };
      await persist();
    }
  }
  catch { message('浏览器存储暂不可用，刷新后可能无法恢复。', true); }
  activeJob = load(JOB_KEY, null);
  if (activeJob && !activeJob.mode) activeJob.mode = 'local';
  if (activeJob && activeJob.imageId !== record?.imageId) { activeJob = null; try { save(JOB_KEY, null); } catch {} }
  if (activeJob?.mode === 'ai') modeInputs.find(input => input.value === 'ai').checked = true;
  render();
  if (activeJob) { message('正在恢复修复任务…'); poll(activeJob.id); }
})();
