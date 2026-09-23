// 暗金刻度只显示服务端确认的阶段，不推测百分比。
window.renderGoldProgress = (element, item, reference = false) => {
  if (!item) { element.hidden = true; return; }
  const steps = item.mode === 'local-repair'
    ? [['queued', '上传'], ['denoising', '降噪'], ['sharpening', '锐化'], ['finalizing', '导出']]
    : item.mode === 'ai-repair' ? [['queued', '上传'], ['styling', 'AI 清晰重建'], ['finalizing', '导出']]
      : reference ? [['queued', '上传'], ['analyzing', '解析氛围'], ['matching', '迁移风格'], ['finalizing', '生成结果']]
        : [['queued', '上传'], ['styling', 'AI 调色']];
  const stage = item.stage === 'finalizing' ? (reference || item.mode?.endsWith('-repair') ? 'finalizing' : 'styling')
    : item.stage || (item.status === 'queued' ? 'queued' : reference ? 'analyzing' : 'styling');
  const current = stage === 'completed' ? steps.length : Math.max(0, steps.findIndex(([id]) => id === stage));
  element.hidden = false;
  const rail = document.createElement('div');
  rail.className = 'goldRail';
  steps.forEach(([id, label], index) => {
    const node = document.createElement('span');
    node.className = `goldNode ${index < current ? 'done' : index === current ? 'active' : ''}`;
    node.textContent = `${String(index + 1).padStart(2, '0')}  ${label}`;
    rail.append(node);
  });
  const track = document.createElement('div');
  track.className = 'goldTrack';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', '已完成处理阶段');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(steps.length));
  track.setAttribute('aria-valuenow', String(current));
  track.setAttribute('aria-valuetext', `已完成 ${current} 个，共 ${steps.length} 个阶段`);
  const fill = document.createElement('div');
  fill.className = 'goldFill';
  fill.style.transform = `scaleX(${Math.min(1, current / steps.length)})`;
  track.append(fill);
  const detail = document.createElement('p');
  detail.className = 'goldDetail';
  const attempt = item.mode === 'ai-repair' && item.stage === 'styling' && item.detailTotal
    ? ` · 第 ${item.detailCompleted}/${item.detailTotal} 次处理` : '';
  detail.textContent = item.status === 'failed' ? `处理失败：${item.error || '请重试'}` :
    item.status === 'completed' ? '处理完成 · 可独立下载' : `当前：${steps[current]?.[1] || '准备中'}${attempt}`;
  element.replaceChildren(rail, track, detail);
};
