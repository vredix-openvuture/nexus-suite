'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · image separator
 *  Picks an image to use as a thin divider inside a note.
 *
 *  The whole point is that NO image has to be prepared for it: the strip is a
 *  window onto the full picture (background-size: cover), so any photo becomes a
 *  separator by choosing how tall the window is and which band of the image it
 *  shows. Nothing is cropped on disk — the same file still works as a full
 *  banner, and moving the band later is a number, not a new export.
 *
 *  The gallery is the banner folder with its groups, exactly like the banner
 *  picker: separators and banners are the same pool of images.
 * ========================================================================== */

const { Modal, setIcon } = require('obsidian');
const { NexusNameModal } = require('./misc.js');

const UNGROUPED = 'Ungrouped';

class NexusSeparatorModal extends Modal {
  /* onPick({link, height, position, fade, round}) */
  constructor(plugin, sourcePath, onPick, initial) {
    super(plugin.app);
    this.plugin = plugin;
    this.sourcePath = sourcePath || '';
    this.onPick = onPick;
    const s = plugin.settings.banner || {};
    const d = initial || {};
    this.sel = d.file || null;
    this.height = d.height || s.sepHeight || 26;
    this.position = d.position != null ? d.position : (s.sepPosition != null ? s.sepPosition : 50);
    this.fade = d.fade != null ? !!d.fade : !!s.sepFade;
    this.round = d.round != null ? !!d.round : (s.sepRound !== false);
  }
  onOpen() {
    this.contentEl.addClass('nx-banner-modal');
    this.contentEl.addClass('nx-sep-modal');
    this.modalEl.addClass('nx-banner-modal-el');
    this.render();
  }

  /* The live strip: what lands in the note, at the size it will have there. */
  preview(parent) {
    const box = parent.createDiv('nx-sep-preview');
    const strip = box.createDiv('nx-sep' + (this.fade ? ' is-fade' : '') + (this.round ? ' is-round' : ''));
    strip.style.setProperty('--nx-sep-h', this.height + 'px');
    strip.style.setProperty('--nx-sep-pos', this.position + '%');
    if (this.sel) strip.style.backgroundImage = 'url("' + this.app.vault.getResourcePath(this.sel).replace(/"/g, '\\"') + '")';
    else box.createDiv({ cls: 'nx-sep-preview-hint', text: 'Pick an image below.' });
    return strip;
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Image separator' });

    this.preview(contentEl);

    // ── the two numbers that make a photo into a strip ──
    const ctl = contentEl.createDiv('nx-sep-controls');
    const slider = (label, value, min, max, step, unit, onInput) => {
      const row = ctl.createDiv('nx-sep-row');
      const head = row.createDiv('nx-sep-row-head');
      head.createSpan({ text: label });
      const out = head.createSpan({ cls: 'nx-sep-val', text: value + unit });
      const r = row.createEl('input', { type: 'range' });
      r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(value);
      r.oninput = () => { out.setText(r.value + unit); onInput(Number(r.value)); };
      return r;
    };
    slider('Height', this.height, 6, 160, 1, ' px', v => { this.height = v; this.refreshPreview(); });
    slider('Image band', this.position, 0, 100, 1, ' %', v => { this.position = v; this.refreshPreview(); });

    const toggles = ctl.createDiv('nx-sep-toggles');
    const toggle = (label, on, set) => {
      const b = toggles.createDiv('nx-sep-toggle' + (on ? ' is-on' : ''));
      b.setText(label);
      b.onclick = () => { const next = !b.hasClass('is-on'); b.toggleClass('is-on', next); set(next); this.refreshPreview(); };
    };
    toggle('Fade at the edges', this.fade, v => { this.fade = v; });
    toggle('Rounded', this.round, v => { this.round = v; });

    // ── actions ──
    const actions = contentEl.createDiv('nx-banner-actions');
    const mkAction = (icon, label, fn, enabled = true) => {
      const b = actions.createDiv('nx-banner-action' + (enabled ? '' : ' is-disabled'));
      setIcon(b.createDiv('nx-banner-action-icon'), icon);
      b.createDiv({ cls: 'nx-banner-action-label', text: label });
      if (enabled) b.onclick = fn;
    };
    mkAction('image-plus', 'New image …', async () => {
      const img = await this.plugin.importBannerImage(null);
      if (img) { this.sel = img; this.render(); }
    });
    mkAction('check', 'Insert', () => this.commit(), !!this.sel);

    // ── gallery, grouped like the banner picker ──
    const imgs = this.plugin.bannerImages();
    contentEl.createDiv({ cls: 'nx-banner-cards-label', text: 'Banner folder' });
    if (!imgs.length) {
      contentEl.createDiv({ cls: 'nx-banner-cards-empty',
        text: 'No images in "' + (this.plugin.bannerRoot() || 'Vault') + '" — add one via "New image …".' });
      return;
    }
    const buckets = new Map();
    for (const f of imgs) {
      const g = this.plugin.bannerGroupOf(f);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(f);
    }
    for (const g of this.plugin.bannerGroups()) if (!buckets.has(g)) buckets.set(g, []);
    const names = [...buckets.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (buckets.has('')) names.push('');

    const collapsed = this.plugin.settings.banner.collapsed || (this.plugin.settings.banner.collapsed = {});
    const wrap = contentEl.createDiv('nx-banner-groups');
    for (const g of names) {
      const files = buckets.get(g).sort((a, b) => a.basename.localeCompare(b.basename));
      const sec = wrap.createDiv('nx-banner-group');
      sec.toggleClass('is-collapsed', !!collapsed[g || UNGROUPED]);
      const head = sec.createDiv('nx-banner-group-head');
      setIcon(head.createDiv('nx-banner-group-chev'), 'chevron-down');
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
        if (this.sel && this.sel.path === f.path) card.addClass('is-current');
        const img = card.createEl('img');
        img.src = this.app.vault.getResourcePath(f);
        img.loading = 'lazy';
        card.createDiv({ cls: 'nx-banner-card-name', text: f.basename });
        // One click selects (the preview answers "does this work as a strip?"),
        // a second one inserts — pick-then-look, not pick-and-hope.
        card.onclick = () => { if (this.sel && this.sel.path === f.path) this.commit(); else { this.sel = f; this.render(); } };
      }
    }
  }
  refreshPreview() {
    const box = this.contentEl.querySelector('.nx-sep-preview');
    if (!box) return;
    box.empty();
    const strip = box.createDiv('nx-sep' + (this.fade ? ' is-fade' : '') + (this.round ? ' is-round' : ''));
    strip.style.setProperty('--nx-sep-h', this.height + 'px');
    strip.style.setProperty('--nx-sep-pos', this.position + '%');
    if (this.sel) strip.style.backgroundImage = 'url("' + this.app.vault.getResourcePath(this.sel).replace(/"/g, '\\"') + '")';
  }
  async commit() {
    if (!this.sel) return;
    // Remember the shape, not the image: the next separator in the vault should
    // start out looking like the last one.
    const s = this.plugin.settings.banner;
    s.sepHeight = this.height; s.sepPosition = this.position; s.sepFade = this.fade; s.sepRound = this.round;
    await this.plugin.saveSettings();
    const link = this.app.metadataCache.fileToLinktext(this.sel, this.sourcePath);
    if (this.onPick) this.onPick({ link, height: this.height, position: this.position, fade: this.fade, round: this.round });
    this.close();
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusSeparatorModal };
