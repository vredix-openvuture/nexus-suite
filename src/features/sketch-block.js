'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the sketch code block
 *  Rendering a nexus-sketch block: the pad, its paper, and the popovers its
 *  toolbar opens. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { MarkdownRenderChild, setIcon } = require('obsidian');
const { NexusSketchSurface, ratioWH } = require('../views/sketch.js');

class SketchBlock {

  async renderSketch(source, el, ctx) {
    const s = this.settings.quicksketch;
    if (!s.enabled) { el.createEl('pre').createEl('code', { text: source }); return; }
    const params = this._parseSketchBody(source);
    const state = { id: params.id || null, writing: false };
    try {
      await this._renderSketchInner(source, el, ctx, s, params, state);
    } catch (err) {
      // Never leave the reader staring at raw `id: sk-…`. Show the saved drawing
      // as a plain image (it IS a standalone SVG) + a diagnostic, and log it.
      console.error('Nexus Suite: quicksketch render failed', err);
      el.empty();
      const box = el.createDiv('nx-sketch nx-sketch-fallback');
      const f = state.id && this.app.vault.getAbstractFileByPath(this._sketchPath(state.id));
      if (f) { const img = box.createEl('img', { cls: 'nx-sketch-fallback-img' }); img.src = this.app.vault.getResourcePath(f); }
      box.createDiv({ cls: 'nx-sketch-fallback-msg', text: 'Quick Sketch: editor unavailable here — ' + ((err && err.message) || 'error') });
    }
  }

  /* What a brand-new sidecar is born with: the paper TYPE and, for a sectioned
     one, which way round the sheet is. Only those, because they are what a
     Sketch tab cannot fall back to a setting for later — the sidecar it opens is
     the whole truth about the drawing's shape. */
  _newSketchPresets() {
    const s = this.settings.quicksketch || {};
    return { paperType: s.paperType || 'endless', sheetLandscape: !!s.sheetLandscape };
  }

  /* Paper-grain toggle for a saved sketch: its stored flag, else legacy "paperlike"
     (which always carried texture), else off for pre-texture sketches. */
  _resolvePaperStyle(data, s) {
    if (data && data.paperStyle != null) return !!data.paperStyle;
    if (data && data.paper === 'paperlike') return true;
    if (data) return false;
    return s.paperStyle !== false;
  }

  async _renderSketchInner(source, el, ctx, s, params, state) {
    const data = state.id ? await this.loadSketch(state.id) : null;
    // Saved sketch → honour its own stored geometry/paper; otherwise fall back to
    // block params, then the module defaults.
    let W, H, bg, paper, paperStyle, bgType, bgSize, bgOpacity, autoGrow, paperType, sheetLandscape;
    /* A sketch saved before paper types existed IS endless: the setting says what
       a NEW pad starts as, and reading it for an old file would silently change
       the shape of every drawing in the vault. */
    paperType = data ? (data.paperType || 'endless') : (params.papertype || s.paperType || 'endless').toLowerCase();
    sheetLandscape = data ? !!data.sheetLandscape : !!s.sheetLandscape;
    if (data) {
      W = data.w; H = data.h; bg = data.bg || s.bg;
      // Sketches saved before paper modes carry only `bg` → paper stays null and
      // the raw fill is honoured; newer ones restore their stored preset.
      paper = data.paper || null;
      paperStyle = this._resolvePaperStyle(data, s);
      bgType = data.bgType || 'none'; bgSize = data.bgSize || s.bgSize; bgOpacity = (data.bgOpacity != null) ? data.bgOpacity : s.bgOpacity;
      autoGrow = (data.autoGrow != null) ? data.autoGrow : s.autoGrow;
    } else {
      const wh = ratioWH(params.ratio || s.ratio); W = wh[0]; H = wh[1]; bg = s.bg;
      paper = (params.paper || s.paper || 'paper').toLowerCase();
      paperStyle = (params.paperstyle != null) ? (params.paperstyle === 'true') : (s.paperStyle !== false);
      bgType = (params.background || s.bgType || 'none').toLowerCase();
      bgSize = Number(params.gridsize) || s.bgSize;
      bgOpacity = (params.bgopacity != null) ? Number(params.bgopacity) : s.bgOpacity;
      autoGrow = !!s.autoGrow;
    }
    // Legacy "paperlike" preset → the "paper" (off-white) colour; its texture now
    // rides the separate paperStyle toggle (see _resolvePaperStyle).
    if (paper === 'paperlike') paper = 'paper';

    // Writing the id back modifies the note, which makes Obsidian re-render this
    // block — while the user may already be drawing on the pad being replaced.
    // Whatever that outgoing surface holds beyond what reached the file is
    // carried over here; without it those strokes were simply gone.
    let carried = data ? data.strokes : [];
    const outgoing = state.id && this._sketchLive ? this._sketchLive[state.id] : null;
    if (outgoing && outgoing.strokes && outgoing.strokes.length > carried.length) carried = outgoing.strokes;

    const wrap = el.createDiv('nx-sketch');
    const barWrap = wrap.createDiv('nx-sketch-bar-wrap');   // grid-rows wrapper → smooth collapse
    const bar = barWrap.createDiv('nx-sketch-bar');
    const pad = wrap.createDiv('nx-sketch-pad');            // height comes from the SVG (width:100%/height:auto), not CSS aspect-ratio
    /* A finger stroke that starts near an edge is a drawer swipe to the mobile
       gesture recogniser, and a stroke downwards is its command palette. It
       gives up at the first ancestor marked like this, so the mark goes on the
       PAD: the toolbar above it keeps every gesture Obsidian offers. */
    pad.dataset.ignoreSwipe = 'true';

    const surface = new NexusSketchSurface(pad, {
      W, H, bg, paper, paperStyle, invertOnDark: s.invertOnDark !== false, ink: s.ink, penSizes: s.penSizes, pen: 'fountain',
      paperWidth: s.paperWidth,
      pageZoom: true,             // pinch magnifies the SHEET here too — the viewBox zoom it used
                                  // to do could go in but never out, which is not a zoom
      penConfig: (s.penConfig = s.penConfig || {}),   // live reference — pen menu edits apply on the next stroke
      shapeSnap: s.shapeSnap !== false,
      bgType, bgSize, bgOpacity, bgColor: s.bgColor, autoGrow,
      paperType, sheetLandscape, view: data ? data.view : null,
      strokes: carried,
      objects: (outgoing && outgoing.objects && outgoing.objects.length) ? outgoing.objects : (data ? data.objects : null),
      sections: data ? data.sections : null,
      ocr: data ? data.ocr : null,
      /* toSVGString writes the WHOLE metadata block, so anything the surface is
         not handed is deleted by the next committed stroke. The name and the
         book cover are engine-irrelevant and were being lost exactly that way. */
      title: data ? (data.title || '') : '',
      cover: data ? (data.cover || null) : null,
      resizable: true,
      onCommit: () => this._persistSketch(state, surface, ctx, el),
    });

    // View ⇄ Edit. View = clean, blended into the note, toolbar collapsed, not
    // drawable. Existing drawings open in View; new/empty pads open in Edit so
    // you can draw immediately.
    // Remember the mode PER ID across re-renders — the id-writeback on the first
    // stroke re-renders the block, and we must not snap back to View mid-drawing.
    const modes = (this._sketchMode = this._sketchMode || {});
    const setMode = (m) => {
      wrap.toggleClass('is-edit', m === 'edit');
      wrap.toggleClass('is-view', m === 'view');
      surface.setLocked(m !== 'edit');   // view: pinch/pan still work, drawing doesn't
      if (m === 'view') surface.setHeight(0);   // view is ALWAYS cropped to content (setHeight clamps up to the lowest stroke)
      if (state.id) modes[state.id] = m;
    };
    /* Zoomed, the sheet is wider than the note column: the block scrolls
       sideways, and the pill is the way back to 100% without having to pinch
       exactly onto it. */
    const zoomPill = wrap.createDiv({ cls: 'nx-sk-zoompill', text: '100%' });
    zoomPill.onclick = (e) => { e.stopPropagation(); surface.setPageZoom(1); };
    surface.onZoom = (z) => {
      wrap.toggleClass('is-zoomed', Math.abs(z - 1) > 0.01);
      zoomPill.setText(Math.round(z * 100) + '%');
    };
    const enterBtn = pad.createDiv({ cls: 'nx-sketch-enter', attr: { 'aria-label': 'Edit sketch' } });
    setIcon(enterBtn, 'pencil');
    enterBtn.onclick = () => setMode('edit');
    // Compact code-block toolbar.
    this._buildSketchBar(bar, surface, s, {
      mode: 'compact',
      // Leaving edit → view crops to content (setMode), then persist that height.
      onDone: () => { setMode('view'); if (surface.strokes.length) surface.persist(); },
      onSplit: true, sketchId: () => state.id, notePath: ctx && ctx.sourcePath,
    });
    // This pad is now the live one for that id — so the NEXT re-render hands
    // over from here instead of from a stale predecessor.
    if (state.id) (this._sketchLive = this._sketchLive || {})[state.id] = surface;
    /* A pad outlives its element otherwise: the commit debounce, the fling and
       (on mindmap paper) a ResizeObserver all keep running against a node that
       is gone, and the block re-renders on the very first stroke. Tie them to the
       element Obsidian owns. */
    if (ctx && typeof ctx.addChild === 'function' && typeof MarkdownRenderChild === 'function') {
      const plugin = this;
      const child = new MarkdownRenderChild(wrap);
      child.onunload = () => {
        const live = plugin._sketchLive && state.id ? plugin._sketchLive[state.id] : null;
        // Really going away → save what is pending. Superseded by a re-render of
        // the same sketch → let go quietly; the successor holds the newer copy.
        if (live && live !== surface) surface.teardown(); else surface.destroy();
      };
      ctx.addChild(child);
    }
    const remembered = state.id && modes[state.id];
    const hasContent = !!(carried && carried.length);
    setMode(remembered || (hasContent ? 'view' : 'edit'));
  }

  /* Open a floating panel under `anchor` immediately; dismiss on outside
     pointerdown. Returns close(). Used for the press-and-hold size slider. */
  _showPopover(anchor, buildFn) {
    const panel = document.body.createDiv('nx-sk-pop');
    const close = () => { if (!panel.parentNode) return; panel.remove(); document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
    buildFn(panel, close);
    const r = anchor.getBoundingClientRect();
    panel.style.top = (r.bottom + 4) + 'px';
    panel.style.left = r.left + 'px';
    const pr = panel.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
    window.setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    return close;
  }

  /* Floating panel anchored under `anchor`, toggled on click, dismissed on any
     outside pointerdown. buildFn(panel, close) fills it. Used for
     custom colour and the live background controls. */
  _sketchPopover(anchor, buildFn) {
    let panel = null;
    const close = () => { if (!panel) return; panel.remove(); panel = null; document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (panel && !panel.contains(e.target) && !anchor.contains(e.target)) close(); };
    anchor.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel) { close(); return; }
      panel = document.body.createDiv('nx-sk-pop');
      buildFn(panel, close);
      const r = anchor.getBoundingClientRect();
      panel.style.top = (r.bottom + 4) + 'px';
      panel.style.left = r.left + 'px';
      const pr = panel.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
      document.addEventListener('pointerdown', onDoc, true);
    });
  }
}

module.exports = SketchBlock;
