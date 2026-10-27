# InstaScan AI

**Scan • Extract • Translate.** Instantly extract searchable text from images and PDFs. Translate words and make information easier to find.

A browser-based OCR tool that extracts text from images and PDFs using [Tesseract.js](https://github.com/naptha/tesseract.js) 7.
Everything runs on the user's device. Files are never uploaded; only the OCR engine and language models are downloaded from a CDN (and cached after first use).

**Live:** [www.instascan.in](https://www.instascan.in/) (Vercel; insta-scan.vercel.app and imagesearcheasy.vercel.app still work) · [bharathdrive-ai.github.io/imageRecognition](https://bharathdrive-ai.github.io/imageRecognition/) (GitHub Pages)

**Architecture:** see [ARCHITECTURE.md](ARCHITECTURE.md).

## Links

| What | URL |
| --- | --- |
| **Live app** | |
| Website | https://www.instascan.in |
| Vercel (also serves the app) | https://insta-scan.vercel.app |
| GitHub Pages | https://bharathdrive-ai.github.io/imageRecognition/ |
| Privacy policy | https://www.instascan.in/privacy.html |
| **Code and docs** | |
| GitHub repo | https://github.com/bharathdrive-ai/imageRecognition |
| Architecture (Claude Doc) | https://claude.ai/code/artifact/9e90526f-4bb2-46ac-bbdb-0727260cb836 |
| Architecture (in repo) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| **Hosting dashboards** (owner access) | |
| Vercel project | https://vercel.com/drive2/imagesearcheasy |
| GitHub Pages settings | https://github.com/bharathdrive-ai/imageRecognition/settings/pages |
| **Google Cloud**, project `image-text-recognition-511415` (owner access) | |
| Credentials (OAuth client, API key) | https://console.cloud.google.com/apis/credentials?project=image-text-recognition-511415 |
| Consent screen / audience | https://console.cloud.google.com/auth/audience?project=image-text-recognition-511415 |
| Enabled APIs | https://console.cloud.google.com/apis/dashboard?project=image-text-recognition-511415 |
| **For users** | |
| Remove the app's Google Drive access | https://myaccount.google.com/permissions |
| **Local development** | |
| Local server (`python -m http.server 8790`) | http://localhost:8790 |

## Features

- **Inputs:** drag & drop, file picker (multiple files), **Google Drive** (My Drive and shared drives, via Google Picker), paste screenshots with Ctrl+V, phone camera, PDFs (each page rendered with pdf.js, up to 50 pages)
- **22 languages**, up to 3 at once: English, Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu, Arabic, Chinese (Simplified/Traditional), Japanese, Korean, French, German, Spanish, Italian, Portuguese, Russian
- **Page layout modes:** automatic, single column, uniform block, sparse text, single line/word/character
- **Preprocessing:** auto-upscale, grayscale, auto contrast, Otsu black-&-white thresholding, invert (light text on dark), 90° rotation, automatic deskew of tilted scans. Toggle **Original / Processed** to see what the engine sees
- **Batch upload + search:** add as many images or PDFs as you like (picker, drag & drop, paste, Drive); new files are recognized automatically (toggle in the upload tile). The **Search all files** tile finds a word or phrase across every file's text and translation, with highlighted snippets; clicking a result opens the file, selects the match and highlights the words on the image. Press `/` to jump to search.
- **Search by image (on-device):** choose a picture, or drag a box on any image and click **Use selected region**, to find **duplicates** (perceptual hash) and images that **contain that piece** (OpenCV.js ORB feature matching with a RANSAC homography, plus multi-scale template matching for small or flat pieces). Matches are outlined on the image.
- **Search by description (on-device AI):** type what an image shows ("receipt", "ID card", "handwritten note") and images are ranked by Apple's MobileCLIP-S0 via Transformers.js. The ~88 MB model downloads once, after the user agrees.
- **Region OCR:** drag a box on the image to read only that area
- **Results:** editable text, mean confidence, per-word confidence table, colour-coded word boxes over the image (hover for word + confidence), adjustable low-confidence threshold
- **Translate** recognized text between English and Indian languages (Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu). Uses the browser's built-in on-device translator when available (Chrome/Edge desktop); otherwise, only when the user clicks **Translate online**, the free MyMemory API.
- **Exports:** plain text, **searchable PDF**, JSON (words + bounding boxes), Tesseract TSV, hOCR, the translation, and a combined text file for all files in the batch
- Batch queue, light/dark theme, mobile layout, settings remembered between visits

## Run locally

It's a static site with no build step. Serve the folder with any static server (ES modules don't load from `file://`):

```bash
python -m http.server 8790
```

Then open http://localhost:8790.

## Deploy

A push to `main` deploys to both hosts automatically:

- **Vercel:** project `imagesearcheasy` (team driveAI), connected through the Vercel GitHub app, preset "Other", no build command → https://www.instascan.in/ (custom domain; `instascan.in` redirects to `www`, and https://insta-scan.vercel.app/ also serves it)
- **Domain:** `instascan.in`, registered at GoDaddy. DNS: `A @ 216.198.79.1` and `CNAME www → <project>.vercel-dns-017.com`, plus the Google Search Console TXT record.
- **GitHub Pages:** deploy from branch `main` / root → https://bharathdrive-ai.github.io/imageRecognition/

Any other static host (Netlify, Cloudflare Pages) works the same way.

## Google Drive setup

The **Google Drive** button opens Google's file picker. Picked images and PDFs download straight from the Drive API into the browser, and nothing goes through any other server. The app asks only for the `drive.file` scope, so it can read the files the user picks and nothing else in their Drive.

The button stays hidden until `js/config.js` has three values. To get them from [Google Cloud Console](https://console.cloud.google.com/):

1. **Pick or create a project** and note its **project number** (Dashboard). This is `appId`.
2. **Enable APIs:** APIs & Services → Library → enable **Google Picker API** and **Google Drive API**.
3. **OAuth consent screen:** User type *External*, add the app name and support email, and add the scope `.../auth/drive.file`. While the app is in *Testing*, only the listed test users can sign in. Click *Publish app* to open it to everyone; `drive.file` is a non-sensitive scope, so Google review isn't needed.
4. **OAuth client ID:** Credentials → Create credentials → OAuth client ID → *Web application*. Under **Authorized JavaScript origins**, add:
   - `https://www.instascan.in`
   - `https://insta-scan.vercel.app`
   - `https://bharathdrive-ai.github.io`
   - `http://localhost:8790`

   Copy the client ID into `clientId`.
5. **API key:** Credentials → Create credentials → API key. Restrict it to the **Google Picker API**, and to websites `https://www.instascan.in/*`, `https://insta-scan.vercel.app/*`, `https://bharathdrive-ai.github.io/*` and `http://localhost:8790/*`. Copy it into `apiKey`.

These values are public by design: they identify the app to Google and are not secrets. The API key's restrictions are what stop it being used elsewhere. Never put a service-account key in this repo.

## Project structure

```
index.html          UI layout
css/styles.css      Styles, light/dark theme tokens, responsive layout
js/app.js           State, file handling, rendering, overlay interaction, exports wiring
js/ocr.js           Tesseract.js worker wrapper (lazy init, language switching, TSV parsing)
js/preprocess.js    Canvas preprocessing (scale, grayscale, contrast, Otsu, invert, rotate)
js/pdf.js           PDF → page canvases via pdf.js (loaded only when a PDF is added)
js/imagesearch.js   Search by image: dHash duplicates, OpenCV.js feature + template matching (loaded on demand)
js/semantic.js      Search by description: MobileCLIP-S0 embeddings via Transformers.js (loaded on demand)
js/translate.js     Translation: on-device Translator API, MyMemory fallback with consent
js/drive.js         Google Drive import: sign-in, Picker, downloads (Google scripts load on demand)
js/config.js        Google Drive client ID, API key, project number (blank = Drive button hidden)
testImages/         Sample Telugu images for testing OCR and translation
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
