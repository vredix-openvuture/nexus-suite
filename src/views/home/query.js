'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · which notes a card lists
 *  The note filter behind a list card: folders, tags, name, properties, date
 *  tokens, sort. Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { moment, setIcon } = require('obsidian');
const { NexusListConfigModal } = require('../../modals/cards.js');

class HomeQuery {
  /* Frontmatter property filter: "key: v1, v2; key2: v" (; = AND, , = OR) */
  _propMatch(f, propsStr) {
    const s = String(propsStr || '').trim(); if (!s) return true;
    const fm = this._fm(f);
    return s.split(/[;\n]+/).map(x => x.trim()).filter(Boolean).every(pair => {
      const ci = pair.indexOf(':'); if (ci < 0) return true;
      const key = pair.slice(0, ci).trim();
      const vals = this._expandTokens(pair.slice(ci + 1)).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (!vals.length) return key in fm;                    // only existence required
      const fv = fm[key];
      if (Array.isArray(fv)) return fv.some(x => vals.includes(String(x).toLowerCase()));
      return vals.includes(String(fv).toLowerCase());
    });
  }
  /* Structured property rules: [{key,value,conn}] — conn ('and'|'or') connects
     to the next rule, evaluated left-to-right. Value "a, b" = OR. */
  _propRulesMatch(f, rules) {
    const list = (rules || []).filter(r => r && String(r.key || '').trim());
    if (!list.length) return true;
    const fm = this._fm(f);
    const test = (r) => {
      const key = String(r.key).trim();
      const vals = this._expandTokens(r.value).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (!vals.length) return key in fm;
      const fv = fm[key];
      if (Array.isArray(fv)) return fv.some(x => vals.includes(String(x).toLowerCase()));
      return vals.includes(String(fv).toLowerCase());
    };
    let acc = test(list[0]);
    for (let i = 1; i < list.length; i++) {
      const conn = (list[i - 1].conn || 'and').toLowerCase();
      const cur = test(list[i]);
      acc = conn === 'or' ? (acc || cur) : (acc && cur);
    }
    return acc;
  }
  /* Groups: [[{key,value},…], …] — within a group AND, between groups
     OR (disjunctive normal form). Match = ANY group matches completely. */
  _propGroupsMatch(f, groups) {
    const active = (groups || []).map(g => (g || []).filter(c => c && String(c.key || '').trim())).filter(g => g.length);
    if (!active.length) return true;
    const fm = this._fm(f);
    const test = (c) => {
      const key = String(c.key).trim();
      const vals = this._expandTokens(c.value).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (!vals.length) return key in fm;
      const fv = fm[key];
      if (Array.isArray(fv)) return fv.some(x => vals.includes(String(x).toLowerCase()));
      return vals.includes(String(fv).toLowerCase());
    };
    return active.some(group => group.every(test));
  }
  _cmpField(a, b) {
    if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1;
    const ma = moment(String(a).slice(0, 10), 'YYYY-MM-DD', false), mb = moment(String(b).slice(0, 10), 'YYYY-MM-DD', false);
    if (ma.isValid() && mb.isValid()) return ma - mb;
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  }
  /* THE generic card: filters notes by folder(s)/tags/name/properties. */
  /* Expand date tokens in <…> at runtime, e.g. "<YYYY>-<MM>" → "2026-07"
     (moment format). Usable in name/folder/tags/property values. */
  _expandTokens(str) {
    return String(str || '').replace(/<([^<>]+)>/g, (_, tok) => moment().format(tok));
  }
  _queryFiles(cfg) {
    const folders = this._expandTokens(cfg.folders).split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const name = this._expandTokens(cfg.name).trim().toLowerCase();
    let files = this.app.vault.getMarkdownFiles();
    if (folders.length) files = files.filter(f => folders.some(p => f.path === p + '.md' || f.path.startsWith(p + '/')));
    files = files.filter(f => this._tagMatch(f, this._expandTokens(cfg.tags)));
    if (name) files = files.filter(f => f.basename.toLowerCase().includes(name));
    if (Array.isArray(cfg.propGroups) && cfg.propGroups.length) files = files.filter(f => this._propGroupsMatch(f, cfg.propGroups));
    else if (Array.isArray(cfg.propRules) && cfg.propRules.length) files = files.filter(f => this._propRulesMatch(f, cfg.propRules));
    else if (cfg.props) files = files.filter(f => this._propMatch(f, cfg.props));
    const sort = cfg.sort || 'modified';
    // Base comparison always ASCENDING; the direction only multiplies.
    let cmp;
    if (sort === 'field' && cfg.sortField)
      cmp = (a, b) => this._cmpField(this._fm(a)[cfg.sortField], this._fm(b)[cfg.sortField]);
    else if (sort === 'name')
      cmp = (a, b) => a.basename.localeCompare(b.basename);
    else if (sort === 'created')
      cmp = (a, b) => a.stat.ctime - b.stat.ctime;
    else
      cmp = (a, b) => a.stat.mtime - b.stat.mtime;
    // Direction: explicit choice wins; without a choice the previous default remains
    // (name/field ascending, time descending = newest first).
    const naturalAsc = (sort === 'name' || sort === 'field');
    const dir = cfg.sortDir === 'desc' ? -1 : cfg.sortDir === 'asc' ? 1 : (naturalAsc ? 1 : -1);
    files.sort((a, b) => dir * cmp(a, b));
    return files.slice(0, cfg.count > 0 ? cfg.count : 9999);
  }
  _metaText(f, meta) {
    if (!meta || meta === 'none') return '';
    if (meta === 'modified') return moment(f.stat.mtime).fromNow();
    if (meta === 'created') return moment(f.stat.ctime).fromNow();
    const v = this._fm(f)[meta];
    return v == null ? '' : String(v);
  }
  _wList(card, item) {
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || 'list');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'List' });
    const files = this._queryFiles(item);
    head.createSpan({ cls: 'nx-home-card-count', text: String(files.length) });
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusListConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body');
    if (!files.length) { this._empty(body, 'No matches.'); return; }
    if (item.display === 'covers') {
      const gal = body.createDiv('nx-home-books');
      files.forEach(f => this._bookTile(gal, { f, fm: this._fm(f) }, false, item.coverField));
    } else {
      const meta = item.meta != null ? item.meta : 'modified';
      files.forEach(f => {
        const row = this._row(body, f);
        const sub = this._metaText(f, meta);
        if (sub) row.createSpan({ cls: 'nx-home-item-sub', text: sub });
      });
    }
  }
  _fileTags(f) {
    const cache = this.app.metadataCache.getFileCache(f) || {};
    let out = [];
    const t = (cache.frontmatter || {}).tags;
    if (typeof t === 'string') out = t.split(/[,\s]+/);
    else if (Array.isArray(t)) out = t.slice();
    if (Array.isArray(cache.tags)) out = out.concat(cache.tags.map(x => x.tag));
    return out.map(s => String(s).replace(/^#/, '').toLowerCase()).filter(Boolean);
  }
  _tagMatch(f, tagsStr) {
    const want = String(tagsStr || '').split(',').map(s => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
    if (!want.length) return true;
    const have = this._fileTags(f);
    return want.some(w => have.some(hv => hv === w || hv.startsWith(w + '/')));
  }
}

module.exports = HomeQuery;
