'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings tab
 *  Plugin settings tab.
 * ========================================================================== */

const { Notice, PluginSettingTab, Setting, moment, setIcon } = require('obsidian');
const { NexusCalloutModal } = require('./modals/callout.js');
const { SEARCH_FIELDS } = require('./modals/search.js');
const { NexusWorkspaceModal } = require('./modals/workspace.js');
const { NexusAccountModal } = require('./modals/account.js');
const { NexusTaskModal } = require('./modals/task.js');
const { NexusConfirmModal, NexusNameModal } = require('./modals/misc.js');
const { NexusTagRenameModal } = require('./modals/tags.js');
const { nxAllTagCounts, nxFilesWithTag, nxRenameTag } = require('./lib/tagtools.js');
const { FN_TYPES } = require('./lib/foldernotes.js');
const { nxAutocomplete, nxFoldDescriptions, nxMultiRow } = require('./lib/inputs.js');
const { nxAllFolders } = require('./lib/helpers.js');
const calstore = require('./lib/calstore.js');
const penGestures = require('./lib/sketchgestures.js');
const sketchSearch = require('./lib/sketchsearch.js');
const vaultsync = require('./lib/vaultsync.js');
const quicknoteLib = require('./lib/quicknote.js');
const extcommand = require('./lib/extcommand.js');
const { WebDavClient } = require('./lib/webdav.js');
const tasks = require('./lib/tasks.js');
const { BAR_DEFAULTS, BAR_ITEMS, BAR_MODES, HOME_VIEW, NX_BUILTIN_CALLOUTS, NX_BUILTIN_IDS, NX_MODULES, PALETTES, PALETTE_GROUPS, PALETTE_NAMES, PEN_IDS, PEN_LABELS, THEME_STYLES, ST_SYMBOL_RULES, TASK_BUCKETS, TASK_STATES } = require('./constants.js');

class NexusSettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.active = 'homepage'; }
  save() { return this.plugin.saveSettings(); }

  /* Enable toggle at the top of each tab */
  head(e, obj, after) {
    new Setting(e).setName('Enabled').setClass('nx-set-enable')
      .addToggle(t => t.setValue(obj.enabled).onChange(async v => { obj.enabled = v; await this.save(); if (after) after(); }));
  }

  /* Tasks & Calendar — CalDAV accounts + local calendars. Secrets never live
     here (they go to localStorage via plugin.setCredential); this tab only
     edits the non-secret config in data.json. */
  tTasksCalendar(e) {
    const s = this.plugin.settings.tasksCalendar;
    this.head(e, s);

    new Setting(e).setName('Data location')
      .setDesc('Where the event cache and your local calendars live. The plugin folder keeps them out of the file explorer, search and graph, and plugin updates never touch it — but it only syncs if your sync includes .obsidian.')
      .addDropdown(dd => dd
        .addOption('plugin', 'Plugin folder (.nexus-calendar)')
        .addOption('vault', 'A folder in the vault')
        .setValue(s.dataLocation || 'plugin')
        .onChange(async v => { s.dataLocation = v; await this.save(); this.display(); }));
    if ((s.dataLocation || 'plugin') === 'vault') {
      new Setting(e).setName('Data folder').setClass('nx-set-sub')
        .addText(t => t.setPlaceholder('_nexus').setValue(s.dataFolder)
          .onChange(async v => { s.dataFolder = (v || '').trim() || '_nexus'; await this.save(); }));
    } else {
      e.createEl('p', { cls: 'setting-item-description',
        text: 'Current path: ' + calstore.dataDir(this.plugin) });
    }
    new Setting(e).setName('Default view').addDropdown(d => d.addOption('month', 'Month').addOption('week', 'Week').addOption('day', 'Day')
      .setValue(s.defaultView).onChange(async v => { s.defaultView = v; await this.save(); }));
    // One setting for every calendar surface in the vault — month grids, the
    // week view, the agenda's "this week". Obsidian's own locale stays untouched.
    new Setting(e).setName('Week starts on')
      .setDesc('Applies to every calendar in the vault: month grids, the week view and the "this week" filter.')
      .addDropdown(d => {
        d.addOption('locale', 'Locale default (' + moment.weekdays()[moment().startOf('week').day()] + ')');
        moment.weekdays().forEach((name, i) => d.addOption(String(i), name));
        d.setValue(s.weekStart == null ? 'locale' : String(s.weekStart));
        d.onChange(async v => { s.weekStart = v; await this.save(); this.plugin.refreshCalendarViews(); });
      });
    new Setting(e).setName('Sync on startup').addToggle(t => t.setValue(s.syncOnStartup).onChange(async v => { s.syncOnStartup = v; await this.save(); }));
    new Setting(e).setName('Sync interval (minutes)').addText(t => { t.inputEl.type = 'number'; t.setValue(String(s.syncIntervalMin)).onChange(async v => { s.syncIntervalMin = Math.max(5, parseInt(v, 10) || 15); await this.save(); }); });
    new Setting(e).setName('Conflict policy').setDesc('When a server change and a local change collide (used once writing is enabled).')
      .addDropdown(d => d.addOption('server', 'Server wins').addOption('ask', 'Ask me').setValue(s.conflictPolicy).onChange(async v => { s.conflictPolicy = v; await this.save(); }));

    // ── CalDAV accounts ──
    e.createEl('h4', { text: 'CalDAV accounts', cls: 'nx-callout-h' });
    const accWrap = e.createDiv('nx-set-list');
    const renderAccounts = () => {
      accWrap.empty();
      if (!(s.accounts || []).length) accWrap.createDiv({ cls: 'nx-account-empty', text: 'No accounts yet.' });
      (s.accounts || []).forEach(acc => {
        const nCal = (acc.calendars || []).filter(c => c.enabled).length;
        const set = new Setting(accWrap).setName(acc.label || acc.username || 'CalDAV')
          .setDesc((acc.serverUrl || '') + ' · ' + nCal + ' calendar(s) on');
        set.addButton(b => b.setIcon('pencil').setTooltip('Edit').onClick(() => new NexusAccountModal(this.plugin, acc, renderAccounts).open()));
        set.addButton(b => b.setIcon('trash').setTooltip('Remove').onClick(async () => { s.accounts = s.accounts.filter(a => a.id !== acc.id); this.plugin.setCredential(acc.id, {}); await this.save(); renderAccounts(); }));
      });
    };
    renderAccounts();
    new Setting(e)
      .addButton(b => b.setButtonText('Add account').setCta().onClick(() => new NexusAccountModal(this.plugin, null, renderAccounts).open()))
      .addButton(b => b.setButtonText('Sync now').onClick(() => { new Notice('Nexus: syncing…'); this.plugin.syncTaskCal().then(r => { new Notice('Nexus sync\n' + ((r && r.lines) || ['done']).join('\n'), 9000); renderAccounts(); }); }));

    // ── Local calendars ──
    e.createEl('h4', { text: 'Local calendars', cls: 'nx-callout-h' });
    const locWrap = e.createDiv('nx-set-list');
    const renderLocals = () => {
      locWrap.empty();
      if (!(s.localCalendars || []).length) locWrap.createDiv({ cls: 'nx-account-empty', text: 'No local calendars yet.' });
      (s.localCalendars || []).forEach(lc => {
        const set = new Setting(locWrap);
        set.addColorPicker(cp => cp.setValue(lc.color || '#4a9eff').onChange(async v => { lc.color = v; await this.save(); }));
        set.addText(t => t.setValue(lc.name).onChange(async v => { lc.name = v; await this.save(); }));
        set.addButton(b => b.setIcon('trash').setTooltip('Remove').onClick(async () => { s.localCalendars = s.localCalendars.filter(x => x.id !== lc.id); await this.save(); renderLocals(); }));
      });
    };
    renderLocals();
    new Setting(e).addButton(b => b.setButtonText('Add local calendar').onClick(async () => { await calstore.createLocalCalendar(this.plugin, 'Local', '#4a9eff'); renderLocals(); }));

    // ── Todos (projects / tasks as Markdown) ──
    e.createEl('h4', { text: 'Todos', cls: 'nx-callout-h' });
    new Setting(e).setName('Projects folder').setDesc('One .md per project (subprojects link inside their parent).')
      .addText(t => t.setValue(s.tasks.projectsFolder).onChange(async v => { s.tasks.projectsFolder = (v || '').trim() || 'Tasks/Projects'; await this.save(); }));
    new Setting(e).setName('Task notes folder').setDesc('One .md per task (description + frontmatter for status/due/repeat).')
      .addText(t => t.setValue(s.tasks.itemsFolder).onChange(async v => { s.tasks.itemsFolder = (v || '').trim() || 'Tasks/Items'; await this.save(); }));
    new Setting(e)
      .addButton(b => b.setButtonText('New project').onClick(async () => { const name = await new NexusNameModal(this.app, 'New project name', 'Project').openAndGet(); if (name) { const f = await tasks.createProject(this.plugin, name); this.plugin.app.workspace.getLeaf(false).openFile(f); } }))
      .addButton(b => b.setButtonText('New task').setCta().onClick(() => new NexusTaskModal(this.plugin, null).open()));

    new Setting(e).addButton(b => b.setButtonText('Open calendar').setCta().onClick(() => this.plugin.openCalendarPage()));
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
        { id: 'board',         icon: 'layout-grid',      fn: (e) => this.tBoard(e) },
        { id: 'kanban',        icon: 'square-kanban',    fn: (e) => this.tKanban(e) },
        { id: 'hider',         icon: 'eye-off',          fn: (e) => this.tHider(e) },
      ] },
      { title: 'In the note', tabs: [
        { id: 'banner',        icon: 'image',            fn: (e) => this.tBanner(e) },
        { id: 'callouts',      icon: 'message-square-quote', fn: (e) => this.tCallouts(e) },
        { id: 'columns',       icon: 'columns-2',        fn: (e) => this.tColumns(e) },
        { id: 'typography',    icon: 'type',             fn: (e) => this.tTypography(e) },
        { id: 'focus',         icon: 'crosshair',        fn: (e) => this.tFocus(e) },
        { id: 'editorial',     icon: 'pilcrow',          fn: (e) => this.tEditorial(e) },
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
      ] },
      { title: 'Planning', tabs: [
        { id: 'calendar',      icon: 'calendar',         fn: (e) => this.tCalendar(e) },
        { id: 'tasksCalendar', icon: 'calendar-check',   fn: (e) => this.tTasksCalendar(e) },
      ] },
      { title: 'Tools', tabs: [
        { id: 'search',        icon: 'search',           fn: (e) => this.tSearch(e) },
        { id: 'workspaces',    icon: 'layout-dashboard', fn: (e) => this.tWorkspaces(e) },
        { id: 'sprint',        icon: 'timer',            fn: (e) => this.tSprint(e) },
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
        btn.onclick = () => { this.active = t.id; renderBody(); };
      });
    });
    renderBody();
  }

  /* Kanban — the ```nexus-kanban``` boards plus the columns of the task board.
     Both are only defaults: a board keeps its own columns in its own block, and
     a Vikunja project brings the columns its server has. */
  tKanban(e) {
    const s = this.plugin.settings.kanban;
    this.head(e, s);

    e.createEl('p', { cls: 'setting-item-description',
      text: 'A board is a ```nexus-kanban``` block inside an ordinary note — columns and cards live in the block itself, so the board is one hand-editable text and works without the plugin.' });

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

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Task board' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The board mode of the tasks page. A task remembers its column in its own note (“bucket:”). A Vikunja project uses the columns of its kanban view instead — dragging a card there moves it on the server.' });
    const tk = (this.plugin.settings.tasksCalendar.tasks = this.plugin.settings.tasksCalendar.tasks || {});
    nxMultiRow(e, 'Columns', 'One per row. A column whose name reads as done (“Done”, “Erledigt”, “Fertig”, …) completes a task that is dropped into it.',
      ((tk.buckets && tk.buckets.length ? tk.buckets : TASK_BUCKETS)).join('\n'), '\n', 'Backlog',
      async (v) => { tk.buckets = v.split('\n').map(x => x.trim()).filter(Boolean); await this.save(); this.plugin.refreshCalendarViews(); });
  }

  tBanner(e) {
    const s = this.plugin.settings.banner;
    this.head(e, s);
    new Setting(e).setName('Height (px)').addText(t => t.setValue(String(s.height))
      .onChange(async v => { s.height = Number(v) || 250; await this.save(); this.plugin.refreshBanner(); }));
    new Setting(e).setName('Fade at the bottom').addToggle(t => t.setValue(s.fade)
      .onChange(async v => { s.fade = v; await this.save(); this.plugin.refreshBanner(); }));
    new Setting(e).setName('Behind the tab bar').setDesc('The image continues behind the tab bar (bar + banner = one image).')
      .addToggle(t => t.setValue(s.behindTabs).onChange(async v => { s.behindTabs = v; await this.save(); this.plugin.refreshBanner(); }));

    // ── Note style (same palette button as the banner icon) ──
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Note background' });
    new Setting(e).setName('Pattern strength')
      .setDesc('How visible the lined / grid / dotted pattern is. It is mixed out of the text colour, so the right value depends on your palette. Also adjustable per note via −/+ in the palette menu.')
      .addSlider(sl => { sl.setLimits(0.5, 30, 0.5).setValue(s.bgStrength == null ? 4.5 : s.bgStrength).setDynamicTooltip();
        sl.onChange(async v => { s.bgStrength = v; await this.save(); this.plugin.applyNoteBgStrength(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default (4.5 %)').onClick(async () => {
        s.bgStrength = 4.5; await this.save(); this.plugin.applyNoteBgStrength(); this.display();
      }));

    new Setting(e).setName('Handwritten font size')
      .setDesc('The "handwritten" note style relative to the app\'s font size (Appearance → Font size). 1.0 = exactly the same; the font has a small x-height, so it needs a bump to read at the same size.')
      .addSlider(sl => { sl.setLimits(1, 2.2, 0.05).setValue(s.handScale == null ? 1.45 : s.handScale).setDynamicTooltip();
        sl.onChange(async v => { s.handScale = v; await this.save(); this.plugin.applyHandFont(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default (1.45)').onClick(async () => {
        s.handScale = 1.45; await this.save(); this.plugin.applyHandFont(); this.display();
      }));

    // ── Where imported images land ──
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Storage' });
    new Setting(e).setName('Banner folder').setDesc('Target folder in the vault where imported images are copied.')
      .addText(t => t.setPlaceholder('attachments/banners').setValue(s.folder)
        .onChange(async v => { s.folder = (v || '').trim().replace(/^\/|\/$/g, ''); await this.save(); }));
    new Setting(e).setName('Default file name')
      .setDesc('Pre-filled in the import dialog. Tokens: {{name}} (original file name), {{note}}, {{date}}, {{time}}.')
      .addText(t => t.setPlaceholder('{{name}}').setValue(s.nameTemplate || '{{name}}')
        .onChange(async v => { s.nameTemplate = v; await this.save(); }));
    new Setting(e).setName('Default group').setDesc('Pre-selected in the import dialog.')
      .addDropdown(dd => {
        dd.addOption('', 'Ungrouped');
        this.plugin.bannerGroups().forEach(g => dd.addOption(g, g));
        dd.setValue(s.defaultGroup || '');
        dd.onChange(async v => { s.defaultGroup = v; await this.save(); });
      });

    // ── Groups = subfolders. Renaming goes through fileManager, so the
    //    [[banner]] links in every note follow along. ──
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Groups' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A group is a subfolder of the banner folder. Right-click an image in the banner picker to move it between groups. Deleting a group keeps its images — they move back to the top level.' });
    const groups = this.plugin.bannerGroups();
    const counts = {};
    this.plugin.bannerImages().forEach(f => { const g = this.plugin.bannerGroupOf(f); counts[g] = (counts[g] || 0) + 1; });
    if (!groups.length) e.createEl('p', { cls: 'setting-item-description', text: '— no groups yet —' });
    groups.forEach(g => {
      const set = new Setting(e).setName(g).setDesc((counts[g] || 0) + ' image(s)');
      set.addExtraButton(b => b.setIcon('pencil').setTooltip('Rename').onClick(async () => {
        const name = await new NexusNameModal(this.app, 'Rename group', g).openAndGet();
        if (name && name.trim() && await this.plugin.renameBannerGroup(g, name.trim())) this.display();
      }));
      set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Delete group (images move to the top level)').onClick(async () => {
        const affected = this.plugin.bannerGroupImages(g).length;   // incl. subgroups
        const ok = await new NexusConfirmModal(this.app, 'Delete group "' + g + '"?',
          affected + ' image(s) — this group and any subgroups — move back to "' +
          (this.plugin.bannerRoot() || 'the vault root') + '". No image is deleted.',
          'Delete group').openAndGet();
        if (!ok) return;
        await this.plugin.deleteBannerGroup(g);
        this.display();
      }));
    });
    new Setting(e).addButton(b => b.setButtonText('New group').setCta().onClick(async () => {
      const name = await new NexusNameModal(this.app, 'New group name', '').openAndGet();
      const clean = (name || '').trim().replace(/^\/|\/$/g, '');
      if (!clean) return;
      await this.plugin.ensureBannerGroup(clean);
      this.display();
    }));

    // ── Image separator ──
    // Same image pool as the banners, used as a divider inside the note.
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Image separator' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Insert an image separator": pick any banner image and it becomes a thin strip in the note — a window onto the picture, so nothing has to be cropped to a few pixels first. Height and the visible band are sliders in the dialog, and clicking a separator in a note reopens it. The values below are what a new separator starts with.' });
    new Setting(e).setName('Height (px)')
      .addSlider(sl => { sl.setLimits(6, 160, 1).setValue(s.sepHeight == null ? 26 : s.sepHeight).setDynamicTooltip();
        sl.onChange(async v => { s.sepHeight = v; await this.save(); }); });
    new Setting(e).setName('Image band').setDesc('Which horizontal band of the picture the strip shows (0 = top, 100 = bottom).')
      .addSlider(sl => { sl.setLimits(0, 100, 1).setValue(s.sepPosition == null ? 50 : s.sepPosition).setDynamicTooltip();
        sl.onChange(async v => { s.sepPosition = v; await this.save(); }); });
    new Setting(e).setName('Fade at the edges')
      .addToggle(t => t.setValue(!!s.sepFade).onChange(async v => { s.sepFade = v; await this.save(); }));
    new Setting(e).setName('Rounded corners')
      .addToggle(t => t.setValue(s.sepRound !== false).onChange(async v => { s.sepRound = v; await this.save(); }));

    e.createEl('p', { cls: 'setting-item-description',
      text: 'Image icon top-right: choose · system import · move/height (drag) · remove. Palette icon next to it: note style — background (grid/lined/dotted) & font (normal/mono/handwritten).' });
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
  tColumns(e) {
    const s = this.plugin.settings.columns;
    this.head(e, s);
    new Setting(e).setName('Delimiter').setDesc('Line that separates columns (default ===).')
      .addText(t => t.setValue(s.delimiter).onChange(async v => { s.delimiter = v || '==='; await this.save(); }));
    new Setting(e).setName('Column gap').addText(t => t.setValue(s.gap)
      .onChange(async v => { s.gap = v || '1.5rem'; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description', text: 'Code block ```columns``` with === as the column separator. Renders in Live Preview & Reading mode.' });
  }
  tHomepage(e) {
    const s = this.plugin.settings.homepage;   // module fields (shared)
    const doc = this.plugin.hp();               // document fields (possibly per-device)
    const refreshHome = () => this.plugin.app.workspace.getLeavesOfType(HOME_VIEW)
      .forEach(l => { if (l.view && l.view.render) l.view.render(); });
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Rendered dashboard ("hub") — no markdown. Command "Nexus Suite: Open homepage" or the ribbon icon.' });

    // ── Per-device dashboard ──
    new Setting(e).setName('Separate dashboards per device')
      .setDesc('Each device has its own dashboard (its own cards, content, layout, hero) — even when the vault is synced via Syncthing. The device identifier stays local and is NOT synced.')
      .addToggle(t => t.setValue(!!s.perDevice).onChange(async v => {
        s.perDevice = v;
        if (v) this.plugin.hp();   // create this device's profile immediately from the template
        await this.save(); refreshHome(); this.display();
      }));
    if (s.perDevice) {
      new Setting(e).setName('Device name (this device)')
        .setDesc('For identification only — e.g. "Tablet", "Desktop", "Phone".')
        .addText(t => t.setPlaceholder('Tablet').setValue(this.plugin.deviceLabel())
          .onChange(async v => { await this.plugin.setDeviceLabel(v); }));
      new Setting(e).setName("Reset this device's dashboard")
        .setDesc('Discards this device\'s layout and rebuilds it from the shared template.')
        .addButton(b => b.setButtonText('Reset').setWarning().onClick(async () => {
          await this.plugin.resetDeviceDashboard(); refreshHome(); new Notice('Nexus: Device dashboard reset.');
        }));
    }

    new Setting(e).setName('Name').setDesc('For the greeting (empty = no name).')
      .addText(t => t.setPlaceholder('vredix').setValue(doc.name || '').onChange(async v => { doc.name = v; await this.save(); refreshHome(); }));
    new Setting(e).setName('Background image').setDesc('Path or [[link]] in the vault — or choose via the image icon at the top-right of the dashboard.')
      .addText(t => t.setPlaceholder('attachments/homepage/hero.jpg').setValue(doc.hero || '').onChange(async v => { doc.hero = v; await this.save(); refreshHome(); }));
    new Setting(e).setName('Ribbon icon').addToggle(t => t.setValue(s.ribbon)
      .onChange(async v => { s.ribbon = v; await this.save(); new Notice('Nexus: Restart/reload for the ribbon change.'); }));
    new Setting(e).setName('Open on startup').addToggle(t => t.setValue(s.openOnStartup)
      .onChange(async v => { s.openOnStartup = v; await this.save(); }));

    // ── Pinned tabs ──
    // Lives here because the dashboard is the page you reach for first, but it
    // covers all three Nexus pages — the same switch sits in each page's tab menu.
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Pinned tabs' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A pinned page stays at the tab bar as its bare icon: no title, no close button, and it comes back if something closes it anyway. Also switchable via right-click on the tab.' });
    this.plugin.pinnableTabs().forEach(p => {
      new Setting(e).setName(p.label)
        .addToggle(t => t.setValue(this.plugin.isTabPinned(p.key))
          .onChange(async v => { await this.plugin.setTabPinned(p.key, v); }));
    });

    e.createEl('p', { cls: 'setting-item-description',
      text: 'Configure cards individually: in the dashboard via the gear at the top-right of each card (size in units, filter, count, cover).' });
  }
  tExplorer(e) {
    const s = this.plugin.settings.explorer;
    this.head(e, s, () => this.plugin.applyExplorer());

    new Setting(e).setName('Folder backgrounds')
      .setDesc('Each top-level folder gets a tinted card with an accent gradient that wraps all its subfolders and files. Only visible with the Nexus theme active.')
      .addToggle(t => t.setValue(s.folderBg)
        .onChange(async v => { s.folderBg = v; await this.save(); this.plugin.applyExplorer(); }));

    new Setting(e).setName('Color intensity')
      .setDesc('How strong the accent tint of the folder cards is.')
      .addSlider(sl => { sl.setLimits(6, 45, 1).setValue(s.intensity != null ? s.intensity : 22).setDynamicTooltip();
        sl.onChange(async v => { s.intensity = v; await this.save(); this.plugin.applyExplorer(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default').onClick(async () => {
        s.intensity = 22; await this.save(); this.plugin.applyExplorer(); this.display(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Ribbon (left icon bar)' });
    new Setting(e).setName('Visibility')
      .setDesc('Only with the Nexus theme active. "On hover" shows a thin strip on the left that expands on hover.')
      .addDropdown(dd => dd
        .addOption('hover', 'Show on hover')
        .addOption('always', 'Always visible')
        .addOption('hidden', 'Hide completely')
        .setValue((this.plugin.settings.ribbon && this.plugin.settings.ribbon.mode) || 'hover')
        .onChange(async v => { this.plugin.settings.ribbon.mode = v; await this.save(); this.plugin.applyRibbon(); }));

    const active = (this.app.customCss && this.app.customCss.theme) || '';
    if (active !== 'Nexus')
      e.createEl('p', { cls: 'setting-item-description',
        text: 'Note: The Nexus theme is not currently active — folder cards & ribbon style only become visible with the Nexus theme.' });
  }
  tBoard(e) {
    const s = this.plugin.settings.board;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A ```nexus-board``` block turns an ordinary note into the dashboard of one subject: EVERY note of that folder as a card. It never filters — a hand-built overview shows what you remembered to add, this shows the folder, so nothing goes missing.' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Two arrangements of the same set: a sorted grid, or the same cards in columns by working state (drag them, or click the dot on a card). Everything else is set per dashboard through its gear — those settings are written back into the code block and travel with the note.' });
    new Setting(e).setName('Default state property')
      .setDesc('Pre-filled for new dashboards. Written into the note itself, so other cards and the search can use it too.')
      .addText(t => { t.setPlaceholder('status').setValue(s.statusProperty || 'status');
        t.onChange(async v => { s.statusProperty = v.trim() || 'status'; await this.save(); });
        nxAutocomplete(t.inputEl, () => this.plugin._allPropKeys(), v => { s.statusProperty = v; this.save(); }); });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Block reference' });
    const pre = e.createEl('pre', { cls: 'nx-board-help' });
    pre.setText([
      '```nexus-board',
      'folder: SCHOOL/Biology    # empty = the folder this note is in',
      'mode: grid                # grid | board',
      'sort: name                # name | modified | created | state',
      'dir: asc                  # asc | desc',
      'size: medium              # small | medium | large',
      'status: status            # frontmatter property holding the state',
      'states: Offen, In Arbeit, Ausbessern, Erledigt',
      'props: due                # extra frontmatter shown as a badge',
      'show: excerpt, tags, links, orphans, state, graph',
      'height: 260               # graph height in px',
      '```',
    ].join('\n'));
  }

  tFocus(e) {
    const s = this.plugin.settings.focus;
    const apply = () => { if (this.plugin.focus) this.plugin.focus.apply(); };
    this.head(e, s, apply);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Only affects editing, not reading view. Command "Toggle focus mode" flips it without coming here — worth a hotkey.' });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Dimming' });
    new Setting(e).setName('Dim everything else')
      .addToggle(t => t.setValue(s.dim !== false).onChange(async v => { s.dim = v; await this.save(); apply(); }));
    new Setting(e).setName('What stays lit')
      .setDesc('Sentence-level would need a CodeMirror extension, which this plugin deliberately avoids — line and paragraph work through the DOM.')
      .addDropdown(dd => dd.addOption('line', 'The current line').addOption('paragraph', 'The current paragraph')
        .setValue(s.scope || 'line').onChange(async v => { s.scope = v; await this.save(); apply(); }));
    new Setting(e).setName('How far the rest fades').setDesc('Lower = dimmer surroundings.')
      .addSlider(sl => { sl.setLimits(5, 90, 5).setValue(s.dimOpacity == null ? 45 : s.dimOpacity).setDynamicTooltip();
        sl.onChange(async v => { s.dimOpacity = v; await this.save(); apply(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default (45 %)')
        .onClick(async () => { s.dimOpacity = 45; await this.save(); apply(); this.display(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Typewriter scrolling' });
    new Setting(e).setName('Keep the current line at a fixed height')
      .setDesc('The text scrolls under the cursor instead of the cursor wandering down the screen.')
      .addToggle(t => t.setValue(!!s.typewriter).onChange(async v => { s.typewriter = v; await this.save(); apply(); }));
    new Setting(e).setName('Height').setDesc('0 = top of the editor, 100 = bottom.')
      .addSlider(sl => { sl.setLimits(15, 85, 5).setValue(s.typewriterOffset == null ? 50 : s.typewriterOffset).setDynamicTooltip();
        sl.onChange(async v => { s.typewriterOffset = v; await this.save(); apply(); }); });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Keystroke sound' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Synthesised live, not played from a file — nothing is bundled and it works on mobile too.' });
    new Setting(e).setName('Sound while typing')
      .addToggle(t => t.setValue(!!s.sound).onChange(async v => { s.sound = v; await this.save(); }));
    new Setting(e).setName('Character')
      .addDropdown(dd => dd.addOption('soft', 'Soft — muted thud').addOption('mechanical', 'Mechanical — sharp click')
        .setValue(s.soundStyle || 'soft').onChange(async v => { s.soundStyle = v; await this.save(); }));
    new Setting(e).setName('Volume')
      .addSlider(sl => { sl.setLimits(0, 100, 5).setValue(s.soundVolume == null ? 25 : s.soundVolume).setDynamicTooltip();
        sl.onChange(async v => { s.soundVolume = v; await this.save(); }); })
      .addExtraButton(b => b.setIcon('play').setTooltip('Try it')
        .onClick(() => { if (this.plugin.focus) { const was = s.sound; s.sound = true; this.plugin.focus.click(); s.sound = was; } }));
    new Setting(e).setName('Bell on Enter').setDesc('Like the carriage return of a typewriter.')
      .addToggle(t => t.setValue(!!s.bell).onChange(async v => { s.bell = v; await this.save(); }));
  }

  tSprint(e) {
    const s = this.plugin.settings.sprint;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Start a writing sprint" opens the dialog; the values here are what it starts with. Only words you ADD during the sprint count — deleting takes them away again, and switching notes keeps adding to the same total.' });
    new Setting(e).setName('Default duration')
      .addText(t => { t.inputEl.type = 'number'; t.setValue(String(s.minutes || 15));
        t.onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.minutes = n; await this.save(); } }); });
    new Setting(e).setName('Default word goal')
      .addText(t => { t.inputEl.type = 'number'; t.setValue(String(s.words || 300));
        t.onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.words = n; await this.save(); } }); });
    new Setting(e).setName('Use the clock by default')
      .addToggle(t => t.setValue(s.useTime !== false).onChange(async v => { s.useTime = v; await this.save(); }));
    new Setting(e).setName('Use the word goal by default')
      .addToggle(t => t.setValue(s.useWords !== false).onChange(async v => { s.useWords = v; await this.save(); }));
    new Setting(e).setName('Show progress in the status bar').setDesc('Click it to stop the sprint early.')
      .addToggle(t => t.setValue(s.statusBar !== false).onChange(async v => { s.statusBar = v; await this.save(); if (this.plugin.sprint) this.plugin.sprint.paint(); }));
    new Setting(e).setName('Turn on focus mode for the sprint').setDesc('Restores whatever it was afterwards.')
      .addToggle(t => t.setValue(!!s.focusDuringSprint).onChange(async v => { s.focusDuringSprint = v; await this.save(); }));
    new Setting(e).setName('Closing words').setDesc('Shown in the summary when a sprint ends (optional).')
      .addText(t => t.setPlaceholder('Well run.').setValue(s.doneMessage || '')
        .onChange(async v => { s.doneMessage = v; await this.save(); }));
  }

  tEditorial(e) {
    const s = this.plugin.settings.editorial;
    const apply = () => { if (this.plugin.editorial) this.plugin.editorial.apply(); };
    this.head(e, s, apply);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'All four are ordinary callouts, so a note keeps making sense without this plugin — it just renders as a plain callout instead of breaking. Commands insert them at the cursor.' });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Margin note' });
    e.createEl('p', { cls: 'setting-item-description', text: '> [!margin] — sits in the whitespace beside the text, and drops back inline on a narrow window.' });
    new Setting(e).setName('Enabled')
      .addToggle(t => t.setValue(s.margin !== false).onChange(async v => { s.margin = v; await this.save(); apply(); }));
    new Setting(e).setName('Width')
      .addSlider(sl => { sl.setLimits(120, 320, 10).setValue(s.marginWidth == null ? 200 : s.marginWidth).setDynamicTooltip();
        sl.onChange(async v => { s.marginWidth = v; await this.save(); apply(); }); });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Pull quote' });
    e.createEl('p', { cls: 'setting-item-description', text: '> [!pullquote] — a sentence lifted out, centred and large. Quote marks are drawn, not typed.' });
    new Setting(e).setName('Enabled')
      .addToggle(t => t.setValue(s.pullquote !== false).onChange(async v => { s.pullquote = v; await this.save(); apply(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Ornamental divider' });
    e.createEl('p', { cls: 'setting-item-description', text: '> [!ornament] — a hairline with a glyph on it. Type a character after the type to use that one instead.' });
    new Setting(e).setName('Enabled')
      .addToggle(t => t.setValue(s.ornament !== false).onChange(async v => { s.ornament = v; await this.save(); apply(); }));
    new Setting(e).setName('Glyph')
      .addText(t => t.setPlaceholder('❦').setValue(s.ornamentGlyph || '❦')
        .onChange(async v => { s.ornamentGlyph = v.trim() || '❦'; await this.save(); apply(); }));

    // ── Checklist states ──
    // Pure CSS over Obsidian's own data-task attribute — the note stays plain
    // markdown, so the characters keep their meaning in any other app.
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Checklist states' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The alternate checkbox characters Minimal made a convention: "- [>] " and friends get their own icon and colour. Command "Set the checklist state" writes one into the current line.' });
    new Setting(e).setName('Enabled')
      .addToggle(t => t.setValue(s.taskStates !== false).onChange(async v => { s.taskStates = v; await this.save(); apply(); }));
    const legend = e.createDiv('nx-task-legend nx-task-states');
    TASK_STATES.filter(([ch]) => ch !== ' ' && ch !== 'x').forEach(([ch, label]) => {
      const row = legend.createDiv({ cls: 'nx-task-legend-item', attr: { 'data-task': ch } });
      const box = row.createEl('input', { type: 'checkbox' });
      box.disabled = true;
      row.createSpan({ cls: 'nx-task-legend-ch', text: '[' + ch + ']' });
      row.createSpan({ cls: 'nx-task-legend-lbl', text: label });
    });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Drop cap' });
    new Setting(e).setName('Enlarge the first letter of a note')
      .setDesc('Reading view only. In Live Preview the editor\'s first line may be a property block or a heading, and CSS cannot tell those from prose — the cap would land on the wrong character.')
      .addToggle(t => t.setValue(!!s.dropcap).onChange(async v => { s.dropcap = v; await this.save(); apply(); }));
  }

  tFolderNotes(e) {
    const s = this.plugin.settings.folderNotes;
    const refresh = () => { if (this.plugin.folderNotes) this.plugin.folderNotes.refreshExplorer(); };
    this.head(e, s, refresh);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A folder can own a note — clicking the folder opens it. Ink Capture builds on this: every capture folder gets its sidecar as a folder note.' });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Naming & location' });
    new Setting(e).setName('Note name').setDesc('Tokens: {{folder_name}}, {{date}}.')
      .addText(t => t.setPlaceholder('{{folder_name}}').setValue(s.noteName)
        .onChange(async v => { s.noteName = v.trim() || '{{folder_name}}'; await this.save(); refresh(); }));
    new Setting(e).setName('File type').setDesc('Type used when CREATING a note; all enabled types below are recognised when looking one up.')
      .addDropdown(dd => dd.addOption('md', 'Markdown (.md)').addOption('canvas', 'Canvas (.canvas)').addOption('base', 'Base (.base)')
        .setValue(s.fileType || 'md').onChange(async v => { s.fileType = v; await this.save(); refresh(); }));
    const types = Array.isArray(s.supportedTypes) ? s.supportedTypes : (s.supportedTypes = ['md', 'canvas', 'base']);
    const tw = e.createDiv('nx-cardcfg-group');
    tw.createDiv({ cls: 'nx-cardcfg-group-label', text: 'Recognised as a folder note' });
    const trow = tw.createDiv('nx-cardcfg-checks');
    FN_TYPES.forEach(k => {
      const lbl = trow.createEl('label', { cls: 'nx-cardcfg-check' });
      const cb = lbl.createEl('input', { type: 'checkbox' });
      cb.checked = types.includes(k);
      lbl.createSpan({ text: '.' + k });
      cb.onchange = async () => {
        const set = new Set(s.supportedTypes);
        cb.checked ? set.add(k) : set.delete(k);
        if (!set.size) { set.add('md'); new Notice('Nexus: at least .md has to stay on.'); }
        s.supportedTypes = FN_TYPES.filter(x => set.has(x));
        await this.save(); refresh(); this.display();
      };
    });
    new Setting(e).setName('Storage').setDesc('Inside the folder is the usual convention; next to it keeps folders free of files.')
      .addDropdown(dd => dd.addOption('inside', 'Inside the folder').addOption('parent', 'Next to the folder')
        .setValue(s.storage || 'inside').onChange(async v => { s.storage = v; await this.save(); refresh(); }));
    new Setting(e).setName('Template').setDesc('Note used as the body for new folder notes. Tokens: {{folder_name}}, {{title}}, {{date}}, {{time}}.')
      .addText(t => { t.setPlaceholder('Templates/Folder.md').setValue(s.templatePath || '');
        t.onChange(async v => { s.templatePath = v.trim(); await this.save(); });
        nxAutocomplete(t.inputEl, () => this.plugin._allNames(), v => { s.templatePath = v; this.save(); }); });
    new Setting(e).setName('Create automatically for new folders')
      .addToggle(t => t.setValue(!!s.autoCreate).onChange(async v => { s.autoCreate = v; await this.save(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Opening' });
    new Setting(e).setName('Open on').setDesc('Which click on the folder opens its note. The collapse arrow always just collapses.')
      .addDropdown(dd => dd.addOption('click', 'Plain click').addOption('ctrl', 'Ctrl / Cmd + click')
        .addOption('alt', 'Alt + click').addOption('off', 'Never (context menu only)')
        .setValue(s.openTrigger || 'click').onChange(async v => { s.openTrigger = v; await this.save(); }));
    new Setting(e).setName('Collapse the folder as well')
      .setDesc('Off: opening the note leaves the folder as it is. On: it also expands/collapses.')
      .addToggle(t => t.setValue(!!s.collapseOnClick).onChange(async v => { s.collapseOnClick = v; await this.save(); }));
    new Setting(e).setName('Open in a new tab')
      .addToggle(t => t.setValue(!!s.openInNewTab).onChange(async v => { s.openInNewTab = v; await this.save(); }));
    new Setting(e).setName('Focus an already open tab').setDesc('If the note is open somewhere, jump there instead of opening it again.')
      .addToggle(t => t.setValue(!!s.focusExistingTab).onChange(async v => { s.focusExistingTab = v; await this.save(); }));
    new Setting(e).setName('Open from the breadcrumb path').setDesc('Clicking a folder in the path above a note opens that folder\'s note.')
      .addToggle(t => t.setValue(s.openFromPath !== false).onChange(async v => { s.openFromPath = v; await this.save(); refresh(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Appearance in the explorer' });
    new Setting(e).setName('Hide the note itself').setDesc('The note is reachable through its folder, so the extra row is noise.')
      .addToggle(t => t.setValue(s.hideInExplorer !== false).onChange(async v => { s.hideInExplorer = v; await this.save(); refresh(); }));
    new Setting(e).setName('Underline folders that have a note')
      .addToggle(t => t.setValue(s.underline !== false).onChange(async v => { s.underline = v; await this.save(); refresh(); }));
    new Setting(e).setName('Bold').addToggle(t => t.setValue(!!s.bold).onChange(async v => { s.bold = v; await this.save(); refresh(); }));
    new Setting(e).setName('Italic').addToggle(t => t.setValue(!!s.italic).onChange(async v => { s.italic = v; await this.save(); refresh(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Keeping things in sync' });
    new Setting(e).setName('Rename the note when the folder is renamed')
      .addToggle(t => t.setValue(s.syncRename !== false).onChange(async v => { s.syncRename = v; await this.save(); }));
    new Setting(e).setName('Ask before renaming')
      .addToggle(t => t.setValue(s.confirmRename !== false).onChange(async v => { s.confirmRename = v; await this.save(); }));
    new Setting(e).setName('Delete the folder when its note is deleted')
      .setDesc('Only ever removes a folder that is empty afterwards.')
      .addToggle(t => t.setValue(!!s.syncDelete).onChange(async v => { s.syncDelete = v; await this.save(); }));
    new Setting(e).setName('Ask before deleting')
      .addToggle(t => t.setValue(s.confirmDelete !== false).onChange(async v => { s.confirmDelete = v; await this.save(); }));
    nxMultiRow(e, 'Excluded folders', 'These never get a folder note. One per line.', (s.excludeFolders || []).join(','), ',', 'Archive',
      v => { s.excludeFolders = v.split(',').map(x => x.trim()).filter(Boolean); this.save(); refresh(); },
      () => this.plugin._allFolders());

    e.createEl('p', { cls: 'setting-item-description',
      text: 'Code block ```folder-overview``` renders the contents of the folder. Optional lines: title, depth, include (folder, markdown, all), sort (name/created/modified), asc, style (list/grid), folder.' });
  }

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

  tTagTools(e) {
    const s = this.plugin.settings.tagTools;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Right-click any tag — in the tag pane or inside a note — to rename, merge or remove it across the vault. Renaming onto an existing tag merges the two. Nested tags follow along; code blocks, inline code and URL fragments are left alone.' });
    new Setting(e).addButton(b => b.setButtonText('Rename a tag …').setCta()
      .onClick(() => { if (this.plugin.tagTools) this.plugin.tagTools.pickAndRename(); }));

    const counts = nxAllTagCounts(this.app);
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Tags in this vault (' + tags.length + ')' });
    if (!tags.length) e.createEl('p', { cls: 'setting-item-description', text: '— none —' });
    tags.slice(0, 100).forEach(([tag, n]) => {
      const set = new Setting(e).setName('#' + tag).setDesc(n + ' use(s)');
      set.addExtraButton(b => b.setIcon('pencil').setTooltip('Rename / merge')
        .onClick(() => new NexusTagRenameModal(this.plugin, tag, () => this.display()).open()));
      set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Remove everywhere').onClick(async () => {
        const files = nxFilesWithTag(this.app, tag);
        const ok = await new NexusConfirmModal(this.app, 'Remove #' + tag + ' everywhere?',
          'Strips the tag (and its nested children) from ' + files.length + ' note(s). The notes stay.', 'Remove tag').openAndGet();
        if (!ok) return;
        const c = await nxRenameTag(this.plugin, tag, '');
        new Notice('Nexus: removed #' + tag + ' from ' + c + ' note(s).');
        this.display();
      }));
    });
    if (tags.length > 100) e.createEl('p', { cls: 'setting-item-description', text: '… and ' + (tags.length - 100) + ' more — use "Rename a tag …" to reach them.' });
  }

  tInkCapture(e) {
    const s = this.plugin.settings.inkCapture;
    this.head(e, s);
    new Setting(e).setName('Ribbon icon').addToggle(t => t.setValue(s.ribbon)
      .onChange(async v => { s.ribbon = v; await this.save(); new Notice('Nexus: Restart/reload for the ribbon change.'); }));
    new Setting(e).setName('Tag dialog after capture')
      .setDesc('Only for scans taken via the Capture button/command — files that just appear in a source folder never trigger a popup.')
      .addToggle(t => t.setValue(s.tagOnCapture).onChange(async v => { s.tagOnCapture = v; await this.save(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Sources' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Anything landing in a source folder (via the camera button, or synced/exported in some other way) automatically gets its own capture folder — a sidecar note (as a folder note, requires the folder-notes plugin to open with one click) plus the raw file, flat inside it. Accepts images and PDF.' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Add one source per app you export from — the name is yours to choose and is what the gallery shows as the origin badge. "Paper" is the built-in camera capture and cannot be removed.' });
    this.plugin.inkSources().forEach(src => {
      const isPaper = src.id === 'paper';
      const set = new Setting(e).setName(src.label || src.id).setDesc(isPaper ? 'Built-in camera capture' : 'id: ' + src.id);
      set.addToggle(t => t.setValue(src.enabled !== false)
        .onChange(async v => { src.enabled = v; await this.save(); await this.plugin.ensureInkFolders(); }));
      if (!isPaper) set.addExtraButton(b => b.setIcon('pencil').setTooltip('Rename').onClick(async () => {
        const name = await new NexusNameModal(this.app, 'Source name', src.label || src.id).openAndGet();
        if (name && name.trim()) { src.label = name.trim(); await this.save(); this.display(); }
      }));
      if (!isPaper) set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Remove source').onClick(async () => {
        const ok = await new NexusConfirmModal(this.app, 'Remove source "' + (src.label || src.id) + '"?',
          'Only stops watching "' + (src.folder || '—') + '". Existing captures and their notes stay untouched.',
          'Remove').openAndGet();
        if (!ok) return;
        s.sources = this.plugin.inkSources().filter(x => x !== src);
        await this.save(); this.display();
      }));
      new Setting(e).setName('Folder').setClass('nx-set-sub')
        .addText(t => t.setPlaceholder('Inbox/' + (src.label || src.id)).setValue(src.folder || '')
          .onChange(async v => { src.folder = v.trim() || src.folder; await this.save(); await this.plugin.ensureInkFolders(); }));
    });
    new Setting(e).addButton(b => b.setButtonText('Add source').setCta().onClick(async () => {
      const name = await new NexusNameModal(this.app, 'Name of the app you export from', '').openAndGet();
      const label = (name || '').trim();
      if (!label) return;
      const id = this.plugin.inkSourceId(label);
      this.plugin.inkSources().push({ id, label, folder: 'Inbox/' + label.replace(/[\\/:*?"<>|]/g, '_'), enabled: true });
      await this.save(); await this.plugin.ensureInkFolders(); this.display();
    }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Excalidraw' });
    new Setting(e).setName('Show in gallery')
      .setDesc('Surfaces existing Excalidraw drawings (frontmatter excalidraw-plugin: parsed) in the Ink Capture gallery for tagging/findability — no folder needed, no sidecar created.')
      .addToggle(t => t.setValue(s.excalidraw.enabled).onChange(async v => { s.excalidraw.enabled = v; await this.save(); }));

    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Capture scan" or the camera ribbon icon opens the gallery / takes a paper photo. Your own sources have no in-app capture (they are separate apps) — export a PDF/image from them into their source folder instead.' });
  }
  tQuickNote(e) {
    const s = this.plugin.settings.quicknote;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Quick Note (speak it)" opens a recorder. Say the thing, stop, and it becomes a note — the first few words become the file name, because that is what you will scan for later.' });

    new Setting(e).setName('Folder').setDesc('Where spoken notes are filed.')
      .addText(t => t.setPlaceholder('Inbox/Quicknote').setValue(s.folder || '')
        .onChange(async v => { s.folder = v.trim() || 'Inbox/Quicknote'; await this.save(); }));

    new Setting(e).setName('Recogniser')
      .setDesc(quicknoteLib.ENGINES.map(x => x.label + ' — ' + x.note).join(' · '))
      .addDropdown(dd => {
        quicknoteLib.ENGINES.forEach(x => dd.addOption(x.id, x.label));
        dd.setValue(s.engine || 'local').onChange(async v => { s.engine = v; await this.save(); this.display(); });
      });

    if ((s.engine || 'local') === 'local') {
      new Setting(e).setName('Command').setClass('nx-set-sub')
        .setDesc('Run on the recording. ' + extcommand.PLACEHOLDER_IN + ' is the audio file, ' + extcommand.PLACEHOLDER_OUT + ' is where the text should land — printing it instead also works. Example: whisper-cli -f {in} -otxt -of {out} -l de')
        .addText(t => t.setPlaceholder('whisper-cli -f {in} -otxt -of {out} -l auto').setValue(s.command || '')
          .onChange(async v => { s.command = v; await this.save(); }));
      new Setting(e).setName('Check the command').setClass('nx-set-sub')
        .addButton(b => b.setButtonText('Test').onClick(() => {
          const built = extcommand.buildCommand(s.command || '', '/tmp/clip.webm', '/tmp/clip');
          if (built.error) { new Notice('Nexus: ' + built.error + '.'); return; }
          if (!this.plugin.ocrAvailable()) { new Notice('Nexus: no desktop shell here — use the browser recogniser on this device.'); return; }
          new Notice('Nexus: would run "' + built.command + '" with ' + built.args.length + ' argument(s).');
        }));
    } else {
      const { speechApi } = require('./modals/quicknote.js');
      new Setting(e).setName('Language').setClass('nx-set-sub')
        .setDesc('A BCP-47 tag, e.g. de-DE or en-GB.')
        .addText(t => t.setPlaceholder('en-US').setValue(s.language || 'en-US')
          .onChange(async v => { s.language = v.trim() || 'en-US'; await this.save(); }));
      e.createEl('p', { cls: 'setting-item-description',
        text: speechApi()
          ? 'This device has a browser recogniser. Be aware that most builds send the audio to the browser vendor to transcribe it.'
          : 'This device has NO browser recogniser, so recording will refuse to start. Use the local engine here.' });
    }

    new Setting(e).setName('Track new notes as tasks').setDesc('Pre-ticks the box in the recorder, so a spoken reminder turns up in the tasks view.')
      .addToggle(t => t.setValue(!!s.asTask).onChange(async v => { s.asTask = v; await this.save(); }));
    new Setting(e).setName('Open the note afterwards')
      .addToggle(t => t.setValue(s.openAfter !== false).onChange(async v => { s.openAfter = v; await this.save(); }));
  }

  tVaultSync(e) {
    const s = this.plugin.settings.vaultSync;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The whole vault to a WebDAV server: Nextcloud, a Synology, or anything else that speaks it. Three-way, so a file you delete stays deleted instead of coming back, and a file you have not downloaded yet is not mistaken for one you removed. Credentials stay on this device and never go into the vault — which matters here more than usual, because the vault is what gets uploaded.' });

    new Setting(e).setName('Server URL').setDesc('The folder the vault lives in, e.g. https://cloud.example.com/remote.php/dav/files/me/Vault')
      .addText(t => t.setPlaceholder('https://…').setValue(s.url || '')
        .onChange(async v => { s.url = v.trim(); await this.save(); }));

    const cred = this.plugin.getCredential('vaultsync') || {};
    new Setting(e).setName('User name').setClass('nx-set-sub')
      .addText(t => t.setValue(cred.username || '').onChange(v => {
        const now = this.plugin.getCredential('vaultsync') || {};
        this.plugin.setCredential('vaultsync', Object.assign(now, { username: v.trim() }));
      }));
    new Setting(e).setName('App password').setDesc('Device-local, never synced. Use an app password, not your account password.').setClass('nx-set-sub')
      .addText(t => {
        t.inputEl.type = 'password';
        t.setValue(cred.secret || '').onChange(v => {
          const now = this.plugin.getCredential('vaultsync') || {};
          this.plugin.setCredential('vaultsync', Object.assign(now, { secret: v }));
        });
      });
    new Setting(e).setName('Connection').setDesc('Ask the server whether it is there and whether it knows you.')
      .addButton(b => b.setButtonText('Test').setCta().onClick(async () => {
        b.setDisabled(true).setButtonText('Testing…');
        const now = this.plugin.getCredential('vaultsync') || {};
        try {
          if (!s.url) throw new Error('fill in the URL first');
          const client = new WebDavClient({ baseUrl: s.url, username: now.username || '', password: now.secret || '' });
          const res = await client.check();
          new Notice('Nexus: ' + res.message + '.');
        } catch (err) {
          new Notice('Nexus: ' + (err && err.message ? err.message : 'the test failed.'));
        }
        b.setDisabled(false).setButtonText('Test');
      }));

    new Setting(e).setName('This device is called').setDesc('Shows up in the name of a conflict copy, so you can tell which machine wrote it.')
      .addText(t => t.setPlaceholder(this.plugin.deviceId()).setValue(s.deviceName || '')
        .onChange(async v => { s.deviceName = v.trim(); await this.save(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'When' });
    new Setting(e).setName('Sync on start').setDesc('So a device you pick up is already what you left.')
      .addToggle(t => t.setValue(s.onStart !== false).onChange(async v => { s.onStart = v; await this.save(); }));
    new Setting(e).setName('Every').setDesc('Minutes between syncs. 0 = only when you ask.')
      .addText(t => t.setPlaceholder('15').setValue(String(s.intervalMin == null ? 15 : s.intervalMin))
        .onChange(async v => {
          const n = parseInt(v, 10);
          s.intervalMin = isFinite(n) && n > 0 ? n : 0;
          await this.save();
          if (this.plugin.vaultSync) this.plugin.vaultSync.schedule();
        }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'What' });
    new Setting(e).setName('Carry the settings too')
      .setDesc('Syncs .obsidian as well, so plugins and themes follow you — except the files that describe THIS machine: the window layout, the mobile layout, the graph view and the sync\'s own state. Those would rearrange panes you deliberately arranged.')
      .addToggle(t => t.setValue(s.config !== false).onChange(async v => { s.config = v; await this.save(); }));
    new Setting(e).setName('Never sync').setDesc('One per line. A trailing slash means a folder; * matches anything.')
      .addTextArea(t => {
        t.inputEl.rows = 3;
        t.setPlaceholder('Archive/\n*.tmp').setValue((s.exclude || []).join('\n'))
          .onChange(async v => { s.exclude = v.split('\n').map(x => x.trim()).filter(Boolean); await this.save(); });
      });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'When two devices disagree' });
    new Setting(e).setName('Conflicts')
      .setDesc(vaultsync.CONFLICT_POLICIES.map(p => p.label + ': ' + p.note).join(' · '))
      .addDropdown(dd => {
        vaultsync.CONFLICT_POLICIES.forEach(p => dd.addOption(p.id, p.label));
        dd.setValue(s.conflict || 'keepBoth').onChange(async v => { s.conflict = v; await this.save(); });
      });
    new Setting(e).setName('Shared vault')
      .setDesc('Each device leaves a note on the server saying it is here, so you can be told when someone else is in the vault. This is NOT live co-editing — see the README for why that needs a server this does not have.')
      .addToggle(t => t.setValue(!!s.shared).onChange(async v => { s.shared = v; await this.save(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Backups' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'One zip a day into _backups on the server, taken after the first sync of the day. The oldest are removed once there are more than you want to keep.' });
    new Setting(e).setName('Daily backup')
      .addToggle(t => t.setValue(s.backup !== false).onChange(async v => { s.backup = v; await this.save(); }));
    new Setting(e).setName('Keep').setDesc('How many archives stay on the server.')
      .addText(t => t.setPlaceholder('30').setValue(String(s.keepBackups == null ? 30 : s.keepBackups))
        .onChange(async v => { const n = parseInt(v, 10); s.keepBackups = isFinite(n) && n > 0 ? n : 30; await this.save(); }));
    new Setting(e).setName('Back up now').setDesc('Does not wait for the daily one.')
      .addButton(b => b.setButtonText('Back up').onClick(() => {
        if (this.plugin.vaultSync) this.plugin.vaultSync.backupNow(true);
      }));

    new Setting(e).setName('Sync now')
      .addButton(b => b.setButtonText('Sync').setCta().onClick(async () => {
        if (!this.plugin.vaultSync) return;
        b.setDisabled(true).setButtonText('Syncing…');
        await this.plugin.vaultSync.syncNow(true);
        b.setDisabled(false).setButtonText('Sync');
      }));
  }

  tSketch(e) {
    const s = this.plugin.settings.quicksketch;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Code block ```quicksketch``` renders a pad you can draw on with pen, touch or mouse (pen pressure → line width). Each drawing is saved as a standalone .svg sidecar. Command "Insert quick sketch" adds a block at the cursor.' });
    new Setting(e).setName('Sketch folder').setDesc('Where the .svg sidecars are stored.')
      .addText(t => t.setPlaceholder('Inbox/Quicksketch').setValue(s.folder)
        .onChange(async v => { s.folder = v || 'Inbox/Quicksketch'; await this.save(); await this.plugin.ensureSketchFolder(); }));
    new Setting(e).setName('Default aspect ratio').setDesc('New pads use this (e.g. 16:9, 4:3, 1:1). Existing sketches keep their own.')
      .addText(t => t.setPlaceholder('16:9').setValue(s.ratio).onChange(async v => { s.ratio = v || '16:9'; await this.save(); }));
    new Setting(e).setName('Default paper').setDesc('Fill behind the ink on new pads. Native = the note\'s own background; Paper = slightly yellowish off-white; White / Black = solid. Change live per sketch in the toolbar (background button), or override a slate note with frontmatter `sketch-bg: black`.')
      .addDropdown(dd => dd
        .addOption('native', 'Native (note background)')
        .addOption('paper', 'Paper (off-white)')
        .addOption('white', 'White')
        .addOption('black', 'Black')
        .setValue(s.paper || 'paper')
        .onChange(async v => { s.paper = v; await this.save(); }));
    new Setting(e).setName('Sheet width').setDesc('How wide the paper may render, in pixels. Endless paper has a fixed width, so this is what stops a tablet turned to landscape from stretching the same note to a bigger ink size. 0 = fill whatever space there is.')
      .addText(t => t.setPlaceholder('1100').setValue(String(s.paperWidth != null ? s.paperWidth : 1100))
        .onChange(async v => {
          const px = parseInt(v, 10);
          s.paperWidth = isFinite(px) && px > 0 ? px : 0;
          await this.save();
        }));
    /* ── Pen ─────────────────────────────────────────────────────────────────
       The honest framing matters here: people expect the S Pen's air gestures
       and they simply are not available to a web app, so the note says so
       rather than letting someone hunt for a setting that cannot exist. */
    /* ── Handwriting ─────────────────────────────────────────────────────────
       Recognition runs a binary that is already on the machine. That keeps the
       plugin one file and the text on the device, and it is why this is a
       command line rather than a switch. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Handwriting' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A sketch is searchable by its title, its sections and its sticky notes without any of this. Recognition adds the handwriting on top — it runs a program you install yourself, so nothing is uploaded and nothing is bundled. Desktop only: a phone has no shell to run it in. Command "Search sketches" does the finding, "Read the handwriting in this sketch" does the reading.' });
    if (!s.ocr) s.ocr = { enabled: false, command: 'tesseract {in} {out} -l eng', onSave: false };
    new Setting(e).setName('Recognition command')
      .setDesc('Run for one page at a time. ' + sketchSearch.OCR_PLACEHOLDER_IN + ' is the image, ' + sketchSearch.OCR_PLACEHOLDER_OUT + ' is where the text should land (Tesseract appends .txt itself). Example: tesseract {in} {out} -l deu')
      .addText(t => t.setPlaceholder('tesseract {in} {out} -l eng').setValue(s.ocr.command || '')
        .onChange(async v => { s.ocr.command = v; await this.save(); }));
    new Setting(e).setName('Check the command').setDesc('Runs it on a small test image and reports what came back.')
      .addButton(b => b.setButtonText('Test').onClick(async () => {
        b.setDisabled(true).setButtonText('Testing…');
        try {
          const built = sketchSearch.buildOcrCommand(s.ocr.command || '', '/tmp/nexus-probe.png', '/tmp/nexus-probe');
          if (built.error) throw new Error(built.error);
          if (!this.plugin.ocrAvailable()) throw new Error('no desktop shell here — recognition cannot run on this device');
          new Notice('Nexus: would run "' + built.command + '" with ' + built.args.length + ' argument(s). Open a sketch and use the command to read it for real.');
        } catch (err) {
          new Notice('Nexus: ' + (err && err.message ? err.message : 'the command could not be parsed.'));
        }
        b.setDisabled(false).setButtonText('Test');
      }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Pen buttons' });
    const penNote = e.createEl('p', { cls: 'setting-item-description' });
    const renderPenNote = () => {
      const profile = penGestures.PEN_PROFILES[s.penProfile] || penGestures.PEN_PROFILES.generic;
      penNote.setText(profile.note + ' A browser only sees what the pen does on or near the glass: the side button, the eraser end, and taps.');
    };
    new Setting(e).setName('Pen').setDesc('Picks the presets below. It does not change what the hardware reports, only what is assumed about it.')
      .addDropdown(dd => {
        penGestures.PROFILE_IDS.forEach(id => dd.addOption(id, penGestures.PEN_PROFILES[id].label));
        dd.setValue(penGestures.PEN_PROFILES[s.penProfile] ? s.penProfile : 'generic')
          .onChange(async v => {
            s.penProfile = v;
            // Switching pens means switching presets, so per-gesture overrides
            // from the old one are cleared rather than silently carried over.
            s.penMap = {};
            await this.save();
            this.display();
          });
      });
    renderPenNote();
    penGestures.PEN_GESTURES.forEach(g => {
      const active = penGestures.resolveMap(s.penProfile, s.penMap);
      new Setting(e).setName(g.label).setDesc(g.hint).setClass('nx-set-sub')
        .addDropdown(dd => {
          penGestures.PEN_ACTIONS.forEach(a => dd.addOption(a.id, a.label));
          dd.setValue(active[g.id] || 'none').onChange(async v => {
            s.penMap = Object.assign({}, s.penMap, { [g.id]: v });
            await this.save();
          });
        });
    });

    new Setting(e).setName('Slate notes: hide properties').setDesc('A `nexus: slate` note is a whole page of paper. This takes the frontmatter block above it out of the way, so the note opens on the paper and nothing else.')
      .addToggle(t => t.setValue(!!s.hideFrontmatter).onChange(async v => { s.hideFrontmatter = v; await this.save(); }));
    new Setting(e).setName('Slate notes: hide the app chrome').setDesc('While a slate note is open, hide the tab bar, the status bar and the left ribbon. Everything comes back the moment you leave the note. (The full-size editor already covers the window on its own.)')
      .addToggle(t => t.setValue(!!s.immersive).onChange(async v => {
        s.immersive = v;
        if (!v) document.body.removeClass('nx-sk-immersive');
        await this.save();
      }));
    new Setting(e).setName('Paper texture').setDesc('Lay a subtle paper grain over the pad. Works on any paper colour; toggle live per sketch via the background button.')
      .addToggle(t => t.setValue(s.paperStyle !== false).onChange(async v => { s.paperStyle = v; await this.save(); }));
    new Setting(e).setName('Invert ink on dark paper').setDesc('On a dark paper (Black), lift ONLY near-black ink so dark drawings stay readable — vivid colours keep their punch. Non-destructive: colours are only changed for display and export.')
      .addToggle(t => t.setValue(s.invertOnDark !== false).onChange(async v => { s.invertOnDark = v; await this.save(); }));
    new Setting(e).setName('Default ink color').setDesc('What the pen starts with in a vault that has never drawn. After that every tool remembers the colour it was last used with.')
      .addColorPicker(cp => cp.setValue(s.ink || '#2f2f2f').onChange(async v => { s.ink = v; await this.save(); }));

    /* ── Toolbar ─────────────────────────────────────────────────────────────
       Which buttons a toolbar shows is a property of the DEVICE, not of the
       vault — a phone wants a menu where a monitor wants buttons. So these
       write to the shared setting unless "Just this device" is on, and then
       they go to localStorage and never leave the machine. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Toolbar' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The bar holds the tools; the row under it holds the options of whichever tool is active — pen types, sizes and colours. Buttons you leave out of the bar move into its ⋯ menu. Save, full size and “open beside the note” always stay in the bar.' });

    const deviceBar = this.plugin.barOverride() || {};
    const perDevice = !!deviceBar.enabled;
    const sharedBar = s.bar || (s.bar = { mode: 'pinned', compact: null, full: null });
    const barTarget = perDevice ? deviceBar : sharedBar;
    const writeBar = async () => {
      if (perDevice) this.plugin.setBarOverride(Object.assign({ enabled: true }, barTarget));
      else await this.save();
    };

    new Setting(e).setName('Just this device')
      .setDesc('Give this device its own toolbar. Stored locally and never synced, so a phone can keep three buttons while the desktop keeps all of them.')
      .addToggle(t => t.setValue(perDevice).onChange(v => {
        // Starting an override copies what is on screen right now, so switching
        // it on changes nothing until something below is actually changed.
        this.plugin.setBarOverride(v ? Object.assign({ enabled: true }, this.plugin.barConfig(s)) : null);
        this.display();
      }));

    new Setting(e).setName('Options row')
      .setDesc('“Always open” keeps pen types, sizes and colours under the bar. “Opens when you pick a tool” gives that space back to the canvas and closes the row again on your first stroke.')
      .addDropdown(dd => {
        Object.keys(BAR_MODES).forEach(id => dd.addOption(id, BAR_MODES[id]));
        dd.setValue(barTarget.mode === 'reveal' ? 'reveal' : 'pinned')
          .onChange(async v => { barTarget.mode = v; await writeBar(); });
      });

    [['compact', 'Buttons in a note', BAR_DEFAULTS.compact], ['full', 'Buttons in the full-size editor', BAR_DEFAULTS.full]].forEach(([ctx, label, def]) => {
      e.createEl('div', { cls: 'nx-cardcfg-sec', text: label });
      e.createEl('p', { cls: 'setting-item-description', text: 'On = in the bar, off = in the ⋯ menu.' });
      BAR_ITEMS.forEach(item => {
        const list = () => (Array.isArray(barTarget[ctx]) ? barTarget[ctx] : def).slice();
        new Setting(e).setName(item.label).setClass('nx-set-sub')
          .addToggle(t => t.setValue(list().includes(item.id)).onChange(async v => {
            // Rebuilt from BAR_ITEMS so the bar keeps its canonical order —
            // toggling a button off and on again must not move it to the end.
            const next = BAR_ITEMS.map(i => i.id).filter(id => (id === item.id) ? v : list().includes(id));
            if (!next.some(id => (BAR_ITEMS.find(other => other.id === id) || {}).kind === 'tool')) {
              new Notice('Nexus: the bar needs at least one tool to draw with.');
              t.setValue(true);
              return;
            }
            barTarget[ctx] = next;
            await writeBar();
          }));
      });
    });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Brush sizes' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'On-screen px, remembered per pen. Adjust live per sketch in the toolbar (slider); switching pens restores that pen’s width.' });
    const penSizes = s.penSizes || (s.penSizes = { fountain: 3, ballpoint: 2, pencil: 2.5, brush: 5, calligraphy: 3.5, marker: 10 });
    [['fountain', 'Fountain'], ['ballpoint', 'Ballpoint'], ['pencil', 'Pencil'], ['brush', 'Brush'], ['calligraphy', 'Calligraphy'], ['marker', 'Marker']].forEach(([id, label]) => {
      new Setting(e).setName(label).setClass('nx-set-sub')
        .addSlider(sl => { sl.setLimits(0.5, 40, 0.1).setValue(penSizes[id] != null ? penSizes[id] : 3).setDynamicTooltip();
          sl.onChange(async v => { penSizes[id] = v; await this.save(); }); });
    });
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Size favourites' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The 3 quick-set widths in the toolbar — per pen, since a marker and a pencil want very different ones. Also settable in a sketch: tap the active dot again.' });
    if (!s.sizeFavorites || Array.isArray(s.sizeFavorites)) s.sizeFavorites = {};
    PEN_IDS.forEach(id => {
      const def = id === 'marker' ? [6, 10, 18] : [1.5, 3, 8];
      if (!Array.isArray(s.sizeFavorites[id]) || !s.sizeFavorites[id].length) s.sizeFavorites[id] = def.slice();
      new Setting(e).setName(PEN_LABELS[id]).setClass('nx-set-sub')
        .addText(t => t.setPlaceholder(def.join(', ')).setValue(s.sizeFavorites[id].join(', '))
          .onChange(async v => {
            const nums = v.split(',').map(x => parseFloat(x.trim())).filter(x => x > 0).slice(0, 3);
            if (nums.length) { s.sizeFavorites[id] = nums; await this.save(); }
          }));
    });
    new Setting(e).setName('Auto-extend downward').setDesc('New pads grow taller automatically as you draw near the bottom. Toggle per sketch in the toolbar.')
      .addToggle(t => t.setValue(!!s.autoGrow).onChange(async v => { s.autoGrow = v; await this.save(); }));
    new Setting(e).setName('Shape recognition').setDesc('Hold the pen still right after drawing → the stroke snaps to a clean line / rectangle / ellipse / triangle.')
      .addToggle(t => t.setValue(s.shapeSnap !== false).onChange(async v => { s.shapeSnap = v; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Pen behaviour (smoothing, pressure, sharpness, speed fade — and the marker\'s tip/overlap): tap the ACTIVE pen in the options row again. Colour palettes (create/rename/switch, max 8 colours): the swatch-book button at the end of the colours — it sets the palette for the tool you are holding.' });

    // ── Palettes: ALL of them, not just the active one. Each holds up to 8
    //    colours; the sketch toolbar hides its "+" once a palette is full. ──
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Colour palettes' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Max 8 colours each. The one marked active is the default; a tool that was given its own palette (swatch-book button in the options row) keeps using that one instead.' });
    if (!Array.isArray(s.palettes) || !s.palettes.length) s.palettes = [{ name: 'Default', colors: (s.palette || ['#2f2f2f']).slice(0, 8) }];
    if (s.activePalette == null || s.activePalette >= s.palettes.length) s.activePalette = 0;
    s.palette = s.palettes[s.activePalette].colors;
    const syncActive = async () => { s.palette = s.palettes[s.activePalette].colors; await this.save(); };

    s.palettes.forEach((pal, idx) => {
      if (!Array.isArray(pal.colors) || !pal.colors.length) pal.colors = ['#2f2f2f'];
      const isActive = idx === s.activePalette;
      const set = new Setting(e)
        .setName(pal.name || 'Palette ' + (idx + 1))
        .setDesc(pal.colors.length + ' / 8 colours' + (isActive ? ' · active' : ''));
      if (isActive) set.setClass('nx-pal-active');
      if (!isActive) set.addExtraButton(b => b.setIcon('check').setTooltip('Use this palette')
        .onClick(async () => { s.activePalette = idx; await syncActive(); this.display(); }));
      set.addExtraButton(b => b.setIcon('pencil').setTooltip('Rename').onClick(async () => {
        const name = await new NexusNameModal(this.app, 'Palette name', pal.name || '').openAndGet();
        if (name && name.trim()) { pal.name = name.trim(); await this.save(); this.display(); }
      }));
      set.addExtraButton(b => b.setIcon('copy').setTooltip('Duplicate').onClick(async () => {
        s.palettes.splice(idx + 1, 0, { name: (pal.name || 'Palette') + ' copy', colors: pal.colors.slice(0, 8) });
        await this.save(); this.display();
      }));
      if (s.palettes.length > 1) set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Delete palette').onClick(async () => {
        s.palettes.splice(idx, 1);
        if (s.activePalette >= s.palettes.length) s.activePalette = s.palettes.length - 1;
        await syncActive(); this.display();
      }));

      const row = e.createDiv('nx-sk-palette-edit');
      pal.colors.forEach((col, ci) => {
        const chip = row.createDiv('nx-sk-palette-chip');
        chip.style.setProperty('--c', col);
        chip.setAttribute('aria-label', col + ' — click to change');
        // Hidden native picker: click the chip to recolour it in place.
        const pick = chip.createEl('input', { cls: 'nx-sk-palette-pick', attr: { type: 'color' } });
        pick.value = /^#[0-9a-f]{6}$/i.test(col) ? col : '#888888';
        pick.oninput = () => { chip.style.setProperty('--c', pick.value); };
        pick.onchange = async () => { pal.colors[ci] = pick.value; if (isActive) s.palette = pal.colors; await this.save(); this.display(); };
        if (pal.colors.length > 1) {
          const rm = chip.createDiv('nx-sk-palette-rm'); setIcon(rm, 'x');
          rm.setAttribute('aria-label', 'Remove colour');
          rm.onclick = async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            pal.colors.splice(ci, 1); if (isActive) s.palette = pal.colors;
            await this.save(); this.display();
          };
        }
      });
      if (pal.colors.length < 8) {
        const add = row.createDiv({ cls: 'nx-sk-palette-add', attr: { 'aria-label': 'Add colour' } });
        setIcon(add, 'plus');
        const pick = add.createEl('input', { cls: 'nx-sk-palette-pick', attr: { type: 'color' } });
        pick.value = '#888888';
        pick.onchange = async () => {
          if (pal.colors.length >= 8) { new Notice('Nexus: palette is full (max 8 colours).'); return; }
          pal.colors.push(pick.value); if (isActive) s.palette = pal.colors;
          await this.save(); this.display();
        };
      } else {
        row.createDiv({ cls: 'nx-sk-palette-full', text: 'full' });
      }
    });
    new Setting(e).addButton(b => b.setButtonText('New palette').setCta().onClick(async () => {
      const name = await new NexusNameModal(this.app, 'Palette name', 'Palette ' + (s.palettes.length + 1)).openAndGet();
      s.palettes.push({ name: (name || '').trim() || 'Palette ' + (s.palettes.length + 1), colors: ['#2f2f2f'] });
      s.activePalette = s.palettes.length - 1;
      await syncActive(); this.display();
    }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Background' });
    new Setting(e).setName('Default background').setDesc('Grid / lines / dots on new pads. Adjust type + spacing + opacity live per sketch via the background button in the toolbar.')
      .addDropdown(dd => dd
        .addOption('none', 'None')
        .addOption('grid', 'Grid')
        .addOption('graph', 'Graph (5×)')
        .addOption('lines', 'Lines')
        .addOption('dots', 'Dots')
        .addOption('cross', 'Cross')
        .addOption('isometric', 'Isometric')
        .addOption('isodots', 'Iso dots')
        .setValue(s.bgType || 'none')
        .onChange(async v => { s.bgType = v; await this.save(); }));
    new Setting(e).setName('Grid / line spacing').setDesc('Default 27 ≈ 5 mm squares like real DIN-A4 grid paper (canvas width ≙ A4 landscape).')
      .addSlider(sl => { sl.setLimits(16, 120, 1).setValue(s.bgSize != null ? s.bgSize : 27).setDynamicTooltip();
        sl.onChange(async v => { s.bgSize = v; await this.save(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default').onClick(async () => { s.bgSize = 27; await this.save(); this.display(); }));
    new Setting(e).setName('Background opacity')
      .addSlider(sl => { sl.setLimits(2, 60, 1).setValue(Math.round((s.bgOpacity != null ? s.bgOpacity : 0.12) * 100)).setDynamicTooltip();
        sl.onChange(async v => { s.bgOpacity = v / 100; await this.save(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default').onClick(async () => { s.bgOpacity = 0.12; await this.save(); this.display(); }));
    new Setting(e).setName('Background color').setDesc('Colour of the grid lines / dots.')
      .addColorPicker(cp => cp.setValue(s.bgColor || '#334155').onChange(async v => { s.bgColor = v; await this.save(); }));

    e.createEl('p', { cls: 'setting-item-description',
      text: 'Note: paper/ink and these background defaults only affect newly created sketches. Drag the strip at the bottom of a pad to make it taller for more drawing room.' });
  }
  tTheme(e) {
    const active = (this.app.customCss && this.app.customCss.theme) ||
      (this.app.vault.getConfig && this.app.vault.getConfig('cssTheme')) || '';
    if (active !== 'Nexus') {
      const p = e.createEl('p', { cls: 'setting-item-description' });
      p.createSpan({ text: 'This tab only works with the active ' });
      p.createEl('b', { text: 'Nexus theme' });
      p.createSpan({ text: '. Currently active: "' + (active || '—') + '". Please choose the Nexus theme in Settings → Appearance.' });
      return;
    }
    const s = this.plugin.settings.theme;
    const apply = async () => {
      await this.save(); this.plugin.applyThemeSettings();
      this.app.workspace.getLeavesOfType('nx-homepage').forEach(l => { try { l.view.render(); } catch (e) {} });
    };

    /* STYLE first: it decides what the app looks like, the palette only tints
       whatever it built. Radio rows rather than a dropdown — with two entries
       the descriptions are the whole point, and they don't fit in an option. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Style' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The shape of the interface. Every style works with every palette below.' });
    const styleWrap = e.createDiv('nx-stylepick');
    Object.entries(THEME_STYLES).forEach(([id, meta]) => {
      const row = styleWrap.createDiv('nx-stylepick-row' + ((s.style || 'mirobo') === id ? ' is-active' : ''));
      const mark = row.createDiv('nx-stylepick-mark');
      setIcon(mark, (s.style || 'mirobo') === id ? 'check' : 'circle');
      const body = row.createDiv('nx-stylepick-body');
      body.createDiv({ cls: 'nx-stylepick-name', text: meta.name });
      body.createDiv({ cls: 'nx-stylepick-sub', text: meta.sub });
      row.createDiv('nx-stylepick-demo is-' + id).innerHTML =
        '<span></span><span></span><span></span>';
      row.onclick = async () => {
        if ((s.style || 'mirobo') === id) return;
        s.style = id;
        await apply();
        this.display();
      };
    });

    /* PALETTE: a swatch you can look at, not a name with its colours spelled
       out after it. The disc shows the four slots the theme actually builds
       everything from — ground, accent, second hue, ink — so two palettes of
       the same family stay tellable apart at a glance. Names and order live in
       constants.js (PALETTE_NAMES / PALETTE_GROUPS), like every other table. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Colour palette' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The colour of whatever the style built.' });

    const isDark = document.body.classList.contains('theme-dark');
    /* "Minimal" keeps its slots per mode, so the disc has to show the mode you
       are actually in — otherwise it advertises a white palette to someone
       sitting in the dark one. */
    const slotOf = (id, key, fb) => {
      if (id === 'dynamic') return 'var(--wl-' + key + ', ' + fb + ')';
      const p = PALETTES[id] || {};
      const mode = (isDark ? p.dark : p.light) || {};
      return mode['--wl-' + key] || (p.slots || p)[key] || fb;
    };
    const disc = (id) => 'conic-gradient(from -45deg, ' +
      slotOf(id, 'color0', '#222') + ' 0 25%, ' +
      slotOf(id, 'color3', '#4a9eff') + ' 0 50%, ' +
      slotOf(id, 'color5', '#888') + ' 0 75%, ' +
      slotOf(id, 'color15', '#fff') + ' 0)';

    const pick = e.createDiv('nx-palpick');
    PALETTE_GROUPS.forEach(g => {
      pick.createDiv({ cls: 'nx-palpick-group', text: g.title });
      const row = pick.createDiv('nx-palpick-row');
      g.ids.forEach(id => {
        const cur = (s.palette || 'nexus') === id;
        const tile = row.createDiv('nx-palpick-tile' + (cur ? ' is-active' : ''));
        tile.setAttribute('aria-label', PALETTE_NAMES[id] || id);
        tile.createDiv('nx-palpick-disc').style.background = disc(id);
        tile.createDiv({ cls: 'nx-palpick-name', text: PALETTE_NAMES[id] || id });
        tile.onclick = async () => {
          if ((s.palette || 'nexus') === id) return;
          s.palette = id;
          await apply();
          this.display();
        };
      });
    });

    const note = e.createEl('p', { cls: 'setting-item-description nx-palpick-note' });
    note.createEl('b', { text: 'Velumeron' });
    note.createSpan({ text: ' is the only live one: it pulls its colours from wallust, so the theme recolours together with your wallpaper and the desktop bar. That needs a machine running the Velumeron shell — anywhere else (a plain desktop, the tablet) pick a fixed palette.' });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Spacing & sizes' });
    const slider = (name, key, min, max, def) => new Setting(e).setName(name)
      .addSlider(sl => { sl.setLimits(min, max, 1).setValue(s[key] != null ? s[key] : def).setDynamicTooltip();
        sl.onChange(async v => { s[key] = v; await apply(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default').onClick(async () => { s[key] = null; await apply(); this.display(); }));
    slider('Homepage · Columns', 'homeCols', 8, 48, 24);
    slider('Homepage · Card base height', 'homeRow', 20, 160, 40);
    slider('Homepage · Card gap', 'homeGap', 4, 40, 12);
    slider('Homepage · Edge padding', 'homePad', 8, 80, 30);
    if ((s.style || 'mirobo') !== 'plain') {
      slider('Theme · Card gap (global)', 'gap', 4, 32, 12);
      slider('Theme · Corner radius (global)', 'radius', 0, 28, 12);
    } else {
      e.createEl('p', { cls: 'setting-item-description',
        text: 'Card gap and corner radius belong to the Mirobo style — "Almost nothing" has no cards to space out.' });
    }
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
  tTypography(e) {
    const s = this.plugin.settings.typography;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Typed while writing, replaced the moment the sequence is complete. Each option below lists exactly what it converts.' });

    /* The old labels ("Dashes (-- → – → —)") crammed the rule INTO the name and
       still left you guessing which input produced which character. Show the
       actual pairs instead: what you type on the left, what you get on the right. */
    const opt = (key, label, pairs, note) => {
      new Setting(e).setName(label)
        .addToggle(t => t.setValue(s[key]).onChange(async v => { s[key] = v; await this.save(); }));
      const map = e.createDiv('nx-st-map');
      pairs.forEach(([from, to]) => {
        const row = map.createDiv('nx-st-pair');
        row.createSpan({ cls: 'nx-st-in', text: from });
        row.createSpan({ cls: 'nx-st-arrow', text: '→' });
        row.createSpan({ cls: 'nx-st-out', text: to });
      });
      if (note) map.createDiv({ cls: 'nx-st-note', text: note });
    };

    // Pairs come from the same table the editor hook uses (constants.js), so
    // this list cannot claim a rule that isn't actually wired up.
    const byGroup = (grp) => ST_SYMBOL_RULES.filter(r => r.grp === grp).map(r => [r.m, r.r]);
    opt('dashes', 'Dashes', byGroup('dashes'), 'Type -- for an en dash, then one more hyphen for an em dash.');
    opt('ellipsis', 'Ellipsis', byGroup('ellipsis'));
    opt('quotes', 'Typographic quotes', [['"word"', '“word”'], ["'word'", '‘word’']],
      'Opening or closing is decided by what precedes the quote — after a space or bracket it opens, otherwise it closes.');
    opt('arrows', 'Arrows', byGroup('arrows'));
    opt('symbols', 'Symbols', byGroup('symbols'));
  }
  tCalendar(e) {
    const s = this.plugin.settings.calendar;
    this.head(e, s);
    new Setting(e).setName('Show ribbon icon').setDesc('Reload the plugin after changing.')
      .addToggle(t => t.setValue(s.ribbon).onChange(async v => { s.ribbon = v; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description', text: 'Uses your Daily Notes settings (folder/format/template). Command "Open calendar".' });
  }
  tPropHider(e) {
    const s = this.plugin.settings.propertyHider;
    this.head(e, s, () => this.plugin.applyPropertyHider());
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Right-click a property → "Hide". The eye icon next to "Add property" shows/hides them again.' });
    if (s.hidden.length) {
      s.hidden.forEach(k => new Setting(e).setName(k)
        .addButton(b => b.setButtonText('Show').onClick(async () => { await this.plugin.unhideProperty(k); this.display(); })));
    } else {
      e.createEl('p', { cls: 'setting-item-description', text: 'Currently hidden: — none —' });
    }
  }
  _calloutSwatch(set, c, icon) {
    const sw = set.nameEl.createSpan('nx-callout-swatch');
    const col = c && (c.color || c.colorDark || c.colorLight);
    if (col) sw.style.setProperty('--sw', `rgb(${col})`);
    if (icon) setIcon(set.nameEl.createSpan('nx-callout-swatch-icon'), icon);
  }
  tCallouts(e) {
    const s = this.plugin.settings.callouts;
    // Drop fully-empty overrides (e.g. an abandoned "customize built-in" that set
    // nothing) so both lists stay clean.
    s.items = s.items.filter(c => c.id && (c.icon || c.color || c.colorLight || c.colorDark));
    this.head(e, s, () => this.plugin.applyCallouts());
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Give any callout a custom icon and color (icon + --callout-color, light/dark aware). Use it as > [!type]. Obsidian’s built-in callouts are listed below and can be overridden; custom types work the same way. Command "Insert callout" adds one at the cursor.' });

    new Setting(e).setName('Add custom callout').setDesc('Create a brand-new callout type.')
      .addButton(b => b.setButtonText('New').setCta().onClick(() => {
        const item = { id: '', icon: '', color: '', colorLight: '', colorDark: '' };
        s.items.push(item);
        new NexusCalloutModal(this.plugin, item, () => this.display()).open();
      }));
    new Setting(e).setName('Import from Callout Manager').setDesc('Re-import icons/colors from the eth-p Callout Manager plugin (adds any missing types).')
      .addButton(b => b.setButtonText('Import').onClick(async () => {
        s.migrated = false; await this.plugin.migrateCallouts(); this.plugin.applyCallouts(); this.display();
      }));

    const itemFor = (id) => s.items.find(x => x.id === id);

    // ── Custom callouts (anything that isn't a canonical built-in) ──
    e.createEl('h4', { text: 'Custom callouts', cls: 'nx-callout-h' });
    const custom = s.items.filter(c => !NX_BUILTIN_IDS.has(c.id));
    if (!custom.length) e.createEl('p', { cls: 'setting-item-description', text: '— none yet —' });
    custom.forEach(c => {
      const set = new Setting(e).setName(c.id || '(unnamed)').setDesc('custom');
      this._calloutSwatch(set, c, c.icon || 'pencil');
      set.addExtraButton(b => b.setIcon('pencil').setTooltip('Edit')
        .onClick(() => new NexusCalloutModal(this.plugin, c, () => this.display()).open()));
      set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Delete')
        .onClick(async () => { s.items = s.items.filter(x => x !== c); await this.plugin.saveSettings(); this.plugin.applyCallouts(); this.display(); }));
    });

    // ── Built-in Obsidian callouts (recognized; overridable) ──
    e.createEl('h4', { text: 'Built-in callouts', cls: 'nx-callout-h' });
    NX_BUILTIN_CALLOUTS.forEach(bi => {
      const c = itemFor(bi.id);
      const set = new Setting(e).setName(bi.id).setDesc(c ? 'customized' : 'default');
      this._calloutSwatch(set, c, (c && c.icon) || bi.icon);
      set.addExtraButton(x => x.setIcon('pencil').setTooltip(c ? 'Edit override' : 'Customize')
        .onClick(() => {
          let item = itemFor(bi.id);
          if (!item) { item = { id: bi.id, icon: '', color: '', colorLight: '', colorDark: '' }; s.items.push(item); }
          new NexusCalloutModal(this.plugin, item, () => this.display(), { fixedId: true, defIcon: bi.icon }).open();
        }));
      if (c) set.addExtraButton(x => x.setIcon('rotate-ccw').setTooltip('Reset to default')
        .onClick(async () => { s.items = s.items.filter(y => y !== c); await this.plugin.saveSettings(); this.plugin.applyCallouts(); this.display(); }));
    });
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
}

module.exports = { NexusSettingsTab };
