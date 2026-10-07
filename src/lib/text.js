'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · text
 *  String jobs several modules share. No Obsidian; CSS.escape is used where
 *  the host has one.
 * ========================================================================== */

/* Text to match literally inside a RegExp. */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* A value for a quoted CSS attribute selector, e.g. [data-callout="…"]. */
function cssAttrValue(value) {
  const s = String(value);
  return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

/* A note read from the vault still has its frontmatter block on the front.
   Only a real block counts: a first line that is exactly `---`, closed by
   another line that is exactly `---`. A note that opens with a horizontal rule
   (`-----`) keeps its text. Tolerates CRLF and trailing spaces on the fences. */
function stripFrontmatter(text) {
  const s = String(text == null ? '' : text).replace(/\r/g, '');
  const m = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(s);
  return m ? s.slice(m[0].length) : s;
}

module.exports = { cssAttrValue, escapeRegExp, stripFrontmatter };
