'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · the habit tracker
 *  The habit card: values from daily notes, a month or a year as a heatmap,
 *  the streak. Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { moment, setIcon } = require('obsidian');
const { NexusHabitConfigModal } = require('../../modals/cards.js');
const { getDailyNoteSettings } = require('../../lib/helpers.js');

class HomeHabit {

  /* ---- Habit tracker (GitHub-style heatmap over daily notes) ---- */
  /* Resolve the daily-note folder/format: per-card override, else the vault's
     Daily Notes setting (same source the journal streak uses). */
  _habitCfg(item) {
    const dn = getDailyNoteSettings(this.app);
    const folder = (item.folder && String(item.folder).trim())
      ? String(item.folder).trim().replace(/^\/|\/$/g, '') : (dn.folder || '');
    const format = (item.format && String(item.format).trim()) || dn.format;
    return { folder, format };
  }
  _habitFile(item, m, cfg) {
    const path = (cfg.folder ? cfg.folder + '/' : '') + m.format(cfg.format) + '.md';
    return this.app.vault.getAbstractFileByPath(path);
  }
  /* Read the tracked value for a date. null = no note / no value. */
  _habitVal(item, file) {
    if (!file || !file.stat) return null;                 // folder, not a file
    const v = this._fm(file)[item.prop];
    if (v == null || v === '') return null;
    if (item.mode === 'checkbox') {
      if (v === true) return 1;
      if (v === false) return 0;
      const s = String(v).trim().toLowerCase();
      return ['true', 'yes', 'y', 'x', 'done', '1', '✓', 'ja'].includes(s) ? 1 : 0;
    }
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  /* Map a value to a shade level: -1 no data · 0 none · 1 low · 2 med · 3 high · 4 above high */
  _habitLevel(item, val) {
    if (val == null) return -1;
    if (item.mode === 'checkbox') return val > 0 ? 4 : 0;
    if (val <= 0) return 0;
    const low = Number(item.low), med = Number(item.medium), high = Number(item.high);
    const l = isNaN(low) ? 1 : low, m = isNaN(med) ? 2 : med, h = isNaN(high) ? 3 : high;
    if (val < l) return 1;
    if (val < m) return 2;
    if (val < h) return 3;
    return 4;
  }
  _ratioLevel(r) { return r <= 0 ? 0 : r < 0.25 ? 1 : r < 0.5 ? 2 : r < 0.75 ? 3 : 4; }
  _fmtNum(n) { return (Math.round(n * 10) / 10).toString(); }
  /* Paint one heatmap cell with a shade of the chosen colour. */
  _habitCell(parent, item, lvl, label) {
    const cell = parent.createDiv('nx-habit-cell is-l' + (lvl < 0 ? 'x' : lvl));
    if (lvl > 0) {
      const pct = [0, 28, 50, 74, 100][lvl];
      cell.style.background = 'color-mix(in srgb, var(--habit-color) ' + pct + '%, var(--habit-track))';
    }
    if (label) { cell.setAttribute('aria-label', label); cell.setAttribute('title', label); }
    return cell;
  }
  _wHabit(card, item) {
    card.addClass('nx-home-habit');
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || 'flame');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Habit' });
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusHabitConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-habit-body');
    if (!item.prop) { this._empty(body, 'Set a frontmatter property in settings.'); return; }
    card.style.setProperty('--habit-color', (item.color && String(item.color).trim()) || 'var(--nx-accent, var(--interactive-accent))');
    const cfg = this._habitCfg(item);
    const period = item.period || 'month';
    const scroll = body.createDiv('nx-habit-scroll');
    if (period === 'year') this._habitYear(scroll, item, cfg);
    else this._habitCal(scroll, item, cfg, period);
    this._habitLegend(body, item);
  }
  /* week / month / quartal → weekday calendar (7 columns, fills the card width).
     Cells flow Mon→Sun, leading blanks align the first day to its weekday. */
  _habitCal(parent, item, cfg, period) {
    const today = moment();
    const start = period === 'week' ? today.clone().startOf('isoWeek')
      : today.clone().startOf(period === 'quartal' ? 'quarter' : 'month');
    const end = period === 'week' ? today.clone().endOf('isoWeek')
      : today.clone().endOf(period === 'quartal' ? 'quarter' : 'month');
    const cal = parent.createDiv('nx-habit-cal');
    // Row count (weeks + the weekday header) drives the grid's size in CSS:
    // width = min(all available width, what the height allows at 7:rows). Keeps
    // the cells square and fills the card in whichever direction is tighter.
    const leading = start.isoWeekday() - 1;
    const rows = Math.ceil((leading + end.diff(start, 'days') + 1) / 7);
    cal.style.setProperty('--habit-rows', String(rows + 1));
    // weekday header (Mon-based, localised)
    const wd = today.clone().startOf('isoWeek');
    for (let i = 0; i < 7; i++) cal.createDiv({ cls: 'nx-habit-hd', text: wd.clone().add(i, 'days').format('dd') });
    for (let i = 1; i < start.isoWeekday(); i++) cal.createDiv('nx-habit-cell is-ph');   // leading blanks
    const m = start.clone();
    while (m.isSameOrBefore(end, 'day')) {
      if (m.isAfter(today, 'day')) {   // upcoming day of the period → shown, but empty
        const fc = cal.createDiv('nx-habit-cell is-future');
        const lbl = m.format('ddd, D. MMM'); fc.setAttribute('aria-label', lbl); fc.setAttribute('title', lbl);
        m.add(1, 'day'); continue;
      }
      const md = m.clone();
      const val = this._habitVal(item, this._habitFile(item, md, cfg));
      const cell = this._habitCell(cal, item, this._habitLevel(item, val), this._habitLabel(item, md, val));
      cell.onclick = () => { const f = this._habitFile(item, md, cfg); if (f && f.stat) this._open(f); };
      m.add(1, 'day');
    }
  }
  /* year: 12 month boxes, shaded by the monthly average (Ø of days with a value;
     for checkboxes: share of days done). */
  _habitYear(parent, item, cfg) {
    const year = moment().year(), today = moment();
    const wrap = parent.createDiv('nx-habit-year');
    for (let mo = 0; mo < 12; mo++) {
      const start = moment({ year, month: mo, date: 1 });
      const days = start.daysInMonth();
      let sum = 0, cnt = 0, done = 0;
      for (let d = 1; d <= days; d++) {
        const m = moment({ year, month: mo, date: d });
        if (m.isAfter(today, 'day')) break;
        const val = this._habitVal(item, this._habitFile(item, m, cfg));
        if (val != null) { sum += val; cnt++; if (val > 0) done++; }
      }
      let lvl, disp;
      if (item.mode === 'checkbox') {
        const ratio = done / days;
        lvl = done === 0 ? -1 : this._ratioLevel(ratio);
        disp = Math.round(ratio * 100) + '%';
      } else if (cnt === 0) { lvl = -1; disp = '–'; }
      else { const avg = sum / cnt; lvl = this._habitLevel(item, avg); disp = this._fmtNum(avg); }
      const box = wrap.createDiv('nx-habit-ycell');
      this._habitCell(box, item, lvl, start.format('MMMM YYYY') + ' · ' + disp);
      box.createDiv({ cls: 'nx-habit-ymo', text: start.format('MMM') });
      box.createDiv({ cls: 'nx-habit-yval', text: lvl < 0 ? '' : disp });
    }
  }
  /* Small GitHub-style legend under the heatmap. */
  _habitLegend(parent, item) {
    const leg = parent.createDiv('nx-habit-legend');
    if (item.mode === 'checkbox') {
      const it = (lvl, txt) => { const s = leg.createDiv('nx-habit-legend-item'); this._legendSwatch(s, lvl); s.createSpan({ text: txt }); };
      it(0, 'offen'); it(4, 'erledigt');
    } else {
      leg.createSpan({ cls: 'nx-habit-legend-cap', text: 'weniger' });
      for (let l = 0; l <= 4; l++) this._legendSwatch(leg, l);
      leg.createSpan({ cls: 'nx-habit-legend-cap', text: 'mehr' });
    }
  }
  _legendSwatch(parent, lvl) {
    const sw = parent.createDiv('nx-habit-cell nx-habit-swatch is-l' + (lvl < 0 ? 'x' : lvl));
    if (lvl > 0) { const pct = [0, 28, 50, 74, 100][lvl]; sw.style.background = 'color-mix(in srgb, var(--habit-color) ' + pct + '%, var(--habit-track))'; }
    return sw;
  }
  _habitLabel(item, m, val) {
    const d = m.format('ddd, D. MMM');
    if (val == null) return d + ' · no note';
    if (item.mode === 'checkbox') return d + ' · ' + (val > 0 ? 'done' : '—');
    return d + ' · ' + this._fmtNum(val);
  }

  /* Journal streak: consecutive days backwards with a daily note.
     Today may still be missing (the streak holds during the day until you write). */
  _streak(folderOverride, formatOverride) {
    const dn = getDailyNoteSettings(this.app);
    const folder = (folderOverride != null && String(folderOverride).trim() !== '')
      ? String(folderOverride).trim().replace(/\/$/, '') : dn.folder;
    const format = (formatOverride && String(formatOverride).trim()) || dn.format;
    const has = (m) => !!this.app.vault.getAbstractFileByPath((folder ? folder + '/' : '') + m.format(format) + '.md');
    const d = moment();
    if (!has(d)) d.subtract(1, 'day');
    let n = 0;
    while (has(d)) { n++; d.subtract(1, 'day'); }
    return n;
  }
}

module.exports = HomeHabit;
