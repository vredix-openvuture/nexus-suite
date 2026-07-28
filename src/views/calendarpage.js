'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · calendar page
 *  Full-page calendar (month / week / day) over CalDAV + local calendars.
 *  Renders purely from the vault cache (calstore) → works offline / on mobile.
 *  Overlays the existing daily-note behaviour (dot + click-through) so the
 *  "daily note calendar" lives on as a standalone page.
 * ========================================================================== */

const { ItemView, moment, setIcon, Notice } = require('obsidian');
const { CAL_PAGE_VIEW, NX_MODULES } = require('../constants.js');
const { getDailyNoteSettings, openDailyNote } = require('../lib/helpers.js');
const calstore = require('../lib/calstore.js');
const { NexusEventModal } = require('../modals/event.js');

const MAX_CHIPS = 4;   // per day cell in month view before "+N"

class NexusCalendarPageView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = (plugin.settings.tasksCalendar && plugin.settings.tasksCalendar.defaultView) || 'month';
    this.cursor = moment().startOf('day');
    this.calendars = [];
  }
  getViewType() { return CAL_PAGE_VIEW; }
  getDisplayText() { return NX_MODULES.tasksCalendar.name; }
  getIcon() { return 'calendar-check'; }

  async onOpen() {
    await this.reload();
    const dir = calstore.dataDir(this.plugin) + '/calendar';
    const touch = (f) => { if (f && f.path && f.path.startsWith(dir)) this.reload(); };
    this.registerEvent(this.app.vault.on('modify', touch));
    this.registerEvent(this.app.vault.on('create', touch));
    this.registerEvent(this.app.vault.on('delete', touch));
  }

  async reload() {
    try { this.calendars = await calstore.loadCalendars(this.plugin); } catch (e) { this.calendars = []; }
    this.render();
  }

  /* ── visible range for the current mode ── */
  range() {
    const c = this.cursor;
    if (this.mode === 'day') return [c.clone().startOf('day'), c.clone().endOf('day')];
    if (this.mode === 'week') return [c.clone().startOf('week'), c.clone().endOf('week')];
    return [c.clone().startOf('month').startOf('week'), c.clone().endOf('month').endOf('week')];
  }
  step(dir) {
    const unit = this.mode === 'day' ? 'day' : this.mode === 'week' ? 'week' : 'month';
    this.cursor.add(dir, unit);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-calpage');
    const inner = root.createDiv('nx-calpage-inner');
    this._head(inner);

    const [rs, re] = this.range();
    const occs = calstore.expandRange(this.calendars, rs, re);
    if (this.mode === 'month') this._month(inner, occs);
    else if (this.mode === 'week') this._week(inner, occs);
    else this._day(inner, occs);
  }

  _head(inner) {
    const head = inner.createDiv('nx-cp-head');
    // title
    const title = head.createDiv('nx-cp-title');
    if (this.mode === 'day') { title.createSpan({ text: this.cursor.format('dddd D') }); title.createSpan({ cls: 'nx-cp-sub', text: this.cursor.format('MMMM YYYY') }); }
    else if (this.mode === 'week') { const [s, e] = this.range(); title.createSpan({ text: s.format('D MMM') + ' – ' + e.format('D MMM') }); title.createSpan({ cls: 'nx-cp-sub', text: s.format('YYYY') }); }
    else { title.createSpan({ text: this.cursor.format('MMMM') }); title.createSpan({ cls: 'nx-cp-sub', text: this.cursor.format('YYYY') }); }

    // nav
    const nav = head.createDiv('nx-cp-nav');
    const nb = (icon, fn, label) => { const b = nav.createEl('button', { cls: 'nx-cp-btn', attr: { 'aria-label': label } }); setIcon(b, icon); b.onclick = fn; return b; };
    nb('chevron-left', () => this.step(-1), 'Previous');
    const today = nav.createEl('button', { cls: 'nx-cp-btn nx-cp-today', text: 'Today' });
    today.onclick = () => { this.cursor = moment().startOf('day'); this.render(); };
    nb('chevron-right', () => this.step(1), 'Next');

    // view switch
    const seg = head.createDiv('nx-cp-seg');
    [['month', 'Month'], ['week', 'Week'], ['day', 'Day']].forEach(([m, lbl]) => {
      const b = seg.createEl('button', { cls: 'nx-cp-segbtn' + (this.mode === m ? ' is-active' : ''), text: lbl });
      b.onclick = () => { this.mode = m; this.render(); };
    });

    // actions
    const act = head.createDiv('nx-cp-actions');
    const add = act.createEl('button', { cls: 'nx-cp-btn nx-cp-primary', attr: { 'aria-label': 'New event' } });
    setIcon(add, 'plus'); add.createSpan({ text: ' Event' });
    add.onclick = () => this._newEvent();
    const sync = act.createEl('button', { cls: 'nx-cp-btn', attr: { 'aria-label': 'Sync now' } });
    setIcon(sync, 'refresh-cw');
    sync.onclick = async () => { sync.addClass('is-spinning'); await this.plugin.syncTaskCal(); sync.removeClass('is-spinning'); this.reload(); };
  }

  _newEvent() {
    const locals = this.plugin.settings.tasksCalendar.localCalendars || [];
    if (!locals.length) { new Notice('Create a local calendar first (Settings → ' + NX_MODULES.tasksCalendar.name + ').'); return; }
    new NexusEventModal(this.plugin, { start: { dt: this.cursor.format('YYYY-MM-DD') + 'T09:00:00', utc: false, tzid: null } }, () => this.reload()).open();
  }

  _openEvent(occ) {
    const cal = occ.cal;
    if (cal.kind === 'local') new NexusEventModal(this.plugin, occ.event, () => this.reload(), cal.calendarId).open();
    else new NexusEventModal(this.plugin, occ.event, null, null, true).open();   // remote: read-only (M1)
  }

  _chip(parent, occ) {
    const chip = parent.createDiv('nx-cp-chip' + (occ.allDay ? ' is-allday' : ''));
    if (occ.color) chip.style.setProperty('--chip', occ.color);
    if (!occ.allDay) chip.createSpan({ cls: 'nx-cp-chip-time', text: occ.start.format('H:mm') });
    chip.createSpan({ cls: 'nx-cp-chip-text', text: occ.event.summary });
    chip.onclick = (e) => { e.stopPropagation(); this._openEvent(occ); };
    return chip;
  }

  _dayEvents(occs, dayStart) {
    const de = dayStart.clone().endOf('day');
    return occs.filter(o => o.start.isSameOrBefore(de) && o.end.isAfter(dayStart));
  }

  /* ── MONTH ── */
  _month(inner, occs) {
    const { format, folder } = getDailyNoteSettings(this.app);
    const grid = inner.createDiv('nx-cp-month');
    moment.weekdaysMin(true).forEach(d => grid.createDiv({ cls: 'nx-cp-dow', text: d }));
    const [start, end] = this.range();
    const today = moment().format('YYYY-MM-DD');
    const day = start.clone();
    while (day.isSameOrBefore(end)) {
      const d = day.clone();
      const cell = grid.createDiv('nx-cp-day');
      if (d.month() !== this.cursor.month()) cell.addClass('nx-adjacent');
      if (d.format('YYYY-MM-DD') === today) cell.addClass('nx-today');
      const num = cell.createDiv({ cls: 'nx-cp-daynum', text: d.format('D') });
      const path = (folder ? folder + '/' : '') + d.format(format) + '.md';
      if (this.app.vault.getAbstractFileByPath(path)) cell.addClass('nx-has-note');
      num.onclick = (e) => { e.stopPropagation(); openDailyNote(this.app, d); };

      const wrap = cell.createDiv('nx-cp-events');
      const list = this._dayEvents(occs, d);
      list.slice(0, MAX_CHIPS).forEach(o => this._chip(wrap, o));
      if (list.length > MAX_CHIPS) wrap.createDiv({ cls: 'nx-cp-more', text: '+' + (list.length - MAX_CHIPS) });
      cell.onclick = () => openDailyNote(this.app, d);
      day.add(1, 'day');
    }
  }

  /* ── WEEK ── */
  _week(inner, occs) {
    const { format, folder } = getDailyNoteSettings(this.app);
    const grid = inner.createDiv('nx-cp-week');
    const [start] = this.range();
    const today = moment().format('YYYY-MM-DD');
    for (let i = 0; i < 7; i++) {
      const d = start.clone().add(i, 'day');
      const col = grid.createDiv('nx-cp-wcol');
      if (d.format('YYYY-MM-DD') === today) col.addClass('nx-today');
      const h = col.createDiv('nx-cp-wcol-head');
      h.createSpan({ cls: 'nx-cp-wdow', text: d.format('ddd') });
      h.createSpan({ cls: 'nx-cp-wnum', text: d.format('D') });
      const path = (folder ? folder + '/' : '') + d.format(format) + '.md';
      if (this.app.vault.getAbstractFileByPath(path)) h.addClass('nx-has-note');
      h.onclick = () => openDailyNote(this.app, d);
      const wrap = col.createDiv('nx-cp-events');
      this._dayEvents(occs, d).forEach(o => this._chip(wrap, o));
    }
  }

  /* ── DAY (agenda) ── */
  _day(inner, occs) {
    const { format, folder } = getDailyNoteSettings(this.app);
    const wrap = inner.createDiv('nx-cp-agenda');
    const d = this.cursor.clone().startOf('day');
    const list = this._dayEvents(occs, d);
    const allday = list.filter(o => o.allDay);
    const timed = list.filter(o => !o.allDay).sort((a, b) => a.start.valueOf() - b.start.valueOf());

    const noteBar = wrap.createDiv('nx-cp-agenda-note');
    const path = (folder ? folder + '/' : '') + d.format(format) + '.md';
    const has = !!this.app.vault.getAbstractFileByPath(path);
    const nb = noteBar.createEl('button', { cls: 'nx-cp-btn', text: (has ? 'Open' : 'Create') + " daily note" });
    setIcon(nb.createSpan({ cls: 'nx-cp-note-ic' }), 'file-text');
    nb.onclick = () => openDailyNote(this.app, d);

    if (allday.length) {
      const sec = wrap.createDiv('nx-cp-agenda-sec');
      sec.createDiv({ cls: 'nx-cp-agenda-h', text: 'All day' });
      allday.forEach(o => { const row = sec.createDiv('nx-cp-arow'); this._chip(row, o); });
    }
    const sec = wrap.createDiv('nx-cp-agenda-sec');
    if (!timed.length && !allday.length) { wrap.createDiv({ cls: 'nx-cp-empty', text: 'No events.' }); return; }
    timed.forEach(o => {
      const row = sec.createDiv('nx-cp-arow');
      row.createDiv({ cls: 'nx-cp-atime', text: o.start.format('H:mm') + '–' + o.end.format('H:mm') });
      this._chip(row, o);
    });
  }
}

module.exports = { NexusCalendarPageView };
