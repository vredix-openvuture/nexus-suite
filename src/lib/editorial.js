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

const { Menu, Notice } = require('obsidian');
const { TASK_STATES } = require('../constants.js');

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
    /* Checklist states: pick one and write it into the line's brackets. Typing
       "- [>] " by hand is fine on a keyboard and miserable on a tablet, and the
       characters are a convention nobody memorises. Works on a selection too. */
    p.addCommand({ id: 'nexus-task-state', name: 'Set the checklist state',
      editorCallback: (editor) => this.pickTaskState(editor) });
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

  pickTaskState(editor) {
    const menu = new Menu();
    TASK_STATES.forEach(([ch, label]) => {
      menu.addItem(i => i.setTitle(label + '   [' + (ch === ' ' ? '\u00a0' : ch) + ']')
        .onClick(() => this.setTaskState(editor, ch)));
    });
    // No mouse position for a command — anchor it on the cursor instead.
    const c = editor.getCursor();
    const coords = editor.coordsAtPos ? editor.coordsAtPos(c) : null;
    if (coords) menu.showAtPosition({ x: coords.left, y: coords.bottom || coords.top });
    else menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
  }
  /* Rewrites every touched line: a task line gets its character swapped, a
     plain line becomes a task line, so this doubles as "make this a task". */
  setTaskState(editor, ch) {
    const from = editor.getCursor('from'), to = editor.getCursor('to');
    for (let ln = from.line; ln <= to.line; ln++) {
      const line = editor.getLine(ln);
      if (!line.trim()) continue;
      let next;
      const task = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)\[(.)\]\s?(.*)$/);
      if (task) next = task[1] + '[' + ch + '] ' + task[3];
      else {
        const bullet = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
        next = bullet ? bullet[1] + '[' + ch + '] ' + bullet[2]
                      : line.replace(/^(\s*)/, '$1- [' + ch + '] ');
      }
      editor.replaceRange(next, { line: ln, ch: 0 }, { line: ln, ch: line.length });
    }
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
    // Checklist states are pure CSS over Obsidian's own data-task attribute.
    b.toggleClass('nx-task-states', on && s.taskStates !== false);
    b.style.setProperty('--nx-ed-ornament', '"' + String(s.ornamentGlyph || '❦').replace(/"/g, '') + '"');
    b.style.setProperty('--nx-ed-margin-w', (s.marginWidth == null ? 200 : s.marginWidth) + 'px');
  }

  unload() {
    document.body.removeClasses(['nx-ed-margin', 'nx-ed-pullquote', 'nx-ed-dropcap', 'nx-ed-ornament', 'nx-task-states']);
    document.body.style.removeProperty('--nx-ed-ornament');
    document.body.style.removeProperty('--nx-ed-margin-w');
  }
}

module.exports = { NexusEditorial };
