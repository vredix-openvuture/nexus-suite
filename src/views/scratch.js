'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · scratch panel
 *  An empty surface in the sidebar that writes the note by itself.
 *
 *  The same writer as the dashboard card (lib/scratch.js), and deliberately
 *  the same two settings: where it puts the note and which template it fills.
 *  What differs is that the panel is always there — the point of it is that
 *  nothing has to be opened before you can type.
 * ========================================================================== */

const { ItemView, Notice, setIcon } = require('obsidian');
const { SCRATCH_VIEW } = require('../constants.js');
const scratch = require('../lib/scratch.js');

class NexusScratchView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return SCRATCH_VIEW; }
  getDisplayText() { return 'Scratch'; }
  getIcon() { return 'pencil-line'; }

  /* Its own two settings, per device: which folder you jot into is a thing about
     this machine, not about the vault. */
  cfg() {
    const stored = this.plugin.deviceSetting('scratchPanel', null);
    return stored && typeof stored === 'object' ? stored : { folder: '', template: '' };
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-scratch-view');

    const area = root.createEl('textarea', { cls: 'nx-scratch-input nx-scratch-pane' });
    area.placeholder = 'Write. It becomes a note.';

    const bar = root.createDiv('nx-scratch-bar');
    const hint = bar.createSpan({ cls: 'nx-scratch-hint', text: '' });
    const gear = bar.createEl('button', { cls: 'nx-btn is-sm is-icon is-quiet' });
    setIcon(gear, 'settings-2');
    gear.setAttribute('aria-label', 'Where these notes go');
    const save = bar.createEl('button', { cls: 'nx-btn is-primary nx-scratch-save', text: 'Save' });

    /* The two settings live here rather than in the settings dialog: they are
       per device, and this is the only place you are when you care about them.
       Folded away, because you set them once. */
    const panel = root.createDiv('nx-scratch-cfg');
    panel.hidden = true;
    gear.onclick = () => { panel.hidden = !panel.hidden; gear.toggleClass('is-active', !panel.hidden); };
    const field = (label, key, placeholder) => {
      const row = panel.createDiv('nx-row');
      row.createDiv({ cls: 'nx-row-title nx-row-sub', text: label });
      const input = row.createEl('input', { cls: 'nx-input', type: 'text' });
      input.placeholder = placeholder;
      input.value = this.cfg()[key] || '';
      input.addEventListener('change', async () => {
        const next = Object.assign({}, this.cfg());
        next[key] = input.value.trim().replace(/^\/|\/$/g, '');
        await this.plugin.setDeviceSetting('scratchPanel', next);
      });
      return input;
    };
    field('Folder', 'folder', 'Inbox');
    field('Template', 'template', 'Templates/Scratch.md');
    panel.createDiv({ cls: 'nx-row-sub',
      text: 'Empty folder means the vault root. A template understands {{content}}, {{date}}, {{time}} and {{title}}.' });

    /* A draft survives a closed panel and a restarted Obsidian, because the one
       thing this must never do is eat a thought you typed and did not save. It
       is per device by nature: localStorage does not travel. */
    const KEY = 'nexus-suite-scratch-draft';
    try { area.value = window.localStorage.getItem(KEY) || ''; } catch (e) { /* private mode */ }
    const remember = () => { try { window.localStorage.setItem(KEY, area.value); } catch (e) {} };
    area.addEventListener('input', () => { remember(); paint(); });

    const paint = () => {
      const n = area.value.trim().length;
      hint.setText(n ? n + (n === 1 ? ' character' : ' characters') : '');
      save.toggleClass('is-disabled', !n);
    };

    const commit = async () => {
      const text = area.value.trim();
      if (!text) return;
      try {
        const file = await scratch.saveScratch(this.app, this.cfg(), text);
        area.value = '';
        remember();
        paint();
        new Notice('Scratch saved: ' + file.basename);
      } catch (err) {
        // The draft is untouched on a failure — that is the whole contract.
        new Notice('Nexus: the note could not be written — ' + (err && err.message ? err.message : err));
      }
    };
    save.onclick = commit;
    // Ctrl/Cmd+Enter, the one shortcut everyone already tries in a text box.
    area.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    paint();
  }

  async onClose() { this.contentEl.empty(); }
}

module.exports = { NexusScratchView };
