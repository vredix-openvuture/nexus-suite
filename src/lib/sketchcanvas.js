'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sketch canvas behaviour
 *  The numbers behind how the paper MOVES, as opposed to what is drawn on it:
 *  fling after a scroll, inserting and removing vertical space, and how wide
 *  the sheet is allowed to get. Pure, so all of it is testable without a pad.
 * ========================================================================== */

/* ── Fling ──────────────────────────────────────────────────────────────────
   A drag-scroll that stops dead the instant the finger lifts reads as slow,
   however fast the drag itself was — every native scroller keeps going. So the
   last few samples give a velocity and the scroller coasts to a stop.

   FRICTION is per millisecond and tuned against Android's own fling (~0.998
   per ms, i.e. roughly half the speed every 350 ms). */
const FLING_FRICTION = 0.998;
const FLING_MIN_V = 0.02;      // px/ms — below this the movement is invisible, stop
const FLING_SAMPLE_MS = 100;   // only the tail of the drag decides the throw
const FLING_MAX_V = 6;         // px/ms ceiling, so a jitter spike cannot launch the page

/* Velocity in px/ms from the recent tail of a sample list [{t, x, y}, …]. */
function flingVelocity(samples, axis) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t > FLING_SAMPLE_MS) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  const v = (last[axis] - first[axis]) / dt;
  return Math.max(-FLING_MAX_V, Math.min(FLING_MAX_V, v));
}

/* One frame of coasting: how far to move, and what is left of the speed. */
function flingStep(v, dtMs, friction) {
  const f = Math.pow(friction == null ? FLING_FRICTION : friction, dtMs);
  const next = v * f;
  return { move: v * dtMs, v: Math.abs(next) < FLING_MIN_V ? 0 : next };
}

/* ── Vertical space ─────────────────────────────────────────────────────────
   The spacing tool inserts or removes blank paper at a line, the way OneNote
   does. A stroke moves as a WHOLE, decided by its top edge: tearing a stroke in
   half at the line would rip a descender off a letter. A stroke that straddles
   the line therefore stays put, which is also what makes the gesture
   predictable — you can see beforehand what will move. */
function strokesBelow(strokes, y) {
  const out = [];
  for (let i = 0; i < strokes.length; i++) {
    const pts = strokes[i].points || [];
    if (!pts.length) continue;
    let minY = Infinity;
    for (const p of pts) if (p[1] < minY) minY = p[1];
    if (minY >= y) out.push(i);
  }
  return out;
}

/* Removing space must not drag content up through the line — that would stack
   two lines of writing on top of each other with no way to see it coming. */
function clampSpaceDelta(strokes, y, dy) {
  if (dy >= 0) return dy;
  const below = strokesBelow(strokes, y);
  if (!below.length) return dy;
  let headroom = Infinity;
  for (const i of below) {
    let minY = Infinity;
    for (const p of strokes[i].points) if (p[1] < minY) minY = p[1];
    headroom = Math.min(headroom, minY - y);
  }
  return Math.max(dy, -Math.max(0, headroom));
}

/* ── Sheet width ────────────────────────────────────────────────────────────
   Endless paper has a fixed width by definition, so rotating a tablet into
   landscape must not stretch it: the same note would render at a different ink
   size in each orientation, and handwriting that fitted the page suddenly does
   not. A cap in CSS pixels keeps the measure; 0 means "fill whatever is there",
   which is the old behaviour for anyone who wants it back. */
function resolvePaperWidth(available, maxWidth) {
  if (!maxWidth || maxWidth <= 0) return available;
  return Math.min(available, maxWidth);
}

/* ── Paper type ───────────────────────────────────────────────
   What SHAPE the paper is, as opposed to what colour it is:

     endless    one sheet of a fixed width that grows downward forever
     sectioned  the same, but cut into A4 pages with a gap between them, so an
                export has real page edges and a long note has landmarks
     mindmap    no sheet at all — a camera over an unbounded plane

   The three are one field because they are mutually exclusive: a page break on
   an infinite plane is not a thing, and neither is a camera on a fixed sheet. */
const PAPER_TYPES = ['endless', 'sectioned', 'mindmap'];
const A4_RATIO = 297 / 210;      // long side / short side
const SHEET_GAP_FRAC = 0.024;    // gap between two sheets, as a fraction of the sheet width (≈ 5 mm on A4)

function sheetGap(W) { return Math.max(4, Math.round(W * SHEET_GAP_FRAC)); }
/* One page, in canvas units. The canvas is always W units wide, so the page
   height is what carries the orientation. */
function sheetHeight(W, landscape) {
  return Math.round(landscape ? W / A4_RATIO : W * A4_RATIO);
}
function sheetPitch(W, landscape) { return sheetHeight(W, landscape) + sheetGap(W); }
/* How many whole pages it takes to cover H, and where each one starts. Never
   fewer than one: a blank sectioned pad is still a sheet of paper. */
function sheetCount(W, H, landscape) {
  const pitch = sheetPitch(W, landscape);
  return Math.max(1, Math.ceil((Math.max(0, H) + sheetGap(W)) / pitch));
}
function sheetPages(W, H, landscape) {
  const pitch = sheetPitch(W, landscape);
  const h = sheetHeight(W, landscape);
  const out = [];
  for (let i = 0, n = sheetCount(W, H, landscape); i < n; i++) out.push({ i, y: i * pitch, h });
  return out;
}
/* Sectioned paper only ever ends at a page edge — half a sheet of paper is not
   something you can hand to a printer. */
function snapSheetHeight(W, H, landscape) {
  return sheetCount(W, H, landscape) * sheetPitch(W, landscape) - sheetGap(W);
}

/* ── The mindmap camera ───────────────────────────────────────────
   An unbounded plane has no scrollbars, so the viewBox IS the scroll position.
   Zooming has to hold one point of the paper still under the fingers, or a
   pinch walks the drawing out from under them. (fx, fy) is that point as a
   fraction of the element. */
function zoomAbout(view, factor, fx, fy, minW, maxW) {
  const w = Math.max(minW, Math.min(maxW, view.w * (factor > 0 ? factor : 1)));
  const k = w / view.w;                       // what the clamp actually allowed
  const h = view.h * k;
  return {
    x: view.x + (view.w - w) * (fx == null ? 0.5 : fx),
    y: view.y + (view.h - h) * (fy == null ? 0.5 : fy),
    w, h,
  };
}

/* Bounding box of everything drawn, or null for an empty page. An infinite
   canvas has no edges of its own, so this is what an export is cropped to. */
function strokeBounds(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const st of strokes || []) {
    const r = (st.size || 6) / 2;
    for (const p of st.points || []) {
      if (p[0] - r < minX) minX = p[0] - r;
      if (p[1] - r < minY) minY = p[1] - r;
      if (p[0] + r > maxX) maxX = p[0] + r;
      if (p[1] + r > maxY) maxY = p[1] + r;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/* ── Ruler ──────────────────────────────────────────────────────────────────
   A straight edge is a constraint on input, not an object on the page: while it
   is on, every sample is projected onto one line, so the pen slides along it
   instead of the stroke being straightened afterwards. The difference is
   visible while drawing, which is the whole point of a ruler.

   `angle` in degrees, or null for "free": free takes its direction from the
   first bit of the stroke, so the line goes wherever you started it. */
const RULER_FREE_MIN = 8;   // units of travel before a free ruler commits to a direction

function rulerDirection(angleDeg, ax, ay, x, y) {
  if (angleDeg != null) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: Math.cos(rad), y: Math.sin(rad) };
  }
  const dx = x - ax, dy = y - ay;
  const len = Math.hypot(dx, dy);
  if (len < RULER_FREE_MIN) return null;   // not committed yet
  return { x: dx / len, y: dy / len };
}

function projectToLine(ax, ay, dir, x, y) {
  const t = (x - ax) * dir.x + (y - ay) * dir.y;
  return { x: ax + dir.x * t, y: ay + dir.y * t };
}

module.exports = {
  PAPER_TYPES, A4_RATIO, SHEET_GAP_FRAC,
  sheetGap, sheetHeight, sheetPitch, sheetCount, sheetPages, snapSheetHeight,
  zoomAbout, strokeBounds,
  RULER_FREE_MIN, rulerDirection, projectToLine,
  FLING_FRICTION, FLING_MIN_V, FLING_SAMPLE_MS, FLING_MAX_V,
  flingVelocity, flingStep,
  strokesBelow, clampSpaceDelta, resolvePaperWidth,
};
