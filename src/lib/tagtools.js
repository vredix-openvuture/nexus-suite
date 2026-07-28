'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · tag tools
 *  Replaces tag-wrangler: rename, merge and delete tags across the vault.
 *
 *  The delicate part is rewriting INLINE tags. A naive #old → #new replace
 *  also hits code fences, inline code, URLs (…/#old), and #oldish. So the
 *  rewriter skips fenced/inline code, requires a real tag boundary, and
 *  handles nested tags (#old/sub renames along with #old).
 * ========================================================================== */

const { Notice } = require('obsidian');

const clean = (t) => String(t || '').trim().replace(/^#/, '').replace(/^\/|\/$/g, '');

/* Every tag in the vault with its usage count (frontmatter + inline). */
function nxAllTagCounts(app) {
  const out = new Map();
  const bump = (t) => { const k = clean(t); if (k) out.set(k, (out.get(k) || 0) + 1); };
  for (const f of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(f);
    if (!cache) continue;
    const fm = (cache.frontmatter || {}).tags;
    if (typeof fm === 'string') fm.split(/[,\s]+/).forEach(bump);
    else if (Array.isArray(fm)) fm.forEach(bump);
    (cache.tags || []).forEach(x => bump(x.tag));
  }
  return out;
}

/* Files that carry `tag` or one of its children. */
function nxFilesWithTag(app, tag) {
  const want = clean(tag).toLowerCase();
  if (!want) return [];
  const hit = (t) => {
    const k = clean(t).toLowerCase();
    return k === want || k.startsWith(want + '/');
  };
  return app.vault.getMarkdownFiles().filter(f => {
    const cache = app.metadataCache.getFileCache(f);
    if (!cache) return false;
    const fm = (cache.frontmatter || {}).tags;
    if (typeof fm === 'string' && fm.split(/[,\s]+/).some(hit)) return true;
    if (Array.isArray(fm) && fm.some(hit)) return true;
    return (cache.tags || []).some(x => hit(x.tag));
  });
}

/* Rewrite inline #tags in the BODY only.
   `to` empty = remove the tag (including its nested children). Returns the new
   text. Four things this deliberately does NOT touch: fenced code blocks,
   inline code spans, the frontmatter block (handled through the API instead),
   and #tagsThatMerelyStartWith the searched one. */
function nxRewriteInline(text, from, to) {
  const src = clean(from);
  if (!src) return text;
  const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const TAGCH = '[\\p{L}\\p{N}_-]';
  // #tag plus its whole nested path, and only when what follows can't be part
  // of a tag — so #project matches in "#project/web" and "#project." but not
  // in "#projects" or in a URL fragment like "…/page#project" (no boundary
  // char before the #).
  const re = new RegExp(
    '(^|[\\s(\\[{,;:!?"\'])#' + esc + '((?:\\/' + TAGCH + '+)*)(?!' + TAGCH + '|\\/)', 'gu');

  const lines = text.split('\n');
  let fenced = false;
  // Skip YAML frontmatter entirely — processFrontMatter owns that part.
  let start = 0;
  if (lines[0] !== undefined && /^---\s*$/.test(lines[0])) {
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) { start = i + 1; break; }
    }
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    // Protect inline code spans by cutting the line into code / non-code parts
    // and only touching the latter.
    const parts = line.split(/(`[^`]*`)/g);
    for (let p = 0; p < parts.length; p++) {
      if (p % 2 === 1) continue;                                   // inside backticks
      parts[p] = parts[p].replace(re, (m, pre, nested) => pre + (to ? '#' + clean(to) + nested : ''));
    }
    lines[i] = parts.join('');
  }
  return lines.join('\n');
}

/* Frontmatter `tags` — array or string, single value or list. */
function nxRewriteFrontmatterTags(list, from, to) {
  const src = clean(from).toLowerCase();
  const dst = to ? clean(to) : '';
  const out = [];
  for (const raw of list) {
    const k = clean(raw);
    const lc = k.toLowerCase();
    if (lc === src) { if (dst) out.push(dst); continue; }
    if (lc.startsWith(src + '/')) { if (dst) out.push(dst + k.slice(src.length)); continue; }
    out.push(k);
  }
  // De-duplicate — a merge can produce the same tag twice.
  return [...new Set(out)];
}

/* Rename (or, with an empty `to`, delete) a tag everywhere.
   Merging is just renaming onto an existing tag. */
async function nxRenameTag(plugin, from, to) {
  const app = plugin.app;
  const src = clean(from);
  const dst = to ? clean(to) : '';
  if (!src || src === dst) return 0;
  const files = nxFilesWithTag(app, src);
  let changed = 0;
  for (const f of files) {
    try {
      // Frontmatter through the API (keeps YAML formatting sane), body by hand.
      await app.fileManager.processFrontMatter(f, (fm) => {
        if (fm.tags == null) return;
        const wasString = typeof fm.tags === 'string';
        const list = wasString ? fm.tags.split(/[,\s]+/).filter(Boolean) : (Array.isArray(fm.tags) ? fm.tags.map(String) : []);
        const next = nxRewriteFrontmatterTags(list, src, dst);
        if (!next.length) delete fm.tags;
        else fm.tags = wasString ? next.join(' ') : next;
      });
      const before = await app.vault.read(f);
      const after = nxRewriteInline(before, src, dst);
      if (after !== before) await app.vault.modify(f, after);
      changed++;
    } catch (e) {}
  }
  return changed;
}

/* ---- wiring: context menus on tags (tag pane + inline in a note) --------- */
class NexusTagTools {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
  get s() { return this.plugin.settings.tagTools; }

  /* The tag pane has no menu event of its own, so the whole thing hangs off
     one delegated contextmenu listener. Inline tags in a note are covered by
     the same handler — both render the tag text in the element. */
  init() {
    const p = this.plugin;
    p.registerDomEvent(document, 'contextmenu', (evt) => {
      if (!this.s.enabled) return;
      const el = evt.target && evt.target.closest && evt.target.closest('.tag-pane-tag, a.tag, .cm-hashtag');
      if (!el) return;
      const tag = this.tagFromEl(el);
      if (!tag) return;
      evt.preventDefault();
      this.menu(evt, tag);
    }, { capture: true });

    p.addCommand({ id: 'nexus-rename-tag', name: 'Rename a tag …', callback: () => this.pickAndRename() });
  }
  tagFromEl(el) {
    // Tag pane rows keep the full path in a dedicated child; inline tags carry
    // the text directly. CodeMirror splits #tag into several .cm-hashtag spans,
    // so those get stitched back together from the line.
    const pane = el.querySelector && el.querySelector('.tag-pane-tag-text');
    if (pane) return clean(pane.textContent);
    if (el.classList.contains('cm-hashtag')) {
      let node = el, text = '';
      while (node && node.classList && node.classList.contains('cm-hashtag')) { text = node.textContent + text; node = node.previousSibling; }
      let next = el.nextSibling;
      while (next && next.classList && next.classList.contains('cm-hashtag')) { text += next.textContent; next = next.nextSibling; }
      return clean(text);
    }
    return clean(el.getAttribute('href') || el.textContent);
  }
  menu(evt, tag) {
    const { NexusPopupMenu } = require('../modals/pickers.js');
    const { NexusTagRenameModal } = require('../modals/tags.js');
    const { NexusConfirmModal } = require('../modals/misc.js');
    const menu = new NexusPopupMenu(this.app, '#' + tag);
    menu.addItem(i => i.setTitle('Rename / merge …').setIcon('pencil')
      .onClick(() => new NexusTagRenameModal(this.plugin, tag).open()));
    menu.addItem(i => i.setTitle('Search for this tag').setIcon('search').onClick(() => {
      const s = this.app.internalPlugins.getPluginById('global-search');
      if (s && s.instance) s.instance.openGlobalSearch('tag:#' + tag);
    }));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Remove tag everywhere').setIcon('trash-2').setWarning(true).onClick(async () => {
      const files = nxFilesWithTag(this.app, tag);
      const ok = await new NexusConfirmModal(this.app, 'Remove #' + tag + ' everywhere?',
        'Strips the tag (and its nested children) from ' + files.length + ' note(s). The notes themselves stay.',
        'Remove tag').openAndGet();
      if (!ok) return;
      new Notice('Nexus: removing #' + tag + ' …');
      const n = await nxRenameTag(this.plugin, tag, '');
      new Notice('Nexus: removed #' + tag + ' from ' + n + ' note(s).');
    }));
    menu.showAtMouseEvent(evt);
  }
  pickAndRename() {
    const { NexusTagRenameModal } = require('../modals/tags.js');
    const tags = [...nxAllTagCounts(this.app).keys()].sort((a, b) => a.localeCompare(b));
    if (!tags.length) { new Notice('Nexus: no tags in this vault.'); return; }
    // Reuse the icon-picker-style flow: a plain suggest over all known tags.
    const { NexusTagPickModal } = require('../modals/tags.js');
    if (NexusTagPickModal) new NexusTagPickModal(this.plugin, tags, (t) => new NexusTagRenameModal(this.plugin, t).open()).open();
  }
}

module.exports = { nxAllTagCounts, nxFilesWithTag, nxRenameTag, nxRewriteInline, nxRewriteFrontmatterTags, NexusTagTools };
