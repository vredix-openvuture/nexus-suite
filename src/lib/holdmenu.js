'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · press and hold
 *  Right click on a desktop, a long press on a tablet — one menu either way.
 *  A tablet has no second mouse button and a plain tap already means the
 *  obvious thing, so the hold is the only gesture left for "and what else".
 *
 *  Two things this has to get right and a bare setTimeout does not:
 *
 *    1. MOVEMENT cancels it. Anything worth holding tends to live in a
 *       scroller, and a flick that opens a menu instead of scrolling is the
 *       fastest way to make a tablet feel broken.
 *    2. The click that follows a completed hold is swallowed, or the element
 *       ALSO does its plain job behind the open menu. stopPropagation is not
 *       enough: the element's own onclick usually sits on this very node, and
 *       only stopImmediatePropagation reaches a sibling listener.
 *
 *  `show(x, y)` opens the menu at that point. Returns a cancel function, so a
 *  caller that throws its elements away — a grid that re-renders — can drop a
 *  pending hold instead of letting it fire against a detached node.
 * ========================================================================== */

const HOLD_MS = 500;
const HOLD_SLOP = 10;      // CSS pixels of travel that still count as a press

function attachHoldMenu(el, show, opts) {
  const options = opts || {};
  let timer = null, held = false, startX = 0, startY = 0;
  const cancel = () => { window.clearTimeout(timer); timer = null; };

  const fire = (x, y) => {
    // A grid can re-render between the press and the timer: acting on a card
    // that is no longer on screen would act on a stale item.
    if (!el.isConnected) return;
    show(x, y);
  };

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (options.stopContext !== false) e.stopPropagation();
    cancel();
    fire(e.clientX, e.clientY);
  });

  el.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;             // the right button has contextmenu
    held = false; startX = e.clientX; startY = e.clientY;
    cancel();
    timer = window.setTimeout(() => { timer = null; held = true; fire(startX, startY); }, HOLD_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > HOLD_SLOP || Math.abs(e.clientY - startY) > HOLD_SLOP) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', (e) => {
    if (!held) return;
    held = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  return cancel;
}

module.exports = { attachHoldMenu, HOLD_MS, HOLD_SLOP };
