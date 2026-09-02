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

const blockedit = require('./blockedit.js');

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
  const cfg = { view: 'month', month: '', anchor: '', title: '', weekStart: 'monday', entries: {}, extra: [], given: {} };
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
    else if (key === 'month') { cfg.month = value; cfg.given.month = true; }
    else if (key === 'week' || key === 'anchor') { cfg.anchor = value; cfg.given.week = true; }
    else if (key === 'title') cfg.title = value;
    else if (key === 'weekstart') cfg.weekStart = value.toLowerCase() === 'sunday' ? 'sunday' : 'monday';
    else cfg.extra.push(line);
  }
  return cfg;
}

function stringifyPlanner(cfg) {
  const out = [];
  out.push('view: ' + (cfg.view === 'week' ? 'week' : 'month'));
  // The key the current view does NOT use is written back when the source had
  // it: dropping it would eat the position the user is not looking at, and the
  // month/week button relies on finding it again.
  const given = cfg.given || {};
  if (cfg.month && (cfg.view !== 'week' || given.month)) out.push('month: ' + cfg.month);
  if (cfg.anchor && (cfg.view === 'week' || given.week)) out.push('week: ' + cfg.anchor);
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

/* ── Where a month lives ────────────────────────────────────────────────────
   A month resolves to ONE note — a folder plus a file-name pattern, both from
   the settings — so the calendar and the ```nexus-planner``` block are two
   views of one file instead of two stores that can disagree.

   Only month-level tokens are substituted. Anything else is left as typed, so
   `YYYY-MM-DD` names every month `…-DD` — the settings tab prints the resolved
   path under the field, which is where such a pattern is meant to be caught. */
const MONTHS_SHORT = MONTHS.map(name => name.slice(0, 3));
const RE_MONTH_TOKEN = /YYYY|YY|MMMM|MMM|MM/g;

function formatMonthName(pattern, month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  const idx = +m[2] - 1;
  if (idx < 0 || idx > 11) return '';
  return String(pattern || 'YYYY-MM').replace(RE_MONTH_TOKEN, (tok) => {
    if (tok === 'YYYY') return m[1];
    if (tok === 'YY') return m[1].slice(2);
    if (tok === 'MMMM') return MONTHS[idx];
    if (tok === 'MMM') return MONTHS_SHORT[idx];
    return m[2];
  });
}

/* `store` is { folder, pattern }. An empty folder means the vault root and is a
   real choice, so no default is filled in here — that lives in the settings.
   Folder and pattern are joined as segments, so a stray or doubled slash on
   either cannot resolve to `Planner//x.md` or to a folder plus `.md`. */
function monthNotePath(store, month) {
  const segments = (str) => String(str || '').split('/').map(s => s.trim()).filter(Boolean);
  const name = segments(formatMonthName((store && store.pattern) || 'YYYY-MM', month));
  if (!name.length) return '';
  return segments(store && store.folder).concat(name).join('/') + '.md';
}

/* A month grid shows days of up to three months, so this is what has to be read
   for one. Bounded as well as compared: past year 9999 addMonths returns a
   five-digit year, which sorts BEFORE the end and would loop forever. */
function monthsInRange(startIso, endIso) {
  const first = monthOf(startIso), last = monthOf(endIso);
  if (!/^\d{4}-\d{2}$/.test(first) || !/^\d{4}-\d{2}$/.test(last)) return [];
  const out = [];
  for (let m = first; m <= last; ) {
    out.push(m);
    const next = addMonths(m, 1);
    if (next <= m) break;
    m = next;
  }
  return out;
}

/* The FIRST nexus-planner block in a note is the month's plan. A second one is
   left alone: a note is allowed to show the same month twice, and guessing
   which of them is "the" plan is worse than always answering the same way. */
function findPlannerBlock(text) {
  const lines = String(text == null ? '' : text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().indexOf('```nexus-planner') !== 0) continue;
    let end = i + 1;
    while (end < lines.length && lines[end].trim().indexOf('```') !== 0) end++;
    return { start: i, end, body: lines.slice(i + 1, end).join('\n') };
  }
  return null;
}
function fencePlanner(body) { return '```nexus-planner\n' + body + '\n```'; }

/* ── The month store ────────────────────────────────────────────────────────
   Reading never writes. A missing note is an empty month, and so is a note that
   holds no planner block — that note is someone else's. */
async function readMonthPlan(app, TFile, store, month) {
  const path = monthNotePath(store, month);
  const file = path ? app.vault.getAbstractFileByPath(path) : null;
  if (!(file instanceof TFile)) return { path, entries: {} };
  const at = findPlannerBlock(await app.vault.read(file));
  return { path, entries: at ? parsePlanner(at.body).entries : {} };
}

/* A month's note only speaks for its own days: the calendar has to read exactly
   where it writes, or a line typed into the wrong month's note would show in
   one place and be written back to another. */
async function readMonthPlans(app, TFile, store, months) {
  const out = {};
  for (const month of months || []) {
    const plan = await readMonthPlan(app, TFile, store, month);
    for (const date of Object.keys(plan.entries)) {
      if (monthOf(date) === month) out[date] = plan.entries[date];
    }
  }
  return out;
}

async function ensureParentFolder(app, path) {
  const parts = String(path || '').split('/');
  parts.pop();
  let dir = '';
  for (const part of parts) {
    dir = dir ? dir + '/' + part : part;
    if (app.vault.getAbstractFileByPath(dir)) continue;
    // A folder that appeared in between (another write, a sync) is not an error.
    try { await app.vault.createFolder(dir); } catch (e) {}
  }
}

/* Write one day's line into its month's note. The note — and the block — are
   created here and nowhere else, so reading a month never leaves a file behind.
   Clearing the last line of a month that has no note is therefore a no-op. */
async function writeMonthEntry(app, TFile, store, month, date, text) {
  const path = monthNotePath(store, month);
  if (!path) return { ok: false, reason: 'this month has no note path' };
  const clean = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').trim();
  const fresh = () => {
    const cfg = parsePlanner(plannerTemplate(month + '-01'));
    setEntry(cfg, date, clean);
    return fencePlanner(stringifyPlanner(cfg));
  };

  let file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    if (!clean) return { ok: true, path, changed: false };
    await ensureParentFolder(app, path);
    try { file = await app.vault.create(path, fresh() + '\n'); }
    catch (e) { return { ok: false, reason: 'the month note could not be created at ' + path }; }
    return { ok: true, path, changed: true, created: 'note' };
  }

  const raw = await app.vault.read(file);
  const at = findPlannerBlock(raw);
  if (!at) {
    if (!clean) return { ok: true, path, changed: false };
    // The note exists but is not a plan yet. Appending leaves every line the
    // user already typed exactly where it is; rewriting the note would not.
    const gap = !raw ? '' : (/\n\n$/.test(raw) ? '' : /\n$/.test(raw) ? '\n' : '\n\n');
    await app.vault.modify(file, raw + gap + fresh() + '\n');
    return { ok: true, path, changed: true, created: 'block' };
  }

  const cfg = parsePlanner(at.body);
  if (!cfg.month && cfg.view !== 'week') cfg.month = month;
  setEntry(cfg, date, clean);
  const next = stringifyPlanner(cfg);
  if (next === at.body) return { ok: true, path, changed: false };
  // Through blockedit, the same path the rendered block itself saves by: it
  // locates the fence by the body we just read, which is the first block.
  const res = await blockedit.saveFencedBlock(app, TFile, {}, { sourcePath: path },
    'nexus-planner', next, at.body);
  return res.ok ? { ok: true, path, changed: true } : res;
}

module.exports = {
  RE_ENTRY, WEEKDAYS_MON, WEEKDAYS_SUN, MONTHS, MONTH_ROWS,
  toDate, toIso, addDays, monthOf, monthLabel, addMonths,
  weekdayIndex, startOfWeek, monthGrid, weekDays,
  parsePlanner, stringifyPlanner, setEntry, plannerTemplate,
  formatMonthName, monthNotePath, monthsInRange, findPlannerBlock, fencePlanner,
  readMonthPlan, readMonthPlans, writeMonthEntry,
};
