// Google Drive import settings. Leave any value blank to hide the "Google Drive" button.
// These values ship to every visitor's browser by design: they identify the app, they
// are not secrets. Restrict the API key to this site's URLs in Google Cloud.
// Setup steps: README.md → "Google Drive setup".
export const GOOGLE = {
  clientId: '', // OAuth 2.0 Client ID (type: Web application)
  apiKey: '',   // API key restricted to the Google Picker API
  appId: '',    // Google Cloud project number (digits only)
};
