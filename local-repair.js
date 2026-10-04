import sharp from 'sharp';

const MAX_LUMA_DELTA = 16;
const ALIGNMENT_SIDE = 64;
const MIN_ALIGNMENT_SCORE = 0.5;
const ASPECT_TOLERANCE = 0.08;
const LOW_FREQUENCY_BLUR = 12;
const MIN_TILE_CONTEXT = 72;
const smoothstep = value => value * value * (3 - 2 * value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function resizeGreyCanvas(input, width, height) {
  const { data, info } = await sharp(input).rotate()
    .resize({ width, height, fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .toColourspace('srgb').greyscale().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(width * height);
  const left = Math.floor((width - info.width) / 2), top = Math.floor((height - info.height) / 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = clamp(x - left, 0, info.width - 1), sourceY = clamp(y - top, 0, info.height - 1);
    output[y * width + x] = data[sourceY * info.width + sourceX];
  }
  return output;
}

function edgeCorrelation(source, candidate, width, height, shiftX, shiftY) {
  let sourceMean = 0, candidateMean = 0, count = 0;
  const samples = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const otherX = x + shiftX, otherY = y + shiftY;
    if (otherX < 1 || otherX >= width - 1 || otherY < 1 || otherY >= height - 1) continue;
    const a = y * width + x, b = otherY * width + otherX;
    const sourceEdge = Math.abs(source[a] - source[a - 1]) + Math.abs(source[a] - source[a - width]);
    const candidateEdge = Math.abs(candidate[b] - candidate[b - 1]) + Math.abs(candidate[b] - candidate[b - width]);
    sourceMean += sourceEdge; candidateMean += candidateEdge; samples.push([sourceEdge, candidateEdge]); count++;
  }
  if (!count) return 0;
  sourceMean /= count; candidateMean /= count;
  let numerator = 0, sourceVariance = 0, candidateVariance = 0;
  for (const [sourceEdge, candidateEdge] of samples) {
    const sourceDelta = sourceEdge - sourceMean, candidateDelta = candidateEdge - candidateMean;
    numerator += sourceDelta * candidateDelta;
    sourceVariance += sourceDelta * sourceDelta;
    candidateVariance += candidateDelta * candidateDelta;
  }
  return numerator / Math.max(1, Math.sqrt(sourceVariance * candidateVariance));
}

export async function assessRepairCandidate(tile, candidate) {
  let metadata;
  try { metadata = await sharp(candidate).metadata(); } catch {
    return { accepted: false, reason: 'candidate-decode-failed', score: 0, shiftX: 0, shiftY: 0 };
  }
  if (!metadata.width || !metadata.height) {
    return { accepted: false, reason: 'candidate-dimensions-missing', score: 0, shiftX: 0, shiftY: 0 };
  }
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const candidateWidth = rotated ? metadata.height : metadata.width;
  const candidateHeight = rotated ? metadata.width : metadata.height;
  const candidateAspect = candidateWidth / candidateHeight;
  const geometry = { candidateWidth, candidateHeight, candidateAspect: Number(candidateAspect.toFixed(4)),
    tileAspect: Number((tile.width / tile.height).toFixed(4)) };
  const aspectError = Math.abs(Math.log(candidateAspect / (tile.width / tile.height)));
  if (!Number.isFinite(aspectError) || aspectError > ASPECT_TOLERANCE) {
    return { accepted: false, reason: 'candidate-aspect-mismatch', score: 0, shiftX: 0, shiftY: 0,
      aspectError: Number(aspectError.toFixed(4)), ...geometry };
  }
  const [sourceGrey, candidateGrey] = await Promise.all([
    resizeGreyCanvas(tile.source, ALIGNMENT_SIDE, ALIGNMENT_SIDE),
    resizeGreyCanvas(candidate, ALIGNMENT_SIDE, ALIGNMENT_SIDE),
  ]);
  let best = { score: -1, shiftX: 0, shiftY: 0 };
  let centeredScore = 0;
  for (let shiftY = -2; shiftY <= 2; shiftY++) for (let shiftX = -2; shiftX <= 2; shiftX++) {
    const score = edgeCorrelation(sourceGrey, candidateGrey, ALIGNMENT_SIDE, ALIGNMENT_SIDE, shiftX, shiftY);
    if (shiftX === 0 && shiftY === 0) centeredScore = score;
    if (score > best.score) best = { score, shiftX, shiftY };
  }
  const misaligned = (Math.abs(best.shiftX) > 1 || Math.abs(best.shiftY) > 1)
    && best.score > centeredScore + .03;
  const accepted = best.score >= MIN_ALIGNMENT_SCORE && centeredScore >= MIN_ALIGNMENT_SCORE && !misaligned;
  return { accepted, reason: accepted ? 'accepted' : misaligned ? 'candidate-shifted' : 'alignment-confidence-low',
    ...best, centeredScore: Number(centeredScore.toFixed(4)), aspectError: Number(aspectError.toFixed(4)), ...geometry };
}

export async function makeRepairTiles(source) {
  const oriented = await sharp(source).rotate().toColourspace('srgb').png().toBuffer();
  const metadata = await sharp(oriented).metadata();
  if (!metadata.width || !metadata.height) throw new Error('原图尺寸无效。');
  const grids = [[3, 2], [2, 3], [6, 1], [1, 6]]
    .filter(([columns, rows]) => metadata.width >= columns && metadata.height >= rows);
  const { columns, rows } = grids.length
    ? grids.map(([columns, rows], order) => ({ columns, rows, order,
      score: Math.abs(Math.log((metadata.width / metadata.height) / (columns / rows))) }))
      .sort((a, b) => Math.abs(a.score - b.score) < 1e-9 ? a.order - b.order : a.score - b.score)[0]
    : { columns: 1, rows: 1 };
  if (columns === 1 && rows === 1) {
    const tile = { index: 0, row: 0, column: 0, left: 0, top: 0, width: metadata.width, height: metadata.height,
      fadeLeft: 0, fadeRight: 0, fadeTop: 0, fadeBottom: 0, source: oriented };
    return { oriented, width: metadata.width, height: metadata.height, columns, rows,
      tiles: Array.from({ length: 6 }, (_, index) => ({ ...tile, index })) };
  }
  const overlapX = Math.max(MIN_TILE_CONTEXT, Math.round(metadata.width / columns * .12));
  const overlapY = Math.max(MIN_TILE_CONTEXT, Math.round(metadata.height / rows * .12));
  const tiles = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const coreLeft = Math.round(column * metadata.width / columns);
    const coreRight = Math.round((column + 1) * metadata.width / columns);
    const coreTop = Math.round(row * metadata.height / rows);
    const coreBottom = Math.round((row + 1) * metadata.height / rows);
    const left = Math.max(0, coreLeft - overlapX), top = Math.max(0, coreTop - overlapY);
    const right = Math.min(metadata.width, coreRight + overlapX), bottom = Math.min(metadata.height, coreBottom + overlapY);
    tiles.push({ index: tiles.length, row, column, left, top, width: right - left, height: bottom - top,
      fadeLeft: coreLeft - left, fadeRight: right - coreRight, fadeTop: coreTop - top, fadeBottom: bottom - coreBottom,
      source: await sharp(oriented).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer() });
  }
  return { oriented, width: metadata.width, height: metadata.height, columns, rows, tiles };
}

async function buildTileLuminance(tile, candidate, confidence) {
  const [{ data: source, info }, candidateGrey] = await Promise.all([
    sharp(tile.source).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    resizeGreyCanvas(candidate, tile.width, tile.height),
  ]);
  const sourceGrey = await sharp(tile.source).greyscale().raw().toBuffer();
  const sourceStats = await sharp(sourceGrey, { raw: { width: tile.width, height: tile.height, channels: 1 } }).stats();
  const candidateStats = await sharp(candidateGrey, { raw: { width: tile.width, height: tile.height, channels: 1 } }).stats();
  const gain = clamp(sourceStats.channels[0].stdev / Math.max(1, candidateStats.channels[0].stdev), .7, 1.4);
  const matched = Buffer.alloc(candidateGrey.length);
  for (let i = 0; i < matched.length; i++) matched[i] = clamp(Math.round(
    (candidateGrey[i] - candidateStats.channels[0].mean) * gain + sourceStats.channels[0].mean), 0, 255);
  const raw = { width: tile.width, height: tile.height, channels: 1 };
  const [sourceLow, candidateLow] = await Promise.all([
    sharp(sourceGrey, { raw }).blur(LOW_FREQUENCY_BLUR).raw().toBuffer(),
    sharp(matched, { raw }).blur(LOW_FREQUENCY_BLUR).raw().toBuffer(),
  ]);
  const delta = new Int8Array(tile.width * tile.height), weight = new Uint8Array(tile.width * tile.height);
  for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
    const pixel = y * tile.width + x, offset = pixel * 4;
    const targetY = sourceLow[pixel] + matched[pixel] - candidateLow[pixel];
    const sourceY = sourceGrey[pixel];
    delta[pixel] = clamp(Math.round(targetY - sourceY), -MAX_LUMA_DELTA, MAX_LUMA_DELTA);
    const horizontal = Math.min(tile.fadeLeft ? smoothstep(Math.min(1, x / tile.fadeLeft)) : 1,
      tile.fadeRight ? smoothstep(Math.min(1, (tile.width - 1 - x) / tile.fadeRight)) : 1);
    const vertical = Math.min(tile.fadeTop ? smoothstep(Math.min(1, y / tile.fadeTop)) : 1,
      tile.fadeBottom ? smoothstep(Math.min(1, (tile.height - 1 - y) / tile.fadeBottom)) : 1);
    weight[pixel] = Math.round(255 * confidence * horizontal * vertical);
  }
  return { delta, weight, width: info.width, height: info.height };
}

// 原片保留色度和低频明暗；AI 只提供经过配准、限幅、归一化融合的亮度细节。
export async function mergeRepairTiles(source, prepared, candidates) {
  if (prepared.tiles.length !== candidates.length) throw new Error('AI 分块数量不完整。');
  const { data: pixels, info } = await sharp(prepared.oriented).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const deltaSum = new Int16Array(prepared.width * prepared.height);
  const weightSum = new Uint16Array(prepared.width * prepared.height);
  const fallbackIndexes = [], tileDiagnostics = [];
  for (let index = 0; index < prepared.tiles.length; index++) {
    const tile = prepared.tiles[index];
    let alignment;
    try {
      alignment = candidates[index] ? await assessRepairCandidate(tile, candidates[index])
        : { accepted: false, reason: 'candidate-missing', score: 0, shiftX: 0, shiftY: 0 };
    } catch {
      alignment = { accepted: false, reason: 'candidate-decode-failed', score: 0, shiftX: 0, shiftY: 0 };
    }
    if (alignment.accepted) {
      try {
        const confidence = clamp(.5 + ((alignment.centeredScore - MIN_ALIGNMENT_SCORE) / (1 - MIN_ALIGNMENT_SCORE)) * .5, .5, 1);
        const detail = await buildTileLuminance(tile, candidates[index], confidence);
        for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
          const local = y * tile.width + x;
          const global = (tile.top + y) * prepared.width + tile.left + x;
          const weighted = detail.delta[local] * detail.weight[local];
          deltaSum[global] += weighted;
          weightSum[global] += detail.weight[local];
        }
      } catch {
        alignment = { ...alignment, accepted: false, reason: 'candidate-processing-failed' };
      }
    }
    tileDiagnostics.push({ index, width: tile.width, height: tile.height, ...alignment });
    if (!alignment.accepted) { fallbackIndexes.push(index); continue; }
  }
  for (let y = 0; y < prepared.height; y++) for (let x = 0; x < prepared.width; x++) {
    const pixel = y * prepared.width + x, offset = pixel * 4;
    if (!weightSum[pixel]) continue;
    const min = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const max = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const bounded = clamp(Math.round(deltaSum[pixel] / weightSum[pixel]), -MAX_LUMA_DELTA, MAX_LUMA_DELTA);
    const safe = clamp(bounded, -min, 255 - max);
    pixels[offset] += safe; pixels[offset + 1] += safe; pixels[offset + 2] += safe;
  }
  const output = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 6 }).toBuffer();
  return { output, width: prepared.width, height: prepared.height, tileTotal: prepared.tiles.length,
    fallbackIndexes, fallbackCount: fallbackIndexes.length, tileDiagnostics,
    colorLockMode: 'source-chroma-ai-luminance-tiles' };
}

// 保持原图色差：仅对 R/G/B 加同一个受限亮度增量，绝不重绘或放大。
export async function repairPhoto(source, { denoise = 30, sharpen = 25, onStage = () => {} } = {}) {
  if (![denoise, sharpen].every(value => Number.isInteger(value) && value >= 0 && value <= 100)) {
    throw new Error('降噪和锐化强度必须为 0 到 100 的整数。');
  }
  onStage('denoising');
  const oriented = await sharp(source).rotate().toColourspace('srgb').png().toBuffer();
  const { data: pixels, info } = await sharp(oriented).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const grey = await sharp(oriented).greyscale().raw().toBuffer();
  const smooth = denoise || sharpen ? await sharp(oriented).greyscale().blur(0.9).raw().toBuffer() : grey;
  const count = info.width * info.height;
  const changes = new Int8Array(count);
  onStage('sharpening');
  for (let i = 0; i < count; i++) {
    const y = grey[i];
    const x = i % info.width;
    const gradient = Math.max(x ? Math.abs(y - grey[i - 1]) : 0,
      i >= info.width ? Math.abs(y - grey[i - info.width]) : 0);
    const residual = y - smooth[i];
    const noiseWeight = Math.max(0, 1 - gradient / 28);
    const denoiseDelta = -residual * denoise / 100 * 0.82 * noiseWeight;
    const sharpenDelta = Math.abs(residual) < 3 ? 0
      : residual * sharpen / 100 * 0.62 * Math.min(1, gradient / 16);
    changes[i] = Math.round(Math.max(-8, Math.min(8, denoiseDelta + sharpenDelta)));
  }
  // 消除因局部处理造成的全图曝光偏移。
  const mean = changes.reduce((sum, value) => sum + value, 0) / count;
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    const [r, g, b] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    const delta = Math.max(-Math.min(r, g, b), Math.min(255 - Math.max(r, g, b), Math.round(changes[i] - mean)));
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] += delta;
  }
  onStage('finalizing');
  const output = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 6 }).toBuffer();
  return { output, width: info.width, height: info.height };
}
