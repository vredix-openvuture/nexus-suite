'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · RRULE expansion (RFC 5545 subset)
 *  expand(event, rangeStart, rangeEnd, moment) → [moment] occurrence starts,
 *  ALWAYS bounded to the visible range so cost is proportional to the screen.
 *
 *  Supported: FREQ DAILY/WEEKLY/MONTHLY/YEARLY · INTERVAL · COUNT · UNTIL ·
 *  BYDAY (incl. ordinals) · BYMONTHDAY (incl. negatives) · BYMONTH · EXDATE.
 *  Ported from velumeron's caldav-client.py; hard occurrence cap guards against
 *  malformed rules. Not covered (→ Milestone 6): BYSETPOS, BYYEARDAY, BYWEEKNO,
 *  full VTIMEZONE/DST math.
 * ========================================================================== */

const { parseWhen, whenToMoment } = require('./ical.js');

const MAX_OCCURRENCES = 750;     // per event, within range
const MAX_ITERATIONS  = 20000;   // step guard (a daily rule across ~50y)
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseByDay(tok) {
  const m = String(tok).trim().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i);
  if (!m) return null;
  return { ord: m[1] ? parseInt(m[1], 10) : 0, day: DOW[m[2].toUpperCase()] };
}

function parseRRule(s) {
  const o = { freq: null, interval: 1, count: 0, until: null, wkst: null, byday: [], bymonthday: [], bymonth: [] };
  String(s || '').split(';').forEach(part => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    const k = part.slice(0, eq).toUpperCase();
    const v = part.slice(eq + 1);
    if (k === 'FREQ') o.freq = v.toUpperCase();
    else if (k === 'INTERVAL') o.interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === 'COUNT') o.count = parseInt(v, 10) || 0;
    else if (k === 'UNTIL') o.until = v;
    else if (k === 'WKST') o.wkst = v.toUpperCase();
    else if (k === 'BYDAY') o.byday = v.split(',').map(parseByDay).filter(Boolean);
    else if (k === 'BYMONTHDAY') o.bymonthday = v.split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n));
    else if (k === 'BYMONTH') o.bymonth = v.split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n));
  });
  return o;
}

/* keep the wall-clock time of dtstart on a generated calendar date */
function withTime(dateMoment, seed) {
  return dateMoment.clone().hour(seed.hour()).minute(seed.minute()).second(seed.second()).millisecond(0);
}

/* all matching weekdays in cursor's month, filtered by ordinal */
function monthlyByDay(cursor, bd, seed) {
  const first = cursor.clone().startOf('month');
  const daysInMonth = cursor.daysInMonth();
  const hits = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const m = first.clone().date(d);
    if (m.day() === bd.day) hits.push(m);
  }
  let picked;
  if (bd.ord === 0) picked = hits;                       // every such weekday
  else if (bd.ord > 0) picked = hits[bd.ord - 1] ? [hits[bd.ord - 1]] : [];
  else picked = hits[hits.length + bd.ord] ? [hits[hits.length + bd.ord]] : []; // -1 = last
  return picked.map(m => withTime(m, seed));
}

function monthlyByMonthday(cursor, day, seed) {
  const dim = cursor.daysInMonth();
  const dd = day < 0 ? dim + day + 1 : day;              // -1 = last day
  if (dd < 1 || dd > dim) return null;
  return withTime(cursor.clone().date(dd), seed);
}

function exKey(m, allDay) {
  return allDay ? m.format('YYYY-MM-DD') : m.format('YYYY-MM-DDTHH:mm:ss');
}

/* Main entry. Returns occurrence START moments inside [rangeStart, rangeEnd). */
function expand(ev, rangeStart, rangeEnd, moment) {
  const dtstart = whenToMoment(ev.start, moment);
  if (!dtstart || !dtstart.isValid()) return [];
  if (!ev.rrule) return [dtstart.clone()];               // caller decides overlap

  const r = parseRRule(ev.rrule);
  if (!r.freq) return [dtstart.clone()];
  const until = r.until ? whenToMoment(parseWhen({ value: r.until, params: {} }), moment) : null;
  const exset = new Set((ev.exdate || []).map(w => exKey(whenToMoment(w, moment), ev.allDay)));

  const out = [];
  let generated = 0, iter = 0, stop = false;
  const cursor = dtstart.clone();

  const consider = (m) => {
    if (!m || !m.isValid() || m.isBefore(dtstart)) return;
    if (r.bymonth.length && !r.bymonth.includes(m.month() + 1)) return;
    if (until && m.isAfter(until)) { stop = true; return; }
    generated++;
    if (r.count && generated > r.count) { stop = true; return; }
    if (exset.has(exKey(m, ev.allDay))) return;
    if (m.isSameOrAfter(rangeStart) && m.isBefore(rangeEnd)) out.push(m.clone());
  };

  while (!stop && iter++ < MAX_ITERATIONS && out.length < MAX_OCCURRENCES) {
    if (cursor.isAfter(rangeEnd)) break;                  // occurrences are monotonic → done

    let cands = [];
    if (r.freq === 'WEEKLY' && r.byday.length) {
      const wk = cursor.clone().startOf('week');
      for (const bd of r.byday) cands.push(withTime(wk.clone().day(bd.day), dtstart));
    } else if (r.freq === 'MONTHLY') {
      if (r.bymonthday.length) for (const d of r.bymonthday) cands.push(monthlyByMonthday(cursor, d, dtstart));
      else if (r.byday.length) for (const bd of r.byday) cands = cands.concat(monthlyByDay(cursor, bd, dtstart));
      else cands.push(cursor.clone());
    } else if (r.freq === 'YEARLY') {
      cands.push(cursor.clone());
    } else { // DAILY (and WEEKLY without BYDAY)
      cands.push(cursor.clone());
    }

    cands = cands.filter(Boolean).sort((a, b) => a.valueOf() - b.valueOf());
    for (const m of cands) { consider(m); if (stop || out.length >= MAX_OCCURRENCES) break; }

    if (r.freq === 'DAILY') cursor.add(r.interval, 'day');
    else if (r.freq === 'WEEKLY') cursor.add(r.interval, 'week');
    else if (r.freq === 'MONTHLY') cursor.add(r.interval, 'month');
    else if (r.freq === 'YEARLY') cursor.add(r.interval, 'year');
    else break;
  }

  return out;
}

module.exports = { expand, parseRRule };
