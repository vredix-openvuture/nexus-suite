'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · quick sketch
 *  Vector drawing engine + SVG (de)serialization for the `quicksketch` block.
 *
 *  Storage is a plain .svg sidecar (max. independence from Obsidian): the file
 *  is a normal, standalone-viewable SVG image (background pattern + rendered
 *  <path> outlines) that ALSO carries the raw stroke data (points + pressure)
 *  as JSON inside its <metadata>. Any external tool sees an image; we read the
 *  metadata back for lossless re-editing. See toSVGString / parseSketchSVG.
 *
 *  Input goes through Pointer Events → mouse, touch AND digital pen in one
 *  code path. Pen pressure (e.pressure) drives per-point stroke width; mouse /
 *  touch fall back to a constant 0.5. Raw samples are STREAMLINED (each new
 *  point eased toward the cursor) + distance-filtered → jitter-free strokes.
 *  touch-action:none (CSS) stops the page scrolling while drawing = mobile.
 * ========================================================================== */

const { mixin } = require('../lib/mixin.js');
const canvas = require('../lib/sketchcanvas.js');
const { parseColor } = require('../lib/color.js');
const { PEN_TYPES, sketchStrokePath, recognizeShape, shapeToPoints } = require('../lib/sketchstroke.js');
const { SVGNS, LOGICAL_W, svgEl, ratioWH, pencilFilterStr, INK_LIFT_MAXV, lumInvertColor, parseSketchSVG, emptySketchSVG, sketchPresets, withSketchMeta, withSketchTitle, withSketchCover, PAPER_MODES } = require('../lib/sketchsvg.js');

/* ── The drawing surface. Pure engine: knows nothing about Obsidian. Mounted
      in a code block and in the Sketch tab — same class. ── */
class NexusSketchSurface {
  constructor(host, opts) {
    opts = opts || {};
    this.host = host;
    this.W = opts.W || LOGICAL_W;
    this.H = opts.H || Math.round(this.W * 9 / 16);
    // Paper = named background preset (native/white/black). Owns the solid fill
    // AND the pattern colour so grid/lines stay legible on it. `null` → honour the
    // raw bg/bgColor (back-compat with sketches saved before paper).
    this.paper = (opts.paper && PAPER_MODES[opts.paper]) ? opts.paper : null;
    if (this.paper) {
      this.bg = PAPER_MODES[this.paper].bg;
      this.bgColor = PAPER_MODES[this.paper].grid;
    } else {
      this.bg = opts.bg || '';
      this.bgColor = opts.bgColor || '#334155';
    }
    this.paperStyle = !!opts.paperStyle;   // paper-grain texture overlay — independent of the paper colour
    /* What SHAPE the paper is, next to what colour it is: endless | sectioned |
       mindmap. The geometry lives in lib/sketchcanvas.js; this class only draws
       it and moves over it. `infinite` is the one branch the whole engine cares
       about — with no edges there is nothing to scroll and nothing to clamp. */
    this.paperType = canvas.PAPER_TYPES.indexOf(opts.paperType) >= 0 ? opts.paperType : 'endless';
    this.sheetLandscape = !!opts.sheetLandscape;
    this.infinite = this.paperType === 'mindmap';
    this.bgType = opts.bgType || 'none';
    this.bgSize = opts.bgSize || 40;
    this.bgOpacity = (opts.bgOpacity != null) ? opts.bgOpacity : 0.12;
    this.color = opts.ink || '#2f2f2f';
    // Dark-paper mode: luminance-invert the ink so drawings stay readable on a
    // dark background (setting-gated; only paper modes flagged `dark`).
    this.invertOnDark = opts.invertOnDark !== false;
    this._updateInvert();
    // Brush size in on-screen px, remembered PER PEN (converted to logical units
    // per stroke). Switching pens restores that pen's own width.
    this.penSizes = Object.assign({ fountain: 3, ballpoint: 2, pencil: 2.5, brush: 5, calligraphy: 3.5, marker: 10 }, opts.penSizes || {});
    this.pen = PEN_TYPES[opts.pen] ? opts.pen : 'fountain';
    this.penConfig = opts.penConfig || {};               // per-pen user overrides (live object, read at stroke start)
    this.shapeSnap = opts.shapeSnap !== false;           // hold-still-after-drawing → snap to shape
    this.streamline = (opts.streamline != null) ? opts.streamline : 0.55;   // fallback if a pen defines none
    this.minDist = (opts.minDist != null) ? opts.minDist : 2;                // viewBox units between samples
    this.mode = 'draw';
    /* Selection lives here and not in the toolbar: undo, erase and a
       reload all invalidate it, and they all happen in the engine. */
    this.selectShape = 'lasso';   // lasso | rect | ellipse
    this.paperWidth = opts.paperWidth || 0;   // px cap on the sheet, 0 = fill the pane
    // Straight edge: on/off plus a fixed angle in degrees (null = follow the
    // direction the stroke starts in).
    this.ruler = { on: false, angle: null };
    /* Pen buttons and taps. The surface only DETECTS them; what each one
       does is the toolbar's business, so it reports through one callback. */
    this.penMap = opts.penMap || {};
    this.onGesture = opts.onGesture || null;
    this.selection = [];          // indices into this.strokes
    this.onSelect = opts.onSelect || null;
    // Human name for the drawing, kept IN the sidecar (not in the note) so it
    // travels with the sketch to every note that embeds it.
    this.title = opts.title || '';
    /* The book cover the capture hub draws this sketch with — {tone, pattern},
       see lib/sketchcover.js. The engine never reads it; it is carried here for
       one reason only: toSVGString writes the WHOLE metadata block, so a field
       the surface does not hold is a field the next stroke deletes. */
    this.cover = opts.cover || null;
    this.locked = !!opts.locked;                         // view mode: gestures work, drawing doesn't (see setLocked)
    this.autoGrow = !!opts.autoGrow;                     // extend the canvas down while drawing near the bottom
    // Page zoom: a pinch magnifies the PAPER — the pad element gets wider, the
    // SVG re-lays out crisply at that size and the surrounding scroller handles
    // the rest. A different thing from the viewBox zoom below, which changes
    // what is visible rather than how big the sheet is drawn.
    // Remembered separately: a mindmap zooms its CAMERA, so page zoom is off
    // there — but switching back to a sheet has to get it back.
    this._pageZoomWanted = !!opts.pageZoom;
    this.pageZoom = this._pageZoomWanted && !this.infinite;
    this.pageScale = 1;
    this.onSwipe = opts.onSwipe || null;                 // 'next' | 'prev' — a sideways throw (see _touchUp)
    // Pan/zoom viewport = the visible sub-rect of the canvas (viewBox). Aspect is
    // kept locked to W/H so the element size (height:auto) never jumps. Only pen/
    // mouse draw; fingers pan (1) / pinch-zoom (2). See _touch* below.
    this.viewX = 0; this.viewY = 0; this.viewW = this.W;
    /* Where the pad was opened. On a sheet that is simply the top; on a plane it
       is the only "here" there is, and the way back from having panned into the
       dark — see goHome(). A mindmap stores its camera in the sidecar, so "the
       point the note was opened at" survives closing it. */
    if (this.infinite && opts.view && opts.view.w > 0) {
      this.viewX = opts.view.x || 0; this.viewY = opts.view.y || 0; this.viewW = opts.view.w;
    }
    this._home = { x: this.viewX, y: this.viewY, w: this.viewW };
    this._touches = new Map();                           // active touch pointers → client coords
    // -Infinity, not 0: with 0 every touch in the app's first PALM_MS counts as
    // landing right after a pen and is dropped.
    this._lastPen = -Infinity;                           // pen CONTACT, never hover — see _touchDown
    this.onCommit = opts.onCommit || null;
    this.onZoom = opts.onZoom || null;                   // page-zoom level changed (see setPageZoom)
    this.resizable = !!opts.resizable;
    this.strokes = Array.isArray(opts.strokes) ? JSON.parse(JSON.stringify(opts.strokes)) : [];
    /* Images, stickers and sticky notes. Records are treated as IMMUTABLE:
       every change replaces one and pushes the previous array, so an undo
       step costs a few pointers instead of a copy of every embedded photo. */
    this.objects = Array.isArray(opts.objects) ? opts.objects.slice() : [];
    this.selObjects = [];   // selected object indices, alongside `selection` for strokes
    /* Named marks down the page. They are not objects and not strokes: a
       section is a place, so it is only a y and a title. That is what lets
       an outline exist for a drawing at all. Kept sorted by y. */
    this.sections = Array.isArray(opts.sections) ? opts.sections.slice().sort((a, b) => a.y - b.y) : [];
    /* Recognised handwriting: text only, no positions. It exists to make the
       drawing findable, not to be shown — a guess rendered on the page would
       look like something that was actually written there. */
    this.ocr = Array.isArray(opts.ocr) ? opts.ocr.slice() : [];
    // Pen prediction (getPredictedEvents) — on by default; the drawn tail is
    // extended toward where the OS says the pen is going. See _drawLive.
    this.predict = opts.predict !== false;
    // ms of quiet before the drawing is written back. See _changed().
    this.commitDelay = (opts.commitDelay != null) ? opts.commitDelay : 700;
    this.undoStack = []; this.redoStack = [];
    // Sectioned paper ends at a page edge from the very first frame — a pad that
    // opens on two thirds of a sheet reads as a bug, not as a setting.
    if (this.paperType === 'sectioned') this.H = canvas.snapSheetHeight(this.W, this.H, this.sheetLandscape);
    this._pid = 'nxsk-' + Math.random().toString(36).slice(2, 9);
    this._texFilt = this._pid + '-tf'; this._texPat = this._pid + '-tp';   // paper-texture def ids
    this._build();
    this._renderObjects();
    this._renderSections();
    this._renderStrokes();
  }

  _build() {
    // width/height attrs give the SVG a solid intrinsic aspect ratio so CSS
    // `width:100%; height:auto` sizes the pad EVERYWHERE — no dependency on CSS
    // `aspect-ratio`, which older mobile WebViews lack (→ 0-height, invisible pad).
    const svg = svgEl('svg', { class: 'nx-sketch-surface', viewBox: `0 0 ${this.W} ${this.H}`, width: this.W, height: this.H, preserveAspectRatio: 'none' });
    this.svg = svg;
    /* The paper is THREE stacked layers, each a group of rectangles rather than
       one rectangle: sectioned paper is many sheets, and an infinite plane is a
       rectangle that follows the camera. One group each keeps the z-order fixed
       (fill, then grain, then grid) without any insertBefore juggling. */
    this.gPaper = svgEl('g', { class: 'nx-sk-paper' });
    this.gTex = svgEl('g', { class: 'nx-sk-papertex' });
    this.gGrid = svgEl('g', { class: 'nx-sk-papergrid' });
    svg.appendChild(this.gPaper);
    svg.appendChild(this.gTex);
    svg.appendChild(this.gGrid);
    this.gObjects = svgEl('g', { class: 'nx-sk-objects' });
    this.gSections = svgEl('g', { class: 'nx-sk-sections' });
    this.gStrokes = svgEl('g', { class: 'nx-sk-committed' });
    this.livePath = svgEl('path', { class: 'nx-sk-live' });
    svg.appendChild(this.gObjects);   // below the ink — writing goes ON a photo, not under it
    svg.appendChild(this.gSections);
    svg.appendChild(this.gStrokes);
    svg.appendChild(this.livePath);
    this.gSel = svgEl('g', { class: 'nx-sk-sel' });   // marquee + frame + handles
    svg.appendChild(this.gSel);
    // Pencil grain filter — added once; only pencil strokes reference it. Guard
    // with _pfxOk so a failed parse never leaves strokes pointing at a missing
    // filter (which would make them render as nothing).
    this._pfx = this._pid + '-pf';
    this._pfxOk = false;
    try {
      const doc = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}"><defs>${pencilFilterStr(this._pfx)}</defs></svg>`, 'image/svg+xml');
      const dfs = doc.querySelector('defs');
      if (dfs && !doc.querySelector('parsererror')) { this.svg.appendChild(document.importNode(dfs, true)); this._pfxOk = true; }
    } catch (e) {}
    this.host.appendChild(svg);
    this.host._surface = this;   // commands act on the pad that is open, not on a toolbar
    this._applyPaperWidth();
    // LOW-LATENCY live layer: the in-progress stroke is drawn on a canvas
    // overlay with a desynchronized 2d context — Chrome/WebView's front-buffer
    // path that skips the compositor queue (the same trick native-feeling web
    // drawing apps use). SVG only receives the committed stroke on release;
    // updating SVG per-move rides the full compositor pipeline (~2-4 frames
    // behind the pen) no matter how fast our math is.
    //
    //  It is split in TWO: `liveCanvas` accumulates the finished chunks of the
    //  current stroke and is NEVER cleared while drawing; `tipCanvas` carries
    //  only the short moving tail and is cleared over its dirty rect alone.
    //  The old single canvas re-filled EVERY chunk of the stroke on EVERY
    //  pointer event — per-event cost grew with the length of the stroke, which
    //  is exactly why long handwriting felt heavier than short marks.
    //  Both live inside one wrapper: pen opacity / blend sit on the WRAPPER, so
    //  the two layers composite as a single group and their overlap can never
    //  stack darker than the committed stroke.
    this.liveLayer = document.createElement('div');
    this.liveLayer.className = 'nx-sk-livelayer';
    this.liveCanvas = document.createElement('canvas');
    this.liveCanvas.className = 'nx-sk-livecanvas';
    this.tipCanvas = document.createElement('canvas');
    this.tipCanvas.className = 'nx-sk-livecanvas nx-sk-tipcanvas';
    this.liveLayer.appendChild(this.liveCanvas);
    this.liveLayer.appendChild(this.tipCanvas);
    this.host.appendChild(this.liveLayer);
    this._livePaths = [];
    this._applyPaperTypeClass();
    this._buildPaperFill();
    this._buildBg();
    this._buildPaperTex();
    this._applyPaperClass();
    this._observeSize();
    this._applyView();   // a stored mindmap camera is the viewBox from the first frame

    svg.addEventListener('pointerdown', (e) => this._onDown(e));
    svg.addEventListener('pointermove', (e) => this._onMove(e));
    svg.addEventListener('pointerup', (e) => this._onUp(e));
    svg.addEventListener('pointercancel', (e) => this._onUp(e));
    // Desktop's pinch: ctrl/⌘ + wheel is what every canvas app binds, and it is
    // the ONLY zoom a mouse has — fingers are the tablet's way in.
    svg.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    if (this.resizable) this._buildResizeHandle();
  }

  /* Dark-paper ink inversion. `_inkColor` is applied everywhere a stroke colour
     is painted (live canvas, committed DOM, export) so the flip is consistent and
     non-destructive — the stored `st.color` never changes. */
  _updateInvert() { this._inkInv = this.invertOnDark && !!(PAPER_MODES[this.paper] && PAPER_MODES[this.paper].dark); }
  _inkColor(c) {
    if (!this._inkInv) return c;
    const rgb = parseColor(c);
    if (!rgb) return c;
    // Only lift near-black ink (all channels dim); vivid colours stay punchy.
    return (Math.max(rgb.r, rgb.g, rgb.b) / 255 < INK_LIFT_MAXV) ? lumInvertColor(c) : c;
  }

  /* ── public control surface (wired to the toolbar in main.js) ── */
  setColor(c) { this.color = c; }
  setSize(px) { this.penSizes[this.pen] = px; }
  getSize() { return this.penSizes[this.pen]; }
  setPen(p) { if (PEN_TYPES[p]) this.pen = p; }
  setMode(m) {
    this.mode = m;
    if (m !== 'select') { this.selection = []; this.selObjects = []; this._selDrag = null; }
    if (m !== 'space') this._spaceDrag = null;
    // The cursor has to say which tool is armed before the first stroke.
    if (this.host && this.host.classList) {
      this.host.classList.toggle('is-select', m === 'select');
      this.host.classList.toggle('is-space', m === 'space');
    }
    if (this.gSel) { if (m === 'space') this._paintSpace(); else this._paintSel(null); }
  }
  setSelectShape(k) { if (['lasso', 'rect', 'ellipse'].includes(k)) this.selectShape = k; }
  setPenMap(map) { this.penMap = map || {}; }
  setOcr(lines) {
    this.ocr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    this.persist();   // the index reads the file, so it has to be on disk
  }
  setRuler(on, angle) {
    this.ruler = { on: !!on, angle: (angle == null || angle === '') ? null : Number(angle) };
    if (this.host && this.host.classList) this.host.classList.toggle('is-ruler', this.ruler.on);
    return this.ruler;
  }
  setLocked(v) { this.locked = !!v; }
}

// The rest of the surface lives in src/views/sketch/, one file per job.
mixin(NexusSketchSurface, [
  require('./sketch/paper.js'),
  require('./sketch/touch.js'),
  require('./sketch/view.js'),
  require('./sketch/pen.js'),
  require('./sketch/live.js'),
  require('./sketch/objects.js'),
  require('./sketch/selection.js'),
  require('./sketch/space.js'),
  require('./sketch/history.js'),
  require('./sketch/export.js'),
]);

module.exports = { NexusSketchSurface, parseSketchSVG, emptySketchSVG, sketchPresets, withSketchMeta, withSketchTitle, withSketchCover, sketchStrokePath, recognizeShape, shapeToPoints, ratioWH, LOGICAL_W, PEN_TYPES };
