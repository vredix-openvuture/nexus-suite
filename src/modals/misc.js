'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · misc
 *  Generic name-input modal.
 * ========================================================================== */

const { Modal, SuggestModal } = require('obsidian');
const { nxMultiRow } = require('../lib/inputs.js');

/* Small text prompt (e.g. for the filename). openAndGet() → Promise<string|null> */
class NexusNameModal extends Modal {
  /* `allowEmpty` = an empty field is an ANSWER, not a mistake — that is how a
     due date gets cleared. Without it an empty input falls back to the default,
     which would make "remove this value" impossible. */
  constructor(app, title, def, allowEmpty) {
    super(app);
    this.title = title; this.def = def; this.value = null; this.allowEmpty = !!allowEmpty;
  }
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    const inp = contentEl.createEl('input', { type: 'text' });
    inp.value = this.def || '';
    inp.style.width = '100%';
    const commit = () => { this.value = this.allowEmpty ? inp.value.trim() : (inp.value.trim() || this.def); this.close(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    const row = contentEl.createDiv();
    row.style.marginTop = '12px'; row.style.textAlign = 'right';
    const ok = row.createEl('button', { text: 'Save', cls: 'mod-cta' });
    ok.onclick = commit;
    window.setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); if (this._resolve) { this._resolve(this.value); this._resolve = null; } }
}

/* Yes/no prompt for destructive actions (orphan cleanup). openAndGet() →
   Promise<boolean>; closing without a choice counts as "no". */
class NexusConfirmModal extends Modal {
  constructor(app, title, body, confirmText) {
    super(app);
    this.title = title; this.body = body || '';
    this.confirmText = confirmText || 'Confirm';
    this.value = false;
  }
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-confirm');
    contentEl.createEl('h3', { text: this.title });
    if (this.body) contentEl.createEl('p', { cls: 'nx-confirm-body', text: this.body });
    const row = contentEl.createDiv('nx-confirm-bar');
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const ok = row.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    ok.onclick = () => { this.value = true; this.close(); };
    window.setTimeout(() => cancel.focus(), 0);
  }
  onClose() { this.contentEl.empty(); if (this._resolve) { this._resolve(this.value); this._resolve = null; } }
}

/* Ink Capture: tag dialog shown right after a button-triggered scan (never for
   sidecars the inbox watcher creates on its own — see _onInkVaultCreate, which
   keeps the "just drop a file in" path free of popups). Tags field reuses the
   same nxMultiRow + autocomplete idiom as the property-filter tag fields
   elsewhere. Skip/Esc leaves tags empty — always addable later from the gallery. */

/* Pick one entry out of a list of strings (note paths, mostly). A plain
   SuggestModal so it behaves like Obsidian's own quick switcher — typing
   filters, Enter picks, Esc cancels. */
class NexusNamePickModal extends SuggestModal {
  constructor(app, placeholder, items, onPick) {
    super(app);
    this.items = items || [];
    this.onPick = onPick;
    this.setPlaceholder(placeholder || 'Pick one');
  }
  getSuggestions(q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return this.items.slice(0, 200);
    return this.items.filter(x => x.toLowerCase().includes(s)).slice(0, 200);
  }
  renderSuggestion(item, el) {
    // File name big, folder small — the same shape the quick switcher uses, so
    // two notes with the same name stay tellable apart.
    const cut = item.lastIndexOf('/');
    el.createDiv({ cls: 'nx-pick-name', text: (cut < 0 ? item : item.slice(cut + 1)).replace(/\.md$/, '') });
    if (cut > 0) el.createDiv({ cls: 'nx-pick-path', text: item.slice(0, cut) });
  }
  onChooseSuggestion(item) { this.onPick(item); }
}

module.exports = { NexusConfirmModal, NexusNameModal, NexusNamePickModal };
