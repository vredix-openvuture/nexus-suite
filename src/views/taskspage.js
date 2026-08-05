'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · tasks page
 *  The task counterpart of the full-page calendar: a project tree on the left,
 *  the selected project's tasks on the right.
 *
 *  The tree is the vault's project notes (nexus-parent = the edge), the list is
 *  their task notes — nothing here holds state of its own, so the page always
 *  agrees with the notes, the agenda block and the server.
 *
 *  Root projects show as image cards (a Vikunja background pulled in by the
 *  sync lands in the note's `banner:` and therefore here), subprojects as
 *  indented rows with a colour dot and their rolled-up open count.
 * ========================================================================== */

const { ItemView, Notice, moment, setIcon } = require('obsidian');
const { TASKS_VIEW } = require('../constants.js');
const { nxPinMenuItem } = require('../lib/helpers.js');
const tasks = require('../lib/tasks.js');

const STATES = [['open', 'Open'], ['done', 'Done'], ['all', 'All']];
const SORTS = [['smart', 'Due date'], ['priority', 'Priority'], ['title', 'A–Z'], ['project', 'Project']];

function priorityLabel(p) {
  const n = parseInt(p, 10) || 0;
  return n <= 0 ? '' : n >= 7 ? 'High' : n >= 4 ? 'Medium' : 'Low';
}

class NexusTasksPageView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
    const v = (plugin.settings.tasksCalendar && plugin.settings.tasksCalendar.tasksView) || {};
    this.sel = v.selected || '';                       // '' = every project
    this.state = v.state || 'open';
    this.sort = v.sort || 'smart';
    this.expanded = new Set(v.expanded || []);
  }
  getViewType() { return TASKS_VIEW; }
  getDisplayText() { return 'Tasks'; }
  getIcon() { return 'list-checks'; }
  onPaneMenu(menu, source) {
    nxPinMenuItem(this.plugin, menu, 'tasks');
    return super.onPaneMenu(menu, source);
  }

  async onOpen() {
    this.render();
    // The notes are the state — repaint whenever one of them moves.
    const touch = () => this.schedule();
    this.registerEvent(this.app.metadataCache.on('changed', touch));
    this.registerEvent(this.app.vault.on('create', touch));
    this.registerEvent(this.app.vault.on('delete', touch));
    this.registerEvent(this.app.vault.on('rename', touch));
  }
  schedule() {
    window.clearTimeout(this._t);
    this._t = window.setTimeout(() => this.render(), 350);
  }
  reload() { this.render(); }

  persist() {
    const s = this.plugin.settings.tasksCalendar;
    s.tasksView = { selected: this.sel, state: this.state, sort: this.sort, expanded: Array.from(this.expanded) };
    this.plugin.saveSettings();
  }

  /* ---- data ------------------------------------------------------------- */

  load() {
    const projects = tasks.listProjectNotes(this.plugin);
    const items = tasks.listTasks(this.plugin);
    const byName = new Map(projects.map(p => [p.name, p]));
    const kids = new Map();
    projects.forEach(p => {
      const parent = byName.has(p.parent) ? p.parent : '';
      kids.set(parent, (kids.get(parent) || []).concat([p]));
    });
    kids.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
    const open = new Map();
    items.forEach(t => { if (!t.done) open.set(t.project, (open.get(t.project) || 0) + 1); });
    return { projects, items, byName, kids, open };
  }
  /* open tasks of a project INCLUDING its subprojects — a collapsed parent must
     not look empty just because the work sits one level down */
  rollup(d, name, seen) {
    seen = seen || new Set();
    if (seen.has(name)) return 0;
    seen.add(name);
    let n = d.open.get(name) || 0;
    for (const k of (d.kids.get(name) || [])) n += this.rollup(d, k.name, seen);
    return n;
  }
  family(d, name, out, seen) {
    out = out || []; seen = seen || new Set();
    if (seen.has(name)) return out;
    seen.add(name); out.push(name);
    for (const k of (d.kids.get(name) || [])) this.family(d, k.name, out, seen);
    return out;
  }

  visible(d) {
    const scope = this.sel ? new Set(this.family(d, this.sel)) : null;
    let list = d.items.filter(t => !scope || scope.has(t.project));
    if (this.state === 'open') list = list.filter(t => !t.done);
    else if (this.state === 'done') list = list.filter(t => t.done);
    const today = moment().format('YYYY-MM-DD');
    const bucket = (t) => (!t.due ? 3 : t.dueDay < today ? 0 : t.dueDay === today ? 1 : 2);
    const by = {
      smart: (a, b) => (a.done - b.done) || (bucket(a) - bucket(b))
        || (a.due || '9999').localeCompare(b.due || '9999') || (b.priority - a.priority),
      priority: (a, b) => (a.done - b.done) || (b.priority - a.priority) || (a.due || '9999').localeCompare(b.due || '9999'),
      title: (a, b) => a.title.localeCompare(b.title),
      project: (a, b) => a.project.localeCompare(b.project) || (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'),
    };
    list.sort((a, b) => (by[this.sort] || by.smart)(a, b) || a.title.localeCompare(b.title));
    return list;
  }

  /* ---- actions ---------------------------------------------------------- */

  async toggle(t, done) {
    const res = await tasks.setTaskDone(this.plugin, t.key, done);
    if (res && res.missing) { new Notice('Task note not found: ' + t.key); return; }
    if (t.project) {
      try { await tasks.setChecklistBox(this.plugin, t.project, t.key, res && res.repeated ? false : done); } catch (e) {}
    }
    if (res && res.repeated) new Notice('Repeats — next due ' + (res.newDue || '?'));
    if (done && t.provider !== 'local') this.plugin.queueTaskSync();
    this.schedule();
  }
  async addTask(title, projectName) {
    const d = this.load();
    const p = d.byName.get(projectName);
    if (!p) { new Notice('Pick a project first.'); return; }
    await tasks.createTask(this.plugin, projectName, {
      title, provider: p.provider, account: p.account,
    });
    if (p.provider !== 'local') this.plugin.queueTaskSync();
    this.render();
  }

  /* ---- render ----------------------------------------------------------- */

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-tp');
    const s = this.plugin.settings.tasksCalendar;
    if (!s || !s.enabled) {
      root.createDiv({ cls: 'nx-tp-off', text: 'The Tasks & Calendar module is off — turn on “Enabled” in the plugin settings.' });
      return;
    }
    const d = this.load();
    this.side(root, d);
    this.main(root, d);
  }

  /* ── left: project tree ── */
  side(root, d) {
    const side = root.createDiv('nx-tp-side');
    const head = side.createDiv('nx-tp-side-head');
    head.createSpan({ cls: 'nx-tp-side-title', text: 'Projects' });
    const add = head.createDiv('nx-tp-icon');
    setIcon(add, 'folder-plus');
    add.setAttribute('aria-label', 'New project');
    add.onclick = async () => {
      const { NexusNameModal } = require('../modals/misc.js');
      const name = await new NexusNameModal(this.app, 'New project name', 'Project').openAndGet();
      if (!name) return;
      await tasks.createProject(this.plugin, name, this.sel || undefined);
      this.sel = name; this.persist(); this.render();
    };

    const all = side.createDiv('nx-tp-all' + (this.sel ? '' : ' is-active'));
    setIcon(all.createSpan({ cls: 'nx-tp-all-ic' }), 'inbox');
    all.createSpan({ cls: 'nx-tp-all-t', text: 'All tasks' });
    const nAll = d.items.filter(t => !t.done).length;
    if (nAll) all.createSpan({ cls: 'nx-tp-count', text: String(nAll) });
    all.onclick = () => { this.sel = ''; this.persist(); this.render(); };

    const tree = side.createDiv('nx-tp-tree');
    const roots = d.kids.get('') || [];
    if (!roots.length) {
      tree.createDiv({ cls: 'nx-tp-empty', text: 'No project notes yet.' });
      return;
    }
    roots.forEach(p => this.familyBlock(tree, d, p));
  }

  familyBlock(tree, d, p) {
    const kids = d.kids.get(p.name) || [];
    const open = this.expanded.has(p.name);
    const fam = tree.createDiv('nx-tp-fam' + (open && kids.length ? ' is-open' : ''));

    const card = fam.createDiv('nx-tp-card' + (this.sel === p.name ? ' is-active' : ''));
    const src = p.banner ? this.plugin.resolveBannerSrc(p.banner, p.file.path) : null;
    if (src) { card.addClass('has-img'); card.style.setProperty('--nx-tp-img', 'url("' + src.replace(/"/g, '\\"') + '")'); }
    if (p.color) card.style.setProperty('--nx-tp-color', p.color);
    card.createSpan({ cls: 'nx-tp-card-stripe' });
    card.createDiv({ cls: 'nx-tp-card-title', text: p.name });
    const n = this.rollup(d, p.name);
    if (n) card.createDiv({ cls: 'nx-tp-card-count', text: String(n) });
    card.onclick = () => { this.sel = p.name; this.persist(); this.render(); };
    if (kids.length) {
      const chev = card.createDiv('nx-tp-chev');
      setIcon(chev, open ? 'chevron-down' : 'chevron-right');
      chev.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
      chev.onclick = (e) => {
        e.stopPropagation();
        if (open) this.expanded.delete(p.name); else this.expanded.add(p.name);
        this.persist(); this.render();
      };
    }
    if (open && kids.length) kids.forEach(k => this.subRow(fam, d, k, 1));
  }

  subRow(fam, d, p, depth) {
    const kids = d.kids.get(p.name) || [];
    const open = this.expanded.has(p.name);
    const row = fam.createDiv('nx-tp-sub' + (this.sel === p.name ? ' is-active' : ''));
    row.style.setProperty('--nx-tp-depth', String(depth));
    if (kids.length) {
      const chev = row.createSpan('nx-tp-subchev');
      setIcon(chev, open ? 'chevron-down' : 'chevron-right');
      chev.onclick = (e) => {
        e.stopPropagation();
        if (open) this.expanded.delete(p.name); else this.expanded.add(p.name);
        this.persist(); this.render();
      };
    } else row.createSpan({ cls: 'nx-tp-subchev is-leaf' });
    const dot = row.createSpan('nx-tp-dot');
    if (p.color) dot.style.setProperty('--nx-tp-color', p.color);
    row.createSpan({ cls: 'nx-tp-sub-t', text: p.name });
    const n = this.rollup(d, p.name);
    if (n) row.createSpan({ cls: 'nx-tp-count', text: String(n) });
    row.onclick = () => { this.sel = p.name; this.persist(); this.render(); };
    if (open && kids.length) kids.forEach(k => this.subRow(fam, d, k, depth + 1));
  }

  /* ── right: header + task list ── */
  main(root, d) {
    const main = root.createDiv('nx-tp-main');
    const head = main.createDiv('nx-tp-head');
    head.createDiv({ cls: 'nx-tp-title', text: this.sel || 'All tasks' });

    const tools = head.createDiv('nx-tp-tools');
    const seg = (list, cur, fn) => {
      const wrap = tools.createDiv('nx-tp-seg');
      list.forEach(([id, label]) => {
        const b = wrap.createDiv('nx-tp-segbtn' + (cur === id ? ' is-active' : ''));
        b.setText(label);
        b.onclick = () => fn(id);
      });
    };
    seg(STATES, this.state, (id) => { this.state = id; this.persist(); this.render(); });
    const sortSel = tools.createEl('select', { cls: 'nx-tp-select' });
    SORTS.forEach(([id, label]) => sortSel.createEl('option', { value: id, text: label }));
    sortSel.value = this.sort;
    sortSel.onchange = () => { this.sort = sortSel.value; this.persist(); this.render(); };

    const tool = (icon, label, fn) => {
      const b = tools.createDiv('nx-tp-icon');
      setIcon(b, icon); b.setAttribute('aria-label', label); b.onclick = fn;
      return b;
    };
    if (this.sel) tool('file-text', 'Open the project note', () => {
      const p = d.byName.get(this.sel);
      if (p) this.app.workspace.getLeaf(false).openFile(p.file);
    });
    const syncBtn = tool('refresh-cw', 'Sync now', async () => {
      syncBtn.addClass('is-spinning');
      const r = await this.plugin.syncTaskCal();
      syncBtn.removeClass('is-spinning');
      if (r && r.lines && r.lines.length) new Notice('Nexus sync\n' + r.lines.join('\n'), 7000);
      this.render();
    });

    const list = main.createDiv('nx-tp-list');
    const items = this.visible(d);
    if (!items.length) {
      list.createDiv({ cls: 'nx-tp-empty', text: this.state === 'done' ? 'Nothing completed here yet.' : 'No tasks here.' });
    } else if (!this.sel || this.sort === 'project' || (d.kids.get(this.sel) || []).length) {
      // several projects in one list → group, so a task's home stays visible
      const groups = new Map();
      items.forEach(t => { const g = t.project || '(no project)'; groups.set(g, (groups.get(g) || []).concat([t])); });
      Array.from(groups.keys()).sort((a, b) => a.localeCompare(b)).forEach(name => {
        const h = list.createDiv('nx-tp-group');
        h.createSpan({ text: name });
        h.createSpan({ cls: 'nx-tp-count', text: String(groups.get(name).length) });
        h.onclick = () => { if (d.byName.has(name)) { this.sel = name; this.persist(); this.render(); } };
        groups.get(name).forEach(t => this.taskRow(list, t, false));
      });
    } else {
      items.forEach(t => this.taskRow(list, t, false));
    }

    if (this.sel) this.newTaskRow(main, this.sel);
  }

  taskRow(list, t, showProject) {
    const today = moment().format('YYYY-MM-DD');
    const overdue = !t.done && t.dueDay && t.dueDay < today;
    const row = list.createDiv('nx-tp-task' + (t.done ? ' is-done' : '') + (overdue ? ' is-overdue' : ''));
    const box = row.createEl('input', { cls: 'nx-tp-check', attr: { type: 'checkbox' } });
    box.checked = t.done;
    box.onclick = (e) => e.stopPropagation();
    box.onchange = () => { row.addClass('is-busy'); this.toggle(t, box.checked); };

    const body = row.createDiv('nx-tp-body');
    body.createSpan({ cls: 'nx-tp-t', text: t.title });
    const meta = body.createDiv('nx-tp-meta');
    if (t.dueDay) {
      const d = moment(t.dueDay, 'YYYY-MM-DD');
      const label = overdue ? d.from(moment(today, 'YYYY-MM-DD')) + ' overdue'
        : t.dueDay === today ? ('today' + (t.timed ? ' · ' + t.timed : ''))
        : d.format('D MMM') + (t.timed ? ' · ' + t.timed : '');
      meta.createSpan({ cls: 'nx-tp-due' + (overdue ? ' is-overdue' : ''), text: label });
    }
    if (t.repeat) { const r = meta.createSpan({ cls: 'nx-tp-rep' }); setIcon(r, 'repeat'); }
    const pl = priorityLabel(t.priority);
    if (pl) meta.createSpan({ cls: 'nx-tp-prio is-' + pl.toLowerCase(), text: pl });
    if (showProject && t.project) meta.createSpan({ cls: 'nx-tp-chip', text: t.project });
    if (t.provider !== 'local' && !t.remoteId) meta.createSpan({ cls: 'nx-tp-pending', text: 'not synced yet' });

    row.onclick = () => this.app.workspace.getLeaf(false).openFile(t.file);
  }

  newTaskRow(main, projectName) {
    const wrap = main.createDiv('nx-tp-new');
    setIcon(wrap.createSpan({ cls: 'nx-tp-new-ic' }), 'plus');
    const input = wrap.createEl('input', {
      cls: 'nx-tp-new-input',
      attr: { type: 'text', placeholder: 'New task in ' + projectName + ' — press Enter' },
    });
    const submit = async () => {
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      input.disabled = true;
      try { await this.addTask(title, projectName); } finally { input.disabled = false; }
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  }
}

module.exports = { NexusTasksPageView };
