'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the image separator block
 *  Renders an image-separator code block and writes its position back.
 *  Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { TFile } = require('obsidian');

class ImageSeparator {

  /* ---- Image separator ----
     `image:` is the only required line. Everything else has a default, and an
     unreadable block still renders SOMETHING (the message) instead of vanishing
     — a separator that silently disappears would look like a broken note. */
  renderSeparator(src, el, ctx) {
    const cfg = {};
    String(src || '').split('\n').forEach(line => {
      const i = line.indexOf(':');
      if (i < 0) return;
      cfg[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    const link = cfg.image || cfg.img || cfg.src || '';
    const url = link ? this.resolveBannerSrc(link, (ctx && ctx.sourcePath) || '') : '';
    if (!url) {
      el.createDiv({ cls: 'nx-sep-missing', text: link ? 'Separator: image not found — ' + link : 'Separator: no image set.' });
      return;
    }
    const truthy = (v) => /^(true|yes|1|on)$/i.test(String(v || '').trim());
    const falsy = (v) => /^(false|no|0|off)$/i.test(String(v || '').trim());
    const strip = el.createDiv('nx-sep'
      + (truthy(cfg.fade) ? ' is-fade' : '')
      + (falsy(cfg.round) ? '' : ' is-round'));
    strip.style.setProperty('--nx-sep-h', (Math.max(2, Math.min(400, parseInt(cfg.height, 10) || 26))) + 'px');
    strip.style.setProperty('--nx-sep-pos', (Math.max(0, Math.min(100, parseInt(cfg.position, 10) || 50))) + '%');
    strip.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
    // Click to re-tune without touching the block by hand.
    strip.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath((ctx && ctx.sourcePath) || '');
      if (!(file instanceof TFile)) return;
      const { NexusSeparatorModal } = require('../modals/separator.js');
      const img = this.app.metadataCache.getFirstLinkpathDest(String(link).replace(/^!?\[\[|\]\]$/g, '').split('|')[0], ctx.sourcePath);
      new NexusSeparatorModal(this, ctx.sourcePath, (next) => this._rewriteSeparator(ctx, el, next), {
        file: img, height: parseInt(cfg.height, 10) || 26, position: parseInt(cfg.position, 10) || 50,
        fade: truthy(cfg.fade), round: !falsy(cfg.round),
      }).open();
    };
  }
  /* Replace the block's body in place (same trick as the sketch id writeback). */
  async _rewriteSeparator(ctx, el, cfg) {
    const info = ctx.getSectionInfo(el);
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!info || !(file instanceof TFile)) return;
    const body = ['image: [[' + cfg.link + ']]', 'height: ' + cfg.height, 'position: ' + cfg.position];
    if (cfg.fade) body.push('fade: true');
    if (!cfg.round) body.push('round: false');
    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...body);
      return lines.join('\n');
    });
  }
}

module.exports = ImageSeparator;
