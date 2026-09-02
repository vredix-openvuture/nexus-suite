'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · calendar
 *  Sidebar month-grid calendar.
 * ========================================================================== */

const { ItemView, TFile, moment } = require('obsidian');
const { CAL_VIEW, NX_MODULES } = require('../constants.js');
const { getDailyNoteSettings, nxMonthGridRange, nxWeekdayLabels, openDailyNote } = require('../lib/helpers.js');
const planner = require('../lib/planner.js');

class NexusCalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.cursor = moment().startOf('month');
    this.cells = {};                 // date → its cell, so a mark can be applied after the paint
    this.plannerPaths = new Set();
    this._planGen = 0;               // a slow read of an old month must not win
  }
  getViewType() { return CAL_VIEW; }
  getDisplayText() { return NX_MODULES.calendar.name; }
  getIcon() { return 'calendar'; }
  async onOpen() {
    this.render();
    // A planner line written anywhere — the block in the note, the full-page
    // calendar — has to reach the marks here without a reload.
    const touch = (f) => { if (f && f.path && this.plannerPaths.has(f.path)) this.markPlanned(); };
    const vault = this.plugin.app.vault;
    this.registerEvent(vault.on('modify', touch));
    this.registerEvent(vault.on('create', touch));
    this.registerEvent(vault.on('delete', touch));
  }

  render() {
    const app = this.plugin.app;
    const { format, folder } = getDailyNoteSettings(app);
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-cal');
    // Inner wrapper carries the padding — .view-content is neutralized by some themes
    // (Nexus included) with padding:0 !important.
    const inner = root.createDiv('nx-cal-inner');

    const head = inner.createDiv('nx-cal-head');
    const title = head.createDiv('nx-cal-title');
    title.createSpan({ text: this.cursor.format('MMMM') });
    title.createSpan({ cls: 'nx-cal-year', text: this.cursor.format('YYYY') });
    const nav = head.createDiv('nx-cal-nav');
    const mkBtn = (label, fn) => { const b = nav.createEl('button', { text: label }); b.onclick = fn; };
    mkBtn('‹', () => { this.cursor.subtract(1, 'month'); this.render(); });
    mkBtn('•', () => { this.cursor = moment().startOf('month'); this.render(); });
    mkBtn('›', () => { this.cursor.add(1, 'month'); this.render(); });

    const grid = inner.createDiv('nx-cal-grid');
    const cells = {};
    // Column order and grid range both follow the vault's week-start setting.
    nxWeekdayLabels(this.plugin).forEach(d => grid.createDiv({ cls: 'nx-cal-dow', text: d }));

    const [start, end] = nxMonthGridRange(this.cursor, this.plugin);
    const today = moment().format('YYYY-MM-DD');
    const day = start.clone();
    while (day.isSameOrBefore(end)) {
      const cell = grid.createDiv({ cls: 'nx-cal-day', text: day.format('D') });
      if (day.month() !== this.cursor.month()) cell.addClass('nx-adjacent');
      if (day.format('YYYY-MM-DD') === today) cell.addClass('nx-today');
      const path = (folder ? folder + '/' : '') + day.format(format) + '.md';
      if (app.vault.getAbstractFileByPath(path)) cell.addClass('nx-has-note');
      const d = day.clone();
      cell.onclick = () => openDailyNote(app, d);
      cells[day.format('YYYY-MM-DD')] = cell;
      day.add(1, 'day');
    }
    this.cells = cells;
    this.markPlanned();
  }

  /* The planner's line is NOT written out here: a sidebar column is too narrow
     for a sentence and this view's job is navigation. A mark says the day has
     one; the month view and the block are where you read it.
     Applied after the paint, not during it — the grid must not wait on a file
     read to appear. */
  async markPlanned() {
    const gen = ++this._planGen;
    const settings = this.plugin.settings;
    if (settings.planner && settings.planner.enabled === false) { this.plannerPaths = new Set(); return; }
    const store = (settings.tasksCalendar || {}).planner || {};
    const [start, end] = nxMonthGridRange(this.cursor, this.plugin);
    const months = planner.monthsInRange(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));
    const paths = new Set(months.map(m => planner.monthNotePath(store, m)).filter(Boolean));
    let lines = {};
    try { lines = await planner.readMonthPlans(this.plugin.app, TFile, store, months); }
    catch (e) { console.error('[Nexus] planner: could not read ' + months.join(', '), e); return; }
    // Two fast month steps: the older read must not mark the month that left.
    if (gen !== this._planGen) return;
    this.plannerPaths = paths;
    for (const date of Object.keys(this.cells)) this.cells[date].toggleClass('nx-has-plan', !!lines[date]);
  }
}

module.exports = { NexusCalendarView };
