'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · strokes
 *  Pen presets, the outline of a pressure stroke, and recognising a drawn
 *  shape. Pure geometry: no DOM.
 * ========================================================================== */

/* Pen presets — every field user-overridable per pen (settings.penConfig):
     thinning   how strongly pressure varies width (0 = constant)
     taper      units over which the tips sharpen to a point ("sharpness")
     speedThin  how much FAST strokes thin out (dry-nib fade; also gives mouse
                strokes calligraphic character, since mouse pressure is constant)
     streamline input smoothing 0..0.9 (higher = calmer, lower = raw)
     cap        'round' | 'flat' tip shape (flat = chisel/highlighter)
     noStack    strokes of this pen DON'T darken where they overlap each other
                (rendered grouped at one shared opacity — highlighter default)
     nib        fixed nib angle in degrees (calligraphy: width follows stroke
                direction vs. the nib) or null
     opacity/blend  translucent + multiply = highlighter look
     sizeMul    scales the user's chosen px size
   All width-relevant values are baked into the recorded per-point pressures /
   stored per stroke, so the exported SVG renders identically with no pen
   knowledge. */
const PEN_TYPES = {
  fountain:    { thinning: 0.8,  opacity: 1,    sizeMul: 1,    blend: false, taper: 18, speedThin: 0.5,  streamline: 0.55, cap: 'round', noStack: false, nib: null },
  ballpoint:   { thinning: 0.1,  opacity: 1,    sizeMul: 0.85, blend: false, taper: 0,  speedThin: 0.1,  streamline: 0.5,  cap: 'round', noStack: false, nib: null },
  pencil:      { thinning: 0.35, opacity: 0.9,  sizeMul: 0.85, blend: false, taper: 5,  speedThin: 0.2,  streamline: 0.35, cap: 'round', noStack: false, nib: null, grain: true },
  brush:       { thinning: 0.9,  opacity: 1,    sizeMul: 1.7,  blend: false, taper: 26, speedThin: 0.55, streamline: 0.65, cap: 'round', noStack: false, nib: null },
  calligraphy: { thinning: 0.15, opacity: 1,    sizeMul: 1.3,  blend: false, taper: 4,  speedThin: 0.1,  streamline: 0.6,  cap: 'round', noStack: false, nib: 45   },
  marker:      { thinning: 0.04, opacity: 0.38, sizeMul: 3.2,  blend: true,  taper: 0,  speedThin: 0,    streamline: 0.5,  cap: 'flat',  noStack: true,  nib: null },
};

/* Variable-width filled stroke → one SVG path `d`. Builds an outline polygon:
   walk the LEFT offset edge forward, round the front cap, walk the RIGHT edge
   back, round the start cap, close. Radius per point comes from pressure
   (thinning), so a hard press is fat and a light one is thin. Midpoint-quadratic
   smoothing keeps the dense pointer stream from looking faceted. Caps use a
   single quadratic bulge (control pushed one radius along the tangent) —
   deliberately NOT an SVG arc, whose sweep-flag flips with the y-down screen
   coords and is easy to point the wrong way. */
function sketchStrokePath(points, size, o) {
  o = o || {};
  const n = points.length;
  if (!n) return '';
  const th = (o.thinning != null) ? o.thinning : 0.5;
  const tS = o.taperStart || 0, tE = (o.taperEnd != null) ? o.taperEnd : tS;
  const flatCap = o.cap === 'flat';
  const nibRad = (o.nib != null) ? o.nib * Math.PI / 180 : null;
  // Tip tapering (fountain nib): radius shrinks toward a sharp point over the
  // first/last `taper` units of arc length. Short strokes scale the taper down
  // so a quick tick doesn't vanish entirely.
  let cum = null, total = 0, effS = 0, effE = 0;
  if ((tS > 0 || tE > 0) && n > 1) {
    cum = new Array(n); cum[0] = 0;
    for (let i = 1; i < n; i++) { total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); cum[i] = total; }
    effS = Math.min(tS, total * 0.4);
    effE = Math.min(tE, total * 0.4);
  }
  const radius = (p, i) => {
    const rp = Math.max(0.05, Math.min(1, p == null ? 0.5 : p));
    let r = Math.max(0.4, (size / 2) * (1 - th * (1 - rp)));
    if (cum) {
      let fac = 1;
      if (effS > 0.01) fac = Math.min(fac, cum[i] / effS);
      if (effE > 0.01) fac = Math.min(fac, (total - cum[i]) / effE);
      if (fac < 1) r = Math.max(0.1, r * Math.pow(Math.max(0.03, fac), 0.65));
    }
    return r;
  };
  const f = (v) => v.toFixed(1);

  if (n === 1) {
    const r = radius(points[0][2], 0), x = points[0][0], y = points[0][1];
    return `M ${f(x - r)} ${f(y)} a ${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0 a ${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0 Z`;
  }

  const tan = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    tan.push([dx / L, dy / L]);
  }
  // Calligraphy nib: effective width follows the stroke direction relative to
  // the fixed nib angle — strokes across the nib are broad, along it hairline.
  const nibMul = (i) => nibRad == null ? 1
    : Math.max(0.15, Math.abs(Math.sin(Math.atan2(tan[i][1], tan[i][0]) - nibRad)));
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    let r = radius(points[i][2], i) * nibMul(i);
    // Curvature clamp: a variable-width outline folds on itself (spikes/holes)
    // wherever the half-width exceeds the local radius of curvature — worst on
    // the calligraphy nib at larger sizes. Cap r just under the circumradius of
    // the (i-1, i, i+1) triangle so the inner offset edge can't invert.
    if (i > 0 && i < n - 1) {
      const ax = points[i - 1][0], ay = points[i - 1][1], bx = points[i][0], by = points[i][1], cx2 = points[i + 1][0], cy2 = points[i + 1][1];
      const cross = Math.abs((bx - ax) * (cy2 - by) - (by - ay) * (cx2 - bx));
      if (cross > 1e-6) {
        const rho = (Math.hypot(bx - ax, by - ay) * Math.hypot(cx2 - bx, cy2 - by) * Math.hypot(cx2 - ax, cy2 - ay)) / (2 * cross);
        if (r > rho * 0.9) r = rho * 0.9;
      }
    }
    const nx = -tan[i][1], ny = tan[i][0];
    left.push([points[i][0] + nx * r, points[i][1] + ny * r]);
    right.push([points[i][0] - nx * r, points[i][1] - ny * r]);
  }
  const smooth = (poly) => {
    let d = '';
    for (let i = 1; i < poly.length - 1; i++) {
      const mx = (poly[i][0] + poly[i + 1][0]) / 2, my = (poly[i][1] + poly[i + 1][1]) / 2;
      d += ` Q ${f(poly[i][0])} ${f(poly[i][1])} ${f(mx)} ${f(my)}`;
    }
    d += ` L ${f(poly[poly.length - 1][0])} ${f(poly[poly.length - 1][1])}`;
    return d;
  };
  const rEnd = radius(points[n - 1][2], n - 1) * nibMul(n - 1), rStart = radius(points[0][2], 0) * nibMul(0);
  const te = tan[n - 1], ts = tan[0];

  let d = `M ${f(left[0][0])} ${f(left[0][1])}`;
  d += smooth(left);
  // Caps: rounded = quadratic bulge along the tangent; flat = straight chisel
  // edge (highlighter look) connecting the two offset edges directly.
  if (flatCap) d += ` L ${f(right[n - 1][0])} ${f(right[n - 1][1])}`;
  else d += ` Q ${f(points[n - 1][0] + te[0] * rEnd * 1.35)} ${f(points[n - 1][1] + te[1] * rEnd * 1.35)} ${f(right[n - 1][0])} ${f(right[n - 1][1])}`;
  d += smooth(right.slice().reverse());
  if (flatCap) d += ` L ${f(left[0][0])} ${f(left[0][1])}`;
  else d += ` Q ${f(points[0][0] - ts[0] * rStart * 1.35)} ${f(points[0][1] - ts[1] * rStart * 1.35)} ${f(left[0][0])} ${f(left[0][1])}`;
  d += ' Z';
  return d;
}

/* ── Shape recognition (hold the pen still after drawing → snap). ── */

/* Ramer–Douglas–Peucker simplification — used to count a closed stroke's
   corners (3 = triangle, 4 = quad/rectangle, many = ellipse candidate). */
function rdpSimplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const seg = stack.pop(), a = seg[0], b = seg[1];
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay;
    const L = Math.hypot(dx, dy) || 1e-6;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/* Classify a stroke as line / triangle / rectangle / quad / ellipse — or null
   (leave freehand). Thresholds are relative to the stroke's own scale. */
function recognizeShape(pts) {
  const n = pts.length;
  if (n < 8) return null;
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (len < 60) return null;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of pts) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const w = maxX - minX, h = maxY - minY, diag = Math.hypot(w, h) || 1;
  const closed = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < Math.max(26, len * 0.14);

  if (!closed) {
    // Straight line?
    const ax = pts[0][0], ay = pts[0][1], dx = pts[n - 1][0] - ax, dy = pts[n - 1][1] - ay;
    const L = Math.hypot(dx, dy) || 1e-6;
    let maxD = 0;
    for (const p of pts) { const d = Math.abs((p[0] - ax) * dy - (p[1] - ay) * dx) / L; if (d > maxD) maxD = d; }
    if (maxD < Math.max(7, L * 0.05)) return { kind: 'line', pts: [[ax, ay], [pts[n - 1][0], pts[n - 1][1]]] };
    return null;
  }

  // Closed: corner count via RDP.
  let corners = rdpSimplify(pts, Math.max(9, diag * 0.06));
  if (corners.length > 1 && Math.hypot(corners[0][0] - corners[corners.length - 1][0], corners[0][1] - corners[corners.length - 1][1]) < Math.max(26, len * 0.14)) corners = corners.slice(0, -1);
  // Merge near-duplicate corners — RDP sometimes splits one physical corner
  // into two close points on jittery input, which broke rectangle detection.
  const mergeR = diag * 0.09;
  const merged = [];
  for (const c of corners) {
    const prev = merged[merged.length - 1];
    if (prev && Math.hypot(c[0] - prev[0], c[1] - prev[1]) < mergeR) { prev[0] = (prev[0] + c[0]) / 2; prev[1] = (prev[1] + c[1]) / 2; }
    else merged.push([c[0], c[1]]);
  }
  if (merged.length > 1 && Math.hypot(merged[0][0] - merged[merged.length - 1][0], merged[0][1] - merged[merged.length - 1][1]) < mergeR) merged.pop();
  corners = merged;
  // Drop collinear "corners" — RDP always keeps the stroke's start/end point,
  // which for a closed shape usually sits mid-edge and is no corner at all.
  if (corners.length > 3) {
    const clean = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[(i + corners.length - 1) % corners.length], b = corners[i], c = corners[(i + 1) % corners.length];
      const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1e-6;
      const dev = Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / L;
      if (dev > Math.max(6, diag * 0.03)) clean.push(b);
    }
    if (clean.length >= 3) corners = clean;
  }
  // Ellipse fit against the bounding box.
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = Math.max(1, w / 2), ry = Math.max(1, h / 2);
  let err = 0;
  for (const p of pts) { const q = ((p[0] - cx) / rx) ** 2 + ((p[1] - cy) / ry) ** 2; err += Math.abs(q - 1); }
  err /= n;

  if (corners.length === 3) return { kind: 'poly', pts: corners.map(p => [p[0], p[1]]) };
  if (corners.length === 4) {
    // Snap to the axis-aligned bounding rect when each corner sits near one.
    const bc = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    const tol = diag * 0.14;
    const used = new Set();
    let rect = true;
    for (const c of corners) {
      let best = -1, bestD = 1e9;
      for (let i = 0; i < 4; i++) { const d = Math.hypot(c[0] - bc[i][0], c[1] - bc[i][1]); if (d < bestD) { bestD = d; best = i; } }
      if (bestD > tol || used.has(best)) { rect = false; break; }
      used.add(best);
    }
    return { kind: 'poly', pts: rect ? bc : corners.map(p => [p[0], p[1]]) };
  }
  if (err < 0.3 && corners.length >= 5) return { kind: 'ellipse', cx, cy, rx, ry };
  return null;
}

/* Turn a recognized shape back into stroke points (constant pressure) so it
   stays a perfectly normal stroke: erasable, undoable, saved like any other. */
function shapeToPoints(shape) {
  const out = [];
  const push = (x, y) => out.push([+x.toFixed(1), +y.toFixed(1), 0.6]);
  const seg = (a, b) => {
    const steps = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
    for (let i = 0; i <= steps; i++) push(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps);
  };
  if (shape.kind === 'line') seg(shape.pts[0], shape.pts[1]);
  else if (shape.kind === 'poly') { const ps = shape.pts; for (let i = 0; i < ps.length; i++) seg(ps[i], ps[(i + 1) % ps.length]); }
  else if (shape.kind === 'ellipse') {
    const N = 64;
    for (let i = 0; i <= N; i++) { const t = i / N * 2 * Math.PI; push(shape.cx + shape.rx * Math.cos(t), shape.cy + shape.ry * Math.sin(t)); }
  }
  return out;
}

module.exports = { PEN_TYPES, sketchStrokePath, rdpSimplify, recognizeShape, shapeToPoints };
