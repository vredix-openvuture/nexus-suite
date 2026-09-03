'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · general helpers
 *  Markdown render, daily-note helpers, ink zoom/pan, pdf page, colour conversion.
 * ========================================================================== */

const { MarkdownRenderer, moment } = require('obsidian');

/* Render markdown (new + old API) */
function renderMd(plugin, src, el, path) {
  if (MarkdownRenderer.render) return MarkdownRenderer.render(plugin.app, src, el, path || '', plugin);
  return MarkdownRenderer.renderMarkdown(src, el, path || '', plugin);
}

/* Read Daily Notes settings (core plugin) */

/* Read Daily Notes settings (core plugin) */
function getDailyNoteSettings(app) {
  const dn = app.internalPlugins && app.internalPlugins.getPluginById
    ? app.internalPlugins.getPluginById('daily-notes') : null;
  const o = (dn && dn.instance && dn.instance.options) || {};
  return {
    format: o.format || 'YYYY-MM-DD',
    folder: (o.folder || '').trim().replace(/\/$/, ''),
    template: (o.template || '').trim(),
  };
}

/* The daily note for a date, created from the daily-note template if it is not
   there yet. Split out of openDailyNote because writing a day's text has to be
   able to make the note without also jumping to it. */
async function ensureDailyNote(app, date) {
  const { format, folder, template } = getDailyNoteSettings(app);
  const path = (folder ? folder + '/' : '') + date.format(format) + '.md';
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) return existing;
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (e) {}
  }
  let content = '';
  if (template) {
    const tp = template.endsWith('.md') ? template : template + '.md';
    const tf = app.vault.getAbstractFileByPath(tp);
    if (tf) { try { content = await app.vault.read(tf); } catch (e) {} }
  }
  return app.vault.create(path, content);
}

async function openDailyNote(app, date) {
  const file = await ensureDailyNote(app, date);
  await app.workspace.getLeaf(false).openFile(file);
}

/* Multi-line input: one line per entry; as soon as the last line is filled a
   new empty line appears automatically. Still saves as a sepChar-separated
   string → the query logic stays unchanged. */
/* Ink Capture hover-zoom over sidecar images. Deliberately grows the img's
   REAL width/height (not transform:scale) — scale() just blows up the
   already-rasterized bitmap, which blurs SVG/vector content badly; resizing
   forces the browser to re-render the source crisply at the new size.
   position:absolute (added via the nx-ink-zooming class, see styles.css)
   takes it out of document flow while zoomed, so growing it doesn't reflow
   the rest of the note. All math is relative to a "base" rect captured once
   at hover-start — translation math derived from the standard "zoom toward
   a point" formula (offset by fraction × size-delta) so the point under the
   cursor stays visually anchored as the image grows/shrinks. */
function nxInkZoomStart(img) {
  // Viewport coordinates via getBoundingClientRect + position:fixed — NOT
  // offsetLeft/offsetTop/offsetParent, which depend on exactly how deep
  // Obsidian nests the real <img> inside the embed span (theme.css references
  // an .image-container wrapper we don't fully control) and produced wildly
  // wrong values → the flicker/jumping. Viewport coords are correct no matter
  // how the embed is nested.
  const r = img.getBoundingClientRect();
  img._nxZoomBase = { w: r.width, h: r.height, left: r.left, top: r.top };
  img.addClass('nx-ink-zooming');
  img.style.width = r.width.toFixed(1) + 'px';
  img.style.height = r.height.toFixed(1) + 'px';
  img.style.left = r.left.toFixed(1) + 'px';
  img.style.top = r.top.toFixed(1) + 'px';
}

function nxInkZoomMove(img, clientX, clientY) {
  const base = img._nxZoomBase;
  if (!base) return;
  const scale = parseFloat(img.dataset.nxZoom) || 2.4;
  const fracX = (clientX - base.left) / base.w;
  const fracY = (clientY - base.top) / base.h;
  const newW = base.w * scale, newH = base.h * scale;
  img.style.width = newW.toFixed(1) + 'px';
  img.style.height = newH.toFixed(1) + 'px';
  img.style.left = (base.left - fracX * (newW - base.w)).toFixed(1) + 'px';
  img.style.top = (base.top - fracY * (newH - base.h)).toFixed(1) + 'px';
}

function nxInkZoomEnd(img) {
  if (img._nxZoomRaf) { cancelAnimationFrame(img._nxZoomRaf); img._nxZoomRaf = null; }
  img.removeClass('nx-ink-zooming');
  img.style.width = ''; img.style.height = ''; img.style.left = ''; img.style.top = '';
  delete img._nxZoomBase;
  delete img.dataset.nxZoom;
}

/* Resolves a pdf.js outline entry's `dest` (either a named destination string
   or an already-explicit [ref, ...] array) to a 1-based page number, for the
   Ink Capture PDF viewer's table-of-contents jump-to-page. */

/* Resolves a pdf.js outline entry's `dest` (either a named destination string
   or an already-explicit [ref, ...] array) to a 1-based page number, for the
   Ink Capture PDF viewer's table-of-contents jump-to-page. */
async function nxPdfDestPage(pdf, dest) {
  try {
    let d = dest;
    if (typeof d === 'string') d = await pdf.getDestination(d);
    if (!d || !d[0]) return null;
    return (await pdf.getPageIndex(d[0])) + 1;
  } catch (e) { return null; }
}

/* Live suggestion list under an input. suggestFn() returns all candidates,
   filtered by the current input value. Pick via click/arrows/Enter. */

/* Callout colors are stored as "r, g, b" (Obsidian's --callout-color format,
   identical to eth-p Callout Manager). These convert to/from the hex a color
   picker speaks. Empty string = unset → inherit the theme default. */
function nxHexToRgb(hex) {
  const m = (hex || '').replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return '';
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

function nxRgbToHex(rgb) {
  const p = (rgb || '').split(',').map(x => parseInt(x.trim(), 10));
  if (p.length < 3 || p.some(isNaN)) return '#888888';
  return '#' + p.slice(0, 3).map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
}

/* Hex → the three numbers Obsidian's --accent-h/-s/-l want. Obsidian builds its
   OWN native controls from those components, not from a colour, so a palette
   that only sets colours leaves every one of them on Obsidian's default.
   Returns null for anything that is not a plain six-digit hex. */
function nxHexToHsl(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/* Edit ONE callout (type id + icon + base/light/dark color) with a live preview. */

/* ---- Vault suggestion sources (autocomplete in the card config modals) ----
   Shared so the plugin object and the homepage view answer identically. */
function nxAllFolders(app) {
  const out = [];
  for (const f of app.vault.getAllLoadedFiles()) if (f.children && f.path && f.path !== '/') out.push(f.path);
  return out.sort((a, b) => a.localeCompare(b));
}
function nxAllTags(app) {
  const t = app.metadataCache.getTags ? app.metadataCache.getTags() : {};
  return Object.keys(t).map(x => x.replace(/^#/, '')).sort((a, b) => a.localeCompare(b));
}
function nxAllNames(app) {
  return app.vault.getMarkdownFiles().map(f => f.basename).sort((a, b) => a.localeCompare(b));
}
function nxAllPropKeys(app) {
  const set = new Set();
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
    if (fm) for (const k of Object.keys(fm)) if (k !== 'position') set.add(k);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
function nxPropValues(app, key) {
  if (!key) return [];
  const set = new Set();
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
    if (fm && key in fm) (Array.isArray(fm[key]) ? fm[key] : [fm[key]])
      .forEach(x => { if (x != null && String(x).trim()) set.add(String(x)); });
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* ── Week start ──────────────────────────────────────────────────────────────
   One vault-wide setting (Settings → Calendar → "Week starts on") decides where a
   week begins for EVERY calendar surface: month grids, the week view, the
   agenda's "this week" bucket. moment's own startOf('week') follows the app
   locale, which is why these wrappers exist — they take the setting when it has
   one and fall back to the locale otherwise. moment's global locale is
   deliberately left alone: it belongs to Obsidian and every other plugin.
   Returns 0 = Sunday … 6 = Saturday, or null for "whatever the locale says". */
function nxWeekStartDow(plugin) {
  const v = plugin && plugin.settings && plugin.settings.tasksCalendar
    ? plugin.settings.tasksCalendar.weekStart : null;
  if (v == null || v === '' || v === 'locale') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : ((n % 7) + 7) % 7;
}
function nxStartOfWeek(m, plugin) {
  const dow = nxWeekStartDow(plugin);
  if (dow == null) return m.clone().startOf('week');
  const c = m.clone().startOf('day');
  return c.subtract((c.day() - dow + 7) % 7, 'day');
}
function nxEndOfWeek(m, plugin) { return nxStartOfWeek(m, plugin).add(6, 'day').endOf('day'); }
/* The grid around a whole month: full weeks, first one containing the 1st. */
function nxMonthGridRange(m, plugin) {
  const first = m.clone().startOf('month');
  return [nxStartOfWeek(first, plugin), nxEndOfWeek(first.clone().endOf('month'), plugin)];
}
/* Column headings in the same order the grid runs. */
function nxWeekdayLabels(plugin) {
  const dow = nxWeekStartDow(plugin);
  if (dow == null) return moment.weekdaysMin(true);
  const min = moment.weekdaysMin(false);        // fixed Sunday → Saturday
  return Array.from({ length: 7 }, (_, i) => min[(dow + i) % 7]);
}

/* Tab menu entry shared by the three pinnable Nexus pages (dashboard, calendar,
   tasks). Pinning is a property of the PAGE, not of one tab, so it is stored in
   the settings and applied by plugin.applyPinnedTabs(). */
function nxPinMenuItem(plugin, menu, key) {
  const on = plugin.isTabPinned(key);
  menu.addItem(i => i
    .setTitle(on ? 'Unpin from the tab bar' : 'Pin to the tab bar (icon only)')
    .setIcon(on ? 'pin-off' : 'pin')
    .setChecked(on)
    .onClick(() => plugin.setTabPinned(key, !on)));
}

module.exports = { renderMd, getDailyNoteSettings, ensureDailyNote, openDailyNote, nxInkZoomStart, nxInkZoomMove, nxInkZoomEnd, nxPdfDestPage, nxHexToHsl, nxHexToRgb, nxRgbToHex, nxAllFolders, nxAllNames, nxAllPropKeys, nxAllTags, nxEndOfWeek, nxMonthGridRange, nxPinMenuItem, nxPropValues, nxStartOfWeek, nxWeekdayLabels, nxWeekStartDow };
