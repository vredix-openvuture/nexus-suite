'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · calendar
 *  Sidebar month-grid calendar.
 * ========================================================================== */

const { ItemView, moment } = require('obsidian');
const { CAL_VIEW } = require('../constants.js');
const { getDailyNoteSettings, openDailyNote } = require('../lib/helpers.js');

class NexusCalendarView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.cursor = moment().startOf('month'); }
  getViewType() { return CAL_VIEW; }
  getDisplayText() { return 'Calendar'; }
  getIcon() { return 'calendar'; }
  async onOpen() { this.render(); }

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
    const dows = moment.weekdaysMin(true); // localized short names, respecting week start
    dows.forEach(d => grid.createDiv({ cls: 'nx-cal-dow', text: d }));

    const start = this.cursor.clone().startOf('month').startOf('week');
    const end = this.cursor.clone().endOf('month').endOf('week');
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
      day.add(1, 'day');
    }
  }
}

module.exports = { NexusCalendarView };
