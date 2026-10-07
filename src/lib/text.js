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
   Tolerates CRLF, and leaves a note alone whose opening fence never closes. */
function stripFrontmatter(text) {
  const s = String(text == null ? '' : text).replace(/\r/g, '');
  if (!s.startsWith('---')) return s;
  const close = s.indexOf('\n---', 3);
  if (close < 0) return s;
  const nl = s.indexOf('\n', close + 1);
  return nl < 0 ? '' : s.slice(nl + 1);
}

module.exports = { cssAttrValue, escapeRegExp, stripFrontmatter };
