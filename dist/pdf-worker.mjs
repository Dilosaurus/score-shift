// The PDF worker entry: polyfills first, then pdf.js's own worker. app.mjs points
// pdfjs.GlobalWorkerOptions.workerSrc here instead of at the vendored file directly.
import './polyfills.mjs';
import './vendor/pdf.worker.mjs';
