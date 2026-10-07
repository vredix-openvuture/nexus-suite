'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · opening a note's sketch
 *  The note's corner button, the hold menu that picks where a sketch opens,
 *  and the sketch that belongs to a note. Mixed into the plugin class.
 * ========================================================================== */

const { Menu, Notice, moment, setIcon } = require('obsidian');
const { NX_MODULES, SKETCH_VIEW } = require('../constants.js');
const { emptySketchSVG } = require('../views/sketch.js');
const notesketches = require('../lib/notesketches.js');
const { attachHoldMenu } = require('../lib/holdmenu.js');
const { uniquePath } = require('../lib/vaultpaths.js');

class SketchOpen {

  /* The code block's "open elsewhere" button. The sketch has to exist first —
     a pad that was never drawn on has no sidecar yet. */
  _attachSplitMenu(btn, opts, clickOpens) {
    const open = (side) => {
      const id = opts.sketchId && opts.sketchId();
      if (!id) { new Notice('Draw something first — the sketch is saved on the first stroke.'); return; }
      this.openSketchInSplit(id, side, opts.notePath || '');
    };
    this._attachHoldMenu(btn, open, clickOpens);
  }

  /* The note's corner button: tap switches to the drawing, hold picks where it
     goes. Same menu as the code block's, but the id may not exist yet — a note
     that has never been drawn on gets one (and an empty sidecar) on the way. */
  _attachSketchOpenMenu(btn, getFile) {
    this._attachHoldMenu(btn, (side) => { const f = getFile(); if (f) this.openNoteSketch(f, side); }, false);
    btn.onclick = (e) => { e.stopPropagation(); const f = getFile(); if (f) this.openNoteSketch(f, 'same'); };
  }

  /* Press-and-hold / right-click → the four ways to open a sketch. Long press,
     because on a tablet there is no second mouse button, and a plain tap already
     means the obvious thing. `open(side)` does the work. */
  _attachHoldMenu(btn, open, clickOpens) {
    const menu = (x, y) => {
      const m = new Menu();
      m.addItem(i => i.setTitle('Switch to sketch').setIcon('pencil-line').onClick(() => open('same')));
      m.addItem(i => i.setTitle('Open to the left').setIcon('panel-left').onClick(() => open('left')));
      m.addItem(i => i.setTitle('Open to the right').setIcon('panel-right').onClick(() => open('right')));
      m.addItem(i => i.setTitle('Open in a new tab').setIcon('file-plus').onClick(() => open('tab')));
      if (x != null) m.showAtPosition({ x, y });
      else { const r = btn.getBoundingClientRect(); m.showAtPosition({ x: r.left, y: r.bottom }); }
    };
    attachHoldMenu(btn, menu);
    if (clickOpens) btn.onclick = (e) => { e.stopPropagation(); menu(e.clientX, e.clientY); };
  }


  /* The note a drawing belongs to, opened NEXT TO it: text on one side, paper
     on the other. Reuses a leaf that already holds the note rather than opening
     a second copy of it. */
  async openNoteBeside(notePath) {
    const ws = this.app.workspace;
    const file = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
    if (!file) { new Notice('Nexus: that note is gone.'); return; }
    const open = ws.getLeavesOfType('markdown').find(l => l.view && l.view.file && l.view.file.path === notePath);
    if (open) { ws.revealLeaf(open); return; }
    const leaf = ws.createLeafBySplit(ws.getMostRecentLeaf() || ws.getLeaf(false), 'vertical', false);
    await leaf.openFile(file);
    ws.revealLeaf(leaf);
  }

  /* side: 'same' | 'left' | 'right' | 'tab'. 'same' replaces whatever is in the
     current leaf — that is "switch to the sketch", the note is one tap back via
     the pane's own file-text button. */
  async openSketchInSplit(id, side, notePath) {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(SKETCH_VIEW).find(l => l.view && l.view.id === id);
    if (existing) { ws.revealLeaf(existing); return; }
    let leaf;
    if (side === 'same') leaf = ws.getLeaf(false);
    else if (side === 'tab') leaf = ws.getLeaf('tab');
    else {
      const anchor = ws.getMostRecentLeaf() || ws.getLeaf(false);
      leaf = ws.createLeafBySplit(anchor, 'vertical', side === 'left');
    }
    await leaf.setViewState({ type: SKETCH_VIEW, active: true, state: { id, notePath: notePath || '' } });
    ws.revealLeaf(leaf);
  }

  /* ---- A note's own sketch ----
     Every markdown note can own ONE drawing, kept in the same .svg sidecar
     store as the code block (id in frontmatter `sketch`). The note never draws
     it — that is the Sketch tab's job (views/sketchpane.js), which has the room,
     the full toolbar and the zoom. What lives in the note is the way in:
     mountSketchControl's corner button. See docs/removed-features.md for the
     Slate mode this replaced. */

  /* The FIRST page of a note's drawing, created on demand together with an
     empty sidecar so the tab always opens on something rather than on "not
     found". The rest of the pages are lib/notesketches.js. */
  async ensureNoteSketch(file) {
    if (!file || file.extension !== 'md') return '';
    let id = notesketches.idsOfFile(this.app, file)[0] || '';
    if (!id) {
      id = notesketches.newId();
      try {
        await this.app.fileManager.processFrontMatter(file, fm => {
          const ids = notesketches.idsOf(fm);
          if (ids.length) id = ids[0]; else notesketches.writeIds(fm, [id]);
        });
      } catch (e) { return ''; }
    }
    // The sidecar can be missing even when the note names one — deleted by hand,
    // or a sync that has not caught up. Writing an empty one is the only
    // non-destructive answer; opening the tab on "not found" is not an answer.
    if (!this.app.vault.getAbstractFileByPath(this._sketchPath(id))) await this.saveSketch(id, emptySketchSVG(this._newSketchPresets()));
    return id;
  }

  /* Open a note's sketch. `side`: 'same' replaces the note in its own leaf,
     'left' / 'right' put it beside it, 'tab' opens a new tab. */
  async openNoteSketch(file, side) {
    if (!this.settings.quicksketch || this.settings.quicksketch.enabled === false) { new Notice(NX_MODULES.quicksketch.name + ' is switched off.'); return; }
    const id = await this.ensureNoteSketch(file);
    if (!id) { new Notice('Nexus: could not write the sketch id into that note.'); return; }
    await this.openSketchInSplit(id, side || 'same', file.path);
  }

  async createSketchNote() {
    if (!this.settings.quicksketch || this.settings.quicksketch.enabled === false) { new Notice(NX_MODULES.quicksketch.name + ' is switched off.'); return; }
    const stamp = moment().format('YYYY-MM-DD HH.mm');
    const path = uniquePath(p => !!this.app.vault.getAbstractFileByPath(p), '', 'Sketch ' + stamp, 'md');
    const id = 'sk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const file = await this.app.vault.create(path, '---\nsketch: ' + id + '\n---\n');
    await this.saveSketch(id, emptySketchSVG(this._newSketchPresets()));
    // Straight into the drawing — a new sketch note exists to be drawn on. The
    // tab's file-text button is the way back to its text.
    await this.openSketchInSplit(id, 'tab', file.path);
  }

  /* A VISIBLE corner button injected into every markdown note (like the banner
     and background buttons): tap opens the note's drawing in a Sketch tab,
     press and hold (or right-click) chooses where. addAction() proved invisible
     on mobile, so this is a plain injected button instead. */
  mountSketchControl(view) {
    if (!view || !view.file || view.file.extension !== 'md') return;
    const el = view.contentEl;
    let btn = el.querySelector(':scope > .nx-sketch-open');
    if (!this.settings.quicksketch || this.settings.quicksketch.enabled === false) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el.createDiv('nx-sketch-open');
      this._attachSketchOpenMenu(btn, () => view.file);
    }
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;
    const has = !!(fm && fm.sketch);
    setIcon(btn, has ? 'pencil-line' : 'pen-line');
    btn.setAttribute('aria-label', has ? 'Open the sketch' : 'Start a sketch for this note');
    btn.toggleClass('is-active', has);
  }
}

module.exports = SketchOpen;
