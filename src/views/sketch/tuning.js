'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface tuning
 *  The numbers the sketch surface is tuned by: hit radii, gesture windows,
 *  zoom limits. Pure constants.
 * ========================================================================== */

const ERASE_R = 16;              // eraser hit radius, viewBox units
const AUTOGROW_MARGIN = 60;      // auto-grow: start extending when the pen is this close to the bottom
const AUTOGROW_LOOKAHEAD = 460;  // ...and keep this much blank space below it (big → grows rarely, see _onMove)
const PREDICT_MAX = 34;          // pen prediction: never draw further than this (viewBox units) past the real tip
const PAGE_ZOOM_MAX = 5;         // page zoom: how far a sheet may be magnified (1 = page width)
const PAGE_ZOOM_MIN = 0.3;       // …and how far out, for an overview of a long page (1 = fits the pane)
/* The mindmap camera. A plane has no page width to snap back to, so the only
   stops it has are these: how far the logical canvas width may be magnified,
   and how far it may be pulled back. */
const INF_ZOOM_IN = 8;
const INF_ZOOM_OUT = 12;
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

module.exports = { ERASE_R, AUTOGROW_MARGIN, AUTOGROW_LOOKAHEAD, PREDICT_MAX, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN, INF_ZOOM_IN, INF_ZOOM_OUT, TAP_TRAVEL, HANDLE_PX, SEL_DRAG_PX, PALM_MS, TAP_MS, TAP_SLOP_PX, MULTITAP_MS, MULTITAP_R, SWIPE_PX, SWIPE_RATIO, SWIPE_MS, HOLD_MS, HOLD_R };
