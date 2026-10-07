'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · book capture flow
 *  The decisions the dialog makes, without the dialog: what a file may be
 *  called, whether the book is already there, which fields a fill may touch.
 * ========================================================================== */

const { toIsbn13 } = require('./ean13.js');
const tpl = require('./booktemplate.js');

function safeFileName(s, fallback = 'Untitled') {
  const cleaned = String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ')
    .trim().replace(/^\.+/, '').trim();
  const out = Array.from(cleaned).slice(0, 120).join('').replace(/[. ]+$/, '');
  return out || fallback;
}

function uniquePath(exists, folder, base, ext) {
  const dir = String(folder || '').replace(/\/+$/, '');
  const at = (name) => (dir ? dir + '/' : '') + name + '.' + ext;
  if (!exists(at(base))) return at(base);
  for (let n = 2; ; n++) if (!exists(at(base + ' (' + n + ')'))) return at(base + ' (' + n + ')');
}

/* An `exists` for uniquePath that counts a file name as taken when ANY file in
   the vault has it, ignoring case: `[[Dune.jpg]]` resolves by name, so a second
   Dune.jpg in another folder would make the link point at the wrong image. */
function nameTakenAnywhere(paths) {
  const names = new Set();
  for (const p of paths) names.add(String(p).slice(String(p).lastIndexOf('/') + 1).toLowerCase());
  return path => names.has(String(path).slice(String(path).lastIndexOf('/') + 1).toLowerCase());
}

function inFolder(path, folder) {
  const dir = String(folder || '').replace(/\/+$/, '');
  return !dir || path.startsWith(dir + '/');
}

function findDuplicates(files, frontmatterOf, folder, prop, isbn) {
  if (!prop) return [];
  const want = toIsbn13(isbn);
  if (!want) return [];
  return files.filter(f => {
    if (!inFolder(f.path, folder)) return false;
    const fm = frontmatterOf(f);
    if (!fm || fm[prop] == null) return false;
    return [].concat(fm[prop]).some(v => toIsbn13(v) === want);
  });
}

function profileForPath(profiles, path) {
  let best = -1, depth = -1;
  (profiles || []).forEach((p, i) => {
    const dir = String(p.folder || '').replace(/\/+$/, '');
    if (dir && path.startsWith(dir + '/') && dir.length > depth) { best = i; depth = dir.length; }
  });
  return best;
}

function isEmptyValue(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.every(isEmptyValue);
  return false;
}

/* What a fill may write: template keys the note lacks or has empty, with the
   value the template would have produced. Existing values are never touched.
   A `{…}` flow map is not understood here, so it is never proposed. */
function fillProposals(templateText, data, answers, noteFm) {
  const fm = noteFm || {};
  return tpl.frontmatterEntries(tpl.render(templateText, data, answers))
    .filter(e => !e.flowMap && isEmptyValue(fm[e.key]) && !isEmptyValue(e.value))
    .map(e => ({ key: e.key, value: e.value, quoted: e.quoted }));
}

/* The value a fill writes for one proposal, typed as create's YAML would read
   it: an unquoted all-digit value is a number, a quoted one stays text. The
   "\u0000cover" stand-in becomes the cover link, once that file exists. */
function fillValue(proposal, coverLink) {
  const one = (v, quoted) => {
    const t = String(v).replace('\u0000cover', coverLink || '');
    return !quoted && /^\d+$/.test(t) ? Number(t) : t;
  };
  const { value, quoted } = proposal;
  return Array.isArray(value) ? value.map((v, i) => one(v, Array.isArray(quoted) && quoted[i])) : one(value, quoted === true);
}

function fillAsks(templateText, noteFm) {
  const fm = noteFm || {};
  const seen = new Set(), out = [];
  for (const e of tpl.frontmatterEntries(templateText)) {
    if (!isEmptyValue(fm[e.key])) continue;
    for (const a of tpl.scan([].concat(e.value).join('\n')).asks)
      if (!seen.has(a.label)) { seen.add(a.label); out.push(a); }
  }
  return out;
}

function validateProfile(p, ctx) {
  const problems = [];
  if (!p.template) problems.push('No template chosen.');
  else if (!(ctx.isFile || ctx.exists)(p.template)) problems.push('Template "' + p.template + '" does not exist.');
  for (const [key, label] of [['folder', 'Folder'], ['coverFolder', 'Cover folder']])
    if (p[key] && !ctx.exists(p[key])) problems.push(label + ' "' + p[key] + '" does not exist.');
  if (ctx.templateText != null)
    for (const u of tpl.scan(ctx.templateText).unknown) problems.push('Unknown placeholder in the template: ' + u);
  return problems;
}

function canCreate(usesCover, chosenCover) {
  return !usesCover || !!chosenCover;
}

module.exports = { safeFileName, uniquePath, nameTakenAnywhere, findDuplicates, profileForPath, isEmptyValue,
  fillProposals, fillValue, fillAsks, validateProfile, canCreate };
