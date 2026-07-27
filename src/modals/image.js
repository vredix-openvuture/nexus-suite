'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · image config
 *  Hero image config, vault image picker, zoom/crop adjust.
 * ========================================================================== */

const { Modal, Setting, SuggestModal, setIcon } = require('obsidian');
const { IMG_EXT } = require('../constants.js');
const { NexusNameModal } = require('./misc.js');

class NexusImageConfigModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() {
    this.contentEl.addClass('nx-cardcfg', 'nx-imgcfg');
    // Migrate a legacy single-image widget into the images[] list.
    if (!Array.isArray(this.item.images)) this.item.images = this.item.src ? [this.item.src] : [];
    this._render();
  }
  async _save(rerender) {
    // Keep item.src pointing at the first image (back-compat + zoom/crop preview).
    if (this.item.images.length) this.item.src = this.item.images[0];
    await this.plugin.saveSettings();
    if (rerender) this.view.render();
  }
  _render() {
    const c = this.contentEl; c.empty();
    c.createEl('h3', { text: 'Image / slideshow' });
    const it = this.item;

    new Setting(c).setName('Clickable').setDesc('Click opens the link (or the current image).')
      .addToggle(t => t.setValue(it.clickable !== false).onChange(async v => { it.clickable = v; await this._save(true); }));
    new Setting(c).setName('Link (note / URL)').setDesc('Optional target opened on click.')
      .addText(t => t.setPlaceholder('[[Note]] or https://…').setValue(it.link || '').onChange(async v => { it.link = v.trim(); await this._save(false); }));
    new Setting(c).setName('Slideshow interval (seconds)').setDesc('Time per image when 2+ images are set.')
      .addText(t => { t.inputEl.type = 'number'; t.inputEl.min = '1'; t.setValue(String(it.interval || 5))
        .onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n)) { it.interval = Math.max(1, n); await this._save(true); } }); });

    c.createEl('div', { cls: 'nx-cardcfg-sec', text: it.images.length > 1 ? 'Images (slideshow)' : 'Images' });
    const listEl = c.createDiv('nx-imgcfg-list');
    if (!it.images.length) listEl.createEl('div', { cls: 'setting-item-description', text: '— no images yet —' });
    it.images.forEach((src, i) => {
      const short = src.length > 46 ? '…' + src.slice(-46) : src;
      const row = new Setting(listEl).setName(short);
      row.addExtraButton(b => b.setIcon('arrow-up').setTooltip('Move up').setDisabled(i === 0)
        .onClick(async () => { const a = it.images; [a[i - 1], a[i]] = [a[i], a[i - 1]]; await this._save(true); this._render(); }));
      row.addExtraButton(b => b.setIcon('arrow-down').setTooltip('Move down').setDisabled(i === it.images.length - 1)
        .onClick(async () => { const a = it.images; [a[i + 1], a[i]] = [a[i], a[i + 1]]; await this._save(true); this._render(); }));
      row.addExtraButton(b => b.setIcon('trash-2').setTooltip('Remove')
        .onClick(async () => { it.images.splice(i, 1); await this._save(true); this._render(); }));
    });

    const add = new Setting(c).setName('Add image');
    add.addButton(b => b.setButtonText('From vault').onClick(() =>
      new NexusVaultImageModal(this.app, async (p) => { it.images.push(p); await this._save(true); this._render(); }).open()));
    add.addButton(b => b.setButtonText('URL').onClick(async () => {
      const u = await new NexusNameModal(this.app, 'Image URL', '').openAndGet();
      if (u) { it.images.push(u.trim()); await this._save(true); this._render(); }
    }));
    add.addButton(b => b.setButtonText('Import file').onClick(() => this._importFile()));

    new Setting(c).addButton(b => b.setButtonText('Done').setCta().onClick(() => this.close()));
  }
  _importFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0]; if (!f) return;
      const dir = 'attachments/homepage';
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = dir + '/img-' + Date.now() + '.' + ext;
      await this.app.vault.createBinary(path, await f.arrayBuffer());
      this.item.images.push(path); await this._save(true); this._render();
    };
    input.click();
  }
  onClose() { this.contentEl.empty(); }
}

/* Searchable vault image picker (with thumbnails). */

/* Searchable vault image picker (with thumbnails). */
class NexusVaultImageModal extends SuggestModal {
  constructor(app, onPick) { super(app); this.onPick = onPick; this.setPlaceholder('Search vault images …'); }
  getSuggestions(q) {
    q = (q || '').toLowerCase();
    return this.app.vault.getFiles()
      .filter(f => IMG_EXT.includes(f.extension.toLowerCase()) && f.path.toLowerCase().includes(q))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 60);
  }
  renderSuggestion(f, el) {
    el.addClass('nx-vaultimg-suggest');
    const thumb = el.createEl('img', { cls: 'nx-vaultimg-thumb' });
    try { thumb.src = this.app.vault.getResourcePath(f); } catch (_) {}
    el.createSpan({ cls: 'nx-vaultimg-path', text: f.path });
  }
  onChooseSuggestion(f) { this.onPick(f.path); }
}

class NexusImageAdjustModal extends Modal {
  constructor(plugin, view, item) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-imgadj');
    contentEl.createEl('h3', { text: 'Adjust image' });
    const item = this.item;
    let fit = item.fit || 'contain', zoom = item.zoom || 1;
    let posX = item.posX != null ? item.posX : 50, posY = item.posY != null ? item.posY : 50;

    const prev = contentEl.createDiv('nx-imgadj-prev');
    const img = prev.createEl('img');
    const src = this.plugin.resolveBannerSrc(item.src || '', '');
    if (src) img.src = src;
    img.draggable = false;
    const apply = () => {
      img.style.objectFit = fit;
      img.style.objectPosition = posX + '% ' + posY + '%';
      img.style.transform = 'scale(' + zoom + ')';
    };
    apply();

    // Drag in the preview field → position (pan)
    let drag = false, sx = 0, sy = 0, spx = 50, spy = 50;
    prev.addEventListener('pointerdown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; spx = posX; spy = posY; try { prev.setPointerCapture(e.pointerId); } catch (_) {} });
    prev.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = prev.getBoundingClientRect();
      posX = Math.max(0, Math.min(100, spx - (e.clientX - sx) / r.width * 100));
      posY = Math.max(0, Math.min(100, spy - (e.clientY - sy) / r.height * 100));
      apply();
    });
    const stop = () => { drag = false; };
    prev.addEventListener('pointerup', stop);
    prev.addEventListener('pointerleave', stop);

    new Setting(contentEl).setName('Zoom').addSlider(sl => sl.setLimits(1, 4, 0.05).setValue(zoom).setDynamicTooltip().onChange(v => { zoom = v; apply(); }));
    new Setting(contentEl).setName('Mode').setDesc('Fill enables panning/zooming without borders.').addDropdown(dd => dd
      .addOption('contain', 'Fit (whole image)').addOption('cover', 'Fill (crop)')
      .setValue(fit).onChange(v => { fit = v; apply(); }));
    contentEl.createEl('p', { cls: 'setting-item-description', text: 'Drag in the preview to reposition.' });

    new Setting(contentEl)
      .addButton(b => b.setButtonText('Reset').onClick(() => { fit = 'contain'; zoom = 1; posX = 50; posY = 50; apply(); }))
      .addButton(b => b.setButtonText('Save').setCta().onClick(async () => {
        item.fit = fit; item.zoom = zoom; item.posX = Math.round(posX); item.posY = Math.round(posY);
        await this.plugin.saveSettings(); this.view.render(); this.close();
      }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusImageConfigModal, NexusVaultImageModal, NexusImageAdjustModal };
