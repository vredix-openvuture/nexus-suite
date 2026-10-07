'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the note beside an ink capture
 *  The sidecar note every capture gets, and renaming it.
 *  Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { Notice, moment } = require('obsidian');
const { NexusInkTagModal } = require('../views/ink.js');
const { safeFileName, uniquePath } = require('../lib/vaultpaths.js');

class InkSidecar {
  async _makeInkSidecar(f, sourceId) {
    const origPath = f.path;   // vault.rename mutates f.path below — keep the pre-move path for the _inkPending check
    const dirPath = f.parent && f.parent.path && f.parent.path !== '/' ? f.parent.path + '/' : '';
    // One folder per capture (Inbox/<Source>/<name>/, note + raw file + any
    // thumbnail all flat inside it — no further "attachments" nesting, the
    // capture folder itself is already the unit of encapsulation) instead of
    // a flat list + shared attachments folder — the note is a "folder note"
    // (folder-notes plugin, storageLocation:
    // insideFolder, syncFolderName:true keeps folder+note names in sync on
    // rename automatically, hideFolderNote hides it from the expanded
    // listing) so opening the capture stays a single click/tap on the folder,
    // same ergonomics as a flat note list, while everything for one capture
    // lives together. Nothing else needed to change for this — the gallery/
    // rename/watcher code all already goes through ink-file's full stored
    // path or plain TFile references, never assumes flat co-location.
    // Captures are keyed by drop NAME + FORMAT: a drop matching an existing
    // capture's name AND attachment extension is a re-export of that capture
    // (→ update in place, further below); the same name in a DIFFERENT
    // format is a legitimately separate note (a Saber PDF and e.g. a PNG may
    // share a title), so it gets its own capture under a numbered variant of
    // the name ("<name> 1", "<name> 2", … — the folder-note convention needs
    // folder and sidecar to share the name, so duplicate plain names can't
    // coexist). The loop scans those name slots in order until it finds
    // either the matching-format capture to update or a free slot to create
    // in; slots occupied by non-capture folders/files are skipped the same
    // way as foreign-format captures.
    const ext = (f.extension || '').toLowerCase();
    // Button-triggered captures (camera/scan) are always NEW captures — never
    // updates. Their timestamped names make a collision with an existing
    // capture near-impossible anyway (same wall-clock second), but if one
    // happens, silently overwriting that capture's file would lose it;
    // uniquifying into the next free name slot instead is always safe.
    const isButtonCapture = this._inkPending.has(origPath);
    let sidecar = null, existingAtt = null, captureDir, sidecarPath;
    for (let i = 0; ; i++) {
      const name = f.basename + (i ? ' ' + i : '');
      captureDir = dirPath + name;
      sidecarPath = captureDir + '/' + name + '.md';
      const sc = this.app.vault.getAbstractFileByPath(sidecarPath);
      if (sc) {
        // Resolve this capture's attachment — frontmatter first, falling
        // back to the id-naming convention for the startup-scan window where
        // the metadataCache hasn't parsed the sidecar yet (exactly when
        // Syncthing-synced re-exports get discovered).
        const fm = ((this.app.metadataCache.getFileCache(sc) || {}).frontmatter || {});
        let att = fm['ink-file'] && this.app.vault.getAbstractFileByPath(fm['ink-file']);
        if (!att) {
          const dir = this.app.vault.getAbstractFileByPath(captureDir);
          att = ((dir && dir.children) || []).find((c) =>
            c.extension && /^ink-/.test(c.basename) && !c.basename.endsWith('.thumb'));
        }
        if (!isButtonCapture && att && att.extension.toLowerCase() === ext) { sidecar = sc; existingAtt = att; break; }
        continue;
      }
      if (!this.app.vault.getAbstractFileByPath(captureDir)) break;
    }
    if (!sidecar) {
      // Shrink oversized raster captures BEFORE they ever get embedded — a
      // multi-thousand-pixel, tens-of-MB image has no business in a "scan"
      // pipeline and is also the prime suspect for Live Preview rendering an
      // embed twice while it decodes such a huge file.
      await this._maybeDownscaleInkImage(f);
      await this._maybeCropInkSvg(f);
      if (!this.app.vault.getAbstractFileByPath(captureDir)) { try { await this.app.vault.createFolder(captureDir); } catch (e) {} }
      // Named after the id (not the display name) — that way the sidecar can
      // be freely renamed later without the image/note association ever
      // depending on matching filenames.
      const id = 'ink-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      // Flat inside the capture folder — no separate "attachments" subfolder.
      // The capture folder IS already the unit of encapsulation; nesting
      // further just adds a click for no benefit (see _onInkVaultCreate for
      // how the thumbnail's own 'create' event is kept from being mistaken
      // for a fresh capture, now that "parent folder named attachments" is no
      // longer a usable signal).
      const attPath = captureDir + '/' + id + '.' + f.extension;
      // Pre-register BEFORE renaming: at this exact moment the sidecar .md
      // doesn't exist yet (that happens further below), so if vault.rename
      // ever fires so much as a stray 'create' for the destination — some
      // adapters do this for cross-directory moves — the sibling-sidecar
      // check in _onInkVaultCreate would find nothing there yet and
      // misidentify the attachment as a genuinely new capture, recursing
      // into an ever-deeper nested folder, again and again, within the same
      // session (not just across restarts like the thumbnail case above).
      (this._inkSelfCreated || (this._inkSelfCreated = new Set())).add(attPath);
      await this.app.vault.rename(f, attPath);
      const attName = attPath.split('/').pop();
      const thumbPath = f.extension.toLowerCase() === 'pdf' ? await this._makeInkPdfThumb(attPath) : null;

      // created/updated use a compact local-time stamp ('YYYY-MM-DD_HH:mm')
      // — anything READING them must parse that format explicitly (see
      // _sortKey; Date.parse chokes on the underscore). No 'type' key: a
      // note IS an ink capture iff it has 'ink-source' — that's the marker
      // every consumer (gallery filter, nx-ink-note class, watcher sibling
      // fallback) checks.
      const stamp = moment().format('YYYY-MM-DD_HH:mm');
      const body = '---\n'
        + 'tags:\n  - scribble\n'
        + 'id: ' + id + '\n'
        + 'created: ' + stamp + '\n'
        + 'updated: ' + stamp + '\n'
        + 'ink-source: ' + sourceId + '\n'
        + 'ink-file: "' + attPath.replace(/"/g, '\\"') + '"\n'
        + (thumbPath ? 'ink-thumb: "' + thumbPath.replace(/"/g, '\\"') + '"\n' : '')
        + '---\n\n'
        + '![[' + attName + ']]\n';
      sidecar = await this.app.vault.create(sidecarPath, body);
    } else {
      // RE-EXPORT of this capture (same name AND format, matched above).
      // Previously any name collision silently did nothing, which stranded
      // the new file as an orphan next to the capture folder and left the
      // stored attachment + thumbnail stale. Instead, update the capture in
      // place: normalize the drop exactly like a fresh capture, copy its
      // bytes into the existing id-named attachment (path stays stable, so
      // the sidecar's embed + frontmatter keep working untouched), re-render
      // the cached thumbnail, then trash the now-redundant drop.
      await this._maybeDownscaleInkImage(f);
      await this._maybeCropInkSvg(f);
      const newBytes = await this.app.vault.readBinary(f);
      // Never replace a good attachment with an empty read — the stability
      // wait in _onInkVaultCreate should make this unreachable, but blanking
      // the stored capture is the one non-recoverable outcome here (happened
      // once at runtime before that wait existed).
      if (!newBytes || !newBytes.byteLength) {
        console.warn('[Nexus] ink re-export skipped (empty read): ' + origPath);
        return sidecar;
      }
      await this.app.vault.modifyBinary(existingAtt, newBytes);
      const thumbPath = ext === 'pdf' ? await this._makeInkPdfThumb(existingAtt.path) : null;
      await this.app.fileManager.processFrontMatter(sidecar, (fr) => {
        fr.updated = moment().format('YYYY-MM-DD_HH:mm');
        if (!thumbPath) return;
        fr['ink-thumb'] = thumbPath;   // heals a capture whose thumb failed at capture time, too
        // ink-thumb IS page one's thumb, so on a multi-page capture the healed
        // path has to reach the page list too or the two quietly disagree.
        const inkpages = require('../lib/inkpages.js');
        const pages = inkpages.readPages(fr);
        if (pages.length > 1) { pages[0].thumb = thumbPath; inkpages.writePages(fr, pages); }
      });
      // Trash (not delete) — respects the user's "deleted files" setting and
      // keeps the drop recoverable in case the new export wasn't intended.
      await this.app.fileManager.trashFile(f);
      new Notice('Ink capture updated: ' + sidecar.basename);
    }
    if (this._inkPending.has(origPath)) {
      this._inkPending.delete(origPath);
      if (this.settings.inkCapture.tagOnCapture) {
        const res = await new NexusInkTagModal(this.app, sidecar.basename).openAndGet();
        if (res) {
          await this.app.fileManager.processFrontMatter(sidecar, fr => {
            fr.tags = Array.from(new Set(['scribble', ...(res.tags || [])]));   // 'scribble' is the always-on capture tag
            if (res.note) fr.note = res.note;
          });
          if (res.name && res.name !== sidecar.basename) sidecar = await this._renameInkSidecar(sidecar, res.name);
        }
      }
    }
    return sidecar;
  }
  /* Renames the sidecar note only — the attachment keeps its id-based
     filename, so this never needs to touch (or trust) the image. */
  async _renameInkSidecar(file, name) {
    const dirPath = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.path + '/' : '';
    const slug = safeFileName(name, '');
    if (!slug || dirPath + slug + '.md' === file.path) return file;
    const dest = uniquePath(p => !!this.app.vault.getAbstractFileByPath(p), dirPath, slug, 'md');
    await this.app.fileManager.renameFile(file, dest);
    return this.app.vault.getAbstractFileByPath(dest) || file;
  }
}

module.exports = InkSidecar;
