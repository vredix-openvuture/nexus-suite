'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · the pages of a note's drawing
 *  Every page the note owns, as its own thumbnail — the sidecars are ordinary
 *  SVGs, so the preview is the file itself and costs nothing to draw.
 *
 *  Removing a page takes it out of the note's list and leaves the .svg where it
 *  is. A drawing is worth more than the line that pointed at it.
 * ========================================================================== */

const { Modal, setIcon } = require('obsidian');
const notesketches = require('../lib/notesketches.js');

class NexusSketchPagesModal extends Modal {
  constructor(plugin, pane) {
    super(plugin.app);
    this.plugin = plugin;
    this.pane = pane;
  }

  onOpen() {
    this.modalEl.addClass('nx-skpick-modal');
    this.render();
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
      card.createDiv({ cls: 'nx-skpick-name', text: 'Page ' + (i + 1) });
      card.createDiv({ cls: 'nx-skpick-meta', text: file ? id : id + ' — file missing' });
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
