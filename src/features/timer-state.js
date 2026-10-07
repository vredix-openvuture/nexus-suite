'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · timers
 *  Timer state shared by the dashboard widget and the sidebar: running,
 *  pausing, firing when done. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { setIcon } = require('obsidian');
const { TIMER_VIEW } = require('../constants.js');
const { NexusNameModal } = require('../modals/misc.js');
const { NexusTimerDoneModal } = require('../views/timers.js');

class TimerState {

  /* ---- Timer (shared state, survives leaving the dashboard) ----
     _timers[uid] = { running, end(abs ms), remain(sec, paused), minutes, done }.
     Both the dashboard widget AND the sidebar render the same state via buildTimer(). */
  _timer(uid, minutes) {
    return this._timers[uid] || (this._timers[uid] =
      { running: false, end: 0, remain: (minutes || 5) * 60, minutes: minutes || 5, done: false });
  }
  timerRemaining(uid) {
    const t = this._timers[uid]; if (!t) return 0;
    return t.running ? (t.end - Date.now()) / 1000 : t.remain;
  }
  setTimerMinutes(uid, n) {
    const t = this._timer(uid); t.minutes = n;
    if (!t.running) { t.remain = n * 60; t.done = false; }
  }

  // Builds the timer UI into `parent` and returns a paint() function that the
  // caller ticks every second. onSetMinutes stores the new duration in the widget.
  buildTimer(parent, uid, opts, onSetMinutes) {
    opts = opts || {};
    const t = this._timer(uid, opts.minutes);
    if (opts.minutes != null) t.minutes = t.minutes || opts.minutes;
    const box = parent.createDiv('nx-home-live nx-timer');
    const disp = box.createDiv('nx-timer-disp');
    const ctrl = box.createDiv('nx-timer-ctrl');
    const fmt = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), sec = s % 60; return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec; };
    const mins = () => (this._timers[uid] && this._timers[uid].minutes) || opts.minutes || 5;
    const mkBtn = (icon, fn, cls) => {
      const b = ctrl.createEl('button', { cls: 'nx-timer-btn' + (cls ? ' ' + cls : '') });
      setIcon(b, icon);
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    // Set the time by CLICKING THE DISPLAY (no edit button). Works in any mode.
    const editTime = async () => {
      const v = await new NexusNameModal(this.app, 'Timer duration (minutes)', String(mins())).openAndGet();
      const n = parseInt(v, 10);
      if (isNaN(n) || n <= 0) return;
      const x = this._timers[uid]; x.minutes = n;
      if (!x.running) { x.remain = n * 60; x.done = false; }
      if (typeof onSetMinutes === 'function') await onSetMinutes(n);
      drawCtrl(); paint();
    };
    disp.addClass('nx-timer-editable');
    disp.setAttribute('aria-label', 'Set time (click)');
    disp.onclick = (e) => { e.stopPropagation(); editTime(); };
    const drawCtrl = () => {
      ctrl.empty();
      const tt = this._timers[uid]; if (!tt) return;
      mkBtn(tt.running ? 'pause' : 'play', () => {
        const x = this._timers[uid];
        if (x.running) { x.remain = this.timerRemaining(uid); x.running = false; }
        else { if (x.done) { x.done = false; x.remain = mins() * 60; } x.end = Date.now() + Math.max(1, this.timerRemaining(uid)) * 1000; x.running = true; }
        drawCtrl(); paint(); this._syncTimerSidebar();
      });
      mkBtn('rotate-ccw', () => { const x = this._timers[uid]; x.running = false; x.done = false; x.remain = mins() * 60; drawCtrl(); paint(); this._syncTimerSidebar(); });
      if (tt.done) mkBtn('check', () => { const x = this._timers[uid]; x.done = false; x.running = false; x.remain = mins() * 60; drawCtrl(); paint(); this._syncTimerSidebar(); }, 'nx-timer-dismiss');
    };
    let lastR = null, lastD = null;
    const paint = () => {
      const tt = this._timers[uid]; if (!tt) return;
      disp.setText(fmt(this.timerRemaining(uid)));
      if (tt.running !== lastR || tt.done !== lastD) {
        lastR = tt.running; lastD = tt.done;
        box.toggleClass('is-running', !!tt.running);
        box.toggleClass('is-done', !!tt.done);
        drawCtrl();
      }
    };
    drawCtrl(); paint();
    return paint;
  }

  // Global 1s tick (plugin level): detects expiry even without an open dashboard.
  _tickTimers() {
    const timers = this._timers || {};
    let fired = false;
    for (const uid in timers) {
      const t = timers[uid];
      if (t.running && !t.done && (t.end - Date.now()) <= 0) {
        t.running = false; t.remain = 0; t.done = true;
        this._fireTimerDone(uid);
        fired = true;
      }
    }
    if (fired) this._syncTimerSidebar();
  }

  _fireTimerDone(uid) {
    const t = this._timers[uid] || {};
    const minutes = t.minutes || 0;
    const msg = this._timerDoneMsg(uid);
    const title = (minutes ? minutes + '-minute timer finished.' : 'Timer finished.');
    const pauseSec = this._timerPauseSec(uid);
    // A real popup window (modal), visible no matter where you are in Obsidian.
    // With an active break timer it can only be closed after the break elapses.
    new NexusTimerDoneModal(this.app, title, msg, pauseSec).open();
    // Additionally a system notification (Electron renderer). Ask for permission once if needed.
    const body = title + (msg ? ' ' + msg : '');
    try {
      if (typeof Notification !== 'undefined') {
        const show = () => { try { new Notification('Nexus Timer', { body }); } catch (e) {} };
        if (Notification.permission === 'granted') show();
        else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') show(); });
      }
    } catch (e) {}
  }

  // Message shown in the done popup below the line — configurable per timer
  // widget in edit mode (item.doneMsg), otherwise a default text.
  _timerDoneMsg(uid) {
    const w = (this.hp().widgets || []).find(x => x.uid === uid);
    const m = w && typeof w.doneMsg === 'string' ? w.doneMsg.trim() : '';
    return m || 'Time for a little break!';
  }

  // Break duration in seconds (0 = no break timer). If active, it locks the
  // done popup's close button until the break has elapsed.
  _timerPauseSec(uid) {
    const w = (this.hp().widgets || []).find(x => x.uid === uid);
    if (!w || !w.pauseEnabled) return 0;
    const m = parseInt(w.pauseMinutes, 10);
    return (!isNaN(m) && m > 0) ? m * 60 : 0;
  }

  /* The timer panel is an ordinary panel now: you open it, you close it, and it
     stays where you put it. It used to open itself whenever a timer started and
     call detachLeavesOfType the moment none was running — a panel that appears
     and vanishes on its own is not a panel, and it also meant a panel you had
     deliberately opened was torn away on the next leaf change. All that is left
     of that machinery is the repaint. */
  _syncTimerSidebar() {
    for (const leaf of this.app.workspace.getLeavesOfType(TIMER_VIEW)) {
      const view = leaf.view;
      if (view && typeof view.render === 'function') view.render();
    }
  }
  async openTimerSidebar() {
    const open = this.app.workspace.getLeavesOfType(TIMER_VIEW)[0];
    if (open) { this.app.workspace.revealLeaf(open); return open; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return null;
    await leaf.setViewState({ type: TIMER_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /* The panel keeps its own timers rather than mirroring the dashboard's: a
     dashboard card is part of a layout you arranged, a panel timer is the one
     you reach for while working, and tying them together meant the panel could
     only ever show what the dashboard already showed. Per device, because which
     timers you want at hand is not a thing to sync. */
  timerPanelList() {
    const list = this.deviceSetting('timerPanel', null);
    return Array.isArray(list) ? list : [];
  }
  async setTimerPanelList(list) {
    await this.setDeviceSetting('timerPanel', Array.isArray(list) ? list : []);
    this._syncTimerSidebar();
  }
  async addPanelTimer(minutes) {
    const list = this.timerPanelList().slice();
    list.push({ uid: 'panel-' + Date.now().toString(36), minutes: minutes || 5, caption: '' });
    await this.setTimerPanelList(list);
  }
  async removePanelTimer(uid) {
    await this.setTimerPanelList(this.timerPanelList().filter(t => t.uid !== uid));
    delete (this._timers || {})[uid];
  }
}

module.exports = TimerState;
