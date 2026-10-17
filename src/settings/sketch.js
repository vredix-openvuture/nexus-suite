'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings · Quick Sketch
 *  The Quick Sketch settings page: paper, pens, toolbar, gestures, OCR.
 *  Mixed into the settings tab (lib/mixin.js); `this` is the tab.
 * ========================================================================== */

const { Notice, Setting, setIcon } = require('obsidian');
const { NexusNameModal } = require('../modals/misc.js');
const penGestures = require('../lib/sketchgestures.js');
const sketchSearch = require('../lib/sketchsearch.js');
const { BAR_DEFAULTS, BAR_ITEMS, BAR_MODES, PEN_IDS, PEN_LABELS } = require('../constants.js');

class SketchPage {

  tSketch(e) {
    const s = this.plugin.settings.quicksketch;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Code block ```quicksketch``` renders a pad you can draw on with pen, touch or mouse (pen pressure → line width). Each drawing is saved as a standalone .svg sidecar. Command "Insert quick sketch" adds a block at the cursor.' });
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'The paper' });
    new Setting(e).setName('Sketch folder').setDesc('Where the .svg sidecars are stored.')
      .addText(t => t.setPlaceholder('Inbox/Quicksketch').setValue(s.folder)
        .onChange(async v => { s.folder = v || 'Inbox/Quicksketch'; await this.save(); await this.plugin.ensureSketchFolder(); }));
    new Setting(e).setName('Default aspect ratio').setDesc('New pads use this (e.g. 16:9, 4:3, 1:1). Existing sketches keep their own.')
      .addText(t => t.setPlaceholder('16:9').setValue(s.ratio).onChange(async v => { s.ratio = v || '16:9'; await this.save(); }));
    new Setting(e).setName('Default paper').setDesc('Fill behind the ink on new pads. Native = the note\'s own background; Paper = slightly yellowish off-white; White / Black = solid. Change live per sketch in the toolbar (background button).')
      .addDropdown(dd => dd
        .addOption('native', 'Native (note background)')
        .addOption('paper', 'Paper (off-white)')
        .addOption('white', 'White')
        .addOption('black', 'Black')
        .setValue(s.paper || 'paper')
        .onChange(async v => { s.paper = v; await this.save(); }));
    new Setting(e).setName('Default paper type').setDesc('What shape the paper is on new pads. Endless = one sheet that grows downward forever. Sectioned = the same, cut into A4 pages with a gap between them, so the page edges are visible and an export has real pages. Mindmap = no sheet at all, a canvas you can move in every direction. Change live per sketch in the toolbar (background button).')
      .addDropdown(dd => dd
        .addOption('endless', 'Endless')
        .addOption('sectioned', 'Sectioned (A4 pages)')
        .addOption('mindmap', 'Mindmap (endless in every direction)')
        .setValue(s.paperType || 'endless')
        .onChange(async v => { s.paperType = v; await this.save(); }));
    new Setting(e).setName('A4 the wide way round').setDesc('Sectioned paper only: pages are A4 landscape instead of portrait.')
      .addToggle(t => t.setValue(!!s.sheetLandscape).onChange(async v => { s.sheetLandscape = v; await this.save(); }));
    new Setting(e).setName('Sheet width').setDesc('How wide the paper may render, in pixels. Endless paper has a fixed width, so this is what stops a tablet turned to landscape from stretching the same note to a bigger ink size. 0 = fill whatever space there is. Ignored on mindmap paper, which fills the pane.')
      .addText(t => t.setPlaceholder('1100').setValue(String(s.paperWidth != null ? s.paperWidth : 1100))
        .onChange(async v => {
          const px = parseInt(v, 10);
          s.paperWidth = isFinite(px) && px > 0 ? px : 0;
          await this.save();
        }));
    new Setting(e).setName('Paper texture').setDesc('Lay a subtle paper grain over the pad. Works on any paper colour; toggle live per sketch via the background button.')
      .addToggle(t => t.setValue(s.paperStyle !== false).onChange(async v => { s.paperStyle = v; await this.save(); }));
    new Setting(e).setName('Invert ink on dark paper').setDesc('On a dark paper (Black), lift ONLY near-black ink so dark drawings stay readable — vivid colours keep their punch. Non-destructive: colours are only changed for display and export.')
      .addToggle(t => t.setValue(s.invertOnDark !== false).onChange(async v => { s.invertOnDark = v; await this.save(); }));
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

    /* ── Pen ─────────────────────────────────────────────────────────────────
       The honest framing matters here: people expect the S Pen's air gestures
       and they simply are not available to a web app, so the note says so
       rather than letting someone hunt for a setting that cannot exist. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Pen buttons' });
    const penNote = e.createEl('p', { cls: 'setting-item-description' });
    const renderPenNote = () => {
      const profile = penGestures.PEN_PROFILES[s.penProfile] || penGestures.PEN_PROFILES.generic;
      penNote.setText(profile.note + ' A browser only sees what the pen does on or near the glass: its buttons, the eraser end, and taps.');
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
    penGestures.profileGestures(s.penProfile).forEach(g => {
      const active = penGestures.resolveMap(s.penProfile, s.penMap);
      new Setting(e).setName(g.label).setDesc(g.hint).setClass('nx-set-sub')
        .addDropdown(dd => {
          penGestures.PEN_ACTIONS.filter(a => penGestures.actionFits(a, g.id)).forEach(a => dd.addOption(a.id, a.label));
          dd.setValue(active[g.id] || 'none').onChange(async v => {
            s.penMap = Object.assign({}, s.penMap, { [g.id]: v });
            await this.save();
          });
        });
    });

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

    [['compact', 'Buttons in a note', BAR_DEFAULTS.compact], ['full', 'Buttons in the Sketch tab', BAR_DEFAULTS.full]].forEach(([ctx, label, def]) => {
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
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Drawing' });
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
    new Setting(e).setName('Default ink color').setDesc('What the pen starts with in a vault that has never drawn. After that every tool remembers the colour it was last used with.')
      .addColorPicker(cp => cp.setValue(s.ink || '#2f2f2f').onChange(async v => { s.ink = v; await this.save(); }));
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
        .addOption('lines', 'Lines')
        .addOption('dots', 'Dots')
        .addOption('cross', 'Cross')
        .addOption('isometric', 'Isometric')
        .addOption('isodots', 'Iso dots')
        .setValue(s.bgType === 'graph' ? 'grid' : (s.bgType || 'none'))
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
}

module.exports = SketchPage;
