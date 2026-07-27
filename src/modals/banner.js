'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · banner
 *  Top-banner move / choose / remove modal.
 * ========================================================================== */

const { Modal, setIcon } = require('obsidian');
const { IMG_EXT } = require('../constants.js');

class NexusBannerModal extends Modal {
  constructor(plugin, file) { super(plugin.app); this.plugin = plugin; this.file = file; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-banner-modal');
    this.modalEl.addClass('nx-banner-modal-el');   // set width on the .modal panel
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

    // ── Preview cards ──
    const folder = (this.plugin.settings.banner.folder || '').trim().replace(/^\/|\/$/g, '');
    const imgs = this.app.vault.getFiles().filter(f =>
      IMG_EXT.includes(f.extension.toLowerCase()) && (!folder || f.path.startsWith(folder + '/')));
    contentEl.createDiv({ cls: 'nx-banner-cards-label', text: 'Banner folder' });
    const grid = contentEl.createDiv('nx-banner-cards');
    if (!imgs.length) {
      grid.createDiv({ cls: 'nx-banner-cards-empty',
        text: 'No images in "' + (folder || 'Vault') + '" — import via "Choose".' });
    }
    const curLink = hasBanner ? String(fm.banner) : '';
    for (const f of imgs) {
      const card = grid.createDiv('nx-banner-card');
      if (curLink.includes(f.name)) card.addClass('is-current');
      const img = card.createEl('img');
      img.src = this.app.vault.getResourcePath(f);
      img.loading = 'lazy';
      card.createDiv({ cls: 'nx-banner-card-name', text: f.basename });
      card.onclick = () => this.apply(fr => {
        fr.banner = '[[' + this.app.metadataCache.fileToLinktext(f, this.file.path) + ']]';
      });
    }
  }
  async apply(mut) {
    await this.app.fileManager.processFrontMatter(this.file, mut);
    this.plugin.refreshBanner();
    this.close();
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusBannerModal };
