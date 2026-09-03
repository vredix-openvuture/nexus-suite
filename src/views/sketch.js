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

const sel = require('../lib/sketchselect.js');
const canvas = require('../lib/sketchcanvas.js');
const objects = require('../lib/sketchobjects.js');
const gestures = require('../lib/sketchgestures.js');

const SVGNS = 'http://www.w3.org/2000/svg';
const LOGICAL_W = 1600;          // fixed logical canvas width (viewBox units)
const ERASE_R = 16;              // eraser hit radius, viewBox units
const AUTOGROW_MARGIN = 60;      // auto-grow: start extending when the pen is this close to the bottom
const AUTOGROW_LOOKAHEAD = 460;  // ...and keep this much blank space below it (big → grows rarely, see _onMove)
const PREDICT_MAX = 34;          // pen prediction: never draw further than this (viewBox units) past the real tip
const PAGE_ZOOM_MAX = 5;         // page zoom: how far a sheet may be magnified (1 = page width)
const PAGE_ZOOM_MIN = 0.3;       // …and how far out, for an overview of a long page (1 = fits the pane)
const TAP_TRAVEL = 6;          // units a stroke may wander and still count as a tap
const HANDLE_PX = 11;          // selection handle radius, ON SCREEN — converted to units per pad size
const SEL_DRAG_PX = 3;         // pointer travel before a press counts as a drag and not a tap
const PALM_MS = 600;             // palm rejection: ignore touches this soon after any pen contact/hover
/* Finger TAPS are a second gesture vocabulary next to pan/scroll/pinch: a tap is
   a touch burst that lifts quickly and never travelled. How many fingers were
   down at once picks the meaning, how many taps followed each other picks the
   rest. See _registerTap. */
/* Generous on purpose. A three-finger tap is six pointer events with a human
   hand between them, and a finger on glass wanders further than a mouse ever
   does — the first numbers here (300 / 10 / 260) were mouse numbers and missed
   real taps on a tablet. */
const TAP_MS = 600;              // a touch burst longer than this is a hold, not a tap
const TAP_SLOP_PX = 18;          // …and one that travels further than this is a drag
const MULTITAP_MS = 420;         // taps closer together than this belong to the same run
const MULTITAP_R = 60;           // …and no further apart on screen than this
/* A sideways throw with ONE finger. The stage scrolls vertically, so a
   horizontal drag had nothing to do — which is what makes it free to mean
   "next page". Only at 1×: zoomed in, sideways is how you look around. */
const SWIPE_PX = 90;             // how far a swipe has to travel to count
const SWIPE_RATIO = 1.8;         // …and how much more sideways than up-down
const SWIPE_MS = 600;            // a slower drag is scrolling, not a swipe
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
   Tiled (not a full-canvas filter) so an endless sheet stays cheap and flat in
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

/* Split a colour into an OPAQUE colour + its alpha. The live layers always paint
   opaque and hand the alpha to their wrapper element, so a chunk seam or a
   tail/chunk overlap can never composite darker than the committed stroke. */
function splitAlpha(c) {
  const p = parseColor(c);
  if (!p || p.a >= 1) return { color: c, alpha: 1 };
  return { color: `rgb(${p.r}, ${p.g}, ${p.b})`, alpha: p.a };
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

/* A brand-new, empty sidecar. Written the moment a note is given a sketch id so
   the Sketch tab always opens on a real file instead of on "not found" — the
   same envelope toSVGString emits, with nothing in it.

   `presets` carries the look of the page it is being added after: paper colour,
   texture, grid. A second page of the same drawing on different paper is not a
   second page, it is a different pad. */
function emptySketchSVG(presets) {
  const p = presets || {};
  const W = p.w || LOGICAL_W;
  const H = p.h || Math.round(W * 3 / 4);
  const meta = { v: 1, w: W, h: H, bg: p.bg || '', paper: p.paper || 'paper', strokes: [] };
  if (p.paperStyle != null) meta.paperStyle = !!p.paperStyle;
  if (p.bgType) meta.bgType = p.bgType;
  if (p.bgSize != null) meta.bgSize = p.bgSize;
  if (p.bgOpacity != null) meta.bgOpacity = p.bgOpacity;
  if (p.bgColor) meta.bgColor = p.bgColor;
  const json = JSON.stringify(meta);
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[${json}]]></nx-sketch></metadata></svg>`;
}

/* The look of a sketch, without its ink — what a new page beside it inherits. */
function sketchPresets(data) {
  if (!data) return {};
  return {
    bg: data.bg, paper: data.paper, paperStyle: data.paperStyle,
    bgType: data.bgType, bgSize: data.bgSize, bgOpacity: data.bgOpacity, bgColor: data.bgColor,
  };
}

/* Rename a page without opening it: rewrite the metadata block in the file's own
   text. The block is exactly what toSVGString emits, so replacing it whole is
   safe — and far safer than reaching into the CDATA, whose `]]>` escaping would
   have to be undone and redone by hand. */
function withSketchTitle(svgText, title, parsed) {
  const data = parsed || parseSketchSVG(svgText);
  if (!data) return null;
  const next = Object.assign({}, data);
  const clean = String(title == null ? '' : title).trim();
  if (clean) next.title = clean; else delete next.title;
  const cdata = JSON.stringify(next).split(']]>').join(']]]]><![CDATA[>');
  const block = `<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[${cdata}]]></nx-sketch></metadata>`;
  if (!/<metadata>[\s\S]*?<\/metadata>/.test(svgText)) return null;
  return svgText.replace(/<metadata>[\s\S]*?<\/metadata>/, () => block);
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
    /* Selection lives here and not in the toolbar: undo, erase and a
       reload all invalidate it, and they all happen in the engine. */
    this.selectShape = 'lasso';   // lasso | rect | ellipse
    this.paperWidth = opts.paperWidth || 0;   // px cap on the sheet, 0 = fill the pane
    // Straight edge: on/off plus a fixed angle in degrees (null = follow the
    // direction the stroke starts in).
    this.ruler = { on: false, angle: null };
    /* Pen buttons and taps. The surface only DETECTS them; what each one
       does is the toolbar's business, so it reports through one callback. */
    this.penMap = opts.penMap || {};
    this.onGesture = opts.onGesture || null;
    this.selection = [];          // indices into this.strokes
    this.onSelect = opts.onSelect || null;
    // Human name for the drawing, kept IN the sidecar (not in the note) so it
    // travels with the sketch to every note that embeds it.
    this.title = opts.title || '';
    this.locked = !!opts.locked;                         // view mode: gestures work, drawing doesn't (see setLocked)
    this.autoGrow = !!opts.autoGrow;                     // extend the canvas down while drawing near the bottom
    // Page zoom: a pinch magnifies the PAPER — the pad element gets wider, the
    // SVG re-lays out crisply at that size and the surrounding scroller handles
    // the rest. A different thing from the viewBox zoom below, which changes
    // what is visible rather than how big the sheet is drawn.
    this.pageZoom = !!opts.pageZoom;
    this.pageScale = 1;
    this.onSwipe = opts.onSwipe || null;                 // 'next' | 'prev' — a sideways throw (see _touchUp)
    // Pan/zoom viewport = the visible sub-rect of the canvas (viewBox). Aspect is
    // kept locked to W/H so the element size (height:auto) never jumps. Only pen/
    // mouse draw; fingers pan (1) / pinch-zoom (2). See _touch* below.
    this.viewX = 0; this.viewY = 0; this.viewW = this.W;
    this._touches = new Map();                           // active touch pointers → client coords
    // -Infinity, not 0: with 0 every touch in the app's first PALM_MS counts as
    // landing right after a pen and is dropped.
    this._lastPen = -Infinity;                           // pen CONTACT, never hover — see _touchDown
    this.onCommit = opts.onCommit || null;
    this.onZoom = opts.onZoom || null;                   // page-zoom level changed (see setPageZoom)
    this.resizable = !!opts.resizable;
    this.strokes = Array.isArray(opts.strokes) ? JSON.parse(JSON.stringify(opts.strokes)) : [];
    /* Images, stickers and sticky notes. Records are treated as IMMUTABLE:
       every change replaces one and pushes the previous array, so an undo
       step costs a few pointers instead of a copy of every embedded photo. */
    this.objects = Array.isArray(opts.objects) ? opts.objects.slice() : [];
    this.selObjects = [];   // selected object indices, alongside `selection` for strokes
    /* Named marks down the page. They are not objects and not strokes: a
       section is a place, so it is only a y and a title. That is what lets
       an outline exist for a drawing at all. Kept sorted by y. */
    this.sections = Array.isArray(opts.sections) ? opts.sections.slice().sort((a, b) => a.y - b.y) : [];
    /* Recognised handwriting: text only, no positions. It exists to make the
       drawing findable, not to be shown — a guess rendered on the page would
       look like something that was actually written there. */
    this.ocr = Array.isArray(opts.ocr) ? opts.ocr.slice() : [];
    // Pen prediction (getPredictedEvents) — on by default; the drawn tail is
    // extended toward where the OS says the pen is going. See _drawLive.
    this.predict = opts.predict !== false;
    // ms of quiet before the drawing is written back. See _changed().
    this.commitDelay = (opts.commitDelay != null) ? opts.commitDelay : 700;
    this.undoStack = []; this.redoStack = [];
    this._pid = 'nxsk-' + Math.random().toString(36).slice(2, 9);
    this._texFilt = this._pid + '-tf'; this._texPat = this._pid + '-tp';   // paper-texture def ids
    this._build();
    this._renderObjects();
    this._renderSections();
    this._renderStrokes();
  }

  _build() {
    // width/height attrs give the SVG a solid intrinsic aspect ratio so CSS
    // `width:100%; height:auto` sizes the pad EVERYWHERE — no dependency on CSS
    // `aspect-ratio`, which older mobile WebViews lack (→ 0-height, invisible pad).
    const svg = svgEl('svg', { class: 'nx-sketch-surface', viewBox: `0 0 ${this.W} ${this.H}`, width: this.W, height: this.H, preserveAspectRatio: 'none' });
    this.svg = svg;
    if (this.bg) { this.bgRect = svgEl('rect', { x: 0, y: 0, width: this.W, height: this.H, fill: this.bg }); svg.appendChild(this.bgRect); }
    this.gObjects = svgEl('g', { class: 'nx-sk-objects' });
    this.gSections = svgEl('g', { class: 'nx-sk-sections' });
    this.gStrokes = svgEl('g', { class: 'nx-sk-committed' });
    this.livePath = svgEl('path', { class: 'nx-sk-live' });
    svg.appendChild(this.gObjects);   // below the ink — writing goes ON a photo, not under it
    svg.appendChild(this.gSections);
    svg.appendChild(this.gStrokes);
    svg.appendChild(this.livePath);
    this.gSel = svgEl('g', { class: 'nx-sk-sel' });   // marquee + frame + handles
    svg.appendChild(this.gSel);
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
    this.host._surface = this;   // commands act on the pad that is open, not on a toolbar
    this._applyPaperWidth();
    // LOW-LATENCY live layer: the in-progress stroke is drawn on a canvas
    // overlay with a desynchronized 2d context — Chrome/WebView's front-buffer
    // path that skips the compositor queue (the same trick native-feeling web
    // drawing apps use). SVG only receives the committed stroke on release;
    // updating SVG per-move rides the full compositor pipeline (~2-4 frames
    // behind the pen) no matter how fast our math is.
    //
    //  It is split in TWO: `liveCanvas` accumulates the finished chunks of the
    //  current stroke and is NEVER cleared while drawing; `tipCanvas` carries
    //  only the short moving tail and is cleared over its dirty rect alone.
    //  The old single canvas re-filled EVERY chunk of the stroke on EVERY
    //  pointer event — per-event cost grew with the length of the stroke, which
    //  is exactly why long handwriting felt heavier than short marks.
    //  Both live inside one wrapper: pen opacity / blend sit on the WRAPPER, so
    //  the two layers composite as a single group and their overlap can never
    //  stack darker than the committed stroke.
    this.liveLayer = document.createElement('div');
    this.liveLayer.className = 'nx-sk-livelayer';
    this.liveCanvas = document.createElement('canvas');
    this.liveCanvas.className = 'nx-sk-livecanvas';
    this.tipCanvas = document.createElement('canvas');
    this.tipCanvas.className = 'nx-sk-livecanvas nx-sk-tipcanvas';
    this.liveLayer.appendChild(this.liveCanvas);
    this.liveLayer.appendChild(this.tipCanvas);
    this.host.appendChild(this.liveLayer);
    this._livePaths = [];
    this._buildBg();
    this._buildPaperTex();
    this._applyPaperClass();

    svg.addEventListener('pointerdown', (e) => this._onDown(e));
    svg.addEventListener('pointermove', (e) => this._onMove(e));
    svg.addEventListener('pointerup', (e) => this._onUp(e));
    svg.addEventListener('pointercancel', (e) => this._onUp(e));
    // Desktop's pinch: ctrl/⌘ + wheel is what every canvas app binds, and it is
    // the ONLY zoom a mouse has — fingers are the tablet's way in.
    svg.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

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
    const wasScroll = this._gestMode === 'scroll';
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
        three fingers, once = the same, for anyone whose OS lets three through

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
      // Nothing is ambiguous after two, so it fires at once rather than waiting.
      if (n >= 2) { this._resetZoom(); return; }
      this._tapSeq = { n, fingers, t: now, x, y, timer: null };
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

  /* Says so even when it was already at 1×: the point of the gesture is knowing
     it was seen, and "nothing happened" and "not recognised" look the same. */
  _resetZoom() {
    this.setPageZoom(1);
    this._flashTap('Page width');
  }

  /* ctrl/⌘ + wheel = page zoom. Without the modifier the wheel stays the page's,
     so scrolling a note that contains a sketch is never hijacked. */
  _onWheel(e) {
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
    const sc = this._scroller;
    if (!sc || !samples) return;
    let vy = -canvas.flingVelocity(samples, 'y');
    let vx = -canvas.flingVelocity(samples, 'x');
    if (!vy && !vx) return;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(48, now - last);   // a backgrounded tab must not teleport the page
      last = now;
      const sy = canvas.flingStep(vy, dt);
      const sx = canvas.flingStep(vx, dt);
      sc.scrollTop += sy.move;
      sc.scrollLeft += sx.move;
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
        if (Math.abs(d - this._pending.d) > 24) {
          this._gestMode = 'zoom';
          if (this.pageZoom) this._pzStart = { s: this.pageScale, d: this._pending.d || d };
          else this._gestureRef();
        }
        else if (Math.hypot(cx - this._pending.cx, cy - this._pending.cy) > 12) this._gestMode = 'scroll';
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
        this.viewW = Math.max(this.W / 6, Math.min(this.W, ca * e.w / d));
        this.viewX = a0.cx - (f0.x - e.left) / e.w * this.viewW;
        this.viewY = a0.cy - (f0.y - e.top) / e.h * (this.viewW * this.H / this.W);
        this._applyView();
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
  /* Magnify the sheet itself. `s` is clamped to [PAGE_ZOOM_MIN … PAGE_ZOOM_MAX]:
     out shrinks the sheet inside the pane for an overview of a long page, in
     widens it past the pane and the surrounding scroller takes over. 1 is the
     normal, exactly-page-width state. The pad is sized in real pixels
     off its own width at scale 1, so the result is identical on every screen,
     and the SVG re-renders sharp at the new size instead of being upscaled.
     (ax, ay) is the point on screen to hold still — the pinch centroid. */
  setPageZoom(s, ax, ay) {
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
    const now = gestures.decodeButtons(e.buttons);
    const was = this._penButtons || { barrel: false, eraserTip: false };
    for (const id of ['barrel', 'eraserTip']) {
      if (now[id] === was[id]) continue;
      this._fireGesture(id, now[id] ? 'start' : 'end');
    }
    this._penButtons = now;
  }
  _onDown(e) {
    this._stopFling();
    this._checkPenButtons(e);
    if (e.pointerType === 'pen') this._lastPen = performance.now();   // contact — opens the palm window
    if (e.pointerType === 'touch') { this._touchDown(e); return; }    // finger = pan / page-scroll / zoom, never draws
    if (this.locked) return;                                          // view mode: pen/mouse never draw or erase
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Pen wins over fingers: a palm that slipped in as a "pan" gets dropped the
    // moment the pen actually touches down.
    if (this._touches.size) { this._touches.clear(); this._gestMode = null; this._tap = null; }
    e.preventDefault();
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) {}
    this._ctmInv = this._invCTM();   // cache once per stroke (see _pt)
    if (this.mode === 'erase') { this._erasing = true; this._eraseSnapped = false; this._eraseBatch = []; this._eraseAt(this._pt(e)); return; }
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
    // Only while the nib is actually down: a hovering pen must not veto the
    // fingers of the other hand (pressure/buttons are 0 in hover).
    if (e.pointerType === 'pen' && (e.buttons || e.pressure > 0)) this._lastPen = performance.now();
    if (e.pointerType === 'touch') { this._touchMove(e); return; }
    if (this._erasing) { this._eraseAt(this._pt(e)); return; }
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
    // Auto-grow: keep headroom below the pen so you can keep writing downward.
    if (this.autoGrow) {
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
    if (e.pointerType === 'touch') { this._touchUp(e); return; }
    this._checkPenButtons(e);
    this._ctmInv = null;
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (this._erasing) {
      this._erasing = false;
      this.livePath.removeAttribute('d');
      if (this._eraseBatch && this._eraseBatch.length) { this._pushUndo({ t: 'insert', items: this._eraseBatch }); }
      this._eraseBatch = null;
      if (this._changedDuringErase) { this._changedDuringErase = false; this._changed(); }
      return;
    }
    if (this._selDrag) { this._selUp(); return; }
    if (this._spaceDrag) { this._spaceUp(); return; }
    if (!this._active) return;
    const st = this._active; this._active = null;
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
    // Report whether the backing store was actually re-allocated — that (and
    // only that) wipes the frozen chunks, so only then must the caller repaint.
    const realloc = (this.liveCanvas.width !== w || this.liveCanvas.height !== h);
    if (realloc) {
      this.liveCanvas.width = w; this.liveCanvas.height = h;
      this.tipCanvas.width = w; this.tipCanvas.height = h;
    }
    this.liveLayer.style.top = top + 'px';
    this.liveLayer.style.bottom = 'auto';
    this.liveLayer.style.height = height + 'px';
    if (!this._lctx) this._lctx = this.liveCanvas.getContext('2d', { desynchronized: true });
    if (!this._tctx) this._tctx = this.tipCanvas.getContext('2d', { desynchronized: true });
    this._lscale = { s: w / this.viewW, x: this.viewX, y: this.viewY + top * (this.viewW / (r.width || 1)) };
    return realloc;
  }
  /* viewBox → device-pixel rect for a run of points, padded by the nib radius.
     Used as the tip layer's dirty rect so a pen event clears ~a nib, not a
     screenful. */
  _liveBBox(pts, size) {
    if (!pts || !pts.length || !this._lscale) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    const sc = this._lscale, pad = (size || 4) + 3;
    return { x: (x0 - pad - sc.x) * sc.s, y: (y0 - pad - sc.y) * sc.s, w: (x1 - x0 + pad * 2) * sc.s, h: (y1 - y0 + pad * 2) * sc.s };
  }
  _clearTip() {
    const c = this._tctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const d = this._tipDirty;
    if (d) c.clearRect(d.x - 2, d.y - 2, d.w + 4, d.h + 4);
    else c.clearRect(0, 0, this.tipCanvas.width, this.tipCanvas.height);
    this._tipDirty = null;
  }
  _paintChunk(d) {
    const ctx = this._lctx, sc = this._lscale;
    if (!ctx || !sc) return;
    ctx.setTransform(sc.s, 0, 0, sc.s, -sc.x * sc.s, -sc.y * sc.s);
    ctx.fillStyle = this._liveInk;
    ctx.globalAlpha = 1;   // translucency lives on the WRAPPER (see _onDown) → overlaps stay uniform
    ctx.fill(new Path2D(d));
  }
  /* Full rebuild of the live layer from the frozen chunk list. Only needed when
     the backing store was re-allocated or the geometry was replaced wholesale
     (shape snap) — never on the per-event hot path. */
  _repaintLive() {
    if (!this._lctx) return;
    this._lctx.setTransform(1, 0, 0, 1, 0, 0);
    this._lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    this._tipDirty = null;
    this._clearTip();
    for (const d of this._livePaths) this._paintChunk(d);
  }
  _clearLiveCanvas() {
    this._livePaths = [];
    this._pred = null;
    this._tipDirty = null;
    this.liveLayer.style.mixBlendMode = '';
    this.liveLayer.style.opacity = '';
    if (this._lctx) { this._lctx.setTransform(1, 0, 0, 1, 0, 0); this._lctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height); }
    if (this._tctx) { this._tctx.setTransform(1, 0, 0, 1, 0, 0); this._tctx.clearRect(0, 0, this.tipCanvas.width, this.tipCanvas.height); }
  }
  /* INCREMENTAL live render, O(1) per pointer event.
     · Completed point ranges are frozen ONCE onto the ink layer (overlapping so
       they union seamlessly under the same fill) and then never touched again.
     · Only the short tail is redrawn per event, on its own tip layer, and only
       its dirty rect is cleared.
     The tail is extended to the RAW pen position (st._raw) so the ink visually
     touches the nib — the streamline smoothing otherwise trails it by design —
     and one more step along the PREDICTED heading, which is what removes the
     last frames of hardware latency. Neither is ever recorded in the stroke. */
  _drawLive() {
    if (!this._active || !this._lctx) return;
    const st = this._active, pts = st.points, CHUNK = 24, OVERLAP = 6;
    const baseO = { thinning: st.thinning, cap: st.cap, nib: st.nib };
    while (pts.length - this._chunkStart > CHUNK + OVERLAP) {
      const seg = pts.slice(this._chunkStart, this._chunkStart + CHUNK + OVERLAP);
      // Taper only the stroke's true START on the first chunk — interior chunk
      // boundaries must stay full-width or the stroke would pinch mid-line.
      const d = sketchStrokePath(seg, st.size, Object.assign({}, baseO, { taperStart: this._chunkStart === 0 ? st.taper : 0, taperEnd: 0, cap: 'round' }));
      if (d) { this._livePaths.push(d); this._paintChunk(d); }
      this._chunkStart += CHUNK;
    }
    const tail = pts.slice(this._chunkStart);
    if (st._raw && !st._snapped) {
      const l = tail[tail.length - 1];
      if (!l || Math.hypot(st._raw[0] - l[0], st._raw[1] - l[1]) > 0.3) tail.push(st._raw);
      const pr = this._pred;
      if (pr) {
        const dx = pr[0] - st._raw[0], dy = pr[1] - st._raw[1], L = Math.hypot(dx, dy);
        // Only ever extend FORWARD: as the pen decelerates into a stop the
        // predictor can point back along the stroke, which would draw a little
        // hook at the nib. And clamp the distance — an unbounded guess
        // overshoots on direction changes and leaves visible whiskers.
        const prev = tail.length > 1 ? tail[tail.length - 2] : null;
        const fwd = !prev || ((st._raw[0] - prev[0]) * dx + (st._raw[1] - prev[1]) * dy) >= 0;
        if (L > 0.4 && fwd) { const k = Math.min(1, PREDICT_MAX / L); tail.push([st._raw[0] + dx * k, st._raw[1] + dy * k, st._raw[2]]); }
      }
    }
    const ctx = this._tctx, sc = this._lscale;
    if (!ctx || !sc) return;
    this._clearTip();
    ctx.setTransform(sc.s, 0, 0, sc.s, -sc.x * sc.s, -sc.y * sc.s);
    ctx.fillStyle = this._liveInk;
    ctx.globalAlpha = 1;
    // Tail: start-taper only while un-chunked; end always tapers (the live nib tip).
    const d = sketchStrokePath(tail, st.size, Object.assign({}, baseO, { taperStart: this._chunkStart === 0 ? st.taper : 0, taperEnd: st.taper }));
    if (d) ctx.fill(new Path2D(d));
    this._tipDirty = this._liveBBox(tail, st.size);
  }



  /* ── Sections ──────────────────────────────────────────────────────────────
     A rule across the page with a name on it. Deliberately drawn UNDER the ink:
     it is a divider, not an annotation, and it must never look like something
     that was written. */
  _sectionsSVG() {
    let body = '';
    for (const sec of this.sections) {
      const label = objects.xmlEscape(sec.title || 'Section');
      body += `<line x1="0" y1="${sec.y}" x2="${this.W}" y2="${sec.y}" class="nx-sk-secline"/>`;
      body += `<text x="14" y="${sec.y - 8}" class="nx-sk-sectext" font-size="20"`
        + ` font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>`;
    }
    return body;
  }
  _renderSections() {
    const g = this.gSections;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!this.sections.length) return;
    const parsed = this._parseDefs(this._sectionsSVG());
    if (!parsed) return;
    while (parsed.firstChild) g.appendChild(parsed.firstChild);
  }
  addSection(y, title) {
    this._pushUndo({ t: 'sections', all: this.sections.slice() });
    this.sections = this.sections.concat([{ y: Math.round(y), title: String(title || 'Section') }])
      .sort((a, b) => a.y - b.y);
    this._renderSections();
    this._changed();
    return this.sections;
  }
  renameSection(i, title) {
    if (!this.sections[i]) return;
    this._pushUndo({ t: 'sections', all: this.sections.slice() });
    const next = this.sections.slice();
    next[i] = { y: next[i].y, title: String(title || 'Section') };
    this.sections = next;
    this._renderSections();
    this._changed();
  }
  removeSection(i) {
    if (!this.sections[i]) return;
    this._pushUndo({ t: 'sections', all: this.sections.slice() });
    this.sections = this.sections.filter((_, k) => k !== i);
    this._renderSections();
    this._changed();
  }
  /* Bring a y on the page into view. Returns false when there is no scroller to
     move, so the caller can say so instead of silently doing nothing. */
  scrollToY(y) {
    const sc = this._findScroller();
    if (!sc) return false;
    const rect = this.host.getBoundingClientRect();
    const scRect = sc.getBoundingClientRect();
    const px = (y / this.W) * (rect.width || this.W);
    sc.scrollTop += (rect.top + px) - scRect.top - 40;
    return true;
  }

  /* ── Objects on the page ───────────────────────────────────────────────────
     Rendered from the same emitter that writes the exported file, parsed once
     per change rather than built node by node: the whole layer is a handful of
     elements, and a string is the cheapest way to keep it in step. */
  _renderObjects() {
    const g = this.gObjects;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!this.objects.length) return;
    const parsed = this._parseDefs(objects.objectsSVG(this.objects));
    if (!parsed) return;
    while (parsed.firstChild) g.appendChild(parsed.firstChild);
  }
  addObject(obj) {
    if (!obj || objects.OBJECT_KINDS.indexOf(obj.kind) < 0) return -1;
    this._pushUndo({ t: 'objs', all: this.objects.slice() });
    this.objects = this.objects.concat([obj]);
    // A new object is what you want to move next, so it arrives selected.
    this.selection = [];
    this.selObjects = [this.objects.length - 1];
    this._renderObjects();
    if (this.gSel) this._paintSel(null);
    this._changed();
    this._emitSelect();
    return this.objects.length - 1;
  }
  updateObject(i, patch) {
    if (!this.objects[i]) return;
    this._pushUndo({ t: 'objs', all: this.objects.slice() });
    const next = this.objects.slice();
    next[i] = Object.assign({}, next[i], patch);
    this.objects = next;
    this._renderObjects();
    if (this.gSel) this._paintSel(null);
    this._changed();
  }
  removeObjects(indices) {
    if (!indices || !indices.length) return;
    this._pushUndo({ t: 'objs', all: this.objects.slice() });
    const drop = new Set(indices);
    this.objects = this.objects.filter((_, i) => !drop.has(i));
    this.selObjects = [];
    this._renderObjects();
    if (this.gSel) this._paintSel(null);
    this._changed();
    this._emitSelect();
  }

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
    const vh = this.viewW * this.H / this.W;
    return { x: this.viewX + this.viewW / 2, y: this.viewY + vh / 2 };
  }
  _uPerPx() {
    const w = this.svg.getBoundingClientRect().width || this.W;
    return this.viewW / w;   // viewBox units per screen pixel, current zoom included
  }
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

  /* Endless paper has a fixed width by definition: without a cap the same note
     renders at a different ink size in portrait and in landscape, which is the
     "everything got huge when I rotated the tablet" complaint. 0 = fill. */
  setPaperWidth(px) {
    this.paperWidth = px > 0 ? px : 0;
    this._applyPaperWidth();
  }
  _applyPaperWidth() {
    if (!this.host || !this.host.style) return;
    // A zoomed sheet owns its own width — the cap applies to the resting state.
    if (this.pageScale !== 1) return;
    if (!this.paperWidth) { this.host.style.maxWidth = ''; this.host.style.marginInline = ''; return; }
    this.host.style.maxWidth = this.paperWidth + 'px';
    this.host.style.marginInline = 'auto';
  }

  _eraseAt(p) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const st = this.strokes[i];
      const hitR = st.size / 2 + ERASE_R;
      if (st.points.some(pt => Math.hypot(pt[0] - p.x, pt[1] - p.y) <= hitR)) {
        this._eraseSnapped = true;
        // Recorded in REMOVAL order with the index that was valid at that
        // moment; undo replays it backwards, which restores exactly.
        (this._eraseBatch = this._eraseBatch || []).push({ i, st });
        this.strokes.splice(i, 1);
        this._invalidateSelection();
        this._renderStrokes();
        this._changedDuringErase = true;
      }
    }
  }

  /* Outline geometry for a committed stroke, memoised ON the stroke and
     deliberately NON-ENUMERABLE so it stays out of the JSON that goes into the
     .svg metadata. Without it every save re-derived the outline of EVERY stroke
     in the drawing — the cost that made a long page feel heavier with each new
     stroke, because it ran on the pen-up right before the next one started. */
  _strokeD(st) {
    if (st._d !== undefined) return st._d;
    const d = sketchStrokePath(st.points, st.size, { thinning: st.thinning, taperStart: st.taper || 0, taperEnd: st.taper || 0, cap: st.cap, nib: st.nib });
    try { Object.defineProperty(st, '_d', { value: d, writable: true, configurable: true, enumerable: false }); }
    catch (e) { st._d = d; }
    return d;
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

  /* Undo/redo as an OP LOG, not as snapshots. The old version stringified the
     entire drawing on every single stroke and kept up to 120 such copies —
     O(whole drawing) of main-thread work per pen lift plus an unbounded memory
     climb on a long page. Each entry describes how to get back one step and
     returns its own inverse when applied, so undo and redo share one routine.
       { t:'remove',    n }        drop the last n strokes
       { t:'insert',    items }    re-insert (replays `items` BACKWARDS)
       { t:'remove-at', items }    re-remove (replays `items` FORWARDS)
       { t:'replace',   all }      swap the whole array (clear) */
  _pushUndo(op) {
    this.undoStack.push(op);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }
  _applyUndoOp(op) {
    if (op.t === 'remove') {
      const items = [];
      for (let k = 0; k < op.n && this.strokes.length; k++) items.push({ i: this.strokes.length - 1, st: this.strokes.pop() });
      return { t: 'insert', items };
    }
    if (op.t === 'insert') {
      for (let k = op.items.length - 1; k >= 0; k--) {
        const it = op.items[k];
        this.strokes.splice(Math.min(it.i, this.strokes.length), 0, it.st);
      }
      return { t: 'remove-at', items: op.items };
    }
    if (op.t === 'remove-at') {
      for (const it of op.items) if (it.i < this.strokes.length) this.strokes.splice(it.i, 1);
      return { t: 'insert', items: op.items };
    }
    if (op.t === 'points') {
      // Swap geometry back and hand out the geometry that was there — the same
      // entry then undoes and redoes a transform.
      const prev = op.items.map(it => {
        const st = this.strokes[it.i];
        return { i: it.i, points: st ? st.points : it.points, size: st ? st.size : it.size, shape: st && st.shape ? st.shape : null };
      });
      for (const it of op.items) {
        const st = this.strokes[it.i];
        if (!st) continue;
        st.points = it.points;
        st.size = it.size;
        if (it.shape) st.shape = it.shape; else delete st.shape;
        delete st._d;
      }
      // The spacing tool also grew the paper; undoing the shift without the
      // height would leave a page of blank space behind.
      const prevH = this.H;
      if (op.h != null) this.setHeight(op.h);
      return { t: 'points', items: prev, h: op.h != null ? prevH : undefined };
    }
    if (op.t === 'color') {
      const prev = op.items.map(it => ({ i: it.i, color: this.strokes[it.i] ? this.strokes[it.i].color : it.color }));
      for (const it of op.items) if (this.strokes[it.i]) this.strokes[it.i].color = it.color;
      return { t: 'color', items: prev };
    }
    if (op.t === 'sections') {
      const prev = this.sections;
      this.sections = op.all;
      this._renderSections();
      return { t: 'sections', all: prev };
    }
    if (op.t === 'objs') {
      const prev = this.objects;
      this.objects = op.all;
      this.selObjects = [];
      this._renderObjects();
      return { t: 'objs', all: prev };
    }
    if (op.t === 'replace') { const prev = this.strokes; this.strokes = op.all; return { t: 'replace', all: prev }; }
    return null;
  }

  /* Writing the sidecar re-serialises the whole drawing and hits the vault.
     Doing that synchronously on every pen lift meant the NEXT stroke started
     behind — the single biggest source of "the pen feels sluggish" on a long
     page. So commits are debounced and a burst of strokes collapses into one
     write. persist() forces it out now; flush() only if something is pending. */
  _changed(immediate) {
    if (!this.onCommit) return;
    if (immediate) { this._fire(); return; }
    // A pad that has been torn out of the document must not write back: the id
    // write-back re-renders the code block, and the OUTGOING pad's pending
    // commit would then land on top of the surface that replaced it. Only the
    // timers check this — an explicit persist()/flush() always goes through.
    const late = () => { if (document.contains(this.host)) this._fire(); else { this._commitT = null; this._commitMaxT = null; this._disarmFlushGuard(); } };
    if (this._commitT) window.clearTimeout(this._commitT);
    this._commitT = window.setTimeout(() => { this._commitT = null; late(); }, this.commitDelay);
    // Hard ceiling — a continuous stream of strokes must still reach disk.
    if (!this._commitMaxT) this._commitMaxT = window.setTimeout(() => { this._commitMaxT = null; late(); }, Math.max(this.commitDelay * 6, 4000));
    this._armFlushGuard();
  }
  _fire() {
    if (this._commitT) { window.clearTimeout(this._commitT); this._commitT = null; }
    if (this._commitMaxT) { window.clearTimeout(this._commitMaxT); this._commitMaxT = null; }
    this._disarmFlushGuard();
    if (this.onCommit) this.onCommit();
  }
  /* Nothing may be lost when the app goes to the background — on mobile that is
     the normal way a session ends. Armed only while a write is pending, so no
     listener outlives an idle pad. */
  _armFlushGuard() {
    if (this._flushGuard) return;
    this._flushGuard = (ev) => {
      if ((ev && ev.type === 'pagehide') || document.visibilityState === 'hidden') this.flush();
    };
    document.addEventListener('visibilitychange', this._flushGuard);
    window.addEventListener('pagehide', this._flushGuard);
  }
  _disarmFlushGuard() {
    if (!this._flushGuard) return;
    document.removeEventListener('visibilitychange', this._flushGuard);
    window.removeEventListener('pagehide', this._flushGuard);
    this._flushGuard = null;
  }
  /* Write a pending change out now. Safe to call when nothing is pending. */
  flush() { if (this._commitT || this._commitMaxT) this._fire(); }
  /* Call when the pad goes away for good (view closed, overlay torn down). */
  destroy() {
    this.flush(); this._disarmFlushGuard(); this._stopFling(); this._clearTapSeq();
    window.clearTimeout(this._tapFlashT);
  }

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
  setMode(m) {
    this.mode = m;
    if (m !== 'select') { this.selection = []; this.selObjects = []; this._selDrag = null; }
    if (m !== 'space') this._spaceDrag = null;
    // The cursor has to say which tool is armed before the first stroke.
    if (this.host && this.host.classList) {
      this.host.classList.toggle('is-select', m === 'select');
      this.host.classList.toggle('is-space', m === 'space');
    }
    if (this.gSel) { if (m === 'space') this._paintSpace(); else this._paintSel(null); }
  }
  setSelectShape(k) { if (['lasso', 'rect', 'ellipse'].includes(k)) this.selectShape = k; }
  setPenMap(map) { this.penMap = map || {}; }
  setOcr(lines) {
    this.ocr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    this.persist();   // the index reads the file, so it has to be on disk
  }
  setRuler(on, angle) {
    this.ruler = { on: !!on, angle: (angle == null || angle === '') ? null : Number(angle) };
    if (this.host && this.host.classList) this.host.classList.toggle('is-ruler', this.ruler.on);
    return this.ruler;
  }
  hasSelection() { return this._hasSel(); }
  clearSelection() { this.selection = []; this.selObjects = []; this._paintSel(null); this._emitSelect(); }
  setLocked(v) { this.locked = !!v; }
  getPageZoom() { return this.pageScale; }
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
  persist() { this._fire(); }
  /* Only ops that add or remove strokes renumber the array, and only those can
     leave the selection pointing at the wrong ink. Undoing a colour or a move
     keeps it — losing your selection because you pressed undo once is a wart,
     not safety. */
  _renumbers(op) { return op && op.t !== 'points' && op.t !== 'color'; }
  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    const inv = this._applyUndoOp(op);
    if (inv) this.redoStack.push(inv);
    if (this._renumbers(op)) this._invalidateSelection(); else if (this.gSel) this._paintSel(null);
    this._renderStrokes(); this._changed();
  }
  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    const inv = this._applyUndoOp(op);
    if (inv) this.undoStack.push(inv);
    if (this._renumbers(op)) this._invalidateSelection(); else if (this.gSel) this._paintSel(null);
    this._renderStrokes(); this._changed();
  }
  clear() {
    if (!this.strokes.length) return;
    this._pushUndo({ t: 'replace', all: this.strokes });
    this.strokes = [];
    this._invalidateSelection();
    this._renderStrokes(); this._changed();
  }

  toSVGString() {
    const meta = JSON.stringify({
      v: 1, w: this.W, h: this.H, bg: this.bg, paper: this.paper, paperStyle: this.paperStyle,
      bgType: this.bgType, bgSize: this.bgSize, bgOpacity: this.bgOpacity, bgColor: this.bgColor,
      autoGrow: this.autoGrow,
      title: this.title || undefined,
      objects: this.objects.length ? this.objects : undefined,
      sections: this.sections.length ? this.sections : undefined,
      ocr: this.ocr.length ? this.ocr : undefined,
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
    // Same emitter as the live pad — two would drift, and the drift would only
    // ever show up in the exported copy.
    body += objects.objectsSVG(this.objects);
    body += this._sectionsSVG();
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
    /* A CDATA section ends at the first `]]>`, so a section title or a note that
       happens to contain one would truncate the metadata and leave a malformed
       file behind. Splitting it across two CDATA blocks is the standard escape
       and reads back identically. */
    const cdata = meta.split(']]>').join(']]]]><![CDATA[>');
    return `<svg xmlns="${SVGNS}" viewBox="0 0 ${this.W} ${this.H}" width="${this.W}" height="${this.H}">`
      + `<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[${cdata}]]></nx-sketch></metadata>`
      + defs + body + '</svg>';
  }
}

module.exports = { NexusSketchSurface, parseSketchSVG, emptySketchSVG, sketchPresets, withSketchTitle, sketchStrokePath, recognizeShape, shapeToPoints, ratioWH, LOGICAL_W, PEN_TYPES };
