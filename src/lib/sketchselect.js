'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sketch selection geometry
 *  Pure maths for picking strokes out of a drawing and moving, scaling and
 *  rotating them. No DOM, no Obsidian — the surface (views/sketch.js) owns the
 *  pointer handling and the overlay, this file owns every number.
 *
 *  Regions are ALWAYS a polygon, whatever tool drew them: the lasso is its own
 *  path, the rectangle and the ellipse are generated into one. That way there
 *  is a single hit test to reason about instead of three.
 * ========================================================================== */

/* A stroke counts as selected when ANY of its points is inside the region.
   Requiring the whole stroke means a lasso around a word misses every letter
   whose tail pokes out, which is the opposite of what the gesture looks like
   it promised. */
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function polyBounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return poly.length ? { minX, minY, maxX, maxY } : null;
}

function strokeBounds(stroke) { return polyBounds(stroke.points || []); }

/* The box around a set of strokes, padded by half their width so the frame
   sits outside the ink instead of cutting through it. */
function selectionBounds(strokes, indices) {
  let box = null;
  for (const i of indices) {
    const st = strokes[i];
    if (!st) continue;
    const b = strokeBounds(st);
    if (!b) continue;
    const pad = (st.size || 2) / 2;
    const grown = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    box = box ? {
      minX: Math.min(box.minX, grown.minX), minY: Math.min(box.minY, grown.minY),
      maxX: Math.max(box.maxX, grown.maxX), maxY: Math.max(box.maxY, grown.maxY),
    } : grown;
  }
  return box;
}

function hitStrokes(strokes, poly) {
  const box = polyBounds(poly);
  if (!box) return [];
  const out = [];
  for (let i = 0; i < strokes.length; i++) {
    const pts = strokes[i].points || [];
    for (const p of pts) {
      // Cheap box reject first — a lasso is usually small against the page.
      if (p[0] < box.minX || p[0] > box.maxX || p[1] < box.minY || p[1] > box.maxY) continue;
      if (pointInPolygon(p[0], p[1], poly)) { out.push(i); break; }
    }
  }
  return out;
}

/* Marquee shapes as polygons. `from`/`to` are the drag corners. */
function rectPoly(from, to) {
  return [[from.x, from.y], [to.x, from.y], [to.x, to.y], [from.x, to.y]];
}
function ellipsePoly(from, to, steps) {
  const n = steps || 48;
  const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2;
  const rx = Math.abs(to.x - from.x) / 2, ry = Math.abs(to.y - from.y) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

/* ── Transforms ─────────────────────────────────────────────────────────────
   One 2x3 affine matrix [a b c d e f] does move, scale and rotate together, so
   a drag never composes three separate operations that each round differently.
   Points are always derived from the ORIGINAL snapshot, never from the last
   frame, or a slow drag would accumulate rounding into visible drift. */
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function matMul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}
function translate(tx, ty) { return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }; }
function scaleAround(sx, sy, ox, oy) {
  return matMul(translate(ox, oy), matMul({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }, translate(-ox, -oy)));
}
function rotateAround(rad, ox, oy) {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return matMul(translate(ox, oy), matMul({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }, translate(-ox, -oy)));
}
function applyPoint(m, x, y) { return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; }

/* How much a matrix grows lengths on average. Stroke width follows this, so a
   scaled-up drawing keeps the ratio between its ink and its size. */
function matScale(m) { return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1; }

function transformPoints(points, m) {
  return points.map(p => {
    const q = applyPoint(m, p[0], p[1]);
    return [+q[0].toFixed(1), +q[1].toFixed(1), p[2]];
  });
}

/* Handles: eight around the box, plus one on a stalk above it for rotation.
   Named rather than indexed — `nw` survives a refactor, `handles[0]` does not. */
const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const ROTATE_STALK = 26;   // viewBox units above the top edge

function handlePositions(box) {
  if (!box) return [];
  const { minX, minY, maxX, maxY } = box;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  return [
    { id: 'nw', x: minX, y: minY }, { id: 'n', x: midX, y: minY }, { id: 'ne', x: maxX, y: minY },
    { id: 'e', x: maxX, y: midY }, { id: 'se', x: maxX, y: maxY }, { id: 's', x: midX, y: maxY },
    { id: 'sw', x: minX, y: maxY }, { id: 'w', x: minX, y: midY },
    { id: 'rotate', x: midX, y: minY - ROTATE_STALK },
  ];
}

/* The corner a handle pulls against: dragging `se` keeps `nw` still. */
function anchorFor(id, box) {
  const { minX, minY, maxX, maxY } = box;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const map = {
    nw: [maxX, maxY], ne: [minX, maxY], se: [minX, minY], sw: [maxX, minY],
    n: [midX, maxY], s: [midX, minY], e: [minX, midY], w: [maxX, midY],
  };
  const a = map[id] || [midX, midY];
  return { x: a[0], y: a[1] };
}

/* The matrix for dragging one handle to `pt`. Scaling is clamped away from
   zero: a box collapsed to a line cannot be pulled back open, because every
   later scale would multiply by nothing. */
const MIN_SCALE = 0.05;

function handleMatrix(id, box, pt, opts) {
  opts = opts || {};
  if (id === 'rotate') {
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
    let rad = Math.atan2(pt.y - cy, pt.x - cx) + Math.PI / 2;
    if (opts.snap) rad = Math.round(rad / (Math.PI / 12)) * (Math.PI / 12);   // 15° steps
    return rotateAround(rad, cx, cy);
  }
  const anchor = anchorFor(id, box);
  const w = box.maxX - box.minX, h = box.maxY - box.minY;
  const horizontal = id.includes('e') || id.includes('w');
  const vertical = id.includes('n') || id.includes('s');
  let sx = horizontal && w > 1e-6 ? (pt.x - anchor.x) / ((id.includes('e') ? box.maxX : box.minX) - anchor.x) : 1;
  let sy = vertical && h > 1e-6 ? (pt.y - anchor.y) / ((id.includes('s') ? box.maxY : box.minY) - anchor.y) : 1;
  if (!isFinite(sx) || Math.abs(sx) < MIN_SCALE) sx = sx < 0 ? -MIN_SCALE : MIN_SCALE;
  if (!isFinite(sy) || Math.abs(sy) < MIN_SCALE) sy = sy < 0 ? -MIN_SCALE : MIN_SCALE;
  // A corner with the modifier held keeps the aspect ratio; an edge only ever
  // moves one axis anyway.
  if (opts.uniform && horizontal && vertical) {
    const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    sx = s; sy = s;
  }
  return scaleAround(horizontal ? sx : 1, vertical ? sy : 1, anchor.x, anchor.y);
}

/* Which handle a point grabs, in viewBox units. Radius comes from the caller
   because it depends on the zoom: a handle has to stay thumb-sized on screen. */
function handleAt(box, pt, radius) {
  for (const h of handlePositions(box)) {
    if (Math.hypot(h.x - pt.x, h.y - pt.y) <= radius) return h.id;
  }
  return null;
}

function pointInBox(box, pt, pad) {
  if (!box) return false;
  const p = pad || 0;
  return pt.x >= box.minX - p && pt.x <= box.maxX + p && pt.y >= box.minY - p && pt.y <= box.maxY + p;
}

/* ── Recognised shapes stay editable ────────────────────────────────────────
   A snapped shape keeps its description (`stroke.shape`), so its defining
   points can be dragged later and the outline regenerated. Without that the
   snap is a one-way door: the moment the pen lifts, a rectangle is just 40
   anonymous points that can only be scaled as a block. */
function shapeControlPoints(shape) {
  if (!shape) return [];
  if (shape.kind === 'line') return shape.pts.map((p, i) => ({ id: 'p' + i, x: p[0], y: p[1] }));
  if (shape.kind === 'poly') return shape.pts.map((p, i) => ({ id: 'p' + i, x: p[0], y: p[1] }));
  if (shape.kind === 'ellipse') {
    return [
      { id: 'rx', x: shape.cx + shape.rx, y: shape.cy },
      { id: 'ry', x: shape.cx, y: shape.cy + shape.ry },
      { id: 'c', x: shape.cx, y: shape.cy },
    ];
  }
  return [];
}

function moveShapeControl(shape, id, pt) {
  const next = JSON.parse(JSON.stringify(shape));
  if (next.kind === 'line' || next.kind === 'poly') {
    const i = parseInt(String(id).slice(1), 10);
    if (!next.pts[i]) return shape;
    next.pts[i] = [+pt.x.toFixed(1), +pt.y.toFixed(1)];
    return next;
  }
  if (next.kind === 'ellipse') {
    if (id === 'c') {
      next.cx = +pt.x.toFixed(1);
      next.cy = +pt.y.toFixed(1);
    } else if (id === 'rx') {
      next.rx = Math.max(2, Math.abs(pt.x - next.cx));
    } else if (id === 'ry') {
      next.ry = Math.max(2, Math.abs(pt.y - next.cy));
    }
    return next;
  }
  return shape;
}

function transformShape(shape, m) {
  if (!shape) return null;
  const next = JSON.parse(JSON.stringify(shape));
  if (next.kind === 'line' || next.kind === 'poly') {
    next.pts = next.pts.map(p => {
      const q = applyPoint(m, p[0], p[1]);
      return [+q[0].toFixed(1), +q[1].toFixed(1)];
    });
    return next;
  }
  if (next.kind === 'ellipse') {
    const c = applyPoint(m, next.cx, next.cy);
    // A rotated ellipse is no longer axis-aligned, and the description has no
    // room for an angle — so it stops being an editable shape and stays as the
    // points it already rendered to. Losing the handles beats drawing a lie.
    if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) return null;
    next.cx = +c[0].toFixed(1);
    next.cy = +c[1].toFixed(1);
    next.rx = Math.max(1, Math.abs(next.rx * m.a));
    next.ry = Math.max(1, Math.abs(next.ry * m.d));
    return next;
  }
  return null;
}

module.exports = {
  pointInPolygon, polyBounds, strokeBounds, selectionBounds, hitStrokes,
  rectPoly, ellipsePoly,
  IDENTITY, matMul, translate, scaleAround, rotateAround, applyPoint, matScale,
  transformPoints, handlePositions, anchorFor, handleMatrix, handleAt, pointInBox,
  shapeControlPoints, moveShapeControl, transformShape,
  HANDLE_IDS, ROTATE_STALK, MIN_SCALE,
};
