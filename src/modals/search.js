'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · search
 *  Fuzzy full-text search suggest modal.
 * ========================================================================== */

const { SuggestModal } = require('obsidian');

class NexusSearchModal extends SuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder('Nexus search — title & content …');
    this.limit = 40;
  }
  getSuggestions(query) {
    const q = query.trim();
    if (!q) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const [path, entry] of this.plugin.searchIndex) {
      let score = 0;
      const titleLc = entry.basename.toLowerCase();
      const bodyLc = entry.lower;
      let all = true;
      for (const t of terms) {
        const inTitle = titleLc.includes(t);
        const inBody = bodyLc.includes(t);
        if (!inTitle && !inBody) { all = false; break; }
        score += (inTitle ? 12 : 0) + (inBody ? 3 : 0);
        if (titleLc.startsWith(t)) score += 6;
      }
      if (all) out.push({ path, entry, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, this.limit);
  }
  renderSuggestion(item, el) {
    el.createDiv({ cls: 'nx-search-title', text: item.entry.basename });
    el.createDiv({ cls: 'nx-search-path', text: item.path });
    const snip = this._snippet(item.entry.content, this.inputEl.value);
    if (snip) el.createDiv({ cls: 'nx-search-snippet', text: snip });
  }
  onChooseSuggestion(item) {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (file) this.app.workspace.getLeaf(false).openFile(file);
  }
  _snippet(content, query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const lc = content.toLowerCase();
    let idx = -1;
    for (const t of terms) { const i = lc.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
    if (idx < 0) return '';
    const start = Math.max(0, idx - 40);
    return (start > 0 ? '… ' : '') + content.slice(start, start + 160).replace(/\s+/g, ' ').trim() + ' …';
  }
}

/* Small text prompt (e.g. for the filename). openAndGet() → Promise<string|null> */

module.exports = { NexusSearchModal };
