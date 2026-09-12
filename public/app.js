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
};

const form = document.querySelector('#editForm');
const imageInput = document.querySelector('#imageInput');
const originalPreview = document.querySelector('#originalPreview');
const resultPreview = document.querySelector('#resultPreview');
const promptInput = document.querySelector('#prompt');
const message = document.querySelector('#message');
const statusEl = document.querySelector('#status');
const download = document.querySelector('#downloadLink');
const debug = document.querySelector('#debug');

promptInput.value = presets.cinema;

fetch('/api/status')
  .then(r => r.json())
  .then(data => {
    statusEl.textContent = data.hasOpenAIKey ? 'OpenAI Key 已配置' : 'OpenAI Key 未配置，可临时输入';
    statusEl.className = `status ${data.hasOpenAIKey ? 'ok' : 'warn'}`;
  })
  .catch(() => {
    statusEl.textContent = '服务状态异常';
    statusEl.className = 'status warn';
  });

document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    promptInput.value = presets[btn.dataset.preset] || promptInput.value;
  });
});

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  originalPreview.src = URL.createObjectURL(file);
  resultPreview.removeAttribute('src');
  download.classList.remove('ready');
  debug.textContent = '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.className = 'message';
  message.textContent = '正在上传并调用 GPT 图像编辑模型，可能需要 30–180 秒...';
  resultPreview.classList.add('loading');
  download.classList.remove('ready');
  debug.textContent = '';
  const submit = form.querySelector('.submit');
  submit.disabled = true;

  try {
    const body = new FormData(form);
    const response = await fetch('/api/edit', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);

    resultPreview.src = data.image;
    download.href = data.image;
    download.classList.add('ready');
    message.textContent = '调色完成，可以预览和下载结果。';
    debug.textContent = data.usage ? `模型：${data.model}\nToken 用量：${JSON.stringify(data.usage, null, 2)}` : `模型：${data.model}`;
  } catch (err) {
    message.className = 'message error';
    message.textContent = err.message || '调色失败';
  } finally {
    resultPreview.classList.remove('loading');
    submit.disabled = false;
  }
});
