const presets = {
  cinema: `电影绿金色彩分级：使用深邃而干净的绿色阴影、克制的暖金高光、清澈蓝色与准确肤色。提升动态范围和局部层次，加入轻微底片颗粒；整体浓郁但不过饱和，避免橙黄偏色。`,
  sparkle: `阳光闪耀质感：增强原图已有阳光与高光区域的微小镜面闪耀、柔和光晕和金色层次，过渡自然且强度克制；不创建新的粒子、光源或背景元素。`,
  hdr: `自然 Smart HDR：恢复高光与暗部细节，提升局部对比和清晰度，保持准确肤色、中性阴影与干净天空；避免光圈感、过度锐化和不自然的 HDR 边缘。`,
  portra: `Kodak Portra 400 风格：柔和高光、自然暖肤色、克制的粉绿互补、宽容动态范围、柔和对比和细腻底片颗粒；避免过黄、过饱和与塑料肤质。`,
  digicam: `2000 年代 CCD 卡片机质感：清爽蓝色、稍高对比、细小数字噪点与轻微高光溢出；仅依据原图光照加强克制直闪感，保持真实随拍气息。`,
  alexa: `ARRI Alexa 35 色彩参考：柔和高光滚降、准确肤色、克制暖中间调、干净暗部、宽广动态范围和细腻局部对比，呈现自然高级的商业电影摄影质感。`,
  blockbuster: `大片海报色彩分级：深邃青绿阴影、温暖金色高光、清晰肤色和较强但不生硬的反差；保留高光细节并加入轻微胶片颗粒，避免过度橙黄与过饱和。`,
  japanese: `日系清透写真：明亮干净、柔和低对比、清新蓝绿色阴影、通透高光和自然白皙肤色；减少脏灰杂色并保留真实皮肤纹理。`,
  hongkong: `港风电影调色：温暖钨丝灯色、克制的霓虹红绿互补、浓郁但有细节的阴影、柔和暗角与细腻颗粒，呈现真实九十年代港片剧照质感；避免肤色发黄。`,
  korean: `韩系高级写真：干净奶油高光、柔和低饱和、自然透亮肤色、轻微粉米色氛围与柔和阴影；弱化杂乱色彩并完整保留皮肤纹理。`,
  fuji: `Fuji Classic Chrome / Pro 400H 风格：低饱和高级色彩、柔和绿色、克制蓝色、自然肤色、温和对比与细腻颗粒；高光不过曝，暗部不死黑。`,
  cinestill: `CineStill 800T 夜景风格：钨丝灯暖色、冷色阴影、真实胶片颗粒与柔和反差；只在原图已有灯光边缘加入轻微红橙 halation，避免肤色过红或扩散成新光源。`,
  polaroid: `宝丽来即时成像质感：柔和清晰度、奶油高光、轻微褪色、温暖白平衡、浅颗粒和克制暗角，呈现自然生活化相纸观感；不额外添加相框。`,
  disposable: `一次性胶片快照：略高对比、轻微高光过曝、青绿色阴影、明显但细腻的颗粒与自然直闪观感；闪光只作用于原图已有受光关系，不新增红眼或反光。`,
  cleanCommercial: `社交清亮：轻微提亮、清洁背景杂色、自然肤色、通透阴影和适度鲜活色彩；保持手机直出的轻松感，不使用重滤镜。`,
  moodyForest: `森林电影感：深邃湿润的绿色、柔和冷阴影、温暖日光高光和细腻空气层次；肤色保持准确并隔离绿色污染，避免压暗过度或奇幻化。`,
  summer: `夏日清爽胶片：明亮自然光、清澈蓝色、鲜活但不过饱和的绿色、自然肤色、柔和高光和轻微颗粒，整体轻盈通透。`,
  nightFlash: `夜晚直闪相机质感：基于原图受光关系增强主体亮度，保持背景略暗、肤色真实、冷暖分离、轻微高光反射和细小噪点；避免舞台灯式强光。`,
  vintageDV: `复古 DV / 早期数码质感：轻微低动态范围、柔和锐度、细小数字噪点、微弱色散与克制高光溢出，色调可轻偏蓝绿或暖黄；不添加时间戳。`,
  portraitNatural: `自然人像后期：准确肤色、柔和阴影、自然局部对比与克制眼神光，完整保留毛孔和皮肤纹理；避免过度磨皮、液化或美颜质感。`,
  blackGold: `黑金电影调色：干净深色背景、克制暖金高光、中性偏冷阴影和较强但保留细节的对比；肤色不发黄，暗部不压死，不新增光效。`,
  editorialPortrait: `杂志肖像：中性精准肤色、雕塑感明暗、克制饱和度与利落层次；突出服装材质和面部轮廓，呈现高级时装编辑质感。`,
  cinematicPortrait: `电影肖像：柔和肤色、冷暖分离、深邃透明的阴影与细腻高光滚降；加入极轻胶片颗粒，保持真实皮肤和情绪张力。`,
  studioBeauty: `棚拍美学：纯净白平衡、通透肤色、平滑但有纹理的明暗过渡、干净背景色和精致高光；避免塑料磨皮和过度锐化。`,
  goldenHourPortrait: `黄金人像：温暖但不过黄的肤色、蜂蜜色高光、柔和逆光层次与中性阴影；只增强原图已有暖光，保持自然空气感。`,
  lowKeyPortrait: `低调肖像：压低环境亮度并保留暗部细节，以克制暖高光勾勒面部和轮廓；肤色准确、黑位干净，避免死黑。`,
  softWindowPortrait: `窗光人像：柔和中性侧光、细腻肤色渐变、奶油高光和自然低对比；强调安静通透的室内氛围并保留皮肤纹理。`,
  blackWhitePortrait: `黑白肖像：中性灰阶、清晰肤色明度分离、柔和高光和有层次的深黑；用克制颗粒增强经典银盐质感。`,
  documentaryNeutral: `纪实本色：校准白平衡与曝光，恢复高光、阴影和现场固有色；保持自然对比与真实颗粒，不制造戏剧化光效。`,
  streetStory: `街头叙事：稍强局部对比、克制饱和度、干净阴影和明确冷暖关系；保留城市环境色与瞬间感。`,
  familyMemory: `家庭记忆：温暖中间调、柔和对比、自然肤色、轻微褪色与细腻颗粒；保留室内混合光的生活感。`,
  travelDocumentary: `旅行纪实：准确环境色、通透空气层次、自然天空与植被、适度局部对比和轻微胶片颗粒；兼顾人物肤色与地点真实感。`,
  landscapeNatural: `自然风光：校准天空、植被和岩石的固有色，恢复高光与暗部层次，增强空气透视和微对比；真实通透且不过饱和。`,
  goldenLandscape: `金色时刻：增强原图已有暖阳、金色高光与长阴影层次，维持中性暗部和自然天空；避免整体泛黄或虚构光线。`,
  blueHour: `蓝调时刻：深邃钴蓝天空、冷静环境色、克制暖灯对比、干净暗部和柔和高光；保持低照度现场的真实层次。`,
  mountainClarity: `山野通透：增强远近层次、岩石纹理和清洁空气感，天空蓝与植被绿保持自然；对比清晰但不产生 HDR 光边。`,
  oceanTeal: `海岸青蓝：准确分离海水青绿、天空蓝与沙滩暖色，增强水面高光和通透层次；避免荧光蓝绿和过度去雾。`,
  autumnFilm: `秋日胶片：温暖琥珀叶色、克制红橙饱和度、柔和青灰阴影、宽容高光与细腻颗粒；不让画面整体染黄。`,
  snowMinimal: `冰雪极简：准确雪地白平衡、干净冷白高光、淡蓝阴影和柔和层次；保留雪面纹理，避免偏紫与过曝。`,
  nightLandscape: `夜景风光：压制色彩噪点，恢复灯光高光和建筑暗部，保持冷暖光源分离与清晰黑位；避免新增星芒和灯光。`,
  tealOrange: `青橙电影：以克制青色阴影衬托自然暖肤色，保持中性高光、清晰黑位和稳重反差；避免橙脸与青色污染。`,
  noir: `黑色电影：低饱和近黑白色调、硬朗但保留细节的明暗分区、深黑与银灰高光、极轻颗粒；不虚构烟雾光影。`,
  dreamFilm: `梦境胶片：柔和粉紫高光、淡青阴影、低对比、轻微辉光和细腻颗粒；效果只作用于已有亮部，保持克制真实。`,
  freshYouth: `青春清透：明亮曝光、干净白平衡、自然透亮肤色、清新蓝绿与柔和低对比；保留皮肤纹理和生活气息。`,
  campus: `校园日光：自然晴日色温、清澈天空、柔和绿色、明亮肤色与轻微胶片颗粒；整体轻快但不过曝。`,
  cafeDaily: `咖啡日常：温暖木色与奶油高光、柔和室内阴影、自然肤色和低强度颗粒；保留窗边混合光与安静氛围。`,
  picnic: `野餐暖调：清新草地绿、柔和暖阳、自然肤色、浅色高光与轻微胶片颗粒；避免绿色染肤和整体橙黄。`,
  cityPop: `城市流行：清亮蓝色、活力洋红点缀、干净高光和稍强对比，呈现现代街头青春感；色彩鲜明但不荧光。`,
  pastelDaily: `粉彩日常：柔和粉、蓝、米色调，低对比奶油高光和清透阴影；保持肤色自然，不让画面发灰。`,
  partyFlash: `派对直闪：依据原图光线增强干净直闪、明亮主体、深色背景、冷暖反差和细小噪点；不新增灯具或红眼。`,
  repair4k: `请对输入的同一张照片进行一次超高清 4K 摄影细节修复，而不是重新生成、重新调色或重绘画面。严格锁定主体身份、五官、文字、物体边界、构图、相机角度、原有色彩、光线、影调、胶片颗粒、柔焦与抓拍动感；禁止新增、删除、替换或移动任何内容。仅改善原图确实存在的边缘、纹理与压缩损伤，提升局部解析力，呈现自然的 4K HDR 明暗层次与高光细节；不要凭空补造纹理、磨皮、过度锐化、加入光源、改变摄影质感或把画面改成 AI 艺术图。若清晰度与原片质感或真实性冲突，以原片为准；保留刻意拍摄的柔和、朦胧、颗粒和动感。输出应像同一张真实照片经过专业高清修复后的版本，不改变原图内容、色彩方向、构图和主体身份。`,
};

const preservationFramework = `将原始照片完整保持原样。绝对不要改变、新增、移除、替换、重新绘制或重新生成主体、脸部、五官、发型、服装、身体比例、姿势、手部、物体数量、构图、裁切、相机角度、透视、景别、背景物体、环境结构或画面边界。`;
const professionalFinish = `所有调整都必须依据原图已有的光线、颜色和材质自然完成，准确控制白平衡、曝光、色调曲线、高光、阴影、局部对比度、动态范围、纹理与颗粒。避免过度饱和、色阶断裂、脏灰暗部、高光溢出、塑料质感和人工滤镜痕迹。最终呈现同一张真实照片经过专业摄影后期后的完整成片，优先保证原图细节与身份一致，其次才是风格强度。`;
for (const key of Object.keys(presets)) presets[key] = `${preservationFramework}\n${presets[key]}\n${professionalFinish}`;

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
const goldProgress = document.querySelector('#goldProgress');
const callEstimate = document.querySelector('#callEstimate');
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

function createUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

  });
}

function restoreSettings() {
  const settings = loadJson(SETTINGS_KEY, {});
  for (const key of ['model', 'quality', 'size']) {
    const element = document.querySelector(`#${key}`);
    if (settings[key] && [...element.options].some(option => option.value === settings[key])) element.value = settings[key];
  }
  promptInput.value = settings.prompt || presets.portraitNatural;

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

function updateEstimate() {
  const count = records.length;
  callEstimate.textContent = `当前 ${count} 张，每张预计 1 次模型调用。`;
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
      ${record.resultInfo ? `<p class="resultInfo">${escapeHtml(record.resultInfo)}</p>` : ''}
      ${record.error && outputUrl ? `<p class="cardError" role="alert">${escapeHtml(record.error)}；旧结果已保留。</p>` : ''}
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
  if (record.resultJobId === jobId || !item.result?.image) return true;
  try {
    const response = await fetch(item.result.image);
    if (!response.ok) throw new Error('结果下载失败');
    const blob = await response.blob();
    record.resultBlob = blob;
    record.resultFormat = item.result.outputFormat || 'png';
    record.resultJobId = jobId;
    record.resultInfo = '';
    record.resultUrl = '';
    record.error = '';
    return true;
  } catch { record.error = '结果下载暂时失败，正在重试；旧结果已保留。'; return false; }
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
  let downloads = 0;
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
      let transferReady = true;
      for (const item of job.items) {
        const record = records.find(entry => entry.imageId === item.imageId);
        if (!record) continue;
        record.status = item.status;
        if (item.status === 'failed') record.error = item.error || '处理失败';
        if (item.status === 'completed' && !(await storeResult(record, item, jobId))) transferReady = false;
        await persist(record);
      }
      const current = job.items.find(item => item.status === 'processing') || job.items.at(-1);
      window.renderGoldProgress(goldProgress, current, false);
      renderCards();
      setMessage(`处理中：${job.completed} / ${job.total} 已完成${job.failed ? `，${job.failed} 张失败` : ''}`);
      if (job.status === 'queued' || job.status === 'processing') {
        await new Promise(resolve => setTimeout(resolve, 1800));
        continue;
      }
      if (!transferReady) {
        if (++downloads <= 3) { await new Promise(resolve => setTimeout(resolve, 1800)); continue; }
        delete jobs[jobId]; saveJobs();
        setMessage('结果下载连续失败，原图和旧结果已保留，请重新处理。', true);
        return;
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

  const jobId = createUuid();
  jobs[jobId] = { imageIds: targetRecords.map(record => record.imageId) };
  saveJobs();
  setRecordStatus(jobs[jobId].imageIds, 'queued');
  submitButton.disabled = true;
  setMessage(targetRecords.length > 1 ? `正在上传 ${targetRecords.length} 张照片…` : '正在上传并重新处理这张照片…');
  window.renderGoldProgress(goldProgress, { stage: 'queued', status: 'queued' }, false);

  const body = new FormData();
  targetRecords.forEach(record => body.append('images', record.file, record.name));
  body.append('jobId', jobId);
  body.append('imageIds', JSON.stringify(jobs[jobId].imageIds));
  body.append('model', document.querySelector('#model').value);
  body.append('quality', document.querySelector('#quality').value);
  body.append('size', document.querySelector('#size').value);
  body.append('prompt', prompt);

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
  goldProgress.hidden = true;
  updateEstimate();
  setMessage('已新建空白批次。');
}

imageInput.addEventListener('change', async () => {
  const files = [...imageInput.files].filter(file => /^image\/(png|jpe?g|webp)$/i.test(file.type)).slice(0, 10);
  if (!files.length) return setMessage('没有读取到支持的照片，请选择 PNG、JPG 或 WEBP。', true);
  await resetBatch();
  records = files.map((file, order) => ({ imageId: createUuid(), order, name: file.name, type: file.type, lastModified: file.lastModified, file, prompt: '', resultBlob: null, resultUrl: '', status: 'ready', error: '' }));
  for (const record of records) await persist(record);
  renderCards();
  updateEstimate();
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
for (const element of form.querySelectorAll('#model,#quality,#size,#prompt')) element.addEventListener('change', () => { saveSettings(); updateEstimate(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-preset]').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
  button.classList.add('active');
  button.setAttribute('aria-pressed', 'true');
  promptInput.value = presets[button.dataset.preset];
  saveSettings();
  setMessage(`已载入“${button.textContent.trim()}”提示词。`);
}));
document.querySelectorAll('[data-preset-category]').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('[data-preset-category]').forEach(item => {
    const selected = item === tab;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-preset-panel]').forEach(panel => {
    panel.hidden = panel.dataset.presetPanel !== tab.dataset.presetCategory;
  });
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
  updateEstimate();
  fetch('/api/status').then(response => response.json()).then(data => {
    statusEl.textContent = data.hasOpenAIKey ? '服务已就绪' : 'OpenAI Key 未配置';
    statusEl.className = `status ${data.hasOpenAIKey ? 'ok' : 'warn'}`;
  }).catch(() => { statusEl.textContent = '服务状态异常'; statusEl.className = 'status warn'; });
  try {
    records = (await readImages()).sort((a, b) => a.order - b.order);
    renderCards();
    updateEstimate();
    if (records.length) setMessage(`已恢复 ${records.length} 张照片。`);
    for (const jobId of Object.keys(jobs)) pollJob(jobId);
  } catch (error) {
    console.error(error);
    setMessage('浏览器存储不可用，刷新恢复功能暂不可用。', true);
  }
}

initialize();
