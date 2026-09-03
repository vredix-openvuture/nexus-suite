'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · homepage card config
 *  Per-card config: card, list, quicknote, stat, action, hero.
 * ========================================================================== */

const { Modal, Setting, moment, setIcon } = require('obsidian');
const { CARD_DEFS, NX_GREETINGS } = require('../constants.js');
const { getDailyNoteSettings } = require('../lib/helpers.js');
const { nxAutocomplete, nxIconField, nxMultiRow, nxPropGroups, nxPropRulesToGroups, nxPropsToRules } = require('../lib/inputs.js');
const { KIND_LABEL, KIND_ORDER } = require('../lib/orphans.js');

class NexusCardConfigModal extends Modal {
  constructor(plugin, view, id) { super(plugin.app); this.plugin = plugin; this.view = view; this.id = id; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-cardcfg');
    const meta = CARD_DEFS[this.id] || { title: 'Card' };
    contentEl.createEl('h3', { text: 'Configure ' + meta.title });

    const cards = this.plugin.hp().cards || (this.plugin.hp().cards = {});
    const cfg = cards[this.id] || (cards[this.id] = {});
    const d = this.view._cfg(this.id);                 // current merge (for initial values)
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };

    const num = (label, key, min, max, desc) => new Setting(contentEl).setName(label).setDesc(desc || '')
      .addText(t => {
        t.inputEl.type = 'number'; t.inputEl.min = String(min); t.inputEl.max = String(max);
        t.setValue(String(d[key] != null ? d[key] : ''));
        t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { cfg[key] = Math.max(min, Math.min(max, n)); await save(); } });
      });
    const text = (label, key, ph, desc) => new Setting(contentEl).setName(label).setDesc(desc || '')
      .addText(t => t.setPlaceholder(ph || '').setValue(d[key] || '').onChange(async v => { cfg[key] = v.trim(); await save(); }));
    const checks = (label, key, opts) => {
      const wrap = contentEl.createDiv('nx-cardcfg-group');
      wrap.createDiv({ cls: 'nx-cardcfg-group-label', text: label });
      const row = wrap.createDiv('nx-cardcfg-checks');
      let cur = (d[key] || []).slice();
      opts.forEach(o => {
        const lbl = row.createEl('label', { cls: 'nx-cardcfg-check' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = cur.includes(o);
        lbl.createSpan({ text: o });
        cb.onchange = async () => {
          const set = new Set(cur);
          cb.checked ? set.add(o) : set.delete(o);
          cur = [...set]; cfg[key] = cur; await save();
        };
      });
    };

    // Size (always)
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Size (grid units, min. 1)' });
    num('Width', 'w', 1, 48);
    num('Height', 'h', 1, 48);

    // Type-specific
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Content' });
    if (this.id !== 'recent') text('Folder', 'folder', '01 Projects', 'Path prefix in the vault');
    if (this.id === 'projects' || this.id === 'reading') text('Tags (comma)', 'tags', 'project/work, tech', 'empty = all');
    if (this.id === 'projects') { checks('Status', 'statuses', ['aktiv', 'pausiert', 'idee', 'fertig']);
      new Setting(contentEl).setName('Sort by').addDropdown(dd => dd
        .addOption('due', 'Due date').addOption('priority', 'Priority').addOption('created', 'Created').addOption('name', 'Name')
        .setValue(d.sort || 'due').onChange(async v => { cfg.sort = v; await save(); })); }
    if (this.id === 'meetings') new Setting(contentEl).setName('Mode').addDropdown(dd => dd
      .addOption('auto', 'Upcoming, else latest').addOption('upcoming', 'Only upcoming').addOption('past', 'Only latest')
      .setValue(d.mode || 'auto').onChange(async v => { cfg.mode = v; await save(); }));
    if (this.id === 'reading') {
      checks('Status (books)', 'states', ['am-lesen', 'geplant', 'gelesen', 'abgebrochen']);
      text('Cover field', 'coverField', 'cover', 'Frontmatter field for the cover');
      new Setting(contentEl).setName('Also show "geplant"').addToggle(t => t.setValue(!!d.planned).onChange(async v => { cfg.planned = v; await save(); }));
    }
    if (this.id === 'ideas') checks('Status', 'statuses', ['in-prüfung', 'neu', 'umgesetzt']);
    if (this.id === 'recent') text('Exclude folders (comma)', 'exclude', 'JOURNAL, Archive');
    num('Limit (max)', 'count', this.id === 'recent' ? 1 : 0, 60, this.id === 'recent' ? '' : '0 = no limit');

    new Setting(contentEl)
      .addButton(b => b.setButtonText('Reset to defaults')
        .onClick(async () => { delete cards[this.id]; await this.plugin.saveSettings(); this.view.render(); this.close(); }))
      .addButton(b => b.setButtonText('Hide card').setWarning().onClick(async () => {
        const hid = this.plugin.hp().hidden || (this.plugin.hp().hidden = []);
        if (!hid.includes(this.id)) hid.push(this.id);
        await this.plugin.saveSettings(); this.view.render(); this.close();
      }));
  }
  onClose() { this.contentEl.empty(); }
}

class NexusListConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() {
    const { contentEl } = this; contentEl.addClass('nx-cardcfg');
    contentEl.createEl('h3', { text: 'List card' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    const text = (label, key, ph, desc) => new Setting(contentEl).setName(label).setDesc(desc || '')
      .addText(t => t.setPlaceholder(ph || '').setValue(it[key] || '').onChange(async v => { it[key] = v; await save(); }));
    text('Title', 'title', 'My list');
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'list');
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Filter' });
    nxMultiRow(contentEl, 'Folders', 'One folder per line; empty = whole vault', it.folders, ',','SCHOOL/Mathe', v => { it.folders = v; save(); }, () => this.plugin._allFolders());
    nxMultiRow(contentEl, 'Tags', 'One tag per line; empty = all', it.tags, ',','projekt', v => { it.tags = v; save(); }, () => this.plugin._allTags());
    new Setting(contentEl).setName('Name contains').setDesc('Title substring · date tokens in <…>, e.g. <YYYY>-<MM> = current month')
      .addText(t => { t.setValue(it.name || ''); t.onChange(async v => { it.name = v; await save(); }); nxAutocomplete(t.inputEl, () => this.plugin._allNames(), v => { it.name = v; save(); }); });
    if (it.propGroups == null) it.propGroups = it.propRules ? nxPropRulesToGroups(it.propRules) : (it.props ? nxPropRulesToGroups(nxPropsToRules(it.props)) : []);
    nxPropGroups(this.plugin, contentEl, 'Properties', 'Within a group: AND. Between groups: OR.', it.propGroups, arr => { it.propGroups = arr; it.propRules = null; it.props = ''; save(); });
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Display' });
    new Setting(contentEl).setName('Sort by').addDropdown(dd => dd
      .addOption('modified', 'Last modified').addOption('created', 'Created').addOption('name', 'Name').addOption('field', 'Frontmatter field')
      .setValue(it.sort || 'modified').onChange(async v => { it.sort = v; await save(); }));
    text('Sort field', 'sortField', 'due', 'only for "Frontmatter field"');
    new Setting(contentEl).setName('Direction').addDropdown(dd => dd
      .addOption('asc', 'Ascending').addOption('desc', 'Descending').setValue(it.sortDir || 'asc').onChange(async v => { it.sortDir = v; await save(); }));
    new Setting(contentEl).setName('Layout').addDropdown(dd => dd
      .addOption('list', 'List').addOption('covers', 'Cover gallery')
      .setValue(it.display || 'list').onChange(async v => { it.display = v; await save(); }));
    text('Cover field', 'coverField', 'cover', 'for cover gallery: frontmatter field for the image');
    text('Meta info', 'meta', 'modified', 'list: field name, or "modified"/"created"/"none"');
    new Setting(contentEl).setName('Limit (max)').addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.count || 8)); t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { it.count = Math.max(1, n); await save(); } }); });
    new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => { const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1); await this.plugin.saveSettings(); this.view.render(); this.close(); }));
  }
  onClose() { this.contentEl.empty(); }
}

class NexusScratchConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() {
    const { contentEl } = this; contentEl.addClass('nx-cardcfg');
    contentEl.createEl('h3', { text: 'Scratch card' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Scratch').onChange(async v => { it.title = v; await save(); }));
    new Setting(contentEl).setName('Target folder').setDesc('New notes go here (empty = vault root).').addText(t => t.setPlaceholder('Inbox').setValue(it.folder || '').onChange(async v => { it.folder = v; await save(); }));
    new Setting(contentEl).setName('Template (note path)').setDesc('Optional. Tokens: {{content}} {{date}} {{time}} {{title}}').addText(t => t.setPlaceholder('Templates/Scratch.md').setValue(it.template || '').onChange(async v => { it.template = v; await save(); }));
    contentEl.createEl('p', { cls: 'setting-item-description', text: 'Filename is automatic: YYYY-MM-DD_HH-mm' });
    new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => { const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1); await this.plugin.saveSettings(); this.view.render(); this.close(); }));
  }
  onClose() { this.contentEl.empty(); }
}

/* Orphan finder: what counts as "unreferenced", which files to look at, and
   (for notes) which of them are even candidates. Re-renders on every change so
   the note-only sections appear/disappear with the "Notes" file type. */
class NexusOrphanConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Orphan finder' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    const kinds = Array.isArray(it.kinds) ? it.kinds : (it.kinds = ['image']);
    const hasNotes = kinds.includes('note');

    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Orphans').onChange(async v => { it.title = v; await save(); }));
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'unlink');

    // ── What to look at ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'File types' });
    const wrap = contentEl.createDiv('nx-cardcfg-group');
    const row = wrap.createDiv('nx-cardcfg-checks');
    KIND_ORDER.forEach(k => {
      const lbl = row.createEl('label', { cls: 'nx-cardcfg-check' });
      const cb = lbl.createEl('input', { type: 'checkbox' });
      cb.checked = kinds.includes(k);
      lbl.createSpan({ text: KIND_LABEL[k] });
      cb.onchange = async () => {
        const set = new Set(it.kinds);
        cb.checked ? set.add(k) : set.delete(k);
        it.kinds = KIND_ORDER.filter(x => set.has(x));      // keep a stable order
        await save(); this.render();
      };
    });

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Scope' });
    nxMultiRow(contentEl, 'Folders', 'One folder per line; empty = whole vault', it.folders, ',', 'attachments', v => { it.folders = v; save(); }, () => this.plugin._allFolders());
    nxMultiRow(contentEl, 'Exclude folders', 'Never listed, e.g. Archive', it.exclude, ',', 'Archive', v => { it.exclude = v; save(); }, () => this.plugin._allFolders());

    // ── What counts as a reference ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'What counts as "linked"' });
    if (hasNotes) new Setting(contentEl).setName('Notes are orphaned when').setDesc('Attachments are always judged by incoming links only.')
      .addDropdown(dd => dd
        .addOption('incoming', 'Nothing links to them')
        .addOption('isolated', 'Fully isolated (no in- and no outgoing links)')
        .setValue(it.mode || 'incoming').onChange(async v => { it.mode = v; await save(); }));
    new Setting(contentEl).setName('Count frontmatter paths')
      .setDesc('banner:, cover:, image: … — plain paths that Obsidian does not index as links.')
      .addToggle(t => t.setValue(it.countFrontmatter !== false).onChange(async v => { it.countFrontmatter = v; await save(); }));
    new Setting(contentEl).setName('Count canvas references')
      .setDesc('File nodes and links inside .canvas boards.')
      .addToggle(t => t.setValue(it.countCanvas !== false).onChange(async v => { it.countCanvas = v; await save(); }));

    // ── Which notes are candidates at all ──
    if (hasNotes) {
      contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Note filter (markdown only)' });
      new Setting(contentEl).setName('Tags').addDropdown(dd => dd
        .addOption('any', 'Any — tagged or not')
        .addOption('none', 'Only notes without any tag')
        .addOption('some', 'Only notes that have tags')
        .setValue(it.tagState || 'any').onChange(async v => { it.tagState = v; await save(); this.render(); }));
      if ((it.tagState || 'any') !== 'none') {
        nxMultiRow(contentEl, 'Must have one of', 'One tag per line; empty = ignore', it.tags, ',', 'projekt', v => { it.tags = v; save(); }, () => this.plugin._allTags());
        nxMultiRow(contentEl, 'Must not have', 'One tag per line; empty = ignore', it.tagsNot, ',', 'archiv', v => { it.tagsNot = v; save(); }, () => this.plugin._allTags());
      }
      new Setting(contentEl).setName('Frontmatter').addDropdown(dd => dd
        .addOption('any', 'Any — with or without')
        .addOption('none', 'Only notes with no/empty frontmatter')
        .addOption('some', 'Only notes that have frontmatter')
        .setValue(it.fmState || 'any').onChange(async v => { it.fmState = v; await save(); this.render(); }));
      if ((it.fmState || 'any') !== 'none') {
        if (!Array.isArray(it.propGroups)) it.propGroups = [];
        if (!Array.isArray(it.propGroupsNot)) it.propGroupsNot = [];
        nxPropGroups(this.plugin, contentEl, 'Properties — must match', 'Within a group: AND. Between groups: OR. Empty = ignore.', it.propGroups, arr => { it.propGroups = arr; save(); });
        nxPropGroups(this.plugin, contentEl, 'Properties — must NOT match', 'Notes matching this are skipped.', it.propGroupsNot, arr => { it.propGroupsNot = arr; save(); });
      }
      new Setting(contentEl).setName('Name contains').setDesc('Title substring · date tokens in <…>')
        .addText(t => { t.setValue(it.name || ''); t.onChange(async v => { it.name = v; await save(); }); nxAutocomplete(t.inputEl, () => this.plugin._allNames(), v => { it.name = v; save(); }); });
    }

    // ── Display ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Display' });
    new Setting(contentEl).setName('Layout').addDropdown(dd => dd
      .addOption('list', 'List').addOption('grid', 'Thumbnail grid')
      .setValue(it.display || 'list').onChange(async v => { it.display = v; await save(); }));
    new Setting(contentEl).setName('Sort by').addDropdown(dd => dd
      .addOption('size', 'Size').addOption('modified', 'Last modified').addOption('created', 'Created')
      .addOption('name', 'Name').addOption('path', 'Path')
      .setValue(it.sort || 'size').onChange(async v => { it.sort = v; await save(); }));
    new Setting(contentEl).setName('Direction').addDropdown(dd => dd
      .addOption('desc', 'Descending').addOption('asc', 'Ascending')
      .setValue(it.sortDir || 'desc').onChange(async v => { it.sortDir = v; await save(); }));
    new Setting(contentEl).setName('Show folder path').addToggle(t => t.setValue(it.showPath !== false).onChange(async v => { it.showPath = v; await save(); }));
    new Setting(contentEl).setName('Limit (max shown)').setDesc('The header always counts every match.')
      .addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.count || 25)); t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { it.count = Math.max(1, n); await save(); } }); });

    // Side panels use the same modal on a settings-backed config object — there
    // is no widget list to remove them from.
    if (this.view._widgets) new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => {
      const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ── Calendar card ──
   The events of the coming days (or a compact month grid) from the same cache
   the calendar page reads — see views/homepage.js · _wCalendar. */
class NexusCalendarCardConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Calendar card' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Calendar').onChange(async v => { it.title = v; await save(); }));
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'calendar-check');

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'View' });
    new Setting(contentEl).setName('Layout').addDropdown(dd => dd
      .addOption('agenda', 'Agenda — upcoming events')
      .addOption('week', 'Week — one line per day, from the planner')
      .addOption('month', 'Month — grid with dots')
      .setValue(it.display || 'agenda').onChange(async v => { it.display = v; await save(); this.render(); }));
    if ((it.display || 'agenda') === 'agenda') {
      new Setting(contentEl).setName('Days ahead').setDesc('How far the agenda looks (1–60).')
        .addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.days || 7));
          t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { it.days = Math.max(1, Math.min(60, n)); await save(); } }); });
      new Setting(contentEl).setName('Include events already over')
        .setDesc('Off = the card only shows what is still to come today.')
        .addToggle(t => t.setValue(!!it.past).onChange(async v => { it.past = v; await save(); }));
      new Setting(contentEl).setName('Limit (max shown)')
        .addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.count || 12));
          t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { it.count = Math.max(1, n); await save(); } }); });
    }

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Calendars' });
    const cals = (this.plugin.settings.tasksCalendar.localCalendars || [])
      .map(c => c.name).filter(Boolean);
    nxMultiRow(contentEl, 'Only these calendars', 'One name per line; empty = all. Substring is enough.',
      it.calendars, ',', cals[0] || 'Personal', v => { it.calendars = v; save(); }, () => cals);

    // Side panels use the same modal on a settings-backed config object — there
    // is no widget list to remove them from.
    if (this.view._widgets) new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => {
      const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ── Tasks card ──
   Same filters an agenda block understands (state / due / priority / project),
   because both run through lib/agenda.js · collectTasks. */
class NexusTaskCardConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Tasks card' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Tasks').onChange(async v => { it.title = v; await save(); }));
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'list-checks');

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Which tasks' });
    const tasks = require('../lib/tasks.js');
    nxMultiRow(contentEl, 'Projects', 'One project per line; empty = all projects', it.projects, ',', 'Nexus Suite',
      v => { it.projects = v; save(); }, () => tasks.listProjects(this.plugin));
    new Setting(contentEl).setName('State').addDropdown(dd => dd
      .addOption('open', 'Open').addOption('done', 'Done').addOption('all', 'Both')
      .setValue(it.state || 'open').onChange(async v => { it.state = v; await save(); }));

    // Due buckets, same vocabulary as the agenda block's `due:` line.
    const DUE = [['day', 'Due today'], ['overdue', 'Overdue'], ['week', 'This week'],
      ['month', 'This month'], ['upcoming', 'Later'], ['none', 'No due date'], ['any', 'Everything']];
    const wrap = contentEl.createDiv('nx-cardcfg-group');
    wrap.createDiv({ cls: 'nx-cardcfg-group-label', text: 'Due' });
    const row = wrap.createDiv('nx-cardcfg-checks');
    if (!Array.isArray(it.due)) it.due = ['day', 'overdue'];
    DUE.forEach(([id, label]) => {
      const lbl = row.createEl('label', { cls: 'nx-cardcfg-check' });
      const cb = lbl.createEl('input', { type: 'checkbox' });
      cb.checked = it.due.includes(id);
      lbl.createSpan({ text: label });
      cb.onchange = async () => {
        const set = new Set(it.due);
        cb.checked ? set.add(id) : set.delete(id);
        it.due = DUE.map(d => d[0]).filter(x => set.has(x));
        if (!it.due.length) it.due = ['any'];
        await save();
      };
    });
    new Setting(contentEl).setName('Priority at least').setDesc('Empty = any. Also accepts low / medium / high.')
      .addText(t => t.setPlaceholder('high').setValue(it.priority || '').onChange(async v => { it.priority = v.trim(); await save(); }));

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Display' });
    new Setting(contentEl).setName('Sort by').addDropdown(dd => dd
      .addOption('smart', 'Smart (overdue → today → later)').addOption('due', 'Due date')
      .addOption('priority', 'Priority').addOption('title', 'A–Z')
      .setValue(it.sort || 'smart').onChange(async v => { it.sort = v; await save(); }));
    new Setting(contentEl).setName('Limit (max shown)')
      .addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.count || 12));
        t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { it.count = Math.max(1, n); await save(); } }); });

    // Side panels use the same modal on a settings-backed config object — there
    // is no widget list to remove them from.
    if (this.view._widgets) new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => {
      const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ── Random note card ──
   Same filter vocabulary as the list card — it just picks ONE of the matches
   and shows it, so old notes resurface on their own. */
class NexusRandomConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Random note card' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Random note').onChange(async v => { it.title = v; await save(); }));
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'shuffle');

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Pick from' });
    nxMultiRow(contentEl, 'Folders', 'One folder per line; empty = whole vault', it.folders, ',', 'Journal',
      v => { it.folders = v; save(); }, () => this.plugin._allFolders());
    nxMultiRow(contentEl, 'Tags', 'One tag per line; empty = all', it.tags, ',', 'idee',
      v => { it.tags = v; save(); }, () => this.plugin._allTags());
    nxMultiRow(contentEl, 'Exclude folders', 'Never picked, e.g. Templates', it.exclude, ',', 'Templates',
      v => { it.exclude = v; save(); }, () => this.plugin._allFolders());
    new Setting(contentEl).setName('Name contains').setDesc('Title substring · date tokens in <…>')
      .addText(t => { t.setValue(it.name || ''); t.onChange(async v => { it.name = v; await save(); });
        nxAutocomplete(t.inputEl, () => this.plugin._allNames(), v => { it.name = v; save(); }); });
    if (!Array.isArray(it.propGroups)) it.propGroups = [];
    nxPropGroups(this.plugin, contentEl, 'Properties', 'Within a group: AND. Between groups: OR.',
      it.propGroups, arr => { it.propGroups = arr; save(); });
    new Setting(contentEl).setName('Minimum age (days)')
      .setDesc('0 = anything. Higher values keep what you just wrote out of the draw.')
      .addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.minAge || 0));
        t.onChange(async v => { const n = parseInt(v, 10); it.minAge = isNaN(n) ? 0 : Math.max(0, n); await save(); }); });

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Display' });
    new Setting(contentEl).setName('When to draw a new note').addDropdown(dd => dd
      .addOption('open', 'Every time the dashboard opens').addOption('day', 'Once per day')
      .setValue(it.mode || 'open').onChange(async v => { it.mode = v; await save(); }));
    new Setting(contentEl).setName('Preview length (lines)').setDesc('0 = title only')
      .addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.lines == null ? 20 : it.lines));
        t.onChange(async v => { const n = parseInt(v, 10); it.lines = isNaN(n) ? 20 : Math.max(0, Math.min(400, n)); await save(); }); });
    new Setting(contentEl).setName('Show banner image').setDesc("The note's banner: / cover: as a header.")
      .addToggle(t => t.setValue(it.showBanner !== false).onChange(async v => { it.showBanner = v; await save(); }));
    new Setting(contentEl).setName('Show path and date')
      .addToggle(t => t.setValue(it.showMeta !== false).onChange(async v => { it.showMeta = v; await save(); }));

    // Side panels use the same modal on a settings-backed config object — there
    // is no widget list to remove them from.
    if (this.view._widgets) new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => {
      const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ── Quick sketch card ──
   The sketch files themselves (.svg written by the sketch pad), newest first,
   as thumbnails you can open or draw on right away. */
class NexusSketchConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Quick sketch card' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Quick sketches').onChange(async v => { it.title = v; await save(); }));
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'pencil-line');

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Source' });
    nxMultiRow(contentEl, 'Folders', 'One folder per line; empty = the sketch folder from the settings ("'
      + (this.plugin.settings.quicksketch.folder || 'Inbox/Quicksketch') + '")',
      it.folders, ',', this.plugin.settings.quicksketch.folder || 'Inbox/Quicksketch',
      v => { it.folders = v; save(); }, () => this.plugin._allFolders());
    new Setting(contentEl).setName('Also list sketches inside notes')
      .setDesc('Notes that carry a drawing of their own (frontmatter `sketch:`), not just standalone files.')
      .addToggle(t => t.setValue(!!it.includeNotes).onChange(async v => { it.includeNotes = v; await save(); }));

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Display' });
    new Setting(contentEl).setName('Layout').addDropdown(dd => dd
      .addOption('grid', 'Thumbnail grid').addOption('list', 'List')
      .setValue(it.display || 'grid').onChange(async v => { it.display = v; await save(); }));
    new Setting(contentEl).setName('Sort by').addDropdown(dd => dd
      .addOption('modified', 'Last modified').addOption('created', 'Created').addOption('name', 'Name')
      .setValue(it.sort || 'modified').onChange(async v => { it.sort = v; await save(); }));
    new Setting(contentEl).setName('Show file name')
      .addToggle(t => t.setValue(it.showName !== false).onChange(async v => { it.showName = v; await save(); }));
    new Setting(contentEl).setName('Limit (max shown)')
      .addText(t => { t.inputEl.type = 'number'; t.setValue(String(it.count || 8));
        t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { it.count = Math.max(1, n); await save(); } }); });

    // Side panels use the same modal on a settings-backed config object — there
    // is no widget list to remove them from.
    if (this.view._widgets) new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => {
      const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

class NexusStatConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() {
    const { contentEl } = this; contentEl.addClass('nx-cardcfg');
    contentEl.createEl('h3', { text: 'Stat tile' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    const text = (label, key, ph, desc) => new Setting(contentEl).setName(label).setDesc(desc || '')
      .addText(t => t.setPlaceholder(ph || '').setValue(it[key] || '').onChange(async v => { it[key] = v; await save(); }));
    text('Label', 'label', it.kind === 'streak' ? 'Journal streak' : it.kind === 'total' ? 'Total notes' : 'Counter');
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon,
      v => { it.icon = v; save(); }, it.kind === 'streak' ? 'flame' : it.kind === 'total' ? 'files' : 'hash');
    if (it.kind === 'streak') {
      const dn = getDailyNoteSettings(this.app);
      contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Journal source' });
      text('Folder', 'folder', dn.folder || 'JOURNAL', 'Journal folder (empty = Daily Notes setting: "' + (dn.folder || '—') + '")');
      text('Date format', 'format', dn.format, 'moment format like the filename, e.g. YYYY.MM.DD (empty = Daily Notes: "' + dn.format + '")');
    }
    if (it.kind !== 'streak' && it.kind !== 'total') {
      contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Query (counts matching notes)' });
      nxMultiRow(contentEl, 'Folders', 'One folder per line; empty = whole vault', it.folders, ',','School/Math', v => { it.folders = v; save(); }, () => this.plugin._allFolders());
      nxMultiRow(contentEl, 'Tags', 'One tag per line; empty = all', it.tags, ',','project', v => { it.tags = v; save(); }, () => this.plugin._allTags());
      new Setting(contentEl).setName('Name contains').setDesc('Title substring · date tokens in <…>, e.g. <YYYY>-<MM> = current month')
        .addText(t => { t.setValue(it.name || ''); t.onChange(async v => { it.name = v; await save(); }); nxAutocomplete(t.inputEl, () => this.plugin._allNames(), v => { it.name = v; save(); }); });
      if (it.propGroups == null) it.propGroups = it.propRules ? nxPropRulesToGroups(it.propRules) : (it.props ? nxPropRulesToGroups(nxPropsToRules(it.props)) : []);
      nxPropGroups(this.plugin, contentEl, 'Properties', 'Within a group: AND. Between groups: OR.', it.propGroups, arr => { it.propGroups = arr; it.propRules = null; it.props = ''; save(); });
    }
    new Setting(contentEl).addButton(b => b.setButtonText('Remove').setWarning().onClick(async () => {
      const arr = this.plugin.hp().stats || []; const i = arr.indexOf(it); if (i >= 0) arr.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

class NexusActionConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Action' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    new Setting(contentEl).setName('Label').addText(t => t.setValue(it.label || '').onChange(async v => { it.label = v; await save(); }));
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'circle');
    new Setting(contentEl).setName('Purpose').setDesc('What the button does')
      .addDropdown(dd => {
        dd.addOption('journal', "Today's journal");
        dd.addOption('newNote', 'New note');
        dd.addOption('search', 'Open search');
        dd.addOption('calendar', 'Open calendar');
        dd.addOption('note', 'Open a specific note …');
        dd.addOption('command', 'Run Obsidian command …');
        dd.addOption('url', 'Open URL …');
        dd.setValue(it.kind || 'command');
        dd.onChange(async v => { it.kind = v; it.arg = ''; await save(); this.render(); });
      });
    if (it.kind === 'note') {
      new Setting(contentEl).setName('Note').setDesc('Note name (suggestions as you type)')
        .addText(t => { t.setValue(it.arg || ''); t.onChange(async v => { it.arg = v; await save(); }); nxAutocomplete(t.inputEl, () => this.view._allNames(), v => { it.arg = v; save(); }); });
    } else if (it.kind === 'command') {
      new Setting(contentEl).setName('Command').setDesc('Obsidian command name (suggestions as you type)')
        .addText(t => {
          t.setValue(this.view._cmdNameById(it.arg) || '');
          const commit = async (name) => { const id = this.view._cmdIdByName(name); if (id) { it.arg = id; await save(); } };
          t.onChange(commit);
          nxAutocomplete(t.inputEl, () => this.view._allCommands(), commit);
        });
    } else if (it.kind === 'url') {
      new Setting(contentEl).setName('URL').addText(t => t.setPlaceholder('https://…').setValue(it.arg || '').onChange(async v => { it.arg = v; await save(); }));
    }
    new Setting(contentEl).addButton(b => b.setButtonText('Remove').setWarning().onClick(async () => {
      const arr = this.plugin.hp().actions || []; const i = arr.indexOf(it); if (i >= 0) arr.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

class NexusHeroSettingsModal extends Modal {
  constructor(plugin, view) { super(plugin.app); this.plugin = plugin; this.view = view; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Hero settings' });
    const s = this.plugin.hp();
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };

    // ── Image ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Image' });
    const imgRow = new Setting(contentEl).setName('Background image')
      .addButton(b => b.setButtonText(s.hero ? 'Change …' : 'Choose …').onClick(() => this.view._pickHero()));
    if (s.hero) imgRow.addButton(b => b.setButtonText('Remove').setWarning()
      .onClick(async () => { s.hero = ''; await save(); this.render(); }));
    if (s.hero) new Setting(contentEl).setName('Image position (vertical)').setDesc('0 = top … 100 = bottom')
      .addSlider(sl => sl.setLimits(0, 100, 1).setValue(s.heroPosY != null ? s.heroPosY : 50).setDynamicTooltip()
        .onChange(async v => { s.heroPosY = v; await save(); }));

    // ── Size ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Size' });
    new Setting(contentEl).setName('Height (px)')
      .addSlider(sl => sl.setLimits(90, 400, 10).setValue(s.heroHeight || 150).setDynamicTooltip()
        .onChange(async v => { s.heroHeight = v; await save(); }))
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default').onClick(async () => { s.heroHeight = null; await save(); this.render(); }));

    // ── Greeting ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Greeting' });
    new Setting(contentEl).setName('Style').addDropdown(dd => {
      dd.addOption('classic', 'Classic'); dd.addOption('formal', 'Formal'); dd.addOption('buddy', 'Buddy');
      dd.addOption('funny', 'Funny'); dd.addOption('commander', 'Commander'); dd.addOption('zen', 'Zen');
      dd.addOption('motivate', 'Motivational'); dd.addOption('hacker', 'Hacker');
      dd.setValue(s.greetStyle || 'classic');
      dd.onChange(async v => { s.greetStyle = v; await save(); this.render(); });
    });
    const previewText = () => 'Preview: "' + (NX_GREETINGS[s.greetStyle] || NX_GREETINGS.classic)(moment().hour(), (s.name || '').trim()) + '"';
    const preview = contentEl.createEl('div', { cls: 'setting-item-description', text: previewText() });
    new Setting(contentEl).setName('Name').setDesc('For the greeting (empty = no name)')
      .addText(t => t.setValue(s.name || '').onChange(async v => { s.name = v; await save(); preview.setText(previewText()); }));

    // ── Hero style (no image) ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Hero surface (when no image)' });
    new Setting(contentEl).setName('Style').addDropdown(dd => {
      dd.addOption('accent', 'Accent gradient'); dd.addOption('solid', 'Solid'); dd.addOption('flat', 'Flat (border)');
      dd.setValue(s.heroStyle || 'accent'); dd.onChange(async v => { s.heroStyle = v; await save(); });
    });

    // ── Buttons ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Buttons' });
    new Setting(contentEl).setName('Style').addDropdown(dd => {
      dd.addOption('default', 'Default'); dd.addOption('round', 'Round'); dd.addOption('noborder', 'No border');
      dd.addOption('flat', 'Flat'); dd.addOption('glassy', 'Glass');
      dd.setValue(s.btnStyle || 'default'); dd.onChange(async v => { s.btnStyle = v; await save(); });
    });
  }
  onClose() { this.contentEl.empty(); }
}

class NexusHabitConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h3', { text: 'Habit tracker' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };

    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Habit').onChange(async v => { it.title = v; await save(); }));
    nxIconField(this.app, contentEl, 'Icon', 'Pick from list', () => it.icon, v => { it.icon = v; save(); }, 'flame');

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Data' });
    new Setting(contentEl).setName('Frontmatter property').setDesc("Read from each day's daily note")
      .addText(t => {
        t.setPlaceholder('steps').setValue(it.prop || '');
        t.onChange(async v => { it.prop = v.trim(); await save(); });
        nxAutocomplete(t.inputEl, () => this.view._allPropKeys(), v => { it.prop = v.trim(); save(); });
      });
    new Setting(contentEl).setName('Type').addDropdown(dd => dd
      .addOption('number', 'Number').addOption('checkbox', 'Checkbox')
      .setValue(it.mode || 'number').onChange(async v => { it.mode = v; await save(); this.render(); }));
    new Setting(contentEl).setName('Period').addDropdown(dd => dd
      .addOption('week', 'Week (1 per day)').addOption('month', 'Month (1 per day)')
      .addOption('quartal', 'Quarter (1 per day)').addOption('year', 'Year (1 per month)')
      .setValue(it.period || 'month').onChange(async v => { it.period = v; await save(); }));

    if ((it.mode || 'number') === 'number') {
      contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Levels (shade thresholds)' });
      const lvl = (label, key, ph) => new Setting(contentEl).setName(label)
        .addText(t => {
          t.inputEl.type = 'number';
          t.setPlaceholder(ph).setValue(it[key] != null && it[key] !== '' ? String(it[key]) : '');
          t.onChange(async v => { const n = parseFloat(v); it[key] = isNaN(n) ? '' : n; await save(); });
        });
      lvl('Low', 'low', '4000');
      lvl('Medium', 'medium', '8000');
      lvl('High', 'high', '12000');
    }

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Appearance' });
    new Setting(contentEl).setName('Colour').setDesc('Base colour of the heatmap shades')
      .addColorPicker(cp => cp.setValue(it.color || '#5b8def').onChange(async v => { it.color = v; await save(); }))
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Use theme accent').onClick(async () => { it.color = ''; await save(); this.render(); }));

    const dn = getDailyNoteSettings(this.app);
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Daily-note source (optional override)' });
    new Setting(contentEl).setName('Folder').setDesc('empty = Daily Notes setting: "' + (dn.folder || '—') + '"')
      .addText(t => t.setPlaceholder(dn.folder || 'JOURNAL').setValue(it.folder || '').onChange(async v => { it.folder = v.trim(); await save(); }));
    new Setting(contentEl).setName('Date format').setDesc('empty = Daily Notes: "' + dn.format + '"')
      .addText(t => t.setPlaceholder(dn.format).setValue(it.format || '').onChange(async v => { it.format = v.trim(); await save(); }));

    // Side panels use the same modal on a settings-backed config object — there
    // is no widget list to remove them from.
    if (this.view._widgets) new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => {
      const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusCalendarCardConfigModal, NexusCardConfigModal, NexusHabitConfigModal, NexusListConfigModal, NexusOrphanConfigModal, NexusScratchConfigModal, NexusRandomConfigModal, NexusSketchConfigModal, NexusStatConfigModal, NexusTaskCardConfigModal, NexusActionConfigModal, NexusHeroSettingsModal };
