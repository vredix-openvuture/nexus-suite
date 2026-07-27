'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings tab
 *  Plugin settings tab.
 * ========================================================================== */

const { Notice, PluginSettingTab, Setting, setIcon } = require('obsidian');
const { NexusCalloutModal } = require('./modals/callout.js');
const { NexusAccountModal } = require('./modals/account.js');
const { NexusTaskModal } = require('./modals/task.js');
const { NexusNameModal } = require('./modals/misc.js');
const calstore = require('./lib/calstore.js');
const tasks = require('./lib/tasks.js');
const { HOME_VIEW, NX_BUILTIN_CALLOUTS, NX_BUILTIN_IDS, PALETTES } = require('./constants.js');

class NexusSettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.active = 'banner'; }
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

    new Setting(e).setName('Data folder').setDesc('Where the event cache + local calendars are stored (inside the vault → synced).')
      .addText(t => t.setValue(s.dataFolder).onChange(async v => { s.dataFolder = (v || '').trim() || '_nexus'; await this.save(); }));
    new Setting(e).setName('Default view').addDropdown(d => d.addOption('month', 'Month').addOption('week', 'Week').addOption('day', 'Day')
      .setValue(s.defaultView).onChange(async v => { s.defaultView = v; await this.save(); }));
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
      .addButton(b => b.setButtonText('Sync now').onClick(() => { new Notice('Nexus: syncing…'); this.plugin.syncTaskCal().then(() => { new Notice('Nexus: sync done.'); renderAccounts(); }); }));

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

    const tabs = [
      { id: 'banner',        label: 'Banner',           icon: 'image',            fn: (e) => this.tBanner(e) },
      { id: 'hider',         label: 'Hider',            icon: 'eye-off',          fn: (e) => this.tHider(e) },
      { id: 'columns',       label: 'Columns',          icon: 'columns-2',        fn: (e) => this.tColumns(e) },
      { id: 'homepage',      label: 'Homepage',         icon: 'home',             fn: (e) => this.tHomepage(e) },
      { id: 'search',        label: 'Search',            icon: 'search',           fn: (e) => this.tSearch(e) },
      { id: 'typography',    label: 'Smart Typography', icon: 'type',             fn: (e) => this.tTypography(e) },
      { id: 'calendar',      label: 'Calendar',         icon: 'calendar',         fn: (e) => this.tCalendar(e) },
      { id: 'tasksCalendar', label: 'Tasks & Calendar', icon: 'calendar-check',    fn: (e) => this.tTasksCalendar(e) },
      { id: 'propertyHider', label: 'Property Hider',   icon: 'list',             fn: (e) => this.tPropHider(e) },
      { id: 'callouts',      label: 'Callouts',         icon: 'message-square-quote', fn: (e) => this.tCallouts(e) },
      { id: 'workspaces',    label: 'Workspaces',       icon: 'layout-dashboard', fn: (e) => this.tWorkspaces(e) },
      { id: 'externalEdit',  label: 'Quick Edit',       icon: 'file-edit',        fn: (e) => this.tExternal(e) },
      { id: 'explorer',      label: 'Explorer',         icon: 'folder-tree',      fn: (e) => this.tExplorer(e) },
      { id: 'inkCapture',    label: 'Ink Capture',      icon: 'camera',           fn: (e) => this.tInkCapture(e) },
      { id: 'quicksketch',   label: 'Quick Sketch',     icon: 'pencil-line',      fn: (e) => this.tSketch(e) },
      { id: 'theme',         label: 'Theme',            icon: 'palette',          fn: (e) => this.tTheme(e) },
    ];
    if (!tabs.find(t => t.id === this.active)) this.active = tabs[0].id;

    const renderBody = () => {
      body.empty();
      const t = tabs.find(x => x.id === this.active);
      body.createEl('h3', { text: t.label });
      t.fn(body);
      nav.querySelectorAll('.nx-settings-tab').forEach(el => el.toggleClass('is-active', el.getAttribute('data-id') === this.active));
    };
    tabs.forEach(t => {
      const btn = nav.createDiv('nx-settings-tab');
      btn.setAttribute('data-id', t.id);
      setIcon(btn.createDiv('nx-settings-tab-icon'), t.icon);
      btn.createDiv({ cls: 'nx-settings-tab-label', text: t.label });
      btn.onclick = () => { this.active = t.id; renderBody(); };
    });
    renderBody();
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
    new Setting(e).setName('Banner folder').setDesc('Target folder in the vault where imported images are copied.')
      .addText(t => t.setPlaceholder('attachments/banners').setValue(s.folder).onChange(async v => { s.folder = v; await this.save(); }));
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
  tInkCapture(e) {
    const s = this.plugin.settings.inkCapture;
    this.head(e, s);
    new Setting(e).setName('Ribbon icon').addToggle(t => t.setValue(s.ribbon)
      .onChange(async v => { s.ribbon = v; await this.save(); new Notice('Nexus: Restart/reload for the ribbon change.'); }));
    new Setting(e).setName('Tag dialog after capture')
      .setDesc('Only for scans taken via the Capture button/command — files that just appear in a source folder never trigger a popup.')
      .addToggle(t => t.setValue(s.tagOnCapture).onChange(async v => { s.tagOnCapture = v; await this.save(); }));

    const srcLabels = { paper: 'Paper (camera)', saber: 'Saber', butterfly: 'Butterfly' };
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Sources' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Anything landing in a source folder (via the camera button, or synced/exported in some other way) automatically gets its own capture folder — a sidecar note (as a folder note, requires the folder-notes plugin to open with one click) plus the raw file, flat inside it. Accepts images and PDF.' });
    for (const id of ['paper', 'saber', 'butterfly']) {
      const src = s.sources[id];
      new Setting(e).setName(srcLabels[id]).addToggle(t => t.setValue(src.enabled)
        .onChange(async v => { src.enabled = v; await this.save(); await this.plugin.ensureInkFolders(); }));
      new Setting(e).setName('Folder').setClass('nx-set-sub')
        .addText(t => t.setPlaceholder('Inbox/' + srcLabels[id].split(' ')[0]).setValue(src.folder)
          .onChange(async v => { src.folder = v || src.folder; await this.save(); await this.plugin.ensureInkFolders(); }));
    }

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Excalidraw' });
    new Setting(e).setName('Show in gallery')
      .setDesc('Surfaces existing Excalidraw drawings (frontmatter excalidraw-plugin: parsed) in the Ink Capture gallery for tagging/findability — no folder needed, no sidecar created.')
      .addToggle(t => t.setValue(s.excalidraw.enabled).onChange(async v => { s.excalidraw.enabled = v; await this.save(); }));

    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Capture scan" or the camera ribbon icon opens the gallery / takes a paper photo. Saber and Butterfly have no in-app capture (they\'re separate apps) — export a PDF/image from them into their source folder instead.' });
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
    new Setting(e).setName('Paper texture').setDesc('Lay a subtle paper grain over the pad. Works on any paper colour; toggle live per sketch via the background button.')
      .addToggle(t => t.setValue(s.paperStyle !== false).onChange(async v => { s.paperStyle = v; await this.save(); }));
    new Setting(e).setName('Invert ink on dark paper').setDesc('On a dark paper (Black), lift ONLY near-black ink so dark drawings stay readable — vivid colours keep their punch. Non-destructive: colours are only changed for display and export.')
      .addToggle(t => t.setValue(s.invertOnDark !== false).onChange(async v => { s.invertOnDark = v; await this.save(); }));
    new Setting(e).setName('Default ink color')
      .addColorPicker(cp => cp.setValue(s.ink || '#2f2f2f').onChange(async v => { s.ink = v; await this.save(); }));
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Brush sizes' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'On-screen px, remembered per pen. Adjust live per sketch in the toolbar (slider); switching pens restores that pen’s width.' });
    const penSizes = s.penSizes || (s.penSizes = { fountain: 3, ballpoint: 2, pencil: 2.5, brush: 5, calligraphy: 3.5, marker: 10 });
    [['fountain', 'Fountain'], ['ballpoint', 'Ballpoint'], ['pencil', 'Pencil'], ['brush', 'Brush'], ['calligraphy', 'Calligraphy'], ['marker', 'Marker']].forEach(([id, label]) => {
      new Setting(e).setName(label).setClass('nx-set-sub')
        .addSlider(sl => { sl.setLimits(0.5, 40, 0.1).setValue(penSizes[id] != null ? penSizes[id] : 3).setDynamicTooltip();
          sl.onChange(async v => { penSizes[id] = v; await this.save(); }); });
    });
    new Setting(e).setName('Size favourites').setDesc('The 3 quick-set widths in the toolbar (also settable there via press-and-hold).')
      .addText(t => t.setPlaceholder('1.5, 3, 8').setValue((s.sizeFavorites || [1.5, 3, 8]).join(', '))
        .onChange(async v => {
          const nums = v.split(',').map(x => parseFloat(x.trim())).filter(x => x > 0).slice(0, 3);
          if (nums.length) { s.sizeFavorites = nums; await this.save(); }
        }));
    new Setting(e).setName('Auto-extend downward').setDesc('New pads grow taller automatically as you draw near the bottom. Toggle per sketch in the toolbar.')
      .addToggle(t => t.setValue(!!s.autoGrow).onChange(async v => { s.autoGrow = v; await this.save(); }));
    new Setting(e).setName('Shape recognition').setDesc('Hold the pen still right after drawing → the stroke snaps to a clean line / rectangle / ellipse / triangle.')
      .addToggle(t => t.setValue(s.shapeSnap !== false).onChange(async v => { s.shapeSnap = v; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Pen behaviour (smoothing, pressure, sharpness, speed fade — and the marker\'s tip/overlap): tap the ACTIVE pen in a sketch toolbar again. Colour palettes (create/rename/switch, max 8 colours): the swatch-book button next to the colours.' });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Palette (active)' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Colours of the ACTIVE palette (max 8). Create/rename/switch palettes via the swatch-book button in any sketch toolbar.' });
    if (!Array.isArray(s.palettes) || !s.palettes.length) s.palettes = [{ name: 'Default', colors: (s.palette || ['#2f2f2f']).slice(0, 8) }];
    if (s.activePalette == null || s.activePalette >= s.palettes.length) s.activePalette = 0;
    const pal = s.palettes[s.activePalette];
    s.palette = pal.colors;
    const palRow = e.createDiv('nx-sk-palette-edit');
    pal.colors.forEach(col => {
      const chip = palRow.createDiv('nx-sk-palette-chip');
      chip.style.setProperty('--c', col);
      chip.setAttribute('aria-label', col);
      const rm = chip.createDiv('nx-sk-palette-rm'); setIcon(rm, 'x');
      rm.onclick = async () => { if (pal.colors.length > 1) { pal.colors = pal.colors.filter(c => c !== col); s.palette = pal.colors; await this.save(); this.display(); } };
    });
    new Setting(e).setName('Add colour').setClass('nx-set-sub')
      .addColorPicker(cp => cp.setValue('#888888'))
      .addButton(b => b.setButtonText('Add').onClick(async () => {
        const cp = e.querySelector('.nx-set-sub input[type="color"]');
        const v = cp && cp.value;
        if (!v) return;
        if (pal.colors.length >= 8) { new Notice('Nexus: palette is full (max 8 colours).'); return; }
        if (!pal.colors.map(c => c.toLowerCase()).includes(v.toLowerCase())) { pal.colors.push(v); s.palette = pal.colors; await this.save(); this.display(); }
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

    // Nexus signature family — pretty labels + a fixed order (default first).
    const NX_PAL_LABELS = {
      nexus:   'Nexus · Ember & Prussian (default)',
      azure:   'Azure & Coral',
      teal:    'Teal & Amber',
      emerald: 'Emerald & Gold',
      slate:   'Slate & Cyan',
      sunset:  'Sunset · Amber & Rose',
    };
    const NX_PAL_ORDER = ['nexus', 'azure', 'teal', 'emerald', 'slate', 'sunset'];
    new Setting(e).setName('Color palette').setDesc('A Nexus signature palette (Ember & Prussian is the default) or a built-in theme. "Velumeron" follows your wallpaper live — see the note below.')
      .addDropdown(dd => {
        NX_PAL_ORDER.forEach(k => dd.addOption(k, NX_PAL_LABELS[k]));
        Object.keys(PALETTES).forEach(k => { if (!NX_PAL_ORDER.includes(k)) dd.addOption(k, k[0].toUpperCase() + k.slice(1)); });
        dd.addOption('dynamic', 'Velumeron (Desktop shell)');
        dd.setValue(s.palette || 'nexus');
        dd.onChange(async v => { s.palette = v; await apply(); });
      });

    const note = e.createEl('p', { cls: 'setting-item-description' });
    note.createEl('b', { text: 'Velumeron (Desktop shell)' });
    note.createSpan({ text: ' pulls its colours live from wallust so the theme recolours together with your wallpaper and the desktop bar. This only works on a system running the ' });
    note.createEl('b', { text: 'Velumeron desktop shell' });
    note.createSpan({ text: ' (which feeds the wallust snippet). Anywhere else — a plain desktop, or the tablet/phone — pick a fixed palette instead; ' });
    note.createEl('b', { text: 'Nexus' });
    note.createSpan({ text: ' is the recommended default and looks right everywhere.' });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Spacing & sizes' });
    const slider = (name, key, min, max, def) => new Setting(e).setName(name)
      .addSlider(sl => { sl.setLimits(min, max, 1).setValue(s[key] != null ? s[key] : def).setDynamicTooltip();
        sl.onChange(async v => { s[key] = v; await apply(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default').onClick(async () => { s[key] = null; await apply(); this.display(); }));
    slider('Homepage · Columns', 'homeCols', 8, 48, 24);
    slider('Homepage · Card base height', 'homeRow', 20, 160, 40);
    slider('Homepage · Card gap', 'homeGap', 4, 40, 12);
    slider('Homepage · Edge padding', 'homePad', 8, 80, 30);
    slider('Theme · Card gap (global)', 'gap', 4, 32, 12);
    slider('Theme · Corner radius (global)', 'radius', 0, 28, 12);
  }
  tSearch(e) {
    this.head(e, this.plugin.settings.search);
    e.createEl('p', { cls: 'setting-item-description', text: 'Command "Nexus Suite: Open search" (assign a hotkey). Fuzzy over title & content.' });
  }
  tTypography(e) {
    const s = this.plugin.settings.typography;
    this.head(e, s);
    const opt = (k, l) => new Setting(e).setName(l).addToggle(t => t.setValue(s[k]).onChange(async v => { s[k] = v; await this.save(); }));
    opt('dashes', 'Dashes (-- → – → —)');
    opt('ellipsis', 'Ellipsis (…)');
    opt('quotes', 'Typographic quotes');
    opt('arrows', 'Arrows (→ ← ⇒)');
    opt('symbols', '© ® ™');
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
      text: 'Ctrl+Alt+Tab opens the tile switcher (layout preview, core "Workspaces" plugin). There is also the command "Nexus Suite: Open workspace switcher" for a custom hotkey.' });
  }
  tExternal(e) {
    const s = this.plugin.settings.externalEdit;
    this.head(e, s);
    new Setting(e).setName('Focus mode').setDesc('Load the focus workspace on open; restore the previous one on close.')
      .addToggle(t => t.setValue(s.focus).onChange(async v => { s.focus = v; await this.save(); }));
    new Setting(e).setName('Focus workspace').setDesc('Name of a saved workspace loaded during Quick Edit. Empty / not present → sidebars are just collapsed.')
      .addText(t => t.setPlaceholder('Focus').setValue(s.workspace).onChange(async v => { s.workspace = v; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Open external .md (Quick Edit)" (assign a hotkey). Opens a file OUTSIDE the vault temporarily, writes changes live back to the original file, and removes the temp file on close (workspace switches back). Desktop only.' });
  }
}

module.exports = { NexusSettingsTab };
