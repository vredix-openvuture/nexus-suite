'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · editorial blocks
 *  Margin notes, pull quotes, drop caps and ornamental rules — the page
 *  furniture a printed book has and a plain markdown note doesn't.
 *
 *  Each one is its own switch, and each is CSS gated by a body class, so
 *  turning one off costs nothing at runtime and never touches the note text.
 *  Margin note and pull quote are ordinary CALLOUT types, so they survive
 *  without this plugin (they just render as a normal callout) — no custom
 *  syntax that would rot the vault.
 * ========================================================================== */

const { Notice } = require('obsidian');

class NexusEditorial {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
  get s() { return this.plugin.settings.editorial; }

  init() {
    const p = this.plugin;
    this.apply();

    p.addCommand({ id: 'nexus-insert-margin', name: 'Insert a margin note',
      editorCallback: (editor) => this.insert(editor, 'margin', 'Margin note') });
    p.addCommand({ id: 'nexus-insert-pullquote', name: 'Insert a pull quote',
      editorCallback: (editor) => this.insert(editor, 'pullquote', 'The sentence worth pulling out') });
    p.addCommand({ id: 'nexus-insert-ornament', name: 'Insert an ornamental divider',
      editorCallback: (editor) => {
        const g = (this.s.ornamentGlyph || '❦');
        editor.replaceSelection('\n> [!ornament] ' + g + '\n\n');
      } });
  }

  insert(editor, type, placeholder) {
    const sel = editor.getSelection();
    const body = (sel || placeholder).split('\n').map(l => '> ' + l).join('\n');
    editor.replaceSelection('> [!' + type + ']\n' + body + '\n');
  }

  /* One body class per block type + the ornament glyph as a custom property.
     Nothing here walks the DOM — the CSS does the work. */
  apply() {
    const s = this.s || {};
    const on = !!s.enabled;
    const b = document.body;
    b.toggleClass('nx-ed-margin', on && s.margin !== false);
    b.toggleClass('nx-ed-pullquote', on && s.pullquote !== false);
    b.toggleClass('nx-ed-dropcap', on && !!s.dropcap);
    b.toggleClass('nx-ed-ornament', on && s.ornament !== false);
    b.style.setProperty('--nx-ed-ornament', '"' + String(s.ornamentGlyph || '❦').replace(/"/g, '') + '"');
    b.style.setProperty('--nx-ed-margin-w', (s.marginWidth == null ? 200 : s.marginWidth) + 'px');
  }

  unload() {
    document.body.removeClasses(['nx-ed-margin', 'nx-ed-pullquote', 'nx-ed-dropcap', 'nx-ed-ornament']);
    document.body.style.removeProperty('--nx-ed-ornament');
    document.body.style.removeProperty('--nx-ed-margin-w');
  }
}

module.exports = { NexusEditorial };
