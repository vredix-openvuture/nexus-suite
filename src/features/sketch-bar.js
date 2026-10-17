'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the sketch toolbar
 *  The table-driven toolbar of a sketch pad, shared by the code block and the
 *  Sketch tab. One builder closure; mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { Notice, setIcon } = require('obsidian');
const { BAR_ITEMS, SELECT_SHAPES, RULER_ANGLES } = require('../constants.js');
const { PEN_TYPES } = require('../views/sketch.js');
const sketchObjects = require('../lib/sketchobjects.js');
const sketchErase = require('../lib/sketcherase.js');
const penGestures = require('../lib/sketchgestures.js');
const sketchExport = require('../lib/sketchexport.js');

class SketchBar {

  /* Build the sketch toolbar: a TOOL row, and under it the OPTIONS row of
     whatever tool is active — pen types + sizes + colours for the pen, sizes +
     colours for the highlighter, stroke vs. area (and the disc size) for the
     eraser.

     `bar.mode` only decides whether the options row is pinned open or opens on
     a tool tap and closes again on the first stroke. Both render the SAME row,
     so this is one code path and not two toolbars.

     Which buttons sit in the bar and which fall into the ⋯ menu comes from
     BAR_ITEMS filtered by the user's list (barConfig) — separately for the code
     block ('compact') and the Sketch tab ('full'). The buttons that leave the
     sketch (save & close, open in a Sketch tab) are not in that list: they are
     always in the bar, because a user cannot be allowed to hide their way out. */
  _buildSketchBar(bar, surface, s, opts) {
    opts = opts || {};
    const full = opts.mode === 'full';
    const plugin = this;
    const layout = this.barConfig(s);
    // Own copy: the settings merge is one level deep, so a missing `eraser`
    // would otherwise be DEFAULT_SETTINGS' object, and picking a size would edit it.
    s.eraser = Object.assign({ type: 'stroke', size: 'm' }, s.eraser);
    surface.setEraser(s.eraser.type, s.eraser.size);
    const inBar = full ? layout.full : layout.compact;

    /* The options row is a SIBLING of the bar, so every caller's own layout —
       including the code block's collapse wrapper — keeps working untouched.
       Rebuilds call bar.empty(), which cannot reach a sibling, so a stale row
       from the previous build has to go first or they stack up. */
    const stale = bar.nextElementSibling;
    if (stale && stale.hasClass && stale.hasClass('nx-sketch-subbar')) stale.remove();
    const sub = createDiv('nx-sketch-subbar');
    bar.insertAdjacentElement('afterend', sub);

    const iconBtn = (parent, icon, title, cb, cls) => {
      const b = parent.createDiv({ cls: 'nx-sk-btn' + (cls ? ' ' + cls : ''), attr: { 'aria-label': title } });
      setIcon(b, icon);
      if (cb) b.onclick = cb;
      return b;
    };
    const BG_ICON = { none: 'square', grid: 'layout-grid', graph: 'layout-grid', lines: 'align-justify', dots: 'grip', cross: 'plus', isometric: 'triangle', isodots: 'grip' };

    // ── shared state referenced across groups ──
    let favWrap, colWrap;
    let subOpen = false;                 // reveal mode only — pinned ignores it
    let lastTool = null;                 // what a gesture switches back TO
    let gestureHeldTool = null;          // the tool a hold-gesture interrupted
    const toolBtns = {};
    const PEN_META = { fountain: ['Fountain', 'pen-tool'], ballpoint: ['Ballpoint', 'pen'], pencil: ['Pencil', 'pencil'], brush: ['Brush', 'brush'], calligraphy: ['Calligraphy', 'feather'], marker: ['Marker', 'highlighter'] };
    const DRAW_PENS = ['fountain', 'ballpoint', 'pencil', 'brush', 'calligraphy'];
    let drawPen = DRAW_PENS.includes(surface.pen) ? surface.pen : 'fountain';   // the drawing pen behind the "pen" tool

    /* Which BAR_ITEM the surface is currently in. Everything per-tool (colour,
       palette, the options row) keys off this one function, so there is a
       single answer to "which tool is this" instead of three. */
    /* `sheet` is not a mode of the surface — nothing about the pen changes when
       it is open — so it is remembered here and answered first. */
    let sheetOpen = false;
    const TOOL_OF = () => (sheetOpen ? 'sheet'
      : surface.mode === 'erase' ? 'eraser'
      : surface.mode === 'select' ? 'select'
      : surface.mode === 'space' ? 'space'
      : surface.mode === 'insert' ? 'insert'
      : surface.pen === 'marker' ? 'marker' : 'pen');
    const TOOL_LABEL = { pen: 'Pen', marker: 'Highlighter', eraser: 'Eraser', select: 'Select', space: 'Spacing', insert: 'Insert', sheet: 'This drawing' };
    // Neither of these puts ink on the page, so neither owns a colour.
    const DRAWS = (tool) => ['eraser', 'select', 'space', 'insert', 'sheet'].indexOf(tool) < 0;

    const persistSize = () => { s.penSizes[surface.pen] = surface.getSize(); plugin.saveSettings(); };
    /* Picking a colour or a width does not change the TOOL, so only the tool
       buttons need re-syncing — rebuilding the options row on every swatch tap
       would tear it out from under the finger that is tapping it. Leaving the
       eraser this way does change the tool, so that case still rebuilds. */
    const drawWithCurrent = () => {
      const before = TOOL_OF();
      surface.setMode('draw');
      if (TOOL_OF() === before) syncTools(); else syncAll();
    };

    /* ═══ palettes + colours, per tool ═══ */
    const ensurePalettes = () => {
      if (!Array.isArray(s.palettes) || !s.palettes.length) s.palettes = [{ name: 'Default', colors: (s.palette || ['#2f2f2f']).slice(0, 8) }];
      if (s.activePalette == null || s.activePalette >= s.palettes.length) s.activePalette = 0;
      s.palette = s.palettes[s.activePalette].colors;   // legacy alias — the GLOBAL active one, not the tool's
      return s.palettes;
    };
    /* A palette belongs to a tool: the highlighter wants washes where the pen
       wants ink. A tool that was never given one uses the globally active
       palette, so nothing changes for anyone who never picks. */
    const palIdx = (tool) => {
      ensurePalettes();
      const chosen = (s.toolPalettes || (s.toolPalettes = {}))[tool];
      return (chosen != null && chosen >= 0 && chosen < s.palettes.length) ? chosen : s.activePalette;
    };
    const activePal = () => s.palettes[palIdx(TOOL_OF())];
    const rememberColor = (col) => { (s.toolColors || (s.toolColors = {}))[TOOL_OF()] = col; plugin.saveSettings(); };
    /* Each tool keeps the ink it was last used with. A tool that has never been
       used starts at the head of its own palette — except the pen on a fresh
       vault, which starts at the "default ink" setting. */
    const applyToolColor = () => {
      const tool = TOOL_OF();
      const colors = (s.toolColors || (s.toolColors = {}));
      if (colors[tool] == null) colors[tool] = (tool === 'pen' && s.ink) ? s.ink : activePal().colors[0];
      surface.setColor(colors[tool]);
    };

    /* ═══ per-pen behaviour sheet (smoothing, pressure, …) ═══ */
    // The value lives IN the label's flex row — never floated — so it can't
    // overlap the rows below (that was the marker-menu overlap).
    const buildPenSettings = (box, id) => {
      box.empty();
      const cfg = s.penConfig[id] || (s.penConfig[id] = {});
      const eff = () => Object.assign({}, PEN_TYPES[id], cfg);
      const slider = (lbl, key, min, max, step) => {
        const w = box.createDiv('nx-sk-slider');
        const head = w.createDiv('nx-sk-slider-lbl');
        head.createSpan({ text: lbl });
        const out = head.createSpan({ cls: 'nx-sk-slider-val', text: String(eff()[key]) });
        const r = w.createEl('input', { type: 'range' });
        r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(eff()[key] != null ? eff()[key] : min);
        r.oninput = () => { const v = Number(r.value); out.setText(String(v)); cfg[key] = v; };
        r.onchange = () => plugin.saveSettings();
      };
      slider('Smoothing', 'streamline', 0, 0.9, 0.05);
      slider('Pressure', 'thinning', 0, 1, 0.05);
      slider('Sharpness', 'taper', 0, 40, 1);
      slider('Speed fade', 'speedThin', 0, 0.8, 0.05);
      if (id === 'marker') {
        const tipRow = box.createDiv('nx-sk-bgtypes');
        [['round', 'Rounded'], ['flat', 'Straight']].forEach(([cap, lbl]) => {
          const b = tipRow.createDiv({ cls: 'nx-sk-bgtype', text: lbl });
          b.toggleClass('is-active', (eff().cap || 'flat') === cap);
          b.onclick = () => { cfg.cap = cap; plugin.saveSettings(); tipRow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active'); };
        });
        const ovRow = box.createDiv('nx-sk-cfgrow');
        ovRow.createSpan({ text: 'Self-overlap adds up' });
        const cb = ovRow.createEl('input', { type: 'checkbox' });
        cb.checked = !eff().noStack;
        cb.onchange = () => { cfg.noStack = !cb.checked; plugin.saveSettings(); };
      }
      const reset = box.createEl('button', { cls: 'nx-sk-savecol', text: 'Reset to defaults' });
      reset.onclick = () => { delete s.penConfig[id]; plugin.saveSettings(); buildPenSettings(box, id); };
    };
    const openPenSettings = (anchor, id) => {
      plugin._showPopover(anchor, (pop) => {
        pop.addClass('nx-sk-penpop');
        pop.createDiv({ cls: 'nx-sk-pop-title', text: PEN_META[id][0] });
        buildPenSettings(pop.createDiv('nx-sk-pensettings'), id);
      });
    };

    /* ═══ size favourites (dots sized to their width) ═══ */
    const dotPx = (px) => Math.max(2, Math.min(20, px));
    const SIZE_MIN = 0.5, SIZE_SPAN = 39.5;
    const sliderToPx = (t) => Math.round((SIZE_MIN + SIZE_SPAN * t * t) * 10) / 10;
    const pxToSlider = (v) => Math.round(Math.sqrt(Math.max(0, (v - SIZE_MIN) / SIZE_SPAN)) * 1000);
    /* Favourites belong to the ACTIVE PEN — a marker and a pencil have nothing
       useful to say about each other's widths. */
    const favsOf = () => {
      const all = s.sizeFavorites && !Array.isArray(s.sizeFavorites) ? s.sizeFavorites : (s.sizeFavorites = {});
      const pen = surface.pen || 'fountain';
      if (!Array.isArray(all[pen]) || !all[pen].length) all[pen] = (pen === 'marker' ? [6, 10, 18] : [1.5, 3, 8]).slice();
      return all[pen];
    };
    const openSizeSlider = (anchor, dot, i) => {
      plugin._showPopover(anchor, (pop) => {
        const favs = favsOf();
        pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Size · ' + (PEN_META[surface.pen] ? PEN_META[surface.pen][0] : 'Pen') });
        const applyVal = (v) => {
          v = Math.max(0.1, Math.round(v * 10) / 10);
          favs[i] = v; out.setText(v + 'px');
          dot.style.setProperty('--d', dotPx(v) + 'px');
          surface.setSize(v); drawWithCurrent();
          favWrap.querySelectorAll('.nx-sk-fav').forEach(x => x.removeClass('is-active')); anchor.addClass('is-active');
        };
        const row = pop.createDiv('nx-sk-sizerow');
        const minus = row.createDiv({ cls: 'nx-sk-stepbtn', text: '−' });
        const r = row.createEl('input', { type: 'range' }); r.min = '0'; r.max = '1000'; r.step = '1'; r.value = String(pxToSlider(favs[i]));
        const plus = row.createDiv({ cls: 'nx-sk-stepbtn', text: '+' });
        const out = pop.createDiv({ cls: 'nx-sk-slider-val nx-sk-slider-val-block', text: favs[i] + 'px' });
        r.oninput = () => applyVal(sliderToPx(Number(r.value) / 1000));
        r.onchange = () => { plugin.saveSettings(); persistSize(); };
        minus.onclick = () => { applyVal(favs[i] - 0.1); r.value = String(pxToSlider(favs[i])); plugin.saveSettings(); persistSize(); };
        plus.onclick = () => { applyVal(favs[i] + 0.1); r.value = String(pxToSlider(favs[i])); plugin.saveSettings(); persistSize(); };
      });
    };
    const renderFavs = () => {
      if (!favWrap) return;
      favWrap.empty();
      const cur = surface.getSize();
      const favs = favsOf();
      favs.forEach((val, i) => {
        const b = favWrap.createDiv({ cls: 'nx-sk-fav', attr: { 'aria-label': val + 'px — tap to use, tap again to adjust' } });
        const dot = b.createDiv('nx-sk-fav-dot');
        dot.style.setProperty('--d', dotPx(val) + 'px');
        if (Math.abs(val - cur) < 0.01) b.addClass('is-active');
        b.onclick = () => {
          if (b.hasClass('is-active')) { openSizeSlider(b, dot, i); return; }
          surface.setSize(favs[i]); persistSize(); drawWithCurrent();
          favWrap.querySelectorAll('.nx-sk-fav').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
        };
      });
    };
    const buildSizes = (parent) => { favWrap = parent.createDiv('nx-sk-favs'); renderFavs(); };

    /* ═══ palette switcher — picks the palette for the CURRENT tool ═══ */
    const paletteBuild = (pop, closePop) => {
      pop.addClass('nx-sk-palpop');
      const tool = TOOL_OF();
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Palette · ' + (TOOL_LABEL[tool] || 'Pen') });
      ensurePalettes();
      const chosen = palIdx(tool);
      s.palettes.forEach((pal, idx) => {
        const row = pop.createDiv('nx-sk-palrow');
        row.toggleClass('is-active', idx === chosen);
        if (idx === chosen) {
          const nameInp = row.createEl('input', { type: 'text', cls: 'nx-sk-palname' });
          nameInp.value = pal.name || 'Palette';
          nameInp.onchange = () => { pal.name = nameInp.value.trim() || 'Palette'; plugin.saveSettings(); };
          nameInp.onclick = (e) => e.stopPropagation();
        } else {
          row.createSpan({ cls: 'nx-sk-palname-ro', text: pal.name || 'Palette' });
        }
        const sws = row.createDiv('nx-sk-palrow-sw');
        pal.colors.slice(0, 8).forEach(c => { const dot = sws.createDiv('nx-sk-paldot'); dot.style.setProperty('--c', c); });
        if (s.palettes.length > 1) {
          const del = row.createDiv({ cls: 'nx-sk-paldel', attr: { 'aria-label': 'Delete palette' } });
          setIcon(del, 'x');
          del.onclick = (e) => {
            e.stopPropagation();
            s.palettes.splice(idx, 1);
            if (s.activePalette >= s.palettes.length) s.activePalette = s.palettes.length - 1;
            /* Tools pointing past the deleted entry would silently jump to a
               different palette — shift them down, and let the ones that used
               it fall back to the global default. */
            const map = s.toolPalettes || (s.toolPalettes = {});
            Object.keys(map).forEach(t => {
              if (map[t] === idx) delete map[t];
              else if (map[t] > idx) map[t] -= 1;
            });
            plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
          };
        }
        row.onclick = () => {
          if (idx === chosen) return;
          (s.toolPalettes || (s.toolPalettes = {}))[tool] = idx;
          /* The ink this tool was using may not exist in the new palette —
             land on its first swatch instead of on a colour nothing shows. */
          const colors = s.palettes[idx].colors;
          const cur = (s.toolColors || {})[tool];
          if (!cur || !colors.some(c => String(c).toLowerCase() === String(cur).toLowerCase())) {
            (s.toolColors || (s.toolColors = {}))[tool] = colors[0];
            surface.setColor(colors[0]);
          }
          plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
        };
      });
      const newBtn = pop.createEl('button', { cls: 'nx-sk-savecol', text: '＋ New palette (copy of current)' });
      newBtn.onclick = () => {
        const pal = activePal();
        s.palettes.push({ name: 'Palette ' + (s.palettes.length + 1), colors: pal.colors.slice(0, 8) });
        (s.toolPalettes || (s.toolPalettes = {}))[tool] = s.palettes.length - 1;
        plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
      };
    };

    /* ═══ colour strip ═══ */
    const renderSwatches = () => {
      if (!colWrap) return;
      colWrap.empty();
      const pal = activePal();
      pal.colors.forEach((col, idx) => {
        const sw = colWrap.createDiv('nx-sk-color');
        sw.style.setProperty('--c', col);
        sw.setAttribute('aria-label', col + ' (tap to use · tap again to edit · right-click to remove)');
        if (String(col).toLowerCase() === String(surface.color).toLowerCase()) sw.addClass('is-active');
        sw.onclick = () => {
          // Tap the ALREADY-selected swatch again → adjust that palette colour
          // (hue/saturation/opacity), live.
          if (sw.hasClass('is-active')) {
            plugin._showPopover(sw, (pop) => {
              pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Adjust colour' });
              plugin._buildColorPicker(pop, pal.colors[idx],
                (out) => { pal.colors[idx] = out; sw.style.setProperty('--c', out); surface.setColor(out); rememberColor(out); drawWithCurrent(); },
                () => plugin.saveSettings());
            });
            return;
          }
          // In select mode the swatch also repaints what is selected — that is
          // what a colour means when ink is already on the page.
          if (TOOL_OF() === 'select') {
            surface.setColor(col);
            surface.setSelectionColor(col);
          } else {
            surface.setColor(col); rememberColor(col); drawWithCurrent();
          }
          colWrap.querySelectorAll('.nx-sk-color').forEach(x => x.removeClass('is-active')); sw.addClass('is-active');
        };
        sw.oncontextmenu = (e) => { e.preventDefault(); if (pal.colors.length > 1) { pal.colors = pal.colors.filter(c => c !== col); plugin.saveSettings(); renderSwatches(); } };
      });
      // The "+" is an ADD affordance — with a full palette there is nothing to
      // add, so it goes away instead of promising a slot and then refusing.
      if (pal.colors.length < 8) {
        const cust = colWrap.createDiv('nx-sk-color nx-sk-color-custom');
        setIcon(cust, 'plus');
        cust.setAttribute('aria-label', 'Custom colour');
        plugin._sketchPopover(cust, (pop, closePop) => {
          pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Custom colour' });
          let v = /^(#|rgb)/i.test(surface.color || '') ? surface.color : '#2f2f2f';
          plugin._buildColorPicker(pop, v, (out) => { v = out; surface.setColor(out); rememberColor(out); drawWithCurrent(); });
          const save = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol', text: 'Save to palette' });
          save.onclick = () => {
            const p = activePal();
            if (p.colors.length >= 8) { new Notice('Nexus: palette is full (max 8 colours).'); return; }
            if (!p.colors.map(c => c.toLowerCase()).includes(v.toLowerCase())) { p.colors.push(v); plugin.saveSettings(); }
            renderSwatches(); closePop();
          };
        });
      }
      // The swatch book sits at the end of the strip, where the colours are —
      // picking a palette IS a colour decision, not a menu item.
      const switcher = colWrap.createDiv('nx-sk-color nx-sk-color-custom');
      setIcon(switcher, 'palette');
      switcher.setAttribute('aria-label', 'Palette for this tool');
      plugin._sketchPopover(switcher, paletteBuild);
    };
    const buildColors = (parent) => { colWrap = parent.createDiv('nx-sk-grp nx-sk-colors'); renderSwatches(); };

    /* ═══ background popover (reused inline + in ⋯) ═══ */
    const bgBuild = (pop, bgBtn) => {
      /* What shape the paper is comes FIRST: it decides whether the rest of this
         popover is describing a sheet or a plane. */
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Paper type' });
      const ptRow = pop.createDiv('nx-sk-bgtypes nx-sk-papertypes');
      const landRow = pop.createDiv('nx-sk-bgtypes nx-sk-sheetorient');
      const syncOrient = () => landRow.toggleClass('is-hidden', surface.paperType !== 'sectioned');
      [['endless', 'Endless'], ['sectioned', 'Sectioned'], ['mindmap', 'Mindmap']].forEach(([id, label]) => {
        const b = ptRow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', surface.paperType === id);
        b.onclick = () => {
          surface.setPaperType(id); surface.persist();
          ptRow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
          syncOrient();
        };
      });
      // Only sectioned paper has an orientation — a plane has no page to turn.
      [['Portrait', false], ['Landscape', true]].forEach(([label, land]) => {
        const b = landRow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', !!surface.sheetLandscape === land);
        b.onclick = () => {
          surface.setPaperType('sectioned', land); surface.persist();
          landRow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
        };
      });
      syncOrient();
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Paper' });
      const prow = pop.createDiv('nx-sk-bgtypes');
      [['native', 'Native'], ['paper', 'Paper'], ['white', 'White'], ['black', 'Black']].forEach(([id, label]) => {
        const b = prow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', surface.paper === id);
        b.onclick = () => {
          surface.setPaper(id); surface.persist();
          prow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
        };
      });
      // Paper texture — a toggle that lays the paper grain over ANY paper colour.
      const styleBtn = pop.createDiv({ cls: 'nx-sk-bgtype nx-sk-bgtoggle', text: 'Paper style (texture)' });
      styleBtn.toggleClass('is-active', surface.paperStyle);
      styleBtn.onclick = () => {
        const on = !surface.paperStyle;
        surface.setPaperStyle(on); surface.persist();
        styleBtn.toggleClass('is-active', on);
      };
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Pattern' });
      const trow = pop.createDiv('nx-sk-bgtypes');
      [['none', 'None'], ['grid', 'Grid'], ['lines', 'Lines'], ['dots', 'Dots'], ['cross', 'Cross'], ['isometric', 'Isometric'], ['isodots', 'Iso dots']].forEach(([id, label]) => {
        const b = trow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', surface.bgType === id || (id === 'grid' && surface.bgType === 'graph'));
        b.onclick = () => {
          surface.setBackground(id); surface.persist();
          if (bgBtn) { setIcon(bgBtn, BG_ICON[id] || 'layout-grid'); bgBtn.toggleClass('is-active', id !== 'none'); }
          trow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
        };
      });
      const slider = (label, min, max, step, val, unit, onInput) => {
        const w = pop.createDiv('nx-sk-slider');
        const head = w.createDiv('nx-sk-slider-lbl');
        head.createSpan({ text: label });
        const out = head.createSpan({ cls: 'nx-sk-slider-val', text: val + unit });
        const r = w.createEl('input', { type: 'range' }); r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(val);
        r.oninput = () => { const v = Number(r.value); out.setText(v + unit); onInput(v); };
        r.onchange = () => surface.persist();
      };
      slider('Spacing', 16, 120, 2, surface.bgSize, '', v => surface.setBackground(null, v, null));
      slider('Opacity', 2, 60, 1, Math.round(surface.bgOpacity * 100), '%', v => surface.setBackground(null, null, v / 100));
    };

    /* ═══ export ═══ */
    const exportBuild = (pop, closePop) => {
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Export' });
      let scale = 2;
      const scaleRow = pop.createDiv('nx-sk-bgtypes');
      [['1', 1], ['2×', 2], ['3×', 3], ['4×', 4]].forEach(([label, value]) => {
        const b = scaleRow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', value === scale);
        b.onclick = () => {
          scale = value;
          scaleRow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active'));
          b.addClass('is-active');
        };
      });
      pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'Scale applies to PNG and PDF. SVG is vector and ignores it.' });
      sketchExport.EXPORT_FORMATS.forEach(spec => {
        const row = pop.createDiv('nx-sk-menuitem');
        const ic = row.createDiv('nx-sk-menuitem-ic');
        setIcon(ic, spec.id === 'svg' ? 'file-code' : spec.id === 'png' ? 'image' : 'file-text');
        row.createDiv({ cls: 'nx-sk-menuitem-lbl', text: spec.label + ' — ' + spec.note });
        row.onclick = async () => {
          closePop();
          try {
            surface.flush();   // export what is on the page, not what last reached disk
            const path = await plugin._exportSketch(surface, spec.id, scale);
            new Notice('Nexus: exported to ' + path);
          } catch (err) {
            new Notice('Nexus: export failed — ' + (err && err.message ? err.message : 'unknown error'));
          }
        };
      });
    };

    /* ═══ outline ═══ */
    /* A drawing has no headings to read, so the outline is made by hand: a mark
       at a y with a name on it. That is enough to jump around a page metres
       long, which is the whole problem an endless sheet creates. */
    const outlineBuild = (pop, closePop) => {
      pop.addClass('nx-sk-menu');
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Outline' });
      if (!surface.sections.length) {
        pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'No sections yet. Add one where you are and it becomes a place you can jump back to.' });
      }
      surface.sections.forEach((sec, i) => {
        const row = pop.createDiv('nx-sk-menuitem');
        const ic = row.createDiv('nx-sk-menuitem-ic');
        setIcon(ic, 'corner-down-right');
        row.createDiv({ cls: 'nx-sk-menuitem-lbl', text: sec.title || 'Section' });
        const del = row.createDiv({ cls: 'nx-sk-menuitem-x', attr: { 'aria-label': 'Remove section' } });
        setIcon(del, 'x');
        del.onclick = (ev) => { ev.stopPropagation(); surface.removeSection(i); closePop(); };
        row.onclick = () => {
          if (!surface.scrollToY(sec.y)) new Notice('Nexus: nothing to scroll here — open the sketch full size.');
          closePop();
        };
      });
      pop.createDiv('nx-sk-menu-sep');
      const add = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol', text: '＋ Section here' });
      add.onclick = async () => {
        const { NexusNameModal } = require('../modals/misc.js');
        const at = surface.viewCenter();
        closePop();
        const title = await new NexusNameModal(plugin.app, 'Name this section', '').openAndGet();
        if (title == null) return;
        surface.addSection(at.y, title.trim() || 'Section');
      };
    };

    /* ═══ ruler ═══ */
    const rulerBuild = (pop, anchor) => {
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Ruler' });
      const onRow = pop.createDiv('nx-sk-bgtypes');
      const toggle = onRow.createDiv({ cls: 'nx-sk-bgtype nx-sk-bgtoggle', text: 'Straight edge' });
      const paint = () => {
        toggle.toggleClass('is-active', surface.ruler.on);
        if (anchor) anchor.toggleClass('is-active', surface.ruler.on);
      };
      toggle.onclick = () => { surface.setRuler(!surface.ruler.on, surface.ruler.angle); paint(); };
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Angle' });
      const angles = pop.createDiv('nx-sk-bgtypes');
      RULER_ANGLES.forEach(a => {
        const b = angles.createDiv({ cls: 'nx-sk-bgtype', text: a.label });
        const current = surface.ruler.angle == null ? '' : String(surface.ruler.angle);
        b.toggleClass('is-active', current === a.id);
        b.onclick = () => {
          // Picking an angle arms the ruler: nobody chooses 45° to leave it off.
          surface.setRuler(true, a.id === '' ? null : a.id);
          angles.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active'));
          b.addClass('is-active');
          paint();
        };
      });
      pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'Free follows the direction each stroke starts in.' });
      paint();
    };

    /* ═══ auto-grow · clear ═══ */
    const clearBuild = (pop, close) => {
      pop.addClass('nx-sk-confirm');
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Clear sketch?' });
      pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'Removes every stroke (undo still works).' });
      const row = pop.createDiv('nx-sk-confirm-row');
      row.createEl('button', { text: 'Cancel' }).onclick = () => close();
      row.createEl('button', { cls: 'mod-warning', text: 'Clear' }).onclick = () => { surface.clear(); close(); };
    };

    /* Zoom, for everyone who is not pinching: a tablet with a pen in hand, a
       mouse, or anyone who never learnt the gesture. Reads the level back so
       the popover is also the read-out, and "page width" is always one tap. */
    const zoomBuild = (pop) => {
      pop.addClass('nx-sk-zoompop');
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Zoom' });
      const row = pop.createDiv('nx-sk-zoomrow');
      const val = () => Math.round(surface.getPageZoom() * 100) + '%';
      const minus = iconBtn(row, 'minus', 'Zoom out', null);
      const read = row.createDiv({ cls: 'nx-sk-zoomval', text: val() });
      const plus = iconBtn(row, 'plus', 'Zoom in', null);
      const step = (f) => { surface.setPageZoom(surface.getPageZoom() * f); read.setText(val()); };
      minus.onclick = () => step(1 / 1.25);
      plus.onclick = () => step(1.25);
      // On mindmap paper there is no page to be the width of — 100 % there means
      // one canvas width across the pane, which is the same thing said differently.
      const reset = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol',
        text: surface.infinite ? 'Back to 100%' : 'Page width (100%)' });
      reset.onclick = () => { surface.setPageZoom(1); read.setText(val()); };
      pop.createDiv({ cls: 'nx-sk-subnote', text: 'Also: pinch, ctrl + wheel, or a three-finger tap on the canvas. Two fingers tapped three times goes back to where the drawing was opened.' });
    };

    /* Every movable action, by id. The bar and the ⋯ menu both read this, so a
       button does the same thing wherever the user put it. */
    const ACTIONS = {
      undo:  { icon: 'undo-2', label: 'Undo', run: () => surface.undo() },
      redo:  { icon: 'redo-2', label: 'Redo', run: () => surface.redo() },
      /* It opens a chooser, so it is drawn as a plain button — an is-active
         ring said "on", which is not a thing a paper picker can be. */
      background: {
        icon: () => BG_ICON[surface.bgType] || 'layout-grid', label: 'Paper & background',
        popup: (anchor) => (pop) => bgBuild(pop, anchor),
      },
      /* Pinching is the fast way and ctrl+wheel is the desktop's, but neither is
         visible — and a surface that cannot page-zoom must not advertise it. */
      zoom: { icon: 'zoom-in', label: 'Zoom', skip: () => !surface.pageZoom,
              active: () => Math.abs(surface.getPageZoom() - 1) > 0.01,
              popup: () => zoomBuild },
      /* A straight edge is a constraint on the pen, not a mode of its own: it
         stays on while you keep drawing with whatever pen you had. */
      ruler: {
        icon: 'ruler', label: 'Ruler',
        active: () => surface.ruler.on,
        popup: (anchor) => (pop) => rulerBuild(pop, anchor),
      },
    };

    /* ═══ the options row ═══ */
    /* Pinned: the row is simply there. Reveal: a tool tap opens it and the
       first stroke closes it, so the canvas is whole while actually drawing. */
    const applyOpen = () => {
      sub.toggleClass('is-open', layout.mode === 'pinned' || subOpen);
    };
    const renderSub = () => {
      sub.empty();
      surface.onSelect = null;   // a rebuilt row must not be driven by the old one
      const tool = TOOL_OF();
      if (tool === 'eraser') { buildEraserRow(sub); applyOpen(); return; }
      if (tool === 'sheet') { buildSheetRow(sub); applyOpen(); return; }
      if (tool === 'select') { buildSelectRow(sub); applyOpen(); return; }
      if (tool === 'space') { buildSpaceRow(sub); applyOpen(); return; }
      if (tool === 'insert') { buildInsertRow(sub); applyOpen(); return; }
      if (tool === 'pen') {
        const row = sub.createDiv('nx-sk-grp nx-sk-subpens');
        DRAW_PENS.forEach(id => {
          const chip = row.createDiv({ cls: 'nx-sk-subpen', attr: { 'aria-label': PEN_META[id][0] + ' (tap again: settings)' } });
          setIcon(chip, PEN_META[id][1]);
          chip.toggleClass('is-active', surface.pen === id);
          chip.onclick = () => {
            if (surface.pen === id) { openPenSettings(chip, id); return; }
            drawPen = id;
            surface.setPen(id); surface.setMode('draw');
            applyToolColor();
            syncAll();
          };
        });
        sub.createDiv('nx-sk-sep');
      } else {
        const cfgBtn = iconBtn(sub, 'sliders-horizontal', 'Highlighter settings', null);
        cfgBtn.onclick = () => openPenSettings(cfgBtn, 'marker');
        sub.createDiv('nx-sk-sep');
      }
      buildSizes(sub);
      sub.createDiv('nx-sk-sep');
      buildColors(sub);
      applyOpen();
    };

    /* Eraser: whole strokes or only what is under the disc, and for the disc
       its size. Remembered in the settings like a pen's width. */
    const buildEraserRow = (parent) => {
      const kinds = parent.createDiv('nx-sk-grp nx-sk-subpens');
      sketchErase.ERASER_TYPES.forEach(kind => {
        const chip = kinds.createDiv({ cls: 'nx-sk-subpen', attr: { 'aria-label': kind.label } });
        setIcon(chip, kind.icon);
        chip.toggleClass('is-active', surface.eraserType === kind.id);
        chip.onclick = () => { s.eraser.type = kind.id; surface.setEraser(kind.id); plugin.saveSettings(); renderSub(); };
      });
      if (surface.eraserType !== 'area') return;
      parent.createDiv('nx-sk-sep');
      const sizes = parent.createDiv('nx-sk-grp nx-sk-subpens');
      sketchErase.ERASER_SIZES.forEach(size => {
        const chip = sizes.createDiv({ cls: 'nx-sk-subpen nx-sk-erasesize', attr: { 'aria-label': size.label } });
        // The dot is drawn at the disc's relative size, so the row shows what it does.
        const dot = chip.createDiv('nx-sk-erasedot');
        dot.style.width = dot.style.height = Math.round(6 + size.px / 2) + 'px';
        chip.toggleClass('is-active', surface.eraserSize === size.id);
        chip.onclick = () => { s.eraser.size = size.id; surface.setEraser(null, size.id); plugin.saveSettings(); renderSub(); };
      });
    };

    /* Everything you do TO the drawing rather than on it. Four things that are
       each reached once in a while: in the bar they were four buttons competing
       with the pen; here they are one. */
    const buildSheetRow = (parent) => {
      /* Wide, labelled buttons — not the square icon chips the rest of the bar
         uses. These are read before they are pressed, and a label inside a
         fixed-width icon button lands on top of the icon. */
      const one = (icon, label, cls) => {
        const b = iconBtn(parent, icon, label, null, 'nx-sk-sheetbtn' + (cls ? ' ' + cls : ''));
        b.createSpan({ cls: 'nx-sk-sublabel', text: label });
        return b;
      };
      plugin._sketchPopover(one('list-tree', 'Outline'), (pop, close) => outlineBuild(pop, close));
      plugin._sketchPopover(one('download', 'Export'), (pop, close) => exportBuild(pop, close));
      if (opts.notePath) {
        one('columns-2', 'Note beside').onclick = () => plugin.openNoteBeside(opts.notePath);
      }
      plugin._sketchPopover(one('trash-2', 'Clear', 'is-danger'), (pop, close) => clearBuild(pop, close));
    };

    /* Select: the marquee shape, what can be done to what is caught in it, and
       the colours (which recolour the selection instead of only arming the pen). */
    const buildSelectRow = (parent) => {
      const shapes = parent.createDiv('nx-sk-grp nx-sk-subpens');
      SELECT_SHAPES.forEach(sh => {
        const chip = shapes.createDiv({ cls: 'nx-sk-subpen', attr: { 'aria-label': sh.label } });
        setIcon(chip, sh.icon);
        chip.toggleClass('is-active', surface.selectShape === sh.id);
        chip.onclick = () => {
          surface.setSelectShape(sh.id);
          shapes.querySelectorAll('.nx-sk-subpen').forEach(x => x.removeClass('is-active'));
          chip.addClass('is-active');
        };
      });
      parent.createDiv('nx-sk-sep');
      const dup = iconBtn(parent, 'copy', 'Duplicate', () => surface.duplicateSelection());
      const del = iconBtn(parent, 'trash-2', 'Delete selection', () => surface.deleteSelection());
      parent.createDiv('nx-sk-sep');
      buildColors(parent);
      const note = parent.createSpan({ cls: 'nx-sk-subnote' });
      /* The two buttons only mean something with something selected, and the
         count is the only feedback that the lasso caught what was intended. */
      const syncCount = () => {
        const n = surface.selection.length;
        dup.toggleClass('is-disabled', !n);
        del.toggleClass('is-disabled', !n);
        note.setText(n ? n + ' selected' : 'Draw around something');
      };
      surface.onSelect = syncCount;
      syncCount();
    };

    /* Insert: everything that is put ON the page rather than drawn on it.
       One tool instead of three, because an image, a sticker and a note are the
       same decision — "put a thing here" — and three bar buttons for it would
       crowd out the ones you reach for constantly. */
    const buildInsertRow = (parent) => {
      const imgBtn = iconBtn(parent, 'image-plus', 'Insert an image', null);
      imgBtn.onclick = async () => {
        const file = await plugin._pickImageFile();
        if (!file) return;
        try {
          const img = await plugin._sketchImageData(file);
          const at = surface.viewCenter();
          const box = sketchObjects.placeObject(at.x, at.y, img.w, img.h, surface.W * 0.7);
          surface.addObject(Object.assign({ kind: 'image', href: img.href }, box));
          setTool('select');
        } catch (err) {
          new Notice('Nexus: ' + (err && err.message ? err.message : 'could not insert that image.'));
        }
      };
      const noteBtn = iconBtn(parent, 'sticky-note', 'Sticky note', null);
      plugin._sketchPopover(noteBtn, (pop, closePop) => {
        pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Sticky note' });
        const area = pop.createEl('textarea', { cls: 'nx-sk-notetext' });
        area.rows = 4;
        area.placeholder = 'What goes on the note';
        let colorId = sketchObjects.NOTE_COLORS[0].id;
        const row = pop.createDiv('nx-sk-notecolors');
        sketchObjects.NOTE_COLORS.forEach(c => {
          const chip = row.createDiv({ cls: 'nx-sk-notecolor', attr: { 'aria-label': c.label } });
          chip.style.setProperty('--c', c.fill);
          chip.toggleClass('is-active', c.id === colorId);
          chip.onclick = () => {
            colorId = c.id;
            row.querySelectorAll('.nx-sk-notecolor').forEach(x => x.removeClass('is-active'));
            chip.addClass('is-active');
          };
        });
        const add = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol', text: 'Place note' });
        add.onclick = () => {
          const at = surface.viewCenter();
          surface.addObject({ kind: 'note', x: Math.round(at.x - 130), y: Math.round(at.y - 90), w: 260, h: 180, color: colorId, text: area.value });
          closePop();
          setTool('select');
        };
        window.setTimeout(() => area.focus(), 0);
      });
      parent.createDiv('nx-sk-sep');
      const stickers = parent.createDiv('nx-sk-grp nx-sk-subpens');
      sketchObjects.STICKERS.forEach(item => {
        const chip = stickers.createDiv({ cls: 'nx-sk-subpen', attr: { 'aria-label': item.label } });
        // The catalogue is drawn, not shipped as files — so the chip renders the
        // very same path the page will get.
        chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
          + ' stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="' + item.d + '"/></svg>';
        chip.onclick = () => {
          const at = surface.viewCenter();
          surface.addObject({ kind: 'sticker', id: item.id, x: Math.round(at.x - 45), y: Math.round(at.y - 45), w: 90, h: 90, color: surface.color });
          setTool('select');
        };
      });
    };

    /* Spacing has no options to set — only an instruction, because the gesture
       is not guessable from a bar icon. */
    const buildSpaceRow = (parent) => {
      parent.createSpan({ cls: 'nx-sk-subnote', text: 'Drag a line down to open blank paper, up to close it again. Everything below the line moves with it.' });
    };

    const setTool = (id) => {
      const from = TOOL_OF();
      if (from !== id) lastTool = from;
      if (id === 'sheet') { sheetOpen = true; syncAll(); return; }
      sheetOpen = false;
      if (id === 'eraser') surface.setMode('erase');
      else if (id === 'select') surface.setMode('select');
      else if (id === 'space') surface.setMode('space');
      else if (id === 'insert') surface.setMode('insert');
      else {
        surface.setPen(id === 'marker' ? 'marker' : drawPen);
        surface.setMode('draw');
        applyToolColor();   // after setPen — the colour belongs to the NEW tool
      }
      syncAll();
    };
    const syncTools = () => {
      const tool = TOOL_OF();
      Object.keys(toolBtns).forEach(id => toolBtns[id].toggleClass('is-active', id === tool));
    };
    const syncAll = () => { syncTools(); renderSub(); };

    /* ═══ compose: tools · spacer · actions · ⋯ · the ways out ═══ */
    const tools = bar.createDiv('nx-sk-grp nx-sk-grp-tools');
    /* `sheet` is a tool only in the sense that it owns the options row. It is
       not something you draw with, so it belongs on the right with the other
       things you do to a drawing rather than among the pens. */
    inBar.filter(id => (BAR_ITEMS.find(i => i.id === id) || {}).kind === 'tool' && id !== 'sheet').forEach(id => {
      const item = BAR_ITEMS.find(i => i.id === id);
      const icon = id === 'pen' ? PEN_META[drawPen][1] : item.icon;
      const b = iconBtn(tools, icon, item.label, null);
      toolBtns[id] = b;
      b.onclick = () => {
        // Reveal mode: tapping the tool you are already using toggles its row.
        if (layout.mode === 'reveal') subOpen = (TOOL_OF() === id) ? !subOpen : true;
        setTool(id);
      };
    });

    bar.createDiv('nx-sk-spacer');
    const right = bar.createDiv('nx-sk-grp nx-sk-grp-actions');
    if (inBar.indexOf('sheet') >= 0) {
      const item = BAR_ITEMS.find(i => i.id === 'sheet');
      const b = iconBtn(right, item.icon, item.label, null);
      toolBtns.sheet = b;
      b.onclick = () => {
        if (layout.mode === 'reveal') subOpen = (TOOL_OF() === 'sheet') ? !subOpen : true;
        setTool(TOOL_OF() === 'sheet' ? (lastTool || 'pen') : 'sheet');
      };
    }
    const barActions = inBar.filter(id => ACTIONS[id] && !(ACTIONS[id].skip && ACTIONS[id].skip()));
    barActions.forEach(id => {
      const act = ACTIONS[id];
      const b = iconBtn(right, typeof act.icon === 'function' ? act.icon() : act.icon, act.label, null);
      if (act.active) b.toggleClass('is-active', act.active());
      if (act.popup) plugin._sketchPopover(b, act.popup(b));
      else b.onclick = () => { act.run(); if (act.active) b.toggleClass('is-active', act.active()); };
    });

    /* Whatever the user left out of the bar. No leftovers → no ⋯ button, rather
       than a menu that opens on nothing. */
    const overflow = BAR_ITEMS
      .map(i => i.id)
      .filter(id => !inBar.includes(id))
      .filter(id => !(ACTIONS[id] && ACTIONS[id].skip && ACTIONS[id].skip()));
    if (overflow.length) {
      if (barActions.length) right.createDiv('nx-sk-sep');
      const moreBtn = iconBtn(right, 'more-horizontal', 'More tools', null);
      plugin._sketchPopover(moreBtn, (pop, closePop) => {
        pop.addClass('nx-sk-menu');
        overflow.forEach(id => {
          const item = BAR_ITEMS.find(i => i.id === id);
          const act = ACTIONS[id];
          const row = pop.createDiv('nx-sk-menuitem');
          const ic = row.createDiv('nx-sk-menuitem-ic');
          setIcon(ic, act ? (typeof act.icon === 'function' ? act.icon() : act.icon) : (id === 'pen' ? PEN_META[drawPen][1] : item.icon));
          row.createDiv({ cls: 'nx-sk-menuitem-lbl', text: item.label });
          if (!act) {
            row.toggleClass('is-active', TOOL_OF() === id);
            row.onclick = () => { closePop(); if (layout.mode === 'reveal') subOpen = true; setTool(id); };
            return;
          }
          if (act.active) row.toggleClass('is-active', act.active());
          if (act.popup) row.onclick = () => { closePop(); plugin._showPopover(moreBtn, act.popup(null)); };
          else row.onclick = () => { act.run(); if (act.active) row.toggleClass('is-active', act.active()); };
        });
      });
    }

    // The ways OUT of the sketch — never movable, never hidden.
    if (opts.onSplit || opts.onDone) right.createDiv('nx-sk-sep');
    /* One big canvas, and it is the Sketch tab. The block's button asks where to
       put it — switch to it, beside the note, or a new tab. */
    if (opts.onSplit) {
      const splitBtn = iconBtn(right, 'maximize-2', 'Open in a Sketch tab', null, 'nx-sk-split');
      plugin._attachSplitMenu(splitBtn, opts, true);
    }
    if (opts.onDone) iconBtn(right, 'check', 'Save & close', () => opts.onDone(), 'nx-sk-done');

    /* ═══ pen gestures ═══ */
    /* The surface reports which gesture happened; what it MEANS lives here,
       because everything a gesture can do is a toolbar action. A hold action
       remembers the tool it interrupted and puts it back on release. */
    surface.setPenMap(penGestures.resolveMap(s.penProfile, s.penMap));
    surface.onGesture = (action, phase) => {
      const current = TOOL_OF();
      if (action === 'eraseHold') {
        if (phase === 'start') {
          if (current === 'eraser') return false;
          gestureHeldTool = current;
          setTool('eraser');
        } else if (gestureHeldTool) {
          setTool(gestureHeldTool);
          gestureHeldTool = null;
        }
        return true;
      }
      if (phase === 'end') return false;   // everything else fires once, on press
      if (action === 'eraseToggle') { setTool(current === 'eraser' ? lastTool || 'pen' : 'eraser'); return true; }
      if (action === 'select') { setTool(current === 'select' ? lastTool || 'pen' : 'select'); return true; }
      if (action === 'lastTool') { setTool(lastTool || 'pen'); return true; }
      if (action === 'undo') { surface.undo(); return true; }
      if (action === 'redo') { surface.redo(); return true; }
      if (action === 'ruler') {
        surface.setRuler(!surface.ruler.on, surface.ruler.angle);
        syncAll();
        return true;
      }
      if (action === 'nextColor') {
        const colors = activePal().colors;
        if (!colors.length) return false;
        const at = colors.findIndex(c => String(c).toLowerCase() === String(surface.color).toLowerCase());
        const next = colors[(at + 1) % colors.length];
        surface.setColor(next);
        rememberColor(next);
        renderSwatches();
        return true;
      }
      return false;
    };

    /* Reveal mode closes the row on the first stroke. The listener hangs off the
       pad itself (not the document) so it dies with the pad; a rebuild would
       otherwise stack a second one on the same element. */
    const pad = surface.host;
    if (pad) {
      if (pad._nxSubClose) { pad.removeEventListener('pointerdown', pad._nxSubClose, true); pad._nxSubClose = null; }
      if (layout.mode === 'reveal') {
        pad._nxSubClose = () => { if (subOpen) { subOpen = false; applyOpen(); } };
        pad.addEventListener('pointerdown', pad._nxSubClose, true);
      }
    }

    if (DRAWS(TOOL_OF())) applyToolColor();
    syncAll();
  }
}

module.exports = SketchBar;
