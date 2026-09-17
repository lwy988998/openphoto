const DB_NAME = 'openphoto-reference';
const JOB_KEY = 'openphoto.reference.job';
const SETTINGS_KEY = 'openphoto.reference.settings';
const form = document.querySelector('#referenceForm');
const sourceInput = document.querySelector('#sourceInput');
const referenceInput = document.querySelector('#referenceInput');
const strengthInput = document.querySelector('#strength');
const upscaleInput = document.querySelector('#upscale4k');
const submitButton = document.querySelector('#referenceSubmit');
const reprocessButton = document.querySelector('#reprocess');
const goldProgress = document.querySelector('#goldProgress');
const callEstimate = document.querySelector('#callEstimate');
const dialog = document.querySelector('#clearDialog');
let record = null;
let activeJob = null;
let polling = false;
const urls = [];
const stageLabels = { analyzing: '解析参考氛围…', matching: '迁移整体风格…', finalizing: '生成结果…', details: 'AI 增强细节…', exporting: '正在导出…' };

function updateEstimate() {
  callEstimate.textContent = upscaleInput.checked ? '预计 3 次模型调用：氛围解析、风格迁移和 4K 细节增强各一次（0% 强度仅一次）。' : '预计 2 次模型调用（风格强度 0% 时不调用）。';
}

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
    const transaction = db.transaction('current', mode);
    const request = action(transaction.objectStore('current'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { message('浏览器存储空间不足，刷新后可能无法恢复任务。', true); }
}

function message(value, error = false) {
  const element = document.querySelector('#message');
  element.textContent = value;
  element.classList.toggle('error', error);
}

async function persist() {
  try { if (record) await dbRequest('readwrite', store => store.put(record)); }
  catch { message('照片未能保存到浏览器，刷新前请勿关闭页面。', true); }
}

function render() {
  urls.splice(0).forEach(url => URL.revokeObjectURL(url));
  const busy = Boolean(activeJob);
  sourceInput.disabled = busy;
  referenceInput.disabled = busy;
  submitButton.disabled = busy || !record?.source || !record?.reference;
  reprocessButton.disabled = busy || !record?.source || !record?.reference;
  document.querySelector('#sourceName').textContent = record?.source?.name || '尚未选择';
  document.querySelector('#referenceName').textContent = record?.reference?.name || '尚未选择';
  for (const [name, blob] of [['source', record?.source], ['reference', record?.reference], ['result', record?.resultBlob]]) {
    const image = document.querySelector(`#${name}Preview`);
    const placeholder = document.querySelector(`#${name}Placeholder`);
    image.hidden = !blob;
    placeholder.hidden = Boolean(blob);
    if (blob) {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      image.src = url;
    } else image.removeAttribute('src');
  }
  const status = document.querySelector('#jobStatus');
  status.textContent = busy ? (stageLabels[activeJob.stage] || '处理中…') : record?.error ? '处理失败' : record?.resultBlob ? '已完成' : '等待上传';
  if (!busy && !record?.resultBlob && !record?.error) goldProgress.hidden = true;
  document.querySelector('#styleSignals').textContent = record?.styleSignals?.length
    ? `识别到的影像特征：${record.styleSignals.join(' · ')}` : '处理完成后显示识别到的影像特征。';
  const download = document.querySelector('#downloadResult');
  download.setAttribute('aria-disabled', String(!record?.resultBlob));
  if (record?.resultBlob) {
    download.href = document.querySelector('#resultPreview').src;
    const name = record.source.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
    download.download = `${name}-reference-openphoto.${record.resultFormat || 'png'}`;
  } else { download.removeAttribute('href'); download.removeAttribute('download'); }
  const png = document.querySelector('#downloadPng');
  png.hidden = !record?.pngUrl || Date.now() >= record.pngExpiresAt;
  if (!png.hidden) {
    png.href = record.pngUrl;
    png.download = `${record.source.name.replace(/\.[^.]+$/, '')}-reference-openphoto.png`;
  }
  document.querySelector('#resultInfo').textContent = record?.resultInfo || '';
}

async function choose(file, key) {
  if (activeJob || !file) return;
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size > 20 * 1024 * 1024) {
    message('只支持不超过 20 MB 的 PNG、JPG、WEBP 图片。', true);
    return;
  }
  record ||= { id: 'current', imageId: createUuid(), source: null, reference: null, resultBlob: null, resultFormat: '', error: '' };
  record[key] = file;
  record.imageId = createUuid();
  record.resultBlob = null;
  record.resultFormat = '';
  record.pngUrl = '';
  record.resultInfo = '';
  record.styleSignals = [];
  record.error = '';
  await persist();
  render();
  message(record.source && record.reference ? '两张照片已保存，刷新后仍可继续。' : '照片已保存，请选择另一张。');
}

async function poll(jobId) {
  if (polling || !activeJob || activeJob.id !== jobId) return;
  polling = true;
  let misses = 0;
  let downloads = 0;
  try {
    while (activeJob?.id === jobId) {
      let response;
      try { response = await fetch(`/api/batch/${encodeURIComponent(jobId)}`, { cache: 'no-store' }); }
      catch { await new Promise(resolve => setTimeout(resolve, 1800)); continue; }
      if (response.status === 404 && misses++ < 3) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '任务未创建或已过期，请重新处理。');
      const item = data.job?.items?.[0];
      if (item?.imageId !== record?.imageId) throw new Error('任务与当前照片不匹配。');
      window.renderGoldProgress(goldProgress, item, true, Boolean(activeJob.upscale4k));
      if (data.job.status === 'processing' || data.job.status === 'queued') {
        if (data.job.stage && activeJob) {
          activeJob.stage = data.job.stage;
          document.querySelector('#jobStatus').textContent = stageLabels[data.job.stage] || '处理中…';
        }
        await new Promise(resolve => setTimeout(resolve, 1800));
        continue;
      }
      if (item.status === 'completed' && item.result?.image) {
        try {
          const image = await fetch(item.result.image);
          if (!image.ok) throw new Error(`HTTP ${image.status}`);
          record.resultBlob = await image.blob();
        } catch {
          if (++downloads <= 3) {
            message('结果传输中断，正在重试；旧结果已保留。', true);
            await new Promise(resolve => setTimeout(resolve, 1800));
            continue;
          }
          throw new Error('结果下载失败，请重新处理。');
        }
        record.resultFormat = item.result.outputFormat || 'png';
        record.pngUrl = item.result.pngUrl || '';
        record.pngExpiresAt = record.pngUrl ? Date.now() + 24 * 60 * 60 * 1000 : 0;
        const meta = item.result.upscale;
        record.resultInfo = meta ? `${meta.width} × ${meta.height} · ${(item.result.bytes / 1024 / 1024).toFixed(2)} MB · AI 细节增强 ${meta.aiPasses} 次` : '';
        record.styleSignals = item.result.styleSignals || [];
        record.error = '';
        message('参考调色完成，可下载或重新处理。');
      } else {
        record.error = item?.error || '处理失败。';
        message(`${record.error}；原图、参考图和旧结果已保留。`, true);
      }
      await persist();
      break;
    }
  } catch (error) {
    if (record) {
      record.error = error.message || '任务恢复失败。';
      await persist();
      message(`${record.error}；原图、参考图和旧结果已保留。`, true);
    }
  } finally {
    if (activeJob?.id === jobId) { activeJob = null; save(JOB_KEY, null); }
    polling = false;
    render();
  }
}

async function submit() {
  if (activeJob || !record?.source || !record?.reference) return;
  const jobId = createUuid();
  activeJob = { id: jobId, imageId: record.imageId, stage: 'queued', upscale4k: upscaleInput.checked };
  save(JOB_KEY, activeJob);
  record.error = '';
  await persist();
  render();
  window.renderGoldProgress(goldProgress, { status: 'queued', stage: 'queued' }, true, upscaleInput.checked);
  message('正在上传并分析参考图…');
  const body = new FormData();
  body.append('source', record.source, record.source.name);
  body.append('reference', record.reference, record.reference.name);
  body.append('jobId', jobId);
  body.append('imageId', record.imageId);
  body.append('strength', strengthInput.value);
  body.append('upscale4k', upscaleInput.checked ? 'on' : '');
  body.append('temporaryApiKey', document.querySelector('#temporaryApiKey').value);
  try {
    const response = await fetch('/api/reference', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        record.error = data.error || `提交失败：HTTP ${response.status}`;
        await persist();
        activeJob = null;
        save(JOB_KEY, null);
        render();
        message(record.error, true);
        return;
      }
      throw new Error(data.error || `提交失败：HTTP ${response.status}`);
    }
    await poll(jobId);
  } catch (error) {
    message(`${error.message || '上传响应中断'}，正在尝试恢复任务…`, true);
    await poll(jobId);
  }
}

sourceInput.addEventListener('change', async () => { await choose(sourceInput.files[0], 'source'); sourceInput.value = ''; });
referenceInput.addEventListener('change', async () => { await choose(referenceInput.files[0], 'reference'); referenceInput.value = ''; });
strengthInput.addEventListener('input', () => { document.querySelector('#strengthValue').textContent = `${strengthInput.value}%`; });
strengthInput.addEventListener('change', () => save(SETTINGS_KEY, { strength: strengthInput.value, upscale4k: upscaleInput.checked }));
upscaleInput.addEventListener('change', () => { save(SETTINGS_KEY, { strength: strengthInput.value, upscale4k: upscaleInput.checked }); updateEstimate(); });
form.addEventListener('submit', event => { event.preventDefault(); submit(); });
reprocessButton.addEventListener('click', submit);
document.querySelector('#clearReference').addEventListener('click', () => {
  if (record || activeJob) dialog.showModal();
});
dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'confirm') return;
  activeJob = null;
  save(JOB_KEY, null);
  await dbRequest('readwrite', store => store.clear()).catch(() => message('清空浏览器存储失败。', true));
  record = null;
  goldProgress.hidden = true;
  render();
  message('参考调色工作台已清空。');
});

(async () => {
  const settings = load(SETTINGS_KEY, {});
  strengthInput.value = /^\d+$/.test(String(settings.strength)) ? Math.min(100, Math.max(0, Number(settings.strength))) : 70;
  document.querySelector('#strengthValue').textContent = `${strengthInput.value}%`;
  upscaleInput.checked = Boolean(settings.upscale4k ?? settings.upscale8k);
  updateEstimate();
  try { record = await dbRequest('readonly', store => store.get('current')) || null; }
  catch { message('浏览器存储暂不可用，刷新恢复可能失效。', true); }
  activeJob = load(JOB_KEY, null);
  if (activeJob && activeJob.imageId !== record?.imageId) { activeJob = null; save(JOB_KEY, null); }
  render();
  fetch('/api/status').then(response => response.json()).then(data => {
    document.querySelector('#status').textContent = data.hasOpenAIKey ? '服务已就绪' : 'OpenAI Key 未配置';
  }).catch(() => { document.querySelector('#status').textContent = '服务状态异常'; });
  if (activeJob) { message('正在恢复未完成任务…'); poll(activeJob.id); }
})();
