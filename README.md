# Image Text Recognition (OCR)

A browser-based OCR tool that extracts text from images and PDFs using [Tesseract.js](https://github.com/naptha/tesseract.js) 7.
Everything runs on the user's device. Files are never uploaded; only the OCR engine and language models are downloaded from a CDN (and cached after first use).

**Live:** [imagesearcheasy.vercel.app](https://imagesearcheasy.vercel.app/) (Vercel) · [bharathdrive-ai.github.io/imageRecognition](https://bharathdrive-ai.github.io/imageRecognition/) (GitHub Pages)

**Architecture:** see [ARCHITECTURE.md](ARCHITECTURE.md).

## Features

- **Inputs:** drag & drop, file picker (multiple files), paste screenshots with Ctrl+V, phone camera, PDFs (each page rendered with pdf.js, up to 50 pages)
- **22 languages**, up to 3 at once: English, Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu, Arabic, Chinese (Simplified/Traditional), Japanese, Korean, French, German, Spanish, Italian, Portuguese, Russian
- **Page layout modes:** automatic, single column, uniform block, sparse text, single line/word/character
- **Preprocessing:** auto-upscale, grayscale, auto contrast, Otsu black-&-white thresholding, invert (light text on dark), 90° rotation, automatic deskew of tilted scans. Toggle **Original / Processed** to see what the engine sees
- **Region OCR:** drag a box on the image to read only that area
- **Results:** editable text, mean confidence, per-word confidence table, colour-coded word boxes over the image (hover for word + confidence), adjustable low-confidence threshold
- **Exports:** plain text, **searchable PDF**, JSON (words + bounding boxes), Tesseract TSV, hOCR, and a combined text file for all files in the batch
- Batch queue, light/dark theme, mobile layout, settings remembered between visits

## Run locally

It's a static site with no build step. Serve the folder with any static server (ES modules don't load from `file://`):

```bash
python -m http.server 8790
```

Then open http://localhost:8790.

## Deploy

A push to `main` deploys to both hosts automatically:

- **Vercel:** project `imagesearcheasy` (team driveAI), connected through the Vercel GitHub app, preset "Other", no build command → https://imagesearcheasy.vercel.app/
- **GitHub Pages:** deploy from branch `main` / root → https://bharathdrive-ai.github.io/imageRecognition/

Any other static host (Netlify, Cloudflare Pages) works the same way.

## Project structure

```
index.html          UI layout
css/styles.css      Styles, light/dark theme tokens, responsive layout
js/app.js           State, file handling, rendering, overlay interaction, exports wiring
js/ocr.js           Tesseract.js worker wrapper (lazy init, language switching, TSV parsing)
js/preprocess.js    Canvas preprocessing (scale, grayscale, contrast, Otsu, invert, rotate)
js/pdf.js           PDF → page canvases via pdf.js (loaded only when a PDF is added)
js/export.js        Download helpers (txt, json, combined)
```

## Tips for better accuracy

- Text should be at least ~20px tall. Leave **Upscale** on Auto for small screenshots.
- Use **Black & white** for faded scans or uneven lighting, and **Invert** for light text on dark backgrounds.
- Pick **Sparse text** for signs, labels and forms; **Single line** for one line of text, such as a number plate.
- Use **Only allow these characters** (e.g. `0123456789.,`) when reading numbers.
- Crop to the area you need with region selection. It's faster and avoids picking up noise.

## Libraries

- [Tesseract.js 7.0.0](https://github.com/naptha/tesseract.js) (Apache-2.0)
- [pdf.js 4.10.38](https://github.com/mozilla/pdf.js) (Apache-2.0)
