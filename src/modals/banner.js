'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · banner
 *  Top-banner move / choose / remove modal, plus the import dialog.
 *  Groups are real subfolders of the banner folder (see bannerGroups() in
 *  main.js) — the picker only renders that tree, it never stores membership.
 * ========================================================================== */

const { Modal, setIcon } = require('obsidian');
const { IMG_EXT } = require('../constants.js');
const { NexusPopupMenu } = require('./pickers.js');
const { NexusNameModal } = require('./misc.js');

const UNGROUPED = 'Ungrouped';

class NexusBannerModal extends Modal {
  constructor(plugin, file) { super(plugin.app); this.plugin = plugin; this.file = file; }
  onOpen() {
    this.contentEl.addClass('nx-banner-modal');
    this.modalEl.addClass('nx-banner-modal-el');   // set width on the .modal panel
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    const fm = (this.app.metadataCache.getFileCache(this.file) || {}).frontmatter;
    const hasBanner = !!(fm && fm.banner);

    // ── Action buttons ──
    const actions = contentEl.createDiv('nx-banner-actions');
    const mkAction = (icon, label, fn, enabled = true) => {
      const b = actions.createDiv('nx-banner-action' + (enabled ? '' : ' is-disabled'));
      setIcon(b.createDiv('nx-banner-action-icon'), icon);
      b.createDiv({ cls: 'nx-banner-action-label', text: label });
      if (enabled) b.onclick = fn;
    };
    mkAction('move', 'Move', () => { this.close(); this.plugin.startBannerDrag(this.file); }, hasBanner);
    mkAction('image-plus', 'Choose', () => { this.close(); this.plugin.importBannerFromSystem(this.file); });
    mkAction('x', 'Remove', () => this.apply(f => { delete f.banner; }), hasBanner);

    // ── Preview cards, grouped by subfolder ──
    const root = this.plugin.bannerRoot();
    const imgs = this.plugin.bannerImages();
    contentEl.createDiv({ cls: 'nx-banner-cards-label', text: 'Banner folder' });
    if (!imgs.length) {
      contentEl.createDiv({ cls: 'nx-banner-cards-empty',
        text: 'No images in "' + (root || 'Vault') + '" — import via "Choose".' });
      return;
    }

    // Named groups alphabetically, the loose images in the root last: those are
    // the not-yet-sorted ones, and they shouldn't push the tidy groups down.
    const buckets = new Map();
    for (const f of imgs) {
      const g = this.plugin.bannerGroupOf(f);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(f);
    }
    for (const g of this.plugin.bannerGroups()) if (!buckets.has(g)) buckets.set(g, []);   // empty groups stay visible
    const names = [...buckets.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (buckets.has('')) names.push('');

    const curLink = hasBanner ? String(fm.banner) : '';
    const collapsed = this.plugin.settings.banner.collapsed || (this.plugin.settings.banner.collapsed = {});
    const wrap = contentEl.createDiv('nx-banner-groups');

    for (const g of names) {
      const files = buckets.get(g).sort((a, b) => a.basename.localeCompare(b.basename));
      const sec = wrap.createDiv('nx-banner-group');
      const isOpen = !collapsed[g || UNGROUPED];
      sec.toggleClass('is-collapsed', !isOpen);

      const head = sec.createDiv('nx-banner-group-head');
      const chev = head.createDiv('nx-banner-group-chev');
      setIcon(chev, 'chevron-down');
      head.createDiv({ cls: 'nx-banner-group-name', text: g || UNGROUPED });
      head.createDiv({ cls: 'nx-banner-group-count', text: String(files.length) });
      head.onclick = async () => {
        const key = g || UNGROUPED;
        collapsed[key] = !collapsed[key];
        await this.plugin.saveSettings();
        sec.toggleClass('is-collapsed', !!collapsed[key]);
      };

      const grid = sec.createDiv('nx-banner-cards');
      if (!files.length) { grid.createDiv({ cls: 'nx-banner-cards-empty', text: 'Empty group.' }); continue; }
      for (const f of files) {
        const card = grid.createDiv('nx-banner-card');
        if (curLink.includes(f.name)) card.addClass('is-current');
        const img = card.createEl('img');
        img.src = this.app.vault.getResourcePath(f);
        img.loading = 'lazy';
        card.createDiv({ cls: 'nx-banner-card-name', text: f.basename });
        card.onclick = () => this.apply(fr => {
          fr.banner = '[[' + this.app.metadataCache.fileToLinktext(f, this.file.path) + ']]';
        });
        card.oncontextmenu = (e) => { e.preventDefault(); this.cardMenu(e, f); };
      }
    }
  }
  /* Right-click a preview → set it, move it, rename it. The destinations live
     in a SECOND step: one "Move to group …" entry instead of one row per group,
     so the menu keeps its length no matter how many groups exist. */
  cardMenu(evt, file) {
    const menu = new NexusPopupMenu(this.app, file.basename);
    menu.addItem(i => i.setTitle('Use as banner').setIcon('image').onClick(() => this.apply(fr => {
      fr.banner = '[[' + this.app.metadataCache.fileToLinktext(file, this.file.path) + ']]';
    })));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Move to group …').setIcon('folder-input').onClick(() => this.movePicker(file)));
    menu.addItem(i => i.setTitle('Rename image …').setIcon('pencil').onClick(async () => {
      const name = await new NexusNameModal(this.app, 'Rename image', file.basename).openAndGet();
      const clean = (name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
      if (!clean || clean === file.basename) return;
      const dir = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.path + '/' : '';
      await this.app.fileManager.renameFile(file, dir + clean + '.' + file.extension);
      this.render();
    }));
    menu.showAtMouseEvent(evt);
  }
  /* Step two: pick the destination. The current group is ticked and inert, so
     the menu doubles as "where does this image live right now?". */
  movePicker(file) {
    const cur = this.plugin.bannerGroupOf(file);
    const menu = new NexusPopupMenu(this.app, 'Move "' + file.basename + '" to');
    const move = async (g) => { if (await this.plugin.moveBannerToGroup(file, g)) this.render(); };
    const entry = (value, label, icon) => menu.addItem(i => {
      const isCur = value === cur;
      i.setTitle(label).setIcon(icon).setChecked(isCur).setDisabled(isCur);
      if (!isCur) i.onClick(() => move(value));
    });
    entry('', UNGROUPED, 'folder-minus');
    this.plugin.bannerGroups().forEach(g => entry(g, g, 'folder'));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('New group …').setIcon('folder-plus').onClick(async () => {
      const name = await new NexusNameModal(this.app, 'New group name', '').openAndGet();
      const clean = (name || '').trim().replace(/^\/|\/$/g, '');
      if (clean) move(clean);
    }));
    menu.showAtMouseEvent();
  }
  async apply(mut) {
    await this.app.fileManager.processFrontMatter(this.file, mut);
    this.plugin.refreshBanner();
    this.close();
  }
  onClose() { this.contentEl.empty(); }
}

/* Import dialog: filename (pre-filled from the name template) + target group.
   openAndGet() → Promise<{name, group}|null> */
class NexusBannerImportModal extends Modal {
  constructor(plugin, defName) {
    super(plugin.app);
    this.plugin = plugin;
    this.defName = defName || '';
    this.group = plugin.settings.banner.defaultGroup || '';
    this.value = null;
  }
  openAndGet() { return new Promise(res => { this._resolve = res; this.open(); }); }
  onOpen() { this.contentEl.addClass('nx-banner-import'); this.render(); }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Import banner image' });

    contentEl.createDiv({ cls: 'nx-banner-import-label', text: 'File name' });
    const inp = contentEl.createEl('input', { cls: 'nx-banner-import-input', attr: { type: 'text' } });
    inp.value = this.defName;

    contentEl.createDiv({ cls: 'nx-banner-import-label', text: 'Group' });
    const sel = contentEl.createEl('select', { cls: 'nx-banner-import-input dropdown' });
    const groups = this.plugin.bannerGroups();
    const opt = (val, label) => { const o = sel.createEl('option', { text: label }); o.value = val; return o; };
    opt('', UNGROUPED);
    groups.forEach(g => opt(g, g));
    opt('__new__', '+ New group …');
    sel.value = groups.includes(this.group) ? this.group : '';
    sel.onchange = async () => {
      if (sel.value !== '__new__') { this.group = sel.value; return; }
      const name = await new NexusNameModal(this.app, 'New group name', '').openAndGet();
      const clean = (name || '').trim().replace(/^\/|\/$/g, '');
      if (clean) { await this.plugin.ensureBannerGroup(clean); this.group = clean; }
      this.defName = inp.value;
      this.render();
    };

    const commit = () => { this.value = { name: inp.value.trim() || this.defName, group: this.group }; this.close(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    const bar = contentEl.createDiv('nx-banner-import-bar');
    bar.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    bar.createEl('button', { text: 'Import', cls: 'mod-cta' }).onclick = commit;
    window.setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); if (this._resolve) { this._resolve(this.value); this._resolve = null; } }
}

module.exports = { NexusBannerImportModal, NexusBannerModal };
