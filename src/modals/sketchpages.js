'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · the pages of a note's drawing
 *  Every page the note owns, as its own thumbnail — the sidecars are ordinary
 *  SVGs, so the preview is the file itself and costs nothing to draw.
 *
 *  Removing a page takes it out of the note's list and leaves the .svg where it
 *  is. A drawing is worth more than the line that pointed at it.
 * ========================================================================== */

const { Modal, Notice, TFile, setIcon } = require('obsidian');
const notesketches = require('../lib/notesketches.js');
const { parseSketchSVG, withSketchTitle } = require('../views/sketch.js');

class NexusSketchPagesModal extends Modal {
  constructor(plugin, pane) {
    super(plugin.app);
    this.plugin = plugin;
    this.pane = pane;
  }

  async onOpen() {
    this.modalEl.addClass('nx-skpick-modal');
    this.render();
    await this.readNames();
    if (this.contentEl.isConnected) this.render();
  }

  /* A page can carry a name of its own, kept in its sidecar's metadata next to
     the strokes — so it travels with the drawing rather than with the note that
     happens to list it. Read after the first paint: the grid must not wait on a
     file read to appear. */
  async readNames() {
    this.names = this.names || {};
    for (const id of this.pane.pageIds()) {
      const file = this.app.vault.getAbstractFileByPath(this.plugin._sketchPath(id));
      if (!(file instanceof TFile)) continue;
      try {
        const data = parseSketchSVG(await this.app.vault.cachedRead(file));
        if (data && data.title) this.names[id] = data.title;
      } catch (e) { /* an unreadable page still gets its number */ }
    }
  }

  async rename(id, title) {
    const file = this.app.vault.getAbstractFileByPath(this.plugin._sketchPath(id));
    if (!(file instanceof TFile)) { new Notice('Nexus: that page has no file to name.'); return; }
    try {
      const next = withSketchTitle(await this.app.vault.read(file), title);
      if (!next) { new Notice('Nexus: that page could not be read, so it was not renamed.'); return; }
      await this.app.vault.modify(file, next);
      const clean = String(title || '').trim();
      if (clean) this.names[id] = clean; else delete this.names[id];
    } catch (e) {
      new Notice('Nexus: could not rename that page — ' + ((e && e.message) || e));
    }
  }

  render() {
    const c = this.contentEl;
    c.empty();
    const note = this.pane.notePath ? this.pane.notePath.split('/').pop().replace(/\.md$/i, '') : '';
    c.createEl('h3', { cls: 'nx-skpick-title', text: note ? 'Pages of ' + note : 'Pages' });

    const ids = this.pane.pageIds();
    const grid = c.createDiv('nx-skpick-grid');
    ids.forEach((id, i) => {
      const card = grid.createDiv('nx-skpick-card' + (id === this.pane.id ? ' is-current' : ''));
      card.tabIndex = 0;
      const file = this.app.vault.getAbstractFileByPath(this.plugin._sketchPath(id));
      if (file) {
        const img = card.createEl('img', { cls: 'nx-skpick-thumb' });
        img.src = this.app.vault.getResourcePath(file);
        img.alt = '';
      } else {
        // A page whose file is missing still has to be reachable — that is how
        // it gets a new one written, or gets taken out of the list.
        card.createDiv({ cls: 'nx-skpick-thumb nx-skpick-thumb-missing' });
      }
      const named = (this.names || {})[id] || '';
      const name = card.createEl('input', {
        cls: 'nx-skpick-name nx-skpick-rename',
        attr: { type: 'text', placeholder: 'Page ' + (i + 1), 'aria-label': 'Name of page ' + (i + 1) },
      });
      name.value = named;
      name.onclick = (e) => e.stopPropagation();
      let last = named;
      name.onblur = () => { if (name.value !== last) { last = name.value; this.rename(id, name.value); } };
      name.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); name.value = last; name.blur(); }
      };
      card.createDiv({ cls: 'nx-skpick-meta', text: file ? 'Page ' + (i + 1) : 'Page ' + (i + 1) + ' — file missing' });
      const open = () => { this.close(); this.pane.goToPage(id); };
      card.onclick = open;
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };

      // Only offered where there is something left afterwards: a note with no
      // pages has no way back to a drawing.
      if (ids.length > 1) {
        const drop = card.createDiv({ cls: 'nx-skpick-drop', attr: { 'aria-label': 'Take this page out of the note' } });
        setIcon(drop, 'x');
        drop.onclick = async (e) => {
          e.stopPropagation();
          const file2 = this.pane.noteFile();
          if (!file2) return;
          await notesketches.removePage(this.plugin, file2, id);
          if (id === this.pane.id) await this.pane.goToPage(this.pane.pageIds()[0]);
          this.render();
        };
      }
    });

    if (!ids.length) c.createDiv({ cls: 'nx-skpick-empty', text: 'This note has no drawing yet.' });

    const add = c.createDiv('nx-skpick-new');
    setIcon(add.createDiv('nx-skpick-new-ic'), 'plus');
    add.createDiv({ cls: 'nx-skpick-new-lbl', text: 'New page' });
    add.createDiv({ cls: 'nx-skpick-new-sub', text: 'Or throw a finger left off the last page' });
    add.tabIndex = 0;
    const make = async () => {
      const file = this.pane.noteFile();
      if (!file) return;
      this.close();
      await this.pane.addPage();
    };
    add.onclick = make;
    add.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); make(); } };
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusSketchPagesModal };
