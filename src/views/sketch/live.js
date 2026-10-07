'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · the live layer
 *  The canvas the stroke in progress is painted on before it is committed to
 *  SVG, so drawing never waits for the DOM. Mixed into NexusSketchSurface.
 * ========================================================================== */

const { PREDICT_MAX } = require('./tuning.js');
const { sketchStrokePath } = require('../../lib/sketchstroke.js');

class SurfaceLive {

  /* Size the live canvas to the pad (device pixels) and set the viewBox→pixel
     transform. Called at stroke start (view is static during a pen stroke —
     fingers are palm-rejected) and after an auto-grow resize. */
  _setupLiveCanvas() {
    const r = this.svg.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Back only the VISIBLE slice of the canvas: an endless page must never
    // allocate a full-height live buffer (that would OOM). Clip to the scroll
    // container's viewport and offset the live layer + its transform to it. For
    // a fully visible sketch (the common code-block case) top=0/height=r.height,
    // so this is byte-for-byte the old behaviour.
    let top = 0, height = r.height;
    const sc = this._findScroller();
    if (sc && r.height > 0) {
      const cr = sc.getBoundingClientRect();
      const visTop = Math.max(r.top, cr.top), visBot = Math.min(r.bottom, cr.bottom);
      if (visBot > visTop) { top = visTop - r.top; height = visBot - visTop; }
    }
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(height * dpr));
    // Report whether the backing store was actually re-allocated — that (and
    // only that) wipes the frozen chunks, so only then must the caller repaint.
    const realloc = (this.liveCanvas.width !== w || this.liveCanvas.height !== h);
    if (realloc) {
      this.liveCanvas.width = w; this.liveCanvas.height = h;
      this.tipCanvas.width = w; this.tipCanvas.height = h;
    }
    this.liveLayer.style.top = top + 'px';
    this.liveLayer.style.bottom = 'auto';
    this.liveLayer.style.height = height + 'px';
    if (!this._lctx) this._lctx = this.liveCanvas.getContext('2d', { desynchronized: true });
    if (!this._tctx) this._tctx = this.tipCanvas.getContext('2d', { desynchronized: true });
    this._lscale = { s: w / this.viewW, x: this.viewX, y: this.viewY + top * (this.viewW / (r.width || 1)) };
    return realloc;
  }
  /* viewBox → device-pixel rect for a run of points, padded by the nib radius.
     Used as the tip layer's dirty rect so a pen event clears ~a nib, not a
     screenful. */
  _liveBBox(pts, size) {
    if (!pts || !pts.length || !this._lscale) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    const sc = this._lscale, pad = (size || 4) + 3;
    return { x: (x0 - pad - sc.x) * sc.s, y: (y0 - pad - sc.y) * sc.s, w: (x1 - x0 + pad * 2) * sc.s, h: (y1 - y0 + pad * 2) * sc.s };
  }
  _clearTip() {
    const c = this._tctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const d = this._tipDirty;
    if (d) c.clearRect(d.x - 2, d.y - 2, d.w + 4, d.h + 4);
    else c.clearRect(0, 0, this.tipCanvas.width, this.tipCanvas.height);
    this._tipDirty = null;
  }
  _paintChunk(d) {
    const ctx = this._lctx, sc = this._lscale;
    if (!ctx || !sc) return;
    ctx.setTransform(sc.s, 0, 0, sc.s, -sc.x * sc.s, -sc.y * sc.s);
    ctx.fillStyle = this._liveInk;
    ctx.globalAlpha = 1;   // translucency lives on the WRAPPER (see _onDown) → overlaps stay uniform
    ctx.fill(new Path2D(d));
  }
  /* Full rebuild of the live layer from the frozen chunk list. Only needed when
     the backing store was re-allocated or the geometry was replaced wholesale
     (shape snap) — never on the per-event hot path. */
  _repaintLive() {
    if (!this._lctx) return;
    this._lctx.setTransform(1, 0, 0, 1, 0, 0);
    this._lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    this._tipDirty = null;
    this._clearTip();
    for (const d of this._livePaths) this._paintChunk(d);
  }
  _clearLiveCanvas() {
    this._livePaths = [];
    this._pred = null;
    this._tipDirty = null;
    this.liveLayer.style.mixBlendMode = '';
    this.liveLayer.style.opacity = '';
    if (this._lctx) { this._lctx.setTransform(1, 0, 0, 1, 0, 0); this._lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height); }
    if (this._tctx) { this._tctx.setTransform(1, 0, 0, 1, 0, 0); this._tctx.clearRect(0, 0, this.tipCanvas.width, this.tipCanvas.height); }
  }
  /* INCREMENTAL live render, O(1) per pointer event.
     · Completed point ranges are frozen ONCE onto the ink layer (overlapping so
       they union seamlessly under the same fill) and then never touched again.
     · Only the short tail is redrawn per event, on its own tip layer, and only
       its dirty rect is cleared.
     The tail is extended to the RAW pen position (st._raw) so the ink visually
     touches the nib — the streamline smoothing otherwise trails it by design —
     and one more step along the PREDICTED heading, which is what removes the
     last frames of hardware latency. Neither is ever recorded in the stroke. */
  _drawLive() {
    if (!this._active || !this._lctx) return;
    const st = this._active, pts = st.points, CHUNK = 24, OVERLAP = 6;
    const baseO = { thinning: st.thinning, cap: st.cap, nib: st.nib };
    while (pts.length - this._chunkStart > CHUNK + OVERLAP) {
      const seg = pts.slice(this._chunkStart, this._chunkStart + CHUNK + OVERLAP);
      // Taper only the stroke's true START on the first chunk — interior chunk
      // boundaries must stay full-width or the stroke would pinch mid-line.
      const d = sketchStrokePath(seg, st.size, Object.assign({}, baseO, { taperStart: this._chunkStart === 0 ? st.taper : 0, taperEnd: 0, cap: 'round' }));
      if (d) { this._livePaths.push(d); this._paintChunk(d); }
      this._chunkStart += CHUNK;
    }
    const tail = pts.slice(this._chunkStart);
    if (st._raw && !st._snapped) {
      const l = tail[tail.length - 1];
      if (!l || Math.hypot(st._raw[0] - l[0], st._raw[1] - l[1]) > 0.3) tail.push(st._raw);
      const pr = this._pred;
      if (pr) {
        const dx = pr[0] - st._raw[0], dy = pr[1] - st._raw[1], L = Math.hypot(dx, dy);
        // Only ever extend FORWARD: as the pen decelerates into a stop the
        // predictor can point back along the stroke, which would draw a little
        // hook at the nib. And clamp the distance — an unbounded guess
        // overshoots on direction changes and leaves visible whiskers.
        const prev = tail.length > 1 ? tail[tail.length - 2] : null;
        const fwd = !prev || ((st._raw[0] - prev[0]) * dx + (st._raw[1] - prev[1]) * dy) >= 0;
        if (L > 0.4 && fwd) { const k = Math.min(1, PREDICT_MAX / L); tail.push([st._raw[0] + dx * k, st._raw[1] + dy * k, st._raw[2]]); }
      }
    }
    const ctx = this._tctx, sc = this._lscale;
    if (!ctx || !sc) return;
    this._clearTip();
    ctx.setTransform(sc.s, 0, 0, sc.s, -sc.x * sc.s, -sc.y * sc.s);
    ctx.fillStyle = this._liveInk;
    ctx.globalAlpha = 1;
    // Tail: start-taper only while un-chunked; end always tapers (the live nib tip).
    const d = sketchStrokePath(tail, st.size, Object.assign({}, baseO, { taperStart: this._chunkStart === 0 ? st.taper : 0, taperEnd: st.taper }));
    if (d) ctx.fill(new Path2D(d));
    this._tipDirty = this._liveBBox(tail, st.size);
  }
}

module.exports = SurfaceLive;
