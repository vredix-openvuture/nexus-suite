'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings tab
 *  Plugin settings tab.
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

    const wrap = c.createDiv('nx-settings');
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
    ];
    const tabs = groups.flatMap(g => g.tabs);
    if (!tabs.find(t => t.id === this.active)) this.active = tabs[0].id;

    // Names come from NX_MODULES, never from a literal in here — one table,
    // so nav, panel heading and command palette can't drift apart.
    const meta = (id) => NX_MODULES[id] || { name: id, sub: '' };

    const renderBody = () => {
      body.empty();
      /* The only way back to the rail in the narrow layout, so it is built with
         the panel rather than once — renderBody() empties this container. */
      const back = body.createDiv({ cls: 'nx-settings-back' });
      setIcon(back.createDiv('nx-settings-back-ic'), 'chevron-left');
      back.createSpan({ text: 'All settings' });
      back.onclick = () => wrap.removeClass('is-panel');
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
    };
    groups.forEach(g => {
      nav.createDiv({ cls: 'nx-settings-navgroup', text: g.title });
      g.tabs.forEach(t => {
        const m = meta(t.id);
        const btn = nav.createDiv('nx-settings-tab');
        btn.setAttribute('data-id', t.id);
        btn.setAttribute('aria-label', m.name + (m.sub ? ' — ' + m.sub : ''));
        setIcon(btn.createDiv('nx-settings-tab-icon'), t.icon);
        btn.createDiv({ cls: 'nx-settings-tab-label', text: m.name });
        btn.onclick = () => { this.active = t.id; renderBody(); openPanel(); };
      });
    });

    /* Narrow: the rail and the panel are one drill-down column instead of two.
       The stylesheet has always had this layout; nothing ever set the classes,
       so on a phone the tab was two columns squeezed into 430px — the state the
       user reviewed it in. 860px is where 188px of rail starts costing the
       panel more than it gives.

       The listener is torn down in hide(), because a settings tab is rebuilt
       every time it is opened and each build would otherwise leave one behind. */
    const narrow = window.matchMedia('(max-width: 620px)');
    const openPanel = () => { if (narrow.matches) wrap.addClass('is-panel'); };
    const applyNarrow = () => {
      wrap.toggleClass('is-narrow', narrow.matches);
      // Coming back to a wide window must not leave the panel state behind,
      // or the rail stays hidden with nothing to bring it back.
      if (!narrow.matches) wrap.removeClass('is-panel');
    };
    this._narrowQuery = narrow;
    this._onNarrow = applyNarrow;
    narrow.addEventListener('change', applyNarrow);
    applyNarrow();

    renderBody();
  }

  hide() {
    if (this._narrowQuery && this._onNarrow) this._narrowQuery.removeEventListener('change', this._onNarrow);
    this._narrowQuery = null;
    this._onNarrow = null;
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
]);

module.exports = { NexusSettingsTab };
