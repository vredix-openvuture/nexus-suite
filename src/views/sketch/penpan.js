'use strict';

/* The pen's side button held = move the page, as in Krita and every other
   drawing program. Mapped through the gesture settings (`panHold`), so a pen
   that wants its button for erasing keeps it.

   It rides the one-finger pan in touch.js, minus palm rejection: the pen IS
   the hand here. Two ways in, because pens report differently:
     hovering    the pen's own events, button held, nib above the glass
     touching    a Huion under Linux/Wayland puts its nib down as 'touch'
                 (see pen.js · penSession) — that touch takes the pan over */

const gestures = require('../../lib/sketchgestures.js');

class SurfacePenPan {
  /* Run on every pen event. True when the event belonged to a pan. */
  _penPan(e) {
    const panButtons = ['barrel', 'barrel2'].filter(id => this.penMap[id] === 'panHold');
    if (e.pointerType !== 'pen' || !panButtons.length) return false;
    // The nib took the pan over (see _penPanHandover); hover events must not take it back.
    if (this._nibPanId != null && this._touches.has(this._nibPanId)) return true;
    const isPanPointer = this._penPanId === e.pointerId;
    const isEnd = e.type === 'pointerup' || e.type === 'pointercancel';
    const held = gestures.decodeButtons(e.buttons);
    if (isEnd || !panButtons.some(id => held[id])) {
      // Any pen event without the button ends a pan — also one whose pointer
      // left hover range and came back under a new id.
      if (this._penPanId != null) this._penPanEnd(this._penPanId);
      return isPanPointer;
    }
    // A stroke, an erase or a drag in progress finishes first.
    if (this._active || this._erasing || this._selDrag || this._spaceDrag) return false;
    if (isPanPointer) this._touchMove(e);
    else this._penPanBegin(e);
    return true;
  }
  /* A nib that touches down while the button is held keeps panning. Only for a
     pen that puts its nib down as touch: anywhere else a touch is a palm or a
     finger, and palm rejection has a say. */
  _penPanHandover(e, isNib) {
    if (this._penPanId == null || e.pointerType !== 'touch' || !isNib) return false;
    this._touches.delete(this._penPanId);
    this._penPanId = null;
    this._nibPanId = e.pointerId;
    this._panFrom(e);
    return true;
  }
  _penPanBegin(e) {
    if (this._penPanId != null) this._touches.delete(this._penPanId);
    this._penPanId = e.pointerId;
    this._panFrom(e);
  }
  _penPanEnd(pointerId) {
    this._penPanId = null;
    this._touchUp({ pointerId });
  }
  _panFrom(e) {
    this._stopFling();
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    this._touches.clear();
    this._gestMode = null;
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}   // a hovering pen has nothing to capture
    this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    this._tap = null;   // a pan is never a tap, so it cannot undo anything
    this._startOneFinger();
  }
}

module.exports = SurfacePenPan;
