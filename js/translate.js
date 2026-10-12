// Translates recognized text between English and Indian languages.
//
// 1. On-device: the browser's built-in Translator API (current Chrome and Edge on desktop).
//    The text never leaves the device; the browser downloads each language pair once.
// 2. Online fallback, only after the user explicitly asks for it: the free MyMemory API
//    (translated.net). The text is sent to their servers, so the UI says so first.

export const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['kn', 'Kannada'],
  ['ml', 'Malayalam'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['pa', 'Punjabi'],
  ['ur', 'Urdu'],
];
export const LANGUAGE_NAME = Object.fromEntries(LANGUAGES);

// Tesseract language codes -> BCP 47, used when the source language can't be detected.
const OCR_TO_BCP47 = {
  eng: 'en', hin: 'hi', tam: 'ta', tel: 'te', kan: 'kn', mal: 'ml', ben: 'bn', mar: 'mr', guj: 'gu',
  pan: 'pa', urd: 'ur',
};

const MYMEMORY_MAX_BYTES = 480; // the API rejects queries over 500 bytes

/** Rejects (or resolves to `fallback`) if `promise` takes longer than `ms`. */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (fallback !== undefined ? resolve(fallback) : reject(new Error('timeout'))), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export function onDeviceAvailable() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

/** Best guess at the text's language: browser detector, else the first OCR language. */
export async function detectLanguage(text, ocrLangs) {
  if ('LanguageDetector' in self) {
    try {
      // Only use the detector if its model is already on the device; never wait on a download.
      const ready = await withTimeout(self.LanguageDetector.availability(), 3000, 'unavailable');
      if (ready !== 'available') throw new Error('detector not ready');
      const detector = await withTimeout(self.LanguageDetector.create(), 3000);
      const [top] = await withTimeout(detector.detect(text.slice(0, 3000)), 3000);
      detector.destroy?.();
      const code = top && top.confidence >= 0.5 ? normalise(top.detectedLanguage) : null;
      if (code && LANGUAGE_NAME[code]) return code;
    } catch { /* fall through */ }
  }
  return OCR_TO_BCP47[ocrLangs?.[0]] || 'en';
}

function normalise(code) {
  return code.split('-')[0];
}

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' */
export async function onDeviceStatus(source, target) {
  if (!onDeviceAvailable()) return 'unavailable';
  try {
    // Some browsers expose the API but never answer; treat a slow answer as "not available".
    return await withTimeout(self.Translator.availability({ sourceLanguage: source, targetLanguage: target }), 6000, 'unavailable');
  } catch {
    return 'unavailable';
  }
}

/** Splits OCR output into paragraphs (blank-line separated) and joins wrapped lines. */
function paragraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
}

const translators = new Map();

export async function translateOnDevice(text, source, target, onProgress) {
  const key = `${source}>${target}`;
  let translator = translators.get(key);
  if (!translator) {
    const controller = new AbortController();
    try {
      translator = await withTimeout(self.Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
        signal: controller.signal,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => onProgress?.('Downloading language model', e.loaded ?? 0));
        },
      }), 120000);
    } catch (err) {
      controller.abort();
      throw new Error(err?.message === 'timeout'
        ? 'The on-device language model didn’t finish downloading. Try again later, or use online translation.'
        : (err?.message || 'On-device translation could not start.'));
    }
    translators.set(key, translator);
  }
  const parts = paragraphs(text);
  const out = [];
  for (const [i, p] of parts.entries()) {
    onProgress?.('Translating on this device', i / parts.length);
    out.push(await withTimeout(translator.translate(p), 60000));
  }
  return out.join('\n\n');
}

export async function translateOnline(text, source, target, onProgress) {
  const from = source === 'auto' ? 'autodetect' : source;
  const to = target;
  const parts = paragraphs(text);
  const out = [];
  let done = 0;
  const total = parts.reduce((n, p) => n + chunks(p).length, 0);
  for (const p of parts) {
    const pieces = [];
    for (const chunk of chunks(p)) {
      onProgress?.('Translating online (MyMemory)', done / total);
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(`${from}|${to}`)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`The translation service returned HTTP ${res.status}.`);
      const data = await res.json();
      if (data.quotaFinished) throw new Error('The free online translation limit for today has been reached. Try again tomorrow.');
      if (Number(data.responseStatus) !== 200) throw new Error(data.responseDetails || 'The translation service rejected the request.');
      pieces.push(decodeEntities(data.responseData?.translatedText || ''));
      done++;
    }
    out.push(pieces.join(' '));
  }
  return out.join('\n\n');
}

/** Splits a paragraph into sentence-ish pieces under the API's byte limit. */
function chunks(paragraph) {
  const enc = new TextEncoder();
  const fits = (s) => enc.encode(s).length <= MYMEMORY_MAX_BYTES;
  if (fits(paragraph)) return [paragraph];
  const sentences = paragraph.match(/[^.!?।॥۔]+[.!?।॥۔]*\s*/g) || [paragraph];
  const result = [];
  let current = '';
  for (const s of sentences) {
    if (fits(current + s)) { current += s; continue; }
    if (current) result.push(current.trim());
    if (fits(s)) { current = s; continue; }
    // A single very long sentence: cut by words.
    current = '';
    for (const word of s.split(/(\s+)/)) {
      if (fits(current + word)) current += word;
      else { if (current.trim()) result.push(current.trim()); current = word; }
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function decodeEntities(s) {
  if (!/[&][#a-z0-9]+;/i.test(s)) return s;
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}
