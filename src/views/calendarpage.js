'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · calendar page
 *  Full-page calendar (month / week / day) over the local calendars.
 *  Renders purely from the vault cache (calstore) → works offline / on mobile.
 *  Overlays the existing daily-note behaviour (dot + click-through) so the
 *  "daily note calendar" lives on as a standalone page.
 * ========================================================================== */

const { ItemView, TFile, moment, setIcon, Notice } = require('obsidian');
const { CAL_PAGE_VIEW, NX_MODULES } = require('../constants.js');
const { getDailyNoteSettings, nxEndOfWeek, nxMonthGridRange, nxPinMenuItem, nxStartOfWeek, nxWeekdayLabels, openDailyNote } = require('../lib/helpers.js');
const calstore = require('../lib/calstore.js');
const planner = require('../lib/planner.js');
const tasks = require('../lib/tasks.js');
const { NexusEventModal } = require('../modals/event.js');

const MAX_CHIPS = 4;   // per day cell in month view before "+N"

/* stable per-calendar key for the visibility toggle (matches the event modal) */
function calKey(c) { return c.kind === 'tasks' ? 'tasks:due' : 'local:' + c.calendarId; }

class NexusCalendarPageView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = (plugin.settings.tasksCalendar && plugin.settings.tasksCalendar.defaultView) || 'month';
    this.cursor = moment().startOf('day');
    this.calendars = [];
    this.plannerLines = {};      // date → the planner's one line for that day
    this.plannerPaths = new Set();
    this._planGen = 0;           // a slow read of an old range must not win
  }
  getViewType() { return CAL_PAGE_VIEW; }
  getDisplayText() { return NX_MODULES.tasksCalendar.name; }
  getIcon() { return 'calendar-check'; }
  onPaneMenu(menu, source) {
    nxPinMenuItem(this.plugin, menu, 'calendar');
    return super.onPaneMenu(menu, source);
  }

  async onOpen() {
    await this.reload();
    const dir = calstore.dataDir(this.plugin) + '/calendar';
    const items = tasks.itemsFolder(this.plugin) + '/';
    // The planner notes are ordinary notes anywhere in the vault, so they are
    // matched by path against what the current grid actually reads.
    const touch = (f) => {
      if (!f || !f.path) return;
      if (f.path.startsWith(dir) || f.path.startsWith(items) || this.plannerPaths.has(f.path)) this.reload();
    };
    this.registerEvent(this.app.vault.on('modify', touch));
    this.registerEvent(this.app.vault.on('create', touch));
    this.registerEvent(this.app.vault.on('delete', touch));
  }

  async reload() {
    try { this.calendars = await calstore.loadCalendars(this.plugin); } catch (e) { this.calendars = []; }
    try { const t = this._loadDueTasks(); if (t) this.calendars.push(t); } catch (e) {}
    await this.loadPlanner();
    this.render();
  }

  get plannerStore() { return (this.plugin.settings.tasksCalendar || {}).planner || {}; }
  /* The planner module owns this line — with it off the calendar neither shows
     one nor creates a month note, the same way the block refuses to render. */
  get plannerOn() { const p = this.plugin.settings.planner; return !p || p.enabled !== false; }

  /* Its own step because paging does not reload the calendars — the occurrences
     are already in memory, the month notes are not. */
  async loadPlanner() {
    const gen = ++this._planGen;
    if (!this.plannerOn) { this.plannerLines = {}; this.plannerPaths = new Set(); return; }
    const [rs, re] = this.range();
    const months = planner.monthsInRange(rs.format('YYYY-MM-DD'), re.format('YYYY-MM-DD'));
    const paths = new Set(months.map(m => planner.monthNotePath(this.plannerStore, m)).filter(Boolean));
    let lines = {};
    try { lines = await planner.readMonthPlans(this.app, TFile, this.plannerStore, months); }
    catch (e) { console.error('[Nexus] planner: could not read ' + months.join(', '), e); }
    // Two fast steps: the older read must not paint the range that left.
    if (gen !== this._planGen) return;
    this.plannerPaths = paths;
    this.plannerLines = lines;
  }

  /* Paint now, read the month notes after — the grid must not wait on a file
     read to appear. */
  repaint() {
    if (this.editingPlan) return;
    this.render();
    this.loadPlanner().then(() => { if (!this.editingPlan) this.render(); });
  }

  /* Tasks with a due date → a synthetic "Tasks" calendar so they show on their
     due day (toggleable via the calendar panel like any calendar). */
  _loadDueTasks() {
    const app = this.app, itemsFolder = tasks.itemsFolder(this.plugin), events = [];
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(itemsFolder + '/')) continue;
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (fm['nexus-type'] !== 'task' || !fm.due) continue;
      const due = String(fm.due), timed = /T\d/.test(due);
      const when = timed ? { dt: due.slice(0, 19), utc: /Z$/.test(due) } : { d: due.slice(0, 10) };
      events.push({
        uid: 'task-' + f.basename, summary: fm.title || f.basename, allDay: !timed,
        start: when, end: when, isTask: true, done: (fm.status === 'completed' || fm.done === true), notePath: f.path,
      });
    }
    if (!events.length) return null;
    return { kind: 'tasks', calendarId: '__tasks__', display: 'Tasks (due)', color: '#e0a800', component: 'VTODO', events };
  }

  _openTask(ev) {
    const f = this.app.vault.getAbstractFileByPath(ev.notePath);
    if (f) this.app.workspace.getLeaf(false).openFile(f);
  }

  /* ── visible range for the current mode ── */
  range() {
    const c = this.cursor;
    if (this.mode === 'day') return [c.clone().startOf('day'), c.clone().endOf('day')];
    if (this.mode === 'week') return [nxStartOfWeek(c, this.plugin), nxEndOfWeek(c, this.plugin)];
    return nxMonthGridRange(c, this.plugin);
  }
  step(dir) {
    const unit = this.mode === 'day' ? 'day' : this.mode === 'week' ? 'week' : 'month';
    this.cursor.add(dir, unit);
    this.repaint();
  }

  render() {
    this._repainting = true;
    try { this._render(); } finally { this._repainting = false; }
  }

  _render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-calpage');
    const inner = root.createDiv('nx-calpage-inner');
    this._head(inner);

    if (!this.calendars.length) this._emptyHint(inner);
    if (this._calPanelOpen) this._calPanel(inner);

    const hidden = new Set(this.plugin.settings.tasksCalendar.hiddenCalendars || []);
    const visible = this.calendars.filter(c => !hidden.has(calKey(c)));
    const [rs, re] = this.range();
    const occs = calstore.expandRange(visible, rs, re);
    if (this.mode === 'month') this._month(inner, occs);
    else if (this.mode === 'week') this._week(inner, occs);
    else this._day(inner, occs);
  }

  _calPanel(inner) {
    const panel = inner.createDiv('nx-cp-calpanel');
    const head = panel.createDiv('nx-cp-calpanel-h');
    head.createSpan({ text: 'Calendars' });
    const close = head.createEl('button', { cls: 'nx-cp-calpanel-x', text: '×' });
    close.onclick = () => { this._calPanelOpen = false; this.render(); };
    if (!this.calendars.length) { panel.createDiv({ cls: 'nx-cp-calpanel-empty', text: 'No calendars yet.' }); return; }
    const hidden = new Set(this.plugin.settings.tasksCalendar.hiddenCalendars || []);
    this.calendars.forEach(c => {
      const row = panel.createDiv('nx-cp-calrow');
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = !hidden.has(calKey(c));
      const dot = row.createSpan('nx-cp-caldot'); if (c.color) dot.style.background = c.color;
      row.createSpan({ cls: 'nx-cp-calname', text: c.display });
      const toggle = async () => {
        const h = new Set(this.plugin.settings.tasksCalendar.hiddenCalendars || []);
        if (cb.checked) h.delete(calKey(c)); else h.add(calKey(c));
        this.plugin.settings.tasksCalendar.hiddenCalendars = Array.from(h);
        await this.plugin.saveSettings();
        this.render();
      };
      cb.onchange = () => { toggle(); };
      row.onclick = (e) => { if (e.target !== cb) { cb.checked = !cb.checked; toggle(); } };
    });
  }

  /* Only reachable with no local calendar AND no task carrying a due date:
     loadCalendars() returns an entry for every configured calendar, empty file
     or not, and _loadDueTasks() adds one more when any task has a due date. */
  _emptyHint(inner) {
    const s = this.plugin.settings.tasksCalendar;
    const box = inner.createDiv('nx-cp-empty-hint');
    box.createDiv({ cls: 'nx-cp-empty-msg', text: s.enabled
      ? 'No calendars yet. Add a local calendar in settings.'
      : 'The Tasks & Calendar module is off — turn on “Enabled” in settings.' });
    box.createEl('button', { cls: 'nx-cp-btn nx-cp-primary', text: 'Open settings' }).onclick = () => {
      try { this.app.setting.open(); this.app.setting.openTabById('nexus-suite'); } catch (e) {}
    };
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
    today.onclick = () => { this.cursor = moment().startOf('day'); this.repaint(); };
    nb('chevron-right', () => this.step(1), 'Next');

    // view switch
    const seg = head.createDiv('nx-cp-seg');
    [['month', 'Month'], ['week', 'Week'], ['day', 'Day']].forEach(([m, lbl]) => {
      const b = seg.createEl('button', { cls: 'nx-cp-segbtn' + (this.mode === m ? ' is-active' : ''), text: lbl });
      b.onclick = () => { this.mode = m; this.repaint(); };
    });

    // actions
    const act = head.createDiv('nx-cp-actions');
    const calsBtn = act.createEl('button', { cls: 'nx-cp-btn' + (this._calPanelOpen ? ' is-active' : ''), attr: { 'aria-label': 'Calendars' } });
    setIcon(calsBtn, 'list-checks');
    calsBtn.onclick = () => { this._calPanelOpen = !this._calPanelOpen; this.render(); };
    const add = act.createEl('button', { cls: 'nx-cp-btn nx-cp-primary', attr: { 'aria-label': 'New event' } });
    setIcon(add, 'plus'); add.createSpan({ text: ' Event' });
    add.onclick = () => this._newEvent();
    // Tasks only — the calendars themselves are local. It still belongs here:
    // a synced task with a due date shows up on this page as a chip.
    const sync = act.createEl('button', { cls: 'nx-cp-btn', attr: { 'aria-label': 'Sync tasks now' } });
    setIcon(sync, 'refresh-cw');
    sync.onclick = async () => { sync.addClass('is-spinning'); await this.plugin.syncTaskCal(); sync.removeClass('is-spinning'); this.reload(); };
  }

  _newEvent() {
    if (!this.calendars.length) { new Notice('Add a local calendar first (Settings → ' + NX_MODULES.tasksCalendar.name + ').'); return; }
    new NexusEventModal(this.plugin, { start: { dt: this.cursor.format('YYYY-MM-DD') + 'T09:00:00', utc: false, tzid: null } }, () => this.reload(), this.calendars, null).open();
  }

  _openEvent(occ) {
    new NexusEventModal(this.plugin, occ.event, () => this.reload(), this.calendars, occ.cal).open();
  }

  _chip(parent, occ) {
    const ev = occ.event;
    const chip = parent.createDiv('nx-cp-chip' + (occ.allDay ? ' is-allday' : '') + (ev.isTask ? ' is-task' : '') + (ev.isTask && ev.done ? ' is-done' : ''));
    if (occ.color) chip.style.setProperty('--chip', occ.color);
    if (ev.isTask) chip.createSpan({ cls: 'nx-cp-chip-check', text: ev.done ? '☑' : '☐' });
    else if (!occ.allDay) chip.createSpan({ cls: 'nx-cp-chip-time', text: occ.start.format('H:mm') });
    chip.createSpan({ cls: 'nx-cp-chip-text', text: ev.summary });
    chip.onclick = (e) => { e.stopPropagation(); if (ev.isTask) this._openTask(ev); else this._openEvent(occ); };
    return chip;
  }

  _dayEvents(occs, dayStart) {
    const de = dayStart.clone().endOf('day');
    return occs.filter(o => o.start.isSameOrBefore(de) && o.end.isAfter(dayStart));
  }

  /* ── MONTH ── */
  _month(inner, occs) {
    const { format, folder } = getDailyNoteSettings(this.app);
    const dowrow = inner.createDiv('nx-cp-dowrow');
    nxWeekdayLabels(this.plugin).forEach(d => dowrow.createDiv({ cls: 'nx-cp-dow', text: d }));
    const grid = inner.createDiv('nx-cp-month');
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
      this._planLine(cell, d.format('YYYY-MM-DD'));

      const wrap = cell.createDiv('nx-cp-events');
      const list = this._dayEvents(occs, d);
      list.slice(0, MAX_CHIPS).forEach(o => this._chip(wrap, o));
      if (list.length > MAX_CHIPS) wrap.createDiv({ cls: 'nx-cp-more', text: '+' + (list.length - MAX_CHIPS) });
      cell.onclick = () => openDailyNote(this.app, d);
      day.add(1, 'day');
    }
  }

  /* ── the planner's line for a day ──────────────────────────────────────────
     Under the day number and ABOVE the chips: the line says what the day is
     for, the chips say what is in it, and a cell clips from the bottom, so
     below them a busy day would hide the sentence worth reading. The row is
     there empty or not, so no cell changes shape when a line is added. */
  _planLine(cell, iso) {
    if (!this.plannerOn) return;
    const line = this.plannerLines[iso] || '';
    const row = cell.createDiv({ cls: 'nx-cp-plan' + (line ? '' : ' is-empty'),
      attr: { role: 'button', tabindex: '0',
        'aria-label': (line ? 'Edit' : 'Write') + ' the planner line for ' + iso } });
    row.setText(line || 'Plan…');
    const edit = (e) => { e.preventDefault(); e.stopPropagation(); this._editPlan(row, iso, line); };
    row.onclick = edit;
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') edit(e); };
  }

  _editPlan(row, iso, line, prefill) {
    if (row.hasClass('is-editing')) return;
    row.addClass('is-editing');
    row.empty();
    const input = row.createEl('input', { cls: 'nx-cp-plan-input',
      attr: { type: 'text', placeholder: 'One line for this day', 'aria-label': 'The one line for ' + iso } });
    input.value = prefill != null ? prefill : line;
    input.onclick = (e) => e.stopPropagation();
    this.editingPlan = iso;
    let closed = false;
    const close = (save) => {
      if (closed) return;
      closed = true;
      this.editingPlan = null;
      // A repaint removes the input and the browser fires blur synchronously on
      // removal, so without this a background refresh would commit a half-typed
      // line as if the field had been left.
      if (this._repainting) return;
      if (save && input.value.trim() !== line) { this._savePlan(iso, input.value, row, line); return; }
      // Nothing changed, so put the row back instead of rebuilding the month:
      // blur fires before the click that caused it lands, and a full render
      // would destroy the element that click is still travelling to.
      row.removeClass('is-editing');
      row.toggleClass('is-empty', !line);
      row.setText(line || 'Plan…');   // setText replaces the input with the text
    };
    input.onblur = () => close(true);
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      // Escape puts back what was there, which is what every text field does.
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    };
    input.focus();
    input.select();
  }

  async _savePlan(iso, text, row, previous) {
    const res = await planner.writeMonthEntry(this.app, TFile, this.plannerStore,
      planner.monthOf(iso), iso, text);
    if (!res.ok) {
      new Notice('Nexus: ' + res.reason + ' — the line was not saved.');
      // Hand the text back rather than repainting it away: it is the only copy.
      if (row && row.isConnected) { row.removeClass('is-editing'); this._editPlan(row, iso, previous || '', text); }
      return;
    }
    // One store, two surfaces: the block in the note re-renders itself when the
    // file changes, the sidebar month and this page have to be told.
    if (typeof this.plugin.refreshCalendarViews === 'function') this.plugin.refreshCalendarViews();
    else { await this.loadPlanner(); this.render(); }
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
