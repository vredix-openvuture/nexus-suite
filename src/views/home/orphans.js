'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · the orphan finder
 *  The card that lists files nothing links to, with its reference index.
 *  Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { Notice, setIcon } = require('obsidian');
const { NexusOrphanConfigModal } = require('../../modals/cards.js');
const { KIND_ICON, nxBuildRefIndex, nxCanvasRefs, nxFormatSize, nxKindOf } = require('../../lib/orphans.js');
const { NexusConfirmModal } = require('../../modals/misc.js');
const { NexusPopupMenu } = require('../../modals/pickers.js');

class HomeOrphans {
  /* ---- Orphan finder ------------------------------------------------------
     Unreferenced files: attachments nothing embeds, notes nothing links to.
     The "referenced" index is built once per render and shared by all orphan
     cards (see render(), which clears _refCache). ---- */
  _refIndex(useFm) {
    const key = useFm ? 'fm' : 'raw';
    this._refCache = this._refCache || {};
    if (!this._refCache[key]) this._refCache[key] = nxBuildRefIndex(this.app, { frontmatter: useFm, plugin: this.plugin });
    return this._refCache[key];
  }
  /* Canvas index: async, so the first paint runs without it and re-renders as
     soon as the boards are read. Returns null while still building. */
  _canvasRefs() {
    if (this._canvasIdx) return this._canvasIdx;
    if (!this._canvasBuilding) {
      this._canvasBuilding = true;
      nxCanvasRefs(this.app)
        .then(set => { this._canvasIdx = set; })
        .catch(() => { this._canvasIdx = new Set(); })
        .then(() => {
          this._canvasBuilding = false;
          // The view may have been closed while we were reading — don't paint
          // into a detached element.
          if (this.contentEl && this.contentEl.isConnected) this.render();
        });
    }
    return null;
  }
  /* Note candidates: tag/frontmatter state + include/exclude rules. */
  _orphanNoteMatch(f, item) {
    const tags = this._fileTags(f);
    const tagState = item.tagState || 'any';
    if (tagState === 'none' && tags.length) return false;
    if (tagState === 'some' && !tags.length) return false;
    if (tagState !== 'none') {
      if (String(item.tags || '').trim() && !this._tagMatch(f, this._expandTokens(item.tags))) return false;
      if (String(item.tagsNot || '').trim() && this._tagMatch(f, this._expandTokens(item.tagsNot))) return false;
    }
    const keys = Object.keys(this._fm(f)).filter(k => k !== 'position');
    const fmState = item.fmState || 'any';
    if (fmState === 'none' && keys.length) return false;
    if (fmState === 'some' && !keys.length) return false;
    if (fmState !== 'none') {
      const yes = item.propGroups, no = item.propGroupsNot;
      if (Array.isArray(yes) && yes.length && !this._propGroupsMatch(f, yes)) return false;
      if (Array.isArray(no) && no.length && this._propGroupsMatch(f, no)) return false;
    }
    const name = this._expandTokens(item.name).trim().toLowerCase();
    if (name && !f.basename.toLowerCase().includes(name)) return false;
    return true;
  }
  /* → { files (capped by the limit), total, bytes, pending } */
  _orphanFiles(item) {
    const kinds = (Array.isArray(item.kinds) && item.kinds.length) ? item.kinds : ['image'];
    const clean = (s) => this._expandTokens(s).split(',').map(x => x.trim().replace(/^\/|\/$/g, '')).filter(Boolean);
    const inc = clean(item.folders), exc = clean(item.exclude);
    const refs = this._refIndex(item.countFrontmatter !== false);
    const canvas = (item.countCanvas !== false) ? this._canvasRefs() : new Set();
    const links = this.app.metadataCache.resolvedLinks || {};
    const hits = [];
    let bytes = 0;
    for (const f of this.app.vault.getFiles()) {
      const kind = nxKindOf(f);
      if (!kinds.includes(kind)) continue;
      if (inc.length && !inc.some(p => f.path === p || f.path.startsWith(p + '/'))) continue;
      if (exc.length && exc.some(p => f.path === p || f.path.startsWith(p + '/'))) continue;
      if (refs.has(f.path)) continue;
      if (canvas && canvas.has(f.path)) continue;
      if (kind === 'note') {
        if (!this._orphanNoteMatch(f, item)) continue;
        if (item.mode === 'isolated') {
          const out = links[f.path] || {};
          if (Object.keys(out).some(d => d !== f.path)) continue;
        }
      }
      hits.push(f);
      bytes += (f.stat && f.stat.size) || 0;
    }
    // cmp is always ascending; the direction just multiplies (asc = A→Z /
    // smallest first, matching the labels in the config modal).
    const dir = item.sortDir === 'asc' ? 1 : -1;
    const sort = item.sort || 'size';
    let cmp;
    if (sort === 'name') cmp = (a, b) => a.basename.localeCompare(b.basename);
    else if (sort === 'path') cmp = (a, b) => a.path.localeCompare(b.path);
    else if (sort === 'created') cmp = (a, b) => a.stat.ctime - b.stat.ctime;
    else if (sort === 'modified') cmp = (a, b) => a.stat.mtime - b.stat.mtime;
    else cmp = (a, b) => a.stat.size - b.stat.size;
    hits.sort((a, b) => dir * cmp(a, b));
    const limit = item.count > 0 ? item.count : 25;
    return { files: hits.slice(0, limit), total: hits.length, bytes, pending: canvas === null };
  }
  _wOrphans(card, item) {
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || 'unlink');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Orphans' });
    const res = this._orphanFiles(item);
    head.createSpan({ cls: 'nx-home-card-count', text: String(res.total) });
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusOrphanConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-orph-body');
    if (!res.total) {
      this._empty(body, res.pending ? 'Reading canvas boards …' : 'Nothing orphaned — everything is linked.');
      return;
    }
    const parts = [res.total + (res.total === 1 ? ' file' : ' files'), nxFormatSize(res.bytes)];
    if (res.files.length < res.total) parts.push('showing ' + res.files.length);
    if (res.pending) parts.push('canvas boards still loading …');
    body.createDiv({ cls: 'nx-orph-sum', text: parts.join(' · ') });
    if ((item.display || 'list') === 'grid') {
      const gal = body.createDiv('nx-orph-grid');
      res.files.forEach(f => this._orphanTile(gal, f, item));
    } else {
      res.files.forEach(f => this._orphanRow(body, f, item));
    }
  }
  _orphanRow(body, f, item) {
    const kind = nxKindOf(f);
    const row = body.createDiv('nx-home-item nx-orph-item');
    setIcon(row.createSpan('nx-orph-icon'), KIND_ICON[kind] || 'file');
    const text = row.createDiv('nx-orph-text');
    text.createDiv({ cls: 'nx-home-item-title', text: kind === 'note' ? f.basename : f.name });
    if (item.showPath !== false) {
      const dir = f.parent && f.parent.path && f.parent.path !== '/' ? f.parent.path : '/';
      text.createDiv({ cls: 'nx-orph-path', text: dir });
    }
    row.createSpan({ cls: 'nx-home-item-sub', text: nxFormatSize((f.stat && f.stat.size) || 0) });
    row.onclick = () => this._open(f);
    row.oncontextmenu = (e) => { e.preventDefault(); this._orphanMenu(e, f); };
    const more = row.createSpan('nx-orph-more');
    setIcon(more, 'more-horizontal');
    more.setAttribute('aria-label', 'Actions');
    more.onclick = (e) => { e.stopPropagation(); this._orphanMenu(e, f); };
  }
  _orphanTile(gal, f, item) {
    const kind = nxKindOf(f);
    const tile = gal.createDiv('nx-orph-tile');
    const thumb = tile.createDiv('nx-orph-thumb');
    if (kind === 'image') {
      thumb.addClass('has-img');
      thumb.style.setProperty('--img', 'url("' + this.app.vault.getResourcePath(f).replace(/"/g, '\\"') + '")');
    } else {
      setIcon(thumb.createSpan('nx-orph-thumb-icon'), KIND_ICON[kind] || 'file');
    }
    tile.createDiv({ cls: 'nx-orph-tile-name', text: kind === 'note' ? f.basename : f.name });
    tile.createDiv({ cls: 'nx-orph-tile-sub', text: nxFormatSize((f.stat && f.stat.size) || 0) });
    tile.setAttribute('aria-label', f.path);
    tile.onclick = () => this._open(f);
    tile.oncontextmenu = (e) => { e.preventDefault(); this._orphanMenu(e, f); };
  }
  _orphanMenu(evt, f) {
    const menu = new NexusPopupMenu(this.app, f.name);
    menu.addItem(i => i.setTitle('Open').setIcon('file').onClick(() => this._open(f)));
    menu.addItem(i => i.setTitle('Open in new tab').setIcon('layout')
      .onClick(() => this.app.workspace.getLeaf('tab').openFile(f)));
    menu.addItem(i => i.setTitle('Copy path').setIcon('copy').onClick(async () => {
      try { await navigator.clipboard.writeText(f.path); new Notice('Path copied.'); }
      catch (e) { new Notice('Nexus: clipboard unavailable.'); }
    }));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Move to trash').setIcon('trash-2').setWarning(true).onClick(async () => {
      const ok = await new NexusConfirmModal(this.app, 'Move to trash?',
        f.path + ' (' + nxFormatSize((f.stat && f.stat.size) || 0) + ')\n' +
        'Goes wherever your "Deleted files" setting points.', 'Move to trash').openAndGet();
      if (!ok) return;
      try { await this.app.fileManager.trashFile(f); new Notice('Moved to trash: ' + f.name); }
      catch (e) { new Notice('Nexus: could not delete ' + f.name); }
      this.render();
    }));
    menu.showAtMouseEvent(evt);
  }
}

module.exports = HomeOrphans;
