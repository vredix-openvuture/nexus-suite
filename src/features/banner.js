'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the note banner
 *  Showing a note's banner: the corner button, the image behind the title,
 *  finding the file it names. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { TFile, setIcon } = require('obsidian');
const { NexusBannerModal } = require('../modals/banner.js');
const { IMG_EXT } = require('../constants.js');

class Banner {

  /* Icon button at the top-right of the note to set/change the banner.
     On the stable view container (not inside the CM6 editor) → not cleared. */
  mountBannerControl(view) {
    if (!view) return;
    const el = view.contentEl;
    let btn = el.querySelector(':scope > .nx-banner-btn');
    if (!this.settings.banner.enabled || !view.file) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el.createDiv('nx-banner-btn');
      setIcon(btn, 'image-plus');
      btn.setAttribute('aria-label', 'Set / change banner');
      btn.onclick = () => { if (view.file) new NexusBannerModal(this, view.file).open(); };
    }
    // Icon reflects state: image-plus (no banner) vs. image (present)
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;
    setIcon(btn, fm && fm.banner ? 'image' : 'image-plus');
  }

  /* Sets CSS custom properties + a class on the view container; the image draws a
     ::before on .cm-sizer / .markdown-preview-sizer (styles.css). Robust in LP. */
  updateBanner(view) {
    if (!view) return;
    const el = view.contentEl;
    el.removeClass('nx-has-banner');
    el.removeClass('nx-banner-fade');
    el.removeClass('nx-banner-behind');
    el.style.removeProperty('--nx-banner-img');
    el.style.setProperty('--nx-banner-scroll', '0px');
    // detach the old scroll listener
    if (this._scrollRef && this._scrollRef.el) this._scrollRef.el.removeEventListener('scroll', this._scrollRef.fn);
    this._scrollRef = null;
    // remove the banner background from ALL tab bars (only the active one gets it)
    document.querySelectorAll('.workspace-tab-header-container.nx-bar-has-banner').forEach(b => {
      b.classList.remove('nx-bar-has-banner', 'nx-bar-banner-off');
      b.style.removeProperty('--nx-banner-img');
      b.style.removeProperty('--nx-banner-w');
      b.style.removeProperty('--nx-banner-x');
      b.style.removeProperty('--nx-banner-scroll');
    });
    if (!this.settings.banner.enabled || !view.file) return;
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;
    if (!fm || !fm.banner) return;

    const src = this.resolveBannerSrc(fm.banner, view.file.path);
    if (!src) return;
    const height = Number(fm['banner-height']) || this.settings.banner.height;
    const fade = (fm['banner-fade'] != null) ? !!fm['banner-fade'] : this.settings.banner.fade;
    el.style.setProperty('--nx-banner-img', 'url("' + src.replace(/"/g, '\\"') + '")');
    el.style.setProperty('--nx-banner-height', height + 'px');
    // Box uses a fixed ASPECT RATIO (width / height at the pane width the drag
    // was made at — banner-ref-w), not a fixed pixel height → the crop stays
    // identical at any pane width, only the absolute size scales with it.
    const refW = Number(fm['banner-ref-w']) || 1600;
    const posPct = Number(fm['banner-y-pct']) || 0;
    el.style.setProperty('--nx-banner-ar', String(refW / height));
    el.toggleClass('nx-banner-fade', fade);
    el.addClass('nx-has-banner');

    // Full width: measure the real pixel edges of the sizer (content) vs. the
    // editor (card) and offset the difference with negative margins. Captures
    // padding AND scrollbar edge, regardless of "readable line length" on/off.
    const sizer = el.querySelector('.cm-sizer, .markdown-preview-sizer');
    const editor = el.querySelector('.cm-editor') || el.querySelector('.markdown-reading-view') || el;
    if (sizer && editor) {
      const cs = getComputedStyle(sizer);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const sr = sizer.getBoundingClientRect();
      const er = editor.getBoundingClientRect();
      const bleedL = Math.max(0, (sr.left + padL) - er.left);
      const bleedR = Math.max(0, er.right - (sr.right - padR));
      el.style.setProperty('--nx-banner-bleed-l', bleedL + 'px');
      el.style.setProperty('--nx-banner-bleed-r', bleedR + 'px');
      el.style.setProperty('--nx-banner-bleed-t', cs.paddingTop || '0px');

      // Pan (banner-y-pct) is stored as a PERCENTAGE so it stays correct at any
      // pane width, but the "behind the tab bar" seam below needs an actual PIXEL
      // offset (it has to subtract the bar's height, which is a px quantity — you
      // can't mix that into a CSS percentage). So convert live, right here, using
      // the CURRENT width + the image's cached natural size (cover is width-driven
      // for the crop ratios this feature is used with).
      const dims = this._getBannerImgDims(src);
      let pxOffset = 0;
      if (dims && dims.w && dims.h) {
        const boxH = er.width * height / refW;             // = er.width / ar
        const renderedH = er.width * dims.h / dims.w;       // width-driven cover
        const avail = Math.max(0, renderedH - boxH);
        pxOffset = -(posPct / 100) * avail;
      }
      el.style.setProperty('--nx-banner-pos-y', pxOffset + 'px');
    }

    // Continue the banner behind the tab bar — FRAME-INDEPENDENT.
    // Instead of "100% of the bar width" (which varies by window-frame type), the
    // bar's image crop is coupled to the content banner in PIXELS:
    // same image width + same left edge → identical scaling in every frame.
    if (this.settings.banner.behindTabs) {
      const tabs = view.containerEl.closest('.workspace-tabs');
      const bar = tabs && tabs.querySelector(':scope > .workspace-tab-header-container');
      const sz = el.querySelector('.cm-sizer, .markdown-preview-sizer');
      if (bar && sz) {
        bar.style.setProperty('--nx-banner-img', el.style.getPropertyValue('--nx-banner-img'));
        bar.style.setProperty('--nx-banner-pos-y', el.style.getPropertyValue('--nx-banner-pos-y') || '0px');
        bar.classList.add('nx-bar-has-banner');
        el.addClass('nx-banner-behind');

        // Measure geometry: bar height, seam (bleed-top), and the pixel width and
        // X offset of the bar image — coupled to the (always editor-width)
        // content banner. Wrapped in a function → callable again on scroll, so
        // the seam self-corrects (no grey bar).
        const edEl = el.querySelector('.cm-editor') || el.querySelector('.markdown-reading-view') || el;
        const measure = () => {
          const barRect = bar.getBoundingClientRect();
          const er = edEl.getBoundingClientRect();
          el.style.setProperty('--nx-banner-bar-h', barRect.height + 'px');
          // The bar image = exactly as wide and left-aligned as the content banner
          bar.style.setProperty('--nx-banner-w', er.width + 'px');
          bar.style.setProperty('--nx-banner-x', (er.left - barRect.left) + 'px');
          // EXACT distance banner top edge → bar bottom edge (kills the bar).
          // Round to whole pixels → less subpixel jitter.
          const padTop = parseFloat(getComputedStyle(sz).paddingTop) || 0;
          const gap = Math.max(0, Math.round((sz.getBoundingClientRect().top + padTop) - barRect.bottom));
          el.style.setProperty('--nx-banner-bleed-t', gap + 'px');
        };
        measure();

        // Couple the image behind the bar to the scroll position → scrolls along.
        // IMPORTANT: set the variable on the BAR (it is not a child of el, so it
        // doesn't see el's variables).
        const scroller = el.querySelector('.cm-scroller');
        if (scroller) {
          let raf = 0;
          const fn = () => {
            const sc = scroller.scrollTop;
            bar.style.setProperty('--nx-banner-scroll', sc + 'px');
            // show the bar banner only within the banner area (not beyond it)
            bar.classList.toggle('nx-bar-banner-off', sc > height);
            // In the visible seam area, re-measure geometry (throttled) →
            // self-healing against the grey bar after scrolling up/down.
            if (sc <= height && !raf) raf = requestAnimationFrame(() => { raf = 0; measure(); });
          };
          scroller.addEventListener('scroll', fn, { passive: true });
          this._scrollRef = { el: scroller, fn };
          fn();
        }
      }
    }
  }
  // Cache of { w, h } natural image size per resolved banner src, so
  // updateBanner() can convert the stored pan PERCENTAGE into a live pixel
  // offset synchronously (needed only for the tab-bar seam calc, see above) —
  // no repeated image loads, and no async work on the hot render path.
  _getBannerImgDims(src) {
    if (!this._bannerImgDims) this._bannerImgDims = new Map();
    if (this._bannerImgDims.has(src)) return this._bannerImgDims.get(src);
    if (!this._bannerImgLoading) this._bannerImgLoading = new Set();
    if (!this._bannerImgLoading.has(src)) {
      this._bannerImgLoading.add(src);
      const im = new Image();
      im.onload = () => {
        this._bannerImgDims.set(src, { w: im.naturalWidth, h: im.naturalHeight });
        this._bannerImgLoading.delete(src);
        this.refreshBanner();
      };
      im.onerror = () => this._bannerImgLoading.delete(src);
      im.src = src;
    }
    return null;
  }

  resolveBannerSrc(value, sourcePath) {
    value = String(value).trim();
    const wl = value.match(/^!?\[\[([^\]|]+)(\|[^\]]*)?\]\]$/);
    if (wl) {
      const name = wl[1].trim();
      const dest = this.app.metadataCache.getFirstLinkpathDest(name, sourcePath);
      if (dest) return this.app.vault.getResourcePath(dest);
      // The link cache is not populated yet (the usual case on a cold mobile
      // start) or the image was moved. Resolve it against the vault ourselves
      // before giving up — "the banner shows on one device but not the other"
      // is nearly always this, not a genuinely missing file.
      const loose = this._findImageLoose(name, sourcePath);
      if (loose) return this.app.vault.getResourcePath(loose);
      this._retryBannerSoon();
      return null;
    }
    if (/^https?:\/\//.test(value)) return value;
    const f = this.app.vault.getAbstractFileByPath(value) || this._findImageLoose(value, sourcePath);
    if (f) return this.app.vault.getResourcePath(f);
    // NEVER hand an unresolved string back: it used to end up inside url(…),
    // which renders as a silently broken banner instead of no banner at all.
    this._retryBannerSoon();
    return null;
  }

  /* Best-effort lookup for an image reference the link cache could not resolve:
     exact path, then relative to the note, then inside the banner folder, and
     finally a UNIQUE basename match anywhere in the vault. */
  _findImageLoose(name, sourcePath) {
    const at = (p) => { const f = p && this.app.vault.getAbstractFileByPath(p); return (f instanceof TFile) ? f : null; };
    let f = at(name);
    if (f) return f;
    const dir = (sourcePath || '').split('/').slice(0, -1).join('/');
    if (dir) { f = at(dir + '/' + name); if (f) return f; }
    const root = this.bannerRoot();
    if (root) { f = at(root + '/' + name); if (f) return f; }
    const base = name.split('/').pop().toLowerCase();
    const hits = this.app.vault.getFiles().filter(x =>
      IMG_EXT.includes(x.extension.toLowerCase()) &&
      (x.name.toLowerCase() === base || x.basename.toLowerCase() === base));
    return hits.length === 1 ? hits[0] : null;   // ambiguous → don't guess
  }

  /* One delayed re-render after a failed resolve, bounded so a reference to a
     genuinely absent file can never turn into an endless refresh loop. The
     counter resets whenever the metadata cache reports itself resolved. */
  _retryBannerSoon() {
    if (this._bannerRetryT) return;
    if ((this._bannerRetries || 0) >= 8) return;
    this._bannerRetries = (this._bannerRetries || 0) + 1;
    this._bannerRetryT = window.setTimeout(() => { this._bannerRetryT = null; this.refreshBanner(); }, 900);
  }
}

module.exports = Banner;
