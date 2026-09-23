import sharp from 'sharp';

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));

// 保留 AI 生成的高频细节，同时把全局色彩、明暗和透明度匹配回原片。
export async function lockRepairColor(source, candidate) {
  const metadata = await sharp(candidate).metadata();
  if (!metadata.width || !metadata.height) throw new Error('AI 返回的图片尺寸无效。');
  const read = image => sharp(image).rotate().resize(metadata.width, metadata.height, { fit: 'fill' })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const [original, rebuilt] = await Promise.all([read(source), read(candidate)]);
  const count = metadata.width * metadata.height;
  const originalMean = [0, 0, 0], rebuiltMean = [0, 0, 0];
  const originalSquare = [0, 0, 0], rebuiltSquare = [0, 0, 0];
  let visible = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    if (!original[offset + 3]) continue;
    visible++;
    for (let channel = 0; channel < 3; channel++) {
      const a = original[offset + channel], b = rebuilt[offset + channel];
      originalMean[channel] += a; rebuiltMean[channel] += b;
      originalSquare[channel] += a * a; rebuiltSquare[channel] += b * b;
    }
  }
  if (!visible) throw new Error('原图没有可见像素。');
  const gain = originalMean.map((sum, channel) => {
    originalMean[channel] = sum / visible;
    rebuiltMean[channel] /= visible;
    const originalDeviation = Math.sqrt(Math.max(0, originalSquare[channel] / visible - originalMean[channel] ** 2));
    const rebuiltDeviation = Math.sqrt(Math.max(0, rebuiltSquare[channel] / visible - rebuiltMean[channel] ** 2));
    return Math.max(.5, Math.min(2, originalDeviation / Math.max(1, rebuiltDeviation)));
  });
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      rebuilt[offset + channel] = clamp((rebuilt[offset + channel] - rebuiltMean[channel]) * gain[channel] + originalMean[channel]);
    }
    rebuilt[offset + 3] = original[offset + 3];
  }
  const output = await sharp(rebuilt, { raw: { width: metadata.width, height: metadata.height, channels: 4 } })
    .sharpen({ sigma: .9, m1: 1, m2: .5, x1: 2, y2: 10, y3: 20 }).png().toBuffer();
  return { output, width: metadata.width, height: metadata.height };
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
