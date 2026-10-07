'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · paper and size
 *  The sheet under the ink: paper fill, pattern, texture, sheets of a
 *  sectioned paper, the mindmap camera's paper, height and resizing.
 *  Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const canvas = require('../../lib/sketchcanvas.js');
const { SVGNS, svgEl, bgPatternTile, paperTexDefsStr, PAPER_MODES } = require('../../lib/sketchsvg.js');

class SurfacePaper {

  /* Transparent paper ("native", bg='') → let the host element paint the note's
     own background (CSS var), so it truly matches the surrounding note instead of
     whatever container happens to sit behind the transparent SVG. */
  _applyPaperClass() {
    if (this.host && this.host.classList) this.host.classList.toggle('nx-sk-nativebg', !this.bg);
  }

  /* Parse an SVG-markup string into a live <defs> node and return it (same trick
     as the pencil filter — lets multi-element tiles/filters share one source of
     truth with the export). null on parse failure. */
  _parseDefs(inner) {
    try {
      const doc = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}"><defs>${inner}</defs></svg>`, 'image/svg+xml');
      const dfs = doc.querySelector('defs');
      if (!dfs || doc.querySelector('parsererror')) return null;
      return document.importNode(dfs, true);
    } catch (e) { return null; }
  }

  /* Where paper actually IS, in canvas units. Endless is one rectangle the size
     of the sheet; sectioned is one per A4 page, with the gaps deliberately left
     unpainted so the sheets read as separate pieces of paper; a plane is a
     rectangle around the camera, kept in step by _syncInfinitePaper. */
  _paperRects() {
    if (this.infinite) return [this._cameraRect()];
    if (this.paperType === 'sectioned')
      return canvas.sheetPages(this.W, this.H, this.sheetLandscape)
        .map(pg => ({ x: 0, y: pg.y, w: this.W, h: pg.h }));
    return [{ x: 0, y: 0, w: this.W, h: this.H }];
  }
  /* Half a view of slack on every side, so a pan never outruns the paper between
     two frames. Kept small on purpose: one enormous rectangle would tile its
     pattern across hundreds of thousands of units and lose precision doing it. */
  _cameraRect(vh) {
    const h = (vh == null) ? this._vh() : vh;
    return { x: this.viewX - this.viewW / 2, y: this.viewY - h / 2, w: this.viewW * 2, h: h * 2 };
  }
  _syncInfinitePaper(vh) {
    if (!this.infinite) return;
    const r = this._cameraRect(vh);
    for (const g of [this.gPaper, this.gTex, this.gGrid]) {
      if (!g) continue;
      for (const el of g.children) {
        el.setAttribute('x', r.x); el.setAttribute('y', r.y);
        el.setAttribute('width', r.w); el.setAttribute('height', r.h);
      }
    }
  }
  /* The hairline around a sectioned page. An exported .svg has no stylesheet, so
     this is a literal rather than a class — the page edge is the whole point of
     sectioned paper and it has to survive leaving the vault. */
  _sheetEdge() {
    // Transparent paper does not know what it is lying on, so it borrows the
    // trick the native GRID already uses: a mid grey reads on light and on dark.
    if (!this.bg) return 'rgba(128,128,128,0.7)';
    return (PAPER_MODES[this.paper] || {}).dark ? 'rgba(255,255,255,0.26)' : 'rgba(0,0,0,0.28)';
  }
  _fillLayer(g, attrs) {
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    for (const r of this._paperRects())
      g.appendChild(svgEl('rect', Object.assign({ x: r.x, y: r.y, width: r.w, height: r.h }, attrs)));
  }
  /* The solid paper colour. '' (native paper) paints nothing and lets the host
     element show the note's own background — except on sectioned paper, where
     the page edge still has to be drawn or there are no pages to see. */
  _buildPaperFill() {
    const g = this.gPaper;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const edged = this.paperType === 'sectioned';
    if (!this.bg && !edged) return;
    const attrs = { fill: this.bg || 'none' };
    if (edged) {
      attrs.stroke = this._sheetEdge();
      attrs['stroke-width'] = Math.max(1, this.W / 800);
      /* Transparent paper cut into sheets still has to look like sheets on a
         desk, and the only colour that can tell them apart is the theme's own —
         so the live pad takes its fill from CSS. An exported file has no theme
         and stays honestly transparent; the edge is what carries the page there. */
      attrs.class = this.bg ? 'nx-sk-sheet' : 'nx-sk-sheet is-native';
    }
    this._fillLayer(g, attrs);
  }

  _buildBg() {
    if (this._defs) { this._defs.remove(); this._defs = null; }
    if (this.gGrid) while (this.gGrid.firstChild) this.gGrid.removeChild(this.gGrid.firstChild);
    if (this.bgType === 'none' || !this.bgOpacity) return;
    const tile = bgPatternTile(this.bgType, this.bgSize, this.bgColor, this.bgOpacity);
    if (!tile) return;
    const defs = this._parseDefs(`<pattern id="${this._pid}" width="${tile.w}" height="${tile.h}" patternUnits="userSpaceOnUse">${tile.inner}</pattern>`);
    if (!defs) return;
    this._defs = defs;
    this.svg.insertBefore(defs, this.svg.firstChild);
    this._fillLayer(this.gGrid, { fill: `url(#${this._pid})` });
  }

  /* Paper-grain overlay (paper-style toggle) — sits above the solid fill, below
     the grid + ink. Rebuilt only on paper/style change (never on the bg slider),
     so the feTurbulence tile is parsed once, not per drag. */
  _buildPaperTex() {
    if (this._texDefs) { this._texDefs.remove(); this._texDefs = null; }
    if (this.gTex) while (this.gTex.firstChild) this.gTex.removeChild(this.gTex.firstChild);
    if (!this.paperStyle) return;
    const defs = this._parseDefs(paperTexDefsStr(this._texFilt, this._texPat));
    if (!defs) return;
    this._texDefs = defs;
    this.svg.insertBefore(defs, this.svg.firstChild);
    this._fillLayer(this.gTex, { fill: `url(#${this._texPat})`, style: 'mix-blend-mode:multiply' });
  }
  _buildPaperLayers() { this._buildPaperFill(); this._buildPaperTex(); this._buildBg(); }

  /* The pad says which paper it is so the CSS can stop the Sketch tab scrolling
     a plane that has nothing to scroll, and hide the resize strip on it. */
  _applyPaperTypeClass() {
    if (!this.host || !this.host.classList) return;
    this.host.classList.toggle('nx-sk-infinite', this.infinite);
    this.host.classList.toggle('nx-sk-sectioned', this.paperType === 'sectioned');
  }
  /* A plane's camera has the element's aspect ratio, so a pane getting wider or a
     tablet being turned has to re-shape it — otherwise preserveAspectRatio:none
     stretches the drawing. A sheet needs none of this: its ratio is its own. */
  _observeSize() {
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    if (!this.infinite || typeof ResizeObserver !== 'function' || !this.host) return;
    this._ro = new ResizeObserver(() => this._applyView());
    try { this._ro.observe(this.host); }
    catch (e) {
      // Without it the camera keeps the aspect it had, which is wrong the moment
      // the pane is resized — worth a line in the console, not a broken pad.
      console.error('Nexus: the mindmap camera cannot follow this pane being resized', e);
      try { this._ro.disconnect(); } catch (err) {}
      this._ro = null;
    }
  }

  _buildResizeHandle() {
    const h = document.createElement('div');
    h.className = 'nx-sketch-resize';
    h.setAttribute('aria-label', 'Drag to resize');
    this.host.appendChild(h);
    let startY = 0, startPxH = 0, pxW = 0;
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = this.host.getBoundingClientRect();
      startY = e.clientY; startPxH = r.height; pxW = r.width;
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
      this._resizing = true;
    });
    h.addEventListener('pointermove', (e) => {
      if (!this._resizing) return;
      const newPxH = startPxH + (e.clientY - startY);
      this.setHeight(Math.round(this.W * newPxH / pxW));   // setHeight clamps to content
    });
    const end = () => { if (!this._resizing) return; this._resizing = false; this._changed(); };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }

  /* Lowest point of any stroke (+ its half-width) → the canvas can never be
     shrunk below this, so drawn content is never clipped off the bottom. */
  _contentMinHeight() {
    let maxY = 0;
    for (const st of this.strokes) {
      const r = (st.size || 6) / 2;
      for (const p of st.points) { const y = p[1] + r; if (y > maxY) maxY = y; }
    }
    return Math.max(120, Math.ceil(maxY) + 8);
  }
  setHeight(H) {
    if (this.infinite) return;                  // a plane has no bottom edge to move
    H = Math.max(this._contentMinHeight(), H);
    // Sectioned paper only ever ends at a page edge: half a sheet is not
    // something anyone can print, and a partial page reads as a bug.
    if (this.paperType === 'sectioned') H = canvas.snapSheetHeight(this.W, H, this.sheetLandscape);
    this.H = H;
    this.svg.setAttribute('height', this.H);   // updates intrinsic ratio → CSS height:auto follows
    this._buildPaperLayers();                   // endless grows its rect, sectioned gains a page
    this._applyView();                          // viewBox follows the new height (keeps pan/zoom valid)
  }

  /* Endless paper has a fixed width by definition: without a cap the same note
     renders at a different ink size in portrait and in landscape, which is the
     "everything got huge when I rotated the tablet" complaint. 0 = fill. */
  setPaperWidth(px) {
    this.paperWidth = px > 0 ? px : 0;
    this._applyPaperWidth();
  }
  _applyPaperWidth() {
    if (!this.host || !this.host.style) return;
    // A plane fills whatever it is given: the cap exists to keep a SHEET the same
    // width in portrait and landscape, and a camera has no sheet to cap.
    if (this.infinite) { this.host.style.maxWidth = ''; this.host.style.marginInline = ''; return; }
    // A zoomed sheet owns its own width — the cap applies to the resting state.
    if (this.pageScale !== 1) return;
    if (!this.paperWidth) { this.host.style.maxWidth = ''; this.host.style.marginInline = ''; return; }
    this.host.style.maxWidth = this.paperWidth + 'px';
    this.host.style.marginInline = 'auto';
  }
  // Rebuild-only (no persist) so slider drags stay cheap; caller calls persist()
  // on release.
  setBackground(type, size, opacity) {
    if (type != null) this.bgType = type;
    if (size != null) this.bgSize = size;
    if (opacity != null) this.bgOpacity = opacity;
    this._buildBg();
  }
  /* Toggle the paper-grain texture overlay on/off (works on any paper colour). */
  setPaperStyle(on) { this.paperStyle = !!on; this._buildPaperTex(); }
  /* Switch what shape the paper is.
       to a plane   page zoom is undone WHILE IT IS STILL A SHEET (afterwards
                    setPageZoom means something else entirely) and parked; the
                    camera starts at the top of what the sheet was showing, and
                    that is where the trip home leads.
       to a sheet   page zoom comes back at 1×, and anything the plane let you
                    draw in negative space is moved into the sheet rather than
                    left where a sheet can neither show it nor export it.
     Re-picking the paper it already is does NOTHING — the chip in the popover
     fires on every tap, and a second tap must not move home to wherever you had
     panned to since the first. */
  setPaperType(type, landscape) {
    if (canvas.PAPER_TYPES.indexOf(type) < 0) return;
    const wasType = this.paperType, wasLandscape = this.sheetLandscape;
    if (type === wasType && (landscape == null || !!landscape === wasLandscape)) return;
    const was = this.infinite;
    // While `infinite` is still false this resets the SHEET's zoom, which is the
    // only moment it can be reset at all.
    if (!was) this.setPageZoom(1);
    if (landscape != null) this.sheetLandscape = !!landscape;
    this.paperType = type;
    this.infinite = type === 'mindmap';
    if (this.infinite) {
      this.pageZoom = false;
      if (!was) {
        this.viewX = 0; this.viewY = 0; this.viewW = this.W;
        this._home = { x: this.viewX, y: this.viewY, w: this.viewW };
      }
    } else {
      this.pageZoom = this._pageZoomWanted;
      this.pageScale = 1;
      this._pzBase = 0;
      if (this.host && this.host.style) this.host.style.width = '';
      this._applyPaperWidth();
      this.viewX = 0; this.viewY = 0; this.viewW = this.W;
      if (was) this._reclaimNegativeSpace();
      /* Turning the paper keeps the number of SHEETS, not the number of units:
         two pages that silently become four because A4 got shorter is not what
         "landscape" means. Everything else keeps the length it had, and
         setHeight lands it on a page edge. */
      if (type === 'sectioned' && wasType === 'sectioned' && wasLandscape !== this.sheetLandscape) {
        const pages = canvas.sheetCount(this.W, this.H, wasLandscape);
        this.H = pages * canvas.sheetPitch(this.W, this.sheetLandscape) - canvas.sheetGap(this.W);
      }
      this.setHeight(this.H);
    }
    this._applyPaperTypeClass();
    this._buildPaperLayers();
    this._applyView();
    this._observeSize();
    if (this.onPaperType) {
      try { this.onPaperType(this.paperType); }
      catch (e) { console.error('Nexus: the host could not follow the paper type "' + this.paperType + '"', e); }
    }
    if (this.onZoom) this.onZoom(this.getPageZoom());
  }
  /* Switch the paper preset (native/white/black): swaps the solid fill rect and
     repaints the pattern in the mode's matching grid colour. */
  setPaper(mode) {
    if (!PAPER_MODES[mode]) return;
    this.paper = mode;
    this.bg = PAPER_MODES[mode].bg;
    this.bgColor = PAPER_MODES[mode].grid;
    this._buildPaperLayers();   // fill, grain and pattern all follow the new mode
    this._applyPaperClass();
    const wasInv = this._inkInv;
    this._updateInvert();
    if (this._inkInv !== wasInv) this._renderStrokes();   // dark↔light: repaint ink in the (un)inverted colour
  }
}

module.exports = SurfacePaper;
