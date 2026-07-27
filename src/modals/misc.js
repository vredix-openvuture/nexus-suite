'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · misc
 *  Generic name-input modal.
 * ========================================================================== */

const { Modal } = require('obsidian');
const { nxMultiRow } = require('../lib/inputs.js');

/* Small text prompt (e.g. for the filename). openAndGet() → Promise<string|null> */
class NexusNameModal extends Modal {
  constructor(app, title, def) { super(app); this.title = title; this.def = def; this.value = null; }
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    const inp = contentEl.createEl('input', { type: 'text' });
    inp.value = this.def || '';
    inp.style.width = '100%';
    const commit = () => { this.value = inp.value.trim() || this.def; this.close(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    const row = contentEl.createDiv();
    row.style.marginTop = '12px'; row.style.textAlign = 'right';
    const ok = row.createEl('button', { text: 'Save', cls: 'mod-cta' });
    ok.onclick = commit;
    window.setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); if (this._resolve) { this._resolve(this.value); this._resolve = null; } }
}

/* Ink Capture: tag dialog shown right after a button-triggered scan (never for
   sidecars the inbox watcher creates on its own — see _onInkVaultCreate, which
   keeps the "just drop a file in" path free of popups). Tags field reuses the
   same nxMultiRow + autocomplete idiom as the property-filter tag fields
   elsewhere. Skip/Esc leaves tags empty — always addable later from the gallery. */

module.exports = { NexusNameModal };
