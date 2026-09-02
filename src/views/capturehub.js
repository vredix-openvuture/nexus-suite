'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · capture hub
 *  Everything you caught rather than wrote: scans, drawings, spoken notes.
 *
 *  ONE toolbar — search, sort, select, move, delete — over a small per-tab
 *  adapter. The tabs differ in what a card IS, not in what you can do with a
 *  set of them, and three copies of "a grid with a search box" would have
 *  drifted the first time one of them grew a feature. The adapter is the only
 *  thing a tab brings of its own:
 *
 *    id · label · icon · layout   'grid' (a picture) | 'list' (a first line)
 *    list()          → [item]     see lib/capture.js for the item shape
 *    tile(item, el)  → void       fills the card the hub already made
 *    open(item)      → void
 *    remove(item)    → [path]     EVERY file the item is made of, so a delete
 *                                 or a move cannot leave an attachment behind
 *    retag(items)    → bool       null when the kind has nowhere to put a tag
 *    verbs           → [verb]     bulk actions only this kind has (Ink brings
 *                                 Read and Merge). {id,label,icon,min,
 *                                 available(),run(items,notice)} — run returns
 *                                 {done, note, failed[]}
 *    quick(item)     → [action]   one-capture actions on the tile itself
 *    moved(moves)    → void       optional; renameFile rewrites LINKS, not a
 *                                 path stored in frontmatter, so a kind that
 *                                 stores one repairs it here
 *
 *  The hub is also a sidebar panel, so it is built for ~280px first: the grid
 *  is auto-fill, and the toolbar collapses to icons by container query rather
 *  than by window width — a narrow panel in a wide window is the normal case.
 * ========================================================================== */

const { ItemView, Notice, setIcon } = require('obsidian');
const { CAPTURE_VIEW } = require('../constants.js');
const capture = require('../lib/capture.js');
const { inkAdapter, NexusInkTagModal } = require('./ink.js');
const { NexusConfirmModal } = require('../modals/misc.js');
const { NexusMoveModal } = require('../modals/capture.js');
const { nxAllFolders } = require('../lib/helpers.js');

/* ── Sketch ──────────────────────────────────────────────────────────────────
   The sidecar IS a standalone SVG, so the cover is just an <img> — no parse
   needed to show it. What the tile answers instead is the question a drawing
   raises: how far along is it (sections), and can I search inside it yet
   (OCR). Both come off the same search document the sketch index already
   builds, so tile and search box can never disagree. */
function sketchAdapter(plugin) {
  const app = plugin.app;
  return {
    id: 'sketch', label: 'Sketch', icon: 'pencil-line', layout: 'grid',
    one: 'sketch', many: 'sketches',
    empty: 'No sketches yet — draw one in any note.',

    async list() {
      const docs = await plugin.sketchDocuments();
      return docs.map(doc => {
        const f = app.vault.getAbstractFileByPath(doc.path);
        return capture.sketchItem(doc, f && f.stat);
      });
    },

    tile(item, card) {
      const cov = card.createDiv('nx-cap-cover is-sketch');
      const f = app.vault.getAbstractFileByPath(item.path);
      if (f) cov.createEl('img', { cls: 'nx-cap-cover-img', attr: { src: app.vault.getResourcePath(f), alt: item.title } });
      else cov.addClass('is-missing');
      card.createDiv({ cls: 'nx-cap-title', text: item.title });
      const meta = card.createDiv('nx-cap-meta');
      meta.createSpan({ text: item.sections ? item.sections + (item.sections === 1 ? ' section' : ' sections') : 'one page' });
      meta.createSpan({ cls: 'nx-cap-chip' + (item.hasOcr ? ' is-on' : ''), text: item.hasOcr ? 'read' : 'not read' });
    },

    open(item) { plugin.openSketchInSplit(item.path.split('/').pop().replace(/\.svg$/i, ''), 'tab', ''); },
    remove(item) { return [item.path]; },
    /* A sketch is resolved by its folder and nothing else — _sketchPath()
       hard-codes it and sketchDocuments() filters on it — so moving one out
       would silently drop it from this tab, from sketch search and from every
       ```quicksketch``` block that embeds it. No move rather than a broken one. */
    movable: false,
    // A sidecar has no frontmatter; its searchable text is the title, the
    // sections and the sticky notes, and all three live inside the drawing.
    retag: null,
  };
}

/* ── Chatter ─────────────────────────────────────────────────────────────────
   A LIST, not a grid. A spoken note has no picture, so a tile would be an
   empty box with a name under it; the first line of the transcript is the only
   preview there is, and it wants the width. Bodies are cached against mtime —
   without that every keystroke in the search box would re-read every note. */
function chatterAdapter(plugin) {
  const app = plugin.app;
  const bodies = new Map();
  return {
    id: 'chatter', label: 'Chatter', icon: 'mic', layout: 'list',
    one: 'note', many: 'notes',
    empty: 'Nothing spoken yet — hit Speak to record one.',

    async list() {
      const out = [], seen = new Set();
      for (const f of app.vault.getMarkdownFiles()) {
        const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (!capture.isChatter(fm)) continue;
        seen.add(f.path);
        const stamp = f.stat ? f.stat.mtime : 0;
        const hit = bodies.get(f.path);
        let body;
        if (hit && hit.stamp === stamp) body = hit.body;
        else { body = await app.vault.cachedRead(f); bodies.set(f.path, { stamp, body }); }
        out.push(capture.chatterItem({
          path: f.path, basename: f.basename,
          ctime: f.stat ? f.stat.ctime : 0, frontmatter: fm, body,
        }));
      }
      for (const key of Array.from(bodies.keys())) if (!seen.has(key)) bodies.delete(key);
      return out;
    },

    tile(item, row) {
      const ic = row.createDiv('nx-cap-row-ic');
      setIcon(ic, 'mic');
      const main = row.createDiv('nx-row-main nx-cap-row-main');
      main.createDiv({ cls: 'nx-row-title nx-cap-row-title', text: item.title });
      main.createDiv({ cls: 'nx-row-sub nx-cap-row-preview', text: item.preview || 'No transcript.' });
      const aside = row.createDiv('nx-row-aside nx-cap-row-aside');
      const date = capture.shortDate(item.stamp);
      if (date) aside.createSpan({ cls: 'nx-row-sub', text: date });
      if (item.duration) aside.createSpan({ cls: 'nx-cap-chip', text: item.duration });
    },

    open(item) {
      const f = app.vault.getAbstractFileByPath(item.path);
      if (f) app.workspace.getLeaf(false).openFile(f);
    },
    remove(item) { return [item.path]; },

    async retag(items) {
      const res = await new NexusInkTagModal(app, items.length === 1 ? items[0].title : '',
        { count: items.length, noun: 'note' }).openAndGet();
      if (!res || !(res.tags || []).length) return false;
      for (const item of items) {
        const f = app.vault.getAbstractFileByPath(item.path);
        if (!f) continue;
        await app.fileManager.processFrontMatter(f, fr => {
          fr.tags = Array.from(new Set(capture.tagList(fr.tags).concat(res.tags)));
        });
      }
      return true;
    },
  };
}

/* ── The hub ─────────────────────────────────────────────────────────────────
   A plain class over any element, so it can be a full tab, a sidebar panel or
   a test page. The ItemView below is a shell around it. */
class NexusCaptureHub {
  constructor(plugin, host, opts) {
    this.plugin = plugin; this.app = plugin.app; this.host = host;
    this.adapters = (opts && opts.adapters) || [inkAdapter(plugin), sketchAdapter(plugin), chatterAdapter(plugin)];
    this.tab = (opts && opts.tab) || this.adapters[0].id;
    this.sel = new capture.CaptureSelection(this.tab);
    this.query = ''; this.sort = 'new'; this.items = [];
    this.actions = (opts && opts.actions) || {
      ink: { label: 'Capture', icon: 'camera', run: () => plugin.captureScan() },
      sketch: { label: 'Find', icon: 'search', run: () => plugin.openSketchSearch() },
      chatter: { label: 'Speak', icon: 'mic', run: () => {
        const { NexusQuickNoteModal } = require('../modals/quicknote.js');
        new NexusQuickNoteModal(plugin).open();
      } },
    };
  }

  adapter(id) {
    const want = id || this.tab;
    return this.adapters.filter(a => a.id === want)[0] || this.adapters[0];
  }
  /* What the toolbar is looking at: filtered, then ordered. Both the grid and
     every bulk action read this, so "delete the selected ones" can never mean
     something the user cannot see. */
  visible() { return capture.sortItems(capture.filterItems(this.items, this.query), this.sort); }

  async mount() { this.build(); await this.refresh(); }
  async refresh() {
    this.items = await this.adapter().list();
    this.renderBody();
    this.syncBar();
  }
  async setTab(id) {
    if (id === this.tab) return;
    this.sel.setTab(id);
    this.tab = id;
    this.els.tabs.forEach((btn, i) => btn.toggleClass('is-active', this.adapters[i].id === id));
    this.els.action.setText(this.actions[id] ? this.actions[id].label : '');
    await this.refresh();
  }

  build() {
    const root = this.host;
    root.empty();
    root.addClass('nx-cap');
    const inner = root.createDiv('nx-cap-inner');

    const head = inner.createDiv('nx-cap-head');
    head.createEl('h2', { cls: 'nx-cap-h', text: 'Captures' });
    const action = head.createEl('button', { cls: 'nx-btn is-primary nx-cap-action' });
    const actionIc = action.createSpan('nx-cap-btn-ic');
    const actionLbl = action.createSpan('nx-cap-btn-lbl');
    action.onclick = () => { const a = this.actions[this.tab]; if (a) a.run(); };

    const tabs = inner.createDiv('nx-cap-tabs');
    this.els = { action, actionIc, actionLbl, tabs: [] };
    this.adapters.forEach(ad => {
      const btn = tabs.createEl('button', { cls: 'nx-btn nx-cap-tab' + (ad.id === this.tab ? ' is-active' : '') });
      setIcon(btn.createSpan('nx-cap-tab-ic'), ad.icon);
      btn.createSpan({ cls: 'nx-cap-tab-lbl', text: ad.label });
      btn.onclick = () => this.setTab(ad.id);
      this.els.tabs.push(btn);
    });

    const bar = inner.createDiv('nx-cap-bar');
    const search = bar.createEl('input', { cls: 'nx-input is-grow nx-cap-search', type: 'text', placeholder: 'Search …' });
    search.addEventListener('input', () => { this.query = search.value; this.renderBody(); this.syncBar(); });
    const sort = bar.createEl('select', { cls: 'nx-input nx-cap-sort' });
    capture.SORTS.forEach(s => sort.createEl('option', { value: s.id, text: s.label }));
    sort.value = this.sort;
    sort.addEventListener('change', () => { this.sort = sort.value; this.renderBody(); });
    const pick = bar.createEl('button', { cls: 'nx-btn is-icon nx-cap-pick', attr: { 'aria-label': 'Select' } });
    setIcon(pick, 'check-square');
    pick.onclick = () => { if (this.sel.mode) this.sel.exit(); else this.sel.enter(); this.renderBody(); this.syncBar(); };

    const bulk = inner.createDiv('nx-cap-bulk');
    const count = bulk.createDiv({ cls: 'nx-cap-count', text: '' });
    const mkBtn = (cls, icon, label, fn) => {
      const b = bulk.createEl('button', { cls: 'nx-btn ' + cls, attr: { 'aria-label': label } });
      setIcon(b.createSpan('nx-cap-btn-ic'), icon);
      b.createSpan({ cls: 'nx-cap-btn-lbl', text: label });
      b.onclick = fn;
      return b;
    };
    /* Every bulk action is async and every one of them can reject — a vault
       write, a rename, a trash. Without this the rejection is unhandled: no
       message, no refresh, the toolbar just stops responding. */
    const guard = (label, fn) => async () => {
      try { await fn(); }
      catch (err) { new Notice('Nexus: ' + (err && err.message ? err.message : label + ' failed.')); }
    };
    const all = mkBtn('is-quiet', 'list-checks', 'All', () => { this.sel.all(this.visible()); this.renderBody(); this.syncBar(); });
    const tag = mkBtn('', 'tag', 'Tag', guard('Tag', () => this._retagSelected()));
    /* Move is here and not per-tab because all three kinds are files: what
       differs is only which files one item is made of, and remove() already
       answers that. */
    const move = mkBtn('', 'folder-input', 'Move', guard('Move', () => this._moveSelected()));
    /* An adapter may bring verbs of its own — Ink brings "Read" and "Merge".
       They sit before Delete because they are the ones you reach for, and each
       is simply absent where it cannot work rather than present and failing. */
    const verbs = [];
    this.adapters.forEach(ad => (ad.verbs || []).forEach(v =>
      verbs.push({ tab: ad.id, verb: v, el: mkBtn('', v.icon, v.label, () => this._runVerb(v)) })));
    const del = mkBtn('is-danger', 'trash-2', 'Delete', guard('Delete', () => this._deleteSelected()));
    const done = mkBtn('is-quiet', 'x', 'Done', () => { this.sel.exit(); this.renderBody(); this.syncBar(); });

    const tally = inner.createDiv('nx-cap-tally');
    const body = inner.createDiv('nx-cap-body');
    Object.assign(this.els, { search, sort, pick, bulk, count, all, tag, move, verbs, del, done, tally, body });
    this.els.action.setText(this.actions[this.tab] ? this.actions[this.tab].label : '');
    this.syncBar();
  }

  /* One row either way: the bulk actions REPLACE the search row rather than
     stacking under it, which is what keeps the toolbar a single line in a
     280px panel. */
  syncBar() {
    const on = this.sel.mode;
    this.host.toggleClass('is-selecting', on);
    const shown = this.visible();
    /* Counted over what is ON SCREEN, not over everything ever ticked: every
       action here runs on sel.selected(visible()), so a search typed after
       selecting would otherwise read "5 of 2" and leave buttons live for
       items the action will not touch. */
    const picked = this.sel.selected(shown).length;
    this.els.count.setText(picked + ' of ' + shown.length);
    this.els.pick.toggleClass('is-active', on);
    const ad = this.adapter();
    this.els.tag.toggleClass('is-disabled', !ad.retag || !picked);
    this.els.move.style.display = ad.movable === false ? 'none' : '';
    this.els.move.toggleClass('is-disabled', !picked);
    this.els.del.toggleClass('is-disabled', !picked);
    /* A verb that cannot run here is GONE, not greyed: a button that is only
       ever disabled is a promise the toolbar keeps breaking. Below its minimum
       it is disabled instead, because that one you can fix by picking more. */
    this.els.verbs.forEach(({ tab, verb, el }) => {
      const usable = tab === this.tab && (!verb.available || verb.available());
      el.style.display = usable ? '' : 'none';
      if (usable) el.toggleClass('is-disabled', picked < (verb.min || 1));
    });
  }

  renderBody() {
    const ad = this.adapter();
    const body = this.els.body;
    body.empty();
    const items = this.visible();
    this.els.tally.setText(items.length === this.items.length
      ? this.items.length + ' ' + (this.items.length === 1 ? ad.one || 'item' : ad.many || 'items')
      : items.length + ' of ' + this.items.length);
    if (!items.length) {
      body.createDiv({ cls: 'nx-cap-empty', text: this.items.length ? 'Nothing matches “' + this.query + '”.' : ad.empty });
      return;
    }
    const wrap = body.createDiv(ad.layout === 'list' ? 'nx-cap-list' : 'nx-cap-grid');
    items.forEach(item => {
      const card = wrap.createDiv('nx-cap-card is-' + ad.id + (ad.layout === 'list' ? ' nx-row' : ''));
      card.toggleClass('is-picked', this.sel.has(item.path));
      ad.tile(item, card);
      if (this.sel.mode) {
        const mark = card.createDiv('nx-cap-mark');
        setIcon(mark, this.sel.has(item.path) ? 'check' : 'circle');
      } else {
        /* One-capture actions live on the card: entering select mode to
           annotate the scan you are looking at is three taps for a thing that
           is one. */
        const actions = (ad.retag ? [{ icon: 'tag', label: 'Edit tags', run: () => this._retag([item]) }] : [])
          .concat(ad.quick ? ad.quick(item) : []);
        if (actions.length) {
          const row = card.createDiv('nx-cap-quicks');
          actions.forEach(action => {
            const btn = row.createDiv('nx-cap-quick');
            setIcon(btn, action.icon);
            btn.setAttribute('aria-label', action.label);
            btn.onclick = async (e) => {
              e.stopPropagation();
              try { if (await action.run()) await this.refresh(); }
              catch (err) { new Notice('Nexus: ' + (err && err.message ? err.message : action.label + ' failed.')); }
            };
          });
        }
      }
      card.onclick = () => {
        if (!this.sel.mode) { ad.open(item); return; }
        this.sel.toggle(item.path);
        this.renderBody();
        this.syncBar();
      };
    });
  }

  /* One of the adapter's own verbs, run over the selection with progress in a
     Notice — reading twenty scans takes long enough that silence reads as a
     hang. Every verb reports the same three things, so this never has to know
     which one it ran. */
  async _runVerb(verb) {
    const items = this.sel.selected(this.visible());
    if (!verb || items.length < (verb.min || 1)) return;
    const notice = new Notice('Nexus: ' + verb.label + '…', 0);
    try {
      const res = await verb.run(items, (msg) => notice.setMessage('Nexus: ' + msg));
      notice.hide();
      const failed = res.failed || [];
      const parts = [res.done + ' of ' + items.length + ' done'];
      if (res.note) parts.push(res.note);
      if (failed.length) parts.push(failed.length + ' failed:\n' + failed.slice(0, 3).join('\n'));
      new Notice('Nexus: ' + parts.join(' · '), failed.length ? 12000 : 6000);
      this.sel.exit();
      await this.refresh();
    } catch (err) {
      notice.hide();
      new Notice('Nexus: ' + (err && err.message ? err.message : verb.label + ' failed.'));
    }
  }

  /* Move the whole capture, never just its note. The file list is the one
     remove() already returns, and a name that is taken at the destination
     blocks that capture by name instead of overwriting anything — the rest
     still travel. renameFile and not vault.rename, because a capture's note
     embeds its own attachment and only renameFile rewrites that link. */
  async _moveSelected() {
    const ad = this.adapter();
    const items = this.sel.selected(this.visible());
    if (!items.length) return;
    const folder = await new NexusMoveModal(this.app, items.length, ad.one || 'item',
      nxAllFolders(this.app), capture.commonFolder(items.map(it => it.path))).openAndGet();
    if (folder == null) return;
    const plan = capture.movePlan(items, folder, {
      files: (it) => ad.remove(it),
      exists: (p) => !!this.app.vault.getAbstractFileByPath(p),
    });
    if (plan.folder && !this.app.vault.getAbstractFileByPath(plan.folder)) {
      // Half a move is worse than none: if the destination cannot be made,
      // nothing goes anywhere.
      try { await this.plugin.ensureFolderPath(plan.folder); } catch (e) { /* reported below */ }
      if (!this.app.vault.getAbstractFileByPath(plan.folder)) {
        new Notice('Nexus: “' + plan.folder + '” could not be created — nothing was moved.');
        return;
      }
    }
    const failed = plan.blocked.map(b => b.title + ': ' + b.reason);
    /* Only the renames that SUCCEEDED get reported back to the adapter. Handing
       it the whole plan would write the new path of a file that never moved
       into the frontmatter, leaving the capture pointing at nothing. */
    const done = [];
    const emptied = [];
    for (const move of plan.moves) {
      const file = this.app.vault.getAbstractFileByPath(move.from);
      if (!file) continue;
      const folder = file.parent;
      try {
        await this.app.fileManager.renameFile(file, move.to);
        done.push(move);
        if (folder && emptied.indexOf(folder) < 0) emptied.push(folder);
      } catch (err) { failed.push(capture.baseName(move.from) + ': ' + (err && err.message ? err.message : err)); }
    }
    if (ad.moved) await ad.moved(done);
    // A capture lives in a folder of its own; once its files have left, the
    // folder is litter — the same tidy-up the merge does.
    for (const folder of emptied) {
      if (!folder.children || folder.children.length || folder.path === plan.folder) continue;
      try { await this.app.fileManager.trashFile(folder); } catch (e) { /* leave it if it will not go */ }
    }
    const moved = done.length;
    const where = plan.folder || 'the vault root';
    const parts = [moved + (moved === 1 ? ' file' : ' files') + ' moved to ' + where];
    if (failed.length) parts.push(failed.length + ' left behind:\n' + failed.slice(0, 3).join('\n'));
    new Notice('Nexus: ' + parts.join(' · '), failed.length ? 12000 : 6000);
    this.sel.exit();
    await this.refresh();
  }

  _retagSelected() {
    const items = this.sel.selected(this.visible());
    if (items.length) this._retag(items);
  }
  async _retag(items) {
    const ad = this.adapter();
    if (!ad.retag) return;
    if (await ad.retag(items)) { this.sel.exit(); await this.refresh(); }
  }

  /* Ask, and say how many and what — the file list is the point, because for a
     scan the answer is two files and only one of them is the note you picked. */
  async _deleteSelected() {
    const ad = this.adapter();
    const items = this.sel.selected(this.visible());
    if (!items.length) return;
    const paths = [];
    items.forEach(it => ad.remove(it).forEach(p => { if (paths.indexOf(p) < 0) paths.push(p); }));
    const shown = paths.slice(0, 6);
    if (paths.length > shown.length) shown.push('… and ' + (paths.length - shown.length) + ' more');
    const ok = await new NexusConfirmModal(this.app,
      'Move ' + items.length + ' ' + (items.length === 1 ? ad.one || 'item' : ad.many || 'items') + ' to the trash?',
      paths.length + (paths.length === 1 ? ' file:\n' : ' files:\n') + shown.join('\n'),
      'Move to trash').openAndGet();
    if (!ok) return;
    let gone = 0;
    for (const p of paths) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (!f) continue;
      // trashFile, never vault.delete: the user's own "deleted files" setting
      // decides whether that means the system bin, the vault's .trash, or gone.
      try { await this.app.fileManager.trashFile(f); gone++; } catch (e) { /* a file already gone is not an error */ }
    }
    new Notice('Nexus: ' + gone + (gone === 1 ? ' file' : ' files') + ' moved to the trash.');
    this.sel.exit();
    await this.refresh();
  }
}

/* The view shell. It is registered TWICE — once as its own id and once as the
   old `nx-ink-gallery`, which is why the type is remembered per instance
   instead of being a constant: a leaf restored from a saved workspace keeps
   the id it was saved under, opens on the Ink tab, and saves back unchanged. */
class NexusCaptureHubView extends ItemView {
  constructor(leaf, plugin, opts) {
    super(leaf);
    this.plugin = plugin;
    this.type = (opts && opts.type) || CAPTURE_VIEW;
    this.tab = (opts && opts.tab) || 'ink';
  }
  getViewType() { return this.type; }
  getDisplayText() { return 'Captures'; }
  getIcon() { return 'camera'; }

  async onOpen() {
    this.hub = new NexusCaptureHub(this.plugin, this.contentEl, { tab: this.tab });
    await this.hub.mount();
    const bump = () => { window.clearTimeout(this._t); this._t = window.setTimeout(() => this.hub.refresh(), 400); };
    this.registerEvent(this.app.metadataCache.on('changed', bump));
    this.registerEvent(this.app.vault.on('create', bump));
    this.registerEvent(this.app.vault.on('delete', bump));
    this.registerEvent(this.app.vault.on('rename', bump));
  }
  async onClose() { window.clearTimeout(this._t); this.contentEl.empty(); }
}

module.exports = { NexusCaptureHub, NexusCaptureHubView, sketchAdapter, chatterAdapter };
