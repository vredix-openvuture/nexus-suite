'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · calendar store
 *  Reads/writes the event cache + local calendars as vault JSON (so Syncthing
 *  carries them to the tablet, which renders WITHOUT any network). Aggregates
 *  events for a visible range by running each cached event through recur.expand.
 *
 *  Layout under the data dir:
 *    calendar/remote/<accountId>/<calendarId>.json   server mirror (desktop-owned)
 *    calendar/local/<calendarId>.json                local calendars (offline)
 *
 *  The data dir defaults to .nexus-calendar INSIDE the plugin folder: it sticks
 *  to the plugin, stays out of the file explorer / search / graph, and survives
 *  updates (BRAT and manual installs only replace main.js, styles.css and
 *  manifest.json). Still syncs, as long as the sync covers .obsidian. Anyone
 *  who deliberately excludes .obsidian from sync can switch it back to a normal
 *  vault folder in the settings.
 * ========================================================================== */

const { moment } = require('obsidian');
const ical = require('./ical.js');
const recur = require('./recur.js');

function pluginDir(plugin) {
  return plugin.app.vault.configDir + '/plugins/' + ((plugin.manifest && plugin.manifest.id) || 'nexus-suite');
}
function dataDir(plugin) {
  const tc = (plugin.settings && plugin.settings.tasksCalendar) || {};
  if ((tc.dataLocation || 'plugin') === 'plugin') return pluginDir(plugin) + '/.nexus-calendar';
  return (tc.dataFolder || '_nexus').replace(/\/+$/, '');
}
function remoteDir(plugin, accId) { return dataDir(plugin) + '/calendar/remote/' + accId; }
function localDir(plugin) { return dataDir(plugin) + '/calendar/local'; }
function calId(s) { return String(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'cal'; }

async function ensureFolder(plugin, path) {
  const ad = plugin.app.vault.adapter;
  const parts = path.split('/');
  let cur = '';
  for (const p of parts) {
    cur = cur ? cur + '/' + p : p;
    try { if (!(await ad.exists(cur))) await ad.mkdir(cur); } catch (e) {}
  }
}
async function readJSON(plugin, path) {
  const ad = plugin.app.vault.adapter;
  try { if (await ad.exists(path)) return JSON.parse(await ad.read(path)); } catch (e) {}
  return null;
}
async function writeJSON(plugin, path, obj) {
  const ad = plugin.app.vault.adapter;
  await ensureFolder(plugin, path.split('/').slice(0, -1).join('/'));
  await ad.write(path, JSON.stringify(obj, null, 0));
}

/* ── Remote sync (DESKTOP): pull enabled VEVENT calendars into the cache ── */
async function syncAccount(plugin, account, client) {
  const rangeStart = moment().subtract(60, 'day');
  const rangeEnd = moment().add(400, 'day');
  const results = [];
  for (const cal of (account.calendars || [])) {
    if (!cal.enabled || cal.component !== 'VEVENT') continue;
    const path = remoteDir(plugin, account.id) + '/' + calId(cal.id || cal.href) + '.json';
    // cheap gate: skip if ctag unchanged
    const prev = await readJSON(plugin, path);
    let ctag = cal.ctag;
    try { const g = await client.getCtag(cal.href); ctag = g.ctag || g.syncToken || ctag; } catch (e) {}
    if (prev && ctag && prev.ctag === ctag) { results.push({ id: cal.id, skipped: true }); continue; }

    let events = [];
    try {
      const resources = await client.listComponents(cal.href, 'VEVENT', rangeStart, rangeEnd);
      for (const r of resources) {
        const parsed = ical.parseResource(r.ics || '');
        for (const ev of parsed.vevents) { ev.href = r.href; ev.etag = r.etag; events.push(ev); }
      }
    } catch (e) { results.push({ id: cal.id, error: String(e && e.message || e) }); continue; }

    await writeJSON(plugin, path, {
      schema: 1, kind: 'remote', accountId: account.id, calendarId: calId(cal.id || cal.href),
      href: cal.href, display: cal.display, color: cal.color || account.color || '',
      component: 'VEVENT', readOnly: true, ctag, events,
    });
    results.push({ id: cal.id, count: events.length });
  }
  return results;
}

/* ── Load every calendar (remote mirrors + local) for rendering ── */
async function loadCalendars(plugin) {
  const ad = plugin.app.vault.adapter;
  const cals = [];
  // remote mirrors
  for (const acc of (plugin.settings.tasksCalendar.accounts || [])) {
    const dir = remoteDir(plugin, acc.id);
    try {
      if (await ad.exists(dir)) {
        const listing = await ad.list(dir);
        for (const f of (listing.files || [])) {
          if (!f.endsWith('.json')) continue;
          const c = await readJSON(plugin, f);
          if (c) cals.push(c);
        }
      }
    } catch (e) {}
  }
  // local calendars
  for (const lc of (plugin.settings.tasksCalendar.localCalendars || [])) {
    const path = localDir(plugin) + '/' + calId(lc.id) + '.json';
    let c = await readJSON(plugin, path);
    if (!c) c = { schema: 1, kind: 'local', calendarId: calId(lc.id), display: lc.name, color: lc.color, component: 'VEVENT', readOnly: false, events: [] };
    c.display = lc.name; c.color = lc.color;
    cals.push(c);
  }
  return cals;
}

/* ── Local calendar mutations ── */
async function createLocalCalendar(plugin, name, color) {
  const id = 'lc-' + Date.now().toString(36);
  plugin.settings.tasksCalendar.localCalendars.push({ id, name: name || 'Local', color: color || '#4a9eff' });
  await plugin.saveSettings();
  await writeJSON(plugin, localDir(plugin) + '/' + calId(id) + '.json', {
    schema: 1, kind: 'local', calendarId: calId(id), display: name, color, component: 'VEVENT', readOnly: false, events: [],
  });
  return id;
}
async function saveLocalEvent(plugin, localCalId, event) {
  const path = localDir(plugin) + '/' + calId(localCalId) + '.json';
  const c = (await readJSON(plugin, path)) || { schema: 1, kind: 'local', calendarId: calId(localCalId), component: 'VEVENT', readOnly: false, events: [] };
  if (!event.uid) event.uid = 'nx-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const i = c.events.findIndex(e => e.uid === event.uid);
  if (i >= 0) c.events[i] = event; else c.events.push(event);
  await writeJSON(plugin, path, c);
  return event.uid;
}
async function deleteLocalEvent(plugin, localCalId, uid) {
  const path = localDir(plugin) + '/' + calId(localCalId) + '.json';
  const c = await readJSON(plugin, path);
  if (!c) return;
  c.events = c.events.filter(e => e.uid !== uid);
  await writeJSON(plugin, path, c);
}

/* ── Aggregate occurrences in [rangeStart, rangeEnd) across all calendars ── */
function expandRange(calendars, rangeStart, rangeEnd) {
  const out = [];
  for (const cal of calendars) {
    for (const ev of (cal.events || [])) {
      if (ev.status === 'CANCELLED') continue;
      const baseStart = ical.whenToMoment(ev.start, moment);
      if (!baseStart || !baseStart.isValid()) continue;
      const baseEnd = ev.end ? ical.whenToMoment(ev.end, moment)
        : baseStart.clone().add(ev.allDay ? 1 : 1, ev.allDay ? 'day' : 'hour');
      const spanMs = Math.max(0, baseEnd.diff(baseStart));
      const occs = recur.expand(ev, rangeStart, rangeEnd, moment);
      for (const s of occs) {
        const e = s.clone().add(spanMs, 'ms');
        if (e.isSameOrBefore(rangeStart) || s.isSameOrAfter(rangeEnd)) continue;
        out.push({
          cal, color: cal.color || '', event: ev, allDay: ev.allDay,
          start: s, end: e,
        });
      }
    }
  }
  out.sort((a, b) => (a.allDay === b.allDay ? a.start.valueOf() - b.start.valueOf() : (a.allDay ? -1 : 1)));
  return out;
}

/* One-way move of an existing `calendar/` tree into the current data dir.
   COPY, never delete: the local calendars in here are user data, not a cache,
   and a half-finished move on a flaky adapter must not be able to lose them.
   Runs once — it bails as soon as the destination exists. */
async function migrate(plugin, fromRoot) {
  const ad = plugin.app.vault.adapter;
  const from = (fromRoot || '').replace(/\/+$/, '') + '/calendar';
  const to = dataDir(plugin) + '/calendar';
  if (!from || from === to) return false;
  try {
    if (!(await ad.exists(from))) return false;
    if (await ad.exists(to)) return false;
  } catch (e) { return false; }
  const copyTree = async (src, dst) => {
    await ensureFolder(plugin, dst);
    let listing;
    try { listing = await ad.list(src); } catch (e) { return; }
    for (const f of (listing.files || [])) {
      const name = f.split('/').pop();
      try { await ad.write(dst + '/' + name, await ad.read(f)); } catch (e) {}
    }
    for (const d of (listing.folders || [])) {
      const name = d.split('/').pop();
      await copyTree(d, dst + '/' + name);
    }
  };
  try { await copyTree(from, to); } catch (e) { return false; }
  return true;
}

module.exports = {
  dataDir, pluginDir, remoteDir, localDir, calId, migrate,
  syncAccount, loadCalendars,
  createLocalCalendar, saveLocalEvent, deleteLocalEvent,
  expandRange, readJSON, writeJSON,
};
