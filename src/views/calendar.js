'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · calendar
 *  Sidebar month-grid calendar.
 * ========================================================================== */

const { ItemView, moment } = require('obsidian');
const { CAL_VIEW, NX_MODULES } = require('../constants.js');
const { getDailyNoteSettings, nxMonthGridRange, nxWeekdayLabels, openDailyNote } = require('../lib/helpers.js');
const daytext = require('../lib/daytext.js');

class NexusCalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.cursor = moment().startOf('month');
    this.cells = {};                 // date → its cell, so a mark can be applied after the paint
  }
  getViewType() { return CAL_VIEW; }
  getDisplayText() { return NX_MODULES.calendar.name; }
  getIcon() { return 'calendar'; }
  async onOpen() {
    this.render();
    /* A day's text is frontmatter, so the METADATA cache is the event to watch:
       'modify' fires before Obsidian has re-parsed the note, and a mark applied
       there would be one keystroke behind. */
    this.registerEvent(this.plugin.app.metadataCache.on('changed', () => this.markDayTexts()));
    this.registerEvent(this.plugin.app.vault.on('delete', () => this.render()));
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
    this.markDayTexts();
  }

}

module.exports = { NexusCalendarView };
