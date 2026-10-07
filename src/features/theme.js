'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · theme and workspace look
 *  Palette and style classes on the body, the explorer, hidden folders and
 *  the ribbon. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { PALETTES, THEME_STYLES } = require('../constants.js');
const { nxHexToHsl } = require('../lib/color.js');

class Theme {

  /* ---- Theme adjustments (palette + spacing) ----
     The palette overrides the wallust --wl-* slots via an injected <style>;
     spacing/sizes as CSS variables on <body> (override the theme defaults). */
  applyThemeSettings() {
    const t = this.settings.theme || {};
    // "Dark" and "Light" were two entries for one neutral scheme (0.20.0) —
    // they are now the single "Minimal" palette, which follows Obsidian's own
    // light/dark mode. Fold the old ids over instead of leaving those vaults on
    // a palette that no longer exists.
    if (t.palette === 'dark' || t.palette === 'light') { t.palette = 'minimal'; this.saveSettings(); }

    /* The STYLE is the shape of the interface — one body class, and the theme
       plus the plugin's own CSS build a different app around it. Set before the
       palette so a style switch never renders half-tinted. */
    const style = THEME_STYLES[t.style] ? t.style : 'mirobo';
    Object.keys(THEME_STYLES).forEach(k => document.body.classList.toggle(THEME_STYLES[k].cls, k === style));

    let pel = document.getElementById('nx-palette-style');
    if (t.palette && t.palette !== 'dynamic' && PALETTES[t.palette]) {
      if (!pel) { pel = document.createElement('style'); pel.id = 'nx-palette-style'; document.head.appendChild(pel); }
      const p = PALETTES[t.palette];
      // A palette is either a flat map of --wl-* slots, or {slots, dark, light}
      // when it also has to pin the derived surfaces (the neutral ones do —
      // see PALETTES). `body.theme-*` outranks the theme's own `.theme-*`.
      const slots = p.slots || p;
      const vars = (obj) => Object.entries(obj).map(([k, v]) => k + ': ' + v + ';').join(' ');
      /* Obsidian derives its OWN native controls from --accent-h/-s/-l, which come
         from the accent picker in Appearance and default to hsl(258, 88%, 66%) —
         a blue-violet. 41 of its rules read var(--color-accent), and another 24
         read those raw components, so setting the colour alone still leaves two
         dozen native surfaces on Obsidian's blue while the theme goes coral.
         That is why menus and native elements were the things that looked wrong.
         The palette knows its accent as a hex, so it can hand over the three
         numbers exactly. */
      const accent = nxHexToHsl(slots.color3 || slots.color4 || '');
      const css = ['body.theme-dark, body.theme-light { '
        + Object.entries(slots).map(([k, v]) => '--wl-' + k + ': ' + v + ';').join(' ')
        + (accent ? ' --accent-h: ' + accent.h + '; --accent-s: ' + accent.s + '%; --accent-l: ' + accent.l + '%;' : '')
        + ' }'];
      if (p.dark) css.push('body.theme-dark { ' + vars(p.dark) + ' }');
      if (p.light) css.push('body.theme-light { ' + vars(p.light) + ' }');
      pel.textContent = css.join('\n');
    } else {
      /* The dynamic palette is written by the wallust snippet rather than here,
         so there are no slots to read from — but Obsidian's accent still has to
         be told about it, or every native control stays blue-violet while the
         rest of the app follows the wallpaper. Blank our own rule first, then
         read --wl-color3 back off the body: that is the live value, whatever
         set it. */
      if (pel) pel.textContent = '';
      const accent = nxHexToHsl(getComputedStyle(document.body).getPropertyValue('--wl-color3'));
      if (accent) {
        if (!pel) { pel = document.createElement('style'); pel.id = 'nx-palette-style'; document.head.appendChild(pel); }
        pel.textContent = 'body.theme-dark, body.theme-light { --accent-h: ' + accent.h
          + '; --accent-s: ' + accent.s + '%; --accent-l: ' + accent.l + '%; }';
      } else if (pel) { pel.remove(); }
    }

    /* Flat "70s color-block" surfaces (theme.css section 20) — only for the
       palettes that ship dedicated surface colours. Currently just "nexus". */
    const NX_BLOCKED = new Set(['nexus']);
    document.body.classList.toggle('nx-blocked', NX_BLOCKED.has(t.palette));

    const b = document.body;
    const setv = (k, v) => { if (v == null || v === '') b.style.removeProperty(k); else b.style.setProperty(k, v + 'px'); };
    // Card gap and corner radius describe the mirobo cards. In "almost nothing"
    // there are none, and an inline value from an earlier session would beat the
    // style's own tokens (inline > class) and put the gaps back.
    setv('--nx-gap', style === 'plain' ? null : t.gap);
    setv('--nx-radius', style === 'plain' ? null : t.radius);
    setv('--nx-home-gap', t.homeGap);
    setv('--nx-home-pad', t.homePad);
    setv('--nx-home-row', t.homeRow);
  }

  /* ---- Explorer polish ----
     Only toggles a body class; the actual styling of the folder cards lives in
     the Nexus theme (section 7) and therefore only applies with the theme active. */
  applyExplorer() {
    const s = this.settings.explorer || {};
    const on = !!(s.enabled && s.folderBg);
    document.body.classList.toggle('nx-explorer-folders', on);
    if (on && s.intensity != null)
      document.body.style.setProperty('--nx-fld-intensity', s.intensity + '%');
    else
      document.body.style.removeProperty('--nx-fld-intensity');
    this.applyHiddenFolders();
  }

  /* Obsidian's own answer for where attachments go. It can be a plain folder,
     a path, "/" for the vault root, or "./" plus a name for a folder beside
     each note — the last two cannot be hidden as one entry in the tree, so they
     come back empty and the user names the folder themselves. */
  defaultAttachmentFolder() {
    const raw = (this.app.vault.getConfig && this.app.vault.getConfig('attachmentFolderPath')) || '';
    const path = String(raw).trim();
    if (!path || path === '/' || path.startsWith('./')) return '';
    return path.replace(/^\/+|\/+$/g, '');
  }

  /* Hiding is a stylesheet, not a class on the body: the rule has to name the
     folder, and the folder is a setting. One <style> element, rewritten in
     place, so the rule and the setting can never disagree. */
  applyHiddenFolders() {
    const s = this.settings.explorer || {};
    const id = 'nx-explorer-style';
    document.getElementById(id)?.remove();
    if (!s.enabled || !s.hideAttachments) return;
    const folder = (s.attachmentFolder || this.defaultAttachmentFolder()).replace(/^\/+|\/+$/g, '');
    if (!folder) return;
    // A vault path may hold quotes and backslashes; CSS.escape is for
    // identifiers, so the value is escaped as the string it is.
    const value = folder.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const el = document.createElement('style');
    el.id = id;
    el.textContent =
      '.nav-files-container .nav-folder:has(> .nav-folder-title[data-path="' + value + '"])' +
      ' { display: none; }';
    document.head.appendChild(el);
  }

  applyRibbon() {
    const mode = (this.settings.ribbon && this.settings.ribbon.mode) || 'always';
    document.body.classList.toggle('nx-ribbon-hover', mode === 'hover');
    document.body.classList.toggle('nx-ribbon-hidden', mode === 'hidden');
    let st = document.getElementById('nx-ribbon-style');
    if (!st) { st = document.createElement('style'); st.id = 'nx-ribbon-style'; document.head.appendChild(st); }
    st.textContent =
      'body.nx-ribbon-hidden .workspace-ribbon.mod-left,' +
      'body.nx-ribbon-hidden .side-dock-ribbon.mod-left{display:none !important;}' +
      // overlay instead of in-flow → expanding shifts NOTHING (no flicker).
      'body.nx-ribbon-hover .workspace{position:relative;}' +
      'body.nx-ribbon-hover .workspace-ribbon.mod-left,' +
      'body.nx-ribbon-hover .side-dock-ribbon.mod-left{' +
        'position:absolute !important;top:0;bottom:0;left:0;z-index:100;' +
        'width:56px !important;min-width:56px !important;max-width:56px !important;flex:0 0 56px !important;' +
        'overflow:hidden;' +
        'transform:translateX(calc(-100% + 10px));' +   // only 10px stick out as the hover zone
        'background:transparent !important;border-color:transparent !important;box-shadow:none !important;margin:0 !important;' +
        'transition:transform .16s ease,background .16s ease;}' +
      'body.nx-ribbon-hover .workspace-ribbon.mod-left:hover,' +
      'body.nx-ribbon-hover .side-dock-ribbon.mod-left:hover{' +
        'transform:translateX(0);' +
        'background:var(--nx-chip-side,var(--background-secondary)) !important;' +
        'border:1px solid var(--nx-border,var(--background-modifier-border)) !important;' +
        'border-radius:var(--nx-radius,12px) !important;margin:6px !important;}';
  }
}

module.exports = Theme;
