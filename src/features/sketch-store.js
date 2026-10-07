'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · where sketches are kept
 *  Sketch sidecar files: finding, reading, writing, and the id written into
 *  the code block that shows one. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { Notice, TFile } = require('obsidian');
const { parseSketchSVG } = require('../views/sketch.js');
const notesketches = require('../lib/notesketches.js');
const sketchSearch = require('../lib/sketchsearch.js');

class SketchStore {

  /* ---- Quick Sketch ----
     A `quicksketch` code block renders an interactive vector pad. The drawing
     lives in a standalone .svg sidecar (see views/sketch.js) named after a
     short id; the block body just carries `id: <id>` so the note stays clean.
     The id is assigned lazily on the FIRST committed stroke — viewing a note
     with an empty pad never modifies it. */
  _sketchFolder() { return (this.settings.quicksketch.folder || 'Inbox/Quicksketch').replace(/\/$/, ''); }
  _sketchPath(id) { return this._sketchFolder() + '/' + id + '.svg'; }
  /* ── Finding a sketch again ────────────────────────────────────────────────
     Every sidecar is read once and cached against its mtime: a search that
     re-parsed a hundred SVGs on every keystroke would be unusable, and a cache
     without the mtime would go stale the first time anything was edited. */
  async sketchDocuments() {
    const folder = (this.settings.quicksketch.folder || 'Inbox/Quicksketch').replace(/\/+$/, '');
    const cache = (this._sketchDocs = this._sketchDocs || new Map());
    const files = this.app.vault.getFiles()
      .filter(f => f.extension === 'svg' && f.path.startsWith(folder + '/'));
    const docs = [];
    const seen = new Set();
    for (const file of files) {
      seen.add(file.path);
      const stamp = file.stat ? file.stat.mtime : 0;
      const hit = cache.get(file.path);
      if (hit && hit.stamp === stamp) { docs.push(hit.doc); continue; }
      try {
        const data = parseSketchSVG(await this.app.vault.read(file));
        if (!data) continue;
        const doc = sketchSearch.sketchDocument(file.path, data);
        cache.set(file.path, { stamp, doc });
        docs.push(doc);
      } catch (e) { /* an unreadable sidecar is skipped, not fatal to the search */ }
    }
    for (const key of Array.from(cache.keys())) if (!seen.has(key)) cache.delete(key);
    return docs;
  }

  /* Which note owns which sketch page: a Map id → {path, basename, ids, pages,
     page}. The capture hub needs it for every book it draws, and the sweep it
     costs is over every note's frontmatter — so it is built once and thrown
     away by the metadata events registered in onload, never rebuilt per tile. */
  sketchOwners() {
    if (!this._sketchOwnerIndex) this._sketchOwnerIndex = notesketches.ownerIndex(this.app);
    return this._sketchOwnerIndex;
  }

  async ensureSketchFolder() {
    if (!this.settings.quicksketch.enabled) return;
    const dir = this._sketchFolder();
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
  }
  async loadSketch(id) {
    const f = this.app.vault.getAbstractFileByPath(this._sketchPath(id));
    if (!(f instanceof TFile)) return null;
    try { return parseSketchSVG(await this.app.vault.read(f)); } catch (e) { return null; }
  }
  async saveSketch(id, svgText) {
    await this.ensureSketchFolder();
    const path = this._sketchPath(id);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.vault.modify(f, svgText);
    else await this.app.vault.create(path, svgText);
  }

  /* Parse the `key: value` body of a sketch block (id / ratio for now). */
  _parseSketchBody(source) {
    const out = {};
    (source || '').split('\n').forEach(line => {
      const m = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/);
      if (m) out[m[1].toLowerCase()] = m[2];
    });
    return out;
  }

  async _persistSketch(state, surface, ctx, el) {
    try {
      if (!state.id) {
        if (state.writing) return;              // one id assignment per block
        state.writing = true;
        state.id = 'sk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        (this._sketchMode = this._sketchMode || {})[state.id] = 'edit';   // stay in edit after the re-render
        (this._sketchLive = this._sketchLive || {})[state.id] = surface;  // …and hand the strokes over to the pad that replaces this one
        await this.saveSketch(state.id, surface.toSVGString());
        state.bound = await this._writeSketchId(ctx, el, state.id);
        state.writing = false;
      } else {
        await this.saveSketch(state.id, surface.toSVGString());
      }
      // The note may not have learned the id yet: getSectionInfo() comes up
      // empty often enough (mobile, and right after a re-render), and the old
      // code simply returned there. The sidecar existed, the block never got
      // `id:` — so the next reload rendered an empty pad and the drawing looked
      // like it had detached itself from the note. Keep retrying on every later
      // commit until it sticks, and say so if it never does.
      if (state.id && !state.bound) {
        state.bound = await this._writeSketchId(ctx, el, state.id);
        if (!state.bound) {
          state.bindTries = (state.bindTries || 0) + 1;
          if (state.bindTries === 3) new Notice('Nexus: this drawing is saved as ' + state.id + '.svg but could not be linked into the note yet.');
        }
      }
    } catch (e) { console.error('Nexus: sketch save failed', e); new Notice('Nexus: could not save sketch.'); }
  }

  /* Index of the ONE `quicksketch` block in `lines` that carries no id, or -1.
     Deliberately refuses to guess when a note holds several id-less pads —
     writing the id into the wrong block would be worse than not writing it. */
  _findIdlessSketchBlock(lines) {
    const fence = /^\s*(?:`{3,}|~{3,})\s*quicksketch\s*$/i;
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!fence.test(lines[i])) continue;
      let hasId = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*(?:`{3,}|~{3,})/.test(lines[j])) break;
        if (/^\s*id\s*:/i.test(lines[j])) { hasId = true; break; }
      }
      if (hasId) continue;
      if (found >= 0) return -1;   // ambiguous → leave the note alone
      found = i;
    }
    return found;
  }

  /* Insert `id: <id>` as the first body line of the code block, so the note
     re-renders bound to the just-written sidecar. Idempotent: bails if the
     block already has an id (guards the reading + live-preview double render). */
  async _writeSketchId(ctx, el, id) {
    const file = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    if (!(file instanceof TFile)) return false;
    const fence = /^\s*(?:`{3,}|~{3,})\s*quicksketch\s*$/i;
    let done = false;
    const apply = (content) => {
      const lines = content.split('\n');
      // Preferred: the exact block Obsidian says it is rendering — but only if
      // the line it points at really is our fence (a stale section info would
      // otherwise splice an `id:` into unrelated text).
      const info = ctx.getSectionInfo(el);
      let start = (info && fence.test(lines[info.lineStart] || '')) ? info.lineStart : this._findIdlessSketchBlock(lines);
      if (start < 0) return content;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\s*(?:`{3,}|~{3,})/.test(lines[i])) break;
        if (/^\s*id\s*:/i.test(lines[i])) { done = true; return content; }   // already assigned
      }
      lines.splice(start + 1, 0, 'id: ' + id);
      done = true;
      return lines.join('\n');
    };
    try {
      if (this.app.vault.process) await this.app.vault.process(file, apply);
      else { const c = await this.app.vault.read(file); const n = apply(c); if (n !== c) await this.app.vault.modify(file, n); }
    } catch (e) { console.error('Nexus: could not write the sketch id back', e); return false; }
    return done;
  }
}

module.exports = SketchStore;
