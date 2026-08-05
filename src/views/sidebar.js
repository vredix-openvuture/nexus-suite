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

const { ItemView, Notice, moment, setIcon } = require('obsidian');
const { SIDE_CAL_VIEW, SIDE_TASKS_VIEW } = require('../constants.js');
const { NexusAgenda, parsePriority } = require('../lib/agenda.js');
const calstore = require('../lib/calstore.js');

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
  reload() { this._ag && (this._ag._cals = null); this.render(); }

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
    tool('plus', this.kind === 'tasks' ? 'New task' : 'New event', () => this.create());
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

  renderCalendar(body, item, count) {
    const ag = this.agenda();
    const days = Math.max(1, Math.min(60, parseInt(item.days, 10) || 7));
    const start = moment().startOf('day');
    const end = start.clone().add(days - 1, 'day').endOf('day');
    body.createDiv({ cls: 'nx-ag-empty', text: 'Reading calendars …' });
    ag.calendars().then(all => {
      if (!body.isConnected) return;
      const want = (item.calendars || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const cals = want.length
        ? all.filter(c => want.some(w => String(c.display || '').toLowerCase().includes(w)))
        : all;
      const now = moment();
      let occs = calstore.expandRange(cals, start, end)
        .filter(o => item.past ? true : o.end.isAfter(now))
        .sort((a, b) => a.start.valueOf() - b.start.valueOf());
      if (item.count > 0) occs = occs.slice(0, item.count);
      body.empty();
      count.setText(String(occs.length));
      if (!occs.length) { body.createDiv({ cls: 'nx-ag-empty', text: 'Nothing scheduled.' }); return; }
      let lastKey = '';
      occs.forEach(o => {
        const key = o.start.format('YYYY-MM-DD');
        if (key !== lastKey) {
          lastKey = key;
          const d = o.start.clone().startOf('day');
          const label = d.isSame(start, 'day') ? 'Today'
            : d.isSame(start.clone().add(1, 'day'), 'day') ? 'Tomorrow'
            : d.format('ddd, D MMM');
          const h = body.createDiv({ cls: 'nx-side-day', text: label });
          h.onclick = () => this.plugin.openCalendarPage(d, 'day');
        }
        ag.eventRow(body, o, o.start.clone().startOf('day'), cals, () => this.reload());
      });
    }).catch(() => { if (body.isConnected) { body.empty(); body.createDiv({ cls: 'nx-ag-empty', text: 'Calendar could not be read.' }); } });
  }

  async create() {
    if (this.kind === 'tasks') {
      const { NexusTaskModal } = require('../modals/task.js');
      new NexusTaskModal(this.plugin, () => this.schedule(), '').open();
      return;
    }
    const cals = await this.agenda().calendars();
    if (!cals.length) { new Notice('Add a local calendar or sync an account first.'); return; }
    const { NexusEventModal } = require('../modals/event.js');
    new NexusEventModal(this.plugin, { start: { dt: moment().format('YYYY-MM-DD') + 'T09:00:00', utc: false, tzid: null } },
      () => this.reload(), cals, null).open();
  }
}

module.exports = { NexusSideView };
