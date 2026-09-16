import sharp from 'sharp';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export async function makeMontage(source, reference) {
  const tile = async image => sharp(image).rotate().resize(768, 768, {
    fit: 'contain', background: '#222222',
  }).flatten({ background: '#222222' }).png().toBuffer();
  const [left, right] = await Promise.all([tile(source), tile(reference)]);
  const labels = Buffer.from('<svg width="1536" height="64"><rect width="1536" height="64" fill="#222"/><text x="24" y="43" fill="white" font-size="28">SOURCE PHOTO — keep content</text><text x="792" y="43" fill="white" font-size="28">REFERENCE — colors only</text></svg>');
  return sharp({ create: { width: 1536, height: 832, channels: 3, background: '#222222' } })
    .composite([{ input: labels, left: 0, top: 0 }, { input: left, left: 0, top: 64 }, { input: right, left: 768, top: 64 }])
    .png().toBuffer();
}

async function tonalStats(image) {
  const { data, info } = await sharp(image).rotate().resize(512, 512, { fit: 'inside' })
    .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const zones = Array.from({ length: 4 }, () => ({ count: 0, sum: [0, 0, 0], square: [0, 0, 0] }));
  for (let i = 0; i < data.length; i += info.channels) {
    const zone = luminance(data[i], data[i + 1], data[i + 2]) < 85 ? 0 : luminance(data[i], data[i + 1], data[i + 2]) < 170 ? 1 : 2;
    for (const index of [zone, 3]) {
      const entry = zones[index];
      entry.count += 1;
      for (let c = 0; c < 3; c += 1) {
        entry.sum[c] += data[i + c];
        entry.square[c] += data[i + c] * data[i + c];
      }
    }
  }
  return zones.map(entry => {
    const item = entry.count ? entry : zones[3];
    const mean = item.sum.map(sum => sum / item.count);
    return { mean, deviation: item.square.map((square, c) => Math.sqrt(Math.max(0, square / item.count - mean[c] ** 2))) };
  });
}

export async function gradeSource(source, candidate, strength, format) {
  if (!Number.isInteger(strength) || strength < 0 || strength > 100) throw new Error('调色强度应为 0 到 100。');
  const [from, to, raw] = await Promise.all([
    tonalStats(source), tonalStats(candidate),
    sharp(source).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const { data, info } = raw;
  const transform = Array.from({ length: 3 }, (_, zone) => Array.from({ length: 3 }, (_, c) => ({
    gain: clamp(to[zone].deviation[c] / Math.max(1, from[zone].deviation[c]), 0.72, 1.28),
    offset: clamp(to[zone].mean[c] - from[zone].mean[c], -75, 75),
  })));
  for (let i = 0; i < data.length; i += 4) {
    const brightness = luminance(data[i], data[i + 1], data[i + 2]);
    const low = clamp((128 - brightness) / 128, 0, 1);
    const high = clamp((brightness - 128) / 127, 0, 1);
    const mid = 1 - low - high;
    for (let c = 0; c < 3; c += 1) {
      const original = data[i + c];
      const mapped = [low, mid, high].reduce((sum, weight, zone) => {
        const { gain, offset } = transform[zone][c];
        return sum + weight * (original * gain + offset);
      }, 0);
      data[i + c] = clamp(Math.round(original + (mapped - original) * strength / 100), 0, 255);
    }
  }
  let output = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (format === 'jpeg') output = output.flatten({ background: '#ffffff' }).jpeg({ quality: 95 });
  else if (format === 'webp') output = output.webp({ quality: 95 });
  else output = output.png();
  return output.toBuffer();
}
