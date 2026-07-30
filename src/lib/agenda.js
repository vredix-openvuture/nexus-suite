'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · agenda
 *  A ```nexus-agenda``` code block: everything one DAY holds, inside a normal
 *  note. Built for the daily-note template — drop the block in the template
 *  and every daily note carries its own agenda from then on.
 *
 *  Three sections, each switchable:
 *    calendar   the day's events, with times (from the calendar cache)
 *    tasks      the day's tasks as a checklist — ticking one writes back to
 *               the task note AND the project note's "## Tasks" line
 *    linked     notes that link TO this note (backlinks)
 *
 *  The day comes from `date:` — `today` by default, `note-date` reads it out
 *  of the note's own file name (the daily-note format from Obsidian's core
 *  settings), or a fixed `YYYY-MM-DD`. A note that has no date in its name
 *  falls back to today, so the block is never a dead end.
 *
 *  Config is plain `key: value`, same dialect as ```nexus-board``` — hand
 *  editable, and a note without the plugin still shows readable text.
 * ========================================================================== */

const { Notice, TFile, moment, setIcon } = require('obsidian');
const calstore = require('./calstore.js');
const tasks = require('./tasks.js');
const { getDailyNoteSettings } = require('./helpers.js');

const SECTIONS = ['calendar', 'tasks', 'linked'];
const DUE_SELECTORS = ['day', 'overdue', 'week', 'month', 'upcoming', 'none', 'any'];
const truthy = (v) => /^(true|yes|1|on|an)$/i.test(String(v).trim());
const falsy = (v) => /^(false|no|0|off|aus|none)$/i.test(String(v).trim());

/* ── config ─────────────────────────────────────────────────────────────── */

function parseAgenda(src) {
  const cfg = {
    date: 'today', title: '',
    calendar: true, tasks: true, linked: true,
    calendars: [],            // calendar display names (empty = all)
    projects: [],             // project names (empty = all)
    state: 'open',            // open | done | all
    priority: null,           // {op,n}
    due: ['day', 'overdue'],  // which tasks count as "this day's"
    limit: 0,                 // 0 = no cap
    sort: 'smart',            // smart | due | priority | title
    exclude: [],              // folders kept out of the linked list
    hideEmpty: false,
  };
  let sawShow = false;
  String(src || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const i = line.indexOf(':');
    if (i < 0) return;
    const k = line.slice(0, i).trim().toLowerCase().replace(/[_\s]+/g, '-');
    const v = line.slice(i + 1).trim();
    const list = () => v.split(',').map(x => x.trim()).filter(Boolean);
    switch (k) {
      case 'date': case 'day': cfg.date = v; break;
      case 'title': case 'heading': cfg.title = v; break;
      case 'show': {
        // "show: tasks, calendar" — anything not named is off
        sawShow = true;
        const on = new Set(list().map(x => x.toLowerCase().replace(/^--/, '')));
        SECTIONS.forEach(s => { cfg[s] = on.has(s) || (s === 'linked' && (on.has('links') || on.has('linked-notes') || on.has('backlinks'))); });
        break;
      }
      case 'hide': {
        const off = new Set(list().map(x => x.toLowerCase().replace(/^--/, '')));
        SECTIONS.forEach(s => { if (off.has(s)) cfg[s] = false; });
        if (off.has('links') || off.has('linked-notes') || off.has('backlinks')) cfg.linked = false;
        break;
      }
      case 'calendars': case 'calendar-filter': cfg.calendars = list(); break;
      case 'project': case 'projects': cfg.projects = list(); break;
      case 'state': case 'status':
        cfg.state = /^(all|both|any)$/i.test(v) ? 'all' : /^(done|completed|closed)$/i.test(v) ? 'done' : 'open';
        break;
      case 'priority': cfg.priority = parsePriority(v); break;
      case 'due': {
        const want = list().map(x => x.toLowerCase());
        const ok = want.filter(x => DUE_SELECTORS.includes(x));
        if (ok.length) cfg.due = ok.includes('any') ? ['any'] : ok;
        break;
      }
      case 'limit': case 'max': cfg.limit = Math.max(0, parseInt(v, 10) || 0); break;
      case 'sort': cfg.sort = /due|priority|title/i.test(v) ? v.toLowerCase() : 'smart'; break;
      case 'exclude': cfg.exclude = list().map(x => x.replace(/^\/|\/$/g, '')); break;
      case 'hide-empty': case 'hideempty': cfg.hideEmpty = truthy(v); break;
      /* `tasks: off` / `calendar: on` — per-section switches, so a template can
         flip one part without respelling the whole `show:` line. */
      case 'linked': case 'links': case 'linked-notes': case 'backlinks':
        cfg.linked = !falsy(v); break;
      default:
        if (SECTIONS.includes(k)) cfg[k] = !falsy(v);
        break;
    }
  });
  // `show:` names the sections explicitly; without it every section stays on.
  if (!sawShow && !SECTIONS.some(s => cfg[s])) SECTIONS.forEach(s => { cfg[s] = true; });
  return cfg;
}

function parsePriority(v) {
  const m = String(v || '').trim().match(/^(>=|<=|>|<|=)?\s*(\d+)$/);
  if (!m) {
    // words, matching the task modal's dropdown (0 none · 1 low · 5 med · 9 high)
    if (/^high$/i.test(v)) return { op: '>=', n: 7 };
    if (/^med(ium)?$/i.test(v)) return { op: '>=', n: 4 };
    if (/^low$/i.test(v)) return { op: '>=', n: 1 };
    return null;
  }
  return { op: m[1] || '>=', n: parseInt(m[2], 10) };
}
function priorityOk(p, f) {
  if (!f) return true;
  const n = parseInt(p, 10) || 0;
  return f.op === '>' ? n > f.n : f.op === '<' ? n < f.n
    : f.op === '<=' ? n <= f.n : f.op === '=' ? n === f.n : n >= f.n;
}
function priorityLabel(p) {
  const n = parseInt(p, 10) || 0;
  return n <= 0 ? '' : n >= 7 ? 'High' : n >= 4 ? 'Medium' : 'Low';
}

/* ── the day the block is about ─────────────────────────────────────────── */

function dateFromNote(app, sourcePath) {
  if (!sourcePath) return null;
  const { format, folder } = getDailyNoteSettings(app);
  const noExt = sourcePath.replace(/\.md$/i, '');
  const base = noExt.split('/').pop();
  // A daily-note format may carry folders ("YYYY/MM/YYYY-MM-DD") — then the
  // file name alone can never match it, so try the path (minus the configured
  // daily-note folder) as well.
  const rel = folder && noExt.startsWith(folder + '/') ? noExt.slice(folder.length + 1) : noExt;
  for (const [text, fmt] of [[base, format], [rel, format], [noExt, format]]) {
    const m = moment(text, fmt, true);
    if (m.isValid()) return m.startOf('day');
  }
  // Last resort: a date sitting anywhere in the name ("2026-07-30 Standup").
  // Pad the parts — strict moment rejects "7" for MM and "07" for M alike.
  const hit = base.match(/(\d{4})[-._/ ](\d{1,2})[-._/ ](\d{1,2})/);
  if (hit) {
    const iso = hit[1] + '-' + hit[2].padStart(2, '0') + '-' + hit[3].padStart(2, '0');
    const m = moment(iso, 'YYYY-MM-DD', true);
    if (m.isValid()) return m.startOf('day');
  }
  return null;
}

/* today (default) · note-date · tomorrow/yesterday · +3/-1 · 2026-07-29 */
function resolveDay(app, spec, sourcePath) {
  const s = String(spec == null ? '' : spec).trim();
  const low = s.toLowerCase();
  if (!low || low === 'today' || low === 'now' || low === 'heute') return moment().startOf('day');
  if (low === 'tomorrow' || low === 'morgen') return moment().add(1, 'day').startOf('day');
  if (low === 'yesterday' || low === 'gestern') return moment().subtract(1, 'day').startOf('day');
  if (/^[+-]\d+$/.test(low)) return moment().add(parseInt(low, 10), 'day').startOf('day');
  if (/^(note-date|note|notedate|file|filename|auto|from-note)$/.test(low)) {
    return dateFromNote(app, sourcePath) || moment().startOf('day');
  }
  const m = moment(s, ['YYYY-MM-DD', 'DD.MM.YYYY', 'YYYY/MM/DD', 'DD-MM-YYYY'], true);
  return m.isValid() ? m.startOf('day') : moment().startOf('day');
}

/* ── module ─────────────────────────────────────────────────────────────── */

class NexusAgenda {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }

  init() {
    const p = this.plugin;
    p.registerMarkdownCodeBlockProcessor('nexus-agenda', (src, el, ctx) => {
      return this.render(src, el, ctx).catch(e => {
        el.empty();
        el.createDiv({ cls: 'nx-ag-empty', text: 'Agenda: ' + (e && e.message ? e.message : e) });
        console.error('[nexus-suite] agenda', e);
      });
    });
    p.addCommand({ id: 'nexus-insert-agenda', name: 'Insert an agenda block',
      editorCallback: (editor) => {
        editor.replaceSelection('```nexus-agenda\ndate: note-date\nshow: calendar, tasks, linked\n```\n');
      } });
    // A task note, a project checklist or a link can change under an open
    // agenda — repaint on any of them, debounced. No `vault.on('modify')`: it
    // fires on every save of the note being written in, and metadataCache
    // already reports the content changes that matter here. The calendar cache
    // lives under .obsidian/ and fires no vault event at all — the sync calls
    // refreshCalendarViews(), which reaches us.
    p.registerEvent(this.app.metadataCache.on('changed', () => this.refreshAll()));
    p.registerEvent(this.app.vault.on('create', () => this.refreshAll()));
    p.registerEvent(this.app.vault.on('delete', () => this.refreshAll()));
    p.registerEvent(this.app.vault.on('rename', () => this.refreshAll()));
  }

  refreshAll() {
    window.clearTimeout(this._t);
    this._t = window.setTimeout(() => {
      this._cals = null;
      document.querySelectorAll('.nx-agenda').forEach(el => {
        if (el._nxRepaint) try { el._nxRepaint(); } catch (e) {}
      });
    }, 400);
  }

  /* ---- data ------------------------------------------------------------- */

  /* Loading every calendar file per block is wasteful when a note holds more
     than one — hold them for a moment, and drop them on any refresh. */
  async calendars() {
    if (this._cals && (Date.now() - this._calsAt) < 2500) return this._cals;
    this._cals = await calstore.loadCalendars(this.plugin);
    this._calsAt = Date.now();
    return this._cals;
  }

  async events(cfg, day) {
    const all = await this.calendars();
    const want = cfg.calendars.map(c => c.toLowerCase());
    const cals = want.length
      ? all.filter(c => want.some(w => String(c.display || '').toLowerCase() === w
          || String(c.display || '').toLowerCase().includes(w)))
      : all;
    const start = day.clone().startOf('day');
    const end = day.clone().endOf('day');
    return calstore.expandRange(cals, start, end)
      .filter(o => o.start.isSameOrBefore(end) && o.end.isAfter(start));
  }

  /* Locally created tasks keep their title only in the project note's checklist
     line (`[[t-xy|Title]]`) — read it back out of the metadata cache so the
     agenda shows a name and not a key. Tasks written by the sync carry a
     `title:` in their frontmatter and skip this. */
  titleIndex() {
    const idx = new Map();
    const folder = tasks.projectsFolder(this.plugin) + '/';
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(folder)) continue;
      const cache = this.app.metadataCache.getFileCache(f);
      if (!cache) continue;
      const fm = cache.frontmatter || {};
      if (fm['nexus-type'] !== 'project') continue;
      for (const l of (cache.links || [])) {
        if (l.displayText && l.link && l.displayText !== l.link) idx.set(l.link, l.displayText);
      }
    }
    return idx;
  }

  collectTasks(cfg, day) {
    const titles = this.titleIndex();
    const wantProjects = cfg.projects.map(p => p.toLowerCase());
    const dayStr = day.format('YYYY-MM-DD');
    const weekStart = day.clone().startOf('week'), weekEnd = day.clone().endOf('week');
    const out = [];

    for (const rec of tasks.listTasks(this.plugin)) {
      const done = rec.done;
      if (cfg.state === 'open' && done) continue;
      if (cfg.state === 'done' && !done) continue;
      if (!priorityOk(rec.priority, cfg.priority)) continue;
      if (wantProjects.length && !wantProjects.includes(rec.project.toLowerCase())) continue;

      const { due, dueDay } = rec;
      const bucket = !due ? 'none'
        : dueDay === dayStr ? 'day'
        : dueDay < dayStr ? 'overdue'
        : 'upcoming';
      if (!cfg.due.includes('any')) {
        const inWeek = due && moment(dueDay, 'YYYY-MM-DD', true).isBetween(weekStart, weekEnd, 'day', '[]');
        const inMonth = due && dueDay.slice(0, 7) === dayStr.slice(0, 7);
        const hit = cfg.due.some(sel =>
          (sel === 'day' && bucket === 'day') ||
          // an overdue task is only still open work — a finished one belongs to its own day
          (sel === 'overdue' && bucket === 'overdue' && !done) ||
          (sel === 'upcoming' && bucket === 'upcoming') ||
          (sel === 'none' && bucket === 'none') ||
          (sel === 'week' && inWeek) ||
          (sel === 'month' && inMonth));
        if (!hit) continue;
      }

      out.push(Object.assign({}, rec, {
        bucket,
        // notes are named after their title now; the checklist alias only still
        // matters for notes from before that
        title: rec.title !== rec.key ? rec.title : (titles.get(rec.key) || rec.key),
        overdueDays: bucket === 'overdue' ? day.diff(moment(dueDay, 'YYYY-MM-DD'), 'day') : 0,
      }));
    }

    const order = { overdue: 0, day: 1, upcoming: 2, none: 3 };
    const by = {
      due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999'),
      priority: (a, b) => b.priority - a.priority,
      title: (a, b) => a.title.localeCompare(b.title),
    };
    out.sort((a, b) => {
      if (cfg.sort !== 'smart') return (by[cfg.sort] || by.due)(a, b) || by.title(a, b);
      return (a.done - b.done)
        || (order[a.bucket] - order[b.bucket])
        || (a.due || '9999').localeCompare(b.due || '9999')
        || (b.priority - a.priority)
        || a.title.localeCompare(b.title);
    });
    return cfg.limit ? out.slice(0, cfg.limit) : out;
  }

  collectLinked(cfg, sourcePath) {
    if (!sourcePath) return [];
    const links = this.app.metadataCache.resolvedLinks || {};
    const taskFolders = [tasks.itemsFolder(this.plugin) + '/'];
    const out = [];
    for (const src of Object.keys(links)) {
      if (src === sourcePath || !links[src][sourcePath]) continue;
      if (cfg.exclude.some(x => src === x + '.md' || src.startsWith(x + '/'))) continue;
      // task notes have their own section — listing them again as backlinks
      // would just be the same line twice
      if (taskFolders.some(t => src.startsWith(t))) continue;
      const f = this.app.vault.getAbstractFileByPath(src);
      if (f instanceof TFile) out.push(f);
    }
    out.sort((a, b) => b.stat.mtime - a.stat.mtime);
    return out;
  }

  /* ---- actions ---------------------------------------------------------- */

  async toggleTask(item, checked, repaint) {
    const res = await tasks.setTaskDone(this.plugin, item.key, checked);
    if (res && res.missing) { new Notice('Task note not found: ' + item.key); return; }
    // keep the project note's checklist in step — the note is the record, and a
    // box that disagrees with its task note is the one thing that would make
    // the whole model untrustworthy
    if (item.project) {
      try { await tasks.setChecklistBox(this.plugin, item.project, item.key, res && res.repeated ? false : checked); } catch (e) {}
    }
    if (res && res.repeated) new Notice('Repeats — next due ' + (res.newDue || '?'));
    if (repaint) window.setTimeout(repaint, 260);
  }

  openTask(item) {
    this.app.workspace.getLeaf(false).openFile(item.file);
  }
  openProject(name) {
    const f = this.app.vault.getAbstractFileByPath(tasks.projectPath(this.plugin, name));
    if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
    else new Notice('No project note for "' + name + '".');
  }
  async openEvent(occ, cals, repaint) {
    const { NexusEventModal } = require('../modals/event.js');
    new NexusEventModal(this.plugin, occ.event, () => { this._cals = null; if (repaint) repaint(); }, cals, occ.cal).open();
  }

  /* ---- render ----------------------------------------------------------- */

  async render(src, el, ctx) {
    const cfg = parseAgenda(src);
    const sourcePath = ctx && ctx.sourcePath;
    const day = resolveDay(this.app, cfg.date, sourcePath);
    const repaint = () => { this.render(src, el, ctx).catch(() => {}); };

    el.empty();
    el.addClass('nx-agenda');
    el._nxRepaint = repaint;

    const modOn = !!(this.plugin.settings.tasksCalendar && this.plugin.settings.tasksCalendar.enabled);
    const isToday = day.isSame(moment(), 'day');

    /* head */
    const head = el.createDiv('nx-ag-head');
    const t = head.createDiv('nx-ag-title');
    t.createSpan({ cls: 'nx-ag-date', text: cfg.title || day.format('dddd, D MMMM YYYY') });
    if (isToday && !cfg.title) t.createSpan({ cls: 'nx-ag-badge', text: 'today' });

    const tools = head.createDiv('nx-ag-tools');
    const tool = (icon, label, fn) => {
      const b = tools.createDiv('nx-ag-tool');
      setIcon(b, icon);
      b.setAttribute('aria-label', label);
      b.onclick = fn;
      return b;
    };
    if (modOn && cfg.tasks) tool('plus', 'New task', () => {
      const { NexusTaskModal } = require('../modals/task.js');
      new NexusTaskModal(this.plugin, () => repaint(), cfg.projects[0] || '').open();
    });
    if (modOn && cfg.calendar) tool('calendar-plus', 'New event', async () => {
      const cals = await this.calendars();
      if (!cals.length) { new Notice('Add a local calendar or sync an account first.'); return; }
      const { NexusEventModal } = require('../modals/event.js');
      new NexusEventModal(this.plugin, { start: { dt: day.format('YYYY-MM-DD') + 'T09:00:00', utc: false, tzid: null } },
        () => { this._cals = null; repaint(); }, cals, null).open();
    });
    if (modOn && cfg.calendar) tool('calendar-days', 'Open in calendar', () => this.plugin.openCalendarPage(day, 'day'));

    const body = el.createDiv('nx-ag-body');

    if (!modOn && (cfg.calendar || cfg.tasks)) {
      body.createDiv({ cls: 'nx-ag-note',
        text: 'Tasks & Calendar is switched off — turn on “Enabled” in the plugin settings to fill this agenda.' });
    }

    /* calendar */
    if (cfg.calendar && modOn) {
      const occs = await this.events(cfg, day);
      if (occs.length || !cfg.hideEmpty) {
        const sec = this.section(body, 'Events', occs.length);
        if (!occs.length) sec.createDiv({ cls: 'nx-ag-empty', text: 'No events.' });
        else {
          const cals = await this.calendars();
          const allDay = occs.filter(o => o.allDay);
          const timed = occs.filter(o => !o.allDay).sort((a, b) => a.start.valueOf() - b.start.valueOf());
          [...allDay, ...timed].forEach(o => this.eventRow(sec, o, day, cals, repaint));
        }
      }
    }

    /* tasks */
    if (cfg.tasks && modOn) {
      const items = this.collectTasks(cfg, day);
      if (items.length || !cfg.hideEmpty) {
        const sec = this.section(body, 'Tasks', items.length);
        if (!items.length) sec.createDiv({ cls: 'nx-ag-empty', text: 'Nothing due.' });
        else items.forEach(it => this.taskRow(sec, it, repaint));
      }
    }

    /* linked notes */
    if (cfg.linked) {
      const files = this.collectLinked(cfg, sourcePath);
      if (files.length || !cfg.hideEmpty) {
        const sec = this.section(body, 'Linked notes', files.length);
        if (!files.length) sec.createDiv({ cls: 'nx-ag-empty', text: 'No notes link here yet.' });
        else files.forEach(f => {
          const row = sec.createDiv('nx-ag-link');
          setIcon(row.createSpan({ cls: 'nx-ag-link-ic' }), 'file-text');
          row.createSpan({ cls: 'nx-ag-link-name', text: f.basename });
          const dir = f.parent && f.parent.path && f.parent.path !== '/' ? f.parent.path : '';
          if (dir) row.createSpan({ cls: 'nx-ag-link-path', text: dir });
          row.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
        });
      }
    }

    if (!body.childElementCount) body.createDiv({ cls: 'nx-ag-empty', text: 'Nothing to show — every section is switched off.' });
  }

  section(parent, label, count) {
    const sec = parent.createDiv('nx-ag-sec');
    const h = sec.createDiv('nx-ag-h');
    h.createSpan({ text: label });
    if (count) h.createSpan({ cls: 'nx-ag-count', text: String(count) });
    return sec;
  }

  eventRow(sec, occ, day, cals, repaint) {
    const ev = occ.event;
    const row = sec.createDiv('nx-ag-row nx-ag-event');
    if (occ.color) row.style.setProperty('--nx-ag-dot', occ.color);
    const time = row.createDiv('nx-ag-time');
    if (occ.allDay) time.setText('all day');
    else {
      // an event that started yesterday or runs past midnight keeps its real
      // clock time — the arrows say it reaches beyond this day
      const startsBefore = occ.start.isBefore(day.clone().startOf('day'));
      const endsAfter = occ.end.isAfter(day.clone().endOf('day'));
      time.setText((startsBefore ? '‹ ' : '') + occ.start.format('H:mm') + '–' + occ.end.format('H:mm') + (endsAfter ? ' ›' : ''));
    }
    row.createSpan({ cls: 'nx-ag-dot' });
    const main = row.createDiv('nx-ag-main');
    main.createSpan({ cls: 'nx-ag-text', text: ev.summary || '(no title)' });
    if (ev.location) main.createSpan({ cls: 'nx-ag-meta', text: ev.location });
    const calName = occ.cal && occ.cal.display;
    if (calName) row.createSpan({ cls: 'nx-ag-chip', text: calName });
    row.onclick = () => this.openEvent(occ, cals, repaint);
  }

  taskRow(sec, it, repaint) {
    const row = sec.createDiv('nx-ag-row nx-ag-task' + (it.done ? ' is-done' : '') + (it.bucket === 'overdue' ? ' is-overdue' : ''));
    const box = row.createEl('input', { cls: 'nx-ag-check', attr: { type: 'checkbox' } });
    box.checked = it.done;
    box.onclick = (e) => e.stopPropagation();
    box.onchange = async () => {
      row.addClass('is-busy');
      await this.toggleTask(it, box.checked, repaint);
    };
    const main = row.createDiv('nx-ag-main');
    main.createSpan({ cls: 'nx-ag-text', text: it.title });

    const meta = main.createDiv('nx-ag-meta');
    if (it.bucket === 'overdue') meta.createSpan({ cls: 'nx-ag-overdue', text: it.overdueDays === 1 ? '1 day overdue' : it.overdueDays + ' days overdue' });
    else if (it.timed) meta.createSpan({ text: it.timed });
    else if (it.bucket === 'upcoming') meta.createSpan({ text: 'due ' + it.dueDay });
    if (it.repeat) { const r = meta.createSpan({ cls: 'nx-ag-rep' }); setIcon(r, 'repeat'); }
    const pl = priorityLabel(it.priority);
    if (pl) meta.createSpan({ cls: 'nx-ag-prio is-' + pl.toLowerCase(), text: pl });

    if (it.project) {
      const chip = row.createSpan({ cls: 'nx-ag-chip is-project', text: it.project });
      chip.onclick = (e) => { e.stopPropagation(); this.openProject(it.project); };
    }
    row.onclick = () => this.openTask(it);
  }
}

module.exports = { NexusAgenda, parseAgenda, resolveDay, dateFromNote, parsePriority, priorityOk, priorityLabel };
