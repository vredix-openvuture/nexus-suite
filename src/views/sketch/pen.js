'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · the pen
 *  Pointer input that draws: pressure, pen buttons, shape snap on hold, the
 *  stroke as it is drawn. Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const canvas = require('../../lib/sketchcanvas.js');
const gestures = require('../../lib/sketchgestures.js');
const { Platform } = require('obsidian');
const { AUTOGROW_MARGIN, AUTOGROW_LOOKAHEAD, TAP_TRAVEL, HOLD_MS, HOLD_R } = require('./tuning.js');

/* What this desktop's pen has shown so far, shared by every sketch surface.
   Some graphics tablets (a Huion under Linux/Wayland, logged 2026-10-14) hover
   as 'pen' but put the nib down as 'touch' — fixed 34.7px contact, pressure
   0.5 — so the pad read every stroke as a finger and panned. A pen seen
   hovering that has never once touched down as 'pen' is such a device, and
   its single touches are the nib. One real pen contact (a Surface, a Wacom
   that reports properly) turns the rule off for the rest of the session.
   The nib lands straight out of hover, so a touch long after the pen was last
   near the glass is a finger again (a 2-in-1's pen lying on the desk). */
const penSession = { hovered: false, reportsContact: false, lastHoverAt: -Infinity };
const NIB_AFTER_HOVER_MS = 1000;
const { PEN_TYPES, recognizeShape, shapeToPoints } = require('../../lib/sketchstroke.js');
const { splitAlpha } = require('../../lib/sketchsvg.js');

class SurfacePen {

  _invCTM() { const m = this.svg.getScreenCTM(); return m ? m.inverse() : null; }
  _pt(e) {
    // Cache the inverse screen→viewBox matrix for the whole stroke (see _onDown):
    // getScreenCTM forces a layout flush and was being called for EVERY point
    // (incl. every coalesced sample) — a real drag on mobile. It's constant
    // during a stroke (width-driven scale; auto-grow keeps it uniform), so once
    // is enough.
    const inv = this._ctmInv || this._invCTM();
    if (!inv) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    return { x: p.x, y: p.y };
  }
  _pressure(e) { return (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.5; }
  /* Preset merged with the user's per-pen overrides (settings → live object). */
  _penParams(pen) { return Object.assign({}, PEN_TYPES[pen] || PEN_TYPES.fountain, this.penConfig[pen] || {}); }

  /* ── Shape snap: hold the pen still (HOLD_MS within HOLD_R) after drawing →
        the stroke is recognized (line/triangle/rect/ellipse) and replaced by
        the clean shape. Further movement is frozen; lifting commits it. ── */
  _armHold() {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (!this.shapeSnap || this.ruler.on) return;   // a ruled stroke is already the shape it wants to be
    this._holdTimer = setTimeout(() => { this._holdTimer = null; this._trySnapShape(); }, HOLD_MS);
  }
  _trySnapShape() {
    const st = this._active;
    if (!st || st._snapped || this._erasing) return;
    const shape = recognizeShape(st.points);
    if (!shape) return;
    st.points = shapeToPoints(shape);
    st.thinning = 0; st.taper = 0;       // shapes render with a clean uniform width
    /* Keep WHAT it is, not just the points it became. Without this the snap is
       a one-way door: on pen-up a rectangle is 40 anonymous points that can
       only be scaled as a block, never re-cornered. */
    st.shape = shape;
    st._snapped = true;
    st._raw = null;
    // Full live repaint with the snapped geometry.
    this._chunkStart = 0; this._livePaths = [];
    this._repaintLive();   // drop the frozen chunks of the pre-snap shape
    this._drawLive();
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
  }

  /* Streamlined + distance-filtered point capture. Each new sample is eased
     toward the raw cursor position; samples closer than minDist are dropped.
     `force` (final point on release) bypasses both so the stroke ends exactly
     where the pen lifted. */
  _addPoint(x, y, p, force, t) {
    const st = this._active, pts = st.points;
    if (st._snapped) return;   // shape locked in — ignore further movement until release
    if (this.ruler.on && this._rulerAnchor) {
      const a = this._rulerAnchor;
      if (!this._rulerDir) this._rulerDir = canvas.rulerDirection(this.ruler.angle, a.x, a.y, x, y);
      if (this._rulerDir) {
        const q = canvas.projectToLine(a.x, a.y, this._rulerDir, x, y);
        x = q.x; y = q.y;
      } else {
        // Free ruler that has not picked a direction yet: hold at the anchor
        // rather than laying down a curve that will be contradicted.
        x = a.x; y = a.y;
      }
    }
    // Fountain character: fast strokes thin out ("dry" nib). Velocity is
    // smoothed (EMA) against sample jitter and BAKED into the recorded
    // pressure, so file + external viewers reproduce it with no pen knowledge.
    if (this._speedThin && st._raw && t != null && this._lastRawT != null) {
      const dt = Math.max(1, t - this._lastRawT);
      const v = Math.hypot(x - st._raw[0], y - st._raw[1]) / dt;   // viewBox units / ms
      this._vSm = this._vSm * 0.7 + v * 0.3;
      p = p * (1 - this._speedThin * Math.min(1, this._vSm / 3));
    }
    if (t != null) this._lastRawT = t;
    st._raw = [x, y, p];
    if (!pts.length) { pts.push([+x.toFixed(1), +y.toFixed(1), +p.toFixed(2)]); this._sm = { x, y }; return; }
    const a = 1 - ((st._sl != null) ? st._sl : this.streamline);
    this._sm.x += (x - this._sm.x) * a;
    this._sm.y += (y - this._sm.y) * a;
    const px = force ? x : this._sm.x, py = force ? y : this._sm.y;
    const last = pts[pts.length - 1];
    if (!force && Math.hypot(px - last[0], py - last[1]) < this.minDist) return;
    pts.push([+px.toFixed(1), +py.toFixed(1), +p.toFixed(2)]);
  }

  /* Report a pen gesture and let the caller decide what it means. `phase` is
     'start' or 'end' so a hold action knows when to undo itself. */
  _fireGesture(id, phase) {
    const action = this.penMap[id];
    if (!action || action === 'none' || !this.onGesture) return false;
    try { return this.onGesture(action, phase, id) !== false; } catch (err) { return false; }
  }
  /* Buttons are read on every pen event, not just pointerdown: pressing the
     barrel mid-stroke is exactly when someone wants to rub something out. */
  _checkPenButtons(e) {
    if (e.pointerType !== 'pen') return;
    // Value 4 (a second side button under Linux) only counts where the side button pans.
    const now = gestures.decodeButtons(e.buttons, this.penMap.barrel === 'panHold');
    const was = this._penButtons || { barrel: false, eraserTip: false };
    for (const id of ['barrel', 'eraserTip']) {
      if (now[id] === was[id]) continue;
      this._fireGesture(id, now[id] ? 'start' : 'end');
    }
    this._penButtons = now;
  }
  get _penSession() { return penSession; }
  _toggleHostClass(name, isOn) {
    if (this.host && this.host.classList) this.host.classList.toggle(name, isOn);
  }
  /* A touch is a finger unless it is a pen nib reported as touch (see
     penSession): recognised at pointerdown, remembered by pointer id. */
  _isFinger(e) {
    if (e.pointerType === 'mouse') return this._middlePanId === e.pointerId;
    return e.pointerType === 'touch' && !(this._nibIds && this._nibIds.has(e.pointerId));
  }
  _onDown(e) {
    this._stopFling();
    this._checkPenButtons(e);
    const isNib = e.pointerType === 'touch' && !Platform.isMobile && penSession.hovered && !penSession.reportsContact
      && performance.now() - penSession.lastHoverAt < NIB_AFTER_HOVER_MS;
    if (this._penPan(e) || this._penPanHandover(e, isNib)) return;
    // A side button pressed while hovering fires pointerdown too; only the nib is contact.
    const isSideButton = e.button === 1 || e.button === 2;
    if (e.pointerType === 'pen') { penSession.hovered = true; if (!isSideButton) penSession.reportsContact = true; }
    if (isNib && !this._touches.size) {
      (this._nibIds || (this._nibIds = new Set())).add(e.pointerId);
    }
    if (!this._isFinger(e) && e.pointerType !== 'mouse') this._lastPen = performance.now();   // contact — opens the palm window
    if (this._isFinger(e)) { this._touchDown(e); return; }            // finger = pan / page-scroll / zoom, never draws
    // Held middle button = one finger: drag the plane around, or scroll the
    // page it sits on. It is never a tap, so a double middle-click undoes nothing.
    if (e.pointerType === 'mouse' && e.button === 1) {
      e.preventDefault();
      this._middlePanId = e.pointerId;
      this._touchDown(e);
      this._tap = null;
      return;
    }
    if (this.locked) return;                                          // view mode: pen/mouse never draw or erase
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Pen wins over fingers: a palm that slipped in as a "pan" gets dropped the
    // moment the pen actually touches down.
    if (this._touches.size) { this._touches.clear(); this._gestMode = null; this._tap = null; }
    e.preventDefault();
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    this._ctmInv = this._invCTM();   // cache once per stroke (see _pt)
    if (this.mode === 'erase') {
      this._erasing = true; this._eraseSnapped = false; this._eraseBatch = [];
      if (this.eraserType === 'area') this._areaEraseStart(this._pt(e)); else this._eraseAt(this._pt(e));
      return;
    }
    if (this.mode === 'select') { this._selDown(this._pt(e), e); return; }
    if (this.mode === 'space') { this._spaceDown(this._pt(e), e); return; }
    // Insert is a placement tool driven from its options row — the pen has
    // nothing to do until something has been placed.
    if (this.mode === 'insert') return;
    const p = this._pt(e);
    // px → logical units via the current display scale, so "3px" reads as ~3px
    // on screen regardless of pad size (stroke stays resolution-independent).
    const pt = this._penParams(this.pen);
    const rectW = this.svg.getBoundingClientRect().width || this.W;
    const base = this.penSizes[this.pen] || 3;
    const size = Math.max(0.4, base * (this.W / rectW) * pt.sizeMul);
    this._active = {
      color: this.color, size, thinning: pt.thinning, taper: pt.taper || 0,
      opacity: pt.opacity, blend: pt.blend, pen: this.pen, grain: !!pt.grain,
      cap: pt.cap || 'round', nib: (pt.nib != null && pt.nib !== '') ? pt.nib : null, noStack: !!pt.noStack,
      points: [],
    };
    this._active._sl = (pt.streamline != null) ? pt.streamline : this.streamline;
    // While a pen draws, an arrow on the nib only covers the line. Only while it
    // draws: on a tablet without a screen the arrow is the only way to aim.
    this._toggleHostClass('is-pen-drawing', e.pointerType !== 'mouse');
    this._speedThin = pt.speedThin || 0;
    this._vSm = 0; this._lastRawT = e.timeStamp;
    this._chunkStart = 0;
    this._livePaths = [];
    this._pred = null;
    this._tipDirty = null;
    this._setupLiveCanvas();
    // Translucent pens draw at FULL alpha into the canvases and the WRAPPER
    // carries the opacity — the two live layers then composite as ONE group, so
    // neither a chunk seam nor the tail/chunk overlap can stack darker than the
    // committed stroke. A colour with its own alpha is hoisted the same way.
    const lk = splitAlpha(this._inkColor(this.color));
    this._liveInk = lk.color;
    const lkA = (pt.opacity != null ? pt.opacity : 1) * lk.alpha;
    this.liveLayer.style.mixBlendMode = pt.blend ? 'multiply' : '';
    this.liveLayer.style.opacity = lkA < 1 ? String(lkA) : '';
    this._lastTapPoint = { x: p.x, y: p.y };
    this._rulerAnchor = this.ruler.on ? { x: p.x, y: p.y } : null;
    this._rulerDir = null;
    this._addPoint(p.x, p.y, this._pressure(e));
    this._drawLive();
    this._holdAnchor = { x: p.x, y: p.y };
    this._armHold();
  }
  _onMove(e) {
    this._checkPenButtons(e);
    if (this._penPan(e)) return;
    // Only while the nib is actually down: a hovering pen must not veto the
    // fingers of the other hand. Read from the buttons alone — a pen without
    // pressure reports 0.5 for a held side button, which is not contact.
    const isNibDown = (e.buttons & (1 | gestures.BUTTON_ERASER)) !== 0;
    if (e.pointerType === 'pen') {
      penSession.hovered = true;
      penSession.lastHoverAt = performance.now();
      if (isNibDown) penSession.reportsContact = true;
    }
    if (e.pointerType === 'pen' && isNibDown) this._lastPen = performance.now();
    if (this._isFinger(e)) { this._touchMove(e); return; }
    if (e.pointerType === 'touch') this._lastPen = performance.now();   // a nib (see _isFinger)
    if (this._erasing) { if (this._areaErase) this._areaEraseMove(this._pt(e)); else this._eraseAt(this._pt(e)); return; }
    if (this._selDrag) { e.preventDefault(); this._selMove(this._pt(e), e); return; }
    if (this._spaceDrag) { e.preventDefault(); this._spaceMove(this._pt(e)); return; }
    if (!this._active) return;
    e.preventDefault();
    const evts = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    for (const ev of evts) { const p = this._pt(ev); this._addPoint(p.x, p.y, this._pressure(ev), false, ev.timeStamp != null ? ev.timeStamp : e.timeStamp); }
    // Where the OS thinks the pen is heading. Used ONLY to extend the drawn
    // tail (see _drawLive) — never recorded, so the saved stroke is unaffected.
    this._pred = null;
    if (this.predict && e.getPredictedEvents) {
      const pe = e.getPredictedEvents();
      if (pe && pe.length) { const q = this._pt(pe[Math.min(1, pe.length - 1)]); this._pred = [q.x, q.y, this._pressure(e)]; }
    }
    // Shape snap: any real movement re-anchors and restarts the hold timer;
    // micro-jitter within HOLD_R lets it mature.
    if (this._active._raw && this._holdAnchor && !this._active._snapped) {
      const r = this._active._raw;
      if (Math.hypot(r[0] - this._holdAnchor.x, r[1] - this._holdAnchor.y) > HOLD_R) {
        this._holdAnchor = { x: r[0], y: r[1] };
        this._armHold();
      }
    }
    // Draw DIRECTLY in the input event (no rAF wait) — with the desynchronized
    // canvas this is the lowest-latency path Chrome offers; the per-event cost
    // is tiny (cached Path2D fills + a short tail outline).
    this._drawLive();
    /* Auto-grow: keep headroom below the pen so you can keep writing downward.
       Never on a plane — setHeight is a no-op there, so the test below would be
       true for every single sample and pay for a forced layout each time. */
    if (this.autoGrow && !this.infinite) {
      const pts = this._active.points, y = pts.length ? pts[pts.length - 1][1] : 0;
      if (y > this.H - AUTOGROW_MARGIN) {
        this.setHeight(Math.ceil(y + AUTOGROW_LOOKAHEAD));
        this._ctmInv = this._invCTM();
        // Only a real re-allocation wipes the frozen chunks. The common case —
        // the visible slice is unchanged, only the paper below got longer —
        // keeps them and costs nothing.
        if (this._setupLiveCanvas()) this._repaintLive();
        this._drawLive();
      }
    }
  }
  _onUp(e) {
    this._checkPenButtons(e);   // before the pan check, so a hold action hears its release on time
    if (this._penPan(e)) return;
    if (e.pointerType === 'mouse' && this._middlePanId === e.pointerId) {
      this._middlePanId = null;
      this._touchUp(e);
      return;
    }
    const wasNib = !!(this._nibIds && this._nibIds.delete(e.pointerId));
    if (e.pointerType === 'touch' && !wasNib) { this._touchUp(e); return; }
    this._checkPenButtons(e);
    this._ctmInv = null;
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (this._erasing) {
      this._erasing = false;
      this.livePath.removeAttribute('d');
      if (this._areaErase) this._areaEraseEnd();
      if (this._eraseBatch && this._eraseBatch.length) { this._pushUndo({ t: 'insert', items: this._eraseBatch }); }
      this._eraseBatch = null;
      if (this._changedDuringErase) { this._changedDuringErase = false; this._changed(); }
      return;
    }
    if (this._selDrag) { this._selUp(); return; }
    if (this._spaceDrag) { this._spaceUp(); return; }
    if (!this._active) return;
    const st = this._active; this._active = null;
    this._toggleHostClass('is-pen-drawing', false);
    this._rulerAnchor = null; this._rulerDir = null;
    if (st._raw && !st._snapped) this._addPointFinal(st, st._raw);
    this.livePath.removeAttribute('d');
    this._clearLiveCanvas();   // live layer → replaced by one committed SVG outline
    delete st._raw; delete st._sl; delete st._snapped;   // transient fields — keep the saved stroke lean
    if (st.points.length) {
      this._pushUndo({ t: 'remove', n: 1 });
      this.strokes.push(st);
      this._appendStroke(st);
      // The very first stroke is written out at once — that write is what
      // assigns the sketch id and binds the drawing to the note. Everything
      // after it can wait for the debounce.
      this._changed(this.strokes.length <= 1);
    }
    if (e.pointerType === 'pen') this._checkDoubleTap(e, st);
  }
  /* A tap is a stroke that went nowhere. Two of them, close in time and in
     place, are a double-tap — and the stray dot the first one left behind is
     taken back, because nobody double-taps in order to draw two dots. */
  _checkDoubleTap(e, stroke) {
    // Anything that actually travelled was drawing, and it also breaks any tap
    // sequence that was building up.
    if (!stroke || this._strokeTravel(stroke) > TAP_TRAVEL) { this._lastTap = null; return; }
    const p = this._lastTapPoint;
    if (!p) return;
    const now = e.timeStamp != null ? e.timeStamp : performance.now();
    if (gestures.isDoubleTap(this._lastTap, p.x, p.y, now)) {
      this._lastTap = null;
      if (this._fireGesture('doubleTap', 'start')) this._dropTapDots();
      return;
    }
    this._lastTap = { x: p.x, y: p.y, t: now };
  }
  _strokeTravel(st) {
    const pts = st.points || [];
    if (pts.length < 2) return 0;
    let max = 0;
    for (const q of pts) max = Math.max(max, Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]));
    return max;
  }
  /* Both taps of a recognised double-tap were dots, not drawing — and their
     undo entries go with them, or two presses of undo would do nothing. */
  _dropTapDots() {
    let removed = 0;
    while (removed < 2 && this.strokes.length) {
      const st = this.strokes[this.strokes.length - 1];
      if (this._strokeTravel(st) > TAP_TRAVEL) break;
      this.strokes.pop();
      const top = this.undoStack[this.undoStack.length - 1];
      if (top && top.t === 'remove' && top.n === 1) this.undoStack.pop();
      removed++;
    }
    if (!removed) return;
    this._renderStrokes();
    this._changed();
  }
  _addPointFinal(st, raw) {
    const last = st.points[st.points.length - 1];
    if (last && Math.hypot(raw[0] - last[0], raw[1] - last[1]) < 0.6) return;
    st.points.push([+raw[0].toFixed(1), +raw[1].toFixed(1), +raw[2].toFixed(2)]);
  }
}

module.exports = SurfacePen;
