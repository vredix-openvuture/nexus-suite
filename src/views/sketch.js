'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · quick sketch
 *  Vector drawing engine + SVG (de)serialization for the `quicksketch` block.
 *
 *  Storage is a plain .svg sidecar (max. independence from Obsidian): the file
 *  is a normal, standalone-viewable SVG image (background pattern + rendered
 *  <path> outlines) that ALSO carries the raw stroke data (points + pressure)
 *  as JSON inside its <metadata>. Any external tool sees an image; we read the
 *  metadata back for lossless re-editing. See toSVGString / parseSketchSVG.
 *
 *  Input goes through Pointer Events → mouse, touch AND digital pen in one
 *  code path. Pen pressure (e.pressure) drives per-point stroke width; mouse /
 *  touch fall back to a constant 0.5. Raw samples are STREAMLINED (each new
 *  point eased toward the cursor) + distance-filtered → jitter-free strokes.
 *  touch-action:none (CSS) stops the page scrolling while drawing = mobile.
 * ========================================================================== */

const SVGNS = 'http://www.w3.org/2000/svg';
const LOGICAL_W = 1600;          // fixed logical canvas width (viewBox units)
const ERASE_R = 16;              // eraser hit radius, viewBox units
const AUTOGROW_MARGIN = 40;      // auto-grow: start extending when the pen is this close to the bottom
const AUTOGROW_LOOKAHEAD = 170;  // ...and keep this much blank space below it
const PALM_MS = 600;             // palm rejection: ignore touches this soon after any pen contact/hover
const HOLD_MS = 650;             // shape snap: hold the pen still this long after drawing …
const HOLD_R = 7;                // … within this radius (viewBox units) to trigger recognition

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

function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/* Ratio string ("16:9" / "16/9" / "1.5") → [W, H] in logical units. */
function ratioWH(ratio) {
  const m = String(ratio || '16:9').split(/[:/]/).map(x => parseFloat(x));
  const rw = m[0] > 0 ? m[0] : 16;
  const rh = (m.length > 1 && m[1] > 0) ? m[1] : 9;
  return [LOGICAL_W, Math.round(LOGICAL_W * rh / rw)];
}

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

/* Pencil grain: an SVG filter that punches fractal-noise holes into a stroke's
   fill → a graphite/tooth stipple. Same markup drives the live DOM and the
   exported file. Only pencil strokes reference it (cheap no-op otherwise). */
function pencilFilterStr(id) {
  return `<filter id="${id}" x="-12%" y="-12%" width="124%" height="124%">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed="7" result="n"/>`
    + `<feComponentTransfer in="n" result="m"><feFuncA type="discrete" tableValues="0 0 0.4 0.75 1"/></feComponentTransfer>`
    + `<feComposite in="SourceGraphic" in2="m" operator="in"/>`
    + `</filter>`;
}

/* One tile of a background pattern → { w, h, inner } where `inner` is an SVG
   markup STRING. Used for BOTH the live DOM (parsed via DOMParser, like the
   pencil filter) and the export, so one source of truth drives every renderer
   and multi-line tiles (isometric, graph…) stay simple. null = none/unknown. */
const SQRT3 = 1.7320508075688772;
function bgPatternTile(type, size, color, opacity) {
  const s = size;
  const ln = (d, w) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w || 2}" stroke-linecap="round" stroke-opacity="${opacity}"/>`;
  const dt = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r || 2.4}" fill="${color}" fill-opacity="${opacity}"/>`;
  switch (type) {
    case 'dots':  return { w: s, h: s, inner: dt(s / 2, s / 2) };
    case 'lines': return { w: s, h: s, inner: ln(`M0 ${s} L${s} ${s}`) };
    case 'grid':  return { w: s, h: s, inner: ln(`M${s} 0 L0 0 L0 ${s}`) };
    case 'cross': {   // small plus centred in each tile (kept off the edge so no clipping)
      const c = Math.max(2.5, s * 0.16), m = s / 2;
      return { w: s, h: s, inner: ln(`M${m - c} ${m} L${m + c} ${m}`) + ln(`M${m} ${m - c} L${m} ${m + c}`) };
    }
    case 'graph': {   // engineering paper: thin minor grid + bold major every 5th
      let inner = '';
      for (let i = 1; i < 5; i++) inner += ln(`M${i * s} 0 L${i * s} ${5 * s}`, 1) + ln(`M0 ${i * s} L${5 * s} ${i * s}`, 1);
      inner += ln(`M0 0 L0 ${5 * s}`, 2) + ln(`M0 0 L${5 * s} 0`, 2);
      return { w: 5 * s, h: 5 * s, inner };
    }
    case 'isometric': {   // triangular grid: two horizontals + a ±60° diagonal each
      const h = s * SQRT3;
      return { w: s, h, inner:
        ln(`M0 0 L${s} 0`) + ln(`M0 ${h / 2} L${s} ${h / 2}`) +
        ln(`M0 0 L${s} ${h}`) + ln(`M0 ${h} L${s} 0`) };
    }
    case 'isodots': {   // isometric (triangular) dot lattice, shifted off the tile edges
      const h = s * SQRT3;
      return { w: s, h, inner: dt(s / 4, h / 4) + dt(3 * s / 4, 3 * h / 4) };
    }
    default: return null;
  }
}

/* Subtle paper grain/crinkle for the "paper style" toggle. A small stitched
   feTurbulence tile overlaid in multiply → very light fibre + soft fold mottling.
   Tiled (not a full-canvas filter) so an endless slate stays cheap and flat in
   memory; lives in the SVG so the export looks the same. */
const PAPER_TEX_TILE = 240;
function paperTexDefsStr(filtId, patId) {
  return `<filter id="${filtId}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="5" seed="11" stitchTiles="stitch" result="n"/>`
    + `<feColorMatrix in="n" type="matrix" values="0.09 0 0 0 0.91  0.09 0 0 0 0.91  0.09 0 0 0 0.91  0 0 0 0 1"/>`
    + `</filter>`
    + `<pattern id="${patId}" width="${PAPER_TEX_TILE}" height="${PAPER_TEX_TILE}" patternUnits="userSpaceOnUse">`
    + `<rect width="${PAPER_TEX_TILE}" height="${PAPER_TEX_TILE}" filter="url(#${filtId})"/>`
    + `</pattern>`;
}

/* Parse #rgb / #rrggbb / rgb() / rgba() → { r, g, b (0-255), a (0-1) } or null. */
function parseColor(c) {
  if (typeof c !== 'string') return null;
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 }; }
  m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(',').map(x => parseFloat(x.trim())); if (p.length >= 3 && p.every(n => !isNaN(n))) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  return null;
}

/* On dark paper, only ink that sits too close to black is lifted; anything with a
   channel brighter than this (HSV value) is a vivid colour and stays as drawn. */
const INK_LIFT_MAXV = 0.4;

/* Luminance-invert a colour (dark ↔ light) while keeping its hue — matches the
   CSS `invert(1) hue-rotate(180deg)` used for dark-paper mode. Alpha preserved,
   so a black-on-white drawing reads as white-on-black and colours just lighten. */
function lumInvertColor(color) {
  const c = parseColor(color);
  if (!c) return color;
  const r = 1 - c.r / 255, g = 1 - c.g / 255, b = 1 - c.b / 255;   // invert
  const R = -0.574 * r + 1.430 * g + 0.144 * b;                    // + hue-rotate 180°
  const G =  0.426 * r + 0.430 * g + 0.144 * b;
  const B =  0.426 * r + 1.430 * g - 0.856 * b;
  const q = x => Math.max(0, Math.min(255, Math.round(x * 255)));
  const rr = q(R), gg = q(G), bb = q(B);
  if (c.a != null && c.a < 1) return `rgba(${rr},${gg},${bb},${c.a})`;
  return '#' + [rr, gg, bb].map(v => v.toString(16).padStart(2, '0')).join('');
}

/* Parse a sidecar back into its data object from the <metadata> JSON. Returns
   null for a non-sketch / malformed SVG (we then leave the file alone rather
   than clobbering a hand-edited image). */
function parseSketchSVG(text) {
  try {
    const doc = new DOMParser().parseFromString(text || '', 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    const meta = doc.querySelector('metadata');
    if (!meta) return null;
    const data = JSON.parse((meta.textContent || '').trim());
    if (!data || !Array.isArray(data.strokes)) return null;
    return data;
  } catch (e) { return null; }
}

/* Named paper backgrounds. `bg` = solid fill colour ('' = transparent, so the
   host note's own background shows through = "native"). `grid` = the pattern
   colour that reads well on that fill. Lives here in the engine (Obsidian-free)
   so the exported SVG carries the same paper everywhere it's viewed. */
const PAPER_MODES = {
  native: { bg: '',        grid: '#808080' },   // '' → transparent; the host paints the note's own background
  paper:  { bg: '#f7f6f2', grid: '#334155' },   // slightly yellowish off-white
  white:  { bg: '#ffffff', grid: '#334155' },
  black:  { bg: '#141414', grid: '#c9c9c9', dark: true },   // dark → near-black ink is lifted (if invertOnDark)
};

/* ── The drawing surface. Pure engine: knows nothing about Obsidian. Mount it
      in a code block (inline) or later in a full-screen modal — same class. ── */
class NexusSketchSurface {
  constructor(host, opts) {
    opts = opts || {};
    this.host = host;
    this.W = opts.W || LOGICAL_W;
    this.H = opts.H || Math.round(this.W * 9 / 16);
    // Paper = named background preset (native/white/black). Owns the solid fill
    // AND the pattern colour so grid/lines stay legible on it. `null` → honour the
    // raw bg/bgColor (back-compat with sketches saved before paper).
    this.paper = (opts.paper && PAPER_MODES[opts.paper]) ? opts.paper : null;
    if (this.paper) {
      this.bg = PAPER_MODES[this.paper].bg;
      this.bgColor = PAPER_MODES[this.paper].grid;
    } else {
      this.bg = opts.bg || '';
      this.bgColor = opts.bgColor || '#334155';
    }
    this.paperStyle = !!opts.paperStyle;   // paper-grain texture overlay — independent of the paper colour
    this.bgType = opts.bgType || 'none';
    this.bgSize = opts.bgSize || 40;
    this.bgOpacity = (opts.bgOpacity != null) ? opts.bgOpacity : 0.12;
    this.color = opts.ink || '#2f2f2f';
    // Dark-paper mode: luminance-invert the ink so drawings stay readable on a
    // dark background (setting-gated; only paper modes flagged `dark`).
    this.invertOnDark = opts.invertOnDark !== false;
    this._updateInvert();
    // Brush size in on-screen px, remembered PER PEN (converted to logical units
    // per stroke). Switching pens restores that pen's own width.
    this.penSizes = Object.assign({ fountain: 3, ballpoint: 2, pencil: 2.5, brush: 5, calligraphy: 3.5, marker: 10 }, opts.penSizes || {});
    this.pen = PEN_TYPES[opts.pen] ? opts.pen : 'fountain';
    this.penConfig = opts.penConfig || {};               // per-pen user overrides (live object, read at stroke start)
    this.shapeSnap = opts.shapeSnap !== false;           // hold-still-after-drawing → snap to shape
    this.streamline = (opts.streamline != null) ? opts.streamline : 0.55;   // fallback if a pen defines none
    this.minDist = (opts.minDist != null) ? opts.minDist : 2;                // viewBox units between samples
    this.mode = 'draw';
    // Human name for the drawing, kept IN the sidecar (not in the note) so it
    // travels with the sketch to every note that embeds it.
    this.title = opts.title || '';
    this.locked = !!opts.locked;                         // view mode: gestures work, drawing doesn't (see setLocked)
    this.autoGrow = !!opts.autoGrow;                     // extend the canvas down while drawing near the bottom
    this.fixedViewport = !!opts.fixedViewport;           // protokoll paper: no pan, no zoom — only the outer container scrolls
    // Pan/zoom viewport = the visible sub-rect of the canvas (viewBox). Aspect is
    // kept locked to W/H so the element size (height:auto) never jumps. Only pen/
    // mouse draw; fingers pan (1) / pinch-zoom (2). See _touch* below.
    this.viewX = 0; this.viewY = 0; this.viewW = this.W;
    this._touches = new Map();                           // active touch pointers → client coords
    this.onCommit = opts.onCommit || null;
    this.resizable = !!opts.resizable;
    this.strokes = Array.isArray(opts.strokes) ? JSON.parse(JSON.stringify(opts.strokes)) : [];
    this.undoStack = []; this.redoStack = [];
    this._pid = 'nxsk-' + Math.random().toString(36).slice(2, 9);
    this._texFilt = this._pid + '-tf'; this._texPat = this._pid + '-tp';   // paper-texture def ids
    this._build();
    this._renderStrokes();
  }

  _build() {
    // width/height attrs give the SVG a solid intrinsic aspect ratio so CSS
    // `width:100%; height:auto` sizes the pad EVERYWHERE — no dependency on CSS
    // `aspect-ratio`, which older mobile WebViews lack (→ 0-height, invisible pad).
    const svg = svgEl('svg', { class: 'nx-sketch-surface', viewBox: `0 0 ${this.W} ${this.H}`, width: this.W, height: this.H, preserveAspectRatio: 'none' });
    this.svg = svg;
    if (this.bg) { this.bgRect = svgEl('rect', { x: 0, y: 0, width: this.W, height: this.H, fill: this.bg }); svg.appendChild(this.bgRect); }
    this.gStrokes = svgEl('g', { class: 'nx-sk-committed' });
    this.livePath = svgEl('path', { class: 'nx-sk-live' });
    svg.appendChild(this.gStrokes);
    svg.appendChild(this.livePath);
    // Pencil grain filter — added once; only pencil strokes reference it. Guard
    // with _pfxOk so a failed parse never leaves strokes pointing at a missing
    // filter (which would make them render as nothing).
    this._pfx = this._pid + '-pf';
    this._pfxOk = false;
    try {
      const doc = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}"><defs>${pencilFilterStr(this._pfx)}</defs></svg>`, 'image/svg+xml');
      const dfs = doc.querySelector('defs');
      if (dfs && !doc.querySelector('parsererror')) { this.svg.appendChild(document.importNode(dfs, true)); this._pfxOk = true; }
    } catch (e) {}
    this.host.appendChild(svg);
    // LOW-LATENCY live layer: the in-progress stroke is drawn on a canvas
    // overlay with a desynchronized 2d context — Chrome/WebView's front-buffer
    // path that skips the compositor queue (the same trick native-feeling web
    // drawing apps use). SVG only receives the committed stroke on release;
    // updating SVG per-move rides the full compositor pipeline (~2-4 frames
    // behind the pen) no matter how fast our math is.
    this.liveCanvas = document.createElement('canvas');
    this.liveCanvas.className = 'nx-sk-livecanvas';
    this.host.appendChild(this.liveCanvas);
    this._livePaths = [];
    this._buildBg();
    this._buildPaperTex();
    this._applyPaperClass();

    svg.addEventListener('pointerdown', (e) => this._onDown(e));
    svg.addEventListener('pointermove', (e) => this._onMove(e));
    svg.addEventListener('pointerup', (e) => this._onUp(e));
    svg.addEventListener('pointercancel', (e) => this._onUp(e));

    if (this.resizable) this._buildResizeHandle();
  }

  /* Transparent paper ("native", bg='') → let the host element paint the note's
     own background (CSS var), so it truly matches the surrounding note instead of
     whatever container happens to sit behind the transparent SVG. */
  _applyPaperClass() {
    if (this.host && this.host.classList) this.host.classList.toggle('nx-sk-nativebg', !this.bg);
  }

  /* Parse an SVG-markup string into a live <defs> node and return it (same trick
     as the pencil filter — lets multi-element tiles/filters share one source of
     truth with the export). null on parse failure. */
  _parseDefs(inner) {
    try {
      const doc = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}"><defs>${inner}</defs></svg>`, 'image/svg+xml');
      const dfs = doc.querySelector('defs');
      if (!dfs || doc.querySelector('parsererror')) return null;
      return document.importNode(dfs, true);
    } catch (e) { return null; }
  }

  _buildBg() {
    if (this._defs) { this._defs.remove(); this._defs = null; }
    if (this.patRect) { this.patRect.remove(); this.patRect = null; }
    if (this.bgType === 'none' || !this.bgOpacity) return;
    const tile = bgPatternTile(this.bgType, this.bgSize, this.bgColor, this.bgOpacity);
    if (!tile) return;
    const defs = this._parseDefs(`<pattern id="${this._pid}" width="${tile.w}" height="${tile.h}" patternUnits="userSpaceOnUse">${tile.inner}</pattern>`);
    if (!defs) return;
    this._defs = defs;
    this.patRect = svgEl('rect', { x: 0, y: 0, width: this.W, height: this.H, fill: `url(#${this._pid})` });
    this.svg.insertBefore(defs, this.svg.firstChild);
    this.svg.insertBefore(this.patRect, this.gStrokes);   // above paper, below ink
  }

  /* Paper-grain overlay (paper-style toggle) — sits above the solid fill, below
     the grid + ink. Rebuilt only on paper/style change (never on the bg slider),
     so the feTurbulence tile is parsed once, not per drag. */
  _buildPaperTex() {
    if (this._texDefs) { this._texDefs.remove(); this._texDefs = null; }
    if (this.texRect) { this.texRect.remove(); this.texRect = null; }
    if (!this.paperStyle) return;
    const defs = this._parseDefs(paperTexDefsStr(this._texFilt, this._texPat));
    if (!defs) return;
    this._texDefs = defs;
    this.svg.insertBefore(defs, this.svg.firstChild);
    this.texRect = svgEl('rect', { x: 0, y: 0, width: this.W, height: this.H, fill: `url(#${this._texPat})`, style: 'mix-blend-mode:multiply' });
    this.svg.insertBefore(this.texRect, this.patRect || this.gStrokes);   // above paper, below grid/ink
  }

  _buildResizeHandle() {
    const h = document.createElement('div');
    h.className = 'nx-sketch-resize';
    h.setAttribute('aria-label', 'Drag to resize');
    this.host.appendChild(h);
    let startY = 0, startPxH = 0, pxW = 0;
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = this.host.getBoundingClientRect();
      startY = e.clientY; startPxH = r.height; pxW = r.width;
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
      this._resizing = true;
    });
    h.addEventListener('pointermove', (e) => {
      if (!this._resizing) return;
      const newPxH = startPxH + (e.clientY - startY);
      this.setHeight(Math.round(this.W * newPxH / pxW));   // setHeight clamps to content
    });
    const end = () => { if (!this._resizing) return; this._resizing = false; this._changed(); };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }

  /* Lowest point of any stroke (+ its half-width) → the canvas can never be
     shrunk below this, so drawn content is never clipped off the bottom. */
  _contentMinHeight() {
    let maxY = 0;
    for (const st of this.strokes) {
      const r = (st.size || 6) / 2;
      for (const p of st.points) { const y = p[1] + r; if (y > maxY) maxY = y; }
    }
    return Math.max(120, Math.ceil(maxY) + 8);
  }
  setHeight(H) {
    this.H = Math.max(this._contentMinHeight(), H);
    this.svg.setAttribute('height', this.H);   // updates intrinsic ratio → CSS height:auto follows
    if (this.bgRect) this.bgRect.setAttribute('height', this.H);
    if (this.patRect) this.patRect.setAttribute('height', this.H);
    if (this.texRect) this.texRect.setAttribute('height', this.H);
    this._applyView();                          // viewBox follows the new height (keeps pan/zoom valid)
  }

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
    if (!this.shapeSnap) return;
    this._holdTimer = setTimeout(() => { this._holdTimer = null; this._trySnapShape(); }, HOLD_MS);
  }
  _trySnapShape() {
    const st = this._active;
    if (!st || st._snapped || this._erasing) return;
    const shape = recognizeShape(st.points);
    if (!shape) return;
    st.points = shapeToPoints(shape);
    st.thinning = 0; st.taper = 0;       // shapes render with a clean uniform width
    st._snapped = true;
    st._raw = null;
    // Full live repaint with the snapped geometry.
    this._chunkStart = 0; this._livePaths = [];
    this._drawLive();
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
  }

  /* ── Finger gestures — fingers NEVER draw:
        1 finger          = pan the canvas (viewBox sub-rect)
        2 fingers parallel = scroll the PAGE (the note's scroller — the whole
                             code block moves, like normal note scrolling)
        2 fingers pinching = zoom the canvas
        Palm rejection: any touch arriving within PALM_MS of pen contact/hover
        is ignored outright, and a pen-down clears any finger gesture. ── */
  _touchDown(e) {
    if (this._active || this._erasing) return;                          // pen is drawing → ignore stray finger
    if (performance.now() - (this._lastPen || 0) < PALM_MS) return;     // palm rejection
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._touches.size === 1) {
      this._startOneFinger();
    } else if (this._touches.size === 2) {
      // Undecided until the fingers move: distance change → zoom, parallel → page scroll.
      const [a, b] = [...this._touches.values()];
      this._gestMode = 'pending';
      this._pending = { d: Math.hypot(b.x - a.x, b.y - a.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this._scroller = this._findScroller();
      this._scrollStart = this._scroller ? { top: this._scroller.scrollTop, left: this._scroller.scrollLeft } : null;
    }
  }
  _touchMove(e) {
    const t = this._touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (this._gestRaf) return;
    this._gestRaf = requestAnimationFrame(() => { this._gestRaf = null; this._applyGesture(); });
  }
  _touchUp(e) {
    if (!this._touches.delete(e.pointerId)) return;
    if (this._touches.size === 1) this._startOneFinger();
    else if (!this._touches.size) this._gestMode = null;
  }
  /* One finger: pans the canvas ONLY while zoomed in; otherwise it scrolls the
     page/stage. An un-zoomed pan is a no-op, so a one-finger drag should scroll
     the note (reading) or the full-size editor's stage (editing) — the pen
     draws, the finger navigates. */
  _startOneFinger() {
    const f = [...this._touches.values()][0];
    if (this.viewW >= this.W - 0.5) {
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
    const vh = this.viewW * this.H / this.W;
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
    if (this._gestMode === 'pan' && live.length === 1) {
      const g = this._gesture; if (!g || !g.anchors.length) return;
      const a = g.anchors[0], f = live[0], e = g.e;
      this.viewX = a.cx - (f.x - e.left) / e.w * this.viewW;
      this.viewY = a.cy - (f.y - e.top) / e.h * (this.viewW * this.H / this.W);
      this._applyView();
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
        if (!this.fixedViewport && Math.abs(d - this._pending.d) > 24) { this._gestMode = 'zoom'; this._gestureRef(); }
        else if (this.fixedViewport || Math.hypot(cx - this._pending.cx, cy - this._pending.cy) > 12) this._gestMode = 'scroll';
        else return;   // not decided yet
      }
      if (this._gestMode === 'zoom') {
        const g = this._gesture; if (!g || g.anchors.length < 2) return;
        const a0 = g.anchors[0], a1 = g.anchors[1], e = g.e;
        const ca = Math.hypot(a1.cx - a0.cx, a1.cy - a0.cy) || 1;
        this.viewW = Math.max(this.W / 6, Math.min(this.W, ca * e.w / d));
        this.viewX = a0.cx - (f0.x - e.left) / e.w * this.viewW;
        this.viewY = a0.cy - (f0.y - e.top) / e.h * (this.viewW * this.H / this.W);
        this._applyView();
        return;
      }
    }
    if (this._gestMode === 'scroll' && this._scroller && this._scrollStart) {
      this._scroller.scrollTop = this._scrollStart.top - (cy - this._pending.cy);
      // Fixed viewport (protokoll/slate paper) never scrolls sideways.
      if (!this.fixedViewport) this._scroller.scrollLeft = this._scrollStart.left - (cx - this._pending.cx);
    }
  }
  _applyView() {
    this.viewW = Math.max(this.W / 6, Math.min(this.W, this.viewW));
    const vh = this.viewW * this.H / this.W;
    // HARD clamp to the canvas bounds — the view must never show empty space
    // beyond an edge. (Fully zoomed out this means panning is a no-op, which is
    // the expected behavior: there is nothing to pan.)
    this.viewX = Math.max(0, Math.min(this.W - this.viewW, this.viewX));
    this.viewY = Math.max(0, Math.min(Math.max(0, this.H - vh), this.viewY));
    this.svg.setAttribute('viewBox', `${this.viewX.toFixed(2)} ${this.viewY.toFixed(2)} ${this.viewW.toFixed(2)} ${vh.toFixed(2)}`);
  }

  /* Streamlined + distance-filtered point capture. Each new sample is eased
     toward the raw cursor position; samples closer than minDist are dropped.
     `force` (final point on release) bypasses both so the stroke ends exactly
     where the pen lifted. */
  _addPoint(x, y, p, force, t) {
    const st = this._active, pts = st.points;
    if (st._snapped) return;   // shape locked in — ignore further movement until release
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

  _onDown(e) {
    if (e.pointerType === 'pen') this._lastPen = performance.now();   // palm rejection window
    if (e.pointerType === 'touch') { this._touchDown(e); return; }    // finger = pan / page-scroll / zoom, never draws
    if (this.locked) return;                                          // view mode: pen/mouse never draw or erase
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Pen wins over fingers: a palm that slipped in as a "pan" gets dropped the
    // moment the pen actually touches down.
    if (this._touches.size) { this._touches.clear(); this._gestMode = null; }
    e.preventDefault();
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    this._ctmInv = this._invCTM();   // cache once per stroke (see _pt)
    if (this.mode === 'erase') { this._erasing = true; this._eraseSnapped = false; this._eraseAt(this._pt(e)); return; }
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
    this._speedThin = pt.speedThin || 0;
    this._vSm = 0; this._lastRawT = e.timeStamp;
    this._chunkStart = 0;
    this._livePaths = [];
    this._setupLiveCanvas();
    // Translucent pens draw at FULL alpha into the canvas and the ELEMENT gets
    // the opacity — so live chunk overlaps can't stack darker than the final.
    this.liveCanvas.style.mixBlendMode = pt.blend ? 'multiply' : '';
    this.liveCanvas.style.opacity = (pt.opacity != null && pt.opacity < 1) ? String(pt.opacity) : '';
    this._addPoint(p.x, p.y, this._pressure(e));
    this._drawLive();
    this._holdAnchor = { x: p.x, y: p.y };
    this._armHold();
  }
  _onMove(e) {
    if (e.pointerType === 'pen') this._lastPen = performance.now();   // hover counts too — palm lands while the pen approaches
    if (e.pointerType === 'touch') { this._touchMove(e); return; }
    if (this._erasing) { this._eraseAt(this._pt(e)); return; }
    if (!this._active) return;
    e.preventDefault();
    const evts = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    for (const ev of evts) { const p = this._pt(ev); this._addPoint(p.x, p.y, this._pressure(ev), false, ev.timeStamp != null ? ev.timeStamp : e.timeStamp); }
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
    // Auto-grow: keep headroom below the pen so you can keep writing downward.
    if (this.autoGrow) {
      const pts = this._active.points, y = pts.length ? pts[pts.length - 1][1] : 0;
      if (y > this.H - AUTOGROW_MARGIN) {
        this.setHeight(Math.ceil(y + AUTOGROW_LOOKAHEAD));
        this._ctmInv = this._invCTM();
        this._setupLiveCanvas();   // element grew → resize backing store (clears) …
        this._drawLive();          // … and repaint chunks + tail
      }
    }
  }
  _onUp(e) {
    if (e.pointerType === 'touch') { this._touchUp(e); return; }
    this._ctmInv = null;
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (this._erasing) { this._erasing = false; this.livePath.removeAttribute('d'); if (this._changedDuringErase) { this._changedDuringErase = false; this._changed(); } return; }
    if (!this._active) return;
    const st = this._active; this._active = null;
    if (st._raw && !st._snapped) this._addPointFinal(st, st._raw);
    this.livePath.removeAttribute('d');
    this._clearLiveCanvas();   // live layer → replaced by one committed SVG outline
    delete st._raw; delete st._sl; delete st._snapped;   // transient fields — keep the saved stroke lean
    if (st.points.length) { this._snapshot(); this.strokes.push(st); this._appendStroke(st); this._changed(); }
  }
  _addPointFinal(st, raw) {
    const last = st.points[st.points.length - 1];
    if (last && Math.hypot(raw[0] - last[0], raw[1] - last[1]) < 0.6) return;
    st.points.push([+raw[0].toFixed(1), +raw[1].toFixed(1), +raw[2].toFixed(2)]);
  }

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
    if (this.liveCanvas.width !== w || this.liveCanvas.height !== h) { this.liveCanvas.width = w; this.liveCanvas.height = h; }
    this.liveCanvas.style.top = top + 'px';
    this.liveCanvas.style.bottom = 'auto';
    this.liveCanvas.style.height = height + 'px';
    if (!this._lctx) this._lctx = this.liveCanvas.getContext('2d', { desynchronized: true });
    this._lscale = { s: w / this.viewW, x: this.viewX, y: this.viewY + top * (this.viewW / (r.width || 1)) };
  }
  _clearLiveCanvas() {
    this._livePaths = [];
    this.liveCanvas.style.mixBlendMode = '';
    this.liveCanvas.style.opacity = '';
    if (!this._lctx) return;
    this._lctx.setTransform(1, 0, 0, 1, 0, 0);
    this._lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
  }
  // INCREMENTAL live render on the desynchronized canvas: completed point
  // ranges are frozen ONCE into cached Path2Ds (overlapping so they union
  // seamlessly under the same fill); per event we clear + refill the cached
  // chunks and rebuild only the short tail outline. The tail is extended to
  // the RAW pen position (st._raw) so the ink visually touches the pen tip —
  // the streamline smoothing otherwise trails it by design and reads as lag.
  _drawLive() {
    if (!this._active || !this._lctx) return;
    const st = this._active, pts = st.points, CHUNK = 24, OVERLAP = 6;
    const baseO = { thinning: st.thinning, cap: st.cap, nib: st.nib };
    while (pts.length - this._chunkStart > CHUNK + OVERLAP) {
      const seg = pts.slice(this._chunkStart, this._chunkStart + CHUNK + OVERLAP);
      // Taper only the stroke's true START on the first chunk — interior chunk
      // boundaries must stay full-width or the stroke would pinch mid-line.
      const d = sketchStrokePath(seg, st.size, Object.assign({}, baseO, { taperStart: this._chunkStart === 0 ? st.taper : 0, taperEnd: 0, cap: 'round' }));
      if (d) this._livePaths.push(new Path2D(d));
      this._chunkStart += CHUNK;
    }
    const tail = pts.slice(this._chunkStart);
    if (st._raw && !st._snapped) {
      const l = tail[tail.length - 1];
      if (!l || Math.hypot(st._raw[0] - l[0], st._raw[1] - l[1]) > 0.3) tail.push(st._raw);
    }
    const ctx = this._lctx, sc = this._lscale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    ctx.setTransform(sc.s, 0, 0, sc.s, -sc.x * sc.s, -sc.y * sc.s);
    ctx.fillStyle = this._inkColor(st.color);
    ctx.globalAlpha = 1;   // translucency lives on the canvas ELEMENT (see _onDown) → overlaps stay uniform
    for (const p of this._livePaths) ctx.fill(p);
    // Tail: start-taper only while un-chunked; end always tapers (the live nib tip).
    const d = sketchStrokePath(tail, st.size, Object.assign({}, baseO, { taperStart: this._chunkStart === 0 ? st.taper : 0, taperEnd: st.taper }));
    if (d) ctx.fill(new Path2D(d));
  }

  _eraseAt(p) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const st = this.strokes[i];
      const hitR = st.size / 2 + ERASE_R;
      if (st.points.some(pt => Math.hypot(pt[0] - p.x, pt[1] - p.y) <= hitR)) {
        if (!this._eraseSnapped) { this._snapshot(); this._eraseSnapped = true; }
        this.strokes.splice(i, 1);
        this._renderStrokes();
        this._changedDuringErase = true;
      }
    }
  }

  _strokeD(st) {
    return sketchStrokePath(st.points, st.size, { thinning: st.thinning, taperStart: st.taper || 0, taperEnd: st.taper || 0, cap: st.cap, nib: st.nib });
  }
  /* noStack strokes (highlighter): CONSECUTIVE strokes of the same colour+opacity
     render inside ONE <g fill-opacity> — overlaps inside a group don't darken
     (single compositing pass), so repeated highlighting stays uniform. */
  _appendStroke(st) {
    const d = this._strokeD(st);
    if (!d) return;
    if (st.noStack) {
      const key = st.color + '|' + (st.opacity != null ? st.opacity : 1) + '|' + (st.blend ? 1 : 0);
      if (!this._grpEl || this._grpKey !== key || this.gStrokes.lastChild !== this._grpEl) {
        this._grpEl = svgEl('g', { fill: this._inkColor(st.color) });
        // Group `opacity` (NOT fill-opacity, which is inherited per child and
        // stacks at overlaps): the group composites as ONE translucent layer.
        if (st.opacity != null && st.opacity < 1) this._grpEl.setAttribute('opacity', st.opacity);
        if (st.blend) this._grpEl.setAttribute('style', 'mix-blend-mode:multiply');
        this._grpKey = key;
        this.gStrokes.appendChild(this._grpEl);
      }
      this._grpEl.appendChild(svgEl('path', { d }));
      return;
    }
    this._grpEl = null; this._grpKey = null;
    const attrs = { d, fill: this._inkColor(st.color) };
    if (st.opacity != null && st.opacity < 1) attrs['fill-opacity'] = st.opacity;
    if (st.blend) attrs.style = 'mix-blend-mode: multiply';
    if (st.grain && this._pfxOk) attrs.filter = `url(#${this._pfx})`;   // pencil tooth
    this.gStrokes.appendChild(svgEl('path', attrs));
  }
  _renderStrokes() {
    while (this.gStrokes.firstChild) this.gStrokes.removeChild(this.gStrokes.firstChild);
    this._grpEl = null; this._grpKey = null;
    for (const st of this.strokes) this._appendStroke(st);
  }

  _snapshot() { this.undoStack.push(JSON.stringify(this.strokes)); if (this.undoStack.length > 120) this.undoStack.shift(); this.redoStack = []; }
  _changed() { if (this.onCommit) this.onCommit(); }

  /* Dark-paper ink inversion. `_inkColor` is applied everywhere a stroke colour
     is painted (live canvas, committed DOM, export) so the flip is consistent and
     non-destructive — the stored `st.color` never changes. */
  _updateInvert() { this._inkInv = this.invertOnDark && !!(PAPER_MODES[this.paper] && PAPER_MODES[this.paper].dark); }
  _inkColor(c) {
    if (!this._inkInv) return c;
    const rgb = parseColor(c);
    if (!rgb) return c;
    // Only lift near-black ink (all channels dim); vivid colours stay punchy.
    return (Math.max(rgb.r, rgb.g, rgb.b) / 255 < INK_LIFT_MAXV) ? lumInvertColor(c) : c;
  }
  setInvertOnDark(v) { this.invertOnDark = !!v; this._updateInvert(); this._renderStrokes(); this._drawLive(); }

  /* ── public control surface (wired to the toolbar in main.js) ── */
  setColor(c) { this.color = c; }
  setSize(px) { this.penSizes[this.pen] = px; }
  getSize() { return this.penSizes[this.pen]; }
  setPen(p) { if (PEN_TYPES[p]) this.pen = p; }
  setMode(m) { this.mode = m; }
  setLocked(v) { this.locked = !!v; }
  // Rebuild-only (no persist) so slider drags stay cheap; caller calls persist()
  // on release.
  setBackground(type, size, opacity) {
    if (type != null) this.bgType = type;
    if (size != null) this.bgSize = size;
    if (opacity != null) this.bgOpacity = opacity;
    this._buildBg();
  }
  /* Toggle the paper-grain texture overlay on/off (works on any paper colour). */
  setPaperStyle(on) { this.paperStyle = !!on; this._buildPaperTex(); }
  /* Switch the paper preset (native/white/black): swaps the solid fill rect and
     repaints the pattern in the mode's matching grid colour. */
  setPaper(mode) {
    if (!PAPER_MODES[mode]) return;
    this.paper = mode;
    this.bg = PAPER_MODES[mode].bg;
    this.bgColor = PAPER_MODES[mode].grid;
    if (this.bgRect) { this.bgRect.remove(); this.bgRect = null; }
    if (this.bg) {
      this.bgRect = svgEl('rect', { x: 0, y: 0, width: this.W, height: this.H, fill: this.bg });
      this.svg.insertBefore(this.bgRect, this.svg.firstChild);   // very bottom of the stack
    }
    this._buildBg();         // pattern picks up the new bgColor
    this._buildPaperTex();   // add/remove the paper grain for the new mode
    this._applyPaperClass();
    const wasInv = this._inkInv;
    this._updateInvert();
    if (this._inkInv !== wasInv) this._renderStrokes();   // dark↔light: repaint ink in the (un)inverted colour
  }
  persist() { this._changed(); }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.strokes)); this.strokes = JSON.parse(this.undoStack.pop()); this._renderStrokes(); this._changed(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.strokes)); this.strokes = JSON.parse(this.redoStack.pop()); this._renderStrokes(); this._changed(); }
  clear() { if (!this.strokes.length) return; this._snapshot(); this.strokes = []; this._renderStrokes(); this._changed(); }

  toSVGString() {
    const meta = JSON.stringify({
      v: 1, w: this.W, h: this.H, bg: this.bg, paper: this.paper, paperStyle: this.paperStyle,
      bgType: this.bgType, bgSize: this.bgSize, bgOpacity: this.bgOpacity, bgColor: this.bgColor,
      autoGrow: this.autoGrow,
      title: this.title || undefined,
      strokes: this.strokes,
    });
    let defs = '', body = '';
    if (this.strokes.some(st => st.grain)) defs += `<defs>${pencilFilterStr(this._pfx)}</defs>`;
    if (this.bg) body += `<rect x="0" y="0" width="${this.W}" height="${this.H}" fill="${this.bg}"/>`;
    if (this.paperStyle) {
      defs += `<defs>${paperTexDefsStr(this._texFilt, this._texPat)}</defs>`;
      body += `<rect x="0" y="0" width="${this.W}" height="${this.H}" fill="url(#${this._texPat})" style="mix-blend-mode:multiply"/>`;
    }
    if (this.bgType !== 'none' && this.bgOpacity) {
      const tile = bgPatternTile(this.bgType, this.bgSize, this.bgColor, this.bgOpacity);
      if (tile) {
        defs += `<defs><pattern id="${this._pid}" width="${tile.w}" height="${tile.h}" patternUnits="userSpaceOnUse">${tile.inner}</pattern></defs>`;
        body += `<rect x="0" y="0" width="${this.W}" height="${this.H}" fill="url(#${this._pid})"/>`;
      }
    }
    for (let i = 0; i < this.strokes.length; i++) {
      const st = this.strokes[i];
      if (st.noStack) {
        // Run of consecutive same-look highlighter strokes → one shared-opacity group.
        let j = i;
        while (j < this.strokes.length && this.strokes[j].noStack &&
               this.strokes[j].color === st.color && this.strokes[j].opacity === st.opacity &&
               !this.strokes[j].blend === !st.blend) j++;
        let g = `<g fill="${this._inkColor(st.color)}"`;
        if (st.opacity != null && st.opacity < 1) g += ` opacity="${st.opacity}"`;   // group opacity = ONE composite layer, overlaps stay uniform
        if (st.blend) g += ' style="mix-blend-mode:multiply"';
        body += g + '>';
        for (; i < j; i++) { const d = this._strokeD(this.strokes[i]); if (d) body += `<path d="${d}"/>`; }
        body += '</g>';
        i--;   // for-loop increments again
        continue;
      }
      const d = this._strokeD(st);
      if (!d) continue;
      let a = `d="${d}" fill="${this._inkColor(st.color)}"`;
      if (st.opacity != null && st.opacity < 1) a += ` fill-opacity="${st.opacity}"`;
      if (st.blend) a += ' style="mix-blend-mode:multiply"';
      if (st.grain) a += ` filter="url(#${this._pfx})"`;
      body += `<path ${a}/>`;
    }
    return `<svg xmlns="${SVGNS}" viewBox="0 0 ${this.W} ${this.H}" width="${this.W}" height="${this.H}">`
      + `<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[${meta}]]></nx-sketch></metadata>`
      + defs + body + '</svg>';
  }
}

module.exports = { NexusSketchSurface, parseSketchSVG, sketchStrokePath, recognizeShape, shapeToPoints, ratioWH, LOGICAL_W, PEN_TYPES };
