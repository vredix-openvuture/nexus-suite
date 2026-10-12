'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · capture
 *  What a scan, a drawing and a spoken note have in common once the vault is
 *  out of the way: a title, a moment in time, and a bag of words to search.
 *
 *  Everything here is pure. The hub's toolbar — search, sort, select — is the
 *  same code for all three tabs, so it is tested once against all three rather
 *  than three times against itself; a tab that drifts fails the loop in
 *  test/capture.html.
 * ========================================================================== */

const { stripFrontmatter } = require('./text.js');

const inkpages = require('./inkpages.js');

/* The three orders. `new` is the default: a capture hub is a place you come to
   for the thing you just made. */
const SORTS = [
  { id: 'new', label: 'Newest' },
  { id: 'old', label: 'Oldest' },
  { id: 'title', label: 'Title' },
];

/* Sidecars write `created: YYYY-MM-DD_HH:mm`; the older ones and Chatter's
   `recorded:` carry ISO. Date.parse reads the underscore form as NaN, and a
   moment() here would drag Obsidian into a file that has to stay pure — so
   both shapes are matched by hand. An explicit zone is left to the engine,
   because only it knows the offset. */
function parseStamp(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  if (/([Zz]|[+-]\d{2}:?\d{2})$/.test(s)) { const t = Date.parse(s); return isNaN(t) ? null : t; }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T_ ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
}

/* The preview line of a spoken note. A transcript has no title of its own, so
   the first thing that was said stands in for one. */
function firstLine(body) {
  for (const line of stripFrontmatter(body).split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t;
  }
  return '';
}

/* m:ss, and h:mm:ss once it earns the hour. */
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}

function tagList(value) {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  return value ? String(value).split(',').map(v => v.trim()).filter(Boolean) : [];
}

/* ── Ink ─────────────────────────────────────────────────────────────────────
   A capture is a sidecar note carrying `ink-source`. Excalidraw drawings are
   already taggable notes of their own and are only surfaced here, which is why
   they are opt-in and marked as a source rather than rewritten into one. */
function isInkCapture(fm, showExcalidraw) {
  if (!fm) return false;
  return !!fm['ink-source'] || (!!showExcalidraw && fm['excalidraw-plugin'] === 'parsed');
}

function inkItem(src) {
  const fm = src.frontmatter || {};
  const excalidraw = fm['excalidraw-plugin'] === 'parsed' && !fm['ink-source'];
  const source = excalidraw ? 'excalidraw' : String(fm['ink-source'] || '');
  const tags = tagList(fm.tags);
  const note = fm.note ? String(fm.note) : '';
  // A capture is a LIST of pages now. A single-attachment one has no ink-pages
  // and is read as a one-page list off ink-file/ink-thumb — derived, never
  // written back, so an old capture is not rewritten just for being looked at.
  const pages = inkpages.readPages(fm);
  const head = pages[0] || { file: '', thumb: '' };
  return {
    kind: 'ink', path: src.path, title: src.basename,
    stamp: parseStamp(fm.created) != null ? parseStamp(fm.created) : (src.ctime || 0),
    source, excalidraw, tags, note,
    pages, pageCount: pages.length,
    // Page one, which is what the tile shows and what a reader of the old
    // shape sees. `files` is every page and every cached render — the list a
    // delete or a move has to act on, not just the one attachment.
    file: head.file, thumb: head.thumb,
    files: inkpages.pageFiles(pages),
    sketch: fm[inkpages.SKETCH_KEY] ? String(fm[inkpages.SKETCH_KEY]) : '',
    search: [src.basename, source, note].concat(tags),
  };
}

/* ── Sketch ──────────────────────────────────────────────────────────────────
   Built on the search document the sketch index already produces, so the tile
   and the search box read the same fields — a second parse of the SVG would
   drift from it the first time either side changed.

   One item is a whole DRAWING, not a page. A note owns a list of sketch ids
   (see lib/notesketches.js) and those pages are one item: one name, one card
   in the hub. Listing them separately is what made a seven-page note read as
   seven drawings that each claimed to be a single page. How the card is drawn
   — notebook, sheet or stack — is sketchShape's answer below.

   `book` describes the owner and is absent for a loose sketch — one that no
   note names. Then the drawing is an item of one page.

     notePath  the note that owns the pages ('' when nothing does)
     noteName  its basename, used as the book's name when the sketch is unnamed
     paths     every page's sidecar, in page order — what a delete has to take
     pageDocs  the search documents of pages TWO and up, so a word written on
               page four still finds the book instead of nothing */
function sketchItem(doc, stat, book) {
  const fields = (doc && doc.fields) || {};
  const sections = fields.sections || [];
  const owner = book || null;
  const pagePaths = (owner && owner.paths && owner.paths.length) ? owner.paths.slice() : [doc.path];
  const laterPages = (owner && owner.pageDocs) || [];
  const search = [doc.display].concat(sections, fields.notes || [], fields.ocr || []);
  for (const page of laterPages) {
    const pf = page.fields || {};
    search.push(page.display);
    Array.prototype.push.apply(search, pf.sections || []);
    Array.prototype.push.apply(search, pf.notes || []);
    Array.prototype.push.apply(search, pf.ocr || []);
  }
  /* An unnamed sketch is better called by its note than by `sk-mf3k2a9x`: the
     id is not a name, it is an address. A title written into the sidecar always
     wins, because that one someone chose. */
  const title = doc.named ? doc.display : ((owner && owner.noteName) || doc.display);
  if (owner && owner.noteName) search.push(owner.noteName);
  return {
    kind: 'sketch',
    // Page one. It is the selection key, it carries the cover, and it is what
    // opening the book means.
    path: doc.path,
    paths: pagePaths,
    id: doc.id || '',
    title,
    // Whether that title was CHOSEN or merely borrowed from the note. Rename
    // opens on the chosen one, so confirming the dialog cannot quietly freeze
    // the note's name into the sidecar.
    named: !!doc.named,
    notePath: (owner && owner.notePath) || '',
    pages: pagePaths.length,
    stamp: (stat && (stat.mtime || stat.ctime)) || 0,
    cover: doc.cover || null,
    paperType: doc.paperType || 'endless',
    blank: !!doc.blank && laterPages.every(page => page.blank),
    search,
  };
}

/* How the hub draws a drawing. Only a note with several PAGES is a notebook;
   one page is paper — a pile of A4 sheets when it is sectioned (it is cut into
   pages, but they are one drawing), a single sheet when it is endless or a
   mindmap. */
function sketchShape(item) {
  if (item && item.pages > 1) return 'book';
  return item && item.paperType === 'sectioned' ? 'stack' : 'sheet';
}

/* "3 pages" — the one place a page count is turned into words, so nothing in
   the hub can phrase it differently. */
function pagesLabel(count) {
  const n = Math.max(1, Number(count) || 1);
  return n + (n === 1 ? ' page' : ' pages');
}

/* ── Chatter ─────────────────────────────────────────────────────────────────
   A spoken note is an ordinary note with `nexus-type: quicknote` — it stays
   readable and greppable without the plugin, which is the whole bargain. */
function isChatter(fm) { return !!fm && fm['nexus-type'] === 'quicknote'; }

function chatterItem(src) {
  const fm = src.frontmatter || {};
  const preview = firstLine(src.body);
  const seconds = Number(fm.seconds) || 0;
  const recorded = fm.recorded ? String(fm.recorded) : '';
  return {
    kind: 'chatter', path: src.path, title: src.basename,
    stamp: parseStamp(recorded) != null ? parseStamp(recorded) : (src.ctime || 0),
    recorded, seconds, duration: seconds ? formatDuration(seconds) : '',
    engine: fm.engine ? String(fm.engine) : '',
    preview, tags: tagList(fm.tags),
    search: [src.basename, preview, fm.engine || ''].concat(tagList(fm.tags)),
  };
}

/* The date under a title. Short on purpose: the tile is not a table. */
function shortDate(stamp) {
  if (!stamp) return '';
  const d = new Date(stamp);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* ── The toolbar's two verbs ─────────────────────────────────────────────────
   Every term has to hit something, so two words narrow instead of widen — the
   same rule the sketch search uses. The haystack carries the source and the
   tags, which is what makes typing "paper" or "journal" a filter and keeps the
   toolbar one row wide instead of growing a second control per tab. */
function matchesQuery(item, query) {
  const terms = String(query == null ? '' : query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  // A PRINTABLE separator. It has to be something no term can straddle — terms
  // are split on whitespace, so any non-space character does — and it has to
  // keep the file text: a NUL here makes grep treat capture.js as binary and
  // silently answer "no match" to every search of it.
  const hay = (item.search || []).map(v => String(v == null ? '' : v).toLowerCase()).join(' \u241f ');
  return terms.every(t => hay.indexOf(t) >= 0);
}

function filterItems(items, query) { return (items || []).filter(it => matchesQuery(it, query)); }

/* Path is the tiebreaker everywhere, so the order is stable and two runs over
   the same vault never disagree. */
function sortItems(items, mode) {
  const out = (items || []).slice();
  const byPath = (a, b) => String(a.path).localeCompare(String(b.path));
  if (mode === 'title') out.sort((a, b) => String(a.title).localeCompare(String(b.title)) || byPath(a, b));
  else if (mode === 'old') out.sort((a, b) => (a.stamp || 0) - (b.stamp || 0) || byPath(a, b));
  else out.sort((a, b) => (b.stamp || 0) - (a.stamp || 0) || byPath(a, b));
  return out;
}

/* ── Select mode ─────────────────────────────────────────────────────────────
   The tab owns the selection, not the toolbar: a set of paths from the Ink tab
   means nothing on the Sketch tab, and a bulk delete acting on the leftovers
   of another tab is the one mistake this must not be able to make. Hence
   setTab() clears and leaves select mode rather than the view remembering to. */
class CaptureSelection {
  constructor(tab) { this.tab = tab || ''; this.mode = false; this.paths = new Set(); }
  setTab(tab) {
    if (tab === this.tab) return false;
    this.tab = tab; this.paths.clear(); this.mode = false;
    return true;
  }
  enter() { this.mode = true; }
  exit() { this.mode = false; this.paths.clear(); }
  toggle(path) { if (this.paths.has(path)) this.paths.delete(path); else this.paths.add(path); return this.paths.has(path); }
  has(path) { return this.paths.has(path); }
  count() { return this.paths.size; }
  /* Only what is still on screen: a selected item that a search has filtered
     away must not be deleted by a button the user reads as "these four". */
  selected(items) { return (items || []).filter(it => this.paths.has(it.path)); }
  all(items) { (items || []).forEach(it => this.paths.add(it.path)); }
}

/* ── Moving a set of captures ────────────────────────────────────────────────
   A capture is never one file: the sidecar, the scan and, for a PDF, the
   cached page. Moving the note alone strands the picture, which is the exact
   failure the delete path already refuses to make — so a move plans over the
   SAME list delete names, and either takes a capture whole or leaves it. */
function normalizeFolder(folder) {
  return String(folder == null ? '' : folder).trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

function baseName(path) { const cut = String(path).lastIndexOf('/'); return cut < 0 ? String(path) : String(path).slice(cut + 1); }

function moveTarget(folder, path) {
  const dir = normalizeFolder(folder);
  return dir ? dir + '/' + baseName(path) : baseName(path);
}

/* `vault.files(item)` is the adapter's remove() list and `vault.exists(path)`
   asks the vault. Both injected, so the rule that decides what is safe to move
   is provable without one. A capture whose name is already taken at the target
   is reported by name and stays where it is — the rest still travel. */
function movePlan(items, folder, vault) {
  const files = vault.files, exists = vault.exists;
  const dir = normalizeFolder(folder);
  const moves = [], blocked = [];
  const claimed = new Set();
  for (const item of (items || [])) {
    const paths = [];
    for (const p of (files(item) || [])) if (p && paths.indexOf(p) < 0) paths.push(p);
    const planned = [];
    let clash = '';
    for (const from of paths) {
      const to = moveTarget(dir, from);
      if (to === from) continue;                       // already in the target folder
      if (exists(to) || claimed.has(to)) { clash = baseName(to); break; }
      planned.push({ item, from, to });
    }
    if (clash) { blocked.push({ title: item.title, reason: '“' + clash + '” is already there' }); continue; }
    planned.forEach(m => claimed.add(m.to));
    moves.push.apply(moves, planned);
  }
  return { folder: dir, moves, blocked };
}

/* The folder every selected capture already sits in, or '' when they disagree
   — what the picker opens with, so the common case is one keystroke. */
function commonFolder(paths) {
  let dir = null;
  for (const p of (paths || [])) {
    const cut = String(p).lastIndexOf('/');
    const here = cut < 0 ? '' : String(p).slice(0, cut);
    if (dir == null) dir = here;
    else if (dir !== here) return '';
  }
  return dir || '';
}

/* ── Read handwriting into the sidecar ───────────────────────────────────────
   The text goes into the note's BODY, not into frontmatter: a scan you can find
   with Obsidian's own search is worth far more than one only this plugin can
   find, and the body is where Obsidian looks. It is fenced by two markers so a
   second reading replaces the first instead of stacking, and so anything you
   wrote yourself underneath is never touched. */
const OCR_BEGIN = '%% nexus:ocr %%';
const OCR_END = '%% /nexus:ocr %%';

function ocrSection(lines) {
  const body = (lines || []).map(l => String(l).trim()).filter(Boolean).join('\n');
  if (!body) return '';
  return OCR_BEGIN + '\n## Read from the scan\n\n' + body + '\n' + OCR_END;
}

/* Returns the new note text, or null when nothing would change — so a caller
   can skip the write instead of touching the file's mtime for nothing. */
function withOcrSection(note, lines) {
  const source = String(note == null ? '' : note);
  const section = ocrSection(lines);
  const from = source.indexOf(OCR_BEGIN);
  const to = source.indexOf(OCR_END);
  const has = from >= 0 && to > from;
  if (has) {
    const before = source.slice(0, from);
    const after = source.slice(to + OCR_END.length);
    const next = section
      ? before + section + after
      : (before.replace(/\n+$/, '\n') + after.replace(/^\n+/, '')).replace(/\n{3,}/g, '\n\n');
    return next === source ? null : next;
  }
  if (!section) return null;
  return source.replace(/\s*$/, '') + '\n\n' + section + '\n';
}

function readOcrSection(note) {
  const source = String(note == null ? '' : note);
  const from = source.indexOf(OCR_BEGIN);
  const to = source.indexOf(OCR_END);
  if (!(from >= 0 && to > from)) return [];
  return source.slice(from + OCR_BEGIN.length, to)
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

module.exports = {
  SORTS, parseStamp, stripFrontmatter, firstLine, formatDuration, shortDate, tagList,
  isInkCapture, inkItem, sketchItem, sketchShape, pagesLabel, isChatter, chatterItem,
  matchesQuery, filterItems, sortItems, CaptureSelection,
  normalizeFolder, baseName, moveTarget, movePlan, commonFolder,
  OCR_BEGIN, OCR_END, ocrSection, withOcrSection, readOcrSection,
};
