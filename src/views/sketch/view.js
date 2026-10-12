'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · zoom and the visible area
 *  Page zoom and the mindmap camera: what part of the drawing is on screen,
 *  and going back to the start. Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const canvas = require('../../lib/sketchcanvas.js');
const { PAGE_ZOOM_MAX, PAGE_ZOOM_MIN, INF_ZOOM_IN, INF_ZOOM_OUT } = require('./tuning.js');

class SurfaceView {

  /* Says so even when it was already at 1×: the point of the gesture is knowing
     it was seen, and "nothing happened" and "not recognised" look the same. */
  _resetZoom() {
    this.setPageZoom(1);
    this._flashTap(this.infinite ? 'Zoom 100%' : 'Page width');
  }

  /* Back to the start. On a sheet that is the top of the paper — the one place
     an endless page has. On a plane there is no top, so it is the camera the pad
     was opened with, which is what makes it possible to get lost on purpose. */
  goHome() {
    this._stopFling();
    if (this.infinite) {
      const h = this._home;
      if (h) { this.viewX = h.x; this.viewY = h.y; this.viewW = h.w; }
      this._applyView();
      if (this.onZoom) this.onZoom(this.getPageZoom());
      return true;
    }
    this.viewX = 0; this.viewY = 0;
    this._applyView();
    const sc = this._findScroller();
    if (!sc) return false;
    const rect = this.host.getBoundingClientRect();
    const scRect = sc.getBoundingClientRect();
    sc.scrollLeft = 0;
    sc.scrollTop += (rect.top - scRect.top) - 8;
    return true;
  }
  /* Magnify the sheet itself. `s` is clamped to [PAGE_ZOOM_MIN … PAGE_ZOOM_MAX]:
     out shrinks the sheet inside the pane for an overview of a long page, in
     widens it past the pane and the surrounding scroller takes over. 1 is the
     normal, exactly-page-width state. The pad is sized in real pixels
     off its own width at scale 1, so the result is identical on every screen,
     and the SVG re-renders sharp at the new size instead of being upscaled.
     (ax, ay) is the point on screen to hold still — the pinch centroid. */
  /* Zoom a CAMERA about a point on screen. The plane's counterpart to
     setPageZoom: nothing is resized, the view just takes in more or less. */
  _zoomView(factor, ax, ay) {
    const r = this.svg.getBoundingClientRect();
    const fx = r.width ? (((ax != null) ? ax : r.left + r.width / 2) - r.left) / r.width : 0.5;
    const fy = r.height ? (((ay != null) ? ay : r.top + r.height / 2) - r.top) / r.height : 0.5;
    const before = this.viewW;
    const v = canvas.zoomAbout({ x: this.viewX, y: this.viewY, w: this.viewW, h: this._vh() },
      factor, fx, fy, this.W / INF_ZOOM_IN, this.W * INF_ZOOM_OUT);
    this.viewX = v.x; this.viewY = v.y; this.viewW = v.w;
    this._ctmInv = null;
    this._applyView();
    if (this.viewW !== before && this.onZoom) this.onZoom(this.getPageZoom());
  }
  setPageZoom(s, ax, ay) {
    if (this.infinite) {
      // "100 %" on a plane means one logical canvas width across the pane, which
      // is the same thing page width means on a sheet.
      if (s > 0) this._zoomView((this.W / s) / this.viewW, ax, ay);
      return;
    }
    if (!this.pageZoom) return;
    s = Math.max(PAGE_ZOOM_MIN, Math.min(PAGE_ZOOM_MAX, s));
    const sc = this._findScroller();
    const r = this.host.getBoundingClientRect();
    const anchorX = (ax != null) ? ax : r.left + r.width / 2;
    const anchorY = (ay != null) ? ay : r.top;
    const fx = r.width ? (anchorX - r.left) / r.width : 0.5;
    const fy = r.height ? (anchorY - r.top) / r.height : 0;
    const prevScale = this.pageScale;
    const changed = prevScale !== s;
    this.pageScale = s;
    if (s === 1) {
      this._pzBase = 0;
      this.host.style.width = '';
      this._applyPaperWidth();   // back to the resting sheet width, cap included
    } else {   // magnified OR shrunk — both need an explicit pixel width
      // Natural width = what it measures NOW divided by the scale it is at now,
      // which is the scale BEFORE this call, not the one being applied.
      if (!this._pzBase) this._pzBase = r.width / (prevScale || 1);
      this.host.style.maxWidth = 'none';   // the stage centres+caps the pad at 1×; zoomed it must be free to overflow
      this.host.style.width = Math.round(this._pzBase * s) + 'px';
    }
    if (sc) {
      const r2 = this.host.getBoundingClientRect();
      sc.scrollLeft = Math.max(0, sc.scrollLeft + (r2.left + fx * r2.width) - anchorX);
      sc.scrollTop = Math.max(0, sc.scrollTop + (r2.top + fy * r2.height) - anchorY);
    }
    this._ctmInv = null;   // the screen→viewBox matrix just changed
    if (changed && this.onZoom) this.onZoom(s);
  }
  /* How tall the view is, for a given width. A sheet takes it from the canvas
     ratio (the element has that ratio too); a plane takes it from the ELEMENT,
     because there is no canvas to get it from — and preserveAspectRatio is
     "none", so a mismatch would stretch the drawing rather than letter-box it. */
  _elAspect() {
    const r = this.svg.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? r.height / r.width : this.H / this.W;
  }
  _vhFor(vw) { return this.infinite ? vw * this._elAspect() : vw * this.H / this.W; }
  _vh() { return this._vhFor(this.viewW); }
  _clampViewW(v) {
    if (this.infinite) return Math.max(this.W / INF_ZOOM_IN, Math.min(this.W * INF_ZOOM_OUT, v));
    return Math.max(this.W / 6, Math.min(this.W, v));
  }
  _applyView() {
    this.viewW = this._clampViewW(this.viewW);
    const vh = this._vhFor(this.viewW);
    if (this.infinite) {
      // No edges, so nothing to clamp to: panning off the drawing is how you get
      // room for the next branch of a mindmap. `vh` is passed on rather than
      // measured again — every getBoundingClientRect here is a forced layout,
      // and this runs on every pan frame and every frame of a fling.
      this._syncInfinitePaper(vh);
    } else {
      // HARD clamp to the canvas bounds — the view must never show empty space
      // beyond an edge. (Fully zoomed out this means panning is a no-op, which is
      // the expected behavior: there is nothing to pan.)
      this.viewX = Math.max(0, Math.min(this.W - this.viewW, this.viewX));
      this.viewY = Math.max(0, Math.min(Math.max(0, this.H - vh), this.viewY));
    }
    this.svg.setAttribute('viewBox', `${this.viewX.toFixed(2)} ${this.viewY.toFixed(2)} ${this.viewW.toFixed(2)} ${vh.toFixed(2)}`);
  }
  getPageZoom() { return this.infinite ? this.W / this.viewW : this.pageScale; }

  /* ── Selection ─────────────────────────────────────────────────────────────
     Three gestures share one handler, and which one it is gets decided at
     pointer-down from where the pointer landed: on a handle → scale/rotate,
     inside the frame → move, anywhere else → draw a new marquee.

     Every transform is derived from a SNAPSHOT taken at pointer-down, never
     from the previous frame. Chaining frame to frame lets rounding accumulate,
     and a slow drag across the page would visibly drift. */
  /* Middle of what is currently on screen, in viewBox units — where a newly
     placed object belongs, rather than the middle of a page that may be metres
     long. */
  viewCenter() {
    const whole = { x: this.viewX + this.viewW / 2, y: this.viewY + this._vh() / 2 };
    if (this.infinite) return whole;
    /* A sheet's viewBox is the whole sheet; what is on screen is decided by the
       pane scrolling around it. So the visible part is the sheet's rectangle
       clipped to the scroller (or the window), mapped back into canvas units —
       otherwise a sticker placed on page six of an endless page lands on page
       three, out of sight. */
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return whole;
    const sc = this._findScroller();
    const box = sc ? sc.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const left = Math.max(r.left, box.left), right = Math.min(r.right, box.right);
    const top = Math.max(r.top, box.top), bottom = Math.min(r.bottom, box.bottom);
    if (right <= left || bottom <= top) return whole;
    return {
      x: this.viewX + ((left + right) / 2 - r.left) / r.width * this.viewW,
      y: this.viewY + ((top + bottom) / 2 - r.top) / r.height * this._vh(),
    };
  }
  _uPerPx() {
    const w = this.svg.getBoundingClientRect().width || this.W;
    return this.viewW / w;   // viewBox units per screen pixel, current zoom included
  }
}

module.exports = SurfaceView;
