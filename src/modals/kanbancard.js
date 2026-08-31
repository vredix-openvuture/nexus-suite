'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · one kanban card
 *  Everything a card is, in one place: what it says, the description the board
 *  shows under it, when it is due, its tags, whether it is done, which column
 *  it sits in and the note it points at.
 *
 *  Clicking a card used to ask for its name and nothing else — or, once a note
 *  was linked, to open that note and never let the card be edited at all. Due
 *  date, tags and the column were three separate trips through the ⋮ menu, and
 *  the linked note had no way back except the same menu.
 *
 *  The modal decides nothing: it hands the edited card back and the board saves
 *  it, because the board is the only thing that knows how to write the block.
 * ========================================================================== */

const { Modal, Setting } = require('obsidian');

/* Tags are typed as one line, "#" optional, commas or spaces between them.
   Stored without the "#" — that is what the card line writes back. */
function parseTags(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map(t => t.replace(/^#+/, '').trim())
    .filter(Boolean);
}

/* A description is one text with line breaks, but the board is a list of lines
   inside a code fence: a blank line there is indistinguishable from the end of
   the card, so it cannot survive the round trip and is dropped on the way in. */
function cleanDescription(raw) {
  return String(raw || '')
    .split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .filter(l => l.trim())
    .join('\n');
}

class NexusKanbanCardModal extends Modal {
  /**
   * @param opts.card         the card, as the parser produced it
   * @param opts.columns      column titles, in board order
   * @param opts.columnIndex  which one the card is in now
   * @param opts.note         the linked note (TFile) or null when there is none
   */
  constructor(app, opts) {
    super(app);
    const c = (opts && opts.card) || {};
    this.card = {
      done: !!c.done, link: c.link || '', alias: c.alias || '',
      text: c.text || '', desc: c.desc || '', due: c.due || '', tags: (c.tags || []).slice(),
    };
    this.columns = (opts && opts.columns) || [];
    this.columnIndex = (opts && opts.columnIndex) || 0;
    this.note = (opts && opts.note) || null;
    this.result = null;
  }

  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }

  /* Every way out except Cancel carries the edits, so following a link or
     creating a note does not throw away what was just typed. */
  finish(action) {
    this.result = { action, card: this.card, column: this.columnIndex };
    this.close();
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nx-kbc-modal');
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Card' });

    new Setting(contentEl).setName('Text')
      .setDesc(this.card.link ? 'Empty shows the note’s own name.' : '')
      .addText(t => {
        t.setPlaceholder(this.card.alias || this.card.link || 'What the card says')
          .setValue(this.card.text)
          .onChange(v => { this.card.text = v.trim(); });
        t.inputEl.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); this.finish('save'); }
        });
        window.setTimeout(() => { t.inputEl.focus(); t.inputEl.select(); }, 0);
      });

    new Setting(contentEl).setName('Description')
      .setDesc('Shown under the title on the board — four lines at most, the rest is cut off with an ellipsis.')
      .setClass('nx-kbc-desc')
      .addTextArea(t => {
        t.setPlaceholder('A line or two about the card')
          .setValue(this.card.desc)
          .onChange(v => { this.card.desc = cleanDescription(v); });
        t.inputEl.rows = 4;
      });

    new Setting(contentEl).setName('Due')
      .addText(t => {
        // A native date field rather than a typed string: on the tablet, where
        // most of this happens, a keyboard for "2026-09-01" is the wrong answer.
        t.inputEl.type = 'date';
        t.setValue(/^\d{4}-\d{2}-\d{2}$/.test(this.card.due) ? this.card.due : '')
          .onChange(v => { this.card.due = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; });
      });

    new Setting(contentEl).setName('Tags').setDesc('Separated by spaces or commas. The # is optional.')
      .addText(t => t.setPlaceholder('plugin, later')
        .setValue((this.card.tags || []).join(' '))
        .onChange(v => { this.card.tags = parseTags(v); }));

    new Setting(contentEl).setName('Done')
      .addToggle(t => t.setValue(this.card.done).onChange(v => { this.card.done = v; }));

    if (this.columns.length > 1) {
      new Setting(contentEl).setName('Column')
        .addDropdown(dd => {
          this.columns.forEach((title, i) => dd.addOption(String(i), title));
          dd.setValue(String(this.columnIndex))
            .onChange(v => { this.columnIndex = parseInt(v, 10) || 0; });
        });
    }

    this.noteRow(contentEl);

    const bar = contentEl.createDiv('nx-kbc-bar');
    const del = bar.createEl('button', { text: 'Delete', cls: 'mod-warning' });
    del.onclick = () => this.finish('delete');
    const right = bar.createDiv('nx-kbc-bar-right');
    right.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    right.createEl('button', { text: 'Save', cls: 'mod-cta' }).onclick = () => this.finish('save');
  }

  /* The note the card points at, and the one button that was missing: a way
     from the card to the note without going back through the ⋮ menu. */
  noteRow(contentEl) {
    const row = new Setting(contentEl).setName('Note');

    if (this.note) {
      row.setDesc(this.note.path);
      row.addButton(b => b.setButtonText('To the note').setCta().onClick(() => this.finish('open')));
      row.addExtraButton(b => b.setIcon('unlink').setTooltip('Unlink the note').onClick(() => this.finish('unlink')));
      return;
    }
    if (this.card.link) {
      row.setDesc('No note called “' + this.card.link + '” — it was renamed or deleted.');
      row.addButton(b => b.setButtonText('Create it').onClick(() => this.finish('create')));
      row.addExtraButton(b => b.setIcon('unlink').setTooltip('Drop the link').onClick(() => this.finish('unlink')));
      return;
    }
    row.setDesc('This card is only a line on the board.');
    row.addButton(b => b.setButtonText('Create a note').onClick(() => this.finish('create')));
    row.addButton(b => b.setButtonText('Link a note').onClick(() => this.finish('link')));
  }

  onClose() {
    this.contentEl.empty();
    if (this._resolve) { this._resolve(this.result); this._resolve = null; }
  }
}

module.exports = { NexusKanbanCardModal, parseTags, cleanDescription };
