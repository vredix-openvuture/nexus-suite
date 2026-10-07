'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings · workspace tools
 *  Settings pages: Icons, Kanban, Hider, Workspaces, Galaxy, Search.
 *  Mixed into the settings tab (lib/mixin.js); `this` is the tab.
 * ========================================================================== */

const { Notice, Setting, setIcon } = require('obsidian');
const { SEARCH_FIELDS } = require('../modals/search.js');
const { NexusWorkspaceModal } = require('../modals/workspace.js');
const { NexusConfirmModal, NexusNameModal } = require('../modals/misc.js');
const { nxAutocomplete, nxBlockExample, nxMultiRow } = require('../lib/inputs.js');
const { nxAllFolders } = require('../lib/helpers.js');

class WorkspacePages {

  tIcons(e) {
    const s = this.plugin.settings.icons;
    const refresh = () => { if (this.plugin.icons) this.plugin.icons.refresh(); };
    this.head(e, s, refresh);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'An icon for any folder or file, shown in the explorer. Assign one by right-clicking the item → "Set icon …". Emoji work too.' });

    new Setting(e).setName('Import from icon-folder').setDesc('Takes over the assignments from the obsidian-icon-folder plugin (its Lucide names are converted).')
      .addButton(b => b.setButtonText('Import').onClick(async () => {
        if (this.plugin.icons) await this.plugin.icons.migrateFromIconFolder();
        this.display();
      }));

    const map = (s.map && typeof s.map === 'object') ? s.map : (s.map = {});
    const paths = Object.keys(map).sort((a, b) => a.localeCompare(b));
    const broken = new Set(this.plugin.icons ? this.plugin.icons.unresolvedIcons() : []);
    if (broken.size) e.createEl('p', { cls: 'setting-item-description',
      text: broken.size + ' assignment(s) name an icon this Obsidian does not ship (they render as nothing) — marked below.' });
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Assigned icons (' + paths.length + ')' });
    if (!paths.length) e.createEl('p', { cls: 'setting-item-description', text: '— none yet —' });
    paths.forEach(path => {
      const icon = map[path];
      const exists = !!this.app.vault.getAbstractFileByPath(path);
      const set = new Setting(e);
      const row = set.nameEl.createDiv('nx-iconlist-row');
      const ico = row.createDiv('nx-iconlist-icon');
      if (/^[a-z0-9-]+$/.test(icon)) setIcon(ico, icon); else ico.setText(icon);
      row.createDiv({ cls: 'nx-iconlist-path', text: path });
      const notes = [icon];
      if (!exists) notes.push('path no longer exists');
      if (broken.has(path)) notes.push('unknown icon — pick a new one');
      set.setDesc(notes.join(' · '));
      set.addExtraButton(b => b.setIcon('pencil').setTooltip('Change').onClick(() => {
        if (this.plugin.icons) this.plugin.icons.pick(path);
        window.setTimeout(() => this.display(), 400);
      }));
      set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Remove').onClick(async () => {
        delete map[path]; await this.save(); refresh(); this.display();
      }));
    });
    if (paths.some(p => !this.app.vault.getAbstractFileByPath(p))) {
      new Setting(e).addButton(b => b.setButtonText('Clean up missing paths').onClick(async () => {
        paths.forEach(p => { if (!this.app.vault.getAbstractFileByPath(p)) delete map[p]; });
        await this.save(); refresh(); this.display();
      }));
    }
  }

  /* Kanban — the ```nexus-kanban``` boards in both their sources. All of it is
     only defaults: a board keeps its own columns in its own block. */
  tKanban(e) {
    const s = this.plugin.settings.kanban;
    this.head(e, s);

    e.createEl('p', { cls: 'setting-item-description',
      text: 'A board is a ```nexus-kanban``` block inside an ordinary note. Where its cards come from is the one thing it asks: “source: block” keeps them in the block itself, so the board is one hand-editable text that works without the plugin — “source: folder” makes them the notes of a folder instead.' });
    nxBlockExample(e, 'nexus-kanban', [
      '## Backlog',
      '- [ ] Order the connectors',
      '- [ ] Read the datasheet',
      '    A note under a card becomes its description.',
      '',
      '## In progress @2',
      '- [ ] Route the power rail  #pcb  @2026-09-08',
      '',
      '## Done',
      '- [x] Pick the microcontroller',
    ]);

    nxMultiRow(e, 'Columns of a new board', 'One per row. Names decide the colour: “Erledigt”/“Done” is the done column, “In Arbeit”/“Doing” the active one.',
      (s.buckets || []).join('\n'), '\n', 'Backlog',
      async (v) => { s.buckets = v.split('\n').map(x => x.trim()).filter(Boolean); await this.save(); });

    new Setting(e).setName('Folder for new notes')
      .setDesc('Where “Create a note for this card” puts the note. Empty = next to the board note. A single board can override this with its own “notes:” line.')
      .addText(t => { t.setPlaceholder('Projects').setValue(s.notesFolder || '')
        .onChange(async v => { s.notesFolder = (v || '').trim().replace(/^\/|\/$/g, ''); await this.save(); });
        nxAutocomplete(t.inputEl, () => nxAllFolders(this.app), async (v) => { s.notesFolder = v; await this.save(); }); });

    new Setting(e).setName('Folder for new boards')
      .setDesc('Where the “New kanban board” command creates its note. Empty = the vault root.')
      .addText(t => { t.setPlaceholder('Boards').setValue(s.boardsFolder || '')
        .onChange(async v => { s.boardsFolder = (v || '').trim().replace(/^\/|\/$/g, ''); await this.save(); });
        nxAutocomplete(t.inputEl, () => nxAllFolders(this.app), async (v) => { s.boardsFolder = v; await this.save(); }); });

    new Setting(e).setName('Narrow columns').setDesc('Fits more columns on screen. Per board via “compact: true”.')
      .addToggle(t => t.setValue(!!s.compact).onChange(async v => { s.compact = v; await this.save(); }));

    // ── the folder source ──
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'A folder as the board' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'With “source: folder” the cards are EVERY note of that folder — it never filters, so nothing goes quietly missing — and a column is what the note’s own frontmatter says. Dragging a card writes the new value into the note; the first column means “nothing set” and stays clean. Everything else is set per board through its gear and travels with the note.' });
    new Setting(e).setName('Default state property')
      .setDesc('Pre-filled for new folder boards. Written into the note itself, so other cards and the search can use it too.')
      .addText(t => { t.setPlaceholder('status').setValue(s.statusProperty || 'status');
        t.onChange(async v => { s.statusProperty = v.trim() || 'status'; await this.save(); });
        nxAutocomplete(t.inputEl, () => this.plugin._allPropKeys(), v => { s.statusProperty = v; this.save(); }); });
    // No trailing "# …" comments in the examples: the Copy button hands the
    // block over verbatim, and the parser would read the comment as the value.
    nxBlockExample(e, 'nexus-kanban', [
      'source: folder',
      'folder: SCHOOL/Biology',
      'status: status',
      'sort: name',
      'dir: asc',
      'size: medium',
      'props: due',
      '',
      '## Offen',
      '## In Arbeit @3',
      '## Erledigt',
    ]);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'folder: empty = the folder this note is in · status: the frontmatter property, and the first heading is what “nothing set” is called · sort: name | modified | created | state · dir: asc | desc · size: small | medium | large · props: comma-separated frontmatter keys shown as badges · excerpt, tags, links, orphans, state: “false” hides that part of a card.' });

    // ── the grid and the web ──
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'The same notes without columns' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A ```nexus-graph``` block shows one folder either as a wall of cards or as the web of links between its notes, coloured by state. Neither has columns and neither writes anything back — that is why they are their own block. An older ```nexus-board``` block keeps working and lands here on its own.' });
    nxBlockExample(e, 'nexus-graph', [
      'folder: SCHOOL/Biology',
      'view: graph',
      'height: 260',
    ]);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'view: graph | grid | board — “board” hands the block back to the columns · height: the web’s height in pixels. It reads the same keys as a folder board.' });

  }
  tHider(e) {
    const s = this.plugin.settings.hider;
    this.head(e, s, () => this.plugin.applyHider());
    const opt = (k, l) => new Setting(e).setName(l).addToggle(t => t.setValue(s[k])
      .onChange(async v => { s[k] = v; await this.save(); this.plugin.applyHider(); }));
    opt('tooltips', 'Hide tooltips');
    opt('scrollbars', 'Hide scrollbars');
    opt('status', 'Hide status bar');
    opt('titlebar', 'Hide window buttons');
    opt('vaultname', 'Hide vault name');
    opt('tabbar', 'Hide tab bar');
    opt('instructions', 'Hide prompt instructions');
    opt('ribbon', 'Hide side ribbon');
    opt('explorerButtons', 'Hide file explorer buttons');
  }
  tWorkspaces(e) {
    const s = this.plugin.settings.workspaces;
    this.head(e, s);
    new Setting(e).setName('Selection mode').setDesc('Quick switcher with Ctrl+Alt+Tab: hold & cycle with Tab (Shift+Tab backwards).')
      .addDropdown(dd => dd
        .addOption('release', 'Release to select (releasing Ctrl/Alt confirms)')
        .addOption('enter', 'Enter/click to select')
        .setValue(s.selectMode || 'release')
        .onChange(async v => { s.selectMode = v; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Ctrl+Alt+Tab opens the tile switcher (layout preview). There is also the command "Nexus Suite: Open workspace switcher" for a custom hotkey.' });

    /* Layouts are owned by the core "Workspaces" plugin — we edit its store
       directly (same objects the switcher shows) instead of keeping a copy. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Saved layouts' });
    const wp = this.app.internalPlugins && this.app.internalPlugins.getPluginById('workspaces');
    if (!wp || !wp.enabled) {
      e.createEl('p', { cls: 'setting-item-description', text: 'The core "Workspaces" plugin is disabled — layouts live there.' });
      new Setting(e).addButton(b => b.setButtonText('Enable core plugin').setCta()
        .onClick(async () => { try { await wp.enable(); } catch (err) {} this.display(); }));
      return;
    }
    const inst = wp.instance;
    const names = Object.keys(inst.workspaces || {}).sort((a, b) => a.localeCompare(b));
    if (!names.length) e.createEl('p', { cls: 'setting-item-description', text: '— no layouts saved yet —' });
    const persist = () => { try { if (inst.saveData) inst.saveData(); } catch (err) {} };
    names.forEach(name => {
      const isActive = inst.activeWorkspace === name;
      const set = new Setting(e).setName(name).setDesc(isActive ? 'currently loaded' : '');
      set.addExtraButton(b => b.setIcon('play').setTooltip('Load layout')
        .onClick(() => { inst.loadWorkspace(name); new Notice('Layout loaded: ' + name); this.display(); }));
      set.addExtraButton(b => b.setIcon('save').setTooltip('Overwrite with the current layout')
        .onClick(async () => {
          const ok = await new NexusConfirmModal(this.app, 'Overwrite "' + name + '"?',
            'Replaces the saved panes and tabs with what is on screen right now.', 'Overwrite').openAndGet();
          if (!ok) return;
          inst.saveWorkspace(name); new Notice('Overwritten: ' + name); this.display();
        }));
      set.addExtraButton(b => b.setIcon('pencil').setTooltip('Rename').onClick(async () => {
        const nn = await new NexusNameModal(this.app, 'Rename layout', name).openAndGet();
        const clean = (nn || '').trim();
        if (!clean || clean === name) return;
        if (inst.workspaces[clean]) { new Notice('Nexus: "' + clean + '" already exists.'); return; }
        inst.workspaces[clean] = inst.workspaces[name];
        delete inst.workspaces[name];
        if (inst.activeWorkspace === name) inst.activeWorkspace = clean;
        persist(); this.display();
      }));
      set.addExtraButton(b => b.setIcon('copy').setTooltip('Duplicate').onClick(async () => {
        let copy = name + ' copy', i = 2;
        while (inst.workspaces[copy]) copy = name + ' copy ' + i++;
        try { inst.workspaces[copy] = JSON.parse(JSON.stringify(inst.workspaces[name])); } catch (err) { return; }
        persist(); this.display();
      }));
      set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Delete').onClick(async () => {
        const ok = await new NexusConfirmModal(this.app, 'Delete layout "' + name + '"?',
          'Only the saved arrangement is removed — no note or file is touched.', 'Delete').openAndGet();
        if (!ok) return;
        inst.deleteWorkspace(name); persist(); this.display();
      }));
    });
    new Setting(e)
      .addButton(b => b.setButtonText('Save current layout').setCta().onClick(async () => {
        const name = await new NexusNameModal(this.app, 'Save current layout as', '').openAndGet();
        const clean = (name || '').trim();
        if (!clean) return;
        inst.saveWorkspace(clean); new Notice('Saved: ' + clean); this.display();
      }))
      .addButton(b => b.setButtonText('Open switcher').onClick(() => new NexusWorkspaceModal(this.plugin, false).open()));
  }
  /* The galaxy. Four settings and no more: everything else about how it looks
     is the palette's business, and a graph with a dozen sliders is a graph
     nobody ends up looking at. */
  tGalaxy(e) {
    const s = this.plugin.settings.galaxy;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Open the galaxy", or the ribbon. Every note is a star and every link a line, laid out in three dimensions and drawn on a plain canvas — drag to turn it, and switch to 2D for the flat picture. This is a second view beside Obsidian\'s own graph, not a change to it: that one is a core plugin a plugin cannot reach into.' });

    new Setting(e).setName('Ribbon icon')
      .setDesc('Needs a reload to appear or disappear.')
      .addToggle(t => t.setValue(s.ribbon !== false)
        .onChange(async v => { s.ribbon = v; await this.save(); new Notice('Nexus: reload Obsidian for the ribbon change.'); }));

    new Setting(e).setName('Keep turning on its own')
      .setDesc('A slow drift while nothing is touching it. Off is a map that stays where you put it — and what a reduced-motion setting gets anyway.')
      .addToggle(t => t.setValue(s.drift !== false)
        .onChange(async v => { s.drift = v; await this.save(); this.plugin.refreshGalaxy(); }));

    new Setting(e).setName('Show notes with no links')
      .setDesc('Off leaves only what is connected. A vault with a lot of loose notes reads more clearly without them — they carry no shape.')
      .addToggle(t => t.setValue(s.showOrphans !== false)
        .onChange(async v => { s.showOrphans = v; await this.save(); this.plugin.refreshGalaxy(); }));

    new Setting(e).setName('Link length')
      .setDesc('How far apart two linked notes settle. Longer spreads the map out; shorter pulls clusters together.')
      .addSlider(sl => { sl.setLimits(30, 140, 5).setValue(s.linkDistance || 60).setDynamicTooltip();
        sl.onChange(async v => { s.linkDistance = v; await this.save(); this.plugin.refreshGalaxy(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default').onClick(async () => {
        s.linkDistance = 60; await this.save(); this.plugin.refreshGalaxy(); this.display(); }));
  }

  tSearch(e) {
    const s = this.plugin.settings.search;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Nexus Suite: Open search" (assign a hotkey). Results are ranked by WHERE a term matches — title first, then tags, headings, frontmatter and finally the body text.' });
    if (!s.fields || typeof s.fields !== 'object') s.fields = { title: true, tags: true, headings: true, props: true, text: true };
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Search in' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The starting scope. You can flip each one while searching, via the chips under the search box — that choice is remembered here.' });
    SEARCH_FIELDS.forEach(f => {
      new Setting(e).setName(f.label).setDesc('rank weight ' + f.weight)
        .addToggle(t => t.setValue(s.fields[f.id] !== false).onChange(async v => {
          if (!v && SEARCH_FIELDS.filter(x => s.fields[x.id] !== false).length <= 1) {
            new Notice('Nexus: at least one field has to stay on.');
            this.display(); return;
          }
          s.fields[f.id] = v; await this.save();
        }));
    });
  }
}

module.exports = WorkspacePages;
