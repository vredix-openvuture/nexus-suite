'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · selection
 *  Lasso and box selection: move, scale, rotate, recolour, duplicate, and
 *  re-editing a recognised shape. Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const sel = require('../../lib/sketchselect.js');
const objects = require('../../lib/sketchobjects.js');
const { HANDLE_PX, SEL_DRAG_PX } = require('./tuning.js');
const { shapeToPoints } = require('../../lib/sketchstroke.js');
const { svgEl } = require('../../lib/sketchsvg.js');

class SurfaceSelection {
  _selBox() {
    let box = sel.selectionBounds(this.strokes, this.selection);
    for (const i of this.selObjects) {
      const b = objects.objectBounds(this.objects[i]);
      if (!b) continue;
      box = box ? {
        minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY),
        maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY),
      } : b;
    }
    return box;
  }
  _hasSel() { return this.selection.length > 0 || this.selObjects.length > 0; }
  _emitSelect() { if (this.onSelect) { try { this.onSelect(this.selection.length + this.selObjects.length); } catch (e) {} } }
  /* Anything that renumbers this.strokes makes the stored indices point at the
     wrong ink, so the selection is dropped rather than silently retargeted. */
  _invalidateSelection() {
    if (!this._hasSel()) return;
    this.selection = [];
    this.selObjects = [];
    this._selDrag = null;
    if (this.gSel) this._paintSel(null);
    this._emitSelect();
  }
  /* Objects are snapshotted as whole records — they are small, and treating
     them as immutable means an undo step shares the image data instead of
     copying a base64 photo per drag. */
  _snapshotObjects() { return this.selObjects.map(i => ({ i, obj: this.objects[i] })); }
  _snapshot() {
    return this.selection.map(i => {
      const st = this.strokes[i];
      return {
        i,
        points: st.points.map(pt => pt.slice()),
        size: st.size,
        shape: st.shape ? JSON.parse(JSON.stringify(st.shape)) : null,
      };
    });
  }
  _soleShape() {
    if (this.selection.length !== 1) return null;
    const st = this.strokes[this.selection[0]];
    return (st && st.shape) ? st.shape : null;
  }
  _shapeControlAt(p, r) {
    const shape = this._soleShape();
    if (!shape) return null;
    for (const c of sel.shapeControlPoints(shape)) {
      if (Math.hypot(c.x - p.x, c.y - p.y) <= r) return c.id;
    }
    return null;
  }

  _selDown(p, e) {
    e.preventDefault();
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    this._ctmInv = this._invCTM();
    const box = this._selBox();
    const r = HANDLE_PX * this._uPerPx();
    if (box) {
      /* A control point of a recognised shape wins over the box handles: it is
         the more precise edit, and it sits inside the frame where a box handle
         would otherwise swallow it. */
      const ctrl = this._shapeControlAt(p, r);
      if (ctrl) { this._selDrag = { kind: 'shape', id: ctrl, snapshot: this._snapshot() }; return; }
      const h = sel.handleAt(box, p, r);
      if (h) { this._selDrag = { kind: 'handle', id: h, box, snapshot: this._snapshot(), objs: this._snapshotObjects() }; return; }
      if (sel.pointInBox(box, p, 0)) {
        this._selDrag = { kind: 'move', start: p, snapshot: this._snapshot(), objs: this._snapshotObjects(), moved: false };
        return;
      }
    }
    /* Lassoing a photo is possible but silly — a tap on one picks it up, the
       way it works in every app that has objects on a canvas. */
    const hit = objects.objectAt(this.objects, p.x, p.y);
    if (hit >= 0) {
      this.selection = [];
      this.selObjects = [hit];
      this._paintSel(null);
      this._emitSelect();
      this._selDrag = { kind: 'move', start: p, snapshot: [], objs: this._snapshotObjects(), moved: false };
      return;
    }
    this._selDrag = { kind: 'marquee', start: p, poly: [[p.x, p.y]] };
  }
  _selMove(p, e) {
    const d = this._selDrag;
    if (!d) return;
    if (d.kind === 'marquee') {
      if (this.selectShape === 'lasso') d.poly.push([p.x, p.y]); else d.end = p;
      this._paintSel(d);
      return;
    }
    if (d.kind === 'shape') { this._dragShapeControl(d, p); return; }
    let m;
    if (d.kind === 'move') {
      // A tap inside the frame must not nudge the drawing by a pixel of jitter.
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < SEL_DRAG_PX * this._uPerPx()) return;
      d.moved = true;
      m = sel.translate(p.x - d.start.x, p.y - d.start.y);
    } else {
      m = sel.handleMatrix(d.id, d.box, p, { uniform: !!e.shiftKey, snap: !!e.shiftKey });
    }
    this._applyMatrix(d.snapshot, m, d.objs);
    this._paintSel(d);
  }
  _selUp() {
    const d = this._selDrag;
    this._selDrag = null;
    this._ctmInv = null;
    if (!d) return;
    if (d.kind === 'marquee') {
      const poly = this._marqueePoly(d);
      this.selection = poly.length >= 3 ? sel.hitStrokes(this.strokes, poly) : [];
      // An object is caught by its CENTRE: any-corner would grab a big photo
      // whenever the lasso clipped one edge of it. A locked one is caught by
      // nothing — see sketchobjects.isLocked; a lasso around a whole annotated
      // scan would otherwise pick the scan up with the notes on it.
      this.selObjects = poly.length >= 3 ? this.objects.reduce((acc, obj, i) => {
        if (objects.isLocked(obj)) return acc;
        const b = objects.objectBounds(obj);
        if (sel.pointInPolygon((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, poly)) acc.push(i);
        return acc;
      }, []) : [];
      this._paintSel(null);
      this._emitSelect();
      return;
    }
    if (d.kind === 'move' && !d.moved) { this._paintSel(null); return; }   // a tap changed nothing
    if (d.objs && d.objs.length) {
      const before = this.objects.slice();
      for (const it of d.objs) before[it.i] = it.obj;
      this._pushUndo({ t: 'objs', all: before });
    }
    if (d.snapshot.length) this._pushUndo({ t: 'points', items: d.snapshot });
    this._paintSel(null);
    this._changed();
  }
  _marqueePoly(d) {
    if (this.selectShape === 'lasso') return d.poly;
    if (!d.end) return [];
    return this.selectShape === 'ellipse' ? sel.ellipsePoly(d.start, d.end) : sel.rectPoly(d.start, d.end);
  }
  _applyMatrix(snapshot, m, objSnapshot) {
    if (objSnapshot && objSnapshot.length) {
      const next = this.objects.slice();
      for (const it of objSnapshot) next[it.i] = objects.transformObject(it.obj, m);
      this.objects = next;
      this._renderObjects();
    }
    const grow = sel.matScale(m);
    for (const it of snapshot) {
      const st = this.strokes[it.i];
      if (!st) continue;
      st.points = sel.transformPoints(it.points, m);
      st.size = Math.max(0.3, it.size * grow);   // ink keeps its ratio to the drawing
      if (it.shape) {
        const next = sel.transformShape(it.shape, m);
        if (next) st.shape = next; else delete st.shape;
      }
      delete st._d;   // memoised outline is stale now
    }
    this._renderStrokes();
  }
  _dragShapeControl(d, p) {
    const st = this.strokes[this.selection[0]];
    const base = d.snapshot[0];
    if (!st || !base || !base.shape) return;
    const next = sel.moveShapeControl(base.shape, d.id, p);
    st.shape = next;
    st.points = shapeToPoints(next);
    delete st._d;
    this._renderStrokes();
    this._paintSel(d);
  }
  /* The overlay is redrawn wholesale — it is a handful of nodes, and keeping a
     diff of it in sync with an arbitrary transform costs more than it saves. */
  _paintSel(drag) {
    const g = this.gSel;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (this.mode !== 'select') return;
    const u = this._uPerPx();
    const dash = (6 * u).toFixed(1) + ' ' + (5 * u).toFixed(1);
    if (drag && drag.kind === 'marquee') {
      const poly = this._marqueePoly(drag);
      if (poly.length >= 2) {
        const d = 'M' + poly.map(pt => pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join('L')
          + (this.selectShape === 'lasso' ? '' : 'Z');
        g.appendChild(svgEl('path', { class: 'nx-sk-marquee', d, 'stroke-width': Math.max(0.6, 1.5 * u), 'stroke-dasharray': dash }));
      }
      return;
    }
    const box = this._selBox();
    if (!box) return;
    g.appendChild(svgEl('rect', {
      class: 'nx-sk-selbox', x: box.minX, y: box.minY,
      width: Math.max(0, box.maxX - box.minX), height: Math.max(0, box.maxY - box.minY),
      'stroke-width': Math.max(0.6, 1.5 * u), 'stroke-dasharray': dash,
    }));
    const r = HANDLE_PX * u * 0.62;
    const handles = sel.handlePositions(box);
    const rot = handles.find(h => h.id === 'rotate');
    // The rotation handle rides a stalk so it can never be mistaken for a corner.
    if (rot) g.appendChild(svgEl('line', { class: 'nx-sk-selstalk', x1: rot.x, y1: box.minY, x2: rot.x, y2: rot.y, 'stroke-width': Math.max(0.5, 1.2 * u) }));
    for (const h of handles) {
      g.appendChild(svgEl('circle', { class: 'nx-sk-selhandle' + (h.id === 'rotate' ? ' is-rotate' : ''), cx: h.x, cy: h.y, r }));
    }
    const shape = this._soleShape();
    if (shape) {
      for (const c of sel.shapeControlPoints(shape)) {
        g.appendChild(svgEl('rect', { class: 'nx-sk-selctrl', x: c.x - r, y: c.y - r, width: r * 2, height: r * 2 }));
      }
    }
  }

  /* ── What the toolbar can do to a selection ── */
  deleteSelection() {
    if (this.selObjects.length) this.removeObjects(this.selObjects.slice());
    if (!this.selection.length) return;
    // Descending, so each splice index is still valid when it runs — and that
    // is exactly the order the 'insert' undo op replays backwards.
    const items = this.selection.slice().sort((a, b) => b - a).map(i => ({ i, st: this.strokes[i] }));
    for (const it of items) this.strokes.splice(it.i, 1);
    this._pushUndo({ t: 'insert', items });
    this.selection = [];
    this._renderStrokes(); this._paintSel(null); this._changed(); this._emitSelect();
  }
  duplicateSelection(dx, dy) {
    const off = sel.translate(dx == null ? 24 : dx, dy == null ? 24 : dy);
    if (this.selObjects.length) {
      this._pushUndo({ t: 'objs', all: this.objects.slice() });
      const copies = this.selObjects.map(i => objects.transformObject(this.objects[i], off));
      const first = this.objects.length;
      this.objects = this.objects.concat(copies);
      this.selObjects = copies.map((_, k) => first + k);
      this._renderObjects();
      this._paintSel(null); this._changed(); this._emitSelect();
    }
    if (!this.selection.length) return;
    const copies = this.selection.map(i => {
      const copy = JSON.parse(JSON.stringify(this.strokes[i]));
      copy.points = sel.transformPoints(this.strokes[i].points, off);
      if (copy.shape) {
        const next = sel.transformShape(copy.shape, off);
        if (next) copy.shape = next; else delete copy.shape;
      }
      return copy;
    });
    this._pushUndo({ t: 'remove', n: copies.length });
    const first = this.strokes.length;
    for (const copy of copies) this.strokes.push(copy);
    this.selection = copies.map((_, k) => first + k);   // the copy is what stays selected
    this._renderStrokes(); this._paintSel(null); this._changed(); this._emitSelect();
  }
  setSelectionColor(color) {
    if (!this.selection.length) return;
    const items = this.selection.map(i => ({ i, color: this.strokes[i].color }));
    for (const i of this.selection) this.strokes[i].color = color;
    this._pushUndo({ t: 'color', items });
    this._renderStrokes(); this._changed();
  }
  hasSelection() { return this._hasSel(); }
  clearSelection() { this.selection = []; this.selObjects = []; this._paintSel(null); this._emitSelect(); }
}

module.exports = SurfaceSelection;
