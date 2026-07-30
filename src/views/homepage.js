'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · homepage
 *  The rendered hub view (hero, cards, stats).
 * ========================================================================== */

const { ItemView, Menu, Notice, moment, setIcon } = require('obsidian');
const { NexusActionConfigModal, NexusCardConfigModal, NexusHabitConfigModal, NexusHeroSettingsModal, NexusListConfigModal, NexusOrphanConfigModal, NexusQuicknoteConfigModal, NexusStatConfigModal } = require('../modals/cards.js');
const { CARD_DEFS, HOME_VIEW, NX_DEFAULT_ACTIONS, NX_GREETINGS, NX_MODULES, WMO, WMO_ICON } = require('../constants.js');
const { getDailyNoteSettings, nxAllFolders, nxAllNames, nxAllPropKeys, nxAllTags, nxPropValues, openDailyNote } = require('../lib/helpers.js');
const { NexusImageAdjustModal, NexusImageConfigModal } = require('../modals/image.js');
const { KIND_ICON, nxBuildRefIndex, nxCanvasRefs, nxFormatSize, nxKindOf } = require('../lib/orphans.js');
const { NexusConfirmModal, NexusNameModal } = require('../modals/misc.js');
const { NexusPopupMenu } = require('../modals/pickers.js');
const { NexusSearchModal } = require('../modals/search.js');
const { NexusTimerConfigModal } = require('./timers.js');

class NexusHomepageView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this._weatherCache = {}; this._liveEls = []; this._editing = false; this._qnDraft = {}; }
  getViewType() { return HOME_VIEW; }
  getDisplayText() { return NX_MODULES.homepage.name; }
  getIcon() { return 'home'; }

  async onOpen() {
    this.render();
    // Keep live: re-render on metadata/file changes (debounced).
    this.registerEvent(this.app.metadataCache.on('changed', () => this._debounced()));
    this.registerEvent(this.app.vault.on('create', () => this._debounced()));
    this.registerEvent(this.app.vault.on('delete', () => this._debounced()));
    this.registerEvent(this.app.vault.on('rename', () => this._debounced()));
    this.registerEvent(this.app.workspace.on('resize', () => this._debounced()));  // recompute column count
    // Canvas boards have no metadata cache — drop the orphan index by hand when
    // one is edited, otherwise a freshly linked attachment stays "orphaned".
    this.registerEvent(this.app.vault.on('modify', (f) => {
      if (f && f.extension === 'canvas') { this._canvasIdx = null; this._debounced(); }
    }));
    // Keep greeting/date fresh every minute (day change, morning→evening).
    this.registerInterval(window.setInterval(() => this.render(), 60 * 1000));
    // Every second: clock & timer widgets tick (without a full re-render).
    this.registerInterval(window.setInterval(() => (this._liveEls || []).forEach(fn => { try { fn(); } catch (e) {} }), 1000));
  }
  _debounced() { window.clearTimeout(this._t); this._t = window.setTimeout(() => this.render(), 400); }
  async onClose() { this._exitEditGuards(); }

  /* ---- Edit mode: lock the workspace so drag gestures don't accidentally open
     the sidebars or trigger commands. Sidebars are collapsed and edge swipes
     (which reveal them / fire the command palette on mobile) are swallowed. ---- */
  _toggleEdit() {
    this._editing = !this._editing;
    if (this._editing) this._enterEditGuards(); else this._exitEditGuards();
    this.render();
  }
  _enterEditGuards() {
    try {
      const ls = this.app.workspace.leftSplit, rs = this.app.workspace.rightSplit;
      this._sideState = { left: ls && !ls.collapsed, right: rs && !rs.collapsed };
      if (ls && !ls.collapsed) ls.collapse();
      if (rs && !rs.collapsed) rs.collapse();
    } catch (_) {}
    this._installEdgeGuard();
  }
  _exitEditGuards() {
    this._removeEdgeGuard();
    try {
      const ls = this.app.workspace.leftSplit, rs = this.app.workspace.rightSplit;
      if (this._sideState) {
        if (this._sideState.left && ls && ls.collapsed) ls.expand();
        if (this._sideState.right && rs && rs.collapsed) rs.expand();
      }
    } catch (_) {}
    this._sideState = null;
  }
  /* Swallow touches that start in the screen-edge bands (where the mobile swipe
     recogniser opens drawers / the command palette) — capture phase so it beats
     Obsidian's recogniser, plus fixed overlay strips as a physical backstop. */
  _installEdgeGuard() {
    if (this._edgeGuard) return;
    const EDGE = 30;
    const guard = (e) => {
      const t = (e.touches && e.touches[0]) || e;
      if (!t || t.clientX == null) return;
      if (t.clientX <= EDGE || t.clientX >= window.innerWidth - EDGE) { e.stopPropagation(); }
    };
    this._edgeGuard = guard;
    document.addEventListener('touchstart', guard, true);
    document.addEventListener('touchmove', guard, true);
    this._edgeEls = ['left', 'right'].map(side => {
      const s = document.body.createDiv('nx-edge-guard is-' + side);
      const stop = (e) => { e.stopPropagation(); };
      s.addEventListener('touchstart', stop, true);
      s.addEventListener('touchmove', stop, true);
      s.addEventListener('pointerdown', stop, true);
      return s;
    });
  }
  _removeEdgeGuard() {
    if (this._edgeGuard) {
      document.removeEventListener('touchstart', this._edgeGuard, true);
      document.removeEventListener('touchmove', this._edgeGuard, true);
      this._edgeGuard = null;
    }
    (this._edgeEls || []).forEach(el => el.remove());
    this._edgeEls = null;
  }

  /* ---- small data helpers ---- */
  _files(prefix) { return this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix)); }
  _fm(f) { return (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {}; }
  _date(v) {
    if (!v) return null;
    const s = (typeof v === 'string') ? v.slice(0, 10) : v;   // Date object or ISO string
    const m = moment(s, 'YYYY-MM-DD', false);
    return m.isValid() ? m.startOf('day') : null;
  }
  _open(file) { this.app.workspace.getLeaf(false).openFile(file); }

  /* Background image menu (choose / remove) */
  _heroMenu(evt) {
    const menu = new Menu();
    menu.addItem(i => i.setTitle('Choose image …').setIcon('image-plus').onClick(() => this._pickHero()));
    if ((this.plugin.hp().hero || '').trim())
      menu.addItem(i => i.setTitle('Remove image').setIcon('x').onClick(async () => {
        this.plugin.hp().hero = ''; await this.plugin.saveSettings(); this.render();
      }));
    menu.showAtMouseEvent(evt);
  }
  /* Choose image via system dialog, copy to attachments/homepage, set as hero */
  _pickHero() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const dir = 'attachments/homepage';
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = dir + '/hero-' + Date.now() + '.' + ext;
      await this.app.vault.createBinary(path, await f.arrayBuffer());
      this.plugin.hp().hero = path;
      await this.plugin.saveSettings();
      this.render();
    };
    input.click();
  }

  /* ---- Book cover ---- */
  _coverSrc(file, fm, field) {
    const v = (field && fm[field]) || fm.cover || fm.image || fm.banner;   // path, [[link]] or URL
    return v ? this.plugin.resolveBannerSrc(v, file.path) : null;
  }
  _hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
  _initials(s) {
    return s.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(w => w[0].toUpperCase()).join('') || '?';
  }
  _bookTile(gallery, x, planned, coverField) {
    const t = gallery.createDiv('nx-home-book');
    if (planned) t.addClass('is-planned');
    const cov = t.createDiv('nx-home-book-cover');
    const src = this._coverSrc(x.f, x.fm, coverField);
    if (src) { cov.addClass('has-img'); cov.style.setProperty('--img', 'url("' + src.replace(/"/g, '\\"') + '")'); }
    else {
      cov.addClass('is-placeholder');
      cov.style.setProperty('--h', String(this._hue(x.f.basename)));
      cov.createSpan({ cls: 'nx-home-book-initials', text: this._initials(x.f.basename) });
    }
    if (planned) cov.createDiv({ cls: 'nx-home-book-badge', text: 'planned' });
    else { const r = Number(x.fm.rating); if (r > 0) cov.createDiv({ cls: 'nx-home-book-rate', text: '★'.repeat(Math.min(5, r)) }); }
    t.createDiv({ cls: 'nx-home-book-title', text: x.f.basename });
    if (x.fm.author) t.createDiv({ cls: 'nx-home-book-author', text: String(x.fm.author) });
    t.onclick = () => this._open(x.f);
    t.oncontextmenu = (e) => { e.preventDefault(); this._coverMenu(e, x.f); };
    return t;
  }
  _coverMenu(evt, file) {
    const menu = new NexusPopupMenu(this.app, 'Cover');
    menu.addItem(i => i.setTitle('Choose cover …').setIcon('image-plus').onClick(() => this._pickCover(file)));
    if (this._fm(file).cover)
      menu.addItem(i => i.setTitle('Remove cover').setIcon('x').onClick(async () => {
        await this.app.fileManager.processFrontMatter(file, f => { delete f.cover; }); this.render();
      }));
    menu.showAtMouseEvent(evt);
  }
  _pickCover(file) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const dir = 'attachments/covers';
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const slug = file.basename.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase().replace(/^-|-$/g, '');
      const path = dir + '/' + slug + '-' + Date.now() + '.' + ext;
      await this.app.vault.createBinary(path, await f.arrayBuffer());
      await this.app.fileManager.processFrontMatter(file, fr => { fr.cover = path; });
      this.render();
    };
    input.click();
  }

  /* ---- Widget cards (image / clock / timer / weather) ---- */
  _widgets() { return this.plugin.hp().widgets || (this.plugin.hp().widgets = []); }
  _uid() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  _openTarget(t) {
    t = String(t).trim();
    if (/^https?:\/\//.test(t)) { window.open(t); return; }
    const name = t.replace(/^!?\[\[|\]\]$/g, '');
    const f = this.app.metadataCache.getFirstLinkpathDest(name, '') || this.app.vault.getAbstractFileByPath(t);
    if (f) this.app.workspace.getLeaf(false).openFile(f);
  }

  _widgetCard(grid, item, idx) {
    const card = grid.createDiv('nx-home-card nx-home-widget nx-widget-' + item.type);
    this._dragify(card, 'w:' + item.uid);
    this._place(card);
    this._resizable(card, 'w:' + item.uid);
    // Edit (right-click menu) only in edit mode — otherwise widgets
    // (e.g. the clock) can't be accidentally changed in normal mode.
    if (this._editing) card.oncontextmenu = (e) => { e.preventDefault(); this._widgetMenu(e, idx); };
    if (item.type === 'image') this._wImage(card, item);
    else if (item.type === 'clock') this._wClock(card, item);
    else if (item.type === 'timer') this._wTimer(card, item);
    else if (item.type === 'weather') this._wWeather(card, item);
    else if (item.type === 'list') this._wList(card, item);
    else if (item.type === 'quicknote') this._wQuicknote(card, item);
    else if (item.type === 'habit') this._wHabit(card, item);
    else if (item.type === 'orphans') this._wOrphans(card, item);
    // Headless widgets get a gear in the corner in edit mode (settings)
    if (this._editing && ['image', 'clock', 'timer', 'weather'].includes(item.type)) {
      const gear = card.createDiv('nx-home-card-gear nx-home-gear-corner');
      setIcon(gear, 'settings-2');
      gear.setAttribute('aria-label', 'Customize card');
      gear.onclick = (e) => { e.stopPropagation(); this._widgetMenu(e, idx); };
    }
  }
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
  /* ---- Suggestion sources (for autocomplete in the config fields) ----
     Same implementations the plugin object exposes — see lib/helpers.js. */
  _allPropKeys() { return nxAllPropKeys(this.app); }
  _propValues(key) { return nxPropValues(this.app, key); }
  _allFolders() { return nxAllFolders(this.app); }
  _allTags() { return nxAllTags(this.app); }
  _allNames() { return nxAllNames(this.app); }
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
  /* ---- Orphan finder ------------------------------------------------------
     Unreferenced files: attachments nothing embeds, notes nothing links to.
     The "referenced" index is built once per render and shared by all orphan
     cards (see render(), which clears _refCache). ---- */
  _refIndex(useFm) {
    const key = useFm ? 'fm' : 'raw';
    this._refCache = this._refCache || {};
    if (!this._refCache[key]) this._refCache[key] = nxBuildRefIndex(this.app, { frontmatter: useFm, plugin: this.plugin });
    return this._refCache[key];
  }
  /* Canvas index: async, so the first paint runs without it and re-renders as
     soon as the boards are read. Returns null while still building. */
  _canvasRefs() {
    if (this._canvasIdx) return this._canvasIdx;
    if (!this._canvasBuilding) {
      this._canvasBuilding = true;
      nxCanvasRefs(this.app)
        .then(set => { this._canvasIdx = set; })
        .catch(() => { this._canvasIdx = new Set(); })
        .then(() => {
          this._canvasBuilding = false;
          // The view may have been closed while we were reading — don't paint
          // into a detached element.
          if (this.contentEl && this.contentEl.isConnected) this.render();
        });
    }
    return null;
  }
  /* Note candidates: tag/frontmatter state + include/exclude rules. */
  _orphanNoteMatch(f, item) {
    const tags = this._fileTags(f);
    const tagState = item.tagState || 'any';
    if (tagState === 'none' && tags.length) return false;
    if (tagState === 'some' && !tags.length) return false;
    if (tagState !== 'none') {
      if (String(item.tags || '').trim() && !this._tagMatch(f, this._expandTokens(item.tags))) return false;
      if (String(item.tagsNot || '').trim() && this._tagMatch(f, this._expandTokens(item.tagsNot))) return false;
    }
    const keys = Object.keys(this._fm(f)).filter(k => k !== 'position');
    const fmState = item.fmState || 'any';
    if (fmState === 'none' && keys.length) return false;
    if (fmState === 'some' && !keys.length) return false;
    if (fmState !== 'none') {
      const yes = item.propGroups, no = item.propGroupsNot;
      if (Array.isArray(yes) && yes.length && !this._propGroupsMatch(f, yes)) return false;
      if (Array.isArray(no) && no.length && this._propGroupsMatch(f, no)) return false;
    }
    const name = this._expandTokens(item.name).trim().toLowerCase();
    if (name && !f.basename.toLowerCase().includes(name)) return false;
    return true;
  }
  /* → { files (capped by the limit), total, bytes, pending } */
  _orphanFiles(item) {
    const kinds = (Array.isArray(item.kinds) && item.kinds.length) ? item.kinds : ['image'];
    const clean = (s) => this._expandTokens(s).split(',').map(x => x.trim().replace(/^\/|\/$/g, '')).filter(Boolean);
    const inc = clean(item.folders), exc = clean(item.exclude);
    const refs = this._refIndex(item.countFrontmatter !== false);
    const canvas = (item.countCanvas !== false) ? this._canvasRefs() : new Set();
    const links = this.app.metadataCache.resolvedLinks || {};
    const hits = [];
    let bytes = 0;
    for (const f of this.app.vault.getFiles()) {
      const kind = nxKindOf(f);
      if (!kinds.includes(kind)) continue;
      if (inc.length && !inc.some(p => f.path === p || f.path.startsWith(p + '/'))) continue;
      if (exc.length && exc.some(p => f.path === p || f.path.startsWith(p + '/'))) continue;
      if (refs.has(f.path)) continue;
      if (canvas && canvas.has(f.path)) continue;
      if (kind === 'note') {
        if (!this._orphanNoteMatch(f, item)) continue;
        if (item.mode === 'isolated') {
          const out = links[f.path] || {};
          if (Object.keys(out).some(d => d !== f.path)) continue;
        }
      }
      hits.push(f);
      bytes += (f.stat && f.stat.size) || 0;
    }
    // cmp is always ascending; the direction just multiplies (asc = A→Z /
    // smallest first, matching the labels in the config modal).
    const dir = item.sortDir === 'asc' ? 1 : -1;
    const sort = item.sort || 'size';
    let cmp;
    if (sort === 'name') cmp = (a, b) => a.basename.localeCompare(b.basename);
    else if (sort === 'path') cmp = (a, b) => a.path.localeCompare(b.path);
    else if (sort === 'created') cmp = (a, b) => a.stat.ctime - b.stat.ctime;
    else if (sort === 'modified') cmp = (a, b) => a.stat.mtime - b.stat.mtime;
    else cmp = (a, b) => a.stat.size - b.stat.size;
    hits.sort((a, b) => dir * cmp(a, b));
    const limit = item.count > 0 ? item.count : 25;
    return { files: hits.slice(0, limit), total: hits.length, bytes, pending: canvas === null };
  }
  _wOrphans(card, item) {
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || 'unlink');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Orphans' });
    const res = this._orphanFiles(item);
    head.createSpan({ cls: 'nx-home-card-count', text: String(res.total) });
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusOrphanConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-orph-body');
    if (!res.total) {
      this._empty(body, res.pending ? 'Reading canvas boards …' : 'Nothing orphaned — everything is linked.');
      return;
    }
    const parts = [res.total + (res.total === 1 ? ' file' : ' files'), nxFormatSize(res.bytes)];
    if (res.files.length < res.total) parts.push('showing ' + res.files.length);
    if (res.pending) parts.push('canvas boards still loading …');
    body.createDiv({ cls: 'nx-orph-sum', text: parts.join(' · ') });
    if ((item.display || 'list') === 'grid') {
      const gal = body.createDiv('nx-orph-grid');
      res.files.forEach(f => this._orphanTile(gal, f, item));
    } else {
      res.files.forEach(f => this._orphanRow(body, f, item));
    }
  }
  _orphanRow(body, f, item) {
    const kind = nxKindOf(f);
    const row = body.createDiv('nx-home-item nx-orph-item');
    setIcon(row.createSpan('nx-orph-icon'), KIND_ICON[kind] || 'file');
    const text = row.createDiv('nx-orph-text');
    text.createDiv({ cls: 'nx-home-item-title', text: kind === 'note' ? f.basename : f.name });
    if (item.showPath !== false) {
      const dir = f.parent && f.parent.path && f.parent.path !== '/' ? f.parent.path : '/';
      text.createDiv({ cls: 'nx-orph-path', text: dir });
    }
    row.createSpan({ cls: 'nx-home-item-sub', text: nxFormatSize((f.stat && f.stat.size) || 0) });
    row.onclick = () => this._open(f);
    row.oncontextmenu = (e) => { e.preventDefault(); this._orphanMenu(e, f); };
    const more = row.createSpan('nx-orph-more');
    setIcon(more, 'more-horizontal');
    more.setAttribute('aria-label', 'Actions');
    more.onclick = (e) => { e.stopPropagation(); this._orphanMenu(e, f); };
  }
  _orphanTile(gal, f, item) {
    const kind = nxKindOf(f);
    const tile = gal.createDiv('nx-orph-tile');
    const thumb = tile.createDiv('nx-orph-thumb');
    if (kind === 'image') {
      thumb.addClass('has-img');
      thumb.style.setProperty('--img', 'url("' + this.app.vault.getResourcePath(f).replace(/"/g, '\\"') + '")');
    } else {
      setIcon(thumb.createSpan('nx-orph-thumb-icon'), KIND_ICON[kind] || 'file');
    }
    tile.createDiv({ cls: 'nx-orph-tile-name', text: kind === 'note' ? f.basename : f.name });
    tile.createDiv({ cls: 'nx-orph-tile-sub', text: nxFormatSize((f.stat && f.stat.size) || 0) });
    tile.setAttribute('aria-label', f.path);
    tile.onclick = () => this._open(f);
    tile.oncontextmenu = (e) => { e.preventDefault(); this._orphanMenu(e, f); };
  }
  _orphanMenu(evt, f) {
    const menu = new NexusPopupMenu(this.app, f.name);
    menu.addItem(i => i.setTitle('Open').setIcon('file').onClick(() => this._open(f)));
    menu.addItem(i => i.setTitle('Open in new tab').setIcon('layout')
      .onClick(() => this.app.workspace.getLeaf('tab').openFile(f)));
    menu.addItem(i => i.setTitle('Copy path').setIcon('copy').onClick(async () => {
      try { await navigator.clipboard.writeText(f.path); new Notice('Path copied.'); }
      catch (e) { new Notice('Nexus: clipboard unavailable.'); }
    }));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Move to trash').setIcon('trash-2').setWarning(true).onClick(async () => {
      const ok = await new NexusConfirmModal(this.app, 'Move to trash?',
        f.path + ' (' + nxFormatSize((f.stat && f.stat.size) || 0) + ')\n' +
        'Goes wherever your "Deleted files" setting points.', 'Move to trash').openAndGet();
      if (!ok) return;
      try { await this.app.fileManager.trashFile(f); new Notice('Moved to trash: ' + f.name); }
      catch (e) { new Notice('Nexus: could not delete ' + f.name); }
      this.render();
    }));
    menu.showAtMouseEvent(evt);
  }

  /* Quicknote: just start writing → Save creates a note with a timestamp name. */
  _wQuicknote(card, item) {
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), 'pencil-line');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Quicknote' });
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusQuicknoteConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-qn-body');
    const ta = body.createEl('textarea', { cls: 'nx-qn-input' });
    ta.placeholder = 'Start writing …';
    ta.value = this._qnDraft[item.uid] || '';
    ta.oninput = () => { this._qnDraft[item.uid] = ta.value; };
    const bar = body.createDiv('nx-qn-bar');
    const btn = bar.createEl('button', { cls: 'nx-qn-save', text: 'Save' });
    btn.onclick = async () => {
      const text = ta.value.trim();
      if (!text) { new Notice('Nexus: quicknote is empty.'); return; }
      await this._saveQuicknote(item, text);
      this._qnDraft[item.uid] = ''; ta.value = '';
    };
  }
  async _saveQuicknote(item, text) {
    const now = moment();
    const stamp = now.format('YYYY-MM-DD_HH-mm');
    const folder = String(item.folder || '').trim().replace(/^\/|\/$/g, '');
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch (e) {} }
    let path = (folder ? folder + '/' : '') + stamp + '.md';
    if (this.app.vault.getAbstractFileByPath(path)) path = (folder ? folder + '/' : '') + stamp + '-' + now.format('ss') + '.md';
    // Read template (simple tokens: {{content}} {{date}} {{time}} {{title}})
    let body = text;
    const tpl = String(item.template || '').trim();
    if (tpl) {
      const tp = tpl.endsWith('.md') ? tpl : tpl + '.md';
      const tf = this.app.vault.getAbstractFileByPath(tp);
      if (tf) {
        let c = await this.app.vault.read(tf);
        c = c.replace(/\{\{\s*date\s*\}\}/gi, now.format('YYYY-MM-DD'))
             .replace(/\{\{\s*time\s*\}\}/gi, now.format('HH:mm'))
             .replace(/\{\{\s*title\s*\}\}/gi, stamp);
        body = /\{\{\s*content\s*\}\}/i.test(c) ? c.replace(/\{\{\s*content\s*\}\}/gi, text) : (c.replace(/\s*$/, '') + '\n\n' + text);
      } else { new Notice('Nexus: template "' + tpl + '" not found.'); }
    }
    const file = await this.app.vault.create(path, body);
    new Notice('Quicknote saved: ' + file.basename);
  }
  _wImage(card, item) {
    card.addClass('nx-home-imgcard');
    if (item.border === false) card.addClass('nx-noborder');
    const img = card.createEl('img', { cls: 'nx-home-imgcard-img' });
    img.draggable = false;   // otherwise the browser drags the image instead of the card
    // Slideshow: prefer the images[] list; fall back to the legacy single src.
    const list = (Array.isArray(item.images) && item.images.length) ? item.images : (item.src ? [item.src] : []);
    let idx = 0;
    const show = (i) => { const s = this.plugin.resolveBannerSrc(list[i] || '', ''); if (s) img.src = s; };
    if (list.length) show(0);
    img.alt = item.caption || '';
    // Zoom & crop: fit (cover = fill the card completely; contain = no crop)
    img.style.objectFit = item.fit || 'cover';
    img.style.objectPosition = (item.posX != null ? item.posX : 50) + '% ' + (item.posY != null ? item.posY : 50) + '%';
    img.style.transform = 'scale(' + (item.zoom || 1) + ')';
    if (list.length > 1) {
      // Advance via the shared 1 s liveEls tick (no extra timer). elapsed counts
      // seconds so the interval is per-widget; idx is shared with the click handler.
      const interval = Math.max(1, item.interval || 5);
      let elapsed = 0;
      card.addClass('nx-home-imgcard-slideshow');
      this._liveEls.push(() => { if (++elapsed >= interval) { elapsed = 0; idx = (idx + 1) % list.length; show(idx); } });
    }
    if (item.caption) card.createDiv({ cls: 'nx-home-imgcard-cap', text: item.caption });
    // Clickable (default on). Off → pure display image. Never navigate while editing.
    if (item.clickable !== false && !this._editing) {
      card.addClass('nx-home-imgcard-clickable');
      card.onclick = () => { const t = item.link || list[idx] || item.src; if (t) this._openTarget(t); };
    } else {
      card.onclick = null;
    }
  }
  _wClock(card, item) {
    const box = card.createDiv('nx-home-live nx-clock');
    const time = box.createDiv('nx-clock-time');
    const date = box.createDiv('nx-clock-date');
    const upd = () => {
      time.setText(moment().format(item.seconds ? 'HH:mm:ss' : 'HH:mm'));
      date.setText(moment().format(item.dateFmt || 'dddd, D. MMMM'));
    };
    upd(); this._liveEls.push(upd);
  }
  _wTimer(card, item) {
    // Shared timer logic in the plugin (state survives leaving the dashboard).
    // The edit icon allows setting the time in ANY mode (normal too).
    const paint = this.plugin.buildTimer(card, item.uid, { minutes: item.minutes }, async (n) => {
      item.minutes = n; await this.plugin.saveSettings();
    });
    this._liveEls.push(paint);
  }
  _wWeather(card, item) {
    const box = card.createDiv('nx-home-live nx-weather');
    if (!item.lat || !item.lon) { box.createDiv({ cls: 'nx-home-empty', text: 'Set location: right-click → Location …' }); return; }
    box.createDiv({ cls: 'nx-weather-label', text: item.label || 'Weather' });
    const iconEl = box.createDiv('nx-weather-icon');
    const temp = box.createDiv({ cls: 'nx-weather-temp', text: '…' });
    const desc = box.createDiv({ cls: 'nx-weather-desc', text: '' });
    const fill = (d) => { temp.setText(Math.round(d.temp) + '°'); desc.setText(d.desc); setIcon(iconEl, WMO_ICON[d.code] || 'cloud'); };
    const cache = this._weatherCache[item.uid];
    if (cache && Date.now() - cache.ts < 15 * 60 * 1000) { fill(cache.data); return; }
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + item.lat + '&longitude=' + item.lon + '&current=temperature_2m,weather_code')
      .then(r => r.json()).then(j => {
        const c = j.current || {};
        const data = { temp: c.temperature_2m, code: c.weather_code, desc: WMO[c.weather_code] || '' };
        this._weatherCache[item.uid] = { ts: Date.now(), data };
        fill(data);
      }).catch(() => temp.setText('—'));
  }

  /* Menu "+ Card" (top) */
  /* Homepage background pattern — SUBTLE & DECORATIVE (larger scale, very
     low contrast). Set inline → independent of styles.css. */
  _applyHomeBg(root) {
    const type = (this.plugin.hp().bg || 'none');
    const c = 'color-mix(in srgb, var(--text-normal) 3%, transparent)';   // very subtle, theme-aware
    const svg = (inner, w, h) => "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'%3E" + inner + "%3C/svg%3E\")";
    const st = "stroke='%23888888' stroke-opacity='0.06' fill='none' stroke-width='1.5'";
    const P = {
      dots:     { img: 'radial-gradient(circle, ' + c + ' 2.5px, transparent 3px)', size: '72px 72px' },
      grid:     { img: 'linear-gradient(' + c + ' 1px, transparent 1px), linear-gradient(90deg, ' + c + ' 1px, transparent 1px)', size: '104px 104px' },
      diagonal: { img: 'repeating-linear-gradient(45deg, ' + c + ' 0 1px, transparent 1px 72px)', size: 'auto' },
      cross:    { img: svg("%3Cpath d='M46 26v40 M26 46h40' " + st + "/%3E", 92, 92), size: '92px 92px' },
      rings:    { img: svg("%3Ccircle cx='72' cy='72' r='44' " + st + "/%3E", 144, 144), size: '144px 144px' },
      waves:    { img: svg("%3Cpath d='M0 40 Q 45 12 90 40 T 180 40' " + st + "/%3E", 180, 64), size: '180px 64px' },
      chevron:  { img: svg("%3Cpath d='M0 34 L 22 12 L 44 34 M44 34 L 66 12 L 88 34' " + st + "/%3E", 88, 42), size: '92px 44px' },
    };
    const a = 'var(--nx-accent, var(--interactive-accent))';
    const p = P[type];
    root.style.backgroundColor = 'var(--background-primary)';
    root.style.backgroundAttachment = 'fixed';
    if (type === 'gradient') {
      // ONLY a soft gradient from the theme colors (accent → base → accent)
      root.style.backgroundImage = 'linear-gradient(135deg, ' +
        'color-mix(in srgb, ' + a + ' 24%, var(--background-primary)) 0%, ' +
        'var(--background-primary) 58%, ' +
        'color-mix(in srgb, ' + a + ' 14%, var(--background-primary)) 100%)';
      root.style.backgroundSize = 'cover';
      root.style.backgroundRepeat = 'no-repeat';
      root.style.backgroundPosition = 'center';
    } else if (p) {
      root.style.backgroundImage = p.img; root.style.backgroundSize = p.size;
      root.style.backgroundRepeat = 'repeat'; root.style.backgroundPosition = 'center';
    } else {
      root.style.removeProperty('background-image');
      root.style.removeProperty('background-size');
      root.style.removeProperty('background-repeat');
    }
  }
  _bgPatternMenu(evt) {
    const s = this.plugin.hp();
    const cur = s.bg || 'none';
    const menu = new Menu();
    const opt = (val, label, icon) => menu.addItem(i => i.setTitle(label).setIcon(icon).setChecked(cur === val)
      .onClick(async () => { s.bg = val; await this.plugin.saveSettings(); this.render(); }));
    opt('none', 'No pattern', 'x');
    opt('gradient', 'Gradient (theme colors)', 'blend');
    opt('dots', 'Dots', 'grip');
    opt('grid', 'Grid', 'grid-3x3');
    opt('diagonal', 'Diagonal', 'move-diagonal');
    opt('cross', 'Crosses', 'plus');
    opt('rings', 'Rings', 'circle');
    opt('waves', 'Waves', 'waves');
    opt('chevron', 'Zigzag', 'chevrons-up');
    menu.showAtMouseEvent(evt);
  }

  /* Run primary action (kind dispatch) */
  _runAction(a) {
    const k = a && a.kind;
    if (k === 'journal') return openDailyNote(this.app, moment());
    if (k === 'search') return new NexusSearchModal(this.plugin).open();
    if (k === 'calendar') return this.plugin.activateCalendar();
    if (k === 'newNote') {
      const c = this.app.commands;
      if (c && c.executeCommandById && c.executeCommandById('file-explorer:new-file')) return;
      return this.app.vault.create('Untitled ' + moment().format('YYYY-MM-DD HHmmss') + '.md', '').then(f => this._open(f));
    }
    if (k === 'command') { if (a.arg) this.app.commands.executeCommandById(a.arg); return; }
    if (k === 'note') {
      if (!a.arg) return;
      const dest = this.app.metadataCache.getFirstLinkpathDest(String(a.arg).replace(/\.md$/, ''), '');
      if (dest) this._open(dest); else new Notice('Note not found: ' + a.arg);
      return;
    }
    if (k === 'url') { if (a.arg) window.open(a.arg, '_blank'); return; }
  }
  _allCommands() {
    const cmds = (this.app.commands && this.app.commands.commands) || {};
    return Object.values(cmds).map(c => c.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  _cmdIdByName(name) {
    const cmds = (this.app.commands && this.app.commands.commands) || {};
    const hit = Object.values(cmds).find(c => c.name === name);
    return hit ? hit.id : '';
  }
  _cmdNameById(id) {
    const cmds = (this.app.commands && this.app.commands.commands) || {};
    return (cmds[id] && cmds[id].name) || '';
  }
  _addWidgetMenu(evt) {
    const menu = new Menu();
    const add = async (w) => { w.uid = this._uid(); this._widgets().push(w); await this.plugin.saveSettings(); this.render(); };
    menu.addItem(i => i.setTitle('List / query …').setIcon('list').onClick(() => this._addList()));
    menu.addItem(i => i.setTitle('Quicknote …').setIcon('pencil-line').onClick(() => this._addQuicknote()));
    menu.addItem(i => i.setTitle('Habit tracker …').setIcon('flame').onClick(() => this._addHabit()));
    menu.addItem(i => i.setTitle('Orphan finder …').setIcon('unlink').onClick(() => this._addOrphans()));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Image (file) …').setIcon('image-plus').onClick(() => this._pickImageWidget()));
    menu.addItem(i => i.setTitle('Image (URL) …').setIcon('link').onClick(() => this._addImageUrl()));
    menu.addItem(i => i.setTitle('Clock').setIcon('clock').onClick(() => add({ type: 'clock', w: 5, h: 5 })));
    menu.addItem(i => i.setTitle('Timer').setIcon('timer').onClick(() => add({ type: 'timer', w: 5, h: 5, minutes: 5 })));
    menu.addItem(i => i.setTitle('Weather …').setIcon('cloud-sun').onClick(() => this._addWeather()));
    // Show hidden template cards again
    const hidden = this.plugin.hp().hidden || [];
    if (hidden.length) {
      menu.addSeparator();
      hidden.forEach(id => { const def = CARD_DEFS[id]; if (!def) return;
        menu.addItem(i => i.setTitle('Restore: ' + def.title).setIcon(def.icon).onClick(async () => {
          this.plugin.hp().hidden = hidden.filter(h => h !== id);
          await this.plugin.saveSettings(); this.render();
        }));
      });
    }
    menu.showAtMouseEvent(evt);
  }
  async _addList() {
    const item = { type: 'list', uid: this._uid(), w: 6, h: 8, title: 'List', icon: 'list', folders: '', tags: '', name: '', sort: 'modified', count: 8 };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusListConfigModal(this.plugin, this, item).open();
  }
  async _addQuicknote() {
    const item = { type: 'quicknote', uid: this._uid(), w: 6, h: 6, title: 'Quicknote', folder: '', template: '' };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusQuicknoteConfigModal(this.plugin, this, item).open();
  }
  async _addHabit() {
    const item = { type: 'habit', uid: this._uid(), w: 6, h: 6, title: 'Habit', icon: 'flame',
      prop: '', mode: 'number', period: 'month', low: 1, medium: 2, high: 3, color: '', folder: '', format: '' };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusHabitConfigModal(this.plugin, this, item).open();
  }
  async _addOrphans() {
    const item = { type: 'orphans', uid: this._uid(), w: 6, h: 8, title: 'Orphans', icon: 'unlink',
      kinds: ['image'], folders: '', exclude: '', mode: 'incoming', countFrontmatter: true, countCanvas: true,
      tagState: 'any', tags: '', tagsNot: '', fmState: 'any', propGroups: [], propGroupsNot: [], name: '',
      display: 'list', sort: 'size', sortDir: 'desc', showPath: true, count: 25 };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusOrphanConfigModal(this.plugin, this, item).open();
  }

  /* ---- Habit tracker (GitHub-style heatmap over daily notes) ---- */
  /* Resolve the daily-note folder/format: per-card override, else the vault's
     Daily Notes setting (same source the journal streak uses). */
  _habitCfg(item) {
    const dn = getDailyNoteSettings(this.app);
    const folder = (item.folder && String(item.folder).trim())
      ? String(item.folder).trim().replace(/^\/|\/$/g, '') : (dn.folder || '');
    const format = (item.format && String(item.format).trim()) || dn.format;
    return { folder, format };
  }
  _habitFile(item, m, cfg) {
    const path = (cfg.folder ? cfg.folder + '/' : '') + m.format(cfg.format) + '.md';
    return this.app.vault.getAbstractFileByPath(path);
  }
  /* Read the tracked value for a date. null = no note / no value. */
  _habitVal(item, file) {
    if (!file || !file.stat) return null;                 // folder, not a file
    const v = this._fm(file)[item.prop];
    if (v == null || v === '') return null;
    if (item.mode === 'checkbox') {
      if (v === true) return 1;
      if (v === false) return 0;
      const s = String(v).trim().toLowerCase();
      return ['true', 'yes', 'y', 'x', 'done', '1', '✓', 'ja'].includes(s) ? 1 : 0;
    }
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  /* Map a value to a shade level: -1 no data · 0 none · 1 low · 2 med · 3 high · 4 above high */
  _habitLevel(item, val) {
    if (val == null) return -1;
    if (item.mode === 'checkbox') return val > 0 ? 4 : 0;
    if (val <= 0) return 0;
    const low = Number(item.low), med = Number(item.medium), high = Number(item.high);
    const l = isNaN(low) ? 1 : low, m = isNaN(med) ? 2 : med, h = isNaN(high) ? 3 : high;
    if (val < l) return 1;
    if (val < m) return 2;
    if (val < h) return 3;
    return 4;
  }
  _ratioLevel(r) { return r <= 0 ? 0 : r < 0.25 ? 1 : r < 0.5 ? 2 : r < 0.75 ? 3 : 4; }
  _fmtNum(n) { return (Math.round(n * 10) / 10).toString(); }
  /* Paint one heatmap cell with a shade of the chosen colour. */
  _habitCell(parent, item, lvl, label) {
    const cell = parent.createDiv('nx-habit-cell is-l' + (lvl < 0 ? 'x' : lvl));
    if (lvl > 0) {
      const pct = [0, 28, 50, 74, 100][lvl];
      cell.style.background = 'color-mix(in srgb, var(--habit-color) ' + pct + '%, var(--habit-track))';
    }
    if (label) { cell.setAttribute('aria-label', label); cell.setAttribute('title', label); }
    return cell;
  }
  _wHabit(card, item) {
    card.addClass('nx-home-habit');
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || 'flame');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Habit' });
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusHabitConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-habit-body');
    if (!item.prop) { this._empty(body, 'Set a frontmatter property in settings.'); return; }
    card.style.setProperty('--habit-color', (item.color && String(item.color).trim()) || 'var(--nx-accent, var(--interactive-accent))');
    const cfg = this._habitCfg(item);
    const period = item.period || 'month';
    const scroll = body.createDiv('nx-habit-scroll');
    if (period === 'year') this._habitYear(scroll, item, cfg);
    else this._habitCal(scroll, item, cfg, period);
    this._habitLegend(body, item);
  }
  /* week / month / quartal → weekday calendar (7 columns, fills the card width).
     Cells flow Mon→Sun, leading blanks align the first day to its weekday. */
  _habitCal(parent, item, cfg, period) {
    const today = moment();
    const start = period === 'week' ? today.clone().startOf('isoWeek')
      : today.clone().startOf(period === 'quartal' ? 'quarter' : 'month');
    const end = period === 'week' ? today.clone().endOf('isoWeek')
      : today.clone().endOf(period === 'quartal' ? 'quarter' : 'month');
    const cal = parent.createDiv('nx-habit-cal');
    // Row count (weeks + the weekday header) drives the grid's size in CSS:
    // width = min(all available width, what the height allows at 7:rows). Keeps
    // the cells square and fills the card in whichever direction is tighter.
    const leading = start.isoWeekday() - 1;
    const rows = Math.ceil((leading + end.diff(start, 'days') + 1) / 7);
    cal.style.setProperty('--habit-rows', String(rows + 1));
    // weekday header (Mon-based, localised)
    const wd = today.clone().startOf('isoWeek');
    for (let i = 0; i < 7; i++) cal.createDiv({ cls: 'nx-habit-hd', text: wd.clone().add(i, 'days').format('dd') });
    for (let i = 1; i < start.isoWeekday(); i++) cal.createDiv('nx-habit-cell is-ph');   // leading blanks
    const m = start.clone();
    while (m.isSameOrBefore(end, 'day')) {
      if (m.isAfter(today, 'day')) {   // upcoming day of the period → shown, but empty
        const fc = cal.createDiv('nx-habit-cell is-future');
        const lbl = m.format('ddd, D. MMM'); fc.setAttribute('aria-label', lbl); fc.setAttribute('title', lbl);
        m.add(1, 'day'); continue;
      }
      const md = m.clone();
      const val = this._habitVal(item, this._habitFile(item, md, cfg));
      const cell = this._habitCell(cal, item, this._habitLevel(item, val), this._habitLabel(item, md, val));
      cell.onclick = () => { const f = this._habitFile(item, md, cfg); if (f && f.stat) this._open(f); };
      m.add(1, 'day');
    }
  }
  /* year: 12 month boxes, shaded by the monthly average (Ø of days with a value;
     for checkboxes: share of days done). */
  _habitYear(parent, item, cfg) {
    const year = moment().year(), today = moment();
    const wrap = parent.createDiv('nx-habit-year');
    for (let mo = 0; mo < 12; mo++) {
      const start = moment({ year, month: mo, date: 1 });
      const days = start.daysInMonth();
      let sum = 0, cnt = 0, done = 0;
      for (let d = 1; d <= days; d++) {
        const m = moment({ year, month: mo, date: d });
        if (m.isAfter(today, 'day')) break;
        const val = this._habitVal(item, this._habitFile(item, m, cfg));
        if (val != null) { sum += val; cnt++; if (val > 0) done++; }
      }
      let lvl, disp;
      if (item.mode === 'checkbox') {
        const ratio = done / days;
        lvl = done === 0 ? -1 : this._ratioLevel(ratio);
        disp = Math.round(ratio * 100) + '%';
      } else if (cnt === 0) { lvl = -1; disp = '–'; }
      else { const avg = sum / cnt; lvl = this._habitLevel(item, avg); disp = this._fmtNum(avg); }
      const box = wrap.createDiv('nx-habit-ycell');
      this._habitCell(box, item, lvl, start.format('MMMM YYYY') + ' · ' + disp);
      box.createDiv({ cls: 'nx-habit-ymo', text: start.format('MMM') });
      box.createDiv({ cls: 'nx-habit-yval', text: lvl < 0 ? '' : disp });
    }
  }
  /* Small GitHub-style legend under the heatmap. */
  _habitLegend(parent, item) {
    const leg = parent.createDiv('nx-habit-legend');
    if (item.mode === 'checkbox') {
      const it = (lvl, txt) => { const s = leg.createDiv('nx-habit-legend-item'); this._legendSwatch(s, lvl); s.createSpan({ text: txt }); };
      it(0, 'offen'); it(4, 'erledigt');
    } else {
      leg.createSpan({ cls: 'nx-habit-legend-cap', text: 'weniger' });
      for (let l = 0; l <= 4; l++) this._legendSwatch(leg, l);
      leg.createSpan({ cls: 'nx-habit-legend-cap', text: 'mehr' });
    }
  }
  _legendSwatch(parent, lvl) {
    const sw = parent.createDiv('nx-habit-cell nx-habit-swatch is-l' + (lvl < 0 ? 'x' : lvl));
    if (lvl > 0) { const pct = [0, 28, 50, 74, 100][lvl]; sw.style.background = 'color-mix(in srgb, var(--habit-color) ' + pct + '%, var(--habit-track))'; }
    return sw;
  }
  _habitLabel(item, m, val) {
    const d = m.format('ddd, D. MMM');
    if (val == null) return d + ' · no note';
    if (item.mode === 'checkbox') return d + ' · ' + (val > 0 ? 'done' : '—');
    return d + ' · ' + this._fmtNum(val);
  }

  /* ---- Stat tiles (generic, configurable) ---- */
  _addStatMenu(evt) {
    const arr = this.plugin.hp().stats || (this.plugin.hp().stats = []);
    const menu = new Menu();
    menu.addItem(i => i.setTitle('Counter (query) …').setIcon('hash').onClick(async () => {
      const it = { kind: 'count', label: 'Counter', icon: 'hash', folders: '', tags: '', props: '', name: '' };
      arr.push(it); await this.plugin.saveSettings(); this.render();
      new NexusStatConfigModal(this.plugin, this, it).open();
    }));
    menu.addItem(i => i.setTitle('Total notes').setIcon('files').onClick(async () => { arr.push({ kind: 'total' }); await this.plugin.saveSettings(); this.render(); }));
    menu.addItem(i => i.setTitle('Journal streak').setIcon('flame').onClick(async () => { arr.push({ kind: 'streak' }); await this.plugin.saveSettings(); this.render(); }));
    menu.showAtMouseEvent(evt);
  }
  _statMenu(evt, idx) {
    const arr = this.plugin.hp().stats || [];
    const it = arr[idx]; if (!it) return;
    const menu = new Menu();
    const save = async () => { await this.plugin.saveSettings(); this.render(); };
    menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusStatConfigModal(this.plugin, this, it).open()));
    if (idx > 0) menu.addItem(i => i.setTitle('Move left').setIcon('arrow-left').onClick(async () => { arr.splice(idx - 1, 0, arr.splice(idx, 1)[0]); await save(); }));
    if (idx < arr.length - 1) menu.addItem(i => i.setTitle('Move right').setIcon('arrow-right').onClick(async () => { arr.splice(idx + 1, 0, arr.splice(idx, 1)[0]); await save(); }));
    menu.addItem(i => i.setTitle('Remove').setIcon('trash-2').onClick(async () => { arr.splice(idx, 1); await save(); }));
    menu.showAtMouseEvent(evt);
  }
  async _addImageUrl() {
    const url = await new NexusNameModal(this.app, 'Image URL', '').openAndGet();
    if (!url) return;
    this._widgets().push({ type: 'image', uid: this._uid(), w: 8, h: 8, src: url.trim() });
    await this.plugin.saveSettings(); this.render();
  }
  _pickImageWidget() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const dir = 'attachments/homepage';
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = dir + '/img-' + Date.now() + '.' + ext;
      await this.app.vault.createBinary(path, await f.arrayBuffer());
      this._widgets().push({ type: 'image', uid: this._uid(), w: 8, h: 8, src: path });
      await this.plugin.saveSettings(); this.render();
    };
    input.click();
  }
  async _addWeather() { await this._geocodeInto({ type: 'weather', w: 5, h: 5 }, true); }
  async _changeWeather(item) { await this._geocodeInto(item, false); }
  async _geocodeInto(item, isNew) {
    const q = await new NexusNameModal(this.app, 'Location (city)', item.label || '').openAndGet();
    if (!q) return;
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(q));
      const j = await r.json(); const g = j.results && j.results[0];
      if (!g) { new Notice('Nexus: location not found.'); return; }
      item.lat = g.latitude; item.lon = g.longitude; item.label = g.name;
      delete this._weatherCache[item.uid || ''];
      if (isNew) { item.uid = this._uid(); this._widgets().push(item); }
      await this.plugin.saveSettings(); this.render();
    } catch (e) { new Notice('Nexus: could not load location (offline?).'); }
  }
  _widgetMenu(evt, idx) {
    const ws = this._widgets(); const item = ws[idx]; if (!item) return;
    const menu = new NexusPopupMenu(this.app, item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : 'Card');
    const save = async () => { await this.plugin.saveSettings(); this.render(); };
    if (item.type === 'image') {
      menu.addItem(i => i.setTitle('Caption …').setIcon('text-cursor-input').onClick(async () => {
        const cap = await new NexusNameModal(this.app, 'Caption', item.caption || '').openAndGet();
        item.caption = (cap || '').trim(); await save();
      }));
      menu.addItem(i => i.setTitle('Link (note/URL) …').setIcon('link').onClick(async () => {
        const lk = await new NexusNameModal(this.app, 'Link', item.link || '').openAndGet();
        item.link = (lk || '').trim(); await save();
      }));
      menu.addItem(i => i.setTitle('Images / slideshow …').setIcon('images').onClick(() => new NexusImageConfigModal(this.plugin, this, item).open()));
      menu.addItem(i => i.setTitle('Zoom & crop …').setIcon('move').onClick(() => new NexusImageAdjustModal(this.plugin, this, item).open()));
      menu.addItem(i => i.setTitle(item.clickable === false ? 'Make clickable' : 'Not clickable').setIcon('mouse-pointer-click')
        .onClick(async () => { item.clickable = item.clickable === false; await save(); }));
      menu.addItem(i => i.setTitle(item.border === false ? 'Show border' : 'Hide border').setIcon('square')
        .onClick(async () => { item.border = !(item.border === false) ? false : true; await save(); }));
    }
    if (item.type === 'clock') menu.addItem(i => i.setTitle(item.seconds ? 'Hide seconds' : 'Show seconds').setIcon('clock').onClick(async () => { item.seconds = !item.seconds; await save(); }));
    if (item.type === 'timer') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusTimerConfigModal(this.plugin, this, item).open()));
    if (item.type === 'weather') menu.addItem(i => i.setTitle('Location …').setIcon('map-pin').onClick(() => this._changeWeather(item)));
    if (item.type === 'list') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusListConfigModal(this.plugin, this, item).open()));
    if (item.type === 'quicknote') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusQuicknoteConfigModal(this.plugin, this, item).open()));
    if (item.type === 'habit') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusHabitConfigModal(this.plugin, this, item).open()));
    if (item.type === 'orphans') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusOrphanConfigModal(this.plugin, this, item).open()));
    const resize = (dw, dh) => async () => { item.w = Math.max(1, Math.min(48, (item.w || 1) + dw)); item.h = Math.max(1, Math.min(48, (item.h || 1) + dh)); await save(); };
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Wider').setIcon('chevrons-right').onClick(resize(1, 0)));
    menu.addItem(i => i.setTitle('Narrower').setIcon('chevrons-left').onClick(resize(-1, 0)));
    menu.addItem(i => i.setTitle('Taller').setIcon('chevrons-down').onClick(resize(0, 1)));
    menu.addItem(i => i.setTitle('Shorter').setIcon('chevrons-up').onClick(resize(0, -1)));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Remove').setIcon('trash-2').setWarning(true).onClick(async () => { ws.splice(idx, 1); await save(); }));
    menu.showAtMouseEvent(evt);
  }

  /* ---- Reflow grid (Android-widget style: dragging/resizing pushes the other
     cards out of the way; the layout compacts upward). x,y,w,h in grid units,
     1-based. All pointer moves listen on `document` so the drag survives the
     finger leaving the tiny handle (the reason touch drag failed before). ---- */
  _dragify(card, key) {
    card.dataset.key = key;
    card.draggable = false;
    if (!this._editing) return;
    const grip = card.createDiv('nx-home-move');
    setIcon(grip, 'move');
    grip.setAttribute('aria-label', 'Move card');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button > 0) return;   // primary pointer only
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}
      this._drag(card, key);
    });
  }
  /* Two rectangles overlap? */
  _collides(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  /* Reflow the working list around `moving` (pinned): push colliders down, then
     pull everything else up (gravity). Mutates the list items' x/y in place. */
  _reflow(list, moving, cols) {
    moving.w = Math.max(1, Math.min(cols, moving.w));
    moving.x = Math.max(1, Math.min(cols - moving.w + 1, moving.x));
    moving.y = Math.max(1, moving.y);
    // Free-form board: push ONLY the cards the moved card actually lands on
    // straight down, just far enough to avoid a stack. Every other card keeps
    // exactly the spot you left it in — no global "gravity"/auto-compact that
    // would fling untouched cards to a different place. Gaps are allowed.
    const others = list.filter(l => l !== moving).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const placed = [moving];
    for (const it of others) { while (placed.some(p => this._collides(p, it))) it.y++; placed.push(it); }
  }
  _snapshot() { const o = {}; for (const k in this._pos) { const p = this._pos[k]; o[k] = { x: p.x, y: p.y, w: p.w, h: p.h }; } return o; }
  _cloneList(base) { return Object.keys(base).map(k => ({ key: k, x: base[k].x, y: base[k].y, w: base[k].w, h: base[k].h })); }
  /* Apply a reflowed working list to the live DOM (all cards). */
  _applyLive(list) {
    for (const l of list) {
      const el = this._grid.querySelector('[data-key="' + l.key + '"]');
      if (el) { el.style.gridColumn = l.x + ' / span ' + l.w; el.style.gridRow = l.y + ' / span ' + l.h; }
    }
  }
  /* Persist all positions (reflow moves more than just the dragged card). */
  _commitLayout(list) {
    const layout = this.plugin.hp().layout || (this.plugin.hp().layout = {});
    for (const l of list) layout[l.key] = { x: l.x, y: l.y };
  }
  /* Drag a card: it snaps to the pointer cell, the rest reflow around it. */
  _drag(card, key) {
    const grid = this._grid, p = this._pos[key]; if (!grid || !p) return;
    const base = this._snapshot();
    card.addClass('is-dragging');
    let result = null;
    const move = (ev) => {
      const c = this._cell(ev, grid, p.w);
      const list = this._cloneList(base);
      const mv = list.find(l => l.key === key); if (!mv) return;
      mv.x = c.x; mv.y = c.y;
      this._reflow(list, mv, this._cols);
      this._applyLive(list);
      result = list;
    };
    const up = async () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      card.removeClass('is-dragging');
      if (result) this._commitLayout(result);
      await this.plugin.saveSettings(); this.render();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
  /* Place card at its computed grid cell (from this._pos) */
  _place(card) {
    const p = this._pos && this._pos[card.dataset.key];
    if (!p) return;
    card.style.gridColumn = p.x + ' / span ' + p.w;
    card.style.gridRow = p.y + ' / span ' + p.h;
    card.dataset.w = p.w; card.dataset.h = p.h;
  }
  /* Pointer position → grid cell (1-based), x clamped to column count */
  _cell(e, grid, w) {
    const r = grid.getBoundingClientRect();
    const cols = this._cols || 1, gap = this._gap, rowH = this._rowH;
    const colPitch = (r.width + gap) / cols;
    let x = Math.floor((e.clientX - r.left) / colPitch) + 1;
    x = Math.min(Math.max(1, x), Math.max(1, cols - w + 1));
    const y = Math.max(1, Math.floor((e.clientY - r.top) / (rowH + gap)) + 1);
    return { x, y };
  }
  /* Occupied cells of all cards except `key` (for collision check). */
  _occExcept(key) {
    const occ = new Set();
    for (const k in this._pos) {
      if (k === key) continue;
      const p = this._pos[k];
      for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) occ.add((p.x + i) + ',' + (p.y + j));
    }
    return occ;
  }
  _fits(occ, x, y, w, h) {
    if (x < 1 || x + w - 1 > (this._cols || 1)) return false;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (occ.has((x + i) + ',' + (y + j))) return false;
    return true;
  }
  /* Write a card's size (w,h) to its config (fixed ID or widget). */
  _setSize(key, w, h) {
    w = Math.max(1, Math.min(48, w)); h = Math.max(1, Math.min(48, h));
    if (key.indexOf('w:') === 0) {
      const it = this._widgets().find(x => 'w:' + x.uid === key);
      if (it) { it.w = w; it.h = h; }
    } else {
      const cards = this.plugin.hp().cards || (this.plugin.hp().cards = {});
      const c = cards[key] || (cards[key] = {});
      c.w = w; c.h = h;
    }
  }
  /* Resize handles (right/bottom edge + corner) in edit mode → drag w/h.
     move/up listen on `document` (not the handle) so the drag survives even if
     the finger leaves the tiny handle or setPointerCapture is a no-op — the
     actual reason touch resize did nothing before. Growing pushes neighbours
     out of the way (reflow). touch-action:none (CSS) stops the page scrolling. */
  _resizable(card, key) {
    if (!this._editing) return;
    ['e', 's', 'se'].forEach(dir => {
      const hnd = card.createDiv('nx-home-rz nx-home-rz-' + dir);
      hnd.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button > 0) return;   // primary pointer only
        e.preventDefault(); e.stopPropagation();
        const p = this._pos[key]; if (!p) return;
        const base = this._snapshot();
        const gridW = this._grid.getBoundingClientRect().width;
        const sx = e.clientX, sy = e.clientY, sw = p.w, sh = p.h;
        const colPitch = (gridW + this._gap) / this._cols;
        const rowPitch = this._rowH + this._gap;
        card.draggable = false;   // no card drag during resize
        try { hnd.setPointerCapture(e.pointerId); } catch (_) {}
        let result = null;
        const move = (ev) => {
          const list = this._cloneList(base);
          const mv = list.find(l => l.key === key); if (!mv) return;
          if (dir === 'e' || dir === 'se') mv.w = Math.max(1, Math.min(this._cols - mv.x + 1, sw + Math.round((ev.clientX - sx) / colPitch)));
          if (dir === 's' || dir === 'se') mv.h = Math.max(1, sh + Math.round((ev.clientY - sy) / rowPitch));
          this._reflow(list, mv, this._cols);
          this._applyLive(list);
          result = list;
        };
        const up = async () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          if (result) {
            const mv = result.find(l => l.key === key);
            if (mv) this._setSize(key, mv.w, mv.h);
            this._commitLayout(result);
          }
          await this.plugin.saveSettings(); this.render();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
    });
  }
  /* Compute positions of all cards: saved ones first, the rest automatically into
     the first free cell (cards may be arbitrarily far apart). */
  _computeLayout(items, cols) {
    const layout = this.plugin.hp().layout || {};
    const occ = new Set();
    const k = (x, y) => x + ',' + y;
    const mark = (x, y, w, h) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) occ.add(k(x + i, y + j)); };
    const fits = (x, y, w, h) => { if (x < 1 || x + w - 1 > cols) return false; for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (occ.has(k(x + i, y + j))) return false; return true; };
    const findFree = (w, h) => { for (let y = 1; y < 10000; y++) for (let x = 1; x <= cols - w + 1; x++) if (fits(x, y, w, h)) return { x, y }; return { x: 1, y: 1 }; };
    this._pos = {};
    // Honour every saved position: keep the card's column, and if its cell is
    // already taken only nudge it straight DOWN to the next free row — never
    // teleport it to the top-left. Process saved cards in their own reading
    // order so the nudge is stable across renders.
    const saved = items.filter(it => layout[it.key] && layout[it.key].x)
      .sort((a, b) => (layout[a.key].y - layout[b.key].y) || (layout[a.key].x - layout[b.key].x));
    for (const it of saved) {
      const s = layout[it.key];
      const x = Math.min(Math.max(1, s.x), Math.max(1, cols - it.w + 1));
      let y = Math.max(1, s.y);
      while (!fits(x, y, it.w, it.h)) y++;          // local downward nudge only
      this._pos[it.key] = { x, y, w: it.w, h: it.h };
      mark(x, y, it.w, it.h);
    }
    for (const it of items) {                        // brand-new cards: first free cell
      if (this._pos[it.key]) continue;
      const f = findFree(it.w, it.h);
      this._pos[it.key] = { x: f.x, y: f.y, w: it.w, h: it.h };
      mark(f.x, f.y, it.w, it.h);
    }
  }

  /* Journal streak: consecutive days backwards with a daily note.
     Today may still be missing (the streak holds during the day until you write). */
  _streak(folderOverride, formatOverride) {
    const dn = getDailyNoteSettings(this.app);
    const folder = (folderOverride != null && String(folderOverride).trim() !== '')
      ? String(folderOverride).trim().replace(/\/$/, '') : dn.folder;
    const format = (formatOverride && String(formatOverride).trim()) || dn.format;
    const has = (m) => !!this.app.vault.getAbstractFileByPath((folder ? folder + '/' : '') + m.format(format) + '.md');
    const d = moment();
    if (!has(d)) d.subtract(1, 'day');
    let n = 0;
    while (has(d)) { n++; d.subtract(1, 'day'); }
    return n;
  }

  /* ---- Card config (merge: defaults + saved) ---- */
  _cfg(id) {
    const def = (CARD_DEFS[id] && CARD_DEFS[id].def) || {};
    const saved = (this.plugin.hp().cards || {})[id] || {};
    return Object.assign({}, def, saved);
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
  _sortProjects(a, b, sort) {
    if (sort === 'name') return a.f.basename.localeCompare(b.f.basename);
    if (sort === 'created') { const da = this._date(a.fm.created), db = this._date(b.fm.created); return (db ? +db : 0) - (da ? +da : 0); }
    if (sort === 'priority') { const o = { hoch: 0, mittel: 1, niedrig: 2 }; const oa = o[String(a.fm.priority || '').toLowerCase()], ob = o[String(b.fm.priority || '').toLowerCase()]; return (oa == null ? 9 : oa) - (ob == null ? 9 : ob); }
    const da = this._date(a.fm.due), db = this._date(b.fm.due);
    if (!da && !db) return 0; if (!da) return 1; if (!db) return -1; return da - db;
  }
  _lim(n) { return n && n > 0 ? n : 9999; }

  /* ---- UI-Bausteine ---- */
  _card(parent, id, icon, title, count) {
    const card = parent.createDiv('nx-home-card');
    if (id) { this._dragify(card, id); this._place(card); this._resizable(card, id); }
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), icon);
    head.createSpan({ cls: 'nx-home-card-title', text: title });
    if (count != null) head.createSpan({ cls: 'nx-home-card-count', text: String(count) });
    if (id && this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.setAttribute('aria-label', 'Configure card');
      gear.onclick = (e) => { e.stopPropagation(); new NexusCardConfigModal(this.plugin, this, id).open(); };
    }
    return card.createDiv('nx-home-card-body');
  }
  _row(body, file) {
    const row = body.createDiv('nx-home-item');
    row.createSpan({ cls: 'nx-home-item-title', text: file.basename });
    row.onclick = () => this._open(file);
    return row;
  }
  _chip(row, text, mod) {
    const c = row.createSpan({ cls: 'nx-home-chip', text });
    if (mod) c.addClass('is-' + mod);
    return c;
  }
  _empty(body, text) { body.createDiv({ cls: 'nx-home-empty', text }); }

  /* Due-date chip with traffic-light state relative to today */
  _dueChip(row, due) {
    if (!due) return;
    const today = moment().startOf('day');
    const days = due.diff(today, 'days');
    let text, mod;
    if (days < 0)      { text = 'overdue';  mod = 'overdue'; }
    else if (days === 0) { text = 'today';    mod = 'soon'; }
    else if (days === 1) { text = 'tomorrow'; mod = 'soon'; }
    else if (days <= 6)  { text = 'in ' + days + 'd'; mod = 'soon'; }
    else               { text = due.format('MMM D'); mod = null; }
    this._chip(row, text, mod);
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-home');
    root.toggleClass('is-editing', !!this._editing);
    this._applyHomeBg(root);
    this._liveEls = [];   // Uhr/Timer-Updater sammeln sich pro Render neu
    this._refCache = {};  // Orphan-Index pro Render einmal bauen, nicht pro Karte
    const inner = root.createDiv('nx-home-inner');

    const hp = this.plugin.hp();

    /* ── TOP BAR above the hero: subtle tools (Edit/Refresh + in edit mode
       Card/Hero/Pattern). Fixed position top-right, independent of the window
       width — deliberately understated, not inside the hero. ── */
    const topbar = inner.createDiv('nx-home-topbar');

    /* ── HERO: greeting + quick actions (optionally with a background image) ── */
    const hero = inner.createDiv('nx-home-hero');
    hero.addClass('nx-btn-' + (hp.btnStyle || 'default'));        // Button style
    if (hp.heroHeight) hero.style.minHeight = hp.heroHeight + 'px';
    const heroImg = (hp.hero || '').trim();
    if (heroImg) {
      const src = this.plugin.resolveBannerSrc(heroImg, '');
      if (src) {
        hero.addClass('has-img');
        hero.style.setProperty('--nx-home-hero-img', 'url("' + src.replace(/"/g, '\\"') + '")');
        hero.style.setProperty('--nx-home-hero-pos', (hp.heroPosY != null ? hp.heroPosY : 50) + '%');
      }
    } else {
      hero.addClass('nx-herostyle-' + (hp.heroStyle || 'accent'));  // Hero surface without image
    }
    const h = moment().hour();
    const name = (hp.name || '').trim();
    const greetFn = NX_GREETINGS[hp.greetStyle] || NX_GREETINGS.classic;
    const htext = hero.createDiv('nx-home-hero-text');
    htext.createDiv({ cls: 'nx-home-greeting', text: greetFn(h, name) });
    htext.createDiv({ cls: 'nx-home-date', text: moment().format('dddd, D. MMMM YYYY') });

    const actions = hero.createDiv('nx-home-actions');
    const primary = actions.createDiv('nx-home-actions-grp nx-home-primary');

    // Primary actions (configurable). First init from defaults (cloned → editable).
    if (!Array.isArray(this.plugin.hp().actions))
      this.plugin.hp().actions = NX_DEFAULT_ACTIONS.map(x => ({ ...x }));
    const acts = this.plugin.hp().actions;
    acts.forEach((a) => {
      const b = primary.createDiv('nx-home-btn');
      setIcon(b.createSpan('nx-home-btn-icon'), a.icon || 'circle');
      b.createSpan({ text: a.label || 'Action' });
      if (this._editing) {
        b.addClass('is-editing');
        b.setAttribute('aria-label', 'Edit action');
        b.onclick = () => new NexusActionConfigModal(this.plugin, this, a).open();
      } else {
        b.onclick = () => this._runAction(a);
      }
    });
    if (this._editing) {
      const addA = primary.createDiv('nx-home-btn nx-home-btn-add');
      setIcon(addA.createSpan('nx-home-btn-icon'), 'plus');
      addA.createSpan({ text: 'Action' });
      addA.setAttribute('aria-label', 'Add action');
      addA.onclick = async () => {
        const na = { kind: 'command', label: 'New action', icon: 'circle', arg: '' };
        acts.push(na); await this.plugin.saveSettings(); this.render();
        new NexusActionConfigModal(this.plugin, this, na).open();
      };
    }

    // Tools live in the top bar ABOVE the hero (subtle, fixed position).
    // Edit/Refresh always; the editing tools only in edit mode (to their left).
    const iconBtn = (parent, icon, label, fn, active) => {
      const b = parent.createDiv('nx-home-btn nx-home-btn-icononly' + (active ? ' is-active' : ''));
      setIcon(b, icon); b.setAttribute('aria-label', label); b.onclick = fn; return b;
    };
    if (this._editing) {
      const editTools = topbar.createDiv('nx-home-topbar-grp');
      iconBtn(editTools, 'plus', 'Add card', (e) => this._addWidgetMenu(e));
      iconBtn(editTools, 'image', 'Hero settings', () => new NexusHeroSettingsModal(this.plugin, this).open());
      iconBtn(editTools, 'sparkles', 'Background pattern', (e) => this._bgPatternMenu(e));
    }
    const rightTools = topbar.createDiv('nx-home-topbar-grp');
    iconBtn(rightTools, this._editing ? 'check' : 'pencil', this._editing ? 'Done' : 'Edit',
      () => this._toggleEdit(), this._editing);
    iconBtn(rightTools, 'refresh-cw', 'Refresh', () => this.render());

    /* ── STAT TILES (generic & configurable) ── */
    const stats = inner.createDiv('nx-home-stats');
    (this.plugin.hp().stats || []).forEach((s, idx) => {
      let num, label, icon;
      if (s.kind === 'streak') { num = this._streak(s.folder, s.format); label = s.label || 'Journal streak'; icon = s.icon || 'flame'; }
      else if (s.kind === 'total') { num = this.app.vault.getMarkdownFiles().length; label = s.label || 'Total notes'; icon = s.icon || 'files'; }
      else { num = this._queryFiles({ folders: s.folders, tags: s.tags, props: s.props, propRules: s.propRules, propGroups: s.propGroups, name: s.name, count: 0 }).length; label = s.label || 'Counter'; icon = s.icon || 'hash'; }
      const t = stats.createDiv('nx-home-stat');
      setIcon(t.createSpan('nx-home-stat-icon'), icon);
      const box = t.createDiv();
      box.createDiv({ cls: 'nx-home-stat-num', text: String(num) });
      box.createDiv({ cls: 'nx-home-stat-label', text: label });
      if (this._editing) {
        t.addClass('is-editing');
        t.setAttribute('aria-label', 'Click: configure · Right-click: move/remove');
        // Click the tile → configure directly (pick folders/tags/props)
        t.onclick = () => new NexusStatConfigModal(this.plugin, this, s).open();
        t.oncontextmenu = (e) => { e.preventDefault(); this._statMenu(e, idx); };
        // (no separate gear anymore — the whole tile is clickable; the absolute
        //  gear otherwise "escaped" the tile and ended up in the top-right corner.)
      }
    });
    if (this._editing) {
      const add = stats.createDiv('nx-home-stat nx-home-stat-add');
      setIcon(add.createSpan('nx-home-stat-icon'), 'plus');
      add.createDiv({ cls: 'nx-home-stat-label', text: 'Add stat' });
      add.onclick = (e) => this._addStatMenu(e);
    }

    /* ── CARD GRID (free placement in edit mode, grows down infinitely) ── */
    const grid = inner.createDiv('nx-home-grid');
    this._grid = grid;
    const theme = this.plugin.settings.theme || {};
    const gap = (theme.homeGap != null ? theme.homeGap : 12);
    const rowH = theme.homeRow || 100;
    const cols = Math.max(1, theme.homeCols || 8);   // fixed, fine column count
    this._cols = cols; this._gap = gap; this._rowH = rowH;
    grid.style.setProperty('--nx-cols', String(cols));
    // Pre-compute the positions of all cards (all are widgets)
    const items = [];
    this._widgets().forEach(it => items.push({ key: 'w:' + it.uid, w: Math.min(cols, Math.min(48, it.w || 1)), h: Math.min(48, it.h || 1) }));
    this._computeLayout(items, cols);
    // Visible grid in edit mode: subtle CSS lines (cell size as vars) + a
    // min-height so cards can be dragged/resized far downward.
    if (this._editing) {
      const gw = grid.clientWidth || inner.clientWidth || 1000;
      grid.style.setProperty('--nx-cellw', ((gw + gap) / cols) + 'px');
      grid.style.setProperty('--nx-cellh', (rowH + gap) + 'px');
      let maxRow = 1;
      for (const key in this._pos) { const p = this._pos[key]; maxRow = Math.max(maxRow, p.y + p.h - 1); }
      const viewRows = Math.ceil((this.contentEl.clientHeight || 800) / (rowH + gap));
      grid.style.minHeight = ((Math.max(maxRow, viewRows) + 6) * (rowH + gap)) + 'px';
    } else {
      grid.style.minHeight = '';
    }
    // ── All cards are widgets (generic list, quicknote, image, clock, …) ──
    this._widgets().forEach((item, idx) => this._widgetCard(grid, item, idx));
  }
}

module.exports = { NexusHomepageView };
