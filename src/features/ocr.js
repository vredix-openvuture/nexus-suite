'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · reading sketches and scans
 *  Running the external OCR engine on a sketch or an ink capture, and the
 *  sketch search that reads its result. Mixed into the plugin class.
 * ========================================================================== */

const { Notice } = require('obsidian');
const { SKETCH_VIEW } = require('../constants.js');
const sketchSearch = require('../lib/sketchsearch.js');

class Ocr {


  async openSketchSearch() {
    const { NexusSketchSearchModal } = require('../modals/sketchsearch.js');
    new NexusSketchSearchModal(this, await this.sketchDocuments()).open();
  }

  /* ── Handwriting ───────────────────────────────────────────────────────────
     The image goes to a binary the user already has and the text comes back.
     Desktop only: there is no shell on a phone, and pretending otherwise would
     mean a button that silently does nothing there. */
  ocrAvailable() {
    try { return !!(require('child_process') && require('fs') && require('os') && require('path')); }
    catch (e) { return false; }
  }
  async runSketchOcr(surface) {
    return this.runOcrOnImage(await this._sketchToPng(surface, 2), 'png');
  }

  /* The recogniser does not care where the picture came from: a sketch rendered
     to a bitmap and a scan already on disk are the same job. Splitting it here
     is what let Ink Capture reuse the engine Quick Sketch already had, instead
     of growing a second one. */
  async runOcrOnImage(bytes, ext) {
    const cfg = this.settings.quicksketch.ocr || {};
    if (!this.ocrAvailable()) throw new Error('handwriting recognition needs a desktop shell — it cannot run here');
    const png = bytes;
    const cp = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ocr-'));
    const inPath = path.join(dir, 'page.' + (ext || 'png'));
    // Tesseract appends its own .txt; the template is handed the stem, and the
    // reader below accepts either spelling so other engines fit too.
    const outStem = path.join(dir, 'page');
    const built = sketchSearch.buildOcrCommand(cfg.command || '', inPath, outStem);
    if (built.error) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(built.error); }
    try {
      fs.writeFileSync(inPath, Buffer.from(png));
      await new Promise((resolve, reject) => {
        cp.execFile(built.command, built.args, { timeout: 120000 }, (err, stdout, stderr) => {
          if (err) reject(new Error((built.command + ' failed: ' + (stderr || err.message)).trim()));
          else resolve(stdout);
        });
      });
      let raw = '';
      for (const candidate of [outStem + '.txt', outStem]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { raw = fs.readFileSync(candidate, 'utf8'); break; }
      }
      if (!raw) throw new Error(built.command + ' produced no text file');
      return sketchSearch.cleanOcrText(raw);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  }
  /* Read a scan. The attachment is already a picture, so this is the same
     engine with a different source — except for a PDF, where only the cached
     page-1 render exists as an image and the rest of the document is out of
     reach without a renderer we do not ship. That limit is said out loud rather
     than silently reading one page and calling it done. */
  async ocrInkCapture(item) {
    const capture = require('../lib/capture.js');
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!file) throw new Error('the note is gone');
    // Every page, in order, into one section — a multi-page capture you can
    // only search the first page of is not searchable.
    const pages = (item.pages && item.pages.length) ? item.pages : [{ file: item.file, thumb: item.thumb }];
    const lines = [];
    let partial = false, read = 0;
    for (const page of pages) {
      const isPdf = /\.pdf$/i.test(page.file || '');
      if (isPdf) partial = true;
      const source = isPdf ? page.thumb : (page.file || page.thumb);
      if (!source) continue;
      const image = this.app.vault.getAbstractFileByPath(source);
      if (!image) continue;
      const bytes = await this.app.vault.readBinary(image);
      lines.push.apply(lines, await this.runOcrOnImage(bytes, (image.extension || 'png').toLowerCase()));
      read++;
    }
    if (!read) throw new Error('this capture has no image to read');
    const after = capture.withOcrSection(await this.app.vault.read(file), lines);
    if (after != null) await this.app.vault.modify(file, after);
    return { lines: lines.length, partial };
  }

  async ocrActiveSketch() {
    const surface = this._activeSketchSurface();
    if (!surface) { new Notice('Nexus: open a sketch first.'); return; }
    new Notice('Nexus: reading the handwriting…');
    try {
      const lines = await this.runSketchOcr(surface);
      surface.setOcr(lines);
      this._sketchDocs = null;   // the index is stale now
      new Notice(lines.length ? 'Nexus: read ' + lines.length + ' line(s) — the sketch is searchable now.'
                              : 'Nexus: nothing legible was found.');
    } catch (err) {
      new Notice('Nexus: ' + (err && err.message ? err.message : 'handwriting recognition failed.'));
    }
  }
  /* The surface the user is looking at: an open Sketch tab wins — that is where
     drawing happens — and otherwise any live pad still in a note. */
  _activeSketchSurface() {
    const ws = this.app.workspace;
    const panes = ws.getLeavesOfType(SKETCH_VIEW).filter(l => l.view && l.view.surface);
    const focused = panes.find(l => l === ws.activeLeaf) || panes[0];
    if (focused) return focused.view.surface;
    const live = this._sketchLive ? Object.values(this._sketchLive) : [];
    for (const surface of live) if (surface && document.contains(surface.host)) return surface;
    return null;
  }
}

module.exports = Ocr;
