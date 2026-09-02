'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sketch objects
 *  Things on the page that are not strokes: images, stickers and sticky notes.
 *
 *  They live in their own array next to `strokes` rather than pretending to be
 *  strokes, because nothing about them is a stroke — no pressure, no outline,
 *  no eraser. They serialise into the same sidecar and emit the same SVG for
 *  the live pad and for the exported file, so a drawing with a photo in it is
 *  still one standalone .svg that any viewer can open.
 *
 *  An image is embedded as a data URI, never as a vault path: a sidecar that
 *  points at a file somewhere else stops being standalone the moment it is
 *  copied, and "the picture is gone" is a worse outcome than a bigger file.
 * ========================================================================== */

const OBJECT_KINDS = ['image', 'sticker', 'note'];

/* Sticky-note colours, as paper rather than as ink: a note is a background
   with text on it, so these are pale enough to write on in both themes. */
const NOTE_COLORS = [
  { id: 'yellow', label: 'Yellow', fill: '#fde68a', ink: '#3f3416' },
  { id: 'pink',   label: 'Pink',   fill: '#fbcfe8', ink: '#43202f' },
  { id: 'blue',   label: 'Blue',   fill: '#bfdbfe', ink: '#17273f' },
  { id: 'green',  label: 'Green',  fill: '#bbf7d0', ink: '#12331f' },
  { id: 'grey',   label: 'Grey',   fill: '#e5e7eb', ink: '#2b2f36' },
];
function noteColor(id) { return NOTE_COLORS.find(c => c.id === id) || NOTE_COLORS[0]; }

/* Stickers are drawn, not shipped as files: a handful of paths costs nothing,
   works offline, scales to any size and takes the ink colour. Each is authored
   in a 24x24 box and scaled to the object. */
const STICKERS = [
  { id: 'check',    label: 'Check',      d: 'M20 6 9 17l-5-5' },
  { id: 'star',     label: 'Star',       d: 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z' },
  { id: 'arrow',    label: 'Arrow',      d: 'M4 12h15M13 6l6 6-6 6' },
  { id: 'flag',     label: 'Flag',       d: 'M5 21V4M5 4h11l-2 4 2 4H5' },
  { id: 'heart',    label: 'Heart',      d: 'M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z' },
  { id: 'bang',     label: 'Exclamation', d: 'M12 3v11M12 19v.5' },
  { id: 'question', label: 'Question',   d: 'M9 9a3 3 0 1 1 4 2.8c-.7.3-1 1-1 1.7v.5M12 19v.5' },
  { id: 'bulb',     label: 'Idea',       d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6h5.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z' },
];
function sticker(id) { return STICKERS.find(s => s.id === id) || STICKERS[0]; }

const MIN_SIZE = 12;   // an object smaller than this cannot be grabbed again

function objectBounds(obj) {
  return {
    minX: obj.x, minY: obj.y,
    maxX: obj.x + Math.max(MIN_SIZE, obj.w),
    maxY: obj.y + Math.max(MIN_SIZE, obj.h),
  };
}

/* A locked object is drawn but never picked up. That is the whole of the lock:
   it is not selectable, so nothing downstream — move, scale, duplicate, delete
   — can reach it, and no separate rule has to remember to check. A scan being
   annotated is locked, because a stray drag across the page must not move the
   thing you are drawing on. */
function isLocked(obj) { return !!(obj && obj.locked); }

/* Topmost first: what is drawn last is what the finger lands on. */
function objectAt(objects, x, y) {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (isLocked(objects[i])) continue;
    const b = objectBounds(objects[i]);
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return i;
  }
  return -1;
}

/* Fit a new object into the page: keep its aspect, never wider than `maxW`,
   and drop it where the caller asked with its centre on that point. */
function placeObject(cx, cy, naturalW, naturalH, maxW) {
  const scale = naturalW > maxW ? maxW / naturalW : 1;
  const w = Math.max(MIN_SIZE, Math.round(naturalW * scale));
  const h = Math.max(MIN_SIZE, Math.round(naturalH * scale));
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
}

function transformObject(obj, m) {
  const next = Object.assign({}, obj);
  const a = [m.a * obj.x + m.c * obj.y + m.e, m.b * obj.x + m.d * obj.y + m.f];
  // Objects stay axis-aligned: a rotated photo would need a transform on the
  // element and a different hit test, and neither is worth it for a sticker.
  next.x = +a[0].toFixed(1);
  next.y = +a[1].toFixed(1);
  next.w = Math.max(MIN_SIZE, Math.abs(obj.w * m.a));
  next.h = Math.max(MIN_SIZE, Math.abs(obj.h * m.d));
  return next;
}

/* ── Text on a sticky note ──────────────────────────────────────────────────
   SVG does not wrap, so the lines are worked out here and emitted as tspans.
   The character budget is derived from the box: at font size `fs` an average
   glyph of this stack is about 0.55em wide, which is close enough that a note
   never overflows its own paper. */
const GLYPH_RATIO = 0.55;

function wrapText(text, boxWidth, fontSize, padding) {
  const usable = Math.max(1, boxWidth - 2 * (padding || 0));
  const perLine = Math.max(1, Math.floor(usable / (fontSize * GLYPH_RATIO)));
  const lines = [];
  for (const paragraph of String(text == null ? '' : text).split('\n')) {
    if (!paragraph.length) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (!line.length) {
        line = word;
      } else if ((line + ' ' + word).length <= perLine) {
        line += ' ' + word;
      } else {
        lines.push(line);
        line = word;
      }
      // A single word longer than the line is broken rather than left to run
      // off the paper.
      while (line.length > perLine) {
        lines.push(line.slice(0, perLine));
        line = line.slice(perLine);
      }
    }
    lines.push(line);
  }
  return lines;
}

function noteFontSize(obj) {
  // Scales with the note so a small one is not unreadable and a big one is not
  // a poster, but never below something legible on a phone.
  return Math.max(11, Math.min(28, Math.round(Math.min(obj.w, obj.h) / 6)));
}

function xmlEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* ── SVG ────────────────────────────────────────────────────────────────────
   ONE emitter for both the live pad and the exported file. Two of them would
   drift, and the drift would only ever show up in the export — the copy nobody
   looks at until it matters. */
function objectSVG(obj) {
  if (obj.kind === 'image') {
    if (!obj.href) return '';
    return `<image x="${obj.x}" y="${obj.y}" width="${obj.w}" height="${obj.h}"`
      + ` preserveAspectRatio="none" href="${xmlEscape(obj.href)}"/>`;
  }
  if (obj.kind === 'sticker') {
    const glyph = sticker(obj.id);
    const scale = Math.min(obj.w, obj.h) / 24;
    const ox = obj.x + (obj.w - 24 * scale) / 2;
    const oy = obj.y + (obj.h - 24 * scale) / 2;
    const width = Math.max(1.2, 2 / scale);
    return `<g transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${scale.toFixed(4)})">`
      + `<path d="${glyph.d}" fill="none" stroke="${xmlEscape(obj.color || '#2f2f2f')}"`
      + ` stroke-width="${width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }
  if (obj.kind === 'note') {
    const col = noteColor(obj.color);
    const fs = noteFontSize(obj);
    const pad = Math.round(fs * 0.7);
    const lines = wrapText(obj.text, obj.w, fs, pad);
    const lineH = Math.round(fs * 1.35);
    let body = `<rect x="${obj.x}" y="${obj.y}" width="${obj.w}" height="${obj.h}" rx="${Math.min(10, obj.w / 12).toFixed(1)}"`
      + ` fill="${col.fill}"/>`;
    body += `<text x="${obj.x + pad}" y="${obj.y + pad + fs}" font-size="${fs}"`
      + ` font-family="ui-sans-serif, system-ui, sans-serif" fill="${col.ink}">`;
    lines.forEach((line, i) => {
      // Lines past the bottom of the note are dropped, not drawn over the edge.
      if (obj.y + pad + fs + i * lineH > obj.y + obj.h - pad * 0.4) return;
      body += `<tspan x="${obj.x + pad}" dy="${i === 0 ? 0 : lineH}">${xmlEscape(line)}</tspan>`;
    });
    body += '</text>';
    return body;
  }
  return '';
}

function objectsSVG(objects) {
  return (objects || []).map(objectSVG).join('');
}

module.exports = {
  OBJECT_KINDS, NOTE_COLORS, noteColor, STICKERS, sticker, MIN_SIZE,
  isLocked, objectBounds, objectAt, placeObject, transformObject,
  wrapText, noteFontSize, objectSVG, objectsSVG, xmlEscape, GLYPH_RATIO,
};
