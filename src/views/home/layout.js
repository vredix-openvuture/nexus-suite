'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · the grid
 *  Placing cards on the grid in edit mode: drag, resize, collision, reflow.
 *  Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { setIcon } = require('obsidian');

class HomeLayout {

  /* ---- Reflow grid (Android-widget style: dragging/resizing pushes the other
     cards out of the way; the layout compacts upward). x,y,w,h in grid units,
     1-based. All pointer moves listen on `document` so the drag survives the
     finger leaving the tiny handle (the reason touch drag failed before). ---- */
  _dragify(card, key) {
    card.dataset.key = key;
    card.draggable = false;
    if (!this._editing) return;
    const grip = card.createDiv('nx-home-move');
    setIcon(grip, 'move');
    grip.setAttribute('aria-label', 'Move card');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button > 0) return;   // primary pointer only
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}
      this._drag(card, key);
    });
  }
  /* Two rectangles overlap? */
  _collides(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  /* Reflow the working list around `moving` (pinned): push colliders down, then
     pull everything else up (gravity). Mutates the list items' x/y in place. */
  _reflow(list, moving, cols) {
    moving.w = Math.max(1, Math.min(cols, moving.w));
    moving.x = Math.max(1, Math.min(cols - moving.w + 1, moving.x));
    moving.y = Math.max(1, moving.y);
    // Free-form board: push ONLY the cards the moved card actually lands on
    // straight down, just far enough to avoid a stack. Every other card keeps
    // exactly the spot you left it in — no global "gravity"/auto-compact that
    // would fling untouched cards to a different place. Gaps are allowed.
    const others = list.filter(l => l !== moving).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const placed = [moving];
    for (const it of others) { while (placed.some(p => this._collides(p, it))) it.y++; placed.push(it); }
  }
  _snapshot() { const o = {}; for (const k in this._pos) { const p = this._pos[k]; o[k] = { x: p.x, y: p.y, w: p.w, h: p.h }; } return o; }
  _cloneList(base) { return Object.keys(base).map(k => ({ key: k, x: base[k].x, y: base[k].y, w: base[k].w, h: base[k].h })); }
  /* Apply a reflowed working list to the live DOM (all cards). */
  _applyLive(list) {
    for (const l of list) {
      const el = this._grid.querySelector('[data-key="' + l.key + '"]');
      if (el) { el.style.gridColumn = l.x + ' / span ' + l.w; el.style.gridRow = l.y + ' / span ' + l.h; }
    }
  }
  /* Persist all positions (reflow moves more than just the dragged card). */
  _commitLayout(list) {
    const layout = this.plugin.hp().layout || (this.plugin.hp().layout = {});
    for (const l of list) layout[l.key] = { x: l.x, y: l.y };
  }
  /* Drag a card: it snaps to the pointer cell, the rest reflow around it. */
  _drag(card, key) {
    const grid = this._grid, p = this._pos[key]; if (!grid || !p) return;
    const base = this._snapshot();
    card.addClass('is-dragging');
    let result = null;
    const move = (ev) => {
      const c = this._cell(ev, grid, p.w);
      const list = this._cloneList(base);
      const mv = list.find(l => l.key === key); if (!mv) return;
      mv.x = c.x; mv.y = c.y;
      this._reflow(list, mv, this._cols);
      this._applyLive(list);
      result = list;
    };
    const up = async () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      card.removeClass('is-dragging');
      if (result) this._commitLayout(result);
      await this.plugin.saveSettings(); this.render();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
  /* Place card at its computed grid cell (from this._pos) */
  _place(card) {
    const p = this._pos && this._pos[card.dataset.key];
    if (!p) return;
    card.style.gridColumn = p.x + ' / span ' + p.w;
    card.style.gridRow = p.y + ' / span ' + p.h;
    card.dataset.w = p.w; card.dataset.h = p.h;
  }
  /* Pointer position → grid cell (1-based), x clamped to column count */
  _cell(e, grid, w) {
    const r = grid.getBoundingClientRect();
    const cols = this._cols || 1, gap = this._gap, rowH = this._rowH;
    const colPitch = (r.width + gap) / cols;
    let x = Math.floor((e.clientX - r.left) / colPitch) + 1;
    x = Math.min(Math.max(1, x), Math.max(1, cols - w + 1));
    const y = Math.max(1, Math.floor((e.clientY - r.top) / (rowH + gap)) + 1);
    return { x, y };
  }
  /* Write a card's size (w,h) to its config (fixed ID or widget). */
  _setSize(key, w, h) {
    w = Math.max(1, Math.min(48, w)); h = Math.max(1, Math.min(48, h));
    if (key.indexOf('w:') === 0) {
      const it = this._widgets().find(x => 'w:' + x.uid === key);
      if (it) { it.w = w; it.h = h; }
    } else {
      const cards = this.plugin.hp().cards || (this.plugin.hp().cards = {});
      const c = cards[key] || (cards[key] = {});
      c.w = w; c.h = h;
    }
  }
  /* Resize handles (right/bottom edge + corner) in edit mode → drag w/h.
     move/up listen on `document` (not the handle) so the drag survives even if
     the finger leaves the tiny handle or setPointerCapture is a no-op — the
     actual reason touch resize did nothing before. Growing pushes neighbours
     out of the way (reflow). touch-action:none (CSS) stops the page scrolling. */
  _resizable(card, key) {
    if (!this._editing) return;
    ['e', 's', 'se'].forEach(dir => {
      const hnd = card.createDiv('nx-home-rz nx-home-rz-' + dir);
      hnd.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button > 0) return;   // primary pointer only
        e.preventDefault(); e.stopPropagation();
        const p = this._pos[key]; if (!p) return;
        const base = this._snapshot();
        const gridW = this._grid.getBoundingClientRect().width;
        const sx = e.clientX, sy = e.clientY, sw = p.w, sh = p.h;
        const colPitch = (gridW + this._gap) / this._cols;
        const rowPitch = this._rowH + this._gap;
        card.draggable = false;   // no card drag during resize
        try { hnd.setPointerCapture(e.pointerId); } catch (_) {}
        let result = null;
        const move = (ev) => {
          const list = this._cloneList(base);
          const mv = list.find(l => l.key === key); if (!mv) return;
          if (dir === 'e' || dir === 'se') mv.w = Math.max(1, Math.min(this._cols - mv.x + 1, sw + Math.round((ev.clientX - sx) / colPitch)));
          if (dir === 's' || dir === 'se') mv.h = Math.max(1, sh + Math.round((ev.clientY - sy) / rowPitch));
          this._reflow(list, mv, this._cols);
          this._applyLive(list);
          result = list;
        };
        const up = async () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          if (result) {
            const mv = result.find(l => l.key === key);
            if (mv) this._setSize(key, mv.w, mv.h);
            this._commitLayout(result);
          }
          await this.plugin.saveSettings(); this.render();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
    });
  }
  /* Compute positions of all cards: saved ones first, the rest automatically into
     the first free cell (cards may be arbitrarily far apart). */
  _computeLayout(items, cols) {
    const layout = this.plugin.hp().layout || {};
    const occ = new Set();
    const k = (x, y) => x + ',' + y;
    const mark = (x, y, w, h) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) occ.add(k(x + i, y + j)); };
    const fits = (x, y, w, h) => { if (x < 1 || x + w - 1 > cols) return false; for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (occ.has(k(x + i, y + j))) return false; return true; };
    const findFree = (w, h) => { for (let y = 1; y < 10000; y++) for (let x = 1; x <= cols - w + 1; x++) if (fits(x, y, w, h)) return { x, y }; return { x: 1, y: 1 }; };
    this._pos = {};
    // Honour every saved position: keep the card's column, and if its cell is
    // already taken only nudge it straight DOWN to the next free row — never
    // teleport it to the top-left. Process saved cards in their own reading
    // order so the nudge is stable across renders.
    const saved = items.filter(it => layout[it.key] && layout[it.key].x)
      .sort((a, b) => (layout[a.key].y - layout[b.key].y) || (layout[a.key].x - layout[b.key].x));
    for (const it of saved) {
      const s = layout[it.key];
      const x = Math.min(Math.max(1, s.x), Math.max(1, cols - it.w + 1));
      let y = Math.max(1, s.y);
      while (!fits(x, y, it.w, it.h)) y++;          // local downward nudge only
      this._pos[it.key] = { x, y, w: it.w, h: it.h };
      mark(x, y, it.w, it.h);
    }
    for (const it of items) {                        // brand-new cards: first free cell
      if (this._pos[it.key]) continue;
      const f = findFree(it.w, it.h);
      this._pos[it.key] = { x: f.x, y: f.y, w: it.w, h: it.h };
      mark(f.x, f.y, it.w, it.h);
    }
  }
}

module.exports = HomeLayout;
