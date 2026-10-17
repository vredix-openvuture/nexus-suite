'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sketch SVG
 *  The sidecar file format and the paper: SVG elements, background patterns,
 *  paper texture, dark-paper ink, and reading/writing the metadata block.
 * ========================================================================== */

const { parseColor, rgbToHex } = require('./color.js');

const SVGNS = 'http://www.w3.org/2000/svg';
const LOGICAL_W = 1600;          // fixed logical canvas width (viewBox units)

function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/* Ratio string ("16:9" / "16/9" / "1.5") → [W, H] in logical units. */
function ratioWH(ratio) {
  const m = String(ratio || '16:9').split(/[:/]/).map(x => parseFloat(x));
  const rw = m[0] > 0 ? m[0] : 16;
  const rh = (m.length > 1 && m[1] > 0) ? m[1] : 9;
  return [LOGICAL_W, Math.round(LOGICAL_W * rh / rw)];
}

/* Pencil grain: an SVG filter that punches fractal-noise holes into a stroke's
   fill → a graphite/tooth stipple. Same markup drives the live DOM and the
   exported file. Only pencil strokes reference it (cheap no-op otherwise). */
function pencilFilterStr(id) {
  return `<filter id="${id}" x="-12%" y="-12%" width="124%" height="124%">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed="7" result="n"/>`
    + `<feComponentTransfer in="n" result="m"><feFuncA type="discrete" tableValues="0 0 0.4 0.75 1"/></feComponentTransfer>`
    + `<feComposite in="SourceGraphic" in2="m" operator="in"/>`
    + `</filter>`;
}

/* One tile of a background pattern → { w, h, inner } where `inner` is an SVG
   markup STRING. Used for BOTH the live DOM (parsed via DOMParser, like the
   pencil filter) and the export, so one source of truth drives every renderer
   and multi-line tiles (isometric) stay simple. null = none/unknown. */
const SQRT3 = 1.7320508075688772;
function bgPatternTile(type, size, color, opacity) {
  const s = size;
  const ln = (d, w) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w || 2}" stroke-linecap="round" stroke-opacity="${opacity}"/>`;
  const dt = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r || 2.4}" fill="${color}" fill-opacity="${opacity}"/>`;
  switch (type) {
    case 'dots':  return { w: s, h: s, inner: dt(s / 2, s / 2) };
    case 'lines': return { w: s, h: s, inner: ln(`M0 ${s} L${s} ${s}`) };
    // 'graph' (engineering paper) was removed; sketches saved with it get the grid.
    case 'graph':
    case 'grid':  return { w: s, h: s, inner: ln(`M${s} 0 L0 0 L0 ${s}`) };
    case 'cross': {   // small plus centred in each tile (kept off the edge so no clipping)
      const c = Math.max(2.5, s * 0.16), m = s / 2;
      return { w: s, h: s, inner: ln(`M${m - c} ${m} L${m + c} ${m}`) + ln(`M${m} ${m - c} L${m} ${m + c}`) };
    }
    case 'isometric': {   // triangular grid: two horizontals + a ±60° diagonal each
      const h = s * SQRT3;
      return { w: s, h, inner:
        ln(`M0 0 L${s} 0`) + ln(`M0 ${h / 2} L${s} ${h / 2}`) +
        ln(`M0 0 L${s} ${h}`) + ln(`M0 ${h} L${s} 0`) };
    }
    case 'isodots': {   // isometric (triangular) dot lattice, shifted off the tile edges
      const h = s * SQRT3;
      return { w: s, h, inner: dt(s / 4, h / 4) + dt(3 * s / 4, 3 * h / 4) };
    }
    default: return null;
  }
}

/* Subtle paper grain/crinkle for the "paper style" toggle. A small stitched
   feTurbulence tile overlaid in multiply → very light fibre + soft fold mottling.
   Tiled (not a full-canvas filter) so an endless sheet stays cheap and flat in
   memory; lives in the SVG so the export looks the same. */
const PAPER_TEX_TILE = 240;
function paperTexDefsStr(filtId, patId) {
  return `<filter id="${filtId}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="5" seed="11" stitchTiles="stitch" result="n"/>`
    + `<feColorMatrix in="n" type="matrix" values="0.09 0 0 0 0.91  0.09 0 0 0 0.91  0.09 0 0 0 0.91  0 0 0 0 1"/>`
    + `</filter>`
    + `<pattern id="${patId}" width="${PAPER_TEX_TILE}" height="${PAPER_TEX_TILE}" patternUnits="userSpaceOnUse">`
    + `<rect width="${PAPER_TEX_TILE}" height="${PAPER_TEX_TILE}" filter="url(#${filtId})"/>`
    + `</pattern>`;
}

/* Split a colour into an OPAQUE colour + its alpha. The live layers always paint
   opaque and hand the alpha to their wrapper element, so a chunk seam or a
   tail/chunk overlap can never composite darker than the committed stroke. */
function splitAlpha(c) {
  const p = parseColor(c);
  if (!p || p.a >= 1) return { color: c, alpha: 1 };
  return { color: `rgb(${p.r}, ${p.g}, ${p.b})`, alpha: p.a };
}

/* On dark paper, only ink that sits too close to black is lifted; anything with a
   channel brighter than this (HSV value) is a vivid colour and stays as drawn. */
const INK_LIFT_MAXV = 0.4;

/* Luminance-invert a colour (dark ↔ light) while keeping its hue — matches the
   CSS `invert(1) hue-rotate(180deg)` used for dark-paper mode. Alpha preserved,
   so a black-on-white drawing reads as white-on-black and colours just lighten. */
function lumInvertColor(color) {
  const c = parseColor(color);
  if (!c) return color;
  const r = 1 - c.r / 255, g = 1 - c.g / 255, b = 1 - c.b / 255;   // invert
  const R = -0.574 * r + 1.430 * g + 0.144 * b;                    // + hue-rotate 180°
  const G =  0.426 * r + 0.430 * g + 0.144 * b;
  const B =  0.426 * r + 1.430 * g - 0.856 * b;
  const q = x => Math.max(0, Math.min(255, Math.round(x * 255)));
  const rr = q(R), gg = q(G), bb = q(B);
  if (c.a != null && c.a < 1) return `rgba(${rr},${gg},${bb},${c.a})`;
  return rgbToHex(rr, gg, bb);
}

/* Parse a sidecar back into its data object from the <metadata> JSON. Returns
   null for a non-sketch / malformed SVG (we then leave the file alone rather
   than clobbering a hand-edited image). */
function parseSketchSVG(text) {
  try {
    const doc = new DOMParser().parseFromString(text || '', 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    const meta = doc.querySelector('metadata');
    if (!meta) return null;
    const data = JSON.parse((meta.textContent || '').trim());
    if (!data || !Array.isArray(data.strokes)) return null;
    return data;
  } catch (e) { return null; }
}

/* A brand-new, empty sidecar. Written the moment a note is given a sketch id so
   the Sketch tab always opens on a real file instead of on "not found" — the
   same envelope toSVGString emits, with nothing in it.

   `presets` carries the look of the page it is being added after: paper colour,
   texture, grid. A second page of the same drawing on different paper is not a
   second page, it is a different pad. */
function emptySketchSVG(presets) {
  const p = presets || {};
  const W = p.w || LOGICAL_W;
  const H = p.h || Math.round(W * 3 / 4);
  const meta = { v: 1, w: W, h: H, bg: p.bg || '', paper: p.paper || 'paper', strokes: [] };
  if (p.paperStyle != null) meta.paperStyle = !!p.paperStyle;
  if (p.paperType) meta.paperType = p.paperType;
  if (p.sheetLandscape != null) meta.sheetLandscape = !!p.sheetLandscape;
  if (p.bgType) meta.bgType = p.bgType;
  if (p.bgSize != null) meta.bgSize = p.bgSize;
  if (p.bgOpacity != null) meta.bgOpacity = p.bgOpacity;
  if (p.bgColor) meta.bgColor = p.bgColor;
  const json = JSON.stringify(meta);
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[${json}]]></nx-sketch></metadata></svg>`;
}

/* The look of a sketch, without its ink — what a new page beside it inherits. */
function sketchPresets(data) {
  if (!data) return {};
  return {
    bg: data.bg, paper: data.paper, paperStyle: data.paperStyle,
    paperType: data.paperType, sheetLandscape: data.sheetLandscape,
    bgType: data.bgType, bgSize: data.bgSize, bgOpacity: data.bgOpacity, bgColor: data.bgColor,
  };
}

/* Change one field of a sidecar without opening it: rewrite the metadata block
   in the file's own text. The block is exactly what toSVGString emits, so
   replacing it whole is safe — and far safer than reaching into the CDATA,
   whose `]]>` escaping would have to be undone and redone by hand. A key set to
   undefined is DELETED rather than written as null, which is the same shape
   toSVGString emits for an absent field. */
function withSketchMeta(svgText, patch, parsed) {
  const data = parsed || parseSketchSVG(svgText);
  if (!data) return null;
  if (!/<metadata>[\s\S]*?<\/metadata>/.test(svgText)) return null;
  const next = Object.assign({}, data);
  Object.keys(patch || {}).forEach(key => {
    if (patch[key] === undefined) delete next[key];
    else next[key] = patch[key];
  });
  const cdata = JSON.stringify(next).split(']]>').join(']]]]><![CDATA[>');
  const block = `<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[${cdata}]]></nx-sketch></metadata>`;
  return svgText.replace(/<metadata>[\s\S]*?<\/metadata>/, () => block);
}

/* Rename a page without opening it. An empty name clears it, so the file falls
   back to being named by its id rather than carrying an empty title. */
function withSketchTitle(svgText, title, parsed) {
  const clean = String(title == null ? '' : title).trim();
  return withSketchMeta(svgText, { title: clean || undefined }, parsed);
}

/* Give a sketch its book cover. `cover` is {tone, pattern} out of
   lib/sketchcover.js, or undefined to go back to the hashed default. */
function withSketchCover(svgText, cover, parsed) {
  return withSketchMeta(svgText, { cover: cover || undefined }, parsed);
}

/* Named paper backgrounds. `bg` = solid fill colour ('' = transparent, so the
   host note's own background shows through = "native"). `grid` = the pattern
   colour that reads well on that fill. Lives here in the engine (Obsidian-free)
   so the exported SVG carries the same paper everywhere it's viewed. */
const PAPER_MODES = {
  native: { bg: '',        grid: '#808080' },   // '' → transparent; the host paints the note's own background
  paper:  { bg: '#f7f6f2', grid: '#334155' },   // slightly yellowish off-white
  white:  { bg: '#ffffff', grid: '#334155' },
  black:  { bg: '#141414', grid: '#c9c9c9', dark: true },   // dark → near-black ink is lifted (if invertOnDark)
};

module.exports = { SVGNS, LOGICAL_W, svgEl, ratioWH, pencilFilterStr, SQRT3, bgPatternTile, PAPER_TEX_TILE, paperTexDefsStr, splitAlpha, INK_LIFT_MAXV, lumInvertColor, parseSketchSVG, emptySketchSVG, sketchPresets, withSketchMeta, withSketchTitle, withSketchCover, PAPER_MODES };
