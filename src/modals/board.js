'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · one folder board
 *  Edits ONE board. Everything is written straight back into the code block in
 *  the note — no hidden state in data.json, so the board travels with the file
 *  and stays editable by hand.
 * ========================================================================== */

const { Modal, Setting } = require('obsidian');
const { nxAutocomplete, nxMultiRow } = require('../lib/inputs.js');
const { DEFAULT_STATES, countNotes } = require('../lib/board.js');

class NexusBoardConfigModal extends Modal {
  constructor(plugin, cfg, onSave) {
    super(plugin.app);
    this.plugin = plugin;
    // The columns are shared structure, so they are copied rather than aliased:
    // Cancel has to leave the rendered board exactly as it was.
    this.cfg = Object.assign({}, cfg, {
      buckets: (cfg.buckets || []).map(b => Object.assign({}, b)),
      given: Object.assign({}, cfg.given),
    });
    this.onSave = onSave;
  }
  onOpen() { this.contentEl.addClass('nx-cardcfg'); this.render(); }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Folder board' });
    const c = this.cfg;
    let count = () => {};

    new Setting(contentEl).setName('Title').setDesc('Empty = the folder name.')
      .addText(t => t.setPlaceholder('Biology').setValue(c.title || '').onChange(v => { c.title = v.trim(); }));
    new Setting(contentEl).setName('Folder')
      .setDesc('Every note in here is shown — the board never filters anything out.')
      .addText(t => { t.setPlaceholder('SCHOOL/Biology').setValue(c.folder || '');
        t.onChange(v => { c.folder = v.trim().replace(/^\/|\/$/g, ''); count(); });
        nxAutocomplete(t.inputEl, () => this.plugin._allFolders(), v => { c.folder = v; count(); }); });
    const tally = contentEl.createDiv('nx-kb-preview');
    count = () => {
      tally.empty();
      const n = countNotes(this.plugin.app, c);
      tally.createDiv({ cls: 'nx-kb-preview-head',
        text: n ? n + ' notes in this folder' : 'No notes in this folder.' });
    };
    count();

    new Setting(contentEl).setName('View').setDesc('Switchable any time from the board itself.')
      .addDropdown(dd => dd.addOption('board', 'Columns — by working state').addOption('grid', 'Grid — all notes')
        .addOption('graph', 'Graph — the links between them')
        .setValue(c.mode === 'grid' || c.mode === 'graph' ? c.mode : 'board')
        .onChange(v => { c.mode = v; c.given.mode = c.given.mode || 'view'; }));
    new Setting(contentEl).setName('Sort by')
      .addDropdown(dd => dd.addOption('name', 'Name').addOption('modified', 'Last modified')
        .addOption('created', 'Created').addOption('state', 'Working state')
        .setValue(c.sort || 'name').onChange(v => { c.sort = v; }));
    new Setting(contentEl).setName('Direction')
      .addDropdown(dd => dd.addOption('asc', 'Ascending').addOption('desc', 'Descending')
        .setValue(c.dir || 'asc').onChange(v => { c.dir = v; }));
    new Setting(contentEl).setName('Card size')
      .addDropdown(dd => dd.addOption('small', 'Small').addOption('medium', 'Medium').addOption('large', 'Large')
        .setValue(c.size || 'medium').onChange(v => { c.size = v; }));

    // ── working state ──
    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Working state' });
    contentEl.createEl('p', { cls: 'setting-item-description',
      text: 'Written into the note itself, so it survives without this plugin and other cards can use it too. The first column means "nothing set" — those notes stay clean, no property is written for them.' });
    new Setting(contentEl).setName('Property')
      .addText(t => { t.setPlaceholder('status').setValue(c.statusProp || 'status');
        t.onChange(v => { c.statusProp = v.trim() || 'status'; });
        nxAutocomplete(t.inputEl, () => this.plugin._allPropKeys(), v => { c.statusProp = v; }); });
    const labels = (c.buckets || []).length ? c.buckets.map(b => b.title) : DEFAULT_STATES;
    nxMultiRow(contentEl, 'Columns', 'One per line, in column order. The first one is the "not started" pile.',
      labels.join('\n'), '\n', 'In Arbeit',
      v => {
        const kept = new Map((c.buckets || []).map(b => [b.title, b]));
        c.buckets = v.split('\n').map(x => x.trim()).filter(Boolean)
          // A renamed column keeps its WIP limit and whatever the parser could
          // not read; only the title changes.
          .map(title => Object.assign({ limit: 0, cards: [], extra: [] }, kept.get(title), { title }));
      });

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'What a card shows' });
    const flag = (key, name, desc) => new Setting(contentEl).setName(name).setDesc(desc || '')
      .addToggle(t => t.setValue(c[key] !== false).onChange(v => { c[key] = v; }));
    flag('state', 'State dot', 'A coloured dot on every card — click it to step to the next state.');
    flag('excerpt', 'First sentence', 'A preview line so cards can be told apart without opening them.');
    flag('tags', 'Tags', 'Up to three, as chips.');
    flag('links', 'Connections', 'How many notes of this folder it links to — hovering lights them up.');
    flag('orphans', 'Mark unconnected notes', 'Notes nothing in this folder links to, and that link nowhere themselves.');
    new Setting(contentEl).setName('Extra properties').setDesc('Comma separated, shown as badges — e.g. due, rating.')
      .addText(t => { t.setPlaceholder('due').setValue(c.props || '');
        t.onChange(v => { c.props = v.trim(); });
        nxAutocomplete(t.inputEl, () => this.plugin._allPropKeys(), v => { c.props = v; }); });

    contentEl.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Graph' });
    new Setting(contentEl).setName('Show the link web under the board')
      .setDesc('Only this folder\'s notes and the links between them, coloured by state. Off by default — it is an extra, not the board.')
      .addToggle(t => t.setValue(!!c.graph).onChange(v => { c.graph = v; this.render(); }));
    if (c.graph) {
      new Setting(contentEl).setName('Height')
        .addSlider(sl => sl.setLimits(140, 520, 20).setValue(c.height || 260).setDynamicTooltip()
          .onChange(v => { c.height = v; }));
    }

    new Setting(contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Save').setCta().onClick(() => { this.close(); this.onSave(this.cfg); }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusBoardConfigModal };
