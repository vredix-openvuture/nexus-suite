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

/* Callout colors are stored as "r, g, b" (Obsidian's --callout-color format,
   identical to eth-p Callout Manager). These convert to/from the hex a color
   picker speaks. Empty string = unset → inherit the theme default. */

module.exports = { NexusPopupMenu, NexusIconPickerModal };
