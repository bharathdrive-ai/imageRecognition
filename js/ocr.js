// Thin wrapper around a single Tesseract.js worker.
// The engine (WASM core + language models) downloads from jsDelivr on first use
// and is cached in IndexedDB by Tesseract.js, so later runs start quickly.

const { createWorker } = window.Tesseract;

let worker = null;
let workerLangs = '';
let listener = null;      // progress callback for the job currently running
let queue = Promise.resolve();

const STATUS_LABELS = {
  'loading tesseract core': 'Loading OCR engine',
  'initializing tesseract': 'Starting OCR engine',
  'loading language traineddata': 'Downloading language data',
  'loaded language traineddata': 'Language data ready',
  'initializing api': 'Preparing recognizer',
  'initialized api': 'Recognizer ready',
  'recognizing text': 'Recognizing text',
};

function emit(m) {
  if (!listener) return;
  listener({
    label: STATUS_LABELS[m.status] || capitalize(m.status || 'Working'),
    status: m.status,
    progress: typeof m.progress === 'number' ? m.progress : 0,
  });
}

async function ensureWorker(langs) {
  const key = langs.join('+');
  if (worker && workerLangs === key) return worker;
  if (!worker) {
    worker = await createWorker(langs, 1, {
      logger: emit,
      errorHandler: (err) => console.error('Tesseract worker error:', err),
    });
  } else {
    await worker.reinitialize(langs, 1);
  }
  workerLangs = key;
  return worker;
}

/**
 * Recognize text on a canvas. Jobs are serialized because one worker handles one job at a time.
 * @returns {Promise<OcrResult>}
 */
export function recognize(canvas, settings, onProgress) {
  const job = queue.then(() => runJob(canvas, settings, onProgress));
  queue = job.catch(() => {});
  return job;
}

async function runJob(canvas, settings, onProgress) {
  listener = onProgress;
  const started = performance.now();
  try {
    const w = await ensureWorker(settings.langs);
    await w.setParameters({
      tessedit_pageseg_mode: String(settings.psm),
      tessedit_char_whitelist: settings.whitelist || '',
      preserve_interword_spaces: settings.preserveSpaces ? '1' : '0',
    });

    const options = { rotateAuto: !!settings.deskew };
    if (settings.rectangle) options.rectangle = settings.rectangle;

    const { data } = await w.recognize(canvas, options, { text: true, tsv: true, hocr: true, pdf: true });
    const words = parseTsv(data.tsv || '');
    return {
      text: fixIndicZero((data.text || '').replace(/\s+$/, '')),
      confidence: words.length ? Math.round(data.confidence) : 0,
      words,
      tsv: data.tsv || '',
      hocr: data.hocr || '',
      pdf: toBytes(data.pdf),
      rotateRadians: data.rotateRadians || 0,
      width: canvas.width,
      height: canvas.height,
      langs: settings.langs.slice(),
      ms: Math.round(performance.now() - started),
    };
  } finally {
    listener = null;
  }
}

export function isEngineLoaded() {
  return !!worker;
}

/**
 * Tesseract often reads the anusvara (the small circle nasal mark) as the script's digit
 * zero, which looks the same: Kannada ೦ for ಂ, Telugu ౦ for ం, Malayalam ൦ for ം,
 * Devanagari ० for ं. A real digit never follows a letter inside a word, so a "zero"
 * right after a letter of the same script is turned back into the anusvara.
 */
const ANUSVARA_FIXES = [
  [/(?<=[ऀ-॥])०/g, 'ं'], // Devanagari (Hindi, Marathi)
  [/(?<=[ఀ-౥])౦/g, 'ం'], // Telugu
  [/(?<=[ಀ-೥])೦/g, 'ಂ'], // Kannada
  [/(?<=[ഀ-൥])൦/g, 'ം'], // Malayalam
];

function fixIndicZero(s) {
  for (const [pattern, anusvara] of ANUSVARA_FIXES) s = s.replace(pattern, anusvara);
  return s;
}

/**
 * Tesseract TSV columns:
 * level page block par line word left top width height conf text
 * Level 5 rows are individual words.
 */
function parseTsv(tsv) {
  const words = [];
  for (const row of tsv.split('\n')) {
    const c = row.split('\t');
    if (c[0] !== '5' || c.length < 12) continue;
    const text = fixIndicZero(c.slice(11).join('\t').trim());
    const conf = Number(c[10]);
    if (!text || conf < 0) continue;
    words.push({
      text,
      confidence: Math.round(conf * 10) / 10,
      block: +c[2], paragraph: +c[3], line: +c[4],
      bbox: { x0: +c[6], y0: +c[7], x1: +c[6] + +c[8], y1: +c[7] + +c[9] },
    });
  }
  // Number lines globally (Tesseract restarts line numbers per paragraph).
  let lineNo = 0, prev = '';
  for (const w of words) {
    const k = `${w.block}.${w.paragraph}.${w.line}`;
    if (k !== prev) { lineNo++; prev = k; }
    w.lineNo = lineNo;
  }
  return words;
}

function toBytes(pdf) {
  if (!pdf) return null;
  if (pdf instanceof Uint8Array) return pdf;
  if (pdf instanceof ArrayBuffer || Array.isArray(pdf)) return new Uint8Array(pdf);
  return Uint8Array.from(Object.values(pdf)); // structured-clone fallback
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
