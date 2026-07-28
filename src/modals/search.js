'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · search
 *  Weighted fuzzy search over title / tags / headings / frontmatter / body,
 *  with a filter row under the input to include or exclude each of them.
 * ========================================================================== */

const { SuggestModal, setIcon } = require('obsidian');

/* Order = importance. A title hit outranks a tag hit outranks a heading hit …
   so a note called "Rust" always beats one that merely mentions rust. */
const FIELDS = [
  { id: 'title',    label: 'Title',       icon: 'file-text', weight: 100 },
  { id: 'tags',     label: 'Tags',        icon: 'tag',       weight: 60 },
  { id: 'headings', label: 'Headings',    icon: 'heading',   weight: 40 },
  { id: 'props',    label: 'Frontmatter', icon: 'list',      weight: 25 },
  { id: 'text',     label: 'Text',        icon: 'align-left', weight: 10 },
];

/* 0 = no match, 1 = perfect. Substring hits win; a subsequence ("fuzzy") hit
   only counts when the matched letters sit close together — without that cap
   "abc" matches almost any long note and the ranking turns to noise. */
function fieldScore(term, text) {
  if (!text) return 0;
  const i = text.indexOf(term);
  if (i === 0) return 1;
  if (i > 0) return /[^a-z0-9]/.test(text[i - 1]) ? 0.9 : 0.72;   // word start vs mid-word
  if (term.length < 3) return 0;                                   // too short to fuzzy safely
  let ti = 0, first = -1, last = -1;
  for (let k = 0; k < text.length && ti < term.length; k++) {
    if (text[k] === term[ti]) { if (first < 0) first = k; last = k; ti++; }
  }
  if (ti < term.length) return 0;
  const span = last - first + 1;
  if (span > term.length * 2.2) return 0;                          // "not too fuzzy"
  return 0.45 * (term.length / span);
}
function bestIn(term, list) {
  let best = 0;
  for (const s of list) { const q = fieldScore(term, s); if (q > best) best = q; if (best === 1) break; }
  return best;
}

class NexusSearchModal extends SuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder('Nexus search …');
    this.limit = 40;
    const s = plugin.settings.search;
    if (!s.fields || typeof s.fields !== 'object') s.fields = { title: true, tags: true, headings: true, props: true, text: true };
    this.fields = s.fields;
  }

  onOpen() {
    super.onOpen();
    this.buildFilterRow();
  }

  /* Filter chips directly under the input — the scope of a search is something
     you change WHILE searching, so it belongs in the modal, not in settings. */
  buildFilterRow() {
    const host = this.inputEl.parentElement || this.modalEl;
    const row = document.createElement('div');
    row.className = 'nx-search-filters';
    FIELDS.forEach(f => {
      const chip = document.createElement('div');
      chip.className = 'nx-search-chip';
      const ic = document.createElement('span');
      ic.className = 'nx-search-chip-icon';
      setIcon(ic, f.icon);
      const label = document.createElement('span');
      label.textContent = f.label;
      chip.append(ic, label);
      const paint = () => chip.classList.toggle('is-on', this.fields[f.id] !== false);
      paint();
      chip.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();       // keep focus in the input
        const on = this.fields[f.id] !== false;
        // Never let the last one be switched off — an empty scope can only
        // ever return nothing, which reads as "search is broken".
        if (on && FIELDS.filter(x => this.fields[x.id] !== false).length <= 1) return;
        this.fields[f.id] = !on;
        paint();
        this.plugin.saveSettings();
        this.inputEl.dispatchEvent(new Event('input'));  // re-run with the new scope
      });
      row.appendChild(chip);
    });
    host.insertAdjacentElement('afterend', row);
  }

  getSuggestions(query) {
    const q = query.trim();
    if (!q) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const active = FIELDS.filter(f => this.fields[f.id] !== false);
    const out = [];

    for (const [path, entry] of this.plugin.searchIndex) {
      const lists = {
        title: [entry.basename.toLowerCase()],
        tags: entry.tags || [],
        headings: entry.headingsLower || [],
        props: entry.propsLower || [],
        text: [entry.lower || ''],
      };
      let score = 0, ok = true, where = null;
      for (const term of terms) {
        let best = 0, bestField = null;
        for (const f of active) {
          const q2 = bestIn(term, lists[f.id]) * f.weight;
          if (q2 > best) { best = q2; bestField = f; }
        }
        if (!best) { ok = false; break; }        // every term must land somewhere
        score += best;
        if (!where || (bestField && bestField.weight > where.weight)) where = bestField;
      }
      if (!ok) continue;
      // Shorter titles win ties — "Rust" over "Rust notes from 2019".
      score += Math.max(0, 12 - entry.basename.length / 4);
      out.push({ path, entry, score, where });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, this.limit);
  }

  renderSuggestion(item, el) {
    const head = el.createDiv('nx-search-head');
    head.createDiv({ cls: 'nx-search-title', text: item.entry.basename });
    if (item.where) head.createDiv({ cls: 'nx-search-badge', text: item.where.label });
    el.createDiv({ cls: 'nx-search-path', text: item.path });
    // Show the matching tag/heading/property rather than a body snippet when
    // that is what actually produced the hit — otherwise the row shows text
    // that has nothing to do with why the note is in the list.
    const q = this.inputEl.value.toLowerCase().split(/\s+/).filter(Boolean);
    const id = item.where && item.where.id;
    let line = '';
    if (id === 'tags') line = (item.entry.tags || []).filter(t => q.some(t2 => t.includes(t2))).map(t => '#' + t).join('  ');
    else if (id === 'headings') line = (item.entry.headings || []).find((h, i) => q.some(t => (item.entry.headingsLower[i] || '').includes(t))) || '';
    else if (id === 'props') line = (item.entry.props || []).find((p, i) => q.some(t => (item.entry.propsLower[i] || '').includes(t))) || '';
    if (!line) line = this._snippet(item.entry.content, this.inputEl.value);
    if (line) el.createDiv({ cls: 'nx-search-snippet', text: line });
  }

  onChooseSuggestion(item) {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (file) this.app.workspace.getLeaf(false).openFile(file);
  }

  _snippet(content, query) {
    if (!content) return '';
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const lc = content.toLowerCase();
    let idx = -1;
    for (const t of terms) { const i = lc.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
    if (idx < 0) return '';
    const start = Math.max(0, idx - 40);
    return (start > 0 ? '… ' : '') + content.slice(start, start + 160).replace(/\s+/g, ' ').trim() + ' …';
  }
}

module.exports = { NexusSearchModal, SEARCH_FIELDS: FIELDS };
