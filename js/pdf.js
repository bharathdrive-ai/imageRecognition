// Renders PDF pages to canvases so each page can be OCR'd like an image.
// pdf.js is only downloaded the first time someone adds a PDF.

const PDFJS_VERSION = '4.10.38';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;
const TARGET_WIDTH = 2200;   // ~250 dpi for A4/Letter, a good OCR resolution
const MAX_PAGES = 50;

let pdfjsPromise = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
}

/**
 * @param {File} file
 * @param {(done:number, total:number) => void} onPage
 * @returns {Promise<{pages: HTMLCanvasElement[], totalPages: number}>}
 */
export async function renderPdf(file, onPage) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const count = Math.min(doc.numPages, MAX_PAGES);
  const pages = [];
  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, TARGET_WIDTH / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    pages.push(canvas);
    onPage?.(i, count);
  }
  const totalPages = doc.numPages;
  await doc.destroy();
  return { pages, totalPages };
}
