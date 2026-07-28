'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · tag rename / merge
 *  One dialog for both: typing an existing tag name turns the rename into a
 *  merge, which is exactly what it is — no separate "merge" flow to pick.
 * ========================================================================== */

const { Modal, Notice, SuggestModal } = require('obsidian');
const { nxAllTagCounts, nxFilesWithTag, nxRenameTag } = require('../lib/tagtools.js');
const { nxAutocomplete } = require('../lib/inputs.js');

class NexusTagRenameModal extends Modal {
  constructor(plugin, tag, onDone) {
    super(plugin.app);
    this.plugin = plugin;
    this.tag = String(tag || '').replace(/^#/, '');
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-tagren');
    contentEl.createEl('h3', { text: 'Rename tag' });

    const counts = nxAllTagCounts(this.app);
    const files = nxFilesWithTag(this.app, this.tag);
    contentEl.createEl('p', { cls: 'setting-item-description',
      text: '#' + this.tag + ' — ' + files.length + ' note(s), nested tags included.' });

    const inp = contentEl.createEl('input', { cls: 'nx-tagren-input', attr: { type: 'text' } });
    inp.value = this.tag;
    const hint = contentEl.createDiv('nx-tagren-hint');
    const known = [...counts.keys()].sort((a, b) => a.localeCompare(b));

    const paint = () => {
      const v = inp.value.trim().replace(/^#/, '');
      if (!v) { hint.setText('Empty name — use "Delete tag" instead.'); hint.addClass('is-warn'); return; }
      if (v === this.tag) { hint.setText('Unchanged.'); hint.removeClass('is-warn'); return; }
      if (counts.has(v)) {
        hint.setText('#' + v + ' already exists (' + counts.get(v) + ' use(s)) — this MERGES both tags.');
        hint.addClass('is-warn');
      } else { hint.setText('New name: #' + v); hint.removeClass('is-warn'); }
    };
    inp.addEventListener('input', paint);
    nxAutocomplete(inp, () => known, () => paint());
    paint();

    const run = async () => {
      const v = inp.value.trim().replace(/^#/, '');
      if (!v || v === this.tag) { this.close(); return; }
      this.close();
      new Notice('Nexus: renaming #' + this.tag + ' …');
      const n = await nxRenameTag(this.plugin, this.tag, v);
      new Notice('Nexus: #' + this.tag + ' → #' + v + ' in ' + n + ' note(s).');
      if (this.onDone) this.onDone();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });

    const bar = contentEl.createDiv('nx-tagren-bar');
    bar.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    bar.createEl('button', { text: 'Rename', cls: 'mod-cta' }).onclick = run;
    window.setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); }
}

/* Pick a tag first (for the command, where there is no tag under the cursor). */
class NexusTagPickModal extends SuggestModal {
  constructor(plugin, tags, onPick) {
    super(plugin.app);
    this.tags = tags; this.onPick = onPick;
    this.setPlaceholder('Which tag?');
  }
  getSuggestions(q) {
    const s = q.trim().toLowerCase().replace(/^#/, '');
    return s ? this.tags.filter(t => t.toLowerCase().includes(s)) : this.tags;
  }
  renderSuggestion(t, el) { el.setText('#' + t); }
  onChooseSuggestion(t) { this.onPick(t); }
}

module.exports = { NexusTagRenameModal, NexusTagPickModal };
