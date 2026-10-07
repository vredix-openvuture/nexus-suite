'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · fingers
 *  Touch input that is not drawing: pan, pinch, fling, sideways page throws,
 *  and the finger taps (undo, redo, page width, back to the start).
 *  Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const canvas = require('../../lib/sketchcanvas.js');
const { PALM_MS, TAP_MS, TAP_SLOP_PX, MULTITAP_MS, MULTITAP_R, SWIPE_PX, SWIPE_RATIO, SWIPE_MS } = require('./tuning.js');

class SurfaceTouch {

  /* ── Finger gestures — fingers NEVER draw:
        1 finger          = pan the canvas (viewBox sub-rect)
        2 fingers parallel = scroll the PAGE (the note's scroller — the whole
                             code block moves, like normal note scrolling)
        2 fingers pinching = zoom the canvas
        A burst that lifts without travelling is a TAP instead — see
        _registerTap for what one, two and three of them mean.
        Palm rejection: any touch arriving within PALM_MS of pen contact/hover
        is ignored outright, and a pen-down clears any finger gesture. ── */
  _touchDown(e) {
    this._stopFling();   // a finger down means "stop", always
    if (this._active || this._erasing) return;                          // pen is drawing → ignore stray finger
    /* Palm rejection, keyed on pen CONTACT. It used to count pen HOVER too —
       "a palm lands while the pen approaches" — but on a pen tablet the pen is
       in your hand above the glass the whole time, so hovering vetoed every
       finger gesture, taps included. A palm that lands just before the nib is
       still caught: _onDown clears the touches (and the tap) the moment the pen
       actually touches down. */
    if (performance.now() - this._lastPen < PALM_MS) { this._tap = null; return; }
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    // sx/sy is where this finger LANDED — a tap is judged against it, x/y follows the move.
    this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (this._touches.size === 1) {
      // A fresh burst. `max` is how many fingers were EVER down at once in it,
      // which is what gives a 3-finger tap its meaning after two have lifted.
      this._tap = { t0: performance.now(), max: 1, moved: false, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
      this._startOneFinger();
    } else if (this._touches.size === 2) {
      if (this._tap) this._tap.max = Math.max(this._tap.max, 2);
      // Undecided until the fingers move: distance change → zoom, parallel → page scroll.
      const [a, b] = [...this._touches.values()];
      this._gestMode = 'pending';
      this._pending = { d: Math.hypot(b.x - a.x, b.y - a.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this._scroller = this._findScroller();
      this._scrollStart = this._scroller ? { top: this._scroller.scrollTop, left: this._scroller.scrollLeft } : null;
    } else if (this._tap) {
      this._tap.max = Math.max(this._tap.max, this._touches.size);
    }
  }
  _touchMove(e) {
    const t = this._touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (this._tap) {
      if (!this._tap.moved && Math.hypot(t.x - t.sx, t.y - t.sy) > TAP_SLOP_PX) this._tap.moved = true;
      this._tap.lx = t.x; this._tap.ly = t.y;   // where the burst ended — a swipe is judged on it
    }
    if (this._gestRaf) return;
    this._gestRaf = requestAnimationFrame(() => { this._gestRaf = null; this._applyGesture(); });
  }
  _touchUp(e) {
    if (!this._touches.delete(e.pointerId)) return;
    // On a plane the camera pan is the scroll, so it is what coasts on release.
    const wasScroll = this._gestMode === 'scroll' || (this.infinite && this._gestMode === 'pan');
    if (this._touches.size === 1) this._startOneFinger();
    else if (!this._touches.size) {
      this._gestMode = null;
      const tap = this._tap;
      this._tap = null;
      if (tap && !tap.moved && performance.now() - tap.t0 < TAP_MS) this._registerTap(tap.max, tap.x, tap.y);
      else if (tap && this._swipe(tap)) return;   // a page turn is not also a fling
      if (wasScroll) this._fling();
    }
  }

  /* One finger thrown sideways = the next page (or the previous one). Reported,
     never acted on here: the engine draws, what a page IS belongs to whoever
     mounted it. Returns true when it took the gesture. */
  _swipe(tap) {
    if (!this.onSwipe || tap.max !== 1) return false;
    if (this.infinite) return false;   // on a plane a sideways throw is how you get about
    if (Math.abs(this.pageScale - 1) > 0.01) return false;   // zoomed: sideways is looking around
    if (performance.now() - tap.t0 > SWIPE_MS) return false;
    const dx = tap.lx - tap.x, dy = tap.ly - tap.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return false;
    this._stopFling();
    this.onSwipe(dx < 0 ? 'next' : 'prev');
    return true;
  }

  /* ── Finger taps ────────────────────────────────────────────────────────────
        one finger, twice   = undo
        one finger, 3×      = redo
        two fingers, twice  = back to page width
        two fingers, 3×     = back to where the drawing was opened (goHome)
        three fingers, once = back to page width, for anyone whose OS lets three
                              touches through

     Two fingers carry the zoom reset because three simultaneous touches are a
     system gesture on a lot of Android tablets and never reach a web page at
     all. A SINGLE two-finger tap stays free: that is where a pinch begins and
     ends, and it must not mean anything on its own.

     Undo waits out the multi-tap window before it fires — otherwise every
     triple tap would undo on its way to the redo. The delay is the price of
     having both on the same finger.

     Palm rejection guards all of this: a tap within PALM_MS of the pen touching
     down never reaches _touchDown, so a hand resting mid-sentence cannot undo
     anything. */
  _clearTapSeq() {
    if (this._tapSeq && this._tapSeq.timer) window.clearTimeout(this._tapSeq.timer);
    this._tapSeq = null;
  }
  /* A tap gesture leaves no trace of its own — an undo of a stroke you had
     forgotten looks exactly like nothing happening. So each one says what it
     did, briefly, on the pad itself. It is also the only way to tell "the tap
     was not recognised" from "the tap did nothing". */
  _flashTap(text) {
    if (!this.host) return;
    let el = this._tapFlash;
    if (!el || !el.isConnected) {
      el = document.createElement('div');
      el.className = 'nx-sk-tapflash';
      this.host.appendChild(el);
      this._tapFlash = el;
    }
    el.textContent = text;
    el.classList.remove('is-on');
    void el.offsetWidth;            // restart the fade instead of extending it
    el.classList.add('is-on');
    window.clearTimeout(this._tapFlashT);
    this._tapFlashT = window.setTimeout(() => el.classList.remove('is-on'), 850);
  }

  _registerTap(fingers, x, y) {
    if (fingers >= 3) { this._clearTapSeq(); this._resetZoom(); return; }
    if (fingers > 2) { this._clearTapSeq(); return; }
    const now = performance.now();
    const prev = this._tapSeq;
    // A run is same-place, same-time AND same number of fingers: one finger then
    // two is two gestures, not a double tap.
    const runs = prev && prev.fingers === fingers
      && (now - prev.t) < MULTITAP_MS
      && Math.hypot(x - prev.x, y - prev.y) < MULTITAP_R;
    const n = runs ? prev.n + 1 : 1;
    this._clearTapSeq();

    if (fingers === 2) {
      // Three is "take me back", so two has to wait out the window the same way
      // the one-finger undo does — otherwise the zoom reset would fire on the
      // way to it and the trip home would start from somewhere else.
      if (n >= 3) { this.goHome(); this._flashTap(this.infinite ? 'Origin' : 'Top of the page'); return; }
      this._tapSeq = { n, fingers, t: now, x, y, timer: null };
      if (n === 2) {
        const seq = this._tapSeq;
        seq.timer = window.setTimeout(() => {
          if (this._tapSeq === seq) this._tapSeq = null;
          this._resetZoom();
        }, MULTITAP_MS);
      }
      return;
    }
    if (this.locked) return;                       // view mode: read-only, so no undo
    if (n >= 3) { this.redo(); this._flashTap('Redo'); return; }
    this._tapSeq = { n, fingers, t: now, x, y, timer: null };
    if (n === 2) {
      const seq = this._tapSeq;
      seq.timer = window.setTimeout(() => {
        if (this._tapSeq === seq) this._tapSeq = null;
        this.undo();
        this._flashTap('Undo');
      }, MULTITAP_MS);
    }
  }

  /* ctrl/⌘ + wheel = page zoom. Without the modifier the wheel stays the page's,
     so scrolling a note that contains a sketch is never hijacked. */
  _onWheel(e) {
    /* A plane has no scroller to hand the wheel back to, so the wheel is the
       camera: plain scrolls it, shift scrolls it sideways, ctrl/⌘ zooms. */
    // View mode hands the wheel back, the same exception _startOneFinger makes
    // for one finger: a map read inside a note must not swallow its scrolling.
    if (this.infinite && !this.locked) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { this._zoomView(Math.exp(e.deltaY / 300), e.clientX, e.clientY); return; }
      const u = this._uPerPx();
      this.viewX += (e.shiftKey ? e.deltaY : e.deltaX) * u;
      this.viewY += (e.shiftKey ? 0 : e.deltaY) * u;
      this._applyView();
      return;
    }
    if (!this.pageZoom || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.setPageZoom(this.pageScale * Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
  }
  /* A drag-scroll that stops the moment the finger lifts is what made this feel
     slower than the note around it — every native scroller coasts. Same input,
     same throw: velocity from the tail of the drag, then decay to a stop. */
  _fling() {
    const samples = this._scrollSamples;
    this._scrollSamples = null;
    this._stopFling();
    const sc = this.infinite ? null : this._scroller;
    if (!samples || (!sc && !this.infinite)) return;
    let vy = -canvas.flingVelocity(samples, 'y');
    let vx = -canvas.flingVelocity(samples, 'x');
    if (!vy && !vx) return;
    // A scroller coasts in pixels; a camera coasts in canvas units, and the
    // conversion is fixed for the throw because the zoom cannot change mid-fling.
    const u = this.infinite ? this._uPerPx() : 1;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(48, now - last);   // a backgrounded tab must not teleport the page
      last = now;
      const sy = canvas.flingStep(vy, dt);
      const sx = canvas.flingStep(vx, dt);
      if (this.infinite) { this.viewX += sx.move * u; this.viewY += sy.move * u; this._applyView(); }
      else { sc.scrollTop += sy.move; sc.scrollLeft += sx.move; }
      vy = sy.v; vx = sx.v;
      this._flingRaf = (vy || vx) ? requestAnimationFrame(step) : null;
    };
    this._flingRaf = requestAnimationFrame(step);
  }
  _stopFling() {
    if (this._flingRaf) { cancelAnimationFrame(this._flingRaf); this._flingRaf = null; }
  }
  /* One finger: pans the canvas ONLY while zoomed in; otherwise it scrolls the
     page/stage. An un-zoomed pan is a no-op, so a one-finger drag should scroll
     the note (reading) or the Sketch tab's stage (editing) — the pen
     draws, the finger navigates. */
  _startOneFinger() {
    const f = [...this._touches.values()][0];
    /* A plane is panned by one finger at every zoom level — there is no scroller
       under it and no page width to fall back to. The exception is view mode: a
       map read inside a note must not swallow the scroll of the note it is in,
       so there one finger scrolls and two fingers look around. */
    if (this.infinite ? this.locked : this.viewW >= this.W - 0.5) {
      this._gestMode = 'scroll';
      this._pending = { cx: f.x, cy: f.y };
      this._scroller = this._findScroller();
      this._scrollStart = this._scroller ? { top: this._scroller.scrollTop, left: this._scroller.scrollLeft } : null;
    } else {
      this._gestMode = 'pan';
      this._gestureRef();
    }
  }
  /* Nearest scrollable ancestor = the note's scroller (works in Live Preview
     and Reading mode without naming Obsidian's classes). */
  _findScroller() {
    let el = this.svg.parentElement;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 4) {
        const o = getComputedStyle(el).overflowY;
        if (o === 'auto' || o === 'scroll') return el;
      }
      el = el.parentElement;
    }
    return null;
  }
  _gestureRef() {
    const r = this.svg.getBoundingClientRect();
    const vh = this._vh();
    const pts = [...this._touches.values()].map(p => ({ x: p.x, y: p.y }));
    this._gesture = {
      e: { left: r.left, top: r.top, w: r.width || 1, h: r.height || 1 },
      anchors: pts.map(p => ({
        cx: this.viewX + (p.x - r.left) / (r.width || 1) * this.viewW,
        cy: this.viewY + (p.y - r.top) / (r.height || 1) * vh,
      })),
    };
  }
  _applyGesture() {
    const live = [...this._touches.values()];
    if (this._gestMode === 'pan' && live.length) {
      const g = this._gesture; if (!g || !g.anchors.length) return;
      const a = g.anchors[0], f = live[0], e = g.e;
      this.viewX = a.cx - (f.x - e.left) / e.w * this.viewW;
      this.viewY = a.cy - (f.y - e.top) / e.h * this._vh();
      this._applyView();
      // On a plane the pan IS the scroll, so it is what gets thrown on release.
      if (this.infinite) {
        (this._scrollSamples = this._scrollSamples || []).push({ t: performance.now(), x: f.x, y: f.y });
        if (this._scrollSamples.length > 12) this._scrollSamples.shift();
      }
      return;
    }
    if (!live.length) return;
    // Centroid over the active fingers (1 → the finger itself, 2 → midpoint).
    const cx = live.length >= 2 ? (live[0].x + live[1].x) / 2 : live[0].x;
    const cy = live.length >= 2 ? (live[0].y + live[1].y) / 2 : live[0].y;
    if (live.length >= 2) {
      const f0 = live[0], f1 = live[1];
      const d = Math.hypot(f1.x - f0.x, f1.y - f0.y) || 1;
      if (this._gestMode === 'pending') {
        if (Math.abs(d - this._pending.d) > 24) {
          this._gestMode = 'zoom';
          if (this.pageZoom) this._pzStart = { s: this.pageScale, d: this._pending.d || d };
          else this._gestureRef();
        }
        else if (Math.hypot(cx - this._pending.cx, cy - this._pending.cy) > 12) {
          // Two fingers travelling together scroll the page — unless there is no
          // page, in which case they move the camera like one finger does.
          if (this.infinite) { this._gestMode = 'pan'; this._gestureRef(); }
          else this._gestMode = 'scroll';
        }
        else return;   // not decided yet
      }
      if (this._gestMode === 'zoom') {
        if (this.pageZoom) {
          const z = this._pzStart;
          if (z) this.setPageZoom(z.s * (d / (z.d || 1)), cx, cy);
          return;
        }
        const g = this._gesture; if (!g || g.anchors.length < 2) return;
        const a0 = g.anchors[0], a1 = g.anchors[1], e = g.e;
        const ca = Math.hypot(a1.cx - a0.cx, a1.cy - a0.cy) || 1;
        this.viewW = this._clampViewW(ca * e.w / d);
        this.viewX = a0.cx - (f0.x - e.left) / e.w * this.viewW;
        this.viewY = a0.cy - (f0.y - e.top) / e.h * this._vhFor(this.viewW);
        this._applyView();
        if (this.infinite && this.onZoom) this.onZoom(this.getPageZoom());
        return;
      }
    }
    if (this._gestMode === 'scroll' && this._scroller && this._scrollStart) {
      this._scroller.scrollTop = this._scrollStart.top - (cy - this._pending.cy);
      this._scroller.scrollLeft = this._scrollStart.left - (cx - this._pending.cx);
      // Keep the tail of the drag: on lift it becomes the throw (see _fling).
      (this._scrollSamples = this._scrollSamples || []).push({ t: performance.now(), x: cx, y: cy });
      if (this._scrollSamples.length > 12) this._scrollSamples.shift();
    }
  }
}

module.exports = SurfaceTouch;
