'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · homepage card config
 *  Per-card config: card, list, quicknote, stat, action, hero.
 * ========================================================================== */

const { Modal, Setting, moment, setIcon } = require('obsidian');
const { CARD_DEFS, NX_GREETINGS } = require('../constants.js');
const { getDailyNoteSettings } = require('../lib/helpers.js');
const { nxAutocomplete, nxIconField, nxMultiRow, nxPropGroups, nxPropRulesToGroups, nxPropsToRules } = require('../lib/inputs.js');

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

class NexusQuicknoteConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() {
    const { contentEl } = this; contentEl.addClass('nx-cardcfg');
    contentEl.createEl('h3', { text: 'Quicknote card' });
    const it = this.item;
    const save = async () => { await this.plugin.saveSettings(); this.view.render(); };
    new Setting(contentEl).setName('Title').addText(t => t.setValue(it.title || 'Quicknote').onChange(async v => { it.title = v; await save(); }));
    new Setting(contentEl).setName('Target folder').setDesc('New notes go here (empty = vault root).').addText(t => t.setPlaceholder('Inbox').setValue(it.folder || '').onChange(async v => { it.folder = v; await save(); }));
    new Setting(contentEl).setName('Template (note path)').setDesc('Optional. Tokens: {{content}} {{date}} {{time}} {{title}}').addText(t => t.setPlaceholder('Templates/Quicknote.md').setValue(it.template || '').onChange(async v => { it.template = v; await save(); }));
    contentEl.createEl('p', { cls: 'setting-item-description', text: 'Filename is automatic: YYYY-MM-DD_HH-mm' });
    new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => { const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1); await this.plugin.saveSettings(); this.view.render(); this.close(); }));
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

    new Setting(contentEl).addButton(b => b.setButtonText('Remove card').setWarning().onClick(async () => {
      const ws = this.view._widgets(); const i = ws.indexOf(it); if (i >= 0) ws.splice(i, 1);
      await this.plugin.saveSettings(); this.view.render(); this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusCardConfigModal, NexusHabitConfigModal, NexusListConfigModal, NexusQuicknoteConfigModal, NexusStatConfigModal, NexusActionConfigModal, NexusHeroSettingsModal };
