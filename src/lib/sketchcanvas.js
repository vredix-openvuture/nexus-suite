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
  RULER_FREE_MIN, rulerDirection, projectToLine,
  FLING_FRICTION, FLING_MIN_V, FLING_SAMPLE_MS, FLING_MAX_V,
  flingVelocity, flingStep,
  strokesBelow, clampSpaceDelta, resolvePaperWidth,
};
