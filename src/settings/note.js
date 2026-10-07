'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings · inside a note
 *  Settings pages: Banner, Callouts, Columns, Typography, Property hider,
 *  Tag tools. Mixed into the settings tab (lib/mixin.js); `this` is the tab.
 * ========================================================================== */

const { Notice, Setting, setIcon } = require('obsidian');
const { NexusCalloutModal } = require('../modals/callout.js');
const { NexusConfirmModal, NexusNameModal } = require('../modals/misc.js');
const { NexusTagRenameModal } = require('../modals/tags.js');
const { nxAllTagCounts, nxFilesWithTag, nxRenameTag } = require('../lib/tagtools.js');
const { nxBlockExample } = require('../lib/inputs.js');
const { NX_BUILTIN_CALLOUTS, NX_CALLOUT_VARS, NX_BUILTIN_IDS, ST_SYMBOL_RULES } = require('../constants.js');

class NotePages {

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
  tColumns(e) {
    const s = this.plugin.settings.columns;
    this.head(e, s);
    new Setting(e).setName('Delimiter').setDesc('Line that separates columns (default ===).')
      .addText(t => t.setValue(s.delimiter).onChange(async v => { s.delimiter = v || '==='; await this.save(); }));
    new Setting(e).setName('Column gap').addText(t => t.setValue(s.gap)
      .onChange(async v => { s.gap = v || '1.5rem'; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description', text: 'Renders in Live Preview and in Reading mode. The example uses the separator set above.' });
    nxBlockExample(e, 'columns', [
      '### Left',
      'Anything markdown can do works in a column —',
      'lists, links, images, even another block.',
      '',
      (s.delimiter || '===').trim(),
      '',
      '### Right',
      'A third column is one more separator.',
    ]);
  }
  tTypography(e) {
    const s = this.plugin.settings.typography;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Typed while writing, replaced the moment the sequence is complete. Each option below lists exactly what it converts.' });

    /* A replacement rule is a pair, so it is shown as two aligned columns and
       not as a wrapping row of pills with an arrow inside each one. The arrows
       were the thing that made the page unreadable: with the pairs aligned the
       columns already say which side is which, and the eye can run down a
       column instead of decoding twenty little chips. */
    const opt = (key, label, pairs, note) => {
      new Setting(e).setName(label)
        .addToggle(t => t.setValue(s[key]).onChange(async v => { s[key] = v; await this.save(); }));
      const map = e.createDiv('nx-st-map');
      const head = map.createDiv('nx-st-pair is-head');
      head.createSpan({ cls: 'nx-st-in', text: 'You type' });
      head.createSpan({ cls: 'nx-st-out', text: 'You get' });
      pairs.forEach(([from, to]) => {
        const row = map.createDiv('nx-st-pair');
        row.createSpan({ cls: 'nx-st-in', text: from });
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
  /* The dot has to show the colour of the callout it stands for. It used to be
     filled only when the user had overridden the colour — which is almost
     never — so the whole list was one grey dot repeated twenty times.
     Un-overridden types take Obsidian's own `--callout-<id>`, which is the
     colour actually painted in a note.

     Both forms have to be handled: older builds store "r, g, b" and newer ones
     store a colour (see _calloutTripletMode). A triplet fed straight into
     `background` paints nothing, and a colour wrapped in rgb() likewise. */
  _calloutColour(id, c) {
    const stored = c && (c.color || c.colorDark || c.colorLight);
    const raw = stored != null && stored !== ''
      ? String(stored).trim()
      : String(getComputedStyle(document.body)
          .getPropertyValue('--callout-' + (NX_CALLOUT_VARS[id] || id)) || '').trim();
    if (!raw) return '';
    return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(raw) ? `rgb(${raw})` : raw;
  }
  _calloutSwatch(set, c, icon, id) {
    const sw = set.nameEl.createSpan('nx-callout-swatch');
    const col = this._calloutColour(id || (c && c.id), c);
    if (col) sw.style.setProperty('--sw', col);
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
      this._calloutSwatch(set, c, c.icon || 'pencil', c.id);
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
      this._calloutSwatch(set, c, (c && c.icon) || bi.icon, bi.id);
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
}

module.exports = NotePages;
