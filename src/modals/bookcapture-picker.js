'use strict';

/* Pick an image that is already in the vault, by name. */
const { FuzzySuggestModal } = require('obsidian');

class NexusImageFilePicker extends FuzzySuggestModal {
  constructor(app, files, onPick) {
    super(app);
    this.files = files;
    this.onPick = onPick;
    this.setPlaceholder('Pick an image from the vault');
  }
  getItems() { return this.files; }
  getItemText(f) { return f.path; }
  onChooseItem(f) { this.onPick(f); }
}

module.exports = { NexusImageFilePicker };
