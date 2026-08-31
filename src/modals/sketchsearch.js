'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · sketch search
 *  Find a drawing by what is written on it: its title, its sections, its sticky
 *  notes, and any handwriting that has been recognised.
 *
 *  The scoring is the vault search's, imported rather than reimplemented — two
 *  copies of a ranking function drift, and the drift shows up as "why did that
 *  one come first" months later.
 * ========================================================================== */

const { SuggestModal, TFile, setIcon } = require('obsidian');
const { fieldScore } = require('./search.js');
const sketchSearch = require('../lib/sketchsearch.js');

class NexusSketchSearchModal extends SuggestModal {
  constructor(plugin, docs) {
    super(plugin.app);
    this.plugin = plugin;
    this.docs = docs || [];
    this.limit = 40;
    this.setPlaceholder(this.docs.length
      ? 'Search ' + this.docs.length + ' sketch' + (this.docs.length === 1 ? '' : 'es') + ' …'
      : 'No sketches found yet');
  }

  getSuggestions(query) {
    if (!query || !query.trim()) {
      // An empty box lists everything rather than nothing: with a handful of
      // sketches, browsing beats guessing a word that might be in one.
      return this.docs.slice(0, this.limit).map(doc => ({ doc, score: 0, best: null }));
    }
    return sketchSearch.searchSketches(query, this.docs, fieldScore).slice(0, this.limit);
  }

  renderSuggestion(hit, el) {
    el.addClass('nx-sksearch-row');
    const icon = el.createDiv('nx-sksearch-ic');
    setIcon(icon, 'pencil-line');
    const body = el.createDiv('nx-sksearch-body');
    body.createDiv({ cls: 'nx-sksearch-title', text: hit.doc.display });
    const meta = body.createDiv('nx-sksearch-meta');
    // Say WHERE it matched: a hit in recognised handwriting is a guess, and the
    // reader deserves to know that before trusting the result.
    if (hit.best) meta.createSpan({ cls: 'nx-sksearch-field', text: hit.best.label });
    meta.createSpan({ cls: 'nx-sksearch-path', text: hit.doc.path });
    if (hit.doc.hasOcr) meta.createSpan({ cls: 'nx-sksearch-badge', text: 'read' });
  }

  onChooseSuggestion(hit) {
    const file = this.app.vault.getAbstractFileByPath(hit.doc.path);
    if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
  }
}

module.exports = { NexusSketchSearchModal };
