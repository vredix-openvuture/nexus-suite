'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · calendar & tasks sidebar
 *  The two dashboard cards as their own side panels, so the day's events and
 *  the open tasks can stay visible NEXT TO the note you are writing — the
 *  dashboard is a place you go, a sidebar is something you keep.
 *
 *  Everything they show comes from lib/agenda.js (expanded recurrences, due
 *  buckets, the write-back of a ticked box), the very same path the agenda
 *  block and the dashboard cards take. The panels only decide what to ask for;
 *  their config is one card-shaped object per panel in the settings, so the
 *  card config modals can edit them unchanged.
 * ========================================================================== */

const { ItemView, moment, setIcon } = require('obsidian');
const { SIDE_CAL_VIEW, SIDE_TASKS_VIEW } = require('../constants.js');
const { NexusAgenda, parsePriority } = require('../lib/agenda.js');
const daytext = require('../lib/daytext.js');

const DEFAULTS = {
  calendar: { title: 'Calendar', icon: 'calendar-check', display: 'agenda', days: 7, calendars: '', count: 20, past: false },
  tasks:    { title: 'Tasks', icon: 'list-checks', projects: '', state: 'open', due: ['day', 'overdue'], priority: '', sort: 'smart', count: 30 },
};

class NexusSideView extends ItemView {
  constructor(leaf, plugin, kind) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
    this.kind = kind;
  }
  getViewType() { return this.kind === 'tasks' ? SIDE_TASKS_VIEW : SIDE_CAL_VIEW; }
  getDisplayText() { return this.cfg().title || DEFAULTS[this.kind].title; }
  getIcon() { return DEFAULTS[this.kind].icon; }

  /* The panel's config lives in the settings under its kind — same shape as a
     dashboard card, so the card config modals work on it unchanged. */
  cfg() {
    const s = this.plugin.settings.tasksCalendar;
    if (!s.sidebar) s.sidebar = {};
    if (!s.sidebar[this.kind]) s.sidebar[this.kind] = Object.assign({}, DEFAULTS[this.kind]);
    return Object.assign(s.sidebar[this.kind], { uid: 'side-' + this.kind });
  }
  agenda() { return this._ag || (this._ag = this.plugin.agenda || new NexusAgenda(this.plugin)); }

  async onOpen() {
    this.render();
    const touch = () => this.schedule();
    this.registerEvent(this.app.metadataCache.on('changed', touch));
    this.registerEvent(this.app.vault.on('create', touch));
    this.registerEvent(this.app.vault.on('delete', touch));
    this.registerEvent(this.app.vault.on('rename', touch));
    // Midnight rolls the day over; a quiet minute tick is cheaper than tracking it.
    this.registerInterval(window.setInterval(() => {
      const d = moment().format('YYYY-MM-DD');
      if (this._day && this._day !== d) this.render();
    }, 60 * 1000));
  }
  schedule() { window.clearTimeout(this._t); this._t = window.setTimeout(() => this.render(), 400); }
  reload() { this.render(); }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-side');
    this._day = moment().format('YYYY-MM-DD');
    const item = this.cfg();

    const head = root.createDiv('nx-side-head');
    setIcon(head.createSpan('nx-side-icon'), item.icon || DEFAULTS[this.kind].icon);
    head.createSpan({ cls: 'nx-side-title', text: item.title || DEFAULTS[this.kind].title });
    const count = head.createSpan({ cls: 'nx-side-count', text: '' });
    const tool = (icon, label, fn) => {
      const b = head.createSpan('nx-side-tool');
      setIcon(b, icon);
      b.setAttribute('aria-label', label);
      b.onclick = fn;
      return b;
    };
    if (this.kind === 'tasks') tool('plus', 'New task', () => this.create());
    tool('external-link', this.kind === 'tasks' ? 'Open the tasks page' : 'Open the calendar page',
      () => (this.kind === 'tasks' ? this.plugin.openTasksPage() : this.plugin.openCalendarPage()));
    tool('settings-2', 'Configure', () => {
      const { NexusCalendarCardConfigModal, NexusTaskCardConfigModal } = require('../modals/cards.js');
      const Cls = this.kind === 'tasks' ? NexusTaskCardConfigModal : NexusCalendarCardConfigModal;
      new Cls(this.plugin, this, item).open();
    });

    const body = root.createDiv('nx-side-body');
    if (!this.plugin.settings.tasksCalendar.enabled) {
      body.createDiv({ cls: 'nx-ag-empty', text: 'Tasks & Calendar is switched off.' });
      return;
    }
    if (this.kind === 'tasks') this.renderTasks(body, item, count);
    else this.renderCalendar(body, item, count);
  }

  renderTasks(body, item, count) {
    const ag = this.agenda();
    const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
    const items = ag.collectTasks({
      projects: list(item.projects), calendars: [],
      state: item.state || 'open',
      priority: item.priority ? parsePriority(item.priority) : null,
      due: Array.isArray(item.due) && item.due.length ? item.due : ['day', 'overdue'],
      sort: item.sort || 'smart', limit: item.count > 0 ? item.count : 0,
    }, moment().startOf('day'));
    count.setText(String(items.length));
    if (!items.length) { body.createDiv({ cls: 'nx-ag-empty', text: 'Nothing due.' }); return; }
    items.forEach(it => ag.taskRow(body, it, () => this.schedule()));
  }

  /* The days ahead, each with what it is FOR and what is due on it. There are
     no events any more (docs/removed-features.md), and a day with nothing on it
     is part of the answer to "what does this week look like" — so it keeps its
     row instead of being skipped. */
  renderCalendar(body, item, count) {
    const ag = this.agenda();
    const days = Math.max(1, Math.min(60, parseInt(item.days, 10) || 7));
    const start = moment().startOf('day');
    let written = 0;
    for (let i = 0; i < days; i++) {
      const d = start.clone().add(i, 'day');
      const iso = d.format('YYYY-MM-DD');
      const text = daytext.readDayText(this.app, this.plugin, d);
      const due = ag.collectTasks({
        projects: [], calendars: [], state: 'open', priority: null,
        due: ['day'], sort: 'smart', limit: 0,
      }, d);
      if (!text && !due.length && item.hideEmpty) continue;
      if (text) written++;
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.format('ddd, D MMM');
      const h = body.createDiv({ cls: 'nx-side-day' + (i === 0 ? ' is-today' : ''), text: label });
      h.onclick = () => this.plugin.openCalendarPage(d);
      if (text) body.createDiv({ cls: 'nx-side-daytext', text });
      due.forEach(it => ag.taskRow(body, it, () => this.schedule()));
    }
    count.setText(String(written));
    if (!body.childElementCount) body.createDiv({ cls: 'nx-ag-empty', text: 'Nothing written or due in the next ' + days + ' day(s).' });
  }

  create() {
    const { NexusTaskModal } = require('../modals/task.js');
    new NexusTaskModal(this.plugin, () => this.schedule(), '').open();
  }
}

module.exports = { NexusSideView };
