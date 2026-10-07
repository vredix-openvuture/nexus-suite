'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · note background and fonts
 *  The per-note background and font, the corner button that sets them, and
 *  the bundled fonts. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { Menu, arrayBufferToBase64, setIcon } = require('obsidian');

class NoteDecor {

  /* Make bundled fonts available on EVERY platform (incl. Obsidian mobile) by
     reading the file straight from the vault's fonts/ folder and inlining it as
     an @font-face data-URI. This deliberately does NOT rely on OS-installed
     fonts or a desktop-only font-loader plugin — a data-URI resolves identically
     on desktop and mobile. Monospace intentionally isn't bundled: it uses the
     platform's own --font-monospace, which always exists. */
  async registerFonts() {
    const fonts = [
      { family: 'Grape Nuts', file: 'GrapeNuts-Regular.ttf' },
    ];
    let css = '';
    for (const f of fonts) {
      const path = this.app.vault.configDir + '/fonts/' + f.file;
      try {
        if (!(await this.app.vault.adapter.exists(path))) {
          console.warn('[Nexus] font missing:', path);
          continue;
        }
        const b64 = arrayBufferToBase64(await this.app.vault.adapter.readBinary(path));
        css += "@font-face{font-family:'" + f.family + "';font-display:swap;" +
               "src:url(data:font/ttf;base64," + b64 + ") format('truetype');}\n";
      } catch (e) { console.error('[Nexus] font load failed:', f.file, e); }
    }
    if (!css) return;
    let styleEl = document.getElementById('nx-fonts');
    if (!styleEl) styleEl = document.head.createEl('style', { attr: { id: 'nx-fonts' } });
    styleEl.textContent = css;
    this.register(() => styleEl.remove());   // remove @font-face on plugin unload
  }

  /* Note style — background pattern (grid/lined/dotted) + font (mono/handwritten),
     both driven by frontmatter and aligned to the line grid. */
  updateNoteBg(view) {
    if (!view) return;
    const el = view.contentEl;
    el.classList.remove('nx-bg-lined', 'nx-bg-grid', 'nx-bg-dotted', 'nx-font-mono', 'nx-font-hand');
    if (!view.file) return;
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;

    // Font FIRST — the class changes the line height, which the grid measurement
    // below must see so the pattern still snaps to the text baseline.
    const font = fm && fm['note-font'];
    const fmap = { mono: 'nx-font-mono', hand: 'nx-font-hand' };
    if (font && fmap[font]) el.classList.add(fmap[font]);

    // Background pattern.
    const bg = fm && fm['note-bg'];
    const map = { lined: 'nx-bg-lined', grid: 'nx-bg-grid', dotted: 'nx-bg-dotted' };
    if (!bg || !map[bg]) return;
    // Measure the line height → align the grid to it (text sits on the line)
    const c = el.querySelector('.cm-content') || el.querySelector('.markdown-preview-view');
    if (c) {
      const cs = getComputedStyle(c);
      let lh = parseFloat(cs.lineHeight);
      if (isNaN(lh)) lh = (parseFloat(cs.fontSize) || 16) * 1.5;
      // Snap the period to WHOLE device pixels → even spacing even with
      // fractional screen scaling (otherwise sometimes 1, sometimes 2 device px).
      const dpr = window.devicePixelRatio || 1;
      el.style.setProperty('--nx-bg-line', (Math.round(lh * dpr) / dpr) + 'px');
    }
    el.classList.add(map[bg]);
  }

  mountBgControl(view) {
    if (!view) return;
    const el = view.contentEl;
    let btn = el.querySelector(':scope > .nx-bg-btn');
    if (!this.settings.banner.enabled || !view.file) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el.createDiv('nx-bg-btn');
      setIcon(btn, 'palette');
      btn.setAttribute('aria-label', 'Note style — background & font');
      btn.onclick = (evt) => { if (view.file) this.openBgMenu(evt, view.file); };
    }
  }

  openBgMenu(evt, file) {
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter;
    const curBg = (fm && fm['note-bg']) || 'none';
    const curFont = (fm && fm['note-font']) || 'normal';
    const menu = new Menu();

    // ── Background pattern ──
    const bgOpt = (label, val, icon) => menu.addItem(i =>
      i.setTitle(label).setIcon(icon).setChecked(curBg === val).onClick(() => this.setNoteBg(file, val)));
    bgOpt('No background', 'none', 'x');
    bgOpt('Lined', 'lined', 'menu');
    bgOpt('Grid', 'grid', 'grid');
    bgOpt('Dotted', 'dotted', 'more-horizontal');

    // ── Pattern strength: an inline stepper, because how visible the pattern is
    //    depends on the palette and you want to judge it while looking at the
    //    note. The −/+ spans swallow the click so the menu stays open and you
    //    can tap your way to the right value in one go. ──
    if (curBg !== 'none') {
      menu.addItem(i => {
        const frag = document.createDocumentFragment();
        const row = document.createElement('div');
        row.className = 'nx-bgstep';
        const mk = (txt, cls) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s; };
        const dec = mk('−', 'nx-bgstep-btn');
        const val = mk('', 'nx-bgstep-val');
        const inc = mk('+', 'nx-bgstep-btn');
        const paint = () => {
          const v = this.settings.banner.bgStrength;
          val.textContent = 'Strength ' + (v == null ? 4.5 : v).toFixed(1) + ' %';
        };
        // On POINTERDOWN, not click: a menu that closes on click would tear the
        // row out from under a click listener. This way the value always lands,
        // and swallowing the click on top keeps the menu open for the next tap.
        const step = (d) => async (ev) => {
          ev.preventDefault(); ev.stopImmediatePropagation();
          const s = this.settings.banner;
          const cur = s.bgStrength == null ? 4.5 : s.bgStrength;
          s.bgStrength = Math.round(Math.max(0.5, Math.min(30, cur + d)) * 10) / 10;
          this.applyNoteBgStrength(); paint();
          await this.saveSettings();
        };
        const swallow = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
        dec.addEventListener('pointerdown', step(-0.5));
        inc.addEventListener('pointerdown', step(+0.5));
        dec.addEventListener('click', swallow);
        inc.addEventListener('click', swallow);
        paint();
        row.append(dec, val, inc);
        frag.appendChild(row);
        i.setTitle(frag).setIcon('contrast');
      });
    }

    menu.addSeparator();

    // ── Font ──
    const fontOpt = (label, val, icon) => menu.addItem(i =>
      i.setTitle(label).setIcon(icon).setChecked(curFont === val).onClick(() => this.setNoteFont(file, val)));
    fontOpt('Normal font', 'normal', 'type');
    fontOpt('Monospace', 'mono', 'code');
    fontOpt('Handwritten', 'hand', 'pen-tool');

    menu.showAtMouseEvent(evt);
  }

  async setNoteBg(file, val) {
    await this.app.fileManager.processFrontMatter(file, f => {
      if (val === 'none') delete f['note-bg']; else f['note-bg'] = val;
    });
    this.refreshBanner();
  }

  async setNoteFont(file, val) {
    await this.app.fileManager.processFrontMatter(file, f => {
      if (val === 'normal') delete f['note-font']; else f['note-font'] = val;
    });
    this.refreshBanner();
  }

  /* Strength of the note background pattern (lined/grid/dotted). It's mixed
     out of --text-normal, so how visible it is depends entirely on the active
     palette — a fixed percentage that reads well on one background disappears
     on the next. Hence a setting instead of a constant. */
  applyNoteBgStrength() {
    const v = this.settings.banner && this.settings.banner.bgStrength;
    document.body.style.setProperty('--nx-bg-strength', (v == null ? 4.5 : v) + '%');
  }

  /* ---- Ribbon visibility (hover / always / hidden) ----
     Sets a body class AND injects the CSS rule itself (via <style>), so both
     ALWAYS come from the same call — independent of a theme/styles.css reload.
     Targets exactly .workspace-ribbon.mod-left (confirmed via devtools). */
  /* Handwritten note font: a factor of the app's own text size, published as a
     px value. It cannot be a calc() in the stylesheet — --font-text-size is
     exactly the variable being overridden, and a custom property defined in
     terms of itself is invalid at computed-value time. */
  /* The app's own text size, published so the note-font styles can compute
     from it (a custom property cannot be defined in terms of itself, which is
     why this detour through JS exists at all). The per-font factor lives in
     CSS — see styles/06-note-decor.css. */
  applyHandFont() {
    let base = 0;
    try { base = parseFloat(this.app.vault.getConfig('baseFontSize')); } catch (e) {}
    if (!base) base = parseFloat(getComputedStyle(document.body).getPropertyValue('--font-text-size')) || 16;
    const b = document.body;
    b.style.setProperty('--nx-base-size', base + 'px');
    b.style.setProperty('--nx-hand-scale', String(Number((this.settings.banner || {}).handScale) || 1.54));
  }
}

module.exports = NoteDecor;
