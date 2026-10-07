'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · files arriving in an ink folder
 *  Watching the ink folders, waiting for a file to finish syncing, then
 *  downscaling, cropping and thumbnailing it. Mixed into the plugin class.
 * ========================================================================== */

const { loadPdfJs } = require('obsidian');
const { INK_DOWNSCALE_EXT, INK_EXT, INK_MAX_DIM } = require('../constants.js');

class InkImport {
  /* Polls adapter.stat until the file's size is non-zero and size+mtime are
     unchanged across two consecutive 300ms checks — i.e. the writer is done.
     Fully-written files pass on the second poll (~300ms added latency).
     Returns false if the file disappears or hasn't settled after ~15s (a
     still-running huge transfer — better to skip than to process half a
     file; the next 'create' or restart scan will retry it). Uses the
     adapter's stat, not the cached TFile.stat, so every poll hits the real
     on-disk state. Mobile-safe (DataAdapter.stat is plain Vault API). */
  async _waitForInkFileStable(path) {
    let prevSize = -1, prevMtime = -1;
    for (let i = 0; i < 50; i++) {
      let st;
      try { st = await this.app.vault.adapter.stat(path); } catch (e) { return false; }
      if (!st) return false;
      if (st.size > 0 && st.size === prevSize && st.mtime === prevMtime) return true;
      prevSize = st.size; prevMtime = st.mtime;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }
  async _onInkVaultCreate(f) {
    const s = this.settings.inkCapture;
    if (!s.enabled) return;
    if (f.extension === 'md') return;   // our own sidecar write
    if (!INK_EXT.includes((f.extension || '').toLowerCase())) return;   // also filters out folders (no .extension)
    // Cheap first check: thumbnails are always named "<id>.thumb.png".
    if (f.basename.endsWith('.thumb')) return;
    // PERSISTENT anti-recursion guard: our OWN capture attachments are named
    // `ink-<base36id>`. The in-memory _inkSelfCreated Set below can't cover files
    // re-surfaced by a Syncthing sync FROM ANOTHER DEVICE or a restart's startup
    // scan — and that gap is exactly what let the plugin re-capture its own
    // attachments into ever-deeper ink-in-ink folders across a multi-device mesh
    // (observed: 76 nested dupes, depth 21). A name check survives sync/restart/
    // multi-device, unlike any in-memory state. Our attachments never need
    // re-capturing, so skipping them unconditionally is always correct.
    if (/^ink-[a-z0-9]+$/i.test(f.basename)) return;
    if (this._inkSelfCreated && this._inkSelfCreated.delete(f.path)) return;
    // General, PERSISTENT safety net: the .thumb check and the pre-registered
    // attachment path only cover the two known derived-file cases; this is
    // the structural fallback for anything else (e.g. a restart where
    // Obsidian's startup scan "discovers" an existing attachment/thumbnail
    // and fires 'create' for it, with no memory of the in-session rename).
    // A folder-note capture folder is ALWAYS named after its sidecar (that's
    // the folder-notes convention we rely on), so this checks plain file
    // EXISTENCE at that exact expected path — not the metadataCache, which
    // during a bulk startup scan may not have parsed a sibling .md's
    // frontmatter yet and would make this check flaky/racy. Existence in the
    // vault's file index is synchronous and immediate, no such race.
    if (f.parent && f.parent.path && this.app.vault.getAbstractFileByPath(f.parent.path + '/' + f.parent.name + '.md')) return;
    // Fallback for the rare case the folder-note's name ever drifts from the
    // folder's own name (frontmatter-based, same as before).
    const sib = f.parent && f.parent.children;
    if (sib && sib.some((c) => c !== f && c.extension === 'md' &&
      ((this.app.metadataCache.getFileCache(c) || {}).frontmatter || {})['ink-source'])) return;
    const entry = this.inkSources().find(src =>
      src.enabled && src.folder && f.path.startsWith((src.folder || '').replace(/\/$/, '') + '/'));
    if (!entry) return;
    // Some adapters fire 'create' more than once for the same write (e.g. the
    // filesystem watcher noticing the file in addition to the Vault API's own
    // event) — without this guard that raced two full _makeInkSidecar runs on
    // the same file (double rename, duplicate embed attempts).
    if (this._inkProcessing.has(f.path)) return;
    this._inkProcessing.add(f.path);
    try {
      // Obsidian fires 'create' the moment a file EXISTS, not when it's fully
      // WRITTEN — file managers and exporters create-then-stream, so reading
      // right away can yield zero/partial bytes. Runtime-hit once: an
      // update-on-re-export read a still-empty drop and copied that
      // nothingness over the stored PDF, destroying it. Wait for the writer
      // to finish before touching the file at all.
      if (!(await this._waitForInkFileStable(f.path))) return;
      await this._makeInkSidecar(f, entry.id);
    } finally {
      this._inkProcessing.delete(f.path);
    }
  }
  /* Re-encodes the file in place if it's a raster image bigger than
     INK_MAX_DIM on its longest edge — pure canvas/createImageBitmap, no
     Electron/node dependency, so this stays mobile-safe. Leaves PDFs, SVGs and
     already-reasonably-sized images untouched. */
  async _maybeDownscaleInkImage(f) {
    const ext = (f.extension || '').toLowerCase();
    if (!INK_DOWNSCALE_EXT.includes(ext)) return;
    try {
      const buf = await this.app.vault.readBinary(f);
      const bitmap = await createImageBitmap(new Blob([buf]));
      const tooBig = bitmap.width > INK_MAX_DIM || bitmap.height > INK_MAX_DIM;
      if (!tooBig) { bitmap.close(); return; }
      const scale = INK_MAX_DIM / Math.max(bitmap.width, bitmap.height);
      const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
      const blob = await new Promise(res => canvas.toBlob(res, mime, 0.85));
      if (blob) await this.app.vault.modifyBinary(f, await blob.arrayBuffer());
    } catch (e) { console.error('[Nexus] ink downscale:', e); /* leave the original file untouched on failure */ }
  }
  /* Butterfly (infinite canvas) exports the SVG at the size of the whole
     virtual canvas, not just the drawn area — a small doodle can end up on a
     12000×13000px sheet, invisible once scaled into an embed. Fix: mount the
     SVG off-screen (real layout, not display:none) so the native SVG
     getBBox() can measure the ACTUAL drawn geometry, then rewrite viewBox/
     width/height to that bounding box (+ small padding). Pure DOM/SVG APIs,
     no Electron — mobile-safe. Leaves normally-sized SVGs untouched-ish (still
     re-tightens the box, harmless if it was already close to content). */
  async _maybeCropInkSvg(f) {
    if ((f.extension || '').toLowerCase() !== 'svg') return;
    let host = null;
    try {
      const buf = await this.app.vault.readBinary(f);
      const text = new TextDecoder().decode(buf);
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svgEl = doc.documentElement;
      if (!svgEl || svgEl.nodeName !== 'svg' || svgEl.querySelector('parsererror')) return;
      host = document.body.createDiv();
      host.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;';
      host.appendChild(svgEl);
      const bbox = svgEl.getBBox();
      if (!bbox || !bbox.width || !bbox.height) return;
      const pad = Math.max(bbox.width, bbox.height) * 0.04;
      const vb = [bbox.x - pad, bbox.y - pad, bbox.width + pad * 2, bbox.height + pad * 2];
      svgEl.setAttribute('viewBox', vb.join(' '));
      svgEl.setAttribute('width', String(vb[2]));
      svgEl.setAttribute('height', String(vb[3]));
      // Ink-drawing exports (Linwood/Butterfly) are transparent — whatever
      // background you saw was your SVG program's own canvas chrome, not part
      // of the file. Bake a real white "paper" rect in, behind the strokes,
      // so it looks like paper everywhere (Obsidian, any theme, any viewer).
      const bg = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', String(vb[0])); bg.setAttribute('y', String(vb[1]));
      bg.setAttribute('width', String(vb[2])); bg.setAttribute('height', String(vb[3]));
      bg.setAttribute('fill', '#ffffff');
      svgEl.insertBefore(bg, svgEl.firstChild);
      const out = new XMLSerializer().serializeToString(svgEl);
      await this.app.vault.modifyBinary(f, new TextEncoder().encode(out).buffer);
    } catch (e) { console.error('[Nexus] ink svg crop:', e); /* leave the original file untouched on failure */ }
    finally { if (host) host.remove(); }
  }
  /* Renders PDF page 1 to a cached PNG thumbnail (attPath + '.thumb.png'),
     using Obsidian's OWN bundled pdf.js (loadPdfJs() — no bundler needed, this
     is a documented Obsidian API, same lib Obsidian's own PDF viewer uses).
     Generated at capture time (and re-rendered when a re-export updates the
     capture) and stored in ink-thumb frontmatter, so the gallery just loads a
     plain image on every re-render instead of re-parsing the PDF each time.
     Returns null (silently) if pdf.js can't be loaded or rendering fails —
     the gallery falls back to a placeholder icon. */
  async _makeInkPdfThumb(attPath) {
    let pdf = null;
    try {
      if (!window.pdfjsLib) await loadPdfJs();
      const pdfjsLib = window.pdfjsLib;
      if (!pdfjsLib) return null;
      const file = this.app.vault.getAbstractFileByPath(attPath);
      if (!file) return null;
      const buf = await this.app.vault.readBinary(file);
      pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.max(500 / base.width, 0.2) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) return null;
      const thumbPath = attPath.replace(/\.pdf$/i, '') + '.thumb.png';
      const data = await blob.arrayBuffer();
      // Overwrite when the thumb already exists (re-export of an existing
      // capture re-renders it) — createBinary throws on existing files.
      const existing = this.app.vault.getAbstractFileByPath(thumbPath);
      if (existing) {
        await this.app.vault.modifyBinary(existing, data);
      } else {
        (this._inkSelfCreated || (this._inkSelfCreated = new Set())).add(thumbPath);
        await this.app.vault.createBinary(thumbPath, data);
      }
      return thumbPath;
    } catch (e) { console.error('[Nexus] ink pdf thumb:', e); return null; }
    // Release the document/worker — this shares Obsidian's OWN pdfjsLib
    // instance (that's the point of loadPdfJs()), so leaving it open here is
    // the prime suspect for the native embed viewer later failing to open
    // the exact same file (shows as "0 of 0" pages).
    finally { if (pdf) { try { await pdf.destroy(); } catch (e) {} } }
  }
}

module.exports = InkImport;
