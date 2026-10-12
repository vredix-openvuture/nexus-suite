'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings tab
 *  The tab's shell: the nav rail, the page header, folding. Each page's
 *  builder (tHomepage, tSketch, …) lives in src/settings/ and is mixed in.
 * ========================================================================== */

const { PluginSettingTab, Setting, setIcon } = require('obsidian');
const { mixin } = require('./lib/mixin.js');
const { nxCollapseSections, nxFoldDescriptions } = require('./lib/inputs.js');
const { NX_MODULES } = require('./constants.js');

class NexusSettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.active = 'homepage'; }
  save() { return this.plugin.saveSettings(); }

  /* Enable toggle at the top of each tab */
  head(e, obj, after) {
    new Setting(e).setName('Enabled').setClass('nx-set-enable')
      .addToggle(t => t.setValue(obj.enabled).onChange(async v => { obj.enabled = v; await this.save(); if (after) after(); }));
  }

  display() {
    const { containerEl: c } = this;
    c.empty();
    c.addClass('nx-settings-root');
    c.createEl('h2', { text: 'Nexus Suite' });

    /* The shell is a size container: the stylesheet swaps the rail for the
       picker by the width THIS tab gets, not by the window's. Inside
       Obsidian's dialog the two differ by Obsidian's own sidebar, which is why
       a window-width query never fired in a narrow desktop window. */
    const shell = c.createDiv('nx-settings-shell');
    const pick = shell.createDiv('nx-settings-pick');
    const wrap = shell.createDiv('nx-settings');
    const nav = wrap.createDiv('nx-settings-nav');
    const body = wrap.createDiv('nx-settings-body');

    /* Ordered by what you reach for first and grouped by what the feature acts
       on: the dashboard and the look of the app, then what happens inside a
       note, then capture, then planning, then the tools that act on the vault
       as a whole. */
    const groups = [
      { title: 'Start & look', tabs: [
        { id: 'homepage',      icon: 'home',             fn: (e) => this.tHomepage(e) },
        { id: 'theme',         icon: 'palette',          fn: (e) => this.tTheme(e) },
        { id: 'explorer',      icon: 'folder-tree',      fn: (e) => this.tExplorer(e) },
        { id: 'folderNotes',   icon: 'folder-open',      fn: (e) => this.tFolderNotes(e) },
        { id: 'icons',         icon: 'shapes',           fn: (e) => this.tIcons(e) },
        { id: 'kanban',        icon: 'square-kanban',    fn: (e) => this.tKanban(e) },
        { id: 'hider',         icon: 'eye-off',          fn: (e) => this.tHider(e) },
      ] },
      { title: 'In the note', tabs: [
        { id: 'banner',        icon: 'image',            fn: (e) => this.tBanner(e) },
        { id: 'callouts',      icon: 'message-square-quote', fn: (e) => this.tCallouts(e) },
        { id: 'columns',       icon: 'columns-2',        fn: (e) => this.tColumns(e) },
        { id: 'typography',    icon: 'type',             fn: (e) => this.tTypography(e) },
        { id: 'propertyHider', icon: 'list',             fn: (e) => this.tPropHider(e) },
        { id: 'tagTools',      icon: 'tags',             fn: (e) => this.tTagTools(e) },
      ] },
      /* Capture, not "Drawing": all three answer "get the thing into the vault
         before it is gone" — with a pen, with a camera, with your voice. Vault
         sync used to sit in here, which said nothing about what it does; it is
         a tool that acts on the whole vault and lives with the other ones. */
      { title: 'Capture', tabs: [
        { id: 'quicksketch',   icon: 'pencil-line',      fn: (e) => this.tSketch(e) },
        { id: 'inkCapture',    icon: 'camera',           fn: (e) => this.tInkCapture(e) },
        { id: 'quicknote',     icon: 'mic',              fn: (e) => this.tQuickNote(e) },
        { id: 'bookCapture',   icon: 'book-open',        fn: (e) => this.tBookCapture(e) },
      ] },
      { title: 'Planning', tabs: [
        { id: 'calendar',      icon: 'calendar',         fn: (e) => this.tCalendar(e) },
      ] },
      { title: 'Tools', tabs: [
        { id: 'search',        icon: 'search',           fn: (e) => this.tSearch(e) },
        { id: 'workspaces',    icon: 'layout-dashboard', fn: (e) => this.tWorkspaces(e) },
        { id: 'galaxy',        icon: 'orbit',            fn: (e) => this.tGalaxy(e) },
        { id: 'vaultSync',     icon: 'refresh-cw',       fn: (e) => this.tVaultSync(e) },
      ] },
      /* The catalogue first, then one page per add-on that is running and
         registered one (main.js · registerSettingsPage). */
      { title: 'Add-ons', tabs: [
        { id: 'addons',        icon: 'puzzle',           fn: (e) => this.tAddons(e) },
      ].concat(Array.from(this.plugin.settingsPages.values()).map(p => ({
        id: 'addon:' + p.id, icon: p.icon || 'puzzle', meta: { name: p.name, sub: p.sub || '' },
        fn: (e) => {
          try { p.display(e); }
          catch (err) {
            console.error('[Nexus] settings page of ' + p.id, err);
            e.createDiv({ cls: 'setting-item-description', text: 'This add-on’s settings could not be drawn: ' + (err && err.message ? err.message : err) });
          }
        },
      }))) },
    ];
    const tabs = groups.flatMap(g => g.tabs);
    if (!tabs.find(t => t.id === this.active)) this.active = tabs[0].id;

    // Names come from NX_MODULES, never from a literal in here — one table,
    // so nav, panel heading and command palette can't drift apart.
    const meta = (id) => NX_MODULES[id] || (tabs.find(t => t.id === id) || {}).meta || { name: id, sub: '' };

    const renderBody = () => {
      body.empty();
      const t = tabs.find(x => x.id === this.active);
      const m = meta(t.id);
      const head = body.createDiv('nx-settings-head');
      head.createEl('h3', { text: m.name });
      // The proper name alone doesn't say what the module does — the subtitle
      // carries that, so nothing has to be memorised.
      if (m.sub) head.createDiv({ cls: 'nx-settings-head-sub', text: m.sub });
      t.fn(body);
      // Every page says less: the explanations move into an ⓘ next to the name
      // they belong to (see lib/inputs.js · nxFoldDescriptions).
      nxFoldDescriptions(body);
      /* A page long enough to need scrolling twice folds into its own sections.
         Four is the threshold: below it the headings are a table of contents you
         can already see, above it they are a wall. */
      nxCollapseSections(body, t.id, 4);
      nav.querySelectorAll('.nx-settings-tab').forEach(el => el.toggleClass('is-active', el.getAttribute('data-id') === this.active));
      syncPicker();
    };
    const go = (id) => { this.active = id; renderBody(); body.scrollTop = 0; };
    groups.forEach(g => {
      nav.createDiv({ cls: 'nx-settings-navgroup', text: g.title });
      g.tabs.forEach(t => {
        const m = meta(t.id);
        const btn = nav.createDiv('nx-settings-tab');
        btn.setAttribute('data-id', t.id);
        btn.setAttribute('aria-label', m.name + (m.sub ? ' — ' + m.sub : ''));
        setIcon(btn.createDiv('nx-settings-tab-icon'), t.icon);
        btn.createDiv({ cls: 'nx-settings-tab-label', text: m.name });
        btn.onclick = () => go(t.id);
      });
    });

    /* Narrow: one dropdown at the top stands in for the rail, so the page
       keeps the full width. A native <select> with the nav's groups as
       optgroups — on a phone it opens the system picker, which is easier to hit
       than any list drawn in here. ‹ › step through the pages in nav order. */
    const pickIcon = pick.createDiv('nx-settings-pick-ic');
    pickIcon.setAttribute('aria-hidden', 'true');
    const select = pick.createEl('select', { cls: 'dropdown nx-settings-pick-select' });
    select.setAttribute('aria-label', 'Settings page');
    groups.forEach(g => {
      const og = select.createEl('optgroup');
      og.label = g.title;
      g.tabs.forEach(t => { const o = og.createEl('option', { text: meta(t.id).name }); o.value = t.id; });
    });
    select.onchange = () => go(select.value);
    const step = (dir, icon, label) => {
      const b = pick.createEl('button', { cls: 'clickable-icon nx-settings-pick-step' });
      b.setAttribute('aria-label', label);
      setIcon(b, icon);
      b.onclick = () => {
        const i = tabs.findIndex(t => t.id === this.active);
        go(tabs[(i + dir + tabs.length) % tabs.length].id);
      };
    };
    step(-1, 'chevron-left', 'Previous page');
    step(1, 'chevron-right', 'Next page');
    const syncPicker = () => {
      select.value = this.active;
      const t = tabs.find(x => x.id === this.active);
      pickIcon.empty();
      setIcon(pickIcon, t.icon);
    };

    renderBody();
  }
}

// Each page's builder lives in src/settings/, grouped as the nav groups them.
mixin(NexusSettingsTab, [
  require('./settings/look.js'),
  require('./settings/workspace.js'),
  require('./settings/note.js'),
  require('./settings/sketch.js'),
  require('./settings/capture.js'),
  require('./settings/vault.js'),
  require('./settings/addons.js'),
]);

module.exports = { NexusSettingsTab };
