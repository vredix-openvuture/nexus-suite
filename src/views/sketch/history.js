'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · strokes, undo and saving
 *  Erasing, rendering committed strokes, undo/redo, and the debounced write
 *  that persists a change. Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const { ERASE_R } = require('./tuning.js');
const { sketchStrokePath } = require('../../lib/sketchstroke.js');
const { svgEl } = require('../../lib/sketchsvg.js');

class SurfaceHistory {

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
    /* Moving the whole drawing back into a sheet, undone in ONE step: three
       separate ops (ink, objects, sections) would take three presses to undo
       something the user did with a single tap. */
    if (op.t === 'origin') {
      const prevH = this.H;
      this._shiftAll(-op.dx, -op.dy);
      if (op.h != null) this.setHeight(op.h);
      return { t: 'origin', dx: -op.dx, dy: -op.dy, h: prevH };
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
  /* Let go of everything that outlives the element — pending timers, the fling,
     the resize observer — WITHOUT writing anything back. For a pad that has been
     superseded: a code block re-renders while it may still be being drawn on, its
     successor already carries what it held, and flushing here would put the older
     drawing over the newer one. */
  teardown() {
    this._disarmFlushGuard(); this._stopFling(); this._clearTapSeq();
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    window.clearTimeout(this._tapFlashT);
  }
  /* Call when the pad goes away for good: write what is pending, then let go. */
  destroy() { this.flush(); this.teardown(); }
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
}

module.exports = SurfaceHistory;
