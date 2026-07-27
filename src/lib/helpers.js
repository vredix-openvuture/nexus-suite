'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · general helpers
 *  Markdown render, daily-note helpers, ink zoom/pan, pdf page, colour conversion.
 * ========================================================================== */

const { MarkdownRenderer } = require('obsidian');

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

async function openDailyNote(app, date) {
  const { format, folder, template } = getDailyNoteSettings(app);
  const name = date.format(format);
  const path = (folder ? folder + '/' : '') + name + '.md';
  let file = app.vault.getAbstractFileByPath(path);
  if (!file) {
    if (folder && !app.vault.getAbstractFileByPath(folder)) {
      try { await app.vault.createFolder(folder); } catch (e) {}
    }
    let content = '';
    if (template) {
      const tp = template.endsWith('.md') ? template : template + '.md';
      const tf = app.vault.getAbstractFileByPath(tp);
      if (tf) { try { content = await app.vault.read(tf); } catch (e) {} }
    }
    file = await app.vault.create(path, content);
  }
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

/* Edit ONE callout (type id + icon + base/light/dark color) with a live preview. */

module.exports = { renderMd, getDailyNoteSettings, openDailyNote, nxInkZoomStart, nxInkZoomMove, nxInkZoomEnd, nxPdfDestPage, nxHexToRgb, nxRgbToHex };
