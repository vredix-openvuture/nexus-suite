'use strict';

/* ============================================================================
 *  NEXUS SUITE · sync progress
 *  One notice that stays up while a sync runs: first what it is doing (looking
 *  at both sides), then two bars — pulling (from the server to this device)
 *  and pushing (from this device to the server) — each with its count. It
 *  closes itself when the run ends; the run's own summary notice follows as
 *  before.
 * ========================================================================== */

const { Notice } = require('obsidian');

const IDLE_LINGER_MS = 2500;

class SyncProgress {
  constructor() {
    const box = document.createDocumentFragment();
    const root = box.createDiv('nx-syncprog');
    root.createDiv({ cls: 'nx-syncprog-title', text: 'Nexus sync' });
    this.statusEl = root.createDiv({ cls: 'nx-syncprog-status', text: 'Comparing this device with the server…' });
    this.rows = {
      pull: this.row(root, 'Pulling'),
      push: this.row(root, 'Pushing'),
    };
    this.notice = new Notice(box, 0);
  }

  row(root, label) {
    const el = root.createDiv('nx-syncprog-row');
    el.createSpan({ cls: 'nx-syncprog-label', text: label });
    const track = el.createDiv('nx-syncprog-track');
    const fill = track.createDiv('nx-syncprog-fill');
    const count = el.createSpan({ cls: 'nx-syncprog-count', text: '–' });
    return { el, fill, count, done: 0, total: 0 };
  }

  /* What the run will move, once both sides are listed. */
  plan(pull, push) {
    // Nothing to move: just say so, without two empty bars, and leave it up
    // long enough to be read — such a run ends a moment later.
    this.idle = !(pull + push);
    if (this.idle) {
      this.statusEl.setText('Up to date — nothing to do.');
      for (const row of Object.values(this.rows)) row.el.hide();
      return;
    }
    this.statusEl.setText('Transferring…');
    this.set('pull', 0, pull);
    this.set('push', 0, push);
  }

  step(kind) {
    const row = this.rows[kind];
    if (row) this.set(kind, row.done + 1, row.total);
  }

  set(kind, done, total) {
    const row = this.rows[kind];
    row.done = Math.min(done, total);
    row.total = total;
    row.count.setText(total ? row.done + ' / ' + total : '0');
    row.fill.style.width = (total ? Math.round(100 * row.done / total) : 100) + '%';
    row.el.toggleClass('is-idle', !total);
  }

  status(text) { this.statusEl.setText(text); }

  close() {
    if (!this.notice) return;
    const notice = this.notice;
    this.notice = null;
    if (this.idle) window.setTimeout(() => notice.hide(), IDLE_LINGER_MS);
    else notice.hide();
  }
}

module.exports = { SyncProgress };
