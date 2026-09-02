'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · timers
 *  Running-timer sidebar dashboard + done/config modals.
 * ========================================================================== */

const { ItemView, Modal, Setting, setIcon } = require('obsidian');
const { TIMER_VIEW } = require('../constants.js');
const { NexusInkTagModal } = require('./ink.js');

class NexusTimerSidebarView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this._liveEls = []; }
  getViewType() { return TIMER_VIEW; }
  getDisplayText() { return 'Timer'; }
  getIcon() { return 'timer'; }

  async onOpen() {
    this.render();
    // Update the displays every second (state lives in the plugin).
    this.registerInterval(window.setInterval(() => (this._liveEls || []).forEach(fn => { try { fn(); } catch (e) {} }), 1000));
  }

  /* The panel's own timers first, then any dashboard timer that is actually
     running — so a timer you started on the dashboard is still reachable when
     the dashboard is not the tab you are looking at, without the panel becoming
     a second copy of the dashboard. */
  _rows() {
    const timers = this.plugin._timers || {};
    const mine = this.plugin.timerPanelList().map(t => ({ ...t, own: true }));
    const running = (this.plugin.hp().widgets || [])
      .filter(w => w.type === 'timer')
      .filter(w => { const t = timers[w.uid]; return t && (t.running || t.done); })
      .map(w => ({ uid: w.uid, minutes: w.minutes, caption: w.caption || w.label, own: false, widget: w }));
    return mine.concat(running);
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-timers-view');
    this._liveEls = [];
    const inner = root.createDiv('nx-timers-inner');
    const rows = this._rows();

    if (!rows.length) {
      inner.createDiv({ cls: 'nx-timers-empty', text: 'No timers here yet.' });
    }
    rows.forEach(row => {
      const item = inner.createDiv('nx-timers-item');
      if (row.caption) item.createDiv({ cls: 'nx-timers-cap', text: row.caption });
      const paint = this.plugin.buildTimer(item, row.uid, { minutes: row.minutes }, async (n) => {
        if (row.own) {
          const list = this.plugin.timerPanelList().map(t => (t.uid === row.uid ? { ...t, minutes: n } : t));
          await this.plugin.setDeviceSetting('timerPanel', list);
        } else {
          row.widget.minutes = n;
          await this.plugin.saveSettings();
        }
      });
      this._liveEls.push(paint);
      // A dashboard timer is only visiting; it is removed where it lives.
      if (!row.own) { item.addClass('is-mirrored'); return; }
      const drop = item.createEl('button', { cls: 'nx-btn is-sm is-icon is-quiet is-danger nx-timers-del' });
      setIcon(drop, 'x');
      drop.setAttribute('aria-label', 'Remove this timer');
      drop.onclick = () => this.plugin.removePanelTimer(row.uid);
    });

    const add = inner.createEl('button', { cls: 'nx-btn nx-list-add', text: 'Add a timer' });
    add.onclick = () => this.plugin.addPanelTimer(5);
  }
}

/* Timer's done popup: its own window with the line "X-minute timer finished."
   and a (editable in edit mode) message below. If a break timer is set
   (pauseSec > 0), the window stays locked (no closing via OK/Esc/click-outside)
   until the break has elapsed. */
class NexusTimerDoneModal extends Modal {
  constructor(app, title, message, pauseSec) { super(app); this.titleText = title; this.message = message; this.pauseSec = pauseSec || 0; this._locked = false; }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nx-timerdone-modal');
    contentEl.addClass('nx-timerdone');
    contentEl.createDiv({ cls: 'nx-timerdone-icon', text: '⏰' });
    contentEl.createEl('h2', { cls: 'nx-timerdone-title', text: this.titleText });
    if (this.message) contentEl.createEl('p', { cls: 'nx-timerdone-msg', text: this.message });
    const row = contentEl.createDiv('nx-timerdone-actions');
    const ok = row.createEl('button', { text: 'OK', cls: 'mod-cta' });
    ok.onclick = () => this.close();

    if (this.pauseSec > 0) {
      // Lock the window, show the break countdown.
      this._locked = true;
      const closeBtn = modalEl.querySelector('.modal-close-button');
      if (closeBtn) closeBtn.style.display = 'none';
      ok.disabled = true; ok.addClass('is-disabled');
      const hint = contentEl.createEl('p', { cls: 'nx-timerdone-pause' });
      const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), sec = s % 60; return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec; };
      const end = Date.now() + this.pauseSec * 1000;
      const tick = () => {
        const rem = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        if (rem > 0) { hint.setText('Break … ' + fmt(rem) + ' left'); return; }
        // Break over → unlock.
        this._locked = false;
        ok.disabled = false; ok.removeClass('is-disabled');
        if (closeBtn) closeBtn.style.display = '';
        hint.setText('Break over — you can close now.');
        hint.addClass('is-done');
        if (this._iv) { window.clearInterval(this._iv); this._iv = null; }
        ok.focus();
      };
      tick(); this._iv = window.setInterval(tick, 250);
    } else {
      window.setTimeout(() => ok.focus(), 0);
    }
  }
  // All close paths (OK, Esc, click-outside, X) go through close() → locked.
  close() { if (this._locked) return; super.close(); }
  onClose() { if (this._iv) { window.clearInterval(this._iv); this._iv = null; } this.contentEl.empty(); }
}

/* Timer widget settings (edit mode): duration, done message, break timer. */

/* Timer widget settings (edit mode): duration, done message, break timer. */
class NexusTimerConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Timer settings' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };

    new Setting(contentEl).setName('Duration (minutes)')
      .addText(t => t.setValue(String(it.minutes || 5)).onChange(async v => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0) { it.minutes = n; this.plugin.setTimerMinutes(it.uid, n); await save(); }
      }));

    new Setting(contentEl).setName('Done message').setDesc('Shown in the popup below the time.')
      .addText(t => t.setValue(it.doneMsg || '').setPlaceholder('Time for a little break!')
        .onChange(async v => { it.doneMsg = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(contentEl).setName('Break timer').setDesc('The done popup can only be closed once the break timer has elapsed.')
      .addToggle(tg => tg.setValue(!!it.pauseEnabled).onChange(async v => { it.pauseEnabled = v; await save(); this.render(); }));

    if (it.pauseEnabled) new Setting(contentEl).setName('Break duration (minutes)')
      .addText(t => t.setValue(String(it.pauseMinutes || 5)).onChange(async v => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0) { it.pauseMinutes = n; await this.plugin.saveSettings(); }
      }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusTimerSidebarView, NexusTimerDoneModal, NexusTimerConfigModal };
