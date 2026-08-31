'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · pen gestures
 *  What a stylus can tell a web app, and what the user wants that to mean.
 *
 *  Worth being blunt about the limits, because the marketing is not: the S Pen's
 *  air actions (the ones you do without touching the screen — the double-tap in
 *  the air, the wave, the remote-shutter click) are handled by Android itself
 *  and never reach a web page. Neither does the Lenovo pen's top button. What a
 *  browser DOES report is what the pen does while it is on or near the glass:
 *
 *    barrel button   the side button, as PointerEvent.buttons bit 2
 *    eraser tip      flipping a pen that has one, as buttons bit 5
 *    double-tap      two quick taps of the tip in the same spot, timed here
 *
 *  So the profiles below are presets over those three, not different drivers.
 * ========================================================================== */

const BUTTON_BARREL = 2;    // buttons bit 1 (value 2) — the side button
const BUTTON_ERASER = 32;   // buttons bit 5 (value 32) — the eraser end

const DOUBLE_TAP_MS = 320;  // two taps further apart than this are two taps
const DOUBLE_TAP_R = 24;    // …and further apart than this are aimed at different things

const PEN_GESTURES = [
  { id: 'barrel', label: 'Side button', hint: 'The button on the barrel of the pen.' },
  { id: 'eraserTip', label: 'Eraser tip', hint: 'Turning a pen around that has an eraser end.' },
  { id: 'doubleTap', label: 'Double-tap', hint: 'Two quick taps of the tip in the same spot.' },
];

/* What a gesture can be made to do. `hold` actions last while the button is
   down and undo themselves on release; the rest fire once. */
const PEN_ACTIONS = [
  { id: 'none', label: 'Nothing' },
  { id: 'eraseHold', label: 'Erase while held', hold: true },
  { id: 'eraseToggle', label: 'Switch to the eraser' },
  { id: 'select', label: 'Switch to select' },
  { id: 'undo', label: 'Undo' },
  { id: 'redo', label: 'Redo' },
  { id: 'ruler', label: 'Toggle the ruler' },
  { id: 'nextColor', label: 'Next colour in the palette' },
  { id: 'lastTool', label: 'Back to the previous tool' },
];
function penAction(id) { return PEN_ACTIONS.find(a => a.id === id) || PEN_ACTIONS[0]; }
function isHoldAction(id) { return !!penAction(id).hold; }

/* Presets, one per pen people actually own. They differ in what the hardware
   has, not in what the browser exposes. */
const PEN_PROFILES = {
  generic: {
    label: 'Generic stylus',
    note: 'Side button erases while held. Anything the pen does off the glass is invisible to a web app.',
    map: { barrel: 'eraseHold', eraserTip: 'eraseToggle', doubleTap: 'none' },
  },
  spen: {
    label: 'Samsung S Pen',
    note: 'No eraser end, so the side button carries the erasing. Air actions are handled by Android and never reach the page.',
    map: { barrel: 'eraseHold', eraserTip: 'none', doubleTap: 'lastTool' },
  },
  lenovo: {
    label: 'Lenovo Precision Pen',
    note: 'Two side buttons, but a browser sees only one of them; the eraser end works.',
    map: { barrel: 'eraseHold', eraserTip: 'eraseToggle', doubleTap: 'undo' },
  },
  wacom: {
    label: 'Wacom / AES pen',
    note: 'Side button and eraser end both report normally.',
    map: { barrel: 'select', eraserTip: 'eraseHold', doubleTap: 'none' },
  },
};
const PROFILE_IDS = Object.keys(PEN_PROFILES);

/* The mapping in force: the profile's preset, with any per-gesture override the
   user set on top. Unknown ids fall back rather than throwing, so a config
   written by a newer version still runs. */
function resolveMap(profileId, overrides) {
  const profile = PEN_PROFILES[profileId] || PEN_PROFILES.generic;
  const out = Object.assign({}, profile.map);
  for (const g of PEN_GESTURES) {
    const chosen = overrides && overrides[g.id];
    if (chosen && PEN_ACTIONS.some(a => a.id === chosen)) out[g.id] = chosen;
  }
  return out;
}

/* Which physical buttons a pointer event reports. */
function decodeButtons(buttons) {
  const bits = Number(buttons) || 0;
  return { barrel: (bits & BUTTON_BARREL) !== 0, eraserTip: (bits & BUTTON_ERASER) !== 0 };
}

/* Two taps count as one double-tap when they are close in time AND in space.
   Time alone turns a fast writer into a gesture machine. */
function isDoubleTap(previous, x, y, t) {
  if (!previous) return false;
  if (t - previous.t > DOUBLE_TAP_MS) return false;
  return Math.hypot(x - previous.x, y - previous.y) <= DOUBLE_TAP_R;
}

module.exports = {
  BUTTON_BARREL, BUTTON_ERASER, DOUBLE_TAP_MS, DOUBLE_TAP_R,
  PEN_GESTURES, PEN_ACTIONS, PEN_PROFILES, PROFILE_IDS,
  penAction, isHoldAction, resolveMap, decodeButtons, isDoubleTap,
};
