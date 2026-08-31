'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sketch search
 *  Finding a drawing again. Everything here is pure: what text a sketch has,
 *  how a query scores against it, and how an OCR command line is parsed.
 *
 *  A sketch already carries real text before a single character is recognised —
 *  its title, its section names, whatever is written on its sticky notes. That
 *  is indexed and searchable on its own, and OCR only ADDS to it. Building it
 *  the other way round would mean search does nothing at all until an engine is
 *  installed, which is a worse product for everyone who never installs one.
 * ========================================================================== */

/* Weights: a title is what the sketch IS, a section is where you were, a note
   is something you wrote deliberately, and recognised handwriting is a guess.
   Ranking them equally puts a shaky OCR hit above an exact title match. */
const SKETCH_FIELDS = [
  { id: 'title', label: 'Title', weight: 100 },
  { id: 'sections', label: 'Sections', weight: 60 },
  { id: 'notes', label: 'Sticky notes', weight: 40 },
  { id: 'ocr', label: 'Handwriting', weight: 18 },
];

/* The searchable strings of one sidecar, lowercased once so the scorer never
   has to. */
function sketchDocument(path, data) {
  const lower = (v) => String(v == null ? '' : v).toLowerCase();
  const notes = (data.objects || [])
    .filter(o => o && o.kind === 'note' && o.text)
    .map(o => lower(o.text));
  const sections = (data.sections || []).map(s => lower(s.title));
  const ocr = (data.ocr || []).map(o => lower(typeof o === 'string' ? o : o.text));
  return {
    path,
    title: lower(data.title),
    display: String(data.title || path.split('/').pop().replace(/\.svg$/i, '')),
    fields: { title: [lower(data.title)], sections, notes, ocr },
    hasOcr: ocr.length > 0,
  };
}

/* Score one document against one lowercase term. `fieldScore` is injected —
   the vault search already owns that maths and there is no reason for a second
   version of it to drift alongside. Returns 0 when nothing matched. */
function scoreDocument(term, doc, fieldScore) {
  let total = 0;
  let best = null;
  for (const field of SKETCH_FIELDS) {
    const values = doc.fields[field.id] || [];
    let top = 0;
    for (const value of values) {
      const q = fieldScore(term, value);
      if (q > top) top = q;
      if (top === 1) break;
    }
    if (!top) continue;
    total += top * field.weight;
    if (!best || top * field.weight > best.score) best = { field: field.id, label: field.label, score: top * field.weight };
  }
  return { score: total, best };
}

/* Every term has to hit something, so two words narrow instead of widen. */
function searchSketches(query, docs, fieldScore) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const doc of docs) {
    let total = 0;
    let best = null;
    let matchedAll = true;
    for (const term of terms) {
      const r = scoreDocument(term, doc, fieldScore);
      if (!r.score) { matchedAll = false; break; }
      total += r.score;
      if (!best || (r.best && r.best.score > best.score)) best = r.best;
    }
    if (matchedAll) hits.push({ doc, score: total, best });
  }
  return hits.sort((a, b) => b.score - a.score || a.doc.display.localeCompare(b.doc.display));
}

/* ── OCR command lines ──────────────────────────────────────────────────────
   Recognition runs a binary the user already has, rather than shipping fifteen
   megabytes of model into a plugin that has to stay one file. Building the argv
   is shared with the speech feature — see lib/extcommand.js. */
const extcommand = require('./extcommand.js');
const OCR_PLACEHOLDER_IN = extcommand.PLACEHOLDER_IN;
const OCR_PLACEHOLDER_OUT = extcommand.PLACEHOLDER_OUT;
const tokenizeCommand = extcommand.tokenizeCommand;
const buildOcrCommand = extcommand.buildCommand;

/* Recognised text is noisy by nature: empty lines, single stray characters and
   runs of punctuation are what a page of handwriting produces where there was
   nothing to read. They would only pollute the index. */
function cleanOcrText(raw) {
  return String(raw == null ? '' : raw)
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 2 && /[\p{L}\p{N}]{2,}/u.test(line));
}

module.exports = {
  SKETCH_FIELDS, sketchDocument, scoreDocument, searchSketches,
  OCR_PLACEHOLDER_IN, OCR_PLACEHOLDER_OUT,
  tokenizeCommand, buildOcrCommand, cleanOcrText,
};
