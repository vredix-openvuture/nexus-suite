'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · the spacing tool
 *  Dragging open or closing up vertical space between strokes.
 *  Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const sel = require('../../lib/sketchselect.js');
const canvas = require('../../lib/sketchcanvas.js');
const { svgEl } = require('../../lib/sketchsvg.js');

class SurfaceSpace {


  /* ── Spacing tool ──────────────────────────────────────────────────────────
     Grab a line and pull it down to open blank paper, up to close it again —
     the OneNote gesture. Everything whose TOP edge is below the line moves as a
     whole; a stroke straddling the line stays, because tearing one in half at
     an arbitrary y rips descenders off letters. */
  _spaceDown(p, e) {
    e.preventDefault();
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    this._ctmInv = this._invCTM();
    const below = canvas.strokesBelow(this.strokes, p.y);
    this._spaceDrag = {
      y: p.y,
      dy: 0,
      h0: this.H,
      // How far up this can go before content would cross the line. Asking for
      // an absurd negative delta is how the clamp reports its own limit.
      minDy: canvas.clampSpaceDelta(this.strokes, p.y, -1e9),
      snapshot: below.map(i => ({
        i,
        points: this.strokes[i].points.map(q => q.slice()),
        size: this.strokes[i].size,
        shape: this.strokes[i].shape ? JSON.parse(JSON.stringify(this.strokes[i].shape)) : null,
      })),
    };
    this._paintSpace();
  }
  _spaceMove(p) {
    const d = this._spaceDrag;
    if (!d) return;
    d.dy = Math.max(d.minDy, p.y - d.y);
    const m = sel.translate(0, d.dy);
    for (const it of d.snapshot) {
      const st = this.strokes[it.i];
      if (!st) continue;
      st.points = sel.transformPoints(it.points, m);
      if (it.shape) {
        const next = sel.transformShape(it.shape, m);
        if (next) st.shape = next; else delete st.shape;
      }
      delete st._d;
    }
    // Opening a gap needs paper under what was pushed down; closing one lets
    // the sheet shrink back to whatever the content needs.
    this.setHeight(d.dy > 0 ? d.h0 + d.dy : 0);
    this._renderStrokes();
    this._paintSpace();
  }
  _spaceUp() {
    const d = this._spaceDrag;
    this._spaceDrag = null;
    this._ctmInv = null;
    if (!d) return;
    if (Math.abs(d.dy) >= 0.5) {
      this._pushUndo({ t: 'points', items: d.snapshot, h: d.h0 });
      this._changed();
    }
    this._paintSpace();
  }
  _paintSpace() {
    const g = this.gSel;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (this.mode !== 'space') return;
    const d = this._spaceDrag;
    if (!d) return;
    const u = this._uPerPx();
    const y2 = d.y + d.dy;
    if (Math.abs(d.dy) > 0.5) {
      g.appendChild(svgEl('rect', {
        class: 'nx-sk-spacefill', x: 0, y: Math.min(d.y, y2), width: this.W, height: Math.abs(d.dy),
      }));
    }
    // Two bars: where you grabbed, and where the content now starts.
    g.appendChild(svgEl('line', { class: 'nx-sk-spaceline', x1: 0, y1: d.y, x2: this.W, y2: d.y, 'stroke-width': Math.max(0.8, 2 * u) }));
    g.appendChild(svgEl('line', { class: 'nx-sk-spaceline is-moving', x1: 0, y1: y2, x2: this.W, y2: y2, 'stroke-width': Math.max(0.8, 2 * u) }));
  }
}

module.exports = SurfaceSpace;
