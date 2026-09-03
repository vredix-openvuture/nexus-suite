'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · the planner block
 *  Renders a ```nexus-planner``` block: a month (or a week) of what each day is
 *  FOR, writable in place. The fence says which month; the text of a day lives
 *  in that day's own note, exactly where the calendar page keeps it — one store,
 *  two views. See lib/daytext.js.
 * ========================================================================== */

const { Notice, TFile, moment, setIcon } = require('obsidian');
const planner = require('../lib/planner.js');
const daytext = require('../lib/daytext.js');
const blockedit = require('../lib/blockedit.js');

class NexusPlanner {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
  get s() { return this.plugin.settings.planner || {}; }

  init() {
    const p = this.plugin;
    p.registerMarkdownCodeBlockProcessor('nexus-planner', (src, el, ctx) => {
      try { this.render(src, el, ctx); }
      catch (e) {
        el.empty();
        el.createDiv({ cls: 'nx-pl-empty', text: 'Planner: ' + e.message });
      }
    });
  }

  today() { return moment().format('YYYY-MM-DD'); }

  render(src, el, ctx) {
    if (this.s.enabled === false) {
      el.empty();
      el.addClass('nx-pl');
      el.createDiv({ cls: 'nx-pl-empty', text: 'The planner module is off — turn on “Enabled” in Settings → Planner.' });
      return;
    }
    const cfg = planner.parsePlanner(src);
    const today = this.today();
    if (!cfg.month) cfg.month = planner.monthOf(today);
    if (!cfg.anchor) cfg.anchor = today;

    el.empty();
    el.addClass('nx-pl');
    el.toggleClass('is-week', cfg.view === 'week');
    el._nxSrc = src;
    el._nxRepaint = (next) => { try { this.render(next != null ? next : src, el, ctx); } catch (e) {} };

    this.header(el, cfg, ctx, today);
    const days = cfg.view === 'week'
      ? [planner.weekDays(cfg.anchor, cfg.weekStart)]
      : planner.monthGrid(cfg.month, cfg.weekStart);
    // The fence's own `YYYY-MM-DD:` lines are the old store and are ignored:
    // what a day says comes from that day's note. lib/plannermigrate.js is what
    // carries the old lines over.
    cfg.entries = {};
    days.forEach(week => week.forEach(day => {
      const text = daytext.readDayText(this.app, this.plugin, moment(day.date, 'YYYY-MM-DD'));
      if (text) cfg.entries[day.date] = text;
    }));
    this.grid(el, cfg, ctx, days, today);
  }

  header(el, cfg, ctx, today) {
    const head = el.createDiv('nx-pl-head');
    const label = cfg.view === 'week'
      ? this.weekLabel(cfg)
      : planner.monthLabel(cfg.month);
    head.createDiv({ cls: 'nx-pl-title', text: cfg.title || label });

    const filled = Object.keys(cfg.entries).filter(d => this.inView(cfg, d)).length;
    head.createDiv({ cls: 'nx-pl-count', text: filled ? filled + ' planned' : 'nothing planned yet' });

    const tools = head.createDiv('nx-pl-tools');
    const tool = (icon, aria, fn) => {
      const b = tools.createDiv('nx-pl-tool');
      setIcon(b, icon);
      b.setAttribute('aria-label', aria);
      b.onclick = fn;
      return b;
    };
    const step = (n) => {
      if (cfg.view === 'week') cfg.anchor = planner.addDays(cfg.anchor, n * 7);
      else cfg.month = planner.addMonths(cfg.month, n);
      this.saveConfig(el, ctx, cfg);
    };
    tool('chevron-left', cfg.view === 'week' ? 'Previous week' : 'Previous month', () => step(-1));
    tool('dot', 'Back to now', () => {
      if (cfg.view === 'week') cfg.anchor = today; else cfg.month = planner.monthOf(today);
      this.saveConfig(el, ctx, cfg);
    });
    tool('chevron-right', cfg.view === 'week' ? 'Next week' : 'Next month', () => step(1));
    tool(cfg.view === 'week' ? 'calendar' : 'calendar-range',
      cfg.view === 'week' ? 'Show the month' : 'Show the week', () => {
        // Switching view keeps you where you were: the week that holds the
        // month you were looking at, and the month that holds the week.
        if (cfg.view === 'week') { cfg.month = planner.monthOf(cfg.anchor); cfg.view = 'month'; }
        else { cfg.view = 'week'; if (planner.monthOf(cfg.anchor) !== cfg.month) cfg.anchor = cfg.month + '-01'; }
        this.saveConfig(el, ctx, cfg);
      });
  }

  weekLabel(cfg) {
    const start = planner.startOfWeek(cfg.anchor, cfg.weekStart);
    const end = planner.addDays(start, 6);
    const a = moment(start, 'YYYY-MM-DD'), b = moment(end, 'YYYY-MM-DD');
    return a.format('D MMM') + ' – ' + b.format('D MMM YYYY');
  }
  inView(cfg, date) {
    if (cfg.view !== 'week') return planner.monthOf(date) === cfg.month;
    const start = planner.startOfWeek(cfg.anchor, cfg.weekStart);
    return date >= start && date <= planner.addDays(start, 6);
  }

  grid(el, cfg, ctx, weeks, today) {
    const names = cfg.weekStart === 'sunday' ? planner.WEEKDAYS_SUN : planner.WEEKDAYS_MON;
    const head = el.createDiv('nx-pl-dow');
    names.forEach(n => head.createDiv({ cls: 'nx-pl-dow-c', text: n }));

    const body = el.createDiv('nx-pl-grid');
    weeks.forEach(days => days.forEach(day => this.cell(body, cfg, ctx, day, today, el)));
  }

  cell(body, cfg, ctx, day, today, el) {
    const cell = body.createDiv('nx-pl-cell'
      + (day.inMonth ? '' : ' is-outside')
      + (day.date === today ? ' is-today' : ''));
    const top = cell.createDiv('nx-pl-cell-head');
    top.createSpan({ cls: 'nx-pl-num', text: String(day.day) });
    // The daily note is one click away — the planner says WHAT, the note is where
    // the detail lives, and the two should not be retyped into each other.
    const jump = top.createDiv({ cls: 'nx-pl-open', attr: { 'aria-label': 'Open the daily note' } });
    setIcon(jump, 'file-text');
    jump.onclick = (e) => { e.stopPropagation(); this.openDaily(day.date); };

    const input = cell.createEl('textarea', {
      cls: 'nx-pl-input',
      attr: { placeholder: '', 'aria-label': 'What ' + day.date + ' is for' },
    });
    input.value = cfg.entries[day.date] || '';
    let last = input.value;
    const commit = () => {
      if (input.value === last) return;
      const previous = last;
      last = input.value;
      this.save(day.date, input.value, input, previous);
    };
    input.onblur = commit;
    input.onkeydown = (e) => {
      // Enter opens a line — the text is a paragraph, not a field; Ctrl/⌘+Enter
      // is "done", the same as in the calendar's month cell.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = last; input.blur(); }
    };
  }

  /* The fence itself — only its config changes now (which month, which view). */
  async saveConfig(el, ctx, cfg) {
    const src = planner.stringifyPlanner(cfg);
    const previous = el._nxSrc;
    if (el._nxRepaint) el._nxRepaint(src);
    const res = await blockedit.saveFencedBlock(this.app, TFile, el, ctx, 'nexus-planner', src, previous);
    if (!res.ok) new Notice('Nexus: ' + res.reason + ' — the block was not saved.');
  }

  /* Open (or create) the daily note for a day, using the core plugin's own
     format so the planner never invents a second naming scheme. */
  async openDaily(date) {
    const daily = this.app.internalPlugins && this.app.internalPlugins.getPluginById
      ? this.app.internalPlugins.getPluginById('daily-notes')
      : null;
    const options = daily && daily.instance ? (daily.instance.options || {}) : {};
    const format = options.format || 'YYYY-MM-DD';
    const folder = String(options.folder || '').replace(/\/+$/, '');
    const name = moment(date, 'YYYY-MM-DD').format(format);
    const path = (folder ? folder + '/' : '') + name + '.md';
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      try { file = await this.app.vault.create(path, ''); }
      catch (e) { new Notice('Nexus: could not open a daily note at ' + path); return; }
    }
    this.app.workspace.getLeaf(false).openFile(file);
  }

  /* Into the day's own note. The field is the only copy of what was typed, so a
     failed write hands it back rather than repainting it away. */
  async save(date, text, input, previous) {
    const res = await daytext.writeDayText(this.app, this.plugin, moment(date, 'YYYY-MM-DD'), text);
    if (!res.ok) {
      new Notice('Nexus: ' + res.reason + ' — nothing was saved.');
      if (input && input.isConnected) { input.value = text; input.focus(); }
      return;
    }
    // The calendar page and the mini calendar show the same text. A metadata
    // event reaches them too, but only once Obsidian gets around to firing it.
    if (typeof this.plugin.refreshCalendarViews === 'function') this.plugin.refreshCalendarViews();
  }
}

module.exports = { NexusPlanner };
