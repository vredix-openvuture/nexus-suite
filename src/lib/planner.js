'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the paper planner
 *  A month on one screen with ONE line per day, the way a paper calendar works.
 *
 *  It is deliberately not the tasks module and not the agenda. Those answer
 *  "what is due"; this answers "what is this month FOR", which is a different
 *  question and a much shorter answer. Daily and weekly notes stay where the
 *  detail goes — the planner exists so that the shape of a month is visible
 *  without opening thirty of them.
 *
 *  Like the kanban board, the block IS the data: one line per day inside the
 *  fence, so the plan survives without the plugin and travels with the note.
 *
 *      view: month
 *      month: 2026-09
 *      2026-09-03: Ship 0.25
 *      2026-09-11: Dentist, 14:00
 * ========================================================================== */

const RE_ENTRY = /^\s*(\d{4}-\d{2}-\d{2})\s*:\s?(.*)$/;
const RE_CONFIG = /^\s*([a-z][a-z-]*)\s*:\s?(.*)$/i;

const WEEKDAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* ── Dates ──────────────────────────────────────────────────────────────────
   All arithmetic is done in UTC on plain YYYY-MM-DD strings. A planner cell is
   a calendar day, not an instant, and doing this in local time is how a grid
   ends up off by one for anyone east of Greenwich in summer. */
function toDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function toIso(date) {
  return date.getUTCFullYear() + '-'
    + String(date.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(date.getUTCDate()).padStart(2, '0');
}
function addDays(iso, n) {
  const d = toDate(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
function monthOf(iso) { return String(iso || '').slice(0, 7); }
function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return String(month || '');
  return MONTHS[+m[2] - 1] + ' ' + m[1];
}
function addMonths(month, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return month;
  const total = (+m[1]) * 12 + (+m[2] - 1) + n;
  return Math.floor(total / 12) + '-' + String((total % 12) + 1).padStart(2, '0');
}
function weekdayIndex(iso, weekStart) {
  const d = toDate(iso);
  if (!d) return 0;
  const day = d.getUTCDay();               // 0 = Sunday
  return weekStart === 'sunday' ? day : (day + 6) % 7;
}
function startOfWeek(iso, weekStart) { return addDays(iso, -weekdayIndex(iso, weekStart)); }

/* Six rows always. A month that fits in five would otherwise make the whole
   block change height as you page through the year, and the jump reads as a
   bug every single time. */
const MONTH_ROWS = 6;

function monthGrid(month, weekStart) {
  const first = month + '-01';
  if (!toDate(first)) return [];
  let cursor = startOfWeek(first, weekStart);
  const weeks = [];
  for (let w = 0; w < MONTH_ROWS; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      days.push({ date: cursor, inMonth: monthOf(cursor) === month, day: +cursor.slice(8) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(days);
  }
  return weeks;
}
function weekDays(anchor, weekStart) {
  const start = startOfWeek(anchor, weekStart);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    out.push({ date, inMonth: true, day: +date.slice(8) });
  }
  return out;
}

/* ── The block ──────────────────────────────────────────────────────────────
   Anything the parser does not understand is kept and written back untouched,
   so a rewrite can never eat a line someone typed. */
function parsePlanner(src) {
  const cfg = { view: 'month', month: '', anchor: '', title: '', weekStart: 'monday', entries: {}, extra: [] };
  for (const line of String(src || '').split('\n')) {
    if (!line.trim()) continue;
    const entry = RE_ENTRY.exec(line);
    if (entry) {
      const text = entry[2].trim();
      if (text) cfg.entries[entry[1]] = text;
      continue;
    }
    const conf = RE_CONFIG.exec(line);
    if (!conf) { cfg.extra.push(line); continue; }
    const key = conf[1].toLowerCase(), value = conf[2].trim();
    if (key === 'view') cfg.view = value.toLowerCase() === 'week' ? 'week' : 'month';
    else if (key === 'month') cfg.month = value;
    else if (key === 'week' || key === 'anchor') cfg.anchor = value;
    else if (key === 'title') cfg.title = value;
    else if (key === 'weekstart') cfg.weekStart = value.toLowerCase() === 'sunday' ? 'sunday' : 'monday';
    else cfg.extra.push(line);
  }
  return cfg;
}

function stringifyPlanner(cfg) {
  const out = [];
  out.push('view: ' + (cfg.view === 'week' ? 'week' : 'month'));
  if (cfg.view === 'week') { if (cfg.anchor) out.push('week: ' + cfg.anchor); }
  else if (cfg.month) out.push('month: ' + cfg.month);
  if (cfg.title) out.push('title: ' + cfg.title);
  if (cfg.weekStart === 'sunday') out.push('weekstart: sunday');
  for (const line of cfg.extra) out.push(line);
  // Sorted, so the block reads as a calendar and a diff shows what changed
  // rather than where a line happened to be appended.
  for (const date of Object.keys(cfg.entries).sort()) {
    const text = String(cfg.entries[date] || '').trim();
    if (text) out.push(date + ': ' + text);
  }
  return out.join('\n');
}

/* One line per day, and an empty one removes it rather than storing a blank. */
function setEntry(cfg, date, text) {
  const clean = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').trim();
  if (clean) cfg.entries[date] = clean; else delete cfg.entries[date];
  return cfg;
}

/* What the block should say when it is first inserted: this month, empty. */
function plannerTemplate(today) {
  return 'view: month\nmonth: ' + monthOf(today);
}

module.exports = {
  RE_ENTRY, WEEKDAYS_MON, WEEKDAYS_SUN, MONTHS, MONTH_ROWS,
  toDate, toIso, addDays, monthOf, monthLabel, addMonths,
  weekdayIndex, startOfWeek, monthGrid, weekDays,
  parsePlanner, stringifyPlanner, setEntry, plannerTemplate,
};
