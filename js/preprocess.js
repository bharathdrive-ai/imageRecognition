// Canvas-based image cleanup that runs before OCR.
// Tesseract does best on large, high-contrast, dark-on-light text, so these
// steps push the image in that direction.

const MAX_SIDE = 5000; // keep memory use sane for huge photos / upscaled scans

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draws `source` rotated by a multiple of 90 degrees onto a new canvas. */
export function rotateCanvas(source, degrees) {
  const d = ((degrees % 360) + 360) % 360;
  if (d === 0) return source;
  const swap = d === 90 || d === 270;
  const out = makeCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

export function resolveScale(width, height, setting) {
  const longest = Math.max(width, height);
  let scale = setting === 'auto' ? (longest < 1400 ? 2 : 1) : Number(setting) || 1;
  if (longest * scale > MAX_SIDE) scale = MAX_SIDE / longest;
  return scale;
}

/**
 * @param {HTMLCanvasElement} source  already-rotated base image
 * @param {{scale:string, gray:boolean, contrast:boolean, binarize:boolean, invert:boolean}} opts
 * @returns {HTMLCanvasElement}
 */
export function preprocess(source, opts) {
  const scale = resolveScale(source.width, source.height, opts.scale);
  const out = makeCanvas(source.width * scale, source.height * scale);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  // White underlay so transparent PNGs don't turn into black backgrounds.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);

  const needsPixels = opts.gray || opts.contrast || opts.binarize || opts.invert;
  if (!needsPixels) return out;

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const px = img.data;
  const n = px.length / 4;
  const toGray = opts.gray || opts.binarize;

  if (toGray) {
    for (let i = 0; i < px.length; i += 4) {
      const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = px[i + 1] = px[i + 2] = y;
    }
  }

  if (opts.contrast) {
    // Linear stretch between the 1st and 99th luminance percentiles.
    const hist = luminanceHistogram(px);
    const lo = percentile(hist, n, 0.01);
    const hi = percentile(hist, n, 0.99);
    if (hi - lo > 10) {
      const k = 255 / (hi - lo);
      for (let i = 0; i < px.length; i += 4) {
        px[i] = clamp((px[i] - lo) * k);
        px[i + 1] = clamp((px[i + 1] - lo) * k);
        px[i + 2] = clamp((px[i + 2] - lo) * k);
      }
    }
  }

  if (opts.binarize) {
    const t = otsuThreshold(luminanceHistogram(px), n);
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i] > t ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }

  if (opts.invert) {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 255 - px[i];
      px[i + 1] = 255 - px[i + 1];
      px[i + 2] = 255 - px[i + 2];
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

/** True when most of the image is dark — a hint that "Invert" will help. */
export function looksDark(source) {
  const s = makeCanvas(64, 64);
  const ctx = s.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 64, 64);
  const px = ctx.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return sum / (px.length / 4) < 90;
}

function luminanceHistogram(px) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    hist[(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0]++;
  }
  return hist;
}

function percentile(hist, total, p) {
  const target = total * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

function otsuThreshold(hist, total) {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = v; }
  }
  return threshold;
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
