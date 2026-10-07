'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · barcode scanning
 *  The camera feeds frames to the browser's BarcodeDetector where it exists and
 *  to our own EAN-13 decoder everywhere else. Our decoder must agree with
 *  itself on two frames before a code counts, because a single misread that
 *  happens to pass the checksum would file the wrong book.
 * ========================================================================== */

const ean13 = require('./ean13.js');

const FRAME_MS = 120;   // ~8 frames a second is plenty and spares a tablet's battery

function cameraAvailable() {
  return !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
function nativeDetectorAvailable() {
  return typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';
}

async function makeDetector() {
  if (!nativeDetectorAvailable()) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('ean_13') ? new window.BarcodeDetector({ formats: ['ean_13'] }) : null;
  } catch (e) { return null; }
}

class BookScanner {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.canvas = document.createElement('canvas');
    this.hits = {};
    this.stopped = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    if (this.stopped) { this.release(); return; }
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.detector = await makeDetector();
    this.next();
  }

  next() { if (!this.stopped) this.timer = setTimeout(() => this.tick(), FRAME_MS); }

  async tick() {
    if (this.stopped) return;
    let code = null, trusted = false;
    try {
      if (this.detector) {
        const found = await this.detector.detect(this.video);
        const hit = found.find(b => ean13.isBookCode(b.rawValue));
        if (hit) { code = hit.rawValue; trusted = true; }
      }
      if (!code) code = this.decodeFrame();
    } catch (e) { /* a frame that cannot be read is just skipped */ }
    if (code && ean13.isBookCode(code)) {
      this.hits[code] = (this.hits[code] || 0) + 1;
      if (trusted || this.hits[code] >= 2) { this.stop(); this.onCode(code); return; }
    }
    this.next();
  }

  decodeFrame() {
    const v = this.video;
    if (!v.videoWidth) return null;
    const w = Math.min(960, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    this.canvas.width = w; this.canvas.height = h;
    const g = this.canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(v, 0, 0, w, h);
    // The guide line sits in the middle; the rows around it are enough.
    return ean13.decodeImage(g.getImageData(0, 0, w, h), { rows: [0.4, 0.45, 0.5, 0.55, 0.6] });
  }

  release() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.release();
  }
}

/* An <img> rather than createImageBitmap: same result, but headless Chromium
   under virtual time never settles an ImageBitmap decode of a larger file. */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    el.src = url;
  });
}

/* A photo from the gallery or the camera app: every row and column, because
   nobody holds the phone straight for a photo. */
async function decodeFile(blob) {
  let bmp;   // an HTMLImageElement
  try { bmp = await loadImage(blob); } catch (e) { return null; }
  const detector = await makeDetector();
  if (detector) {
    try {
      const hit = (await detector.detect(bmp)).find(b => ean13.isBookCode(b.rawValue));
      if (hit) return hit.rawValue;
    } catch (e) { /* fall through to our own decoder */ }
  }
  const scale = Math.min(1, 1600 / Math.max(bmp.naturalWidth, bmp.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.naturalWidth * scale); c.height = Math.round(bmp.naturalHeight * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return ean13.decodeImage(g.getImageData(0, 0, c.width, c.height), { columns: true });
}

module.exports = { cameraAvailable, nativeDetectorAvailable, BookScanner, decodeFile };
