'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · colour
 *  Reading and writing the colour strings the plugin meets: CSS colours from a
 *  pen or a picker, Obsidian's "r, g, b" callout triplets, palette hexes.
 *  Pure: no Obsidian, no DOM.
 * ========================================================================== */

/* #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() → { r, g, b (0-255), a (0-1) },
   or null for anything else (a var(), a name). */
function parseColor(text) {
  if (typeof text !== 'string') return null;
  const c = text.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 }; }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) {
    const h = m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: m[2] != null ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(',').map(x => parseFloat(x.trim()));
    if (p.length >= 3 && p.slice(0, 3).every(n => !isNaN(n))) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
  }
  return null;
}

/* Three 0-255 channels → #rrggbb. Out-of-range values are clamped. */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}

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
  return rgbToHex(p[0], p[1], p[2]);
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

module.exports = { parseColor, rgbToHex, nxHexToRgb, nxRgbToHex, nxHexToHsl };
