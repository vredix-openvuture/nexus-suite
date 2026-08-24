'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch pane
 *  One sketch as its own tab, so it can sit in a split NEXT TO the note it
 *  belongs to: markdown on one side, the drawing on the other, both editable.
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
const { NexusSketchSurface } = require('./sketch.js');

class NexusSketchPaneView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.id = ''; this.notePath = ''; }
  getViewType() { return SKETCH_VIEW; }
  getDisplayText() {
    const base = this.notePath ? this.notePath.split('/').pop().replace(/\.md$/i, '') : '';
    return base ? 'Sketch · ' + base : 'Sketch';
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
  async onClose() {
    if (this.surface) this.surface.destroy();   // writes out anything the commit debounce still holds
    this.surface = null;
  }

  async render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-skpane');
    root.dataset.ignoreSwipe = 'true';   // finger strokes are not drawer swipes
    if (!this.id) { root.createDiv({ cls: 'nx-home-empty', text: 'No sketch selected.' }); return; }

    const s = this.plugin.settings.quicksketch;
    const data = await this.plugin.loadSketch(this.id);
    if (!data) { root.createDiv({ cls: 'nx-home-empty', text: 'Sketch "' + this.id + '" not found.' }); return; }

    const bar = root.createDiv('nx-sketch-bar nx-skpane-bar');
    const stage = root.createDiv('nx-skpane-stage');
    const pad = stage.createDiv('nx-sketch-pad');

    const surface = new NexusSketchSurface(pad, {
      W: data.w, H: data.h, bg: data.bg || s.bg,
      paper: data.paper || null,
      paperStyle: this.plugin._resolvePaperStyle(data, s),
      invertOnDark: s.invertOnDark !== false,
      ink: s.ink, penSizes: s.penSizes, pen: 'fountain',
      penConfig: (s.penConfig = s.penConfig || {}),
      shapeSnap: s.shapeSnap !== false,
      bgType: data.bgType || 'none', bgSize: data.bgSize || s.bgSize,
      bgOpacity: data.bgOpacity != null ? data.bgOpacity : s.bgOpacity,
      bgColor: s.bgColor,
      autoGrow: true,                       // a pane is a workbench, not a preview
      pageZoom: true,                       // pinch magnifies the sheet; out stops at 1× = normal
      strokes: data.strokes || [],
      resizable: true,
      onCommit: () => this.save(surface),
    });
    this.surface = surface;

    // Endless paper, same deal as the full-size overlay: keep blank canvas below
    // the last stroke so there is always room to keep writing.
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

    const zoomPill = root.createDiv({ cls: 'nx-sk-zoompill', text: '100%' });
    zoomPill.onclick = () => surface.setPageZoom(1);
    surface.onZoom = (z) => {
      root.toggleClass('is-zoomed', z > 1.01);
      zoomPill.setText(Math.round(z * 100) + '%');
    };

    this.plugin._buildSketchBar(bar, surface, s, {
      mode: 'full',
      // "Collapse" in a pane means: trim the empty paper, save, show the note.
      onCollapse: () => this.trimAndClose(),
    });
    // A way back to the note the sketch belongs to.
    if (this.notePath) {
      const back = bar.createDiv({ cls: 'nx-sk-btn nx-skpane-back', attr: { 'aria-label': 'Show the note' } });
      setIcon(back, 'file-text');
      back.onclick = () => {
        const f = this.app.vault.getAbstractFileByPath(this.notePath);
        if (f) this.app.workspace.getLeaf(false).openFile(f);
      };
    }
  }

  async save(surface) {
    try { await this.plugin.saveSketch(this.id, surface.toSVGString()); }
    catch (e) { console.error('Nexus: sketch save failed', e); new Notice('Nexus: could not save sketch.'); }
  }
  trimAndClose() {
    if (this.surface) {
      this.surface.setPageZoom(1);
      this.surface.setHeight(0);                                  // back to content height
      if (this.surface.strokes.length) this.surface.persist();
      else this.surface.flush();
    }
    this.leaf.detach();
  }
}

module.exports = { NexusSketchPaneView };
