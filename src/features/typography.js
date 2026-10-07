'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · typography and the search index
 *  Smart quotes and dashes while typing, and the index the search modal reads.
 *  Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { ST_SYMBOL_RULES } = require('../constants.js');

class Typography {

  /* ---- Smart Typography ---- */
  handleTypography(editor) {
    const s = this.settings.typography;
    if (!s.enabled || this._stBusy) return;
    const cur = editor.getCursor();
    const upto = editor.getLine(cur.line).slice(0, cur.ch);
    const lc = upto.toLowerCase();

    for (const rule of ST_SYMBOL_RULES) {
      if (!s[rule.grp]) continue;
      if (lc.endsWith(rule.m)) {
        const from = { line: cur.line, ch: cur.ch - rule.m.length };
        this._replace(editor, from, cur, rule.r);
        return;
      }
    }
    if (s.quotes) {
      const last = upto.slice(-1);
      if (last === '"' || last === "'") {
        const before = upto.slice(-2, -1);
        const opening = before === '' || /[\s([{<]/.test(before);
        const rep = last === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’');
        this._replace(editor, { line: cur.line, ch: cur.ch - 1 }, cur, rep);
      }
    }
  }
  _replace(editor, from, to, text) {
    this._stBusy = true;
    editor.replaceRange(text, from, to);
    editor.setCursor({ line: from.line, ch: from.ch + text.length });
    this._stBusy = false;
  }

  /* ---- Search index ---- */
  async buildSearchIndex() {
    for (const f of this.app.vault.getMarkdownFiles()) await this.indexFile(f);
  }
  /* One entry per note, with the FIELDS kept apart instead of one blob: the
     search ranks a title hit above a tag hit above a heading hit …, which is
     impossible once everything is flattened into a single lowercase string. */
  async indexFile(f) {
    if (!f || f.extension !== 'md') return;
    try {
      const content = (await this.app.vault.cachedRead(f)).slice(0, 20000);
      const cache = this.app.metadataCache.getFileCache(f) || {};

      const tags = [];
      const fmTags = (cache.frontmatter || {}).tags;
      if (typeof fmTags === 'string') tags.push(...fmTags.split(/[,\s]+/));
      else if (Array.isArray(fmTags)) tags.push(...fmTags.map(String));
      if (Array.isArray(cache.tags)) tags.push(...cache.tags.map(x => x.tag));

      const headings = (cache.headings || []).map(h => String(h.heading || ''));

      // Frontmatter as "key: value" strings — searching "status offen" should
      // hit a note with `status: offen`, not just one that mentions either word.
      const props = [];
      const fm = cache.frontmatter || {};
      for (const k of Object.keys(fm)) {
        if (k === 'position') continue;
        const v = fm[k];
        const vals = Array.isArray(v) ? v : [v];
        for (const one of vals) {
          if (one == null || typeof one === 'object') continue;
          props.push(k + ': ' + String(one));
        }
      }

      this.searchIndex.set(f.path, {
        basename: f.basename,
        content,
        lower: content.toLowerCase(),
        tags: tags.map(t => String(t).replace(/^#/, '').toLowerCase()).filter(Boolean),
        headings,
        headingsLower: headings.map(h => h.toLowerCase()),
        props,
        propsLower: props.map(p => p.toLowerCase()),
      });
    } catch (e) {}
  }
}

module.exports = Typography;
