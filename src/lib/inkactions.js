'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · ink actions
 *  The four things you can do TO a capture that touch the vault: annotate it,
 *  give it a page, decide what pages it has, and fold several into one.
 *
 *  Split out of views/ink.js because that file answers a different question —
 *  what the Ink tab of the hub looks like. These four are the writes, and they
 *  are the part where getting it wrong costs a file, so they are driven
 *  directly against a fake vault in test/inkvault.html.
 * ========================================================================== */

const { Notice } = require('obsidian');
const { INK_EXT } = require('../constants.js');
const capture = require('./capture.js');
const inkpages = require('./inkpages.js');

/* An annotated page is a page, not an archive master. The scan is embedded as
   a data URI (see lib/sketchobjects for why it is never a path), so its bytes
   become the sketch's bytes — a 4000px camera photo would make a 12MB sidecar
   that has to be parsed on every render. */
const MARK_MAX_W = 1400;

/* A capture normally lives in a folder of its own, but a surfaced excalidraw
   drawing can sit at the vault root — where lastIndexOf('/') is -1 and the
   naive slice eats the first character of the name. */
function folderOf(path) { const cut = String(path).lastIndexOf('/'); return cut < 0 ? '' : String(path).slice(0, cut); }
function inFolder(dir, name) { return dir ? dir + '/' + name : name; }

function dataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('the image could not be read'));
    reader.readAsDataURL(blob);
  });
}

/* The scan as something a canvas can hold: its pixels and its true size. An
   image the engine cannot decode still gets embedded — at a portrait page,
   which is what a scan almost always is — rather than failing the whole
   annotation over a measurement. */
async function embedScan(app, file) {
  const bytes = await app.vault.readBinary(file);
  const ext = String(file.extension || 'png').toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/' + ext;
  let blob = new Blob([bytes], { type: mime });
  let naturalW = 0, naturalH = 0;
  try {
    const bitmap = await createImageBitmap(blob);
    naturalW = bitmap.width; naturalH = bitmap.height;
    if (naturalW > MARK_MAX_W && ext !== 'svg') {
      const scale = MARK_MAX_W / naturalW;
      const canvas = document.createElement('canvas');
      canvas.width = MARK_MAX_W;
      canvas.height = Math.max(1, Math.round(naturalH * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const smaller = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.86));
      if (smaller) blob = smaller;
    }
    bitmap.close();
  } catch (e) { /* undecodable here — embed the original bytes at a page shape */ }
  return { href: await dataUri(blob), naturalW: naturalW || 1000, naturalH: naturalH || 1414 };
}

/* ── Mark it ─────────────────────────────────────────────────────────────────
   The capture GAINS a sketch; it does not spawn a sibling note. A second note
   beside the first is two things to find, two to tag and two to delete, and
   the pair drifts apart the moment either is renamed. So: the sketch id goes
   into the capture's own frontmatter, the pad goes into its own body, and the
   pane opens with the note's path so its "back to the note" button works. Both
   directions therefore lead home. */
async function markCapture(plugin, item) {
  const app = plugin.app;
  // The pad IS Quick Sketch. With the module off, ensureSketchFolder() is a
  // no-op and the write would fail on a folder that does not exist — a
  // cryptic vault error for a switch the user can simply turn back on.
  if (!plugin.settings.quicksketch || plugin.settings.quicksketch.enabled === false) {
    throw new Error('annotating needs Quick Sketch — switch it on in the settings');
  }
  if (item.sketch && app.vault.getAbstractFileByPath(plugin._sketchPath(item.sketch))) {
    plugin.openSketchInSplit(item.sketch, 'tab', item.path);
    return false;   // nothing was written, so the hub has nothing to refresh
  }
  const page = item.pages[0];
  if (!page) throw new Error('this capture has no page to annotate');
  // A PDF has no image except the page-1 render cached at capture time. Say so
  // rather than annotating page one silently — the same limit the reader owns.
  const isPdf = /\.pdf$/i.test(page.file);
  const sourcePath = isPdf ? page.thumb : page.file;
  if (isPdf && !sourcePath) throw new Error('a PDF is annotated through its cached first page, and this one has none');
  const file = sourcePath && app.vault.getAbstractFileByPath(sourcePath);
  if (!file) throw new Error('the attachment is missing: ' + (sourcePath || 'none'));

  const scan = await embedScan(app, file);
  const id = 'ink-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await plugin.saveSketch(id, inkpages.scanSketchSVG({
    href: scan.href, naturalW: scan.naturalW, naturalH: scan.naturalH,
    maxW: MARK_MAX_W, title: item.title,
  }));
  const note = app.vault.getAbstractFileByPath(item.path);
  if (!note) throw new Error('the note is gone');
  await app.fileManager.processFrontMatter(note, fr => { fr[inkpages.SKETCH_KEY] = id; });
  const after = inkpages.withSketchBlock(await app.vault.read(note), id);
  if (after != null) await app.vault.modify(note, after);
  plugin._sketchDocs = null;   // the sketch index has a new document in it
  plugin.openSketchInSplit(id, 'tab', item.path);
  if (isPdf) new Notice('Nexus: only the cached first page of a PDF is on the canvas.');
  return true;
}

/* ── Pages ───────────────────────────────────────────────────────────────────
   Where a page comes from: an explicit act, never a guess. The folder watcher
   cannot tell three photos of one letter from three unrelated scans that
   landed in the same second, and un-merging is far harder than merging. */
function pickFiles(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = accept;
    let done = false;
    const settle = (files) => { if (!done) { done = true; resolve(files); } };
    input.onchange = () => settle(Array.from(input.files || []));
    // A cancelled dialog fires `cancel` on a modern shell and NOTHING on an
    // older one. Without both, the promise never settles and the button that
    // is waiting on it stays disabled for the life of the dialog.
    input.oncancel = () => settle([]);
    window.addEventListener('focus', () => window.setTimeout(() => settle([]), 400), { once: true });
    input.click();
  });
}

/* Copy dropped files into the capture's OWN folder under id-based names, the
   same convention _makeInkSidecar uses — the display name stays free to be
   renamed without any of this following it. */
async function addPagesFrom(plugin, item, files) {
  const app = plugin.app;
  const dir = folderOf(item.path);
  const out = [], skipped = [];
  for (const picked of files) {
    const ext = String((picked.name.split('.').pop() || 'png')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    // The picker's `accept` is a hint, not a filter — a phone happily offers a
    // .heic through `image/*`. Say which ones did not make it.
    if (!INK_EXT.includes(ext)) { skipped.push(picked.name); continue; }
    const id = 'ink-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const attPath = inFolder(dir, id + '.' + ext);
    // The watcher would otherwise see its own capture folder gain a file and
    // try to make a second capture out of it.
    (plugin._inkSelfCreated || (plugin._inkSelfCreated = new Set())).add(attPath);
    await app.vault.createBinary(attPath, await picked.arrayBuffer());
    const thumb = ext === 'pdf' ? await plugin._makeInkPdfThumb(attPath) : null;
    out.push(inkpages.page(attPath, thumb || ''));
  }
  if (skipped.length) new Notice('Nexus: not a page — ' + skipped.slice(0, 3).join(', '));
  return out;
}

/* Save whatever the dialog ended up with: the list into the frontmatter, the
   new embeds into the body, and the files of pages that were dropped into the
   trash — a page removed from the list but left on disk is an orphan nothing
   points at any more. */
async function savePages(plugin, item, pages) {
  const app = plugin.app;
  const note = app.vault.getAbstractFileByPath(item.path);
  if (!note) throw new Error('the note is gone');
  const kept = new Set(inkpages.pageFiles(pages));
  const dropped = inkpages.pageFiles(item.pages).filter(path => !kept.has(path));
  await app.fileManager.processFrontMatter(note, fr => inkpages.writePages(fr, pages));
  // The embeds move with the list: a dropped page's file is about to be
  // trashed, and leaving its embed behind puts a broken image in the note.
  const body = inkpages.withPageEmbeds(await app.vault.read(note),
    pages.map(p => capture.baseName(p.file)), dropped.map(capture.baseName));
  if (body != null) await app.vault.modify(note, body);
  for (const path of dropped) {
    const gone = app.vault.getAbstractFileByPath(path);
    if (gone) { try { await app.fileManager.trashFile(gone); } catch (e) { /* already gone is not an error */ } }
  }
}

/* A cancelled dialog has to take its copies back out: they were written so a
   PDF could be rendered into a thumbnail, and nothing points at them now. */
async function discardPages(plugin, pages) {
  for (const path of inkpages.pageFiles(pages)) {
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (file) { try { await plugin.app.fileManager.trashFile(file); } catch (e) { /* already gone */ } }
  }
}

/* ── Merge ───────────────────────────────────────────────────────────────────
   A burst of photos becomes one capture. The FIRST in the shown order survives
   and the rest hand over their pages; their files move into the survivor's
   folder first, so nothing is left pointing across a folder that is about to
   be empty. */
async function mergeCaptures(plugin, items) {
  const app = plugin.app;
  const head = items[0];
  const note = app.vault.getAbstractFileByPath(head.path);
  if (!note) throw new Error('the first capture is gone');
  // The survivor must be a real capture. Stamping ink-file onto a surfaced
  // excalidraw drawing would turn it into something it is not, and a
  // root-level survivor would scatter the others' attachments into the vault
  // root on the way.
  if (head.excalidraw) throw new Error('an excalidraw drawing cannot take pages — pick a scan first');
  const dir = folderOf(head.path);
  if (!dir) throw new Error('the first capture is not in a folder of its own');
  let pages = head.pages.slice();
  const absorbed = [];
  const failed = [];
  for (const other of items.slice(1)) {
    const source = app.vault.getAbstractFileByPath(other.path);
    if (!source) { failed.push(other.title + ': the note is gone'); continue; }
    // A drawing that is only SURFACED here has no pages to hand over, and
    // absorbing it would trash the note and keep nothing.
    if (!other.pages.length) { failed.push(other.title + ': it has no pages to hand over'); continue; }
    const map = {};
    try {
      for (const path of inkpages.pageFiles(other.pages)) {
        const file = app.vault.getAbstractFileByPath(path);
        if (!file) continue;
        let dest = inFolder(dir, capture.baseName(path)), n = 1;
        while (app.vault.getAbstractFileByPath(dest)) dest = inFolder(dir, n++ + '-' + capture.baseName(path));
        await app.fileManager.renameFile(file, dest);
        map[path] = dest;
      }
      // Repair the note we just moved the files out from BEFORE anything else
      // can throw. Until the survivor has taken them over, this note is the
      // only thing that knows where they went — and if the write below fails,
      // an absorbed capture that still points at its own pages is a capture,
      // while one pointing at their old paths is wreckage.
      await app.fileManager.processFrontMatter(source, fr =>
        inkpages.writePages(fr, inkpages.remapPages(other.pages, map)));
    } catch (err) { failed.push(other.title + ': ' + (err && err.message ? err.message : err)); continue; }
    pages = inkpages.addPages(pages, inkpages.remapPages(other.pages, map));
    absorbed.push({ item: other, file: source });
  }
  await app.fileManager.processFrontMatter(note, fr => inkpages.writePages(fr, pages));
  const body = inkpages.withPageEmbeds(await app.vault.read(note), pages.map(p => capture.baseName(p.file)), []);
  if (body != null) await app.vault.modify(note, body);
  for (const { item, file } of absorbed) {
    const folder = file.parent;
    try { await app.fileManager.trashFile(file); }
    catch (e) { failed.push(item.title + ': its note could not be moved to the trash'); continue; }
    // One folder per capture is the convention; an emptied one is litter.
    if (folder && folder.path !== dir && folder.children && folder.children.length === 0) {
      try { await app.fileManager.trashFile(folder); } catch (e) { /* leave it if it will not go */ }
    }
  }
  return { done: absorbed.length + 1, pages: pages.length, failed };
}

module.exports = { markCapture, pickFiles, addPagesFrom, savePages, discardPages, mergeCaptures, MARK_MAX_W };
