'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · capture
 *  The two dialogs the capture hub grew: where a set of captures moves to, and
 *  what pages one capture is made of.
 * ========================================================================== */

const { Modal, setIcon } = require('obsidian');
const { nxAutocomplete, nxMultiRow } = require('../lib/inputs.js');
const capture = require('../lib/capture.js');
const inkpages = require('../lib/inkpages.js');

/* Where to. A plain field with the vault's folders behind it rather than a
   tree: the folder is usually one you already have, and typing three letters
   beats opening five twisties. Prefilled with the folder the selection is
   already in when they share one. */
class NexusMoveModal extends Modal {
  constructor(app, count, noun, folders, initial) {
    super(app);
    this.count = count; this.noun = noun || 'item';
    this.folders = folders || []; this.initial = initial || '';
    this.value = null;
  }
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-cap-move');
    contentEl.createEl('h3', { text: 'Move ' + this.count + ' ' + this.noun + (this.count === 1 ? '' : 's') });
    contentEl.createEl('p', {
      cls: 'nx-cap-move-hint',
      text: 'Everything each one is made of travels together — the note, the scan and any cached page.',
    });
    const input = contentEl.createEl('input', {
      cls: 'nx-input is-grow nx-cap-move-field', type: 'text', placeholder: 'Folder, e.g. Archive/Scans',
    });
    input.value = this.initial;
    nxAutocomplete(input, () => this.folders, () => {});
    const commit = () => { this.value = capture.normalizeFolder(input.value); this.close(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    const row = contentEl.createDiv('nx-cap-modal-bar');
    row.createEl('button', { cls: 'nx-btn', text: 'Cancel' }).onclick = () => this.close();
    row.createEl('button', { cls: 'nx-btn is-primary', text: 'Move' }).onclick = commit;
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); if (this._resolve) { this._resolve(this.value); this._resolve = null; } }
}

/* The pages of one capture: reorder, drop, add. Buttons and not drag-and-drop
   — this dialog has to work in a 280px sidebar with a stylus, where a drag is
   a scroll and a long-press is a context menu.
   Adding a page DOES copy the file in straight away, because a PDF has to be
   rendered before it can show a thumbnail here. Everything else waits for
   Save, and `added` is reported alongside the result so a Cancel can take the
   copies back out — a wrong tap must not leave files in the capture folder
   that nothing points at. */
class NexusInkPagesModal extends Modal {
  constructor(app, item, onAdd) {
    super(app);
    this.item = item;
    this.pages = (item.pages || []).map(p => ({ file: p.file, thumb: p.thumb }));
    this.onAdd = onAdd;
    this.value = null;
    this.added = [];
  }
  /* Resolves {pages, added}: `pages` is null when the dialog was cancelled,
     and `added` is every page it copied in, either way. */
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-cap-pages');
    contentEl.createEl('h3', { text: 'Pages — ' + this.item.title });
    this.listEl = contentEl.createDiv('nx-list nx-cap-pagelist');
    const add = contentEl.createEl('button', { cls: 'nx-btn nx-list-add nx-cap-pageadd' });
    setIcon(add.createSpan('nx-cap-btn-ic'), 'plus');
    add.createSpan({ text: 'Add a page' });
    add.onclick = () => this._add(add);
    const row = contentEl.createDiv('nx-cap-modal-bar');
    row.createEl('button', { cls: 'nx-btn', text: 'Cancel' }).onclick = () => this.close();
    row.createEl('button', { cls: 'nx-btn is-primary', text: 'Save' }).onclick = () => {
      this.value = this.pages.slice();
      this.close();
    };
    this._paint();
  }

  async _add(button) {
    if (!this.onAdd) return;
    button.toggleClass('is-disabled', true);
    try {
      const arrived = await this.onAdd();
      for (const page of (arrived || [])) {
        if (!page || !page.file) continue;
        this.added.push(page);
        if (!this.pages.some(p => p.file === page.file)) this.pages.push(page);
      }
      this._paint();
    } finally { button.toggleClass('is-disabled', false); }
  }

  _paint() {
    const list = this.listEl;
    list.empty();
    if (!this.pages.length) {
      list.createDiv({ cls: 'nx-cap-empty', text: 'No pages left — add one, or save and the capture keeps only its note.' });
      return;
    }
    this.pages.forEach((page, i) => {
      const row = list.createDiv('nx-row nx-cap-pagerow');
      const cover = row.createDiv('nx-cap-pagethumb');
      const shown = page.thumb || page.file;
      const file = shown && this.app.vault.getAbstractFileByPath(shown);
      if (file && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(shown)) {
        cover.style.backgroundImage = 'url("' + this.app.vault.getResourcePath(file).replace(/"/g, '\\"') + '")';
      } else setIcon(cover, 'file-text');
      const main = row.createDiv('nx-row-main nx-cap-pagemain');
      main.createDiv({ cls: 'nx-row-title', text: 'Page ' + (i + 1) });
      main.createDiv({ cls: 'nx-row-sub', text: capture.baseName(page.file) });
      const aside = row.createDiv('nx-row-aside nx-cap-pageacts');
      const btn = (icon, label, disabled, fn) => {
        const b = aside.createEl('button', { cls: 'nx-btn is-icon', attr: { 'aria-label': label } });
        setIcon(b, icon);
        b.toggleClass('is-disabled', disabled);
        if (!disabled) b.onclick = fn;
        return b;
      };
      btn('chevron-up', 'Move up', i === 0, () => { this.pages = inkpages.movePage(this.pages, i, i - 1); this._paint(); });
      btn('chevron-down', 'Move down', i === this.pages.length - 1, () => { this.pages = inkpages.movePage(this.pages, i, i + 1); this._paint(); });
      const drop = btn('trash-2', 'Drop this page', false, () => { this.pages = inkpages.dropPage(this.pages, i); this._paint(); });
      drop.addClass('is-danger');
    });
  }

  onClose() {
    this.contentEl.empty();
    if (this._resolve) { this._resolve({ pages: this.value, added: this.added }); this._resolve = null; }
  }
}

/* Tag dialog: shown right after a button-triggered scan (never for sidecars the
   inbox watcher creates on its own — see _onInkVaultCreate, which keeps the
   "just drop a file in" path free of popups) and from the hub's tag action. The
   tags field reuses the same nxMultiRow + autocomplete idiom as the
   property-filter tag fields elsewhere. Skip/Esc leaves tags empty — always
   addable later from the hub.
   With more than one thing selected the name and note fields are gone: they
   describe one capture, and writing the same name onto twenty is not an edit
   anybody meant to make. */
class NexusInkTagModal extends Modal {
  constructor(app, initialName, opts) {
    super(app);
    this.result = null; this._tagsStr = '';
    this.initialName = initialName || '';
    this.count = (opts && opts.count) || 1;
    this.noun = (opts && opts.noun) || 'scan';
  }
  _allTags() {
    const t = this.app.metadataCache.getTags ? this.app.metadataCache.getTags() : {};
    return Object.keys(t).map(x => x.replace(/^#/, '')).sort((a, b) => a.localeCompare(b));
  }
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }
  onOpen() {
    const { contentEl } = this;
    const many = this.count > 1;
    contentEl.createEl('h3', { text: many ? 'Tag ' + this.count + ' ' + this.noun + 's' : 'Tag this ' + this.noun });
    let nameInp = null, noteInp = null;
    if (!many) {
      nameInp = contentEl.createEl('input', { cls: 'nx-input is-grow', type: 'text', placeholder: 'Name (optional)' });
      nameInp.value = this.initialName;
    }
    nxMultiRow(contentEl, 'Tags', 'One tag per line', '', ',', 'e.g. journal', v => { this._tagsStr = v; }, () => this._allTags());
    if (!many) noteInp = contentEl.createEl('input', { cls: 'nx-input is-grow', type: 'text', placeholder: 'Short note (optional)' });
    const commit = () => {
      const tags = this._tagsStr.split(',').map(s => s.trim()).filter(Boolean);
      this.result = { tags, note: noteInp ? noteInp.value.trim() : '', name: nameInp ? nameInp.value.trim() : '' };
      this.close();
    };
    // Renaming the sidecar (see plugin._renameInkSidecar) never touches the
    // attachment — that keeps its own id-based filename, which is the whole
    // point of the id frontmatter: the display name stops being load-bearing.
    if (nameInp) nameInp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const firstTag = contentEl.querySelector('.nx-multirow-input');
      if (firstTag) firstTag.focus();
    });
    if (noteInp) noteInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    const row = contentEl.createDiv('nx-cap-modal-bar');
    const skip = row.createEl('button', { cls: 'nx-btn', text: 'Skip' });
    skip.onclick = () => this.close();
    const ok = row.createEl('button', { cls: 'nx-btn is-primary', text: 'Save' });
    ok.onclick = commit;
    window.setTimeout(() => { if (nameInp) { nameInp.focus(); nameInp.select(); } }, 0);
  }
  onClose() { this.contentEl.empty(); if (this._resolve) { this._resolve(this.result); this._resolve = null; } }
}

module.exports = { NexusInkTagModal, NexusMoveModal, NexusInkPagesModal };
