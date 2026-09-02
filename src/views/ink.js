'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · ink capture
 *  The Ink tab of the capture hub — its adapter: which notes count as a
 *  capture, what a scan's tile shows, which files one is made of, and the
 *  verbs and card actions only a scan has.
 *
 *  The writes those actions perform live in lib/inkactions.js.
 *
 *  The gallery that used to live here IS the hub now (views/capturehub.js).
 *  What stayed behind is the part that is genuinely about ink: which notes
 *  count as a capture, what a scan's tile shows, and which files a capture is
 *  actually made of, because deleting or moving one has to take them along.
 * ========================================================================== */

const { setIcon } = require('obsidian');
const { IMG_EXT } = require('../constants.js');
const capture = require('../lib/capture.js');
const inkpages = require('../lib/inkpages.js');
const actions = require('../lib/inkactions.js');
const { NexusInkTagModal, NexusInkPagesModal } = require('../modals/capture.js');

/* The Ink adapter. See capturehub.js for the methods every tab answers. */
function inkAdapter(plugin) {
  const app = plugin.app;
  const fmOf = (f) => ((app.metadataCache.getFileCache(f) || {}).frontmatter || null);
  return {
    id: 'ink', label: 'Ink', icon: 'camera', layout: 'grid',
    one: 'scan', many: 'scans',
    empty: 'No scans yet — hit Capture to add your first one.',

    async list() {
      const showExcalidraw = !!(plugin.settings.inkCapture.excalidraw || {}).enabled;
      return app.vault.getMarkdownFiles()
        .filter(f => capture.isInkCapture(fmOf(f), showExcalidraw))
        .map(f => capture.inkItem({
          path: f.path, basename: f.basename,
          ctime: f.stat ? f.stat.ctime : 0, frontmatter: fmOf(f),
        }));
    },

    tile(item, card) {
      const cov = card.createDiv('nx-cap-cover');
      // The thumb (PDF only) is a page-1 render cached at capture time; the
      // file is the attachment itself. Either way this is PAGE ONE — whatever
      // order the pages were put in, the tile shows the top of the stack.
      const thumb = item.thumb && app.vault.getAbstractFileByPath(item.thumb);
      const img = item.file && app.vault.getAbstractFileByPath(item.file);
      const url = (f) => 'url("' + app.vault.getResourcePath(f).replace(/"/g, '\\"') + '")';
      if (thumb) cov.style.setProperty('--img', url(thumb));
      else if (img && IMG_EXT.includes(String(img.extension).toLowerCase())) cov.style.setProperty('--img', url(img));
      else if (img) { cov.addClass('is-glyph'); setIcon(cov.createDiv('nx-cap-cover-icon'), 'file-text'); }
      else if (item.excalidraw) { cov.addClass('is-glyph'); setIcon(cov.createDiv('nx-cap-cover-icon'), 'pencil-ruler'); }
      else cov.addClass('is-missing');
      if (item.source) cov.createDiv({ cls: 'nx-cap-badge', text: item.source });
      if (item.pageCount > 1) cov.createDiv({ cls: 'nx-cap-badge is-pages', text: item.pageCount + ' pages' });
      if (item.sketch) { const m = cov.createDiv('nx-cap-badge is-marked'); setIcon(m, 'pen-line'); m.setAttribute('aria-label', 'Annotated'); }
      card.createDiv({ cls: 'nx-cap-title', text: item.title });
      const tags = card.createDiv('nx-cap-chips');
      item.tags.forEach(t => tags.createSpan({ cls: 'nx-cap-chip', text: t }));
    },

    open(item) {
      const f = app.vault.getAbstractFileByPath(item.path);
      if (f) app.workspace.getLeaf(false).openFile(f);
    },

    /* Every file this capture is made of — the note and every page with its
       cached render. The sidecar alone would leave the scans behind as orphans
       nothing links to any more, and a move that took only the note would do
       the same thing without even calling it a delete. */
    remove(item) {
      const files = inkpages.captureFiles(item);
      // The annotated copy belongs to this capture — leaving it behind puts an
      // orphan on the Sketch tab whose "back to the note" points at a note in
      // the trash.
      if (item.sketch) files.push(plugin._sketchPath(item.sketch));
      return files;
    },

    /* Two verbs of its own. Reading is a bulk job — the difference between a
       folder of pictures and an archive you can search. Merging needs at least
       two, which is what `min` is for; the hub hides it below that rather than
       offering a button that cannot work. */
    verbs: [
      {
        id: 'ocr', label: 'Read', icon: 'scan-text', min: 1,
        available: () => plugin.ocrAvailable() && !!(plugin.settings.quicksketch.ocr || {}).command,
        async run(items, notice) {
          let done = 0, partial = 0;
          const failed = [];
          for (let i = 0; i < items.length; i++) {
            notice('Reading ' + (i + 1) + ' of ' + items.length + ' …');
            try {
              const res = await plugin.ocrInkCapture(items[i]);
              if (res.lines) done++;
              if (res.partial) partial++;
            } catch (err) {
              failed.push(items[i].title + ': ' + (err && err.message ? err.message : err));
            }
          }
          return { done, failed, note: partial ? partial + ' PDF' + (partial === 1 ? '' : 's') + ': first page only' : '' };
        },
      },
      {
        id: 'merge', label: 'Merge', icon: 'combine', min: 2,
        async run(items, notice) {
          notice('Merging ' + items.length + ' scans …');
          const res = await actions.mergeCaptures(plugin, items);
          return { done: res.done, failed: res.failed, note: 'one capture of ' + res.pages + ' pages' };
        },
      },
    ],

    /* renameFile rewrote the `![[ink-…]]` embeds; it cannot know that
       ink-file, ink-thumb and ink-pages are paths too. Without this a moved
       capture points at where its scans used to be. */
    async moved(moves) {
      const byNote = new Map();
      for (const { item, from, to } of moves) {
        if (!byNote.has(item.path)) byNote.set(item.path, { item, map: {} });
        byNote.get(item.path).map[from] = to;
      }
      for (const { item, map } of byNote.values()) {
        const notePath = map[item.path] || item.path;
        const note = app.vault.getAbstractFileByPath(notePath);
        if (!note) continue;
        await app.fileManager.processFrontMatter(note, fr =>
          inkpages.writePages(fr, inkpages.remapPages(item.pages, map)));
      }
    },

    /* On the tile, because both act on ONE capture and neither is worth
       entering select mode for. */
    quick(item) {
      // An excalidraw drawing is surfaced here, not owned here: giving it
      // ink-file or a pad of its own would turn it into something it is not.
      if (item.excalidraw) return [];
      return [
        { icon: 'pen-line', label: item.sketch ? 'Open the annotated copy' : 'Annotate this scan', run: () => actions.markCapture(plugin, item) },
        { icon: 'layers', label: 'Pages', run: async () => {
          const res = await new NexusInkPagesModal(app, item, async () => {
            const files = await actions.pickFiles('image/*,application/pdf');
            return files.length ? actions.addPagesFrom(plugin, item, files) : [];
          }).openAndGet();
          if (!res.pages) { await actions.discardPages(plugin, res.added); return res.added.length > 0; }
          await actions.savePages(plugin, item, res.pages);
          return true;
        } },
      ];
    },

    async retag(items) {
      const single = items.length === 1 ? items[0] : null;
      const res = await new NexusInkTagModal(app, single ? single.title : '', { count: items.length }).openAndGet();
      if (!res) return false;
      for (const item of items) {
        const f = app.vault.getAbstractFileByPath(item.path);
        if (!f) continue;
        await app.fileManager.processFrontMatter(f, fr => {
          // Baseline tags survive any retag: 'scribble' marks every ink
          // capture, and 'excalidraw' is load-bearing for the excalidraw
          // plugin's own file recognition — replacing tags wholesale dropped
          // both. A bulk retag ADDS instead of replacing, because one dialog
          // cannot know what the other twenty notes already carry.
          const keep = fr['ink-source'] ? ['scribble'] : (fr['excalidraw-plugin'] ? ['excalidraw'] : []);
          const base = single ? [] : capture.tagList(fr.tags);
          fr.tags = Array.from(new Set([].concat(keep, base, res.tags || [])));
          if (res.note && single) fr.note = res.note;
        });
      }
      if (single && res.name && res.name !== single.title) {
        const f = app.vault.getAbstractFileByPath(single.path);
        if (f) await plugin._renameInkSidecar(f, res.name);
      }
      return true;
    },
  };
}

module.exports = { inkAdapter, NexusInkTagModal };
