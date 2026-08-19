'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · generic pickers
 *  Popup menu + icon picker (leaf UI modals).
 * ========================================================================== */

const { Modal, getIconIds, setIcon } = require('obsidian');

/* Card action menu rendered as a centered modal WINDOW (like the other config
   modals), while mirroring Obsidian's Menu API (addItem → setTitle/setIcon/
   setChecked/setDisabled/setWarning/onClick, addSeparator, showAtMouseEvent/
   showAtPosition) so it stays a drop-in replacement for `new Menu()`. Position
   args are ignored — the window is centered with a backdrop + close button. */
class NexusPopupMenu extends Modal {
  constructor(app, title) { super(app); this.title = title || ''; this.items = []; }
  addItem(cb) {
    const it = {
      title: '', icon: '', checked: false, disabled: false, warning: false, cb: null,
      setTitle(t) { this.title = t; return this; },
      setIcon(i) { this.icon = i; return this; },
      setChecked(b) { this.checked = b; return this; },
      setDisabled(b) { this.disabled = b; return this; },
      setWarning(b) { this.warning = b; return this; },
      onClick(fn) { this.cb = fn; return this; },
    };
    cb(it);
    this.items.push({ sep: false, it });
    return this;
  }
  addSeparator() { this.items.push({ sep: true }); return this; }
  showAtMouseEvent() { this.open(); return this; }
  showAtPosition() { this.open(); return this; }
  onOpen() {
    this.modalEl.addClass('nx-popmenu-modal');
    const c = this.contentEl;
    if (this.title) c.createEl('h3', { cls: 'nx-popmenu-modal-title', text: this.title });
    const list = c.createDiv('nx-popmenu-modal-list');
    for (const entry of this.items) {
      if (entry.sep) { list.createDiv('nx-popmenu-sep'); continue; }
      const it = entry.it;
      const row = list.createDiv('nx-popmenu-item' + (it.disabled ? ' is-disabled' : '') + (it.warning ? ' is-warning' : ''));
      const ic = row.createDiv('nx-popmenu-icon');
      if (it.icon) setIcon(ic, it.icon);
      row.createDiv({ cls: 'nx-popmenu-label', text: it.title });
      if (it.checked) setIcon(row.createDiv('nx-popmenu-check'), 'check');
      if (!it.disabled && it.cb) row.addEventListener('click', (e) => { this.close(); it.cb(e); });
    }
  }
  onClose() { this.contentEl.empty(); }
}

class NexusIconPickerModal extends Modal {
  constructor(app, current, onPick) { super(app); this.current = current; this.onPick = onPick; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-iconpicker');
    contentEl.createEl('h3', { text: 'Choose icon' });
    const search = contentEl.createEl('input', { cls: 'nx-iconpicker-search', attr: { type: 'text', placeholder: 'Search … (e.g. book, star, calendar)' } });
    const grid = contentEl.createDiv('nx-iconpicker-grid');
    const ids = (typeof getIconIds === 'function' ? getIconIds() : []);
    const norm = (id) => id.replace(/^lucide-/, '');
    const render = (q) => {
      grid.empty();
      const query = (q || '').toLowerCase().trim();
      let shown = 0;
      for (const id of ids) {
        const short = norm(id);
        if (query && !short.toLowerCase().includes(query)) continue;
        const cell = grid.createDiv('nx-iconpicker-cell' + (short === this.current ? ' is-current' : ''));
        setIcon(cell.createSpan(), id);
        cell.setAttribute('aria-label', short);
        cell.onclick = () => { this.onPick(short); this.close(); };
        if (++shown >= 500) break;
      }
      if (!shown) grid.createDiv({ cls: 'nx-iconpicker-empty', text: 'No matches.' });
    };
    search.addEventListener('input', () => render(search.value));
    render('');
    setTimeout(() => search.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

/* ── Scribble picker ─────────────────────────────────────────────────────────
   Shown when inserting a scribble block: start a blank one, or embed a drawing
   that already exists. Sidecars ARE standalone SVGs, so the thumbnails are just
   <img> — no parsing needed to show the grid. The alias title lives inside the
   SVG metadata, so it is read lazily per file and filled in when it arrives;
   the grid never waits for it. */
class NexusSketchPickerModal extends Modal {
  /* onPick(null) = blank pad · onPick({id}) = a saved sidecar ·
     onPick({note}) = a scribble note, embedded by link so it follows renames. */
  constructor(plugin, onPick, opts) {
    super(plugin.app);
    this.plugin = plugin; this.onPick = onPick; this.opts = opts || {}; this.titles = new Map();
  }

  /* The alias out of the <metadata> CDATA. A regex, not DOMParser: this runs
     once per sidecar and only needs one field out of a file that also carries
     every stroke. */
  _title(text) {
    const m = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text || '');
    if (!m) return '';
    try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return m[1]; }
  }

  onOpen() {
    this.modalEl.addClass('nx-skpick-modal');
    const c = this.contentEl;
    c.createEl('h3', { cls: 'nx-skpick-title', text: 'Insert a scribble block' });

    const blank = c.createDiv('nx-skpick-new');
    setIcon(blank.createDiv('nx-skpick-new-ic'), 'pencil-line');
    blank.createDiv({ cls: 'nx-skpick-new-lbl', text: this.opts.blankLabel || 'Blank sketch' });
    blank.createDiv({ cls: 'nx-skpick-new-sub', text: this.opts.blankSub || 'A fresh pad in this note' });
    blank.tabIndex = 0;
    const pickBlank = () => { this.close(); this.onPick(null); };
    blank.onclick = pickBlank;
    blank.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickBlank(); } };

    const files = this.plugin.app.vault.getFiles()
      .filter(f => f.extension === 'svg' && f.path.startsWith(this.plugin._sketchFolder() + '/'))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    /* Scribble notes are whole drawing PAGES, not sidecars — they get their own
       row, and go into the block as `note: [[…]]` rather than an id: the link
       is what survives renaming the note. Metadata cache only, no reads. */
    const scribbleNotes = this.plugin.app.vault.getMarkdownFiles()
      .filter(f => this.plugin._isScribbleNote((this.plugin.app.metadataCache.getFileCache(f) || {}).frontmatter))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    if (!files.length && !scribbleNotes.length) {
      c.createDiv({ cls: 'nx-skpick-empty', text: 'No drawings yet — the blank pad above is the way in.' });
      window.setTimeout(() => blank.focus(), 0);
      return;
    }

    if (scribbleNotes.length) {
      c.createDiv({ cls: 'nx-skpick-label', text: 'Scribble notes — embedded live, edits go both ways' });
      const row = c.createDiv('nx-skpick-notes');
      scribbleNotes.slice(0, 40).forEach(f => {
        const it = row.createDiv('nx-skpick-note');
        it.tabIndex = 0;
        setIcon(it.createDiv('nx-skpick-note-ic'), 'file-text');
        it.createDiv({ cls: 'nx-skpick-note-name', text: f.basename });
        const take = () => { this.close(); this.onPick({ note: f.basename }); };
        it.onclick = take;
        it.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); take(); } };
      });
    }

    if (!files.length) { window.setTimeout(() => blank.focus(), 0); return; }

    c.createDiv({ cls: 'nx-skpick-label', text: 'Or embed one you already have' });
    const search = c.createEl('input', { cls: 'nx-skpick-search',
      attr: { type: 'text', placeholder: 'Search by title, note or id…' } });
    const grid = c.createDiv('nx-skpick-grid');

    // The id reads `sketch-<note>-<tail>`; the note part is worth showing on its
    // own line, and it is all we have until the alias is read.
    const born = (base) => {
      const m = /^sketch-(.*)-[a-z0-9]{4}$/i.exec(base);
      return m ? m[1].replace(/-/g, ' ') : base;
    };
    const label = (f) => this.titles.get(f.path) || born(f.basename);

    const render = () => {
      const q = (search.value || '').toLowerCase().trim();
      grid.empty();
      const hits = files.filter(f => !q ||
        f.basename.toLowerCase().includes(q) || label(f).toLowerCase().includes(q));
      if (!hits.length) { grid.createDiv({ cls: 'nx-skpick-empty', text: 'Nothing matches.' }); return; }
      hits.slice(0, 120).forEach(f => {
        const card = grid.createDiv('nx-skpick-card');
        card.tabIndex = 0;
        const img = card.createEl('img', { cls: 'nx-skpick-thumb' });
        img.src = this.plugin.app.vault.getResourcePath(f);
        img.alt = '';
        card.createDiv({ cls: 'nx-skpick-name', text: label(f) });
        card.createDiv({ cls: 'nx-skpick-meta', text: f.basename });
        const take = () => { this.close(); this.onPick({ id: f.basename }); };
        card.onclick = take;
        card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); take(); } };
      });
    };
    search.addEventListener('input', render);
    render();
    window.setTimeout(() => blank.focus(), 0);

    // Aliases trickle in; re-render once they are all here rather than per file.
    Promise.all(files.slice(0, 200).map(f => this.plugin.app.vault.cachedRead(f)
      .then(t => { const t2 = this._title(t); if (t2) this.titles.set(f.path, t2); })
      .catch(() => {})))
      .then(() => { if (this.contentEl.isConnected && this.titles.size) render(); });
  }
  onClose() { this.contentEl.empty(); }
}

/* Callout colors are stored as "r, g, b" (Obsidian's --callout-color format,
   identical to eth-p Callout Manager). These convert to/from the hex a color
   picker speaks. Empty string = unset → inherit the theme default. */

module.exports = { NexusPopupMenu, NexusIconPickerModal, NexusSketchPickerModal };
