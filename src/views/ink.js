'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · ink capture
 *  Ink-capture gallery view + tag modal.
 * ========================================================================== */

const { ItemView, Modal, moment, setIcon } = require('obsidian');
const { IMG_EXT, INK_VIEW } = require('../constants.js');
const { nxMultiRow } = require('../lib/inputs.js');

class NexusInkGalleryView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return INK_VIEW; }
  getDisplayText() { return 'Ink Capture'; }
  getIcon() { return 'camera'; }

  async onOpen() {
    this.render();
    this.registerEvent(this.app.metadataCache.on('changed', () => this._debounced()));
    this.registerEvent(this.app.vault.on('create', () => this._debounced()));
    this.registerEvent(this.app.vault.on('delete', () => this._debounced()));
    this.registerEvent(this.app.vault.on('rename', () => this._debounced()));
  }
  _debounced() { window.clearTimeout(this._t); this._t = window.setTimeout(() => this.render(), 400); }

  _captures() {
    const showExcalidraw = this.plugin.settings.inkCapture.excalidraw.enabled;
    return this.app.vault.getMarkdownFiles()
      .map(f => ({ f, fm: (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {} }))
      .filter(x => x.fm['ink-source'] || (showExcalidraw && x.fm['excalidraw-plugin'] === 'parsed'))
      .sort((a, b) => this._sortKey(b) - this._sortKey(a));
  }
  // created is 'YYYY-MM-DD_HH:mm' (older sidecars: ISO) — Date.parse can't
  // read the underscore format, so parse via moment with both formats.
  _sortKey(x) {
    const m = x.fm.created && moment(x.fm.created, ['YYYY-MM-DD_HH:mm', moment.ISO_8601], true);
    return m && m.isValid() ? m.valueOf() : x.f.stat.ctime;
  }

  _tile(grid, x) {
    const { f, fm } = x;
    const isExcalidraw = fm['excalidraw-plugin'] === 'parsed';
    const source = isExcalidraw ? 'excalidraw' : (fm['ink-source'] || '');
    const t = grid.createDiv('nx-ink-tile');
    const cov = t.createDiv('nx-ink-tile-cover');
    // ink-file holds the full vault path (attachment lives flat inside the
    // capture folder, alongside the sidecar note) — see plugin._makeInkSidecar.
    // ink-thumb (PDF only) is a cached page-1 render, generated once at
    // capture time by _makeInkPdfThumb.
    const imgFile = fm['ink-file'] && this.app.vault.getAbstractFileByPath(fm['ink-file']);
    const thumbFile = fm['ink-thumb'] && this.app.vault.getAbstractFileByPath(fm['ink-thumb']);
    if (thumbFile) {
      cov.style.setProperty('--img', 'url("' + this.app.vault.getResourcePath(thumbFile).replace(/"/g, '\\"') + '")');
    } else if (imgFile && IMG_EXT.includes(imgFile.extension.toLowerCase())) {
      cov.style.setProperty('--img', 'url("' + this.app.vault.getResourcePath(imgFile).replace(/"/g, '\\"') + '")');
    } else if (imgFile) {
      cov.addClass('is-pdf');
      setIcon(cov.createDiv('nx-ink-tile-icon'), 'file-text');
    } else if (isExcalidraw) {
      cov.addClass('is-excalidraw');
      setIcon(cov.createDiv('nx-ink-tile-icon'), 'pencil-ruler');
    } else {
      cov.addClass('is-missing');
    }
    if (source) cov.createDiv({ cls: 'nx-ink-tile-source', text: source });
    t.createDiv({ cls: 'nx-ink-tile-title', text: f.basename });
    const tagsWrap = t.createDiv('nx-ink-tile-tags');
    (Array.isArray(fm.tags) ? fm.tags : []).forEach(tag => tagsWrap.createSpan({ cls: 'nx-ink-tag-chip', text: String(tag) }));
    const editBtn = t.createDiv('nx-ink-tile-edit');
    setIcon(editBtn, 'tag');
    editBtn.setAttribute('aria-label', 'Edit tags');
    editBtn.onclick = (e) => { e.stopPropagation(); this._retag(f); };
    t.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
    return t;
  }

  async _retag(f) {
    const res = await new NexusInkTagModal(this.app, f.basename).openAndGet();
    if (!res) return;
    await this.app.fileManager.processFrontMatter(f, fr => {
      // Baseline tags survive any retag: 'scribble' marks every ink capture,
      // and 'excalidraw' is load-bearing for the excalidraw plugin's own
      // file recognition — replacing tags wholesale used to drop both.
      const keep = fr['ink-source'] ? ['scribble'] : (fr['excalidraw-plugin'] ? ['excalidraw'] : []);
      fr.tags = Array.from(new Set([...keep, ...(res.tags || [])]));
      if (res.note) fr.note = res.note;
    });
    if (res.name && res.name !== f.basename) await this.plugin._renameInkSidecar(f, res.name);
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-ink-gallery');
    const inner = root.createDiv('nx-ink-gallery-inner');
    const head = inner.createDiv('nx-ink-gallery-head');
    head.createEl('h2', { text: 'Ink Capture' });
    const cap = head.createEl('button', { cls: 'mod-cta', text: '+ Capture' });
    cap.onclick = () => this.plugin.captureScan();

    const items = this._captures();
    const grid = inner.createDiv('nx-ink-gallery-grid');
    if (!items.length) {
      grid.createDiv({ cls: 'nx-ink-gallery-empty', text: 'No scans yet — hit Capture to add your first one.' });
      return;
    }
    items.forEach(x => this._tile(grid, x));
  }
}

/* Ink Capture: tag dialog shown right after a button-triggered scan (never for
   sidecars the inbox watcher creates on its own — see _onInkVaultCreate, which
   keeps the "just drop a file in" path free of popups). Tags field reuses the
   same nxMultiRow + autocomplete idiom as the property-filter tag fields
   elsewhere. Skip/Esc leaves tags empty — always addable later from the gallery. */
class NexusInkTagModal extends Modal {
  constructor(app, initialName) { super(app); this.result = null; this._tagsStr = ''; this.initialName = initialName || ''; }
  _allTags() {
    const t = this.app.metadataCache.getTags ? this.app.metadataCache.getTags() : {};
    return Object.keys(t).map(x => x.replace(/^#/, '')).sort((a, b) => a.localeCompare(b));
  }
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Tag this scan' });
    const nameInp = contentEl.createEl('input', { type: 'text', placeholder: 'Name (optional)' });
    nameInp.value = this.initialName;
    nameInp.style.width = '100%'; nameInp.style.marginBottom = '10px';
    nxMultiRow(contentEl, 'Tags', 'One tag per line', '', ',', 'e.g. journal', v => { this._tagsStr = v; }, () => this._allTags());
    const noteInp = contentEl.createEl('input', { type: 'text', placeholder: 'Short note (optional)' });
    noteInp.style.width = '100%'; noteInp.style.marginTop = '10px';
    const commit = () => {
      const tags = this._tagsStr.split(',').map(s => s.trim()).filter(Boolean);
      this.result = { tags, note: noteInp.value.trim(), name: nameInp.value.trim() };
      this.close();
    };
    // Renaming the sidecar (see plugin._renameInkSidecar) never touches the
    // attachment — that keeps its own id-based filename, which is the whole
    // point of the id frontmatter: the display name stops being load-bearing.
    nameInp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const firstTag = contentEl.querySelector('.nx-multirow-input');
      if (firstTag) firstTag.focus();
    });
    noteInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    const row = contentEl.createDiv();
    row.style.marginTop = '14px'; row.style.textAlign = 'right';
    const skip = row.createEl('button', { text: 'Skip' });
    skip.onclick = () => this.close();
    const ok = row.createEl('button', { text: 'Save', cls: 'mod-cta' });
    ok.style.marginLeft = '8px';
    ok.onclick = commit;
    window.setTimeout(() => { nameInp.focus(); nameInp.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); if (this._resolve) { this._resolve(this.result); this._resolve = null; } }
}

/* Timer's done popup: its own window with the line "X-minute timer finished."
   and a (editable in edit mode) message below. If a break timer is set
   (pauseSec > 0), the window stays locked (no closing via OK/Esc/click-outside)
   until the break has elapsed. */

module.exports = { NexusInkGalleryView, NexusInkTagModal };
