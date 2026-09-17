import sharp from 'sharp';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export async function makeMontage(source, reference) {
  const tile = async image => sharp(image).rotate().resize(512, 512, {
    fit: 'contain', background: '#222222',
  }).flatten({ background: '#222222' }).png().toBuffer();
  const [left, right] = await Promise.all([tile(source), tile(reference)]);
  const labels = Buffer.from('<svg width="1024" height="64"><rect width="1024" height="64" fill="#222"/><text x="24" y="43" fill="white" font-size="26">SOURCE PHOTO — keep content</text><text x="536" y="43" fill="white" font-size="26">REFERENCE — overall mood</text></svg>');
  return sharp({ create: { width: 1024, height: 576, channels: 3, background: '#222222' } })
    .composite([{ input: labels, left: 0, top: 0 }, { input: left, left: 0, top: 64 }, { input: right, left: 512, top: 64 }])
    .png().toBuffer();
}

export async function makeStyleChart() {
  const svg = Buffer.from('<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#181818"/><stop offset="1" stop-color="#eee"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><rect x="36" y="70" width="185" height="154" fill="#666"/><rect x="290" y="70" width="185" height="154" fill="#aaa"/><circle cx="132" cy="353" r="67" fill="#f9f9f9"/><circle cx="376" cy="353" r="67" fill="#171717"/><path d="M256 0V512M0 256H512" stroke="#aaa" stroke-width="8"/></svg>');
  return sharp(svg).png().toBuffer();
}

async function textureMetrics(image) {
  const { data, info } = await sharp(image).rotate().resize(256, 256, { fit: 'fill' })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  let edgeX = 0, edgeY = 0, noise = 0, flat = 0, halo = 0, white = 0;
  for (let y = 1; y < 255; y += 1) for (let x = 1; x < 255; x += 1) {
    const i = y * 256 + x;
    const center = data[i * info.channels];
    const left = data[(i - 1) * info.channels], right = data[(i + 1) * info.channels];
    const top = data[(i - 256) * info.channels], bottom = data[(i + 256) * info.channels];
    const dx = Math.abs(left - right), dy = Math.abs(top - bottom);
    edgeX += dx; edgeY += dy;
    if (dx + dy < 42 && center > 35 && center < 230) { noise += Math.abs(center - (left + right + top + bottom) / 4); flat += 1; }
    if (center > 235 && x > 8 && x < 247 && y > 8 && y < 247) {
      white += 1;
      halo += [i - 8, i + 8, i - 2048, i + 2048]
        .filter(index => data[index * info.channels] > 130 && data[index * info.channels] < 235).length;
    }
  }
  return { edgeX: edgeX / 64516, edgeY: edgeY / 64516, noise: noise / Math.max(1, flat), halo: halo / Math.max(1, white) };
}

export async function analyzeAtmosphere(reference, exemplar, chart) {
  const [original, sample, neutral] = await Promise.all([reference, exemplar, chart].map(textureMetrics));
  const sampleEdge = sample.edgeX + sample.edgeY;
  const neutralEdge = neutral.edgeX + neutral.edgeY;
  const softness = clamp((1 - sampleEdge / Math.max(1, neutralEdge)) * 1.3, 0, 1);
  const grain = clamp((Math.min(original.noise, sample.noise) - 1.8) / 5, 0, 1);
  const glow = clamp((sample.halo - neutral.halo) * .6, 0, 1);
  const directionalShift = Math.log((sample.edgeX + 1) / (sample.edgeY + 1))
    - Math.log((neutral.edgeX + 1) / (neutral.edgeY + 1));
  const motion = softness > .1 ? clamp((Math.abs(directionalShift) - .035) * 2.5, 0, .6) : 0;
  const direction = directionalShift < 0 ? 'horizontal' : 'vertical';
  const signals = ['光影层次'];
  if (softness > .15) signals.push('柔焦');
  if (motion > .1) signals.push('抓拍动感');
  if (grain > .12) signals.push('胶片颗粒');
  if (glow > .12) signals.push('高光漫射');
  return { softness, grain, glow, motion, direction, signals };
}

export async function applyAtmosphere(image, profile, strength, format) {
  if (strength === 0 || (!profile.softness && !profile.motion && !profile.grain && !profile.glow)) {
    if (format === 'jpeg') return sharp(image).flatten({ background: '#fff' }).jpeg({ quality: 95 }).toBuffer();
    if (format === 'webp') return sharp(image).webp({ quality: 95 }).toBuffer();
    return image;
  }
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const intensity = strength / 100;
  const scale = Math.max(.3, Math.max(info.width, info.height) / 2048);
  const softMix = profile.softness * intensity * .55;
  const motionMix = profile.motion * intensity * .26;
  const glowMix = profile.glow * intensity * .22;
  const grain = profile.grain * intensity * 8;
  const blur = softMix ? await sharp(image).blur(Math.max(.8, 1.7 * scale)).ensureAlpha().raw().toBuffer() : null;
  const smear = motionMix ? await sharp(image).convolve(profile.direction === 'horizontal'
    ? { width: 5, height: 3, kernel: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], scale: 5 }
    : { width: 3, height: 5, kernel: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], scale: 5 }).ensureAlpha().raw().toBuffer() : null;
  let glow = null;
  if (glowMix) {
    const highlights = Buffer.alloc(info.width * info.height);
    for (let i = 0; i < highlights.length; i += 1) {
      const offset = i * 4;
      highlights[i] = clamp(Math.round(luminance(data[offset], data[offset + 1], data[offset + 2]) - 175) * 3, 0, 255);
    }
    glow = await sharp(highlights, { raw: { width: info.width, height: info.height, channels: 1 } })
      .blur(Math.max(.3, 7 * scale)).raw().toBuffer();
  }
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const offset = pixel * 4;
    const x = pixel % info.width, y = Math.floor(pixel / info.width);
    const noise = grain ? ((Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 16) / 65535 * 2 - 1 : 0;
    for (let c = 0; c < 3; c += 1) {
      const base = data[offset + c];
      data[offset + c] = clamp(Math.round(base * (1 - softMix - motionMix)
        + (blur ? blur[offset + c] * softMix : 0)
        + (smear ? smear[offset + c] * motionMix : 0)
        + (glow ? glow[pixel] * glowMix : 0) + noise * grain), 0, 255);
    }
  }
  let output = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (format === 'jpeg') output = output.flatten({ background: '#fff' }).jpeg({ quality: 95 });
  else if (format === 'webp') output = output.webp({ quality: 95 });
  else output = output.png();
  return output.toBuffer();
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
  if (!Number.isInteger(strength) || strength < 0 || strength > 100) throw new Error('风格强度应为 0 到 100。');
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
