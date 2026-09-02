'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · ink pages
 *  A capture stops being one attachment.
 *
 *  Everything here is pure — no vault, no Obsidian — so the page list, its
 *  ordering and the migration off the single-attachment shape are provable in
 *  test/capture.html rather than only in a vault nobody can check out.
 *
 *  THE FRONTMATTER BARGAIN
 *    ink-file  / ink-thumb   always page ONE, exactly as before.
 *    ink-pages               the rest of the list, written only once there IS
 *                            a rest (length > 1).
 *  Both directions therefore degrade instead of breaking: a capture written
 *  before this file has no ink-pages and reads as a one-page capture without
 *  its frontmatter being touched, and a plugin version written before this
 *  file reads ink-file and shows page one rather than nothing.
 * ========================================================================== */

const objects = require('./sketchobjects.js');

const PAGES_KEY = 'ink-pages';
const FILE_KEY = 'ink-file';
const THUMB_KEY = 'ink-thumb';
const SKETCH_KEY = 'ink-sketch';

/* A page is always {file, thumb} with thumb '' when there is none — an
   optional key would make "the same list" compare unequal to itself after one
   round trip through the frontmatter. */
function page(file, thumb) {
  return { file: String(file == null ? '' : file), thumb: String(thumb == null ? '' : thumb) };
}

/* Hand-edited frontmatter is the normal case in a plain-text vault, so a page
   written as a bare path is accepted alongside the map form. */
function toPage(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry.trim() ? page(entry.trim(), '') : null;
  const file = String(entry.file || entry.path || '').trim();
  return file ? page(file, String(entry.thumb || '').trim()) : null;
}

function readPages(fm) {
  const front = fm || {};
  const list = Array.isArray(front[PAGES_KEY]) ? front[PAGES_KEY].map(toPage).filter(Boolean) : [];
  if (list.length) return list;
  const first = String(front[FILE_KEY] || '').trim();
  if (!first) return [];
  return [page(first, String(front[THUMB_KEY] || '').trim())];
}

/* The frontmatter a page list should be written as. `null` means "delete this
   key" — the caller hands the patch to processFrontMatter, and a capture that
   shrinks back to one page must lose ink-pages entirely rather than keep a
   one-element list nothing needs. */
function pagesPatch(pages) {
  const list = (pages || []).map(toPage).filter(Boolean);
  const head = list[0];
  const patch = {};
  patch[FILE_KEY] = head ? head.file : null;
  patch[THUMB_KEY] = head && head.thumb ? head.thumb : null;
  patch[PAGES_KEY] = list.length > 1
    ? list.map(p => (p.thumb ? { file: p.file, thumb: p.thumb } : { file: p.file }))
    : null;
  return patch;
}

/* Apply that patch to a frontmatter object in place — what a caller hands to
   processFrontMatter. A null in the patch is a key that has to GO, not a key
   set to nothing: a capture back down to one page must lose ink-pages, or the
   next reader sees a list where there is none. */
function writePages(fm, pages) {
  const patch = pagesPatch(pages);
  for (const key of Object.keys(patch)) {
    if (patch[key] == null) delete fm[key];
    else fm[key] = patch[key];
  }
  return fm;
}

/* Every file the pages are made of, in page order, thumb behind its page. No
   empties and no duplicates: a delete list that names the same path twice
   reports one file too many, and one that names '' trashes nothing loudly. */
function pageFiles(pages) {
  const out = [];
  for (const p of (pages || [])) {
    for (const path of [p && p.file, p && p.thumb]) {
      if (path && out.indexOf(path) < 0) out.push(path);
    }
  }
  return out;
}

/* Every file the WHOLE capture is made of: the note in front of its pages.
   This is what the Ink adapter's remove() returns, and it lives here rather
   than in the adapter so a delete list can be proved without a vault. */
function captureFiles(item) {
  return [item && item.path].concat(pageFiles(item && item.pages)).filter(Boolean);
}

function addPages(pages, more) {
  const list = (pages || []).map(toPage).filter(Boolean);
  const seen = new Set(list.map(p => p.file));
  for (const entry of (more || [])) {
    const p = toPage(entry);
    if (!p || seen.has(p.file)) continue;
    seen.add(p.file);
    list.push(p);
  }
  return list;
}

/* Move page `from` to index `to`, the way a reorder button reads: the page
   travels, the others close the gap. Out-of-range indices are a no-op rather
   than an exception — the buttons at the ends of the list are disabled, and a
   race that beats the disable must not corrupt the list. */
function movePage(pages, from, to) {
  const list = (pages || []).map(toPage).filter(Boolean);
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const moved = list.splice(from, 1)[0];
  list.splice(to, 0, moved);
  return list;
}

function dropPage(pages, i) {
  const list = (pages || []).map(toPage).filter(Boolean);
  if (i < 0 || i >= list.length) return list;
  list.splice(i, 1);
  return list;
}

/* After a move the files sit somewhere else, so the stored paths have to
   follow or the capture points at nothing. Paths the map does not mention are
   left exactly as they are. */
function remapPages(pages, map) {
  const at = (path) => (path && Object.prototype.hasOwnProperty.call(map || {}, path) ? map[path] : path);
  return (pages || []).map(toPage).filter(Boolean).map(p => page(at(p.file), at(p.thumb)));
}

/* The file names a note already embeds. Obsidian rewrites a link to whatever
   the vault's link format needs when a file moves, so after a Move the same
   page can read `![[Archive/ink-a.png]]` — matching on the exact text we wrote
   would then miss it and append a second copy. Only the base name is compared. */
function embedNames(note) {
  const out = [];
  const re = /!\[\[([^\]|#]+)/g;
  let m;
  while ((m = re.exec(String(note == null ? '' : note)))) out.push(m[1].trim().split('/').pop());
  return out;
}

function embedLine(name) {
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^[ \\t]*!\\[\\[(?:[^\\]|#]*\\/)?' + esc + '(?:[|#][^\\]]*)?\\]\\][ \\t]*\\r?\\n?', 'gm');
}

/* A capture's note embeds its own attachments, and that is what makes it
   readable in a vault with no plugin at all. So the body follows the page
   list both ways: a page that arrives is appended, a page that was dropped
   has its embed removed — its file is being trashed, and an embed of a
   trashed file is a broken image in the middle of the note.
   Only those two things change. An embed the user moved or captioned
   themselves stays exactly where they put it. */
function withPageEmbeds(note, keep, drop) {
  const before = String(note == null ? '' : note);
  let text = before;
  for (const name of (drop || [])) if (name) text = text.replace(embedLine(name), '');
  const have = new Set(embedNames(text));
  const missing = (keep || []).filter(n => n && !have.has(n));
  if (missing.length) text = text.replace(/\s*$/, '') + '\n\n' + missing.map(n => '![[' + n + ']]').join('\n') + '\n';
  return text === before ? null : text;
}

/* ── The annotated copy ──────────────────────────────────────────────────────
   Marking a capture writes a Quick Sketch sidecar whose first object IS the
   scan, and drops a block into the capture's note pointing at it. The block is
   fenced for the same reason the OCR section is: annotating twice must not
   stack two pads, and whatever you wrote under it is never touched. */
const MARK_BEGIN = '%% nexus:mark %%';
const MARK_END = '%% /nexus:mark %%';

function markSection(id) {
  return MARK_BEGIN + '\n```quicksketch\nid: ' + String(id) + '\n```\n' + MARK_END;
}

function withSketchBlock(note, id) {
  const source = String(note == null ? '' : note);
  const section = markSection(id);
  const from = source.indexOf(MARK_BEGIN);
  const to = source.indexOf(MARK_END);
  if (from >= 0 && to > from) {
    const next = source.slice(0, from) + section + source.slice(to + MARK_END.length);
    return next === source ? null : next;
  }
  return source.replace(/\s*$/, '') + '\n\n' + section + '\n';
}

function readSketchBlock(note) {
  const m = /%% nexus:mark %%[\s\S]*?id:\s*([^\s`]+)/.exec(String(note == null ? '' : note));
  return m ? m[1] : '';
}

/* ── The sketch a scan becomes ───────────────────────────────────────────────
   Written as text rather than by driving a surface: there is no DOM in the
   watcher's world and none in the tests either, and the sidecar is a plain
   file format. The metadata block is the one views/sketch.js reads back, so
   the pad opens the page exactly as it was written.

   The image is `locked`. See sketchobjects.objectAt: a locked object is not
   hit-testable, so a tap cannot pick the scan up and a lasso cannot catch it.
   Drawing on top is then just drawing. */
const SVGNS = 'http://www.w3.org/2000/svg';

function scanPage(naturalW, naturalH, maxW) {
  const w = Math.max(1, Math.round(Number(naturalW) || 0));
  const h = Math.max(1, Math.round(Number(naturalH) || 0));
  const cap = maxW || 1000;
  const scale = w > cap ? cap / w : 1;
  return { w: Math.round(w * scale), h: Math.max(1, Math.round(h * scale)) };
}

function scanSketchSVG(opts) {
  const o = opts || {};
  const size = scanPage(o.naturalW, o.naturalH, o.maxW);
  const image = { kind: 'image', x: 0, y: 0, w: size.w, h: size.h, href: String(o.href || ''), locked: true };
  const meta = JSON.stringify({
    v: 1, w: size.w, h: size.h, bg: '#ffffff', paper: 'white', paperStyle: false,
    bgType: 'none', bgSize: 40, bgOpacity: 0, bgColor: '#334155', autoGrow: false,
    title: o.title || undefined,
    objects: [image],
    strokes: [],
  });
  // A CDATA block ends at the first `]]>`; the same split views/sketch.js uses.
  const cdata = meta.split(']]>').join(']]]]><![CDATA[>');
  return '<svg xmlns="' + SVGNS + '" viewBox="0 0 ' + size.w + ' ' + size.h + '"'
    + ' width="' + size.w + '" height="' + size.h + '">'
    + '<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[' + cdata + ']]></nx-sketch></metadata>'
    + '<rect x="0" y="0" width="' + size.w + '" height="' + size.h + '" fill="#ffffff"/>'
    + objects.objectSVG(image)
    + '</svg>';
}

module.exports = {
  PAGES_KEY, FILE_KEY, THUMB_KEY, SKETCH_KEY,
  page, toPage, readPages, pagesPatch, writePages, pageFiles, captureFiles,
  addPages, movePage, dropPage, remapPages, embedNames, withPageEmbeds,
  MARK_BEGIN, MARK_END, withSketchBlock, readSketchBlock,
  scanPage, scanSketchSVG,
};
