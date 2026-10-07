'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the pages of a note's drawing
 *  A note used to own ONE sketch. It owns a list now — pages you swipe between
 *  in the Sketch tab, kept in the note's frontmatter:
 *
 *      sketch: [sk-a1b2, sk-c3d4]
 *
 *  A plain string is still valid and reads as a one-page list, so nothing
 *  written before this needs migrating. The order in the list IS the page
 *  order; ids are opaque and never re-numbered, because a page number that
 *  moves when you delete another page is a page number nobody can cite.
 * ========================================================================== */

const { emptySketchSVG } = require('../views/sketch.js');

function newId() {
  return 'sk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* The ids a note names, in page order. Anything that is not a usable id — an
   empty string, a stray null from a hand-edited list — is dropped rather than
   turned into a page that opens on nothing. */
function idsOf(frontmatter) {
  const raw = frontmatter ? frontmatter.sketch : null;
  const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
  const out = [];
  for (const entry of list) {
    const id = String(entry == null ? '' : entry).trim();
    if (id && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

function idsOfFile(app, file) {
  if (!file || file.extension !== 'md') return [];
  return idsOf((app.metadataCache.getFileCache(file) || {}).frontmatter);
}

/* A one-page note keeps a plain string; more than one is a list. Writing
   `sketch: [sk-a]` for a single page would rewrite every existing note the
   first time it is opened, and a diff full of that hides the real changes. */
function writeIds(frontmatter, ids) {
  if (!ids.length) delete frontmatter.sketch;
  else if (ids.length === 1) frontmatter.sketch = ids[0];
  else frontmatter.sketch = ids.slice();
}

/* The page that comes after `id`, or null at the end. Also used to decide when
   a forward swipe should make a new page instead of turning to one. */
function nextId(ids, id) {
  const at = ids.indexOf(id);
  return (at >= 0 && at + 1 < ids.length) ? ids[at + 1] : null;
}
function prevId(ids, id) {
  const at = ids.indexOf(id);
  return at > 0 ? ids[at - 1] : null;
}
function pageOf(ids, id) {
  const at = ids.indexOf(id);
  return at < 0 ? 0 : at + 1;
}

/* Add one empty page to a note and return its id. The sidecar is written here
   as well, so the tab that opens next always finds a file. `presets` is the look
   of the page it follows — see views/sketch.js · sketchPresets. */
async function addPage(plugin, file, saveSketch, presets) {
  const app = plugin.app;
  let id = newId();
  await app.fileManager.processFrontMatter(file, fm => {
    const ids = idsOf(fm);
    // A second call before the metadata cache caught up would otherwise append
    // an id the first call already added under a different name.
    if (ids.indexOf(id) < 0) ids.push(id);
    writeIds(fm, ids);
  });
  await saveSketch(id, emptySketchSVG(presets));
  return id;
}

/* Take a page out of the note's list. The .svg is NOT deleted — a drawing is
   worth more than the line that pointed at it, and the sketch folder is where
   it can still be found. */
async function removePage(plugin, file, id) {
  await plugin.app.fileManager.processFrontMatter(file, fm => {
    writeIds(fm, idsOf(fm).filter(x => x !== id));
  });
}

/* ── The way back: which note owns a page ────────────────────────────────────
   Only the forward direction is stored — a note names its pages — so finding
   the owner of a drawing means reading every note's frontmatter once. The
   capture hub needs it for every tile it draws, which is why this returns the
   WHOLE map in one sweep rather than answering one id at a time.

   The entry carries the note's full page list, so a caller that has an id also
   has the book it is a page of: how many pages, in what order, and which files
   they are. Without that the hub could only ever say "one page". */
function ownerIndex(app) {
  const out = new Map();
  const files = (app && app.vault && app.vault.getMarkdownFiles) ? app.vault.getMarkdownFiles() : [];
  for (const file of files) {
    const ids = idsOfFile(app, file);
    if (!ids.length) continue;
    for (let i = 0; i < ids.length; i++) {
      /* The first note to claim an id keeps it. Two notes naming the same page
         is a hand-edit, not a state the plugin can produce, and answering with
         the same one every time beats answering with whichever the vault
         happened to list last. */
      if (out.has(ids[i])) continue;
      out.set(ids[i], { path: file.path, basename: file.basename, ids: ids, pages: ids.length, page: i + 1 });
    }
  }
  return out;
}

module.exports = { newId, idsOf, idsOfFile, writeIds, nextId, prevId, pageOf, addPage, removePage, ownerIndex };
