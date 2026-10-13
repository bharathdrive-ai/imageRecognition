import { makeCanvas, rotateCanvas, preprocess, looksDark } from './preprocess.js';
import { recognize, isEngineLoaded } from './ocr.js';
import { renderPdf } from './pdf.js';
import { download, baseName, toJson, combinedText } from './export.js';
import { driveConfigured, preloadDrive, importFromDrive } from './drive.js';
import {
  LANGUAGES as TR_LANGUAGES, LANGUAGE_NAME as TR_LANGUAGE_NAME, onDeviceAvailable, onDeviceStatus,
  detectLanguage, translateOnDevice, translateOnline,
} from './translate.js';

const LANGUAGES = [
  ['eng', 'English'], ['hin', 'Hindi'], ['tam', 'Tamil'], ['tel', 'Telugu'], ['kan', 'Kannada'],
  ['mal', 'Malayalam'], ['ben', 'Bengali'], ['mar', 'Marathi'], ['guj', 'Gujarati'], ['pan', 'Punjabi'],
  ['urd', 'Urdu'], ['ara', 'Arabic'], ['chi_sim', 'Chinese (Simplified)'], ['chi_tra', 'Chinese (Traditional)'],
  ['jpn', 'Japanese'], ['kor', 'Korean'], ['fra', 'French'], ['deu', 'German'], ['spa', 'Spanish'],
  ['ita', 'Italian'], ['por', 'Portuguese'], ['rus', 'Russian'],
];
const LANG_NAME = Object.fromEntries(LANGUAGES);
const MAX_LANGS = 3;
const SETTINGS_KEY = 'ocr-settings-v1';
const THEME_KEY = 'ocr-theme';

const $ = (id) => document.getElementById(id);
const el = {
  dropZone: $('dropZone'), fileInput: $('fileInput'), cameraInput: $('cameraInput'), sampleBtn: $('sampleBtn'), driveBtn: $('driveBtn'),
  fileList: $('fileList'), fileCount: $('fileCount'), emptyQueue: $('emptyQueue'), clearAllBtn: $('clearAllBtn'),
  langChips: $('langChips'), langSelect: $('langSelect'), psmSelect: $('psmSelect'), scaleSelect: $('scaleSelect'),
  optGray: $('optGray'), optContrast: $('optContrast'), optBinarize: $('optBinarize'), optInvert: $('optInvert'),
  optDeskew: $('optDeskew'), optSpaces: $('optSpaces'), whitelist: $('whitelist'), optAutoRun: $('optAutoRun'),
  searchInput: $('searchInput'), searchSummary: $('searchSummary'), searchResults: $('searchResults'),
  confThreshold: $('confThreshold'), confThresholdOut: $('confThresholdOut'),
  runAllBtn: $('runAllBtn'), runOneBtn: $('runOneBtn'),
  rotateLeftBtn: $('rotateLeftBtn'), rotateRightBtn: $('rotateRightBtn'), showBoxes: $('showBoxes'), clearRegionBtn: $('clearRegionBtn'),
  stageEmpty: $('stageEmpty'), canvasWrap: $('canvasWrap'), imageCanvas: $('imageCanvas'), overlayCanvas: $('overlayCanvas'),
  wordTip: $('wordTip'), progressBox: $('progressBox'), progressText: $('progressText'), progressPct: $('progressPct'), progressBar: $('progressBar'),
  imageMeta: $('imageMeta'), stats: $('stats'), statConf: $('statConf'), statWords: $('statWords'), statTime: $('statTime'),
  resultText: $('resultText'), wordsBody: $('wordsBody'), wordsEmpty: $('wordsEmpty'),
  copyBtn: $('copyBtn'), downloadBtn: $('downloadBtn'), downloadMenu: $('downloadMenu'),
  engineStatus: $('engineStatus'), themeToggle: $('themeToggle'), toast: $('toast'),
  trFrom: $('trFrom'), trTo: $('trTo'), trSwap: $('trSwap'), translateBtn: $('translateBtn'), trEngine: $('trEngine'),
  translationText: $('translationText'), translationMeta: $('translationMeta'),
};

const state = {
  items: [],
  activeId: null,
  view: 'original',
  langs: ['eng'],
  running: false,
  translating: false,
  autoQueue: [],        // files added while a batch was already running
  searchQuery: '',
  onlinePairs: new Set(), // language pairs the browser can't translate on-device
  highlight: -1,
};
let nextId = 1;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function readSettings() {
  return {
    langs: state.langs.slice(),
    psm: el.psmSelect.value,
    whitelist: el.whitelist.value.trim(),
    preserveSpaces: el.optSpaces.checked,
    deskew: el.optDeskew.checked,
    autoRun: el.optAutoRun.checked,
    pre: {
      scale: el.scaleSelect.value,
      gray: el.optGray.checked,
      contrast: el.optContrast.checked,
      binarize: el.optBinarize.checked,
      invert: el.optInvert.checked,
    },
  };
}

function saveSettings() {
  const s = readSettings();
  s.confThreshold = el.confThreshold.value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch { /* ignore */ }
  if (!s) return;
  if (Array.isArray(s.langs)) {
    const valid = s.langs.filter((l) => LANG_NAME[l]).slice(0, MAX_LANGS);
    if (valid.length) state.langs = valid;
  }
  if (s.psm) el.psmSelect.value = s.psm;
  el.whitelist.value = s.whitelist || '';
  el.optSpaces.checked = s.preserveSpaces !== false;
  el.optDeskew.checked = s.deskew !== false;
  el.optAutoRun.checked = s.autoRun !== false;
  if (s.pre) {
    el.scaleSelect.value = s.pre.scale || 'auto';
    el.optGray.checked = !!s.pre.gray;
    el.optContrast.checked = !!s.pre.contrast;
    el.optBinarize.checked = !!s.pre.binarize;
    el.optInvert.checked = !!s.pre.invert;
  }
  if (s.confThreshold) el.confThreshold.value = s.confThreshold;
}

function renderLanguages() {
  el.langChips.innerHTML = '';
  for (const code of state.langs) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = LANG_NAME[code];
    if (state.langs.length > 1) {
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', `Remove ${LANG_NAME[code]}`);
      x.onclick = () => {
        state.langs = state.langs.filter((l) => l !== code);
        renderLanguages();
        saveSettings();
      };
      chip.appendChild(x);
    }
    el.langChips.appendChild(chip);
  }
  const full = state.langs.length >= MAX_LANGS;
  el.langSelect.innerHTML = `<option value="">${full ? `Up to ${MAX_LANGS} languages` : '+ Add language…'}</option>` +
    LANGUAGES.filter(([c]) => !state.langs.includes(c)).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  el.langSelect.disabled = full;
}

/* ------------------------------------------------------------------ */
/* Adding files                                                        */
/* ------------------------------------------------------------------ */

async function addFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  let added = 0;
  const newItems = [];
  for (const file of list) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    try {
      if (isPdf) {
        showProgress('Reading PDF', 0);
        const { pages, totalPages } = await renderPdf(file, (done, total) => showProgress(`Reading PDF page ${done} of ${total}`, done / total));
        hideProgress();
        const stem = baseName(file.name);
        pages.forEach((canvas, i) => newItems.push(addItem(pages.length > 1 ? `${stem} · page ${i + 1}` : file.name, canvas)));
        added += pages.length;
        if (totalPages > pages.length) toast(`Only the first ${pages.length} of ${totalPages} pages were added.`);
      } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|avif|tiff?)$/i.test(file.name)) {
        newItems.push(addItem(file.name || 'pasted-image.png', await fileToCanvas(file)));
        added++;
      } else {
        toast(`${file.name} isn't an image or PDF.`);
      }
    } catch (err) {
      hideProgress();
      console.error(err);
      toast(`Couldn't open ${file.name || 'that file'}. ${isPdf ? 'The PDF may be encrypted or damaged.' : 'Your browser may not support this image format.'}`);
    }
  }
  if (added) {
    const active = activeItem();
    if (active && looksDark(active.base) && !el.optInvert.checked) {
      toast('This image looks dark. If the text is light, turn on "Invert colours".');
    }
    if (el.optAutoRun.checked && newItems.length) {
      if (state.running) state.autoQueue.push(...newItems);
      else runItems(newItems);
    }
  }
}

async function fileToCanvas(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  const canvas = makeCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

function addItem(name, canvas) {
  const item = {
    id: nextId++,
    name,
    source: canvas,
    rotation: 0,
    base: canvas,
    thumb: makeThumb(canvas),
    status: 'queued',
    progress: 0,
    message: '',
    result: null,
    editedText: null,
    translation: null,
    region: null,
    preview: null,
    previewKey: '',
  };
  state.items.push(item);
  state.activeId = item.id;
  renderAll();
  return item;
}

function makeThumb(canvas) {
  const t = makeCanvas(80, 80);
  const ctx = t.getContext('2d');
  const s = Math.max(80 / canvas.width, 80 / canvas.height);
  const w = canvas.width * s, h = canvas.height * s;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 80, 80);
  ctx.drawImage(canvas, (80 - w) / 2, (80 - h) / 2, w, h);
  return t.toDataURL('image/jpeg', 0.75);
}

function makeSample() {
  const c = makeCanvas(1400, 820);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#1b1b1b';
  ctx.font = 'bold 54px Georgia, "Times New Roman", serif';
  ctx.fillText('Optical Character Recognition', 70, 120);
  ctx.font = '30px Georgia, "Times New Roman", serif';
  const lines = [
    'OCR converts pictures of text into editable, searchable',
    'characters. This tool runs the Tesseract engine directly in',
    'your browser, so scanned letters, receipts, screenshots and',
    'book pages are processed without uploading anything.',
  ];
  lines.forEach((l, i) => ctx.fillText(l, 70, 210 + i * 50));
  ctx.font = '600 28px Arial, Helvetica, sans-serif';
  ctx.fillText('Invoice No. 2026-1042', 70, 500);
  ctx.font = '28px Arial, Helvetica, sans-serif';
  ctx.fillText('Date: 12 October 2026', 70, 550);
  const row = (label, amount, y) => {
    ctx.textAlign = 'left';
    ctx.fillText(label, 70, y);
    ctx.textAlign = 'right';
    ctx.fillText(amount, 640, y);
  };
  row('Subtotal', '1,250.00', 610);
  row('Tax (18%)', '225.00', 660);
  ctx.fillRect(70, 685, 570, 2);
  ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
  row('Total Due', '1,475.00', 735);
  return c;
}

/* ------------------------------------------------------------------ */
/* Recognition                                                         */
/* ------------------------------------------------------------------ */

function previewKey(pre) {
  return JSON.stringify(pre);
}

async function recognizeItem(item) {
  const settings = readSettings();
  item.status = 'running';
  item.progress = 0;
  item.message = '';
  renderList();
  if (item.id === state.activeId) renderControls();

  const processed = preprocess(item.base, settings.pre);
  item.preview = processed;
  item.previewKey = previewKey(settings.pre);

  if (item.region) {
    const r = item.region;
    settings.rectangle = {
      left: Math.round(r.x * processed.width),
      top: Math.round(r.y * processed.height),
      width: Math.max(1, Math.round(r.w * processed.width)),
      height: Math.max(1, Math.round(r.h * processed.height)),
    };
  }

  try {
    const result = await recognize(processed, settings, (p) => {
      const recognizing = p.status === 'recognizing text';
      setEngine(recognizing ? 'busy' : 'loading', recognizing ? 'Recognizing' : p.label);
      item.progress = recognizing ? p.progress : 0;
      updateListStatus(item);
      if (item.id === state.activeId) showProgress(p.label, p.progress);
    });
    item.result = result;
    item.editedText = null;
    item.translation = null;
    item.status = 'done';
  } catch (err) {
    console.error(err);
    item.status = 'error';
    item.message = friendlyError(err);
    toast(`Recognition failed for ${item.name}: ${item.message}`);
  }
  setEngine(isEngineLoaded() ? 'ready' : 'error', isEngineLoaded() ? 'Engine ready' : 'Engine failed to load');
  if (item.id === state.activeId) hideProgress();
}

function friendlyError(err) {
  const msg = String(err?.message || err || 'Unknown error');
  if (/fetch|network|load/i.test(msg)) return 'Could not download the OCR engine or language data. Check your connection.';
  return msg;
}

async function runItems(items) {
  if (state.running || !items.length) return;
  state.running = true;
  renderControls();
  try {
    for (const item of items) {
      if (!state.items.includes(item)) continue; // removed while queued
      await recognizeItem(item);
      if (item.id === state.activeId) renderActive();
      else renderList();
      refreshSearch();
    }
  } finally {
    state.running = false;
    renderAll();
  }
  const done = items.filter((i) => i.status === 'done').length;
  if (items.length > 1) toast(`Recognized ${done} of ${items.length} files.`);
  if (state.autoQueue.length) {
    const next = state.autoQueue.splice(0).filter((i) => state.items.includes(i) && i.status !== 'done');
    if (next.length) runItems(next);
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const activeItem = () => state.items.find((i) => i.id === state.activeId) || null;

function renderAll() {
  renderList();
  renderActive();
}

function statusText(item) {
  switch (item.status) {
    case 'running': return item.progress ? `Recognizing… ${Math.round(item.progress * 100)}%` : 'Preparing…';
    case 'done': return `${item.result.words.length} words · ${item.result.confidence}% conf.`;
    case 'error': return 'Failed. Click Recognize to retry.';
    default: return 'Ready to recognize';
  }
}

function renderList() {
  el.fileList.innerHTML = '';
  for (const item of state.items) {
    const li = document.createElement('li');
    li.className = 'file-item' + (item.id === state.activeId ? ' active' : '');
    li.dataset.id = item.id;
    li.innerHTML = `
      <img alt="" src="${item.thumb}">
      <div style="min-width:0">
        <div class="file-name"></div>
        <div class="file-status ${item.status}"></div>
      </div>
      <button class="remove-btn" type="button" aria-label="Remove">×</button>`;
    li.querySelector('.file-name').textContent = item.name;
    li.querySelector('.file-name').title = item.name;
    li.querySelector('.file-status').textContent = statusText(item);
    li.onclick = (e) => {
      if (e.target.closest('.remove-btn')) return removeItem(item.id);
      if (state.activeId !== item.id) {
        state.activeId = item.id;
        state.highlight = -1;
        renderAll();
      }
    };
    el.fileList.appendChild(li);
  }
  el.fileCount.textContent = state.items.length;
  el.emptyQueue.hidden = state.items.length > 0;
  el.clearAllBtn.disabled = !state.items.length || state.running;
  el.runAllBtn.disabled = !state.items.length || state.running;
  el.runAllBtn.textContent = state.running ? 'Working…' : state.items.length > 1 ? `Recognize all (${state.items.length})` : 'Recognize all';
  refreshSearch();
}

function updateListStatus(item) {
  const node = el.fileList.querySelector(`[data-id="${item.id}"] .file-status`);
  if (node) {
    node.className = `file-status ${item.status}`;
    node.textContent = statusText(item);
  }
}

function removeItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item || item.status === 'running') return;
  state.items = state.items.filter((i) => i.id !== id);
  if (state.activeId === id) state.activeId = state.items.at(-1)?.id ?? null;
  renderAll();
}

function renderControls() {
  const item = activeItem();
  const busy = state.running;
  el.runOneBtn.disabled = !item || busy;
  el.rotateLeftBtn.disabled = el.rotateRightBtn.disabled = !item || busy;
  el.clearRegionBtn.hidden = !item?.region;
  el.runOneBtn.textContent = item?.region ? 'Recognize region' : 'Recognize';
  const hasResult = !!item?.result;
  el.copyBtn.disabled = !hasResult;
  el.downloadBtn.disabled = !state.items.some((i) => i.result);
  updateTranslateUI();
}

function displayCanvasFor(item) {
  if (state.view === 'processed') {
    const key = previewKey(readSettings().pre);
    if (!item.preview || item.previewKey !== key) {
      item.preview = preprocess(item.base, readSettings().pre);
      item.previewKey = key;
    }
    return item.preview;
  }
  return item.base;
}

function renderActive() {
  renderControls();
  const item = activeItem();
  el.stageEmpty.hidden = !!item;
  el.canvasWrap.hidden = !item;
  el.wordTip.hidden = true;
  if (!item) {
    el.imageMeta.textContent = '';
    renderResults(null);
    return;
  }

  const src = displayCanvasFor(item);
  const c = el.imageCanvas;
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  el.overlayCanvas.width = src.width;
  el.overlayCanvas.height = src.height;
  drawOverlay();

  const parts = [`${item.base.width} × ${item.base.height}px`];
  if (item.rotation) parts.push(`rotated ${item.rotation}°`);
  if (state.view === 'processed') parts.push(`processed at ${src.width} × ${src.height}px`);
  if (item.region) parts.push('region selected');
  if (item.result?.rotateRadians) parts.push(`straightened ${((item.result.rotateRadians * 180) / Math.PI).toFixed(1)}°`);
  el.imageMeta.textContent = `${item.name} · ${parts.join(' · ')}`;

  if (item.status === 'running') showProgress('Recognizing text', item.progress);
  else hideProgress();
  renderResults(item);
}

function confColor(conf) {
  const t = Number(el.confThreshold.value);
  const css = getComputedStyle(document.documentElement);
  if (conf < t) return css.getPropertyValue('--bad').trim();
  if (conf < Math.max(t + 20, 80)) return css.getPropertyValue('--warn').trim();
  return css.getPropertyValue('--good').trim();
}

/** Maps result-space coordinates (the processed image Tesseract saw) onto the displayed canvas. */
function resultTransform(item, ctx) {
  const r = item.result;
  const k = el.overlayCanvas.width / r.width;
  const cx = el.overlayCanvas.width / 2, cy = el.overlayCanvas.height / 2;
  ctx.translate(cx, cy);
  // Tesseract straightened the image before reading it; tilt the boxes back to match the original.
  if (r.rotateRadians) ctx.rotate(-r.rotateRadians);
  ctx.translate(-cx, -cy);
  ctx.scale(k, k);
}

function drawOverlay() {
  const item = activeItem();
  const o = el.overlayCanvas;
  const ctx = o.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, o.width, o.height);
  if (!item) return;
  const lw = Math.max(1.5, o.width / 700);

  if (item.result && el.showBoxes.checked) {
    ctx.save();
    resultTransform(item, ctx);
    const k = o.width / item.result.width;
    item.result.words.forEach((w, i) => {
      const { x0, y0, x1, y1 } = w.bbox;
      const color = confColor(w.confidence);
      ctx.globalAlpha = i === state.highlight ? 0.45 : 0.14;
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = (i === state.highlight ? lw * 2 : lw) / k;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    });
    ctx.restore();
  }

  const tokens = searchTokens();
  if (item.result && tokens.length) {
    ctx.save();
    resultTransform(item, ctx);
    const k = o.width / item.result.width;
    for (const w of item.result.words) {
      const word = w.text.toLocaleLowerCase();
      if (!tokens.some((t) => word.includes(t))) continue;
      const { x0, y0, x1, y1 } = w.bbox;
      const pad = 2 / k;
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = (lw * 1.6) / k;
      ctx.strokeRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
    }
    ctx.restore();
  }

  const reg = drag?.region || item.region;
  if (reg) {
    const x = reg.x * o.width, y = reg.y * o.height, w = reg.w * o.width, h = reg.h * o.height;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.beginPath();
    ctx.rect(0, 0, o.width, o.height);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    ctx.lineWidth = lw * 1.5;
    ctx.setLineDash([lw * 5, lw * 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}

function renderResults(item) {
  const r = item?.result;
  el.stats.classList.toggle('is-empty', !r);
  el.statConf.textContent = r ? `${r.confidence}%` : '–';
  el.statWords.textContent = r ? r.words.length.toLocaleString() : '–';
  el.statTime.textContent = r ? `${(r.ms / 1000).toFixed(1)}s` : '–';
  el.resultText.value = r ? (item.editedText ?? r.text) : '';
  el.resultText.placeholder = !item
    ? 'Recognized text will appear here. You can edit it before copying or downloading.'
    : item.status === 'running' ? 'Recognizing…'
    : item.status === 'error' ? `Recognition failed: ${item.message}`
    : r ? 'No text was found. Try a different page layout, upscaling, or "Invert colours".'
    : 'Click "Recognize" to extract text from this image.';

  const tr = item?.translation;
  el.translationText.value = tr ? tr.text : '';
  el.translationMeta.hidden = !tr;
  if (tr) {
    el.translationMeta.textContent = `${TR_LANGUAGE_NAME[tr.source] || tr.source} → ${TR_LANGUAGE_NAME[tr.target]} · ${tr.engine === 'device' ? 'translated on this device' : 'translated online via MyMemory'}`;
  }

  const t = Number(el.confThreshold.value);
  el.wordsBody.innerHTML = '';
  el.wordsEmpty.hidden = !!r?.words.length;
  if (!r) return;
  const frag = document.createDocumentFragment();
  r.words.forEach((w, i) => {
    const tr = document.createElement('tr');
    if (w.confidence < t) tr.className = 'low';
    tr.dataset.index = i;
    const color = confColor(w.confidence);
    tr.innerHTML = `<td>${i + 1}</td><td></td><td><span class="conf"><span class="conf-bar"><i style="width:${w.confidence}%;background:${color}"></i></span>${Math.round(w.confidence)}%</span></td><td>${w.lineNo}</td>`;
    tr.children[1].textContent = w.text;
    frag.appendChild(tr);
  });
  el.wordsBody.appendChild(frag);
}

/* ------------------------------------------------------------------ */
/* Progress, engine status, toast                                      */
/* ------------------------------------------------------------------ */

function showProgress(label, p) {
  el.progressBox.hidden = false;
  el.progressText.textContent = label;
  const pct = Math.round((p || 0) * 100);
  el.progressPct.textContent = `${pct}%`;
  el.progressBar.style.width = `${pct}%`;
}
function hideProgress() {
  el.progressBox.hidden = true;
}

function setEngine(stateName, label) {
  el.engineStatus.dataset.state = stateName;
  el.engineStatus.querySelector('.label').textContent = label;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, Math.max(3800, msg.length * 65));
}

/* ------------------------------------------------------------------ */
/* Overlay interaction: region selection + word tooltips               */
/* ------------------------------------------------------------------ */

let drag = null;

function pointerToNorm(e) {
  const rect = el.overlayCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}

el.overlayCanvas.addEventListener('pointerdown', (e) => {
  if (!activeItem() || state.running || e.button !== 0) return;
  el.overlayCanvas.setPointerCapture(e.pointerId);
  drag = { start: pointerToNorm(e), region: null };
  el.wordTip.hidden = true;
});

el.overlayCanvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const p = pointerToNorm(e);
    const s = drag.start;
    drag.region = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    drawOverlay();
    return;
  }
  showWordTip(e);
});

el.overlayCanvas.addEventListener('pointerup', () => {
  if (!drag) return;
  const item = activeItem();
  const r = drag.region;
  drag = null;
  if (item && r && r.w > 0.01 && r.h > 0.01) {
    item.region = r;
    toast('Region selected. Click "Recognize region" to read just this area.');
  }
  renderActive();
});

el.overlayCanvas.addEventListener('pointerleave', () => { if (!drag) el.wordTip.hidden = true; });

function wordAt(e) {
  const item = activeItem();
  if (!item?.result || !el.showBoxes.checked) return -1;
  const rect = el.overlayCanvas.getBoundingClientRect();
  const o = el.overlayCanvas;
  // Pointer -> canvas pixels -> undo the overlay rotation -> result space.
  let x = ((e.clientX - rect.left) / rect.width) * o.width;
  let y = ((e.clientY - rect.top) / rect.height) * o.height;
  const a = item.result.rotateRadians || 0;
  if (a) {
    const cx = o.width / 2, cy = o.height / 2, dx = x - cx, dy = y - cy;
    x = cx + dx * Math.cos(a) - dy * Math.sin(a);
    y = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  const k = o.width / item.result.width;
  x /= k; y /= k;
  return item.result.words.findIndex(({ bbox: b }) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
}

function showWordTip(e) {
  const i = wordAt(e);
  if (i < 0) { el.wordTip.hidden = true; return; }
  const w = activeItem().result.words[i];
  const wrap = el.canvasWrap.getBoundingClientRect();
  el.wordTip.innerHTML = `<b></b> · ${Math.round(w.confidence)}%`;
  el.wordTip.firstChild.textContent = w.text;
  el.wordTip.style.left = `${e.clientX - wrap.left}px`;
  el.wordTip.style.top = `${e.clientY - wrap.top}px`;
  el.wordTip.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Search across all files                                             */
/* ------------------------------------------------------------------ */

const SNIPPETS_PER_FILE = 3;
const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escapeRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function searchTokens() {
  return state.searchQuery.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Words of the query, matched case-insensitively, with any run of whitespace between them. */
function searchPattern() {
  const tokens = state.searchQuery.trim().split(/\s+/).filter(Boolean);
  return tokens.length ? new RegExp(tokens.map(escapeRegex).join('\\s+'), 'giu') : null;
}

function snippet(text, index, length) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 50);
  const clean = (t) => escapeHtml(t.replace(/\s+/g, ' '));
  return `${start > 0 ? '… ' : ''}${clean(text.slice(start, index))}<mark>${clean(text.slice(index, index + length))}</mark>${clean(text.slice(index + length, end))}${end < text.length ? ' …' : ''}`;
}

function refreshSearch() {
  if (!el.searchResults) return;
  const keepScroll = el.searchResults.scrollTop;
  const recognized = state.items.filter((i) => i.result);
  const pending = state.items.filter((i) => !i.result && i.status !== 'running').length;
  const running = state.items.some((i) => i.status === 'running');
  const pendingNote = pending
    ? ` <b>${pending}</b> file${pending > 1 ? 's' : ''} not recognized yet. <button type="button" class="link-btn" data-search-run>Recognize all</button>`
    : running ? ' Still recognizing…' : '';
  el.searchResults.innerHTML = '';

  const pattern = searchPattern();
  if (!pattern) {
    el.searchSummary.innerHTML = !state.items.length
      ? 'Add one or more images, then search across all of their text.'
      : `Search the text of ${recognized.length} recognized file${recognized.length === 1 ? '' : 's'}.${pendingNote}`;
    return;
  }

  let total = 0;
  let filesHit = 0;
  for (const item of recognized) {
    const sources = [['text', currentText(item)]];
    if (item.translation?.text) sources.push(['translation', item.translation.text]);
    const hits = [];
    for (const [where, text] of sources) {
      for (const m of text.matchAll(pattern)) hits.push({ where, index: m.index, length: m[0].length, text });
    }
    if (!hits.length) continue;
    filesHit++;
    total += hits.length;

    const li = document.createElement('li');
    li.className = 'search-file';
    li.innerHTML = `<div class="search-file-head"><span></span><span class="count">${hits.length}</span></div>`;
    li.querySelector('.search-file-head span').textContent = item.name;
    for (const hit of hits.slice(0, SNIPPETS_PER_FILE)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'search-hit';
      b.innerHTML = `${hit.where === 'translation' ? '<span class="where">Translation</span>' : ''}${snippet(hit.text, hit.index, hit.length)}`;
      b.addEventListener('click', () => openSearchHit(item, hit));
      li.appendChild(b);
    }
    if (hits.length > SNIPPETS_PER_FILE) {
      const more = document.createElement('div');
      more.className = 'search-more';
      more.textContent = `+ ${hits.length - SNIPPETS_PER_FILE} more in this file`;
      li.appendChild(more);
    }
    el.searchResults.appendChild(li);
  }

  el.searchSummary.innerHTML = total
    ? `<b>${total}</b> match${total === 1 ? '' : 'es'} in <b>${filesHit}</b> of ${recognized.length} file${recognized.length === 1 ? '' : 's'}.${pendingNote}`
    : `No matches for “${escapeHtml(state.searchQuery.trim())}”.${pendingNote}`;
  el.searchResults.scrollTop = keepScroll;
}

/** Opens the file, selects the match in its text, and highlights matching words on the image. */
function openSearchHit(item, hit) {
  state.activeId = item.id;
  state.highlight = -1;
  renderAll();
  const tab = document.querySelector(`.tab[data-tab="${hit.where}"]`);
  if (tab && !tab.classList.contains('active')) tab.click();
  const area = hit.where === 'translation' ? el.translationText : el.resultText;
  area.blur();
  area.setSelectionRange(hit.index, hit.index + hit.length);
  area.focus({ preventScroll: true });
  // Put the selected line roughly in the middle of the textarea.
  const line = area.value.slice(0, hit.index).split('\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 22;
  area.scrollTop = Math.max(0, line * lineHeight - area.clientHeight / 2);
  if (window.innerWidth <= 720) document.querySelector('.tile-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initSearch() {
  let timer;
  el.searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.searchQuery = el.searchInput.value;
      refreshSearch();
      drawOverlay();
    }, 120);
  });
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.searchResults.querySelector('.search-hit')?.click(); }
    if (e.key === 'Escape') { el.searchInput.value = ''; state.searchQuery = ''; refreshSearch(); drawOverlay(); }
  });
  el.searchSummary.addEventListener('click', (e) => {
    if (!e.target.closest('[data-search-run]')) return;
    const pending = state.items.filter((i) => i.status !== 'done');
    if (pending.length) runItems(pending);
  });
  // "/" jumps to the search box from anywhere except text fields.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    el.searchInput.focus();
    el.searchInput.select();
  });
  refreshSearch();
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

function currentText(item) {
  return item.editedText ?? item.result.text;
}

const activeTab = () => document.querySelector('.tab.active')?.dataset.tab;

async function copyText() {
  const item = activeItem();
  if (!item?.result) return;
  const copyTranslation = activeTab() === 'translation' && item.translation;
  const text = copyTranslation ? item.translation.text : currentText(item);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    (copyTranslation ? el.translationText : el.resultText).select();
    document.execCommand('copy');
  }
  toast(copyTranslation ? 'Translation copied to clipboard.' : 'Text copied to clipboard.');
}

function exportAs(kind) {
  const item = activeItem();
  if (kind === 'all-txt') {
    download(combinedText(state.items), 'ocr-results.txt', 'text/plain;charset=utf-8');
    return;
  }
  if (!item?.result) return toast('Recognize this file first.');
  const stem = baseName(item.name);
  const r = item.result;
  switch (kind) {
    case 'txt': return download(currentText(item), `${stem}.txt`, 'text/plain;charset=utf-8');
    case 'json': return download(toJson(item, currentText(item)), `${stem}.json`, 'application/json');
    case 'tsv': return download(r.tsv, `${stem}.tsv`, 'text/tab-separated-values;charset=utf-8');
    case 'hocr': return download(r.hocr, `${stem}.hocr.html`, 'text/html;charset=utf-8');
    case 'pdf':
      if (!r.pdf?.length) return toast('A searchable PDF was not produced for this file.');
      return download(new Blob([r.pdf], { type: 'application/pdf' }), `${stem}-searchable.pdf`);
    case 'translation':
      if (!item.translation) return toast('Translate this file first.');
      return download(item.translation.text, `${stem}-${item.translation.target}.txt`, 'text/plain;charset=utf-8');
  }
}

function toggleMenu(open) {
  const show = open ?? el.downloadMenu.hidden;
  el.downloadMenu.hidden = !show;
  el.downloadBtn.setAttribute('aria-expanded', String(show));
  if (show) {
    const item = activeItem();
    el.downloadMenu.querySelectorAll('[data-export]').forEach((b) => {
      b.disabled = b.dataset.export === 'all-txt'
        ? !state.items.some((i) => i.result)
        : !item?.result
          || (b.dataset.export === 'pdf' && !item.result.pdf?.length)
          || (b.dataset.export === 'translation' && !item.translation);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Translate                                                           */
/* ------------------------------------------------------------------ */

const TRANSLATE_KEY = 'ocr-translate';

const ONLINE_PAIRS_KEY = 'ocr-online-pairs';
const ONLINE_PAIRS_DAYS = 7;

/** Remembers (for a week) that this browser can't translate a pair on-device, so it isn't retried on every visit. */
function markOnline(key) {
  state.onlinePairs.add(key);
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_PAIRS_KEY) || '{}');
    saved[key] = Date.now();
    localStorage.setItem(ONLINE_PAIRS_KEY, JSON.stringify(saved));
  } catch { /* ignore */ }
}

function loadOnlinePairs() {
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_PAIRS_KEY) || '{}');
    const cutoff = Date.now() - ONLINE_PAIRS_DAYS * 864e5;
    for (const [key, at] of Object.entries(saved)) if (at > cutoff) state.onlinePairs.add(key);
  } catch { /* ignore */ }
}

function pairKey() {
  return `${el.trFrom.value}>${el.trTo.value}`;
}

function usesOnline() {
  return !onDeviceAvailable() || state.onlinePairs.has(pairKey());
}

function initTranslate() {
  loadOnlinePairs();
  el.trFrom.innerHTML = '<option value="auto">Auto-detect</option>'
    + TR_LANGUAGES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  el.trTo.innerHTML = TR_LANGUAGES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(TRANSLATE_KEY) || 'null'); } catch { /* ignore */ }
  el.trFrom.value = saved?.from && (saved.from === 'auto' || TR_LANGUAGE_NAME[saved.from]) ? saved.from : 'auto';
  el.trTo.value = saved?.to && TR_LANGUAGE_NAME[saved.to] ? saved.to : 'ta';

  const remember = () => {
    try { localStorage.setItem(TRANSLATE_KEY, JSON.stringify({ from: el.trFrom.value, to: el.trTo.value })); } catch { /* ignore */ }
    updateTranslateUI();
  };
  el.trFrom.addEventListener('change', remember);
  el.trTo.addEventListener('change', remember);
  el.trSwap.addEventListener('click', () => {
    const from = el.trFrom.value;
    el.trFrom.value = el.trTo.value;
    el.trTo.value = from === 'auto' ? (el.trTo.value === 'en' ? 'ta' : 'en') : from;
    remember();
  });
  el.translateBtn.addEventListener('click', runTranslate);
  el.translationText.addEventListener('input', () => {
    const item = activeItem();
    if (item?.translation) item.translation.text = el.translationText.value;
  });
  updateTranslateUI();
}

function updateTranslateUI() {
  const item = activeItem();
  const hasText = !!(item?.result && currentText(item).trim());
  const online = usesOnline();
  el.translateBtn.disabled = !hasText || state.running || state.translating;
  el.translateBtn.textContent = state.translating ? 'Translating…' : online ? 'Translate online' : 'Translate';
  el.trEngine.classList.toggle('is-online', online);
  if (!onDeviceAvailable()) {
    el.trEngine.innerHTML = 'This browser has no built-in translator. <b>Translate online</b> sends the text to the free MyMemory service (translated.net); your image is not sent.';
  } else if (online) {
    el.trEngine.innerHTML = 'Your browser can’t translate this language pair on the device. <b>Translate online</b> sends the text to MyMemory (translated.net).';
  } else {
    el.trEngine.innerHTML = 'Runs <b>on this device</b> with your browser’s built-in translator. Each language pair downloads once.';
  }
}

async function runTranslate() {
  const item = activeItem();
  if (!item?.result || state.translating) return;
  const text = currentText(item).trim();
  if (!text) return toast('There is no text to translate.');

  const chosenFrom = el.trFrom.value;
  const target = el.trTo.value;
  const online = usesOnline();
  state.translating = true;
  updateTranslateUI();
  const progress = (label, p) => showProgress(label, p);
  progress(online ? 'Translating online (MyMemory)' : 'Preparing translation', 0);
  try {
    const source = chosenFrom === 'auto' ? await detectLanguage(text, item.result.langs) : chosenFrom;
    if (source === target) {
      toast(`The text already looks like ${TR_LANGUAGE_NAME[target]}. Pick a different target language.`);
      return;
    }
    let translated;
    if (online) {
      translated = await translateOnline(text, source, target, progress);
    } else {
      const status = await onDeviceStatus(source, target);
      if (status === 'unavailable') {
        markOnline(pairKey());
        toast(`On-device translation from ${TR_LANGUAGE_NAME[source] || source} to ${TR_LANGUAGE_NAME[target]} isn’t available in this browser. Use "Translate online" if you’re happy to send the text to MyMemory.`);
        return;
      }
      translated = await translateOnDevice(text, source, target, progress);
    }
    item.translation = { text: translated, source, target, engine: online ? 'online' : 'device' };
    refreshSearch();
    document.querySelector('.tab[data-tab="translation"]')?.click();
    toast(`Translated to ${TR_LANGUAGE_NAME[target]}.`);
  } catch (err) {
    console.error(err);
    if (!online && (err?.code === 'stalled' || err?.code === 'failed')) {
      // On-device translation can't run here right now: offer online translation for this pair.
      markOnline(pairKey());
      toast(`${err.message} Click “Translate online” to translate with MyMemory instead.`);
    } else if (err?.code === 'activation') {
      toast('Click Translate again to start the on-device language download.');
    } else {
      toast(/fetch|network/i.test(String(err?.message)) ? 'Could not reach the translation service. Check your connection.' : (err?.message || 'Translation failed.'));
    }
  } finally {
    state.translating = false;
    hideProgress();
    renderResults(activeItem());
    updateTranslateUI();
  }
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

const PALETTE_KEY = 'ocr-palette-v2';
const DEFAULT_PALETTE = 'ocean';
const PALETTES = [
  ['ocean', 'Ocean', 'linear-gradient(135deg, #06b6d4, #3b82f6, #6366f1)'],
  ['sunset', 'Sunset', 'linear-gradient(135deg, #fbbf24, #f97316, #db2777)'],
];

function applyPalette(name, remember) {
  const valid = PALETTES.some(([id]) => id === name) ? name : DEFAULT_PALETTE;
  document.documentElement.dataset.palette = valid;
  el.palettePicker?.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.palette === valid)));
  if (remember) {
    try { localStorage.setItem(PALETTE_KEY, valid); } catch { /* ignore */ }
  }
  drawOverlay();
}

function initPalette() {
  el.palettePicker = $('palettePicker');
  if (el.palettePicker) {
    for (const [id, label, swatch] of PALETTES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.palette = id;
      b.title = `${label} palette`;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${label} palette`);
      b.style.background = swatch;
      b.addEventListener('click', () => applyPalette(id, true));
      el.palettePicker.appendChild(b);
    }
  }
  // A ?palette= link wins (and is remembered), then the saved choice, then the default.
  const fromUrl = new URLSearchParams(location.search).get('palette');
  let saved = null;
  try { saved = localStorage.getItem(PALETTE_KEY); } catch { /* ignore */ }
  applyPalette(fromUrl || saved || DEFAULT_PALETTE, !!fromUrl);
}

function effectiveTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function init() {
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { /* ignore */ }
  initPalette();
  initTranslate();
  loadSettings();
  initSearch();
  el.confThresholdOut.textContent = el.confThreshold.value;
  renderLanguages();
  renderAll();

  el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });
  el.cameraInput.addEventListener('change', () => { addFiles(el.cameraInput.files); el.cameraInput.value = ''; });
  el.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
  });
  el.sampleBtn.addEventListener('click', () => {
    const item = addItem('sample.png', makeSample());
    runItems([item]);
  });

  // Google Drive: the button only shows when js/config.js has credentials.
  if (driveConfigured()) {
    el.driveBtn.hidden = false;
    // Fetch Google's scripts as soon as someone heads for the button, so the sign-in
    // pop-up can open within the click's user gesture.
    const warm = () => preloadDrive().catch(() => {});
    ['pointerenter', 'focus', 'touchstart'].forEach((ev) => el.driveBtn.addEventListener(ev, warm, { once: true, passive: true }));
    el.driveBtn.addEventListener('click', async () => {
      el.driveBtn.disabled = true;
      try {
        const { files, failed } = await importFromDrive((label, p) => showProgress(label, p));
        hideProgress();
        if (files.length) await addFiles(files);
        if (failed.length) toast(failed.length === 1 ? failed[0] : `${failed.length} files couldn't be downloaded from Drive.`);
      } catch (err) {
        hideProgress();
        console.error(err);
        if (!err.quiet) toast(err.message || 'Google Drive import failed.');
      } finally {
        el.driveBtn.disabled = false;
      }
    });
  }

  // Drag & drop anywhere on the page.
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++;
    el.dropZone.classList.add('drag');
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.dropZone.classList.remove('drag');
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.dropZone.classList.remove('drag');
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  // Paste screenshots from the clipboard.
  document.addEventListener('paste', (e) => {
    if (e.target === el.resultText || e.target === el.whitelist) return;
    const files = [...(e.clipboardData?.items || [])]
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter(Boolean)
      .map((f, n) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${n}.png`, { type: f.type })));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  el.clearAllBtn.addEventListener('click', () => {
    state.items = state.items.filter((i) => i.status === 'running');
    state.activeId = state.items[0]?.id ?? null;
    renderAll();
  });

  el.runOneBtn.addEventListener('click', () => { const it = activeItem(); if (it) runItems([it]); });
  el.runAllBtn.addEventListener('click', () => {
    const pending = state.items.filter((i) => i.status !== 'done');
    runItems(pending.length ? pending : state.items.slice());
  });

  const rotate = (delta) => {
    const item = activeItem();
    if (!item) return;
    item.rotation = (item.rotation + delta + 360) % 360;
    item.base = rotateCanvas(item.source, item.rotation);
    item.thumb = makeThumb(item.base);
    item.result = null;
    item.editedText = null;
    item.translation = null;
    item.region = null;
    item.preview = null;
    item.status = 'queued';
    renderAll();
  };
  el.rotateLeftBtn.addEventListener('click', () => rotate(-90));
  el.rotateRightBtn.addEventListener('click', () => rotate(90));
  el.clearRegionBtn.addEventListener('click', () => {
    const item = activeItem();
    if (item) { item.region = null; renderActive(); }
  });
  el.showBoxes.addEventListener('change', drawOverlay);

  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    renderActive();
  }));

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => {
      x.classList.toggle('active', x === t);
      x.setAttribute('aria-selected', String(x === t));
    });
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));

  el.wordsBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    state.highlight = Number(tr.dataset.index);
    el.showBoxes.checked = true;
    drawOverlay();
  });

  el.resultText.addEventListener('input', () => {
    const item = activeItem();
    if (item?.result) item.editedText = el.resultText.value;
    updateTranslateUI();
    refreshSearch();
  });

  // Settings
  el.langSelect.addEventListener('change', () => {
    const v = el.langSelect.value;
    if (v && !state.langs.includes(v) && state.langs.length < MAX_LANGS) state.langs.push(v);
    renderLanguages();
    saveSettings();
  });
  const preprocessingInputs = [el.scaleSelect, el.optGray, el.optContrast, el.optBinarize, el.optInvert];
  [...preprocessingInputs, el.psmSelect, el.optDeskew, el.optSpaces, el.whitelist, el.optAutoRun].forEach((input) =>
    input.addEventListener('change', () => {
      saveSettings();
      if (preprocessingInputs.includes(input) && state.view === 'processed') renderActive();
    }));
  el.confThreshold.addEventListener('input', () => {
    el.confThresholdOut.textContent = el.confThreshold.value;
    const item = activeItem();
    drawOverlay();
    renderResults(item);
  });
  el.confThreshold.addEventListener('change', saveSettings);

  // Exports
  el.copyBtn.addEventListener('click', copyText);
  el.downloadBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  el.downloadMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (!b || b.disabled) return;
    toggleMenu(false);
    exportAs(b.dataset.export);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) toggleMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleMenu(false);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && activeItem() && !state.running) runItems([activeItem()]);
  });

  el.themeToggle.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    drawOverlay();
  });
}

init();

// Handy for debugging from the console.
window.ocrApp = { state, addFiles, runItems };
