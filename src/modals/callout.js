'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · callout manager
 *  Custom callout editor, insert modal, editor suggest.
 * ========================================================================== */

const { EditorSuggest, Modal, Setting, SuggestModal, setIcon } = require('obsidian');
const { NX_BUILTIN_CALLOUTS } = require('../constants.js');
const { nxHexToRgb, nxRgbToHex } = require('../lib/helpers.js');
const { nxIconField } = require('../lib/inputs.js');

/* Edit ONE callout (type id + icon + base/light/dark color) with a live preview. */
class NexusCalloutModal extends Modal {
  constructor(plugin, item, onDone, opts) { super(plugin.app); this.plugin = plugin; this.item = item; this.onDone = onDone; this.opts = opts || {}; }
  onOpen() {
    const { contentEl } = this; contentEl.addClass('nx-cardcfg', 'nx-callout-modal');
    contentEl.createEl('h3', { text: this.opts.fixedId ? `Built-in callout: ${this.item.id}` : 'Callout' });
    const it = this.item;
    const defIcon = this.opts.defIcon || 'pencil';
    const save = async () => { await this.plugin.saveSettings(); this.plugin.applyCallouts(); this._paint(); };

    if (!this.opts.fixedId) {
      new Setting(contentEl).setName('Type (id)').setDesc('Used as > [!id]. Lowercase, no spaces.')
        .addText(t => t.setPlaceholder('fitness').setValue(it.id || '').onChange(async v => {
          it.id = v.toLowerCase().replace(/[^a-z0-9_-]/g, ''); if (t.getValue() !== it.id) t.setValue(it.id); await save();
        }));
    }
    nxIconField(this.app, contentEl, 'Icon', this.opts.fixedId ? `Default: ${defIcon}` : 'Pick a lucide icon', () => it.icon, v => { it.icon = v; save(); }, defIcon);
    this._colorRow(contentEl, 'Color', 'color', save);
    this._colorRow(contentEl, 'Color · light mode (optional)', 'colorLight', save);
    this._colorRow(contentEl, 'Color · dark mode (optional)', 'colorDark', save);

    // Live preview (faux callout header — Obsidian only builds real callouts in
    // rendered markdown, so we approximate icon + color + title here).
    this._preview = contentEl.createDiv('nx-callout-preview');
    this._paint();

    new Setting(contentEl).addButton(b => b.setButtonText('Done').setCta().onClick(() => this.close()));
  }
  _colorRow(parent, label, key, save) {
    const it = this.item;
    new Setting(parent).setName(label)
      .addColorPicker(cp => cp.setValue(nxRgbToHex(it[key])).onChange(async v => { it[key] = nxHexToRgb(v); await save(); }))
      .addExtraButton(b => b.setIcon('x').setTooltip('Clear (use default)').onClick(async () => { it[key] = ''; await save(); }));
  }
  _paint() {
    const p = this._preview; if (!p) return;
    p.empty();
    const rgb = this.item.color || this.item.colorDark || this.item.colorLight;
    if (rgb) p.style.setProperty('--sw', `rgb(${rgb})`); else p.style.removeProperty('--sw');
    setIcon(p.createSpan('nx-callout-preview-icon'), this.item.icon || 'pencil');
    p.createSpan({ cls: 'nx-callout-preview-title', text: this.item.id || 'callout' });
  }
  onClose() { this.contentEl.empty(); if (this.onDone) this.onDone(); }
}

/* Quick picker to insert a callout at the cursor. */

/* Quick picker to insert a callout at the cursor. */
class NexusCalloutInsertModal extends SuggestModal {
  constructor(app, plugin, editor) { super(app); this.plugin = plugin; this.editor = editor;
    this.setPlaceholder('Insert callout …'); }
  _all() {
    const custom = this.plugin.settings.callouts.items.map(c => c.id).filter(Boolean);
    const std = NX_BUILTIN_CALLOUTS.map(b => b.id);
    return [...new Set([...custom, ...std])];
  }
  getSuggestions(q) { q = (q || '').toLowerCase(); return this._all().filter(id => id.includes(q)); }
  renderSuggestion(id, el) {
    const c = this.plugin.settings.callouts.items.find(x => x.id === id);
    if (c && c.icon) setIcon(el.createSpan({ cls: 'nx-callout-suggest-icon' }), c.icon);
    el.createSpan({ text: id });
  }
  onChooseSuggestion(id) {
    const ed = this.editor;
    const cur = ed.getCursor();
    const line = ed.getLine(cur.line);
    const prefix = line.length ? '\n' : '';
    ed.replaceRange(`${prefix}> [!${id}] \n> `, cur);
  }
}

/* Live autocomplete while typing "> [!" in the editor (Live Preview + source):
   suggests every known callout (custom + built-in + aliases) with its icon,
   like the eth-p Callout Manager's suggester. Uses Obsidian's EditorSuggest API
   (no CodeMirror extension needed). */

/* Live autocomplete while typing "> [!" in the editor (Live Preview + source):
   suggests every known callout (custom + built-in + aliases) with its icon,
   like the eth-p Callout Manager's suggester. Uses Obsidian's EditorSuggest API
   (no CodeMirror extension needed). */
class NexusCalloutSuggest extends EditorSuggest {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  _list() {
    const map = new Map();                                  // id → icon (short)
    for (const b of NX_BUILTIN_CALLOUTS) { map.set(b.id, b.icon); for (const a of b.aliases) map.set(a, b.icon); }
    for (const c of this.plugin.settings.callouts.items) {
      if (c.id) map.set(c.id, c.icon || map.get(c.id) || 'pencil');
    }
    return [...map.entries()].map(([id, icon]) => ({ id, icon }));
  }
  onTrigger(cursor, editor) {
    if (!this.plugin.settings.callouts.enabled) return null;
    const sub = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = sub.match(/\[!([\w-]*)$/);                    // "…[!" + optional query, at cursor
    if (!m) return null;
    if (!/^\s*>[\s>]*$/.test(sub.slice(0, m.index))) return null;   // only inside a callout/blockquote line
    return { start: { line: cursor.line, ch: m.index }, end: cursor, query: m[1] };
  }
  getSuggestions(ctx) {
    const q = (ctx.query || '').toLowerCase();
    const all = this._list().filter(x => x.id.includes(q));
    all.sort((a, b) => (a.id.startsWith(q) === b.id.startsWith(q)) ? a.id.localeCompare(b.id) : (a.id.startsWith(q) ? -1 : 1));
    return all;
  }
  renderSuggestion(item, el) {
    el.addClass('nx-callout-suggest');
    if (item.icon) setIcon(el.createSpan('nx-callout-suggest-icon'), item.icon);
    el.createSpan({ text: item.id });
  }
  selectSuggestion(item) {
    const { editor, start, end } = this.context;
    const text = `[!${item.id}]`;
    editor.replaceRange(text, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
  }
}

module.exports = { NexusCalloutModal, NexusCalloutInsertModal, NexusCalloutSuggest };
