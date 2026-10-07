'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sketchbook covers
 *  A sketch shows up in the capture hub as a little bound book, and this is
 *  what its cover is made of: one TONE out of the palette and one PATTERN.
 *
 *  Both are names, never colours. The tone resolves to a CSS custom property in
 *  23-capture.css and is therefore mixed from the live wallust palette — a
 *  stored hex would freeze one wallpaper's colours into every sidecar and go
 *  wrong the moment the palette changed.
 *
 *  A sketch with no cover of its own still gets one: the tone is hashed from
 *  its id, so a shelf is never one flat colour, and the same drawing is the
 *  same colour on every device without anything being written to disk.
 * ========================================================================== */

/* The five palette slots the theme's "signature" colours live in. Order is
   the order of the picker, and the ids are what goes in the sidecar. */
const COVER_TONES = [
  { id: 'aubergine', label: 'Aubergine' },
  { id: 'rainboots', label: 'Rain Boots' },
  { id: 'prussian',  label: 'Prussian' },
  { id: 'madder',    label: 'Madder' },
  { id: 'claret',    label: 'Claret' },
];

/* Four bindings. `solid` is not "no pattern" — it still carries the single
   light fall that keeps a cover from reading as a flat rectangle. */
const COVER_PATTERNS = [
  { id: 'solid',  label: 'Solid' },
  { id: 'linen',  label: 'Linen' },
  { id: 'marble', label: 'Marble' },
  { id: 'ruled',  label: 'Ruled' },
];

const DEFAULT_PATTERN = 'linen';

function isTone(id) { return COVER_TONES.some(t => t.id === id); }
function isPattern(id) { return COVER_PATTERNS.some(p => p.id === id); }

/* A stable small number from a string. Not a security hash — it only has to
   spread ids across five buckets and give the same answer twice. */
function hashCode(text) {
  let h = 0;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* What to actually draw. `stored` is whatever the sidecar had — possibly
   nothing, possibly half of it, possibly a name from a future version — and
   every field falls back on its own so a single unknown value cannot leave a
   book without a cover. `chosen` says whether any of it was picked by hand,
   which is what lets the picker tell "you chose this" from "this is what the
   shelf happens to be showing you" — saving an untouched dialog must not turn
   the hashed tone into a choice. */
function coverFor(id, stored) {
  const src = stored && typeof stored === 'object' ? stored : {};
  const tone = isTone(src.tone) ? src.tone : COVER_TONES[hashCode(id) % COVER_TONES.length].id;
  const pattern = isPattern(src.pattern) ? src.pattern : DEFAULT_PATTERN;
  return { tone, pattern, chosen: isTone(src.tone) || isPattern(src.pattern) };
}

/* What goes back into the sidecar. Undefined when the cover is the default one
   again, so "reset" leaves the file exactly as it was before a cover was ever
   picked instead of writing the hashed tone in as a choice. */
function coverValue(tone, pattern) {
  const out = {};
  if (isTone(tone)) out.tone = tone;
  if (isPattern(pattern) && pattern !== DEFAULT_PATTERN) out.pattern = pattern;
  return (out.tone || out.pattern) ? out : undefined;
}

module.exports = {
  COVER_TONES, COVER_PATTERNS, DEFAULT_PATTERN,
  isTone, isPattern, hashCode, coverFor, coverValue,
};
