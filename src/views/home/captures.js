'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · sketch and capture cards
 *  The cards that show recent sketches and captures, and which note a sketch
 *  belongs to. Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { moment, setIcon } = require('obsidian');
const { NexusSketchConfigModal } = require('../../modals/cards.js');
const capture = require('../../lib/capture.js');

class HomeCaptures {

  /* ---- Quick sketches ------------------------------------------------------
     The drawings themselves are standalone .svg files (see main.js ·
     _sketchFolder), so the card is a thumbnail wall over that folder. Clicking
     one opens the note it belongs to when we can find it, else the file. ---- */
  _sketchFiles(item) {
    const clean = (s) => String(s || '').split(',').map(x => x.trim().replace(/^\/|\/$/g, '')).filter(Boolean);
    const folders = clean(item.folders);
    const roots = folders.length ? folders : [this.plugin._sketchFolder()];
    let files = this.app.vault.getFiles().filter(f => f.extension === 'svg'
      && roots.some(p => f.path.startsWith(p + '/')));
    const sort = item.sort || 'modified';
    if (sort === 'name') files.sort((a, b) => a.basename.localeCompare(b.basename));
    else if (sort === 'created') files.sort((a, b) => b.stat.ctime - a.stat.ctime);
    else files.sort((a, b) => b.stat.mtime - a.stat.mtime);
    return files;
  }
  /* Which note carries this sketch? Frontmatter `sketch:` (a note's own sketch)
     is free; a `quicksketch` block hides its id in the body, so that lookup only
     runs on demand and is remembered. */
  _sketchOwnerFast(id) {
    if (!this._sketchFmIdx) {
      this._sketchFmIdx = new Map();
      for (const f of this.app.vault.getMarkdownFiles()) {
        const v = this._fm(f).sketch;
        if (v) this._sketchFmIdx.set(String(v), f);
      }
    }
    return this._sketchFmIdx.get(id) || null;
  }
  async _sketchOwner(id) {
    const fast = this._sketchOwnerFast(id);
    if (fast) return fast;
    this._sketchOwners = this._sketchOwners || new Map();
    if (this._sketchOwners.has(id)) return this._sketchOwners.get(id);
    let hit = null;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f);
      // Only files that even have a code block can hold a sketch block.
      if (!cache || !(cache.sections || []).some(s => s.type === 'code')) continue;
      let txt = '';
      try { txt = await this.app.vault.cachedRead(f); } catch (e) { continue; }
      if (txt.includes('quicksketch') && new RegExp('id:\\s*' + id + '\\b').test(txt)) { hit = f; break; }
    }
    this._sketchOwners.set(id, hit);
    return hit;
  }
  _openSketch(f) {
    const id = f.basename;
    this._sketchOwner(id).then(note => {
      if (note) this.app.workspace.getLeaf(false).openFile(note);
      else this._open(f);
    }).catch(() => this._open(f));
  }
  /* Ink, Quick Sketch and Chatter as three cards you place separately — a
     vault that only scans and never speaks should not carry two thirds of an
     empty card. One renderer, because they answer the same question; three
     entries in the add menu, because they are three decisions.

     A summary and a door, never a gallery: how many there are, what the newest
     one is, and a way through to the hub. The dashboard is the control room,
     not the archive. */
  _captureSummary(kind) {
    const app = this.app;
    if (kind === 'sketch') {
      // The same lister the sketches card uses, with no per-card folders: the
      // summary counts the sketch folder, which is what "how many sketches do
      // I have" means.
      const files = this._sketchFiles({});
      return { count: files.length, newest: files[0] || null,
               title: files[0] ? files[0].basename : '', thumb: files[0] || null };
    }
    const want = kind === 'ink' ? capture.isInkCapture : capture.isChatter;
    const showEx = kind === 'ink' && !!(this.plugin.settings.inkCapture.excalidraw || {}).enabled;
    const hits = [];
    for (const f of app.vault.getMarkdownFiles()) {
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (!want(fm, showEx)) continue;
      hits.push({ file: f, fm: fm || {} });
    }
    hits.sort((a, b) => (b.file.stat.mtime || 0) - (a.file.stat.mtime || 0));
    const top = hits[0];
    return {
      count: hits.length,
      newest: top ? top.file : null,
      title: top ? top.file.basename : '',
      thumb: top && top.fm['ink-thumb'] ? app.vault.getAbstractFileByPath(top.fm['ink-thumb'])
           : (top && top.fm['ink-file'] ? app.vault.getAbstractFileByPath(top.fm['ink-file']) : null),
    };
  }

  _wCaptures(card, item) {
    const kind = item.kind || 'ink';
    const meta = { ink:     { icon: 'camera',      title: 'Ink Capture',  one: 'capture', many: 'captures' },
                   sketch:  { icon: 'pencil-line', title: 'Quick Sketch', one: 'sketch',  many: 'sketches' },
                   chatter: { icon: 'mic',         title: 'Chatter',      one: 'note',    many: 'notes' } }[kind];
    card.addClass('nx-home-captures');
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || meta.icon);
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || meta.title });

    const sum = this._captureSummary(kind);
    const body = card.createDiv('nx-home-card-body nx-cap-sum');
    const n = body.createDiv('nx-cap-sum-n');
    n.createSpan({ cls: 'nx-cap-sum-count', text: String(sum.count) });
    n.createSpan({ cls: 'nx-cap-sum-unit', text: sum.count === 1 ? meta.one : meta.many });
    if (sum.newest) {
      const last = body.createDiv('nx-cap-sum-last');
      if (sum.thumb) {
        const th = last.createDiv('nx-cap-sum-thumb');
        th.style.backgroundImage = 'url("' + this.app.vault.getResourcePath(sum.thumb).replace(/"/g, '\\"') + '")';
      }
      const txt = last.createDiv('nx-cap-sum-txt');
      txt.createDiv({ cls: 'nx-cap-sum-title', text: sum.title });
      txt.createDiv({ cls: 'nx-cap-sum-when', text: moment(sum.newest.stat.mtime).fromNow() });
    } else {
      this._empty(body, 'Nothing yet.');
    }
    card.onclick = () => this.plugin.openCaptureHub(kind);
  }

  _wSketches(card, item) {
    card.addClass('nx-home-sketches');
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || 'pencil-line');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Quick sketches' });
    const files = this._sketchFiles(item);
    head.createSpan({ cls: 'nx-home-card-count', text: String(files.length) });
    const add = head.createSpan('nx-home-card-gear');
    setIcon(add, 'plus');
    add.setAttribute('aria-label', 'New sketch note');
    add.onclick = (e) => { e.stopPropagation(); this.plugin.createSketchNote(); };
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusSketchConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-sk-body');
    if (!files.length) { this._empty(body, 'No sketches yet.'); return; }
    const shown = files.slice(0, item.count > 0 ? item.count : 8);
    if ((item.display || 'grid') === 'list') {
      shown.forEach(f => {
        const row = body.createDiv('nx-home-item nx-sk-item');
        const th = row.createSpan('nx-sk-mini');
        th.style.backgroundImage = 'url("' + this.app.vault.getResourcePath(f).replace(/"/g, '\\"') + '")';
        row.createDiv({ cls: 'nx-home-item-title', text: f.basename });
        row.createSpan({ cls: 'nx-home-item-sub', text: moment(f.stat.mtime).fromNow() });
        row.onclick = () => this._openSketch(f);
      });
      return;
    }
    const grid = body.createDiv('nx-sk-grid');
    shown.forEach(f => {
      const tile = grid.createDiv('nx-sk-tile');
      const thumb = tile.createDiv('nx-sk-thumb');
      thumb.style.backgroundImage = 'url("' + this.app.vault.getResourcePath(f).replace(/"/g, '\\"') + '")';
      if (item.showName !== false) tile.createDiv({ cls: 'nx-sk-name', text: f.basename });
      tile.setAttribute('aria-label', f.path + ' · ' + moment(f.stat.mtime).fromNow());
      tile.onclick = () => this._openSketch(f);
    });
  }
}

module.exports = HomeCaptures;
