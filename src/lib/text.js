'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · text
 *  String jobs several modules share. Pure: no Obsidian, no DOM.
 * ========================================================================== */

/* Text to match literally inside a RegExp. */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* A note read from the vault still has its frontmatter block on the front.
   Tolerates CRLF, and leaves a note alone whose opening fence never closes. */
function stripFrontmatter(text) {
  const s = String(text == null ? '' : text).replace(/\r/g, '');
  if (!s.startsWith('---')) return s;
  const close = s.indexOf('\n---', 3);
  if (close < 0) return s;
  const nl = s.indexOf('\n', close + 1);
  return nl < 0 ? '' : s.slice(nl + 1);
}

module.exports = { escapeRegExp, stripFrontmatter };
