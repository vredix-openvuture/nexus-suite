'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings · dashboard and look
 *  Settings pages: Dashboard, Theme, Explorer, Folder notes.
 *  Mixed into the settings tab (lib/mixin.js); `this` is the tab.
 * ========================================================================== */

const { Notice, Setting, setIcon } = require('obsidian');
const { FN_TYPES } = require('../lib/foldernotes.js');
const { nxAutocomplete, nxBlockExample, nxMultiRow } = require('../lib/inputs.js');
const { nxAllFolders } = require('../lib/helpers.js');
const { HOME_VIEW, PALETTES, PALETTE_GROUPS, PALETTE_NAMES, THEME_STYLES } = require('../constants.js');

class LookPages {
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
    new Setting(e).setName('On startup').setDesc('What the dashboard does when Obsidian starts.')
      .addDropdown(d => d
        .addOption('off', 'Nothing')
        .addOption('tab', 'Open it in a tab of its own')
        .addOption('closeAll', 'Close every tab, then open it')
        .setValue(s.startup || 'off')
        .onChange(async v => { s.startup = v; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A tab of its own never replaces a note you left open — and when the dashboard is pinned, it brings that pinned tab forward instead of opening a second one. Closing every tab leaves the pinned Nexus pages where they are; the watchdog would only put them back anyway.' });
    new Setting(e).setName('Open when the last tab closes')
      .setDesc('Closing the final tab in the main area brings the dashboard up instead of leaving an empty pane.')
      .addToggle(t => t.setValue(!!s.openWhenEmpty)
        .onChange(async v => { s.openWhenEmpty = v; await this.save(); }));

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

    /* The grid these size lives here and not on the Theme tab, where they used
       to sit: they describe the dashboard, not the look of the app. The Theme
       tab is style and palette, nothing else. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'The card grid' });
    const t = this.plugin.settings.theme;
    const applyTheme = async () => { await this.save(); this.plugin.applyThemeSettings(); };
    const slider = (name, key, min, max, def) => new Setting(e).setName(name)
      .addSlider(sl => { sl.setLimits(min, max, 1).setValue(t[key] != null ? t[key] : def).setDynamicTooltip();
        sl.onChange(async v => { t[key] = v; await applyTheme(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Default')
        .onClick(async () => { t[key] = null; await applyTheme(); this.display(); }));
    slider('Columns', 'homeCols', 8, 48, 24);
    slider('Card base height', 'homeRow', 20, 160, 40);
    slider('Card gap', 'homeGap', 4, 40, 12);
    slider('Edge padding', 'homePad', 8, 80, 30);
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

    /* Two axes and no third. The card gap and the corner radius used to be
       sliders here; they are geometry, and geometry now comes from one token
       block that the theme and the plugin share (themes/Nexus/docs/style-guide.md).
       A slider that competes with it is how the same element ended up with a
       different corner on every page. The stored values are still read in
       applyTheme(), so anyone who moved a slider keeps what they set — there is
       just no longer a control that invites it.

       The dashboard's own grid sliders moved to the Dashboard tab, where the
       thing they size actually lives. */
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

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Hidden folders' });
    new Setting(e).setName('Hide the attachment folder')
      .setDesc('Takes it out of the file tree. The files stay where they are and every link keeps working — this only stops the folder from taking up the sidebar.')
      .addToggle(t => t.setValue(!!s.hideAttachments)
        .onChange(async v => { s.hideAttachments = v; await this.save(); this.plugin.applyExplorer(); this.display(); }));
    if (s.hideAttachments) {
      const detected = this.plugin.defaultAttachmentFolder();
      new Setting(e).setName('Folder name')
        .setDesc(detected
          ? 'Empty uses what Obsidian is set to: ' + detected
          : 'Obsidian puts attachments beside each note here, so there is no single folder to hide — name one.')
        .addText(t => { t.setPlaceholder(detected || 'Attachments').setValue(s.attachmentFolder || '')
          .onChange(async v => {
            s.attachmentFolder = (v || '').trim().replace(/^\/|\/$/g, '');
            await this.save(); this.plugin.applyExplorer(); });
          t.inputEl.addClass('nx-input');
          nxAutocomplete(t.inputEl, () => nxAllFolders(this.app), async (v) => {
            s.attachmentFolder = v; await this.save(); this.plugin.applyExplorer(); }); });
    }

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
      text: 'Code block ```folder-overview``` renders the contents of the folder. Every line is optional — without any it lists the folder the note sits in.' });
    nxBlockExample(e, 'folder-overview', [
      'title: In this folder',
      'folder:                   # empty = the folder this note is in',
      'depth: 2',
      'include: markdown         # folder | markdown | all',
      'sort: modified            # name | created | modified',
      'asc: false',
      'style: list               # list | grid',
    ]);
  }
}

module.exports = LookPages;
