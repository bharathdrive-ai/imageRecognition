// Search by image, entirely on the device.
//
// B. Duplicates: a 64-bit difference hash (dHash) per image. Two images whose hashes differ
//    in only a few bits are the same picture, even after resizing, recompression or light edits.
// C. A piece inside an image (logo, stamp, signature, photo): ORB features matched with a
//    RANSAC homography, which copes with scale and rotation; small or flat pieces with too few
//    features fall back to multi-scale template matching. Uses OpenCV.js, loaded on first use.

import { makeCanvas } from './preprocess.js';

// Two CDNs: if one download fails or arrives truncated, the other is tried.
const OPENCV_URLS = [
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js',
  'https://unpkg.com/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js',
];
const TARGET_MAX = 1100; // working size for searched images
const QUERY_MAX = 700;   // working size for the query
const DUPLICATE_BITS = 10; // hashes within this many differing bits = same image

/* ------------------------------------------------------------------ */
/* B. Perceptual hash                                                  */
/* ------------------------------------------------------------------ */

/** 64-bit difference hash as a BigInt: compare neighbouring pixels of a 9x8 greyscale thumbnail. */
export function dHash(canvas) {
  const c = makeCanvas(9, 8);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 9, 8);
  ctx.drawImage(canvas, 0, 0, 9, 8);
  const px = ctx.getImageData(0, 0, 9, 8).data;
  const grey = (x, y) => {
    const i = (y * 9 + x) * 4;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  };
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (grey(x, y) > grey(x + 1, y) ? 1n : 0n);
    }
  }
  return hash;
}

export function hammingDistance(a, b) {
  let v = a ^ b;
  let n = 0;
  while (v) { n += Number(v & 1n); v >>= 1n; }
  return n;
}

export function isDuplicate(a, b) {
  const d = hammingDistance(a, b);
  return { duplicate: d <= DUPLICATE_BITS, similarity: Math.round((1 - d / 64) * 100) };
}

/* ------------------------------------------------------------------ */
/* C. OpenCV                                                           */
/* ------------------------------------------------------------------ */

let cvReady = null;

/**
 * Loads OpenCV.js once. Note: the OpenCV module object is "thenable", so it must never be
 * used to resolve a promise (that recurses forever and freezes the page). We only wait for
 * onRuntimeInitialized and read window.cv afterwards.
 */
export function loadOpenCV() {
  if (!cvReady) {
    cvReady = (async () => {
      for (const url of OPENCV_URLS) {
        try {
          await loadOpenCVFrom(url);
          return true;
        } catch (err) {
          console.warn('OpenCV.js failed to load from', url, err);
        }
      }
      throw new Error('Could not download the image-matching engine (OpenCV.js). Check your connection and try again.');
    })().catch((err) => {
      cvReady = null; // allow a later retry instead of failing for the rest of the session
      throw err;
    });
  }
  return cvReady;
}

function loadOpenCVFrom(url) {
  return new Promise((resolve, reject) => {
    if (window.cv?.Mat) return resolve();
    // Remove a previous failed attempt (a truncated download leaves a broken script tag).
    document.querySelectorAll('script[data-opencv]').forEach((s) => s.remove());
    try { delete window.cv; } catch { window.cv = undefined; }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.dataset.opencv = '';
    const timer = setTimeout(() => reject(new Error('timed out')), 90000);
    const done = (fn, arg) => { clearTimeout(timer); fn(arg); };
    s.onerror = () => done(reject, new Error('download failed'));
    s.onload = () => {
      const m = window.cv;
      if (m && m.Mat) done(resolve);
      else if (m) m.onRuntimeInitialized = () => done(resolve);
      else done(reject, new Error('script did not start (incomplete download?)'));
    };
    document.head.appendChild(s);
  });
}

function scaled(canvas, max) {
  const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
  if (k === 1) return canvas;
  const c = makeCanvas(canvas.width * k, canvas.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

function greyMat(cv, canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = cv.matFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  const grey = new cv.Mat();
  cv.cvtColor(rgba, grey, cv.COLOR_RGBA2GRAY);
  rgba.delete();
  return grey;
}

/** Shoelace area of a polygon given as [[x,y],...]. */
function polygonArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function isConvex(p) {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % p.length];
    const [cx, cy] = p[(i + 2) % p.length];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross !== 0) {
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
  }
  return true;
}

/** Prepared query: computed once, reused for every searched image. Call .dispose() when done. */
export async function prepareQuery(queryCanvas) {
  await loadOpenCV();
  const cv = window.cv;
  const q = scaled(queryCanvas, QUERY_MAX);
  const grey = greyMat(cv, q);
  const orb = new cv.ORB(1000);
  const kp = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const none = new cv.Mat();
  orb.detectAndCompute(grey, none, kp, desc);
  none.delete();
  return {
    canvas: q,
    grey,
    orb,
    kp,
    desc,
    hash: dHash(queryCanvas),
    dispose() { grey.delete(); orb.delete(); kp.delete(); desc.delete(); },
  };
}

/**
 * Looks for the query inside `targetCanvas`.
 * @returns {{found: boolean, method?: string, score?: number, poly?: number[][]}}
 *   poly: the matched area's corners, as fractions (0-1) of the target's width/height.
 */
export function findInImage(query, targetCanvas) {
  const cv = window.cv;
  const t = scaled(targetCanvas, TARGET_MAX);
  const tGrey = greyMat(cv, t);
  try {
    const viaFeatures = query.kp.size() >= 12 ? matchFeatures(cv, query, tGrey, t) : null;
    if (viaFeatures?.found) return viaFeatures;
    return matchTemplateMultiScale(cv, query, tGrey, t);
  } finally {
    tGrey.delete();
  }
}

function matchFeatures(cv, query, tGrey, t) {
  const orb = new cv.ORB(3000);
  const kp = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const none = new cv.Mat();
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  const mats = [];
  try {
    orb.detectAndCompute(tGrey, none, kp, desc);
    if (desc.rows < 12 || query.desc.rows < 12) return { found: false };
    matcher.knnMatch(query.desc, desc, knn, 2);
    const src = [];
    const dst = [];
    for (let i = 0; i < knn.size(); i++) {
      const pair = knn.get(i);
      if (pair.size() < 2) { pair.delete?.(); continue; }
      const m = pair.get(0);
      const n = pair.get(1);
      pair.delete?.();
      if (m.distance < 0.75 * n.distance) {
        const a = query.kp.get(m.queryIdx).pt;
        const b = kp.get(m.trainIdx).pt;
        src.push(a.x, a.y);
        dst.push(b.x, b.y);
      }
    }
    const good = src.length / 2;
    if (good < 10) return { found: false, score: good };

    const srcMat = cv.matFromArray(good, 1, cv.CV_32FC2, src);
    const dstMat = cv.matFromArray(good, 1, cv.CV_32FC2, dst);
    const mask = new cv.Mat();
    mats.push(srcMat, dstMat, mask);
    const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 5, mask);
    mats.push(H);
    if (H.empty()) return { found: false, score: good };
    let inliers = 0;
    for (let i = 0; i < mask.rows; i++) if (mask.data[i]) inliers++;

    const w = query.canvas.width;
    const h = query.canvas.height;
    const corners = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const projected = new cv.Mat();
    mats.push(corners, projected);
    cv.perspectiveTransform(corners, projected, H);
    const poly = [];
    for (let i = 0; i < 4; i++) poly.push([projected.data32F[i * 2], projected.data32F[i * 2 + 1]]);

    // Reject degenerate or implausible shapes.
    const area = polygonArea(poly) / (t.width * t.height);
    const sane = isConvex(poly) && area > 0.0008 && area < 1.2
      && poly.every(([x, y]) => x > -0.25 * t.width && x < 1.25 * t.width && y > -0.25 * t.height && y < 1.25 * t.height);
    if (inliers < 12 || !sane) return { found: false, score: inliers };
    return {
      found: true,
      method: 'features',
      score: inliers,
      poly: poly.map(([x, y]) => [Math.min(1, Math.max(0, x / t.width)), Math.min(1, Math.max(0, y / t.height))]),
    };
  } finally {
    orb.delete(); kp.delete(); desc.delete(); none.delete(); matcher.delete(); knn.delete();
    mats.forEach((m) => m.delete());
  }
}

/** Best normalised-correlation hit of the query, scaled to each width ratio, in `grey`. */
function bestTemplate(cv, query, grey, ratios) {
  let best = { value: 0 };
  const aspect = query.canvas.height / query.canvas.width;
  for (const r of ratios) {
    const w = Math.round(grey.cols * r);
    const h = Math.round(aspect * w);
    if (w < 12 || h < 12 || w > grey.cols || h > grey.rows) continue;
    const resized = new cv.Mat();
    const result = new cv.Mat();
    try {
      cv.resize(query.grey, resized, new cv.Size(w, h), 0, 0, w < query.grey.cols ? cv.INTER_AREA : cv.INTER_LINEAR);
      cv.matchTemplate(grey, resized, result, cv.TM_CCOEFF_NORMED);
      const mm = cv.minMaxLoc(result);
      if (mm.maxVal > best.value) best = { value: mm.maxVal, ratio: r, x: mm.maxLoc.x, y: mm.maxLoc.y, w, h };
    } finally {
      resized.delete();
      result.delete();
    }
  }
  return best;
}

/**
 * Fallback for pieces with few features or a big size difference (e.g. a small logo pasted
 * into a page). Coarse pass: ~30 sizes on a reduced copy. Fine pass: sizes within ±12% of
 * the best one, at full working resolution.
 */
function matchTemplateMultiScale(cv, query, tGrey, t) {
  const coarseRatios = [];
  for (let r = 0.05; r <= 0.95; r *= 1.1) coarseRatios.push(r);

  const k = Math.min(1, 600 / Math.max(tGrey.cols, tGrey.rows));
  let coarseBest;
  if (k < 1) {
    const small = new cv.Mat();
    cv.resize(tGrey, small, new cv.Size(Math.round(tGrey.cols * k), Math.round(tGrey.rows * k)), 0, 0, cv.INTER_AREA);
    try { coarseBest = bestTemplate(cv, query, small, coarseRatios); } finally { small.delete(); }
  } else {
    coarseBest = bestTemplate(cv, query, tGrey, coarseRatios);
  }
  if (!coarseBest.ratio || coarseBest.value < 0.45) return { found: false, score: Math.round(coarseBest.value * 100) };

  const fineRatios = [];
  for (let f = 0.88; f <= 1.121; f += 0.03) fineRatios.push(coarseBest.ratio * f);
  const best = bestTemplate(cv, query, tGrey, fineRatios);
  if (best.value < 0.75) return { found: false, score: Math.round(best.value * 100) };
  const { x, y, w, h } = best;
  return {
    found: true,
    method: 'template',
    score: Math.round(best.value * 100),
    poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [px / t.width, py / t.height]),
  };
}
