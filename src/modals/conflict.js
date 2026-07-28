'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · conflict
 *  Resolve sync conflicts (both sides changed since the last sync). Per task:
 *  a field-level diff and "Keep server" / "Keep mine". Applied immediately.
 * ========================================================================== */

const { Modal, Notice } = require('obsidian');
const sync = require('../lib/sync.js');

const FIELDS = [['title', 'Title'], ['done', 'Done'], ['due', 'Due'], ['priority', 'Priority'], ['repeat', 'Repeat'], ['description', 'Description']];

class NexusConflictModal extends Modal {
  constructor(plugin, account, client, conflicts, onDone) {
    super(plugin.app);
    this.plugin = plugin; this.account = account; this.client = client;
    this.queue = conflicts.slice(); this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-conflict-modal');
    contentEl.createEl('h3', { text: 'Sync conflicts (' + this.queue.length + ')' });
    contentEl.createEl('p', { cls: 'nx-conflict-sub', text: 'Both the server and your note changed since the last sync. Pick the winner per task.' });
    this.listEl = contentEl.createDiv('nx-conflict-list');
    this._render();
    const foot = contentEl.createDiv('nx-event-foot');
    const spacer = foot.createDiv(); spacer.style.flex = '1';
    foot.createEl('button', { text: 'Keep server for all', cls: 'mod-warning' }).onclick = () => this._all('server');
    foot.createEl('button', { text: 'Keep mine for all', cls: 'mod-cta' }).onclick = () => this._all('mine');
  }

  _render() {
    this.listEl.empty();
    if (!this.queue.length) { this.close(); return; }
    this.queue.forEach((rec, idx) => {
      const card = this.listEl.createDiv('nx-conflict-card');
      const l = rec.local || {}, r = rec.remote || {};
      card.createDiv({ cls: 'nx-conflict-title', text: (r.title || l.title || rec.id) });
      if (rec.reason) card.createDiv({ cls: 'nx-conflict-reason', text: rec.reason });
      const grid = card.createDiv('nx-conflict-grid');
      grid.createDiv({ cls: 'nx-conflict-h', text: '' });
      grid.createDiv({ cls: 'nx-conflict-h', text: 'Server' });
      grid.createDiv({ cls: 'nx-conflict-h', text: 'Mine' });
      FIELDS.forEach(([k, label]) => {
        const rv = String(k === 'done' ? (!!r.done) : (r[k] == null ? '' : r[k]));
        const lv = String(k === 'done' ? (!!l.done) : (l[k] == null ? '' : l[k]));
        if (rv === lv) return;   // only show differing fields
        grid.createDiv({ cls: 'nx-conflict-k', text: label });
        grid.createDiv({ cls: 'nx-conflict-v nx-server', text: rv || '—' });
        grid.createDiv({ cls: 'nx-conflict-v nx-mine', text: lv || '—' });
      });
      const btns = card.createDiv('nx-conflict-btns');
      const srv = btns.createEl('button', { text: 'Keep server' }); srv.onclick = () => this._resolve(idx, 'server');
      const mine = btns.createEl('button', { text: 'Keep mine', cls: 'mod-cta' }); mine.onclick = () => this._resolve(idx, 'mine');
    });
  }

  async _resolve(idx, choice) {
    const rec = this.queue[idx];
    try { await sync.applyResolution(this.plugin, this.account, this.client, rec, choice); }
    catch (e) { new Notice('Nexus: resolve failed — ' + (e && e.message || e)); return; }
    this.queue.splice(idx, 1);
    this._render();
    if (!this.queue.length && this.onDone) this.onDone();
  }

  async _all(choice) {
    const q = this.queue.slice();
    for (const rec of q) { try { await sync.applyResolution(this.plugin, this.account, this.client, rec, choice); } catch (e) {} }
    this.queue = [];
    new Notice('Conflicts resolved.');
    if (this.onDone) this.onDone();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusConflictModal };
