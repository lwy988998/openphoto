import sharp from 'sharp';

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));

// AI 只提供已有纹理的细节候选；成品始终使用原图的颜色、构图和透明度。
export async function enhanceTo4K(source, candidate) {
  const metadata = await sharp(source).metadata();
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const originalWidth = rotated ? metadata.height : metadata.width;
  const originalHeight = rotated ? metadata.width : metadata.height;
  const edge = process.env.NODE_ENV === 'test' ? 256 : 3840;
  const scale = Math.max(1, edge / Math.max(originalWidth, originalHeight));
  const width = Math.round(originalWidth * scale), height = Math.round(originalHeight * scale);
  const [base, candidateSmall] = await Promise.all([source, candidate].map(buffer =>
    sharp(buffer).rotate().resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer()));
  const difference = base.reduce((sum, value, index) => sum + Math.abs(value - candidateSmall[index]), 0) / base.length;
  if (difference > 30) throw new Error('AI 增强结果与原图差异过大，已保留原图。');
  let matched = 0, total = 0;
  for (let y = 1; y < 63; y += 1) for (let x = 1; x < 63; x += 1) {
    const i = y * 64 + x;
    const edgeAmount = Math.abs(base[i + 1] - base[i - 1]) + Math.abs(base[i + 64] - base[i - 64]);
    if (edgeAmount < 24) continue;
    total += 1;
    if (Math.abs(candidateSmall[i + 1] - candidateSmall[i - 1]) + Math.abs(candidateSmall[i + 64] - candidateSmall[i - 64]) >= edgeAmount * .45) matched += 1;
  }
  if (total > 24 && matched / total < .55) throw new Error('AI 增强轮廓与原图不一致，已保留原图。');
  const sourceImage = sharp(source).rotate().resize(width, height, { fit: 'fill' }).png();
  const aiImage = sharp(candidate).rotate().resize(width, height, { fit: 'fill' }).png();
  const [original, originalBlur, detail, detailBlur] = await Promise.all([
    sharp(await sourceImage.toBuffer()).ensureAlpha().raw().toBuffer(),
    sharp(source).rotate().resize(width, height, { fit: 'fill' }).blur(2.5).removeAlpha().raw().toBuffer(),
    sharp(await aiImage.toBuffer()).removeAlpha().raw().toBuffer(),
    sharp(candidate).rotate().resize(width, height, { fit: 'fill' }).blur(2.5).removeAlpha().raw().toBuffer(),
  ]);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const o = pixel * 4, d = pixel * 3;
    const texture = Math.max(Math.abs(original[o] - originalBlur[d]),
      Math.abs(original[o + 1] - originalBlur[d + 1]), Math.abs(original[o + 2] - originalBlur[d + 2]));
    const gain = .85 * Math.min(1, Math.max(0, (texture - 3) / 4));
    for (let c = 0; c < 3; c += 1) original[o + c] = clamp(original[o + c]
      + gain * ((detail[d + c] - detailBlur[d + c]) - (original[o + c] - originalBlur[d + c])));
  }
  return { output: await sharp(original, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    metadata: { originalWidth, originalHeight, width, height, upscaled: scale > 1, aiEnhanced: true, aiPasses: 1 } };
}
