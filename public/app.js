const presets = {
  cinema: `将原始照片完整保持原样。绝对不要改变、新增、移除、替换、重新绘制或重新生成主体、脸部、发型、服装、身体比例、姿势、构图、摄影机角度、透视、背景物体或环境。
套用丰富且自然的电影级色彩调整：深邃但不脏的绿色、温暖的黄金时刻高光、干净清澈的蓝色天空、准确自然的肤色、柔和中性的阴影。避免橙色或黄色偏色。
提升动态范围、局部对比度、纹理与细节，呈现高端户外摄影、ARRI Alexa 35 色彩科学、Kodak Portra 400 胶片色调、轻微底片颗粒、自然对比度、照片级真实。`,
  sparkle: `将原始照片完整保持原样。绝对不要改变主体、脸部、服装、身体比例、姿势、构图、相机角度、透视、背景物体或环境。
加入自然阳光反射启发的细腻高级闪耀效果：微小真实的晶体般闪光、柔和光粒子、宝石光斑、微型镜面闪光和柔和亮粉高光，只分布在空气、草地和阳光照射到的明亮区域。
增强黄金时刻氛围：温暖电影阳光、柔和光晕、细腻体积光、真实 HDR、丰富色彩层次和流畅色调过渡。最终保持超写实照片质感，完全没有 AI 生成痕迹。`,
  hdr: `保持原始照片内容完整不变，不重绘主体、脸部、背景或构图。只进行自然影像后期调色。
提升动态范围、局部对比度、暗部细节和高光层次，呈现类似 iPhone 16 Pro Smart HDR 的自然清晰效果。肤色准确，天空干净，阴影柔和中性，纹理细节更清楚但不过度锐化，整体仍是真实摄影。`,
  portra: `保持原图内容完全不变，只进行胶片感后期。使用 Kodak Portra 400 风格：柔和高光、自然肤色、温暖但不过黄的色调、轻微粉绿色互补、细腻底片颗粒、柔和对比度、宽容的动态范围。避免夸张 AI 艺术化和过度磨皮。`,
  digicam: `保持原始照片主体、构图、背景和真实感不变。做 2000 年代卡片机/CCD 数码相机质感：轻微直闪感、清爽蓝色、略高对比、轻微高光溢出、细小噪点、真实生活感，但不要复古过度，不要改变人物长相。`,
  alexa: `完整保留原始照片的主体、脸部、发型、服装、姿势、构图、透视和背景，不新增或重绘任何内容。只做高端数字电影摄影调色。
使用 ARRI Alexa 35 色彩科学：柔和高光滚降、准确自然肤色、略暖但克制的中间调、干净稳定的暗部、丰富动态范围和高级局部对比。整体呈现商业广告片级户外摄影质感，真实、干净、电影感，不要出现 AI 绘画感。`,
  blockbuster: `保持原图所有内容不变，只进行电影海报级调色。加入深邃青绿色阴影、温暖金色高光、通透天空、清晰肤色和高反差但不过硬的层次。
增强空气透视、局部对比、HDR 高光细节和轻微胶片颗粒，呈现大制作电影剧照质感。避免过度橙黄、过饱和、磨皮、塑料质感或改变人物五官。`,
  japanese: `保持原图内容完全不变，只做日系清透写真调色。整体明亮干净、低对比、柔和高光、偏清新的蓝绿色阴影、自然白皙但真实的肤色、空气感强。
保留皮肤纹理和真实摄影细节，减少脏灰和杂色，让天空更通透、绿色更柔和。不要生成二次元或插画风，不要改变人物和背景。`,
  hongkong: `完整保留原图主体、构图、背景和真实感。只加入港风电影调色：温暖钨丝灯感、轻微霓虹红绿互补、复古胶片颗粒、柔和暗角、略高对比和怀旧色偏。
肤色保持自然，不要过度发黄；阴影可以更浓郁但不能死黑。最终像真实 90 年代港片剧照或街拍胶片照片，而不是 AI 复古插画。`,
  korean: `保持照片原样，不改变脸部、身材、衣服、姿势、背景或构图。只做韩系高级人像调色：干净奶油色高光、柔和低饱和、自然透亮肤色、轻微粉米色氛围、阴影柔和。
减少杂乱色彩，让画面更高级、清爽、适合社交媒体头像/写真。保留真实皮肤纹理，不要磨成塑料脸，不要改变人物身份。`,
  fuji: `保持原图内容完整不变，只做 Fuji 胶片模拟风格调色。呈现 Classic Chrome / Pro 400H 启发的低饱和高级色彩、柔和绿色、克制蓝色、自然肤色、细腻颗粒和温和对比。
高光不过曝，暗部不死黑，整体像真实富士相机直出照片。不要重绘、不要艺术化、不要改变主体和背景细节。`,
  cinestill: `保持原始照片主体、脸部、服装、构图和背景完全不变。只做 CineStill 800T 风格夜景/弱光电影胶片调色：钨丝灯暖色、高光轻微红橙光晕、冷色阴影、真实胶片颗粒、柔和反差。
如果画面有灯光或反光，可加入自然 halation 红色晕染，但必须真实克制。不要让肤色过红，不要增加不存在的物体或赛博朋克元素。`,
  polaroid: `完整保留原图内容，只做宝丽来即时成像质感：柔和低清晰度、奶油高光、轻微褪色、温暖白平衡、浅浅颗粒、柔和暗角和真实相纸感。
整体保持生活化、自然、怀旧，但不要添加相框，除非原图已有边框。不要改变人物五官、服装、背景或构图。`,
  disposable: `保持原图完全不变，只做一次性胶片相机/傻瓜胶片机质感：直闪自然融合、略高对比、轻微过曝高光、偏青绿色阴影、明显但细腻的胶片颗粒、生活快照感。
允许少量红眼/闪光反射质感但要自然。不要新增物体，不要让画面变成插画，不要改变人物外貌。`,
  cleanCommercial: `保持原始照片所有内容和真实摄影结构不变，只做高端商业修图级自然调色。优化白平衡、肤色、天空、绿色植物、阴影层次和整体通透度。
提升局部对比、锐度和动态范围，但不要过度 HDR、不要磨皮、不要滤镜感太重。最终像品牌广告/高端户外人像成片，干净、真实、有质感。`,
  moodyForest: `完整保留原图主体和背景，不改变任何物体或构图。只做森林电影感调色：深邃湿润的绿色、柔和冷阴影、温暖日光高光、空气感和轻微雾感。
增强植物层次和光影纵深，让画面更有高级户外摄影氛围。肤色必须准确自然，避免绿色污染皮肤，避免过暗或奇幻风。`,
  summer: `保持原图内容完全不变，只做夏日清爽胶片调色：明亮阳光、清澈蓝天、鲜活但不过饱和的绿色、自然肤色、柔和高光、轻微颗粒。
整体轻盈、通透、青春、真实，适合校园/旅行/户外照片。不要改变人物、背景或添加不存在的阳光物体。`,
  nightFlash: `保持原图主体、脸部、衣服、背景和构图完全不变。只做夜晚直闪相机质感：自然闪光照亮主体、背景略暗、肤色真实、冷暖对比、轻微高光反射、细小噪点和生活快照感。
不要把闪光做得像舞台灯，不要新增灯光设备，不要改变人物五官。`,
  vintageDV: `完整保留原始照片内容，只加入复古 DV / 早期数码相机质感：轻微低动态范围、柔和锐度、细小数字噪点、微弱色散、轻度高光溢出、偏生活记录的真实感。
色彩可以略偏蓝绿或暖黄，但要自然克制。不要加时间戳，不要改变构图或生成新元素。`,
  food: `保持原图构图和食物/场景完全不变，只做美食摄影调色：提升食物色泽、温暖自然光、干净白平衡、增强纹理细节和油润高光，背景保持柔和。
避免过度饱和、塑料感、假 HDR 或改变食物形状。最终像真实餐厅商业摄影成片。`,
  product: `保持产品、文字、包装、形状、位置、背景完全不变，不改 logo 和任何可读文字。只做高端产品摄影调色：干净白平衡、准确材质颜色、清晰边缘、柔和高光、自然阴影和高级对比。
提升质感与细节，但不要重绘产品，不要改变包装图案，不要添加反射或道具。`,
  portraitNatural: `保持人物身份、五官、脸型、发型、服装、身材比例、姿势和背景完全不变。只做自然人像后期：准确肤色、轻微提亮眼神光、柔和阴影、自然局部对比、保留皮肤纹理。
可以优化整体色彩和光线，但不要磨皮过度、不要改变脸、不要美颜换脸、不要生成 AI 质感。`,
  blackGold: `保持原图内容不变，只做黑金高级电影调色：深色背景更干净、高光偏暖金色、阴影中性偏冷、对比度更强但保留细节。
适合夜景、舞台、建筑或酷感人像。不要让肤色变黄，不要压暗到丢失主体，不要新增光效或改变背景。`,
};

const DB_NAME = 'openphoto-studio';
const STORE_NAME = 'images';
const SETTINGS_KEY = 'openphoto.settings';
const JOBS_KEY = 'openphoto.jobs';
const form = document.querySelector('#editForm');
const imageInput = document.querySelector('#imageInput');
const selectedFiles = document.querySelector('#selectedFiles');
const promptInput = document.querySelector('#prompt');
const message = document.querySelector('#message');
const statusEl = document.querySelector('#status');
const photoGrid = document.querySelector('#photoGrid');
const submitButton = form.querySelector('.submitButton');
const resetDialog = document.querySelector('#resetDialog');
const presetLabels = Object.fromEntries([...document.querySelectorAll('[data-preset]')].map(button => [button.dataset.preset, button.textContent.trim()]));
let records = [];
let jobs = loadJson(JOBS_KEY, {});
const polling = new Set();
const objectUrls = new Set();

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'imageId' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function dbRequest(mode, operation) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = operation(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const readImages = () => dbRequest('readonly', store => store.getAll());
const putImage = record => dbRequest('readwrite', store => store.put(record));
const clearImages = () => dbRequest('readwrite', store => store.clear());

function setMessage(text, error = false) {
  message.textContent = text;
  message.className = `message${error ? ' error' : ''}`;
}

function saveSettings() {
  saveJson(SETTINGS_KEY, {
    model: document.querySelector('#model').value,
    quality: document.querySelector('#quality').value,
    size: document.querySelector('#size').value,
    prompt: promptInput.value,
    upscale8k: document.querySelector('#upscale8k').checked,
  });
}

function restoreSettings() {
  const settings = loadJson(SETTINGS_KEY, {});
  for (const key of ['model', 'quality', 'size']) {
    const element = document.querySelector(`#${key}`);
    if (settings[key] && [...element.options].some(option => option.value === settings[key])) element.value = settings[key];
  }
  promptInput.value = settings.prompt || presets.cinema;
  document.querySelector('#upscale8k').checked = Boolean(settings.upscale8k);
}

function statusText(status) {
  return ({ ready: '等待处理', queued: '排队中', processing: '处理中…', completed: '已完成', failed: '处理失败' })[status] || '等待处理';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function resultName(record) {
  const base = record.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  const extension = record.resultFormat === 'jpg' ? 'jpeg' : (record.resultFormat || 'png');
  return `${base}-openphoto.${extension}`;
}

function releaseObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function renderCards() {
  releaseObjectUrls();
  selectedFiles.textContent = records.length ? `已保存 ${records.length} 张照片：${records.map(record => record.name).join('、')}` : '尚未选择照片';
  if (!records.length) {
    photoGrid.innerHTML = '<p class="emptyState">上传照片后，每张原图和对应结果都会显示在这里。</p>';
    return;
  }
  photoGrid.innerHTML = records.map(record => {
    const sourceUrl = blobUrl(record.file);
    const outputUrl = record.resultBlob ? blobUrl(record.resultBlob) : record.resultUrl;
    const prompt = record.prompt || promptInput.value;
    const options = Object.entries(presetLabels).map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('');
    const result = outputUrl
      ? `<img src="${escapeHtml(outputUrl)}" alt="${escapeHtml(record.name)} 的处理结果">`
      : `<div class="resultPlaceholder ${record.status === 'processing' || record.status === 'queued' ? 'processing' : ''}">${record.error ? escapeHtml(record.error) : statusText(record.status)}</div>`;
    return `<article class="photoCard glass ${record.status}" data-image-id="${record.imageId}">
      <header class="cardHeader"><strong title="${escapeHtml(record.name)}">${escapeHtml(record.name)}</strong><span class="cardStatus ${record.status}">${statusText(record.status)}</span></header>
      <div class="imageStack">
        <div class="imagePane"><span class="imageLabel">原图</span><img src="${sourceUrl}" alt="${escapeHtml(record.name)} 原图"></div>
        <div class="imagePane"><span class="imageLabel">处理结果</span>${result}</div>
      </div>
      <div class="cardActions">
        <a class="cardButton primary" ${outputUrl ? `href="${escapeHtml(outputUrl)}" download="${escapeHtml(resultName(record))}"` : 'aria-disabled="true"'}>单独下载</a>
      </div>
      <details class="cardPrompt">
        <summary>更换提示词并重新处理</summary>
        <label>选择预设<select class="cardPreset"><option value="">自定义</option>${options}</select></label>
        <label>单图提示词<textarea class="cardPromptText">${escapeHtml(prompt)}</textarea></label>
        <button class="cardButton reprocessButton" type="button" ${record.status === 'processing' || record.status === 'queued' ? 'disabled' : ''}>重新处理这张照片</button>
      </details>
    </article>`;
  }).join('');

  photoGrid.querySelectorAll('.photoCard').forEach(card => {
    const record = records.find(item => item.imageId === card.dataset.imageId);
    const textarea = card.querySelector('.cardPromptText');
    card.querySelector('.cardPreset').addEventListener('change', event => {
      if (event.target.value) textarea.value = presets[event.target.value];
    });
    textarea.addEventListener('change', async () => {
      record.prompt = textarea.value;
      await persist(record);
    });
    card.querySelector('.reprocessButton').addEventListener('click', async () => {
      record.prompt = textarea.value.trim() || promptInput.value;
      await persist(record);
      await submitJob([record], record.prompt);
    });
  });
}

async function persist(record) {
  try { await putImage(record); }
  catch (error) { console.error(error); setMessage('浏览器存储空间不足，本页关闭前仍可继续处理。', true); }
}

async function storeResult(record, item, jobId) {
  if (record.resultJobId === jobId || !item.result?.image) return;
  record.resultJobId = jobId;
  record.resultFormat = item.result.outputFormat || 'png';
  record.error = '';
  try {
    const response = await fetch(item.result.image);
    if (!response.ok) throw new Error('结果下载失败');
    record.resultBlob = await response.blob();
    record.resultUrl = '';
  } catch {
    record.resultUrl = item.result.image;
  }
}

function saveJobs() {
  saveJson(JOBS_KEY, jobs);
}

function setRecordStatus(imageIds, status, error = '') {
  for (const record of records.filter(item => imageIds.includes(item.imageId))) {
    record.status = status;
    record.error = error;
    persist(record);
  }
  renderCards();
}

async function pollJob(jobId) {
  if (polling.has(jobId) || !jobs[jobId]) return;
  polling.add(jobId);
  let misses = 0;
  try {
    while (jobs[jobId]) {
      let response;
      try { response = await fetch(`/api/batch/${encodeURIComponent(jobId)}`, { cache: 'no-store' }); }
      catch {
        await new Promise(resolve => setTimeout(resolve, 1800));
        continue;
      }
      if (response.status === 404 && misses++ < 3) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const imageIds = jobs[jobId]?.imageIds || [];
        delete jobs[jobId];
        saveJobs();
        setRecordStatus(imageIds, 'failed', data.error || '任务未创建，请重新提交。');
        setMessage(data.error || '上次上传未完成，原图已保留，可重新提交。', true);
        return;
      }
      const job = data.job;
      for (const item of job.items) {
        const record = records.find(entry => entry.imageId === item.imageId);
        if (!record) continue;
        record.status = item.status;
        if (item.status === 'failed') record.error = item.error || '处理失败';
        if (item.status === 'completed') await storeResult(record, item, jobId);
        await persist(record);
      }
      renderCards();
      setMessage(`处理中：${job.completed} / ${job.total} 已完成${job.failed ? `，${job.failed} 张失败` : ''}`);
      if (job.status === 'queued' || job.status === 'processing') {
        await new Promise(resolve => setTimeout(resolve, 1800));
        continue;
      }
      delete jobs[jobId];
      saveJobs();
      setMessage(job.status === 'completed' ? `处理完成：${job.completed} / ${job.total} 张。` : `处理结束：完成 ${job.completed} 张，失败 ${job.failed} 张。`, job.failed > 0);
      return;
    }
  } finally {
    polling.delete(jobId);
    submitButton.disabled = Object.keys(jobs).length > 0;
  }
}

async function submitJob(targetRecords, prompt) {
  if (!targetRecords.length) return;
  const jobId = crypto.randomUUID();
  jobs[jobId] = { imageIds: targetRecords.map(record => record.imageId) };
  saveJobs();
  setRecordStatus(jobs[jobId].imageIds, 'queued');
  submitButton.disabled = true;
  setMessage(targetRecords.length > 1 ? `正在上传 ${targetRecords.length} 张照片…` : '正在上传并重新处理这张照片…');

  const body = new FormData();
  targetRecords.forEach(record => body.append('images', record.file, record.name));
  body.append('jobId', jobId);
  body.append('imageIds', JSON.stringify(jobs[jobId].imageIds));
  body.append('model', document.querySelector('#model').value);
  body.append('quality', document.querySelector('#quality').value);
  body.append('size', document.querySelector('#size').value);
  body.append('prompt', prompt);
  body.append('upscale8k', document.querySelector('#upscale8k').checked ? 'on' : '');
  body.append('temporaryApiKey', document.querySelector('#temporaryApiKey').value);

  try {
    const response = await fetch('/api/batch', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
    await pollJob(jobId);
  } catch (error) {
    setMessage(`${error.message || '上传响应中断'}，正在尝试恢复任务…`, true);
    await pollJob(jobId);
  }
}

async function resetBatch() {
  releaseObjectUrls();
  try { await clearImages(); }
  catch (error) { console.error(error); }
  records = [];
  jobs = {};
  saveJobs();
  imageInput.value = '';
  renderCards();
  setMessage('已新建空白批次。');
}

imageInput.addEventListener('change', async () => {
  const files = [...imageInput.files].filter(file => /^image\/(png|jpe?g|webp)$/i.test(file.type)).slice(0, 10);
  if (!files.length) return setMessage('没有读取到支持的照片，请选择 PNG、JPG 或 WEBP。', true);
  await resetBatch();
  records = files.map((file, order) => ({ imageId: crypto.randomUUID(), order, name: file.name, type: file.type, lastModified: file.lastModified, file, prompt: '', resultBlob: null, resultUrl: '', status: 'ready', error: '' }));
  for (const record of records) await persist(record);
  renderCards();
  setMessage(`已保存 ${records.length} 张照片，刷新页面也不会丢失。`);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!records.length) return setMessage('请至少上传一张照片。', true);
  saveSettings();
  await submitJob(records, promptInput.value.trim() || presets.cinema);
});

document.querySelector('#newBatch').addEventListener('click', () => {
  if (records.length || Object.keys(jobs).length) resetDialog.showModal();
  else resetBatch();
});
resetDialog.addEventListener('close', () => {
  if (resetDialog.returnValue === 'confirm') resetBatch();
});
for (const element of form.querySelectorAll('#model,#quality,#size,#prompt,#upscale8k')) element.addEventListener('change', saveSettings);
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-preset]').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
  button.classList.add('active');
  button.setAttribute('aria-pressed', 'true');
  promptInput.value = presets[button.dataset.preset];
  saveSettings();
  setMessage(`已载入“${button.textContent.trim()}”提示词。`);
}));

if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  photoGrid.addEventListener('pointermove', event => {
    const card = event.target.closest('.photoCard');
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    card.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
    card.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
  });
}

async function initialize() {
  restoreSettings();
  fetch('/api/status').then(response => response.json()).then(data => {
    statusEl.textContent = data.hasOpenAIKey ? '服务已就绪' : 'OpenAI Key 未配置';
    statusEl.className = `status ${data.hasOpenAIKey ? 'ok' : 'warn'}`;
  }).catch(() => { statusEl.textContent = '服务状态异常'; statusEl.className = 'status warn'; });
  try {
    records = (await readImages()).sort((a, b) => a.order - b.order);
    renderCards();
    if (records.length) setMessage(`已恢复 ${records.length} 张照片。`);
    for (const jobId of Object.keys(jobs)) pollJob(jobId);
  } catch (error) {
    console.error(error);
    setMessage('浏览器存储不可用，刷新恢复功能暂不可用。', true);
  }
}

initialize();
