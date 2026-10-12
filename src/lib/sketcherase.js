'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the area eraser
 *  The stroke eraser takes a whole stroke away as soon as it touches it. The
 *  area eraser behaves like a real rubber: it removes only the ink under its
 *  disc, so a stroke it crosses is cut into the pieces on either side.
 *
 *  Pure geometry on stroke records — no DOM — so it is tested on its own and
 *  the surface (views/sketch/history.js) only has to swap arrays.
 * ========================================================================== */

/* The three disc sizes, as a RADIUS in screen pixels. Screen and not canvas
   units: an eraser that grows when you zoom out is not the size you picked. */
const ERASER_SIZES = [
  { id: 's', label: 'Small',  px: 7 },
  { id: 'm', label: 'Medium', px: 15 },
  { id: 'l', label: 'Large',  px: 30 },
];
const ERASER_TYPES = [
  { id: 'stroke', label: 'Stroke eraser', icon: 'eraser' },
  { id: 'area',   label: 'Area eraser',   icon: 'circle-dashed' },
];

function eraserRadiusPx(sizeId) {
  const hit = ERASER_SIZES.find(s => s.id === sizeId);
  return (hit || ERASER_SIZES[1]).px;
}

/* Shortest distance from (px, py) to the segment a→b. */
function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
}

function touches(st, cx, cy, reach) {
  const pts = st.points || [];
  if (pts.length === 1) return Math.hypot(pts[0][0] - cx, pts[0][1] - cy) <= reach;
  for (let i = 1; i < pts.length; i++) if (segDist(cx, cy, pts[i - 1], pts[i]) <= reach) return true;
  return false;
}

/* Extra points along the segments that come within `reach` of the disc, every
   component (x, y, pressure, …) interpolated. Without them a fast stroke — two
   points a finger-width apart — would have no point inside the disc to cut at.
   Segments far from the disc keep their points as they are: adding points
   everywhere bloats the file and changes how the whole stroke is smoothed. */
function densifyNear(points, cx, cy, reach, step) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const a = points[i - 1];
      const len = Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (len > step && segDist(cx, cy, a, p) <= reach) {
        // Only the stretch of the segment around the disc, plus one step either
        // side so the cut lands just outside the rim.
        const tc = ((cx - a[0]) * (p[0] - a[0]) + (cy - a[1]) * (p[1] - a[1])) / (len * len);
        const half = (reach + step) / len;
        const from = Math.max(0, tc - half), to = Math.min(1, tc + half);
        const dt = step / len;
        for (let t = from; t <= to; t += dt) {
          if (t <= 0 || t >= 1) continue;
          out.push(a.map((v, j) => (typeof v === 'number' && typeof p[j] === 'number') ? v + (p[j] - v) * t : v));
        }
      }
    }
    out.push(p);
  }
  return out;
}

/* Cut one stroke by the disc. Null when no point actually falls inside — the
   rim grazing a segment is not a cut, and rebuilding the stroke then would cost
   an undo step and a recognised shape for nothing. A piece remembers which of
   its ends were cut (`cutStart` / `cutEnd`), so the outline ends flat there
   instead of tapering to a point like the stroke's own ends. */
function cutStroke(st, cx, cy, reach, step) {
  const pts = densifyNear(st.points || [], cx, cy, reach, step);
  // Strictly inside: a point exactly on the rim is touched, not rubbed out.
  const inside = pts.map(p => Math.hypot(p[0] - cx, p[1] - cy) < reach);
  if (inside.indexOf(true) < 0) return null;
  const pieces = [];
  let start = -1;
  const close = (end) => {
    if (start >= 0 && end - start >= 2) {
      const piece = Object.assign({}, st, { points: pts.slice(start, end) });
      delete piece.shape;
      if (start > 0) piece.cutStart = true;
      if (end < pts.length) piece.cutEnd = true;
      pieces.push(piece);
    }
    start = -1;
  };
  for (let k = 0; k < pts.length; k++) {
    if (inside[k]) close(k);
    else if (start < 0) start = k;
  }
  close(pts.length);
  return pieces;
}

/* Rub out a disc at (cx, cy) with radius r (canvas units). Returns null when
   nothing was cut — the caller then has nothing to redraw — or the new stroke
   array. Strokes the disc missed are passed through as the SAME objects, so
   their cached outlines survive. A cut piece is a new record without the
   snapped `shape`: half a rectangle is no longer a rectangle. */
function eraseDisc(strokes, cx, cy, r) {
  let changed = false;
  const out = [];
  const step = Math.max(0.5, r / 3);
  for (const st of strokes) {
    const reach = r + (st.size || 0) / 2;
    const pieces = touches(st, cx, cy, reach) ? cutStroke(st, cx, cy, reach, step) : null;
    if (!pieces) { out.push(st); continue; }
    changed = true;
    Array.prototype.push.apply(out, pieces);
  }
  return changed ? out : null;
}

/* The disc dragged from one sample to the next, so a quick swipe erases a
   continuous band instead of a row of separate holes. */
function eraseSweep(strokes, from, to, r) {
  const dist = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  const n = Math.max(1, Math.ceil(dist / Math.max(0.5, r / 2)));
  let cur = strokes, changed = false;
  for (let k = from ? 1 : 0; k <= n; k++) {
    const t = from ? k / n : 1;
    const x = from ? from.x + (to.x - from.x) * t : to.x;
    const y = from ? from.y + (to.y - from.y) * t : to.y;
    const next = eraseDisc(cur, x, y, r);
    if (next) { cur = next; changed = true; }
  }
  return changed ? cur : null;
}

module.exports = { ERASER_SIZES, ERASER_TYPES, eraserRadiusPx, touches, eraseDisc, eraseSweep };
