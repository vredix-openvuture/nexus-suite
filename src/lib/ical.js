'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · iCalendar (RFC 5545)
 *  Dependency-free parser + serializer for VEVENT / VTODO. Runs on BOTH
 *  platforms (desktop parses server ICS; mobile re-parses nothing — it reads
 *  the normalized cache — but the same code powers local-calendar editing).
 *
 *  Logic ported/adapted from velumeron's caldav-client.py (the reference
 *  implementation) but reimplemented in JS so the plugin stays self-contained.
 * ========================================================================== */

/* ── Line unfolding: a leading space/tab means "continuation of previous". ── */
function unfold(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if (line === '') continue;
    if ((line[0] === ' ' || line[0] === '\t') && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/* ── Parse one logical line: NAME;PARAM=v;P2="a:b":VALUE ── */
function parseLine(line) {
  // value starts at the first colon that is NOT inside a quoted param value
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  // head = NAME(;PARAM=..)*  — split on unquoted ';'
  const parts = [];
  let cur = '', q = false;
  for (const ch of head) {
    if (ch === '"') { q = !q; cur += ch; }
    else if (ch === ';' && !q) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);
  const name = (parts.shift() || '').toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).toUpperCase();
    let v = p.slice(eq + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[k] = v;
  }
  return { name, params, value };
}

/* ── Unescape a TEXT value ── */
function unescapeText(v) {
  return String(v == null ? '' : v)
    .replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function escapeText(v) {
  return String(v == null ? '' : v)
    .replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/* ── Build the component tree from logical lines. Each component keeps its
 *  props (in order) and child components; top-level VEVENT/VTODO keep `raw`
 *  (the original lines) for lossless re-PUT. ── */
function parse(text) {
  const lines = unfold(text);
  let idx = 0;
  function build(startLine) {
    const type = startLine.value.toUpperCase();
    const comp = { type, props: [], comps: [], raw: null };
    const rawStart = idx - 1;
    while (idx < lines.length) {
      const p = parseLine(lines[idx]);
      idx++;
      if (p.name === 'BEGIN') { comp.comps.push(build(p)); continue; }
      if (p.name === 'END') break;
      comp.props.push(p);
    }
    comp.raw = lines.slice(rawStart, idx).join('\r\n');
    return comp;
  }
  const roots = [];
  while (idx < lines.length) {
    const p = parseLine(lines[idx]);
    idx++;
    if (p.name === 'BEGIN') roots.push(build(p));
  }
  return roots;
}

/* prop lookup helpers */
function getProp(comp, name) { return comp.props.find(p => p.name === name) || null; }
function getVal(comp, name) { const p = getProp(comp, name); return p ? unescapeText(p.value) : ''; }
function getRaw(comp, name) { const p = getProp(comp, name); return p ? p.value : ''; }
function getAll(comp, name) { return comp.props.filter(p => p.name === name); }

/* ── DATE / DATE-TIME parsing → { d } (all-day) or { dt, utc, tzid } ── */
function parseWhen(prop) {
  if (!prop) return null;
  const v = String(prop.value || '').trim();
  const isDate = (prop.params && (prop.params.VALUE === 'DATE')) || /^\d{8}$/.test(v);
  if (isDate) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { d: `${m[1]}-${m[2]}-${m[3]}` };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (!m) return null;
  const dt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return { dt, utc: !!m[7], tzid: (prop.params && prop.params.TZID) || null };
}

/* Convert a parsed when → an obsidian moment (LOCAL). UTC is converted; a bare
 *  TZID is treated as local wall-clock (M1 limitation — no IANA tz database in
 *  obsidian's moment; documented). All-day → local midnight. */
function whenToMoment(when, moment) {
  if (!when) return null;
  if (when.d) return moment(when.d, 'YYYY-MM-DD');
  if (when.utc) return moment.utc(when.dt).local();
  return moment(when.dt, 'YYYY-MM-DDTHH:mm:ss');
}

/* ── Normalize a VEVENT component → flat event object ── */
function normalizeEvent(ve) {
  const start = parseWhen(getProp(ve, 'DTSTART'));
  let end = parseWhen(getProp(ve, 'DTEND'));
  const durProp = getProp(ve, 'DURATION');
  const allDay = !!(start && start.d);
  return {
    uid: getVal(ve, 'UID'),
    summary: getVal(ve, 'SUMMARY') || '(untitled)',
    location: getVal(ve, 'LOCATION'),
    description: getVal(ve, 'DESCRIPTION'),
    status: getVal(ve, 'STATUS').toUpperCase(),
    categories: getVal(ve, 'CATEGORIES') ? getVal(ve, 'CATEGORIES').split(',').map(s => s.trim()).filter(Boolean) : [],
    allDay,
    start, end,
    duration: durProp ? durProp.value : null,
    rrule: getRaw(ve, 'RRULE') || null,
    exdate: getAll(ve, 'EXDATE').map(p => parseWhen(p)).filter(Boolean),
    recurrenceId: parseWhen(getProp(ve, 'RECURRENCE-ID')),
    raw: ve.raw,
  };
}

/* ── Normalize a VTODO component → flat task object (VTODO field map) ── */
function normalizeTodo(vt) {
  const due = parseWhen(getProp(vt, 'DUE'));
  const start = parseWhen(getProp(vt, 'DTSTART'));
  const completed = parseWhen(getProp(vt, 'COMPLETED'));
  const status = getVal(vt, 'STATUS').toUpperCase();
  const prio = parseInt(getVal(vt, 'PRIORITY'), 10);
  const pct = parseInt(getVal(vt, 'PERCENT-COMPLETE'), 10);
  const rel = getProp(vt, 'RELATED-TO');
  return {
    uid: getVal(vt, 'UID'),
    summary: getVal(vt, 'SUMMARY') || '(untitled)',
    description: getVal(vt, 'DESCRIPTION'),
    status: status || 'NEEDS-ACTION',
    completed: status === 'COMPLETED' || !!completed,
    completedAt: completed || null,
    due, start,
    priority: isNaN(prio) ? 0 : prio,
    percent: isNaN(pct) ? 0 : pct,
    rrule: getRaw(vt, 'RRULE') || null,
    parent: rel ? unescapeText(rel.value) : '',
    parentReltype: rel && rel.params ? (rel.params.RELTYPE || 'PARENT') : null,
    sequence: parseInt(getVal(vt, 'SEQUENCE'), 10) || 0,
    raw: vt.raw,
  };
}

/* ── Split a raw ICS blob (one CalDAV resource) into its components ── */
function parseResource(text) {
  const roots = parse(text);
  const out = { vevents: [], vtodos: [], vtimezones: [] };
  const walk = (comps) => {
    for (const c of comps) {
      if (c.type === 'VEVENT') out.vevents.push(normalizeEvent(c));
      else if (c.type === 'VTODO') out.vtodos.push(normalizeTodo(c));
      else if (c.type === 'VTIMEZONE') out.vtimezones.push(c);
      if (c.comps && c.comps.length) walk(c.comps);
    }
  };
  walk(roots);
  return out;
}

/* ── Serializer (for local events → ICS, and re-PUT in M2) ── */
function foldLine(line) {
  // fold at 75 octets (approx by chars — fine for our own ASCII-ish output)
  if (line.length <= 75) return line;
  const chunks = [];
  let s = line;
  chunks.push(s.slice(0, 75));
  s = s.slice(75);
  while (s.length) { chunks.push(' ' + s.slice(0, 74)); s = s.slice(74); }
  return chunks.join('\r\n');
}
function whenProp(name, when) {
  if (!when) return null;
  if (when.d) return `${name};VALUE=DATE:${when.d.replace(/-/g, '')}`;
  const base = when.dt.replace(/[-:]/g, '');
  if (when.utc) return `${name}:${base}Z`;
  if (when.tzid) return `${name};TZID=${when.tzid}:${base}`;
  return `${name}:${base}`;
}
function nowStamp(moment) { return moment.utc().format('YYYYMMDDTHHmmss') + 'Z'; }

function serializeEvent(ev, moment) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nexus Suite//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT'];
  L.push('UID:' + (ev.uid || ('nx-' + Date.now())));
  L.push('DTSTAMP:' + nowStamp(moment));
  const s = whenProp('DTSTART', ev.start); if (s) L.push(s);
  const e = whenProp('DTEND', ev.end); if (e) L.push(e);
  L.push('SUMMARY:' + escapeText(ev.summary || ''));
  if (ev.location) L.push('LOCATION:' + escapeText(ev.location));
  if (ev.description) L.push('DESCRIPTION:' + escapeText(ev.description));
  if (ev.status) L.push('STATUS:' + ev.status);
  if (ev.rrule) L.push('RRULE:' + ev.rrule);
  (ev.exdate || []).forEach(x => { const p = whenProp('EXDATE', x); if (p) L.push(p); });
  L.push('END:VEVENT', 'END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

/* ── Serialize a VTODO (canonical task → ICS) for CalDAV PUT ── */
function serializeTodo(task, moment) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nexus Suite//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VTODO'];
  L.push('UID:' + (task.uid || ('nx-' + Date.now())));
  L.push('DTSTAMP:' + nowStamp(moment));
  L.push('SUMMARY:' + escapeText(task.title || ''));
  if (task.description) L.push('DESCRIPTION:' + escapeText(task.description));
  if (task.due) L.push('DUE;VALUE=DATE:' + String(task.due).slice(0, 10).replace(/-/g, ''));
  L.push('STATUS:' + (task.done ? 'COMPLETED' : 'NEEDS-ACTION'));
  L.push('PERCENT-COMPLETE:' + (task.done ? 100 : 0));
  if (task.priority) L.push('PRIORITY:' + task.priority);
  if (task.repeat) L.push('RRULE:' + task.repeat);
  if (task.done) L.push('COMPLETED:' + nowStamp(moment));
  L.push('SEQUENCE:' + (task.sequence != null ? task.sequence : 0));
  L.push('END:VTODO', 'END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = {
  unfold, parseLine, parse, parseResource,
  normalizeEvent, normalizeTodo,
  parseWhen, whenToMoment,
  escapeText, unescapeText, serializeEvent, serializeTodo, foldLine,
};
