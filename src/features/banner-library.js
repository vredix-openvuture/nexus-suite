'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the banner library
 *  Where banner images live: groups, import, rename, and dragging a banner
 *  into position. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { MarkdownView, Notice, moment, setIcon } = require('obsidian');
const { NexusBannerImportModal } = require('../modals/banner.js');
const { IMG_EXT, NX_MODULES } = require('../constants.js');
const { safeFileName, uniquePath } = require('../lib/vaultpaths.js');

class BannerLibrary {

  /* ---- Banner groups ------------------------------------------------------
     A group IS a subfolder of the banner folder — no parallel bookkeeping in
     data.json that could drift out of sync with the vault. Sorting images in
     the file explorer regroups them, and every move/rename goes through
     fileManager.renameFile so the [[banner]] links in notes follow along. */
  bannerRoot() { return (this.settings.banner.folder || '').trim().replace(/^\/|\/$/g, ''); }
  bannerImages() {
    const root = this.bannerRoot();
    return this.app.vault.getFiles()
      .filter(f => IMG_EXT.includes(f.extension.toLowerCase()) && (!root || f.path.startsWith(root + '/')));
  }
  /* Group of an image, relative to the banner root. '' = directly in the root. */
  bannerGroupOf(file) {
    const root = this.bannerRoot();
    const dir = (file.parent && file.parent.path) || '';
    if (!root) return '';
    return dir === root ? '' : dir.slice(root.length + 1);
  }
  /* All groups — read off the folder tree, so empty ones stay listed too. */
  bannerGroups() {
    const root = this.bannerRoot();
    if (!root) return [];
    const out = new Set();
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (!f || !f.children || !f.path) continue;                       // folders only
      if (f.path !== root && f.path.startsWith(root + '/')) out.add(f.path.slice(root.length + 1));
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }
  /* Folder path of a group, created on demand. '' → the banner root itself. */
  async ensureBannerGroup(name) {
    const root = this.bannerRoot();
    const rel = String(name || '').trim().replace(/^\/|\/$/g, '');
    const path = rel ? (root ? root + '/' + rel : rel) : root;
    if (path && !this.app.vault.getAbstractFileByPath(path)) {
      try { await this.app.vault.createFolder(path); } catch (e) {}
    }
    return path;
  }
  async moveBannerToGroup(file, group) {
    const dir = await this.ensureBannerGroup(group);
    const dest = (dir ? dir + '/' : '') + file.name;
    if (dest === file.path) return true;
    if (this.app.vault.getAbstractFileByPath(dest)) {
      new Notice('Nexus: "' + file.name + '" already exists in that group.');
      return false;
    }
    await this.app.fileManager.renameFile(file, dest);
    return true;
  }
  /* Every image in a group INCLUDING its subgroups — what a delete would take
     with it, so the count in the confirm and the rescue loop agree. */
  bannerGroupImages(rel) {
    return this.bannerImages().filter(f => {
      const g = this.bannerGroupOf(f);
      return g === rel || g.startsWith(rel + '/');
    });
  }
  async renameBannerGroup(oldRel, newRel) {
    const root = this.bannerRoot();
    if (!root) return false;
    const from = this.app.vault.getAbstractFileByPath(root + '/' + oldRel);
    const to = (String(newRel || '').trim().replace(/^\/|\/$/g, ''));
    if (!from || !to || to === oldRel) return false;
    if (this.app.vault.getAbstractFileByPath(root + '/' + to)) {
      new Notice('Nexus: group "' + to + '" already exists.');
      return false;
    }
    await this.app.fileManager.renameFile(from, root + '/' + to);
    if (this.settings.banner.defaultGroup === oldRel) { this.settings.banner.defaultGroup = to; await this.saveSettings(); }
    return true;
  }
  /* Dissolve a group: its images move back to the banner root (links follow),
     then the now-empty folder goes to the trash. Never deletes an image. */
  async deleteBannerGroup(rel) {
    const root = this.bannerRoot();
    if (!root) return false;
    const folder = this.app.vault.getAbstractFileByPath(root + '/' + rel);
    if (!folder) return false;
    // Subgroups included — otherwise trashing the folder would take nested
    // images with it, and "no image is deleted" would be a lie.
    for (const img of this.bannerGroupImages(rel)) {
      try { await this.moveBannerToGroup(img, ''); } catch (e) {}
    }
    try { await this.app.fileManager.trashFile(folder); } catch (e) {}
    const def = this.settings.banner.defaultGroup;
    if (def === rel || (def || '').startsWith(rel + '/')) { this.settings.banner.defaultGroup = ''; await this.saveSettings(); }
    return true;
  }
  /* Filename for an imported banner. Tokens: {{name}} (original filename),
     {{note}}, {{date}}, {{time}}. Anything else is taken literally. */
  bannerFileName(origName, noteFile) {
    const tpl = String(this.settings.banner.nameTemplate || '{{name}}').trim() || '{{name}}';
    const now = moment();
    return tpl
      .replace(/\{\{\s*name\s*\}\}/gi, origName)
      .replace(/\{\{\s*note\s*\}\}/gi, (noteFile && noteFile.basename) || '')
      .replace(/\{\{\s*date\s*\}\}/gi, now.format('YYYY-MM-DD'))
      .replace(/\{\{\s*time\s*\}\}/gi, now.format('HH-mm'))
      .trim() || origName;
  }

  /* Choose an image via the system file dialog, copy it into the chosen banner
     group and set it as the banner. */
  /* Pick a file from the system, name it, drop it into a banner group.
     Returns the created TFile (null when cancelled) — the caller decides what
     it is FOR: a note banner, or an image separator. */
  importBannerImage(noteFile) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      // A cancelled file dialog fires no event at all — resolve on the window
      // regaining focus instead, so the caller is never left hanging.
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      input.onchange = async () => {
        try {
          const f = input.files && input.files[0];
          if (!f) { finish(null); return; }
          const ext = ((f.name.split('.').pop() || 'png').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'png';
          const origName = f.name.replace(/\.[^.]+$/, '');
          const picked = await new NexusBannerImportModal(this, this.bannerFileName(origName, noteFile)).openAndGet();
          if (!picked) { finish(null); return; }
          const dir = await this.ensureBannerGroup(picked.group);
          const dest = uniquePath(p => !!this.app.vault.getAbstractFileByPath(p), dir, safeFileName(picked.name.trim() || origName, 'Banner'), ext);
          finish(await this.app.vault.createBinary(dest, await f.arrayBuffer()));
        } catch (e) {
          new Notice(NX_MODULES.banner.name + ': import failed (' + e.message + ')');
          finish(null);
        }
      };
      input.click();
    });
  }
  async importBannerFromSystem(noteFile) {
    const img = await this.importBannerImage(noteFile);
    if (!img) return;
    await this.app.fileManager.processFrontMatter(noteFile, fm => {
      fm.banner = '[[' + this.app.metadataCache.fileToLinktext(img, noteFile.path) + ']]';
    });
    this.refreshBanner();
    new Notice('Banner set: ' + img.path);
  }

  /* Move the banner image vertically by dragging (→ banner-y-pct). */
  async startBannerDrag(file) {
    // Prefer the ACTIVE (visible) view — the same file can be open in several
    // leaves, and grabbing a background copy would build the overlay off-screen.
    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file !== file) {
      view = this.app.workspace.getLeavesOfType('markdown')
        .map(l => l.view).find(v => (v instanceof MarkdownView) && v.file === file && v.contentEl.offsetParent !== null);
    }
    if (!view) return;
    const el = view.contentEl;
    if (!el.classList.contains('nx-has-banner')) { new Notice('Nexus: Set a banner first.'); return; }
    const stale = el.querySelector('.nx-banner-drag'); if (stale) stale.remove();   // was: return (a stale overlay blocked re-opening)

    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    const src = this.resolveBannerSrc(fm.banner, file.path);
    const tabs = view.containerEl.closest('.workspace-tabs');
    const bar = tabs && tabs.querySelector(':scope > .workspace-tab-header-container');
    const behind = el.classList.contains('nx-banner-behind');
    const barH = behind && bar ? bar.getBoundingClientRect().height : 0;
    let height = Number(fm['banner-height']) || this.settings.banner.height;

    // Load the image dimensions → clamp limit (don't drag past the image edge)
    let scaledH = 0, cardW = 0;
    await new Promise(res => {
      const im = new Image();
      im.onload = () => {
        cardW = ((el.querySelector('.cm-editor') || el).clientWidth) || 800;
        scaledH = cardW * (im.naturalHeight / im.naturalWidth);
        res();
      };
      im.onerror = res;
      im.src = src;
    });
    // Available pan range in px, AT THIS (fixed-during-the-drag) pane width —
    // cardW doesn't change mid-drag, so plain px is accurate for the live
    // preview; only converted to a %-of-range on save (finish(), below), so it
    // stays correct when the note is later viewed at a different pane width.
    const availRange = () => Math.max(0, scaledH - (barH + height));
    const minOff = () => (scaledH ? Math.min(0, -(scaledH - (barH + height))) : -4000);

    // Reconstruct the starting px offset from the saved percentage, measured
    // fresh at the CURRENT width (not whatever width it was last saved at).
    const startPct = Number(fm['banner-y-pct']) || 0;
    let offset = -(startPct / 100) * availRange();
    const setPos = (v) => {
      el.style.setProperty('--nx-banner-pos-y', v + 'px');
      if (bar) bar.style.setProperty('--nx-banner-pos-y', v + 'px');
    };

    const overlay = el.createDiv('nx-banner-drag');
    const applyHeight = () => {
      el.style.setProperty('--nx-banner-height', height + 'px');
      // cardW is fixed for the duration of this drag (only the height handle
      // and the vertical pan move, the window itself isn't being resized) →
      // this aspect-ratio IS the exact final value once banner-ref-w=cardW
      // gets saved, so there's no visual jump when the drag ends.
      el.style.setProperty('--nx-banner-ar', String(cardW / height));
      overlay.style.height = (barH + height) + 'px';
    };
    applyHeight();
    overlay.createDiv({ cls: 'nx-banner-drag-hint', text: '↕ Area = move · bottom = height' });
    const done = overlay.createDiv('nx-banner-drag-done');
    setIcon(done, 'check');
    done.setAttribute('aria-label', 'Done');
    const resizeH = overlay.createDiv('nx-banner-resize');

    let mode = null, startY = 0, startOffset = 0, startHeight = 0;
    const onMove = (e) => {
      if (mode === 'pos') {
        offset = Math.max(minOff(), Math.min(0, startOffset + (e.clientY - startY)));
        setPos(offset);
      } else if (mode === 'size') {
        height = Math.max(80, Math.min(900, startHeight + (e.clientY - startY)));
        applyHeight();
        offset = Math.max(minOff(), offset);  // keep the position within the valid range
        setPos(offset);
      }
    };
    const finish = async () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();   // removes the overlay's own pointer listeners with it
      const ar = availRange();
      const posPct = ar > 0 ? Math.min(100, Math.max(0, (-offset / ar) * 100)) : 0;
      await this.app.fileManager.processFrontMatter(file, f => {
        f['banner-height'] = Math.round(height);   // overrides the settings value
        f['banner-ref-w'] = Math.round(cardW);      // pane width this crop was calibrated at
        f['banner-y-pct'] = Math.round(posPct * 100) / 100;
        delete f['banner-y'];   // superseded by banner-y-pct (width-independent)
      });
      this.refreshBanner();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(); } };

    // POINTER events (mouse + TOUCH + pen) — the old mouse-only handlers never
    // fired for touch, so dragging/resizing did nothing on the tablet. Pointer
    // capture on the overlay keeps move/up flowing even for touch (which
    // implicitly captures to the pointerdown target).
    overlay.style.touchAction = 'none';
    const inDone = (t) => t === done || done.contains(t);
    const inResize = (t) => t === resizeH || resizeH.contains(t);
    overlay.addEventListener('pointerdown', (e) => {
      if (inDone(e.target)) { e.preventDefault(); e.stopPropagation(); finish(); return; }
      mode = inResize(e.target) ? 'size' : 'pos';
      startY = e.clientY;
      if (mode === 'size') startHeight = height; else startOffset = offset;
      try { overlay.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', () => { mode = null; });
    overlay.addEventListener('pointercancel', () => { mode = null; });
    document.addEventListener('keydown', onKey);
  }
}

module.exports = BannerLibrary;
