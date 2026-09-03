'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch pane
 *  A note's drawing as its own tab, so it can sit in a split NEXT TO the note
 *  it belongs to: markdown on one side, the drawing on the other, both editable.
 *
 *  A note owns PAGES, not one drawing (lib/notesketches.js). Throw a finger
 *  sideways to turn one; throw it left off the last page and a new blank one is
 *  made. The button in the toolbar lists them all.
 *
 *  The drawing is the .svg sidecar (see main.js · _sketchFolder) — this view
 *  owns nothing, it just opens that file in a full editor and writes it back on
 *  every committed stroke, exactly like the code block does. Opening the same
 *  sketch inline and in a pane at the same time is therefore fine as long as
 *  only one of them is being drawn on; the last committed stroke wins.
 *
 *  The view state is the sketch ID (plus the note it came from, for the title),
 *  so the pane survives a restart and a workspace switch.
 * ========================================================================== */

const { ItemView, Notice, setIcon } = require('obsidian');
const { SKETCH_VIEW } = require('../constants.js');
const notesketches = require('../lib/notesketches.js');
const { NexusSketchSurface, sketchPresets } = require('./sketch.js');

class NexusSketchPaneView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.id = ''; this.notePath = ''; }
  getViewType() { return SKETCH_VIEW; }
  getDisplayText() {
    const base = this.notePath ? this.notePath.split('/').pop().replace(/\.md$/i, '') : '';
    const pages = this.pageIds();
    const where = pages.length > 1 ? ' ' + notesketches.pageOf(pages, this.id) + '/' + pages.length : '';
    return base ? 'Sketch · ' + base + where : 'Sketch' + where;
  }

  /* The note's pages, in order. A drawing opened without a note (from the
     capture hub, say) is a list of one: itself. */
  noteFile() {
    return this.notePath ? this.app.vault.getAbstractFileByPath(this.notePath) : null;
  }
  pageIds() {
    const ids = notesketches.idsOfFile(this.app, this.noteFile());
    return ids.length ? ids : (this.id ? [this.id] : []);
  }

  async goToPage(id) {
    if (!id || id === this.id) return;
    if (this.surface) { this.surface.destroy(); this.surface = null; }
    this.id = id;
    await this.render();
    this.leaf.updateHeader && this.leaf.updateHeader();
  }

  /* Sideways off the last page makes a new one — that IS the "add a page"
     gesture, and it is why the button beside it only has to LIST them. */
  async turnPage(dir) {
    const ids = this.pageIds();
    if (dir === 'prev') { await this.goToPage(notesketches.prevId(ids, this.id)); return; }
    const next = notesketches.nextId(ids, this.id);
    if (next) { await this.goToPage(next); return; }
    await this.addPage();
  }

  async addPage() {
    const file = this.noteFile();
    if (!file) { new Notice('This drawing does not belong to a note, so it has no pages.'); return; }
    try {
      // Page one decides what the paper looks like: a second page on different
      // paper is not a second page, it is a different pad.
      const first = this.pageIds()[0];
      const presets = sketchPresets(first ? await this.plugin.loadSketch(first) : null);
      const fresh = await notesketches.addPage(this.plugin, file,
        (id, svg) => this.plugin.saveSketch(id, svg), presets);
      await this.goToPage(fresh);
      new Notice('New page — ' + notesketches.pageOf(this.pageIds(), fresh) + ' of ' + this.pageIds().length);
    } catch (e) {
      new Notice('Nexus: could not add a page — ' + ((e && e.message) || e));
    }
  }
  getIcon() { return 'pencil-line'; }

  getState() { return { id: this.id, notePath: this.notePath }; }
  async setState(state, result) {
    this.id = (state && state.id) || '';
    this.notePath = (state && state.notePath) || '';
    await super.setState(state, result);
    await this.render();
  }

  async onOpen() { if (this.id) await this.render(); }
  /* Closing the tab is the only way out now — there is no button for it, because
     "close the drawing" and "close the note" are not the same decision and a
     button that looked like the first did the second. The paper is trimmed here
     instead: whatever blank space auto-grow added below the last stroke is not
     worth saving. */
  async onClose() {
    if (this.surface) {
      try {
        this.surface.setPageZoom(1);
        this.surface.setHeight(0);
        if (this.surface.strokes.length) this.surface.persist();
      } catch (e) {}
      this.surface.destroy();   // writes out anything the commit debounce still holds
    }
    this.surface = null;
  }

  async render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-skpane');
    if (!this.id) { root.createDiv({ cls: 'nx-home-empty', text: 'No sketch selected.' }); return; }

    const s = this.plugin.settings.quicksketch;
    const data = await this.plugin.loadSketch(this.id);
    if (!data) { root.createDiv({ cls: 'nx-home-empty', text: 'Sketch "' + this.id + '" not found.' }); return; }

    const bar = root.createDiv('nx-sketch-bar nx-skpane-bar');
    const stage = root.createDiv('nx-skpane-stage');
    /* Obsidian walks UP from a touch and gives up its own swipes at the first
       ancestor carrying this — so it belongs on the drawing, not on the view.
       On the view it also swallowed the swipe that opens the command palette,
       which is the toolbar's to give away and not the canvas's. */
    stage.dataset.ignoreSwipe = 'true';
    const pad = stage.createDiv('nx-sketch-pad');

    const surface = new NexusSketchSurface(pad, {
      W: data.w, H: data.h, bg: data.bg || s.bg,
      paper: data.paper || null,
      paperStyle: this.plugin._resolvePaperStyle(data, s),
      invertOnDark: s.invertOnDark !== false,
      ink: s.ink, paperWidth: s.paperWidth, penSizes: s.penSizes, pen: 'fountain',
      penConfig: (s.penConfig = s.penConfig || {}),
      shapeSnap: s.shapeSnap !== false,
      bgType: data.bgType || 'none', bgSize: data.bgSize || s.bgSize,
      bgOpacity: data.bgOpacity != null ? data.bgOpacity : s.bgOpacity,
      bgColor: s.bgColor,
      autoGrow: true,                       // a pane is a workbench, not a preview
      pageZoom: true,                       // pinch / ctrl+wheel / the Zoom button magnify the sheet
      onSwipe: (dir) => this.turnPage(dir),
      strokes: data.strokes || [],
      objects: data.objects || [],
      sections: data.sections || [],
      ocr: data.ocr || [],
      resizable: true,
      onCommit: () => this.save(surface),
    });
    this.surface = surface;

    // Endless paper: keep blank canvas below the last stroke so there is always
    // room to keep writing.
    const onScroll = () => {
      if (surface._resizing) return;
      if (stage.scrollTop + stage.clientHeight > stage.scrollHeight - 260)
        surface.setHeight(surface.H + Math.round(stage.clientHeight * 0.9 * (surface.W / (pad.clientWidth || surface.W))));
    };
    stage.addEventListener('scroll', onScroll, { passive: true });
    const ensurePaper = () => {
      const padW = pad.clientWidth;
      if (!padW) { requestAnimationFrame(ensurePaper); return; }
      const want = Math.round(stage.clientHeight * 1.4 * (surface.W / padW));
      if (surface.H < want) surface.setHeight(want);
    };
    requestAnimationFrame(ensurePaper);

    // Always on screen: the read-out answers "what zoom am I at" before you
    // notice anything is off, and one tap is the way back to page width.
    const zoomPill = root.createDiv({ cls: 'nx-sk-zoompill', text: '100%' });
    zoomPill.onclick = () => surface.setPageZoom(1);
    surface.onZoom = (z) => {
      // Shrunk counts as zoomed too — |z-1|, not z>1. The old test left the pill
      // dim and the stage un-scrollable for the whole 0.3–1 range.
      root.toggleClass('is-zoomed', Math.abs(z - 1) > 0.01);
      zoomPill.setText(Math.round(z * 100) + '%');
    };

    this.plugin._buildSketchBar(bar, surface, s, { mode: 'full', notePath: this.notePath });
    /* Back to the text — in THIS tab. `getLeaf(false)` would have opened the
       note wherever the focus happened to be and left the drawing standing; the
       button says "switch", so it switches. */
    if (this.notePath) {
      const back = bar.createDiv({ cls: 'nx-sk-btn nx-skpane-back', attr: { 'aria-label': 'Switch to the note' } });
      setIcon(back, 'file-text');
      back.onclick = async () => {
        const f = this.noteFile();
        if (f) await this.leaf.openFile(f);
      };
      this._pages(bar);
    }
  }

  /* Which page you are on, and every page there is. The label doubles as the
     button: a page count nobody can click is a fact with nothing to do. */
  _pages(bar) {
    const ids = this.pageIds();
    const btn = bar.createDiv({ cls: 'nx-sk-btn nx-skpane-pages',
      attr: { 'aria-label': 'The pages of this note', role: 'button', tabindex: '0' } });
    setIcon(btn, 'copy');
    btn.createSpan({ cls: 'nx-skpane-pagenum',
      text: notesketches.pageOf(ids, this.id) + '/' + Math.max(1, ids.length) });
    // A count with a chevron is a control; a count on its own is a fact.
    const chev = btn.createSpan({ cls: 'nx-skpane-pagechev' });
    setIcon(chev, 'chevron-down');
    btn.onclick = () => {
      const { NexusSketchPagesModal } = require('../modals/sketchpages.js');
      new NexusSketchPagesModal(this.plugin, this).open();
    };
  }

  async save(surface) {
    try { await this.plugin.saveSketch(this.id, surface.toSVGString()); }
    catch (e) { console.error('Nexus: sketch save failed', e); new Notice('Nexus: could not save sketch.'); }
  }
}

module.exports = { NexusSketchPaneView };
