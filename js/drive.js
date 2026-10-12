// Import files from Google Drive with the Google Picker.
// Sign-in uses Google Identity Services with the narrow `drive.file` scope: the app can
// only read files the user picks. Picked files download straight from the Drive API into
// this tab; they never pass through any other server.
// Google's scripts load only when someone reaches for the Drive button.

import { GOOGLE } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/avif',
  'application/pdf',
].join(',');
const MAX_BYTES = 50 * 1024 * 1024;

let loading = null;
let token = null;
let tokenExpiry = 0;
let tokenClient = null;

export function driveConfigured() {
  return Boolean(GOOGLE.clientId && GOOGLE.apiKey && GOOGLE.appId);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection or ad blocker.'));
    document.head.appendChild(s);
  });
}

/** Starts downloading Google's scripts. Safe to call repeatedly. */
export function preloadDrive() {
  if (!loading) {
    loading = Promise.all([
      loadScript('https://apis.google.com/js/api.js').then(() => new Promise((resolve, reject) => {
        window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker failed to load.')) });
      })),
      loadScript('https://accounts.google.com/gsi/client'),
    ]).catch((err) => {
      loading = null; // allow a retry
      throw err;
    });
  }
  return loading;
}

export function driveReady() {
  return !!(window.google?.picker && window.google?.accounts?.oauth2);
}

function getToken() {
  if (token && Date.now() < tokenExpiry - 60_000) return Promise.resolve(token);
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE.clientId,
        scope: SCOPE,
        callback: () => {},
      });
    }
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || `Google sign-in failed (${resp.error}).`));
      token = resp.access_token;
      tokenExpiry = Date.now() + Number(resp.expires_in || 3600) * 1000;
      resolve(token);
    };
    tokenClient.error_callback = (err) => {
      const messages = {
        popup_closed: 'Google sign-in was closed before it finished.',
        popup_failed_to_open: 'Your browser blocked the Google sign-in window. Click "Google Drive" again, or allow pop-ups for this site.',
      };
      reject(Object.assign(new Error(messages[err?.type] || 'Google sign-in failed.'), { quiet: err?.type === 'popup_closed' }));
    };
    tokenClient.requestAccessToken();
  });
}

function showPicker(accessToken) {
  return new Promise((resolve) => {
    const P = window.google.picker;
    const myDrive = new P.DocsView(P.ViewId.DOCS)
      .setMimeTypes(MIME_TYPES)
      .setIncludeFolders(true)
      .setMode(P.DocsViewMode.GRID);
    const sharedDrives = new P.DocsView(P.ViewId.DOCS)
      .setMimeTypes(MIME_TYPES)
      .setIncludeFolders(true)
      .setEnableDrives(true);
    const picker = new P.PickerBuilder()
      .setAppId(GOOGLE.appId)
      .setDeveloperKey(GOOGLE.apiKey)
      .setOAuthToken(accessToken)
      .setTitle('Choose images or PDFs to recognize')
      .addView(myDrive)
      .addView(sharedDrives)
      .enableFeature(P.Feature.MULTISELECT_ENABLED)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        const action = data[P.Response.ACTION];
        if (action === P.Action.PICKED) {
          resolve(data[P.Response.DOCUMENTS].map((d) => ({
            id: d[P.Document.ID],
            name: d[P.Document.NAME],
            mimeType: d[P.Document.MIME_TYPE],
            size: Number(d.sizeBytes || 0),
          })));
        } else if (action === P.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

async function download(doc, accessToken) {
  if (doc.size > MAX_BYTES) throw new Error(`${doc.name} is over 50 MB.`);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) token = null; // expired: sign in again next time
  if (!res.ok) throw new Error(`Drive refused ${doc.name} (HTTP ${res.status}).`);
  const blob = await res.blob();
  return new File([blob], doc.name, { type: doc.mimeType || blob.type });
}

/**
 * Signs in if needed, shows the picker and downloads what the user picks.
 * @param {(label:string, progress:number) => void} onProgress
 * @returns {Promise<{files: File[], failed: string[]}>}
 */
export async function importFromDrive(onProgress) {
  if (!driveConfigured()) throw new Error('Google Drive import is not set up for this site.');
  await preloadDrive();
  const accessToken = await getToken();
  const picked = await showPicker(accessToken);
  const files = [];
  const failed = [];
  for (const [i, doc] of picked.entries()) {
    onProgress?.(`Downloading ${doc.name} from Drive (${i + 1} of ${picked.length})`, i / picked.length);
    try {
      files.push(await download(doc, accessToken));
    } catch (err) {
      console.error(err);
      failed.push(err.message);
    }
  }
  return { files, failed };
}
