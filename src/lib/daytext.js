'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the day's text
 *  What a day is FOR, written in the calendar and kept in that day's own note.
 *
 *  It lives in the daily note's FRONTMATTER, under a key you choose (default
 *  `important`). That is the whole point: the calendar is a way to write it and
 *  to see a month of it at once, but the text belongs to the note, is findable
 *  by Obsidian's own search, survives without this plugin, and is one field a
 *  Dataview query or a template can read.
 *
 *  Writing to a day that has no note yet creates one, from the daily-note
 *  template if you have one — the same thing clicking the day number does.
 * ========================================================================== */

const { getDailyNoteSettings, ensureDailyNote } = require('./helpers.js');

const DEFAULT_KEY = 'important';

function dayTextKey(plugin) {
  const s = (plugin && plugin.settings && plugin.settings.tasksCalendar) || {};
  const key = String(s.dayTextKey == null ? DEFAULT_KEY : s.dayTextKey).trim();
  return key || DEFAULT_KEY;
}

function dailyNotePath(app, date) {
  const { format, folder } = getDailyNoteSettings(app);
  return (folder ? folder + '/' : '') + date.format(format) + '.md';
}

function dailyNoteFor(app, date) {
  return app.vault.getAbstractFileByPath(dailyNotePath(app, date)) || null;
}

/* Frontmatter can hold a number or a date as well as a string — a day whose
   text is "2026" would come back as a number and blow up on .trim(). */
function asText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join('\n');
  return String(value);
}

function readDayText(app, plugin, date) {
  const file = dailyNoteFor(app, date);
  if (!file) return '';
  const fm = (app.metadataCache.getFileCache(file) || {}).frontmatter || {};
  return asText(fm[dayTextKey(plugin)]);
}

/* Every day in the range that has a text, as { 'YYYY-MM-DD': text }. One pass
   over the range rather than one file lookup per cell while rendering. */
function readRange(app, plugin, start, end) {
  const out = {};
  const day = start.clone();
  while (day.isSameOrBefore(end, 'day')) {
    const text = readDayText(app, plugin, day);
    if (text) out[day.format('YYYY-MM-DD')] = text;
    day.add(1, 'day');
  }
  return out;
}

/* Empty text REMOVES the key instead of leaving `important: ""` behind — an
   empty field is noise in every note that ever had a day text. */
async function writeDayText(app, plugin, date, text) {
  const key = dayTextKey(plugin);
  const value = String(text == null ? '' : text).trim();
  const existing = dailyNoteFor(app, date);
  if (!value && !existing) return { ok: true };          // nothing to write, nothing to make
  try {
    const file = existing || await ensureDailyNote(app, date);
    await app.fileManager.processFrontMatter(file, fm => {
      if (value) fm[key] = value; else delete fm[key];
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'the note could not be written' };
  }
}

module.exports = { DEFAULT_KEY, dayTextKey, dailyNotePath, dailyNoteFor, readDayText, readRange, writeDayText };
