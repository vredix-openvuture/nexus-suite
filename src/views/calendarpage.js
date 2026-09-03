'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · calendar page
 *  A month, and what each day is FOR.
 *
 *  One view and one grid. The day's text is the content — it fills the cell,
 *  it is written here and it lives in that day's own note (lib/daytext.js).
 *  Tasks with a due date ride along as chips under it, because "what is due"
 *  is the one thing a month has to show that the text cannot.
 *
 *  There are no events here any more, and no calendars to keep: see
 *  docs/removed-features.md.
 * ========================================================================== */

const { ItemView, moment, setIcon, Notice } = require('obsidian');
const { CAL_PAGE_VIEW, NX_MODULES } = require('../constants.js');
const { getDailyNoteSettings, nxMonthGridRange, nxPinMenuItem, nxWeekdayLabels, openDailyNote } = require('../lib/helpers.js');
const daytext = require('../lib/daytext.js');
const tasks = require('../lib/tasks.js');

const MAX_CHIPS = 3;   // due tasks per day cell before "+N"

class NexusCalendarPageView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.cursor = moment().startOf('day');
    this.dayTexts = {};       // 'YYYY-MM-DD' → what that day is for
    this.dueTasks = {};       // 'YYYY-MM-DD' → [task, …]
  }
  getViewType() { return CAL_PAGE_VIEW; }
  getDisplayText() { return NX_MODULES.tasksCalendar.name; }
  getIcon() { return 'calendar-check'; }
  onPaneMenu(menu, source) {
    nxPinMenuItem(this.plugin, menu, 'calendar');
    return super.onPaneMenu(menu, source);
  }

  async onOpen() {
    this.reload();
    /* The day texts are ordinary frontmatter, so the METADATA cache is what has
       to be watched — 'modify' fires before Obsidian has re-parsed the note, and
       reading there gives the previous value back. */
    this.registerEvent(this.app.metadataCache.on('changed', () => this.reload()));
    this.registerEvent(this.app.vault.on('delete', () => this.reload()));
    this.registerEvent(this.app.vault.on('rename', () => this.reload()));
  }

  reload() {
    if (this.editingDay) return;   // never repaint a field being typed into
    const [start, end] = this.range();
    this.dayTexts = daytext.readRange(this.app, this.plugin, start, end);
    this.dueTasks = this._loadDueTasks(start, end);
    this.render();
  }

  range() { return nxMonthGridRange(this.cursor, this.plugin); }

  step(dir) {
    this.cursor.add(dir, 'month');
    this.reload();
  }

  /* Tasks with a due date inside the grid, grouped by the day they are due. */
  _loadDueTasks(start, end) {
    const app = this.app, folder = tasks.itemsFolder(this.plugin) + '/', out = {};
    const from = start.format('YYYY-MM-DD'), to = end.format('YYYY-MM-DD');
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(folder)) continue;
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (fm['nexus-type'] !== 'task' || !fm.due) continue;
      const day = String(fm.due).slice(0, 10);
      if (day < from || day > to) continue;
      (out[day] = out[day] || []).push({
        title: fm.title || f.basename,
        done: fm.status === 'completed' || fm.done === true,
        path: f.path,
      });
    }
    return out;
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-calpage');
    const inner = root.createDiv('nx-calpage-inner');
    this._head(inner);
    this._month(inner);
  }

  _head(inner) {
    const head = inner.createDiv('nx-cp-head');
    const title = head.createDiv('nx-cp-title');
    title.createSpan({ text: this.cursor.format('MMMM') });
    title.createSpan({ cls: 'nx-cp-sub', text: this.cursor.format('YYYY') });

    const nav = head.createDiv('nx-cp-nav');
    const nb = (icon, fn, label) => {
      const b = nav.createEl('button', { cls: 'nx-cp-btn', attr: { 'aria-label': label } });
      setIcon(b, icon); b.onclick = fn; return b;
    };
    nb('chevron-left', () => this.step(-1), 'Previous month');
    nav.createEl('button', { cls: 'nx-cp-btn nx-cp-today', text: 'Today' })
      .onclick = () => { this.cursor = moment().startOf('day'); this.reload(); };
    nb('chevron-right', () => this.step(1), 'Next month');

    const act = head.createDiv('nx-cp-actions');
    const sync = act.createEl('button', { cls: 'nx-cp-btn', attr: { 'aria-label': 'Sync tasks now' } });
    setIcon(sync, 'refresh-cw');
    sync.onclick = async () => {
      sync.addClass('is-spinning');
      await this.plugin.syncTaskCal();
      sync.removeClass('is-spinning');
      this.reload();
    };
  }

  _month(inner) {
    const { format, folder } = getDailyNoteSettings(this.app);
    const dowrow = inner.createDiv('nx-cp-dowrow');
    nxWeekdayLabels(this.plugin).forEach(d => dowrow.createDiv({ cls: 'nx-cp-dow', text: d }));
    const grid = inner.createDiv('nx-cp-month');
    const [start, end] = this.range();
    const today = moment().format('YYYY-MM-DD');
    const day = start.clone();
    while (day.isSameOrBefore(end)) {
      const d = day.clone();
      const iso = d.format('YYYY-MM-DD');
      const cell = grid.createDiv('nx-cp-day');
      if (d.month() !== this.cursor.month()) cell.addClass('nx-adjacent');
      if (iso === today) cell.addClass('nx-today');
      const num = cell.createDiv({ cls: 'nx-cp-daynum', text: d.format('D') });
      if (this.app.vault.getAbstractFileByPath((folder ? folder + '/' : '') + d.format(format) + '.md')) {
        cell.addClass('nx-has-note');
      }
      // The number opens the note; the rest of the cell is the writing surface.
      num.onclick = (e) => { e.stopPropagation(); openDailyNote(this.app, d); };
      this._dayText(cell, d, iso);
      this._dayTasks(cell, iso);
      day.add(1, 'day');
    }
  }

  /* The text fills what is left of the cell. It is not one line: a day can be
     a sentence or five, and the cell clips what does not fit rather than
     changing shape — a month whose rows jump around is not a month. */
  _dayText(cell, date, iso) {
    const text = this.dayTexts[iso] || '';
    const box = cell.createDiv({
      cls: 'nx-cp-daytext' + (text ? '' : ' is-empty'),
      attr: { role: 'button', tabindex: '0', 'aria-label': (text ? 'Edit' : 'Write') + ' what ' + iso + ' is for' },
    });
    box.setText(text);
    const edit = (e) => { e.preventDefault(); e.stopPropagation(); this._editDay(box, date, iso, text); };
    box.onclick = edit;
    box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') edit(e); };
  }

  _editDay(box, date, iso, text, prefill) {
    if (box.hasClass('is-editing')) return;
    box.addClass('is-editing');
    box.empty();
    const area = box.createEl('textarea', {
      cls: 'nx-cp-daytext-input',
      attr: { placeholder: 'What is this day for?', 'aria-label': 'What ' + iso + ' is for' },
    });
    area.value = prefill != null ? prefill : text;
    area.onclick = (e) => e.stopPropagation();
    this.editingDay = iso;

    let closed = false;
    const close = (save) => {
      if (closed) return;
      closed = true;
      this.editingDay = null;
      if (save && area.value.trim() !== text.trim()) { this._save(date, iso, area.value, box, text); return; }
      // Nothing changed: put the text back rather than rebuilding the month.
      // A blur fires before the click that caused it lands, and a full render
      // would destroy the element that click is still travelling to.
      box.removeClass('is-editing');
      box.toggleClass('is-empty', !text);
      box.setText(text);
    };
    area.onblur = () => close(true);
    area.onkeydown = (e) => {
      e.stopPropagation();
      // Enter makes a new line — this is a paragraph, not a field. Ctrl/⌘+Enter
      // is the way to say "done" without reaching for anywhere else.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); area.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    };
    area.focus();
    area.select();
  }

  async _save(date, iso, value, box, previous) {
    const res = await daytext.writeDayText(this.app, this.plugin, date, value);
    if (!res.ok) {
      new Notice('Nexus: ' + res.reason + ' — nothing was saved.');
      // Hand the text back rather than repainting it away: it is the only copy.
      if (box && box.isConnected) { box.removeClass('is-editing'); this._editDay(box, date, iso, previous || '', value); }
      return;
    }
    // The metadataCache 'changed' event repaints on its own once Obsidian has
    // re-parsed the note; this is for the case where it does not fire because
    // nothing in the file actually changed.
    this.dayTexts[iso] = String(value || '').trim();
    if (!this.dayTexts[iso]) delete this.dayTexts[iso];
    this.render();
  }

  _dayTasks(cell, iso) {
    const list = this.dueTasks[iso];
    if (!list || !list.length) return;
    const wrap = cell.createDiv('nx-cp-events');
    list.slice(0, MAX_CHIPS).forEach(t => {
      const chip = wrap.createDiv('nx-cp-chip is-task' + (t.done ? ' is-done' : ''));
      chip.createSpan({ cls: 'nx-cp-chip-check', text: t.done ? '☑' : '☐' });
      chip.createSpan({ cls: 'nx-cp-chip-text', text: t.title });
      chip.onclick = (e) => {
        e.stopPropagation();
        const f = this.app.vault.getAbstractFileByPath(t.path);
        if (f) this.app.workspace.getLeaf(false).openFile(f);
      };
    });
    if (list.length > MAX_CHIPS) wrap.createDiv({ cls: 'nx-cp-more', text: '+' + (list.length - MAX_CHIPS) });
  }
}

module.exports = { NexusCalendarPageView };
