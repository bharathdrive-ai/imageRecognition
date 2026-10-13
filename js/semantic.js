// D. Search images by description ("receipt", "ID card", "handwritten note").
//
// MobileCLIP-S0 (Apple, via Transformers.js) turns images and text into 512-number vectors in
// the same space; the closer an image's vector is to the query's, the better it matches.
// Runs on the device. The model (~88 MB: full-precision vision encoder + 8-bit text encoder)
// downloads from Hugging Face once, after the user agrees, and is cached by the browser.
// (The 8-bit vision encoder was tested and ranks images almost randomly, so it isn't used.)

import { makeCanvas } from './preprocess.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm';
const MODEL_ID = 'Xenova/mobileclip_s0';
export const MODEL_SIZE_MB = 88;

let loading = null;
let parts = null;

export function clipLoaded() {
  return !!parts;
}

/** Downloads (first time) and initialises the model. onProgress(label, 0..1). */
export function loadClip(onProgress) {
  if (!loading) {
    loading = (async () => {
      const T = await import(TRANSFORMERS_URL);
      const files = {};
      const progress_callback = (p) => {
        if (p.status === 'progress' && p.file) {
          files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
          const loaded = Object.values(files).reduce((n, f) => n + f.loaded, 0);
          onProgress?.('Downloading the AI model (first time only)', Math.min(1, loaded / (MODEL_SIZE_MB * 1e6)));
        }
      };
      const [tokenizer, processor, textModel, visionModel] = await Promise.all([
        T.AutoTokenizer.from_pretrained(MODEL_ID),
        T.AutoProcessor.from_pretrained(MODEL_ID),
        T.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm', progress_callback }),
        T.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'wasm', progress_callback }),
      ]);
      parts = { T, tokenizer, processor, textModel, visionModel };
      return parts;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/** Normalised embedding of a canvas (shrunk first; the model works at 256px anyway). */
export async function embedImage(canvas) {
  const { T, processor, visionModel } = parts;
  const k = Math.min(1, 512 / Math.max(canvas.width, canvas.height));
  const small = makeCanvas(canvas.width * k, canvas.height * k);
  const ctx = small.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, small.width, small.height);
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const { image_embeds } = await visionModel(await processor(T.RawImage.fromCanvas(small)));
  return Float32Array.from(image_embeds.normalize().tolist()[0]);
}

export async function embedText(text) {
  const { tokenizer, textModel } = parts;
  const { text_embeds } = await textModel(tokenizer([text], { padding: 'max_length', truncation: true }));
  return Float32Array.from(text_embeds.normalize().tolist()[0]);
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
