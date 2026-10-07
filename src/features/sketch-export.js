'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · images in and out of a sketch
 *  Picking an image to place on the pad, and exporting a sketch as SVG, PNG
 *  or PDF. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { moment } = require('obsidian');
const sketchExport = require('../lib/sketchexport.js');
const { uniquePath } = require('../lib/vaultpaths.js');

class SketchExport {

  /* An image placed in a sketch is embedded as a data URI, so the .svg sidecar
     stays a standalone file — a sidecar pointing at a vault path stops being
     standalone the moment it is copied. That makes size a real cost, so the
     picture is downscaled before it goes in. */
  _pickImageFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });
  }
  async _sketchImageData(file, maxDim) {
    const max = maxDim || 1400;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    // Line art and anything with transparency stays PNG; a photo is far smaller
    // as JPEG, and in a note that difference is worth choosing per file.
    const mime = /png|gif|webp|svg/i.test(file.type || '') ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => cv.toBlob(res, mime, 0.82));
    if (!blob) throw new Error('could not encode ' + (file.name || 'the image'));
    const href = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(String(reader.result));
      reader.onerror = () => rej(new Error('could not read ' + (file.name || 'the image')));
      reader.readAsDataURL(blob);
    });
    return { href, w, h };
  }

  /* ── Export ────────────────────────────────────────────────────────────────
     Rasterising goes through the SAME string the sidecar is written as, so what
     is exported is what is stored — not a second rendering that can disagree
     with it. */
  async _rasterSketch(surface, scale) {
    const svg = surface.toSVGString();
    // The size of the FILE, not of the canvas — a mindmap's file is cropped to
    // its ink, and rasterising it at W x H would stretch it.
    const size = surface.exportSize();
    const width = Math.max(1, Math.round(size.w * (scale || 2)));
    const height = Math.max(1, Math.round(size.h * (scale || 2)));
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error('the drawing could not be rendered'));
        el.src = url;
      });
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      return { canvas: cv, ctx, width, height };
    } finally { URL.revokeObjectURL(url); }
  }
  async _sketchToPng(surface, scale) {
    const { canvas } = await this._rasterSketch(surface, scale);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('the image could not be encoded');
    return new Uint8Array(await blob.arrayBuffer());
  }
  async _sketchToPdf(surface, scale) {
    const { canvas, ctx, width, height } = await this._rasterSketch(surface, scale);
    const page = surface.exportSize();   // the PDF page is the drawing, at 1:1
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const packed = await sketchExport.deflate(sketchExport.rgbaToRgbOnWhite(rgba));
    if (packed) {
      return sketchExport.pdfDocument(packed, {
        width, height, filter: 'FlateDecode',
        pageWidth: page.w, pageHeight: page.h,
      });
    }
    /* No CompressionStream on this runtime: fall back to JPEG, which every PDF
       reader takes as-is. Lossy, and the caller says so. */
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
    if (!blob) throw new Error('the page could not be encoded');
    return sketchExport.pdfDocument(new Uint8Array(await blob.arrayBuffer()), {
      width, height, filter: 'DCTDecode',
      pageWidth: page.w, pageHeight: page.h,
    });
  }
  /* Write the export next to the other sketches and say where it went — a file
     that appears somewhere unnamed may as well not have been written. */
  async _exportSketch(surface, format, scale) {
    const folder = (this.settings.quicksketch.folder || 'Inbox/Quicksketch').replace(/\/+$/, '');
    await this.ensureSketchFolder();
    const stamp = moment().format('YYYY-MM-DD HHmm');
    const spec = sketchExport.EXPORT_FORMATS.find(f => f.id === format) || sketchExport.EXPORT_FORMATS[0];
    const base = sketchExport.exportFileName(surface.title, spec.ext, stamp).replace(/\.[^.]+$/, '');
    const path = uniquePath(p => !!this.app.vault.getAbstractFileByPath(p), folder, base, spec.ext);
    if (format === 'svg') await this.app.vault.create(path, surface.toSVGString());
    else {
      const bytes = format === 'pdf'
        ? await this._sketchToPdf(surface, scale)
        : await this._sketchToPng(surface, scale);
      await this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return path;
  }
}

module.exports = SketchExport;
