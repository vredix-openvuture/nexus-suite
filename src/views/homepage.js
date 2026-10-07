'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · homepage
 *  The rendered hub view (hero, cards, stats).
 * ========================================================================== */

const { mixin } = require('../lib/mixin.js');
const { ItemView, moment, setIcon } = require('obsidian');
const { NexusActionConfigModal, NexusHeroSettingsModal, NexusStatConfigModal } = require('../modals/cards.js');
const { CARD_DEFS, HOME_VIEW, NX_DEFAULT_ACTIONS, NX_GREETINGS, NX_MODULES } = require('../constants.js');
const { nxPinMenuItem } = require('../lib/helpers.js');

class NexusHomepageView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this._weatherCache = {}; this._liveEls = []; this._editing = false; this._qnDraft = {}; this._randomPick = {}; }
  getViewType() { return HOME_VIEW; }
  getDisplayText() { return NX_MODULES.homepage.name; }
  getIcon() { return 'home'; }
  onPaneMenu(menu, source) {
    nxPinMenuItem(this.plugin, menu, 'home');
    return super.onPaneMenu(menu, source);
  }

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
    // "Random note" draws when the dashboard is OPENED. With a pinned tab the
    // view is never closed, so coming back to it counts as opening it — but
    // only when we were away, otherwise every click inside would reshuffle.
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      const mine = leaf && leaf.view === this;
      if (mine && this._wasAway) { this._wasAway = false; this._randomPick = {}; this.render(); }
      else if (!mine) this._wasAway = true;
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
    this._swipeLock(true);
  }
  _exitEditGuards() {
    this._swipeLock(false);
    try {
      const ls = this.app.workspace.leftSplit, rs = this.app.workspace.rightSplit;
      if (this._sideState) {
        if (this._sideState.left && ls && ls.collapsed) ls.expand();
        if (this._sideState.right && rs && rs.collapsed) rs.expand();
      }
    } catch (_) {}
    this._sideState = null;
  }
  /* Dragging a card across the screen IS an edge swipe as far as the mobile
     gesture recogniser is concerned — it would open a drawer (sideways) or the
     quick action / command palette (pull down) mid-drag.
     Obsidian's recogniser walks the target's ancestors on touchstart and gives
     up as soon as one carries data-ignore-swipe (that is how the canvas and the
     drawer tab strip opt out), so the whole body opts out while editing. This is
     the only reliable lever: the recogniser listens in the capture phase and was
     registered long before us, so stopPropagation from a plugin comes too late.
     Cleared again on leaving edit mode — and in onClose, so a closed dashboard
     can never leave the gestures switched off. */
  _swipeLock(on) {
    if (on) document.body.dataset.ignoreSwipe = 'true';
    else delete document.body.dataset.ignoreSwipe;
  }

  _fm(f) { return (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {}; }
  _open(file) { this.app.workspace.getLeaf(false).openFile(file); }

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

  /* ---- Card config (merge: defaults + saved) ---- */
  _cfg(id) {
    const def = (CARD_DEFS[id] && CARD_DEFS[id].def) || {};
    const saved = (this.plugin.hp().cards || {})[id] || {};
    return Object.assign({}, def, saved);
  }

  _row(body, file) {
    const row = body.createDiv('nx-home-item');
    row.createSpan({ cls: 'nx-home-item-title', text: file.basename });
    row.onclick = () => this._open(file);
    return row;
  }
  _empty(body, text) { body.createDiv({ cls: 'nx-home-empty', text }); }


  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-home');
    root.toggleClass('is-editing', !!this._editing);
    this._applyHomeBg(root);
    this._liveEls = [];   // Uhr/Timer-Updater sammeln sich pro Render neu
    this._refCache = {};  // Build the orphan index once per render, not once per card
    this._sketchFmIdx = null;   // frontmatter → sketch owner, same deal
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
    // ── All cards are widgets (generic list, scratch, image, clock, …) ──
    this._widgets().forEach((item, idx) => this._widgetCard(grid, item, idx));
  }
}

// Each part of the dashboard lives in src/views/home/.
mixin(NexusHomepageView, [
  require('./home/hero.js'),
  require('./home/query.js'),
  require('./home/orphans.js'),
  require('./home/widgets.js'),
  require('./home/captures.js'),
  require('./home/menus.js'),
  require('./home/habit.js'),
  require('./home/layout.js'),
]);

module.exports = { NexusHomepageView };
