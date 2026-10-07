'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · PDF embeds of ink captures
 *  The page viewer that replaces Obsidian's PDF embed inside an ink note.
 *  Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { loadPdfJs } = require('obsidian');
const { nxPdfDestPage } = require('../lib/helpers.js');

class InkPdfEmbeds {

  /* Obsidian's native PDF embed loads the file via an XHR fetch that
     Chromium's CORS policy blocks for the app:// protocol on this setup
     (cross-origin between the pdf-viewer iframe's fixed origin and the
     vault's resource origin) — confirmed via the console: "blocked by CORS
     policy... Unexpected server response (0)". That's Electron/Chromium's own
     scheme-CORS enforcement, not something a plugin's CSS/JS can turn off, and
     it isn't specific to Ink Capture files — ANY embedded PDF anywhere hits
     it, including an ink-capture note re-embedded inside a completely
     unrelated note. So this runs for every markdown view, not just ones whose
     OWN frontmatter says type: ink-capture — each embed resolves its own link
     target instead of trusting the view's ink-file frontmatter. Workaround:
     replace the broken embed with our own tiny canvas viewer that reads the
     file as raw bytes via the Vault API (same technique _makeInkPdfThumb
     already uses successfully) — no fetch/XHR at all, so no CORS involved. */
  updateInkPdfEmbeds(view) {
    if (!view || !view.file) return;
    const embeds = view.contentEl.querySelectorAll('.internal-embed.pdf-embed:not(.nx-ink-pdf-done)');
    embeds.forEach((el) => {
      const src = el.getAttribute('src') || el.getAttribute('data-href');
      if (!src) return;
      const target = this.app.metadataCache.getFirstLinkpathDest(src, view.file.path);
      if (!target || target.extension.toLowerCase() !== 'pdf') return;
      el.addClass('nx-ink-pdf-done');
      this._renderInkPdfEmbed(el, target).catch((e) => console.error('[Nexus] ink pdf embed:', e));
    });
  }
  async _renderInkPdfEmbed(el, file) {
    el.empty();
    el.removeAttribute('style');   // clear any inline width/height Obsidian's own embed sizing left behind — it beats our stylesheet regardless of selector specificity
    // Belt-and-suspenders: stylesheet !important on max-height still lost a
    // specificity/load-order coin-flip against the theme once already — an
    // inline !important (only settable via JS setProperty, not cssText) beats
    // ANY external stylesheet rule, !important or not, so this ends the
    // cascade guessing for good.
    el.style.setProperty('max-height', 'none', 'important');
    // height:auto too — Obsidian's app.css pins Live-Preview PDF embeds to a
    // fixed height:800px via a higher-specificity selector
    // (.markdown-source-view.mod-cm6 .cm-content > .pdf-embed), which
    // bottom-clipped any page taller than that under our overflow:hidden.
    el.style.setProperty('height', 'auto', 'important');
    el.addClass('nx-ink-pdf-viewer');
    el.createDiv({ cls: 'nx-ink-pdf-loading', text: 'Loading PDF…' });
    // Obsidian's OWN native PDF viewer initializes asynchronously and, once
    // its promise resolves, appends its own (CORS-broken) toolbar into this
    // SAME container — AFTER we've already replaced the content. Watch for
    // any direct child we didn't add ourselves and remove it on sight, rather
    // than trying to guess when Obsidian's init finishes. Scoped to direct
    // children only (no subtree) so it never touches our OWN nested updates
    // inside .nx-ink-pdf-body (page canvases etc.).
    const ours = new Set(['nx-ink-pdf-loading', 'nx-ink-pdf-toolbar', 'nx-ink-pdf-body']);
    // A boolean flag, NOT a string comparison — comparing el.getAttribute('style')
    // against a remembered string caused an infinite loop (the browser
    // normalizes the style text differently than we wrote it, so the
    // "correction" itself always looked like yet another foreign change,
    // re-triggering the observer forever and hanging/crashing Obsidian). The
    // flag is set synchronously right before OUR OWN style write and consumed
    // by the very next mutation callback, with no string matching involved.
    let selfStyleChange = false;
    const setElStyle = (css) => { selfStyleChange = true; el.style.cssText = css; };
    const guard = new MutationObserver((muts) => {
      muts.forEach((m) => {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          if (selfStyleChange) { selfStyleChange = false; return; }
          el.removeAttribute('style');   // not ours — Obsidian's own init re-applying a stray inline size
        }
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && ![...n.classList].some((c) => ours.has(c))) n.remove();
        });
      });
    });
    guard.observe(el, { childList: true, attributes: true, attributeFilter: ['style'] });
    if (!window.pdfjsLib) await loadPdfJs();
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) { el.empty(); el.createDiv({ cls: 'nx-ink-pdf-loading', text: 'PDF.js unavailable.' }); return; }
    const buf = await this.app.vault.readBinary(file);
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    (this._inkPdfDocs || (this._inkPdfDocs = [])).push(pdf);
    const outline = await pdf.getOutline().catch(() => null);
    el.empty();

    // Pages are ALWAYS rendered complete, whitespace and all. Two attempts
    // at auto-cropping ink-capture pages to their content (Saber exports
    // fixed 1000x1400pt pages however little is written on them) both failed
    // runtime review (2026-07-16): bbox-cropping stretched a tiny word into
    // a giant blurry blob, and bottom-trimming still read as "the page is
    // cut off" to the user — a page should simply look like the page.

    // mode: 'page' (one at a time) | 'book' (two pages side by side) | 'endless' (all stacked, scroll)
    let pageNum = 1, mode = 'page';
    // Tracks the el.clientWidth a page was actually rasterized at, so the
    // ResizeObserver below (added further down) knows whether a resize is
    // big enough to be worth a re-render, and so canvas CSS size is always
    // set as an explicit px value computed from THIS width — never a "100%"
    // percentage left for the browser to resolve against canvas's intrinsic
    // width/height attributes, which is what silently went stale (and once
    // clipped the page) whenever the container was resized after the initial
    // render without anything telling us to re-rasterize.
    let lastRenderWidth = 0;
    const DEFAULT_SIZE_PCT = 50;   // matches the CSS default width:50%; portrait pages got uncomfortably huge at 80%
    let sizePct = DEFAULT_SIZE_PCT;
    // Three flex groups (left/center/right) instead of one flat row — TOC on
    // the far left, page-nav + mode in the middle, size controls on the far
    // right, per the user's requested layout.
    const toolbar = el.createDiv('nx-ink-pdf-toolbar');
    const tbLeft = toolbar.createDiv('nx-ink-pdf-toolbar-group');
    const tbCenter = toolbar.createDiv('nx-ink-pdf-toolbar-group nx-ink-pdf-toolbar-center');
    const tbRight = toolbar.createDiv('nx-ink-pdf-toolbar-group');

    const tocBtn = tbLeft.createEl('button', { cls: 'nx-ink-pdf-nav', text: '☰' });
    tocBtn.setAttribute('aria-label', 'Table of contents');
    const bookBtn = tbLeft.createEl('button', { cls: 'nx-ink-pdf-nav', text: '⧉' });
    bookBtn.setAttribute('aria-label', 'Book mode (two pages side by side)');
    const modeBtn = tbLeft.createEl('button', { cls: 'nx-ink-pdf-nav', text: '⇕' });
    modeBtn.setAttribute('aria-label', 'Endless scroll mode');
    const sizeDownBtn = tbCenter.createEl('button', { cls: 'nx-ink-pdf-nav', text: '−' });
    sizeDownBtn.setAttribute('aria-label', 'Smaller');
    const sizeResetBtn = tbCenter.createEl('button', { cls: 'nx-ink-pdf-nav', text: '⟳' });
    sizeResetBtn.setAttribute('aria-label', 'Reset size');
    const sizeUpBtn = tbCenter.createEl('button', { cls: 'nx-ink-pdf-nav', text: '+' });
    sizeUpBtn.setAttribute('aria-label', 'Bigger');
    const prevBtn = tbRight.createEl('button', { cls: 'nx-ink-pdf-nav', text: '‹' });
    const label = tbRight.createSpan({ cls: 'nx-ink-pdf-pagelabel' });
    const nextBtn = tbRight.createEl('button', { cls: 'nx-ink-pdf-nav', text: '›' });
    // Resizes the whole viewer (not just the internal render resolution) —
    // .nx-ink-pdf-canvas is width:100% of its container, so the container's
    // OWN size is what actually determines how big it looks; re-rendering
    // afterward re-measures el.clientWidth so the page stays crisp at the
    // new size instead of just being CSS-stretched (which would blur it,
    // same lesson as the SVG hover-zoom).
    // Sets BOTH width and max-width — the stylesheet now has an explicit
    // width:80% too (needed for centering on inline-block-forced embeds), and
    // width+max-width together resolve to whichever is smaller, so an inline
    // max-width alone couldn't grow past the stylesheet's width at all.
    // max-height:none!important must be repeated here every time — setElStyle
    // replaces the WHOLE inline style (cssText), so without it the size
    // buttons would wipe out the forced-max-height fix on their first click.
    const applySize = () => { setElStyle('width:' + sizePct + '%!important;max-width:' + sizePct + '%!important;height:auto!important;max-height:none!important;'); return render(); };
    sizeDownBtn.onclick = () => { sizePct = Math.max(30, sizePct - 10); applySize(); };
    sizeUpBtn.onclick = () => { sizePct = Math.min(100, sizePct + 10); applySize(); };
    sizeResetBtn.onclick = () => { sizePct = DEFAULT_SIZE_PCT; applySize(); };

    const body = el.createDiv('nx-ink-pdf-body');
    const tocPanel = body.createDiv('nx-ink-pdf-toc');
    const pagesWrap = body.createDiv('nx-ink-pdf-pages');
    // Direct inline-style toggle instead of a CSS class + descendant selector
    // (.nx-ink-pdf-body.nx-ink-pdf-toc-open .nx-ink-pdf-toc) — one unambiguous
    // place setting the actual width, nothing relying on class-combinator
    // matching that could silently fail to line up.
    let tocOpen = false;
    const setTocOpen = (open) => {
      tocOpen = open;
      tocPanel.style.width = open ? '260px' : '0';
      tocPanel.style.padding = open ? '8px' : '0';
      tocPanel.style.borderRightColor = open ? 'var(--nx-border, var(--background-modifier-border))' : 'transparent';
      tocBtn.toggleClass('is-active', open);
    };

    const renderOutlineList = (parent, items) => {
      const ul = parent.createEl('ul', { cls: 'nx-ink-pdf-toc-list' });
      items.forEach((it) => {
        const li = ul.createEl('li');
        const a = li.createEl('a', { text: it.title || '…' });
        a.onclick = async (e) => {
          e.preventDefault();
          const n = await nxPdfDestPage(pdf, it.dest);
          if (n) { setTocOpen(false); jumpTo(n); }
        };
        if (it.items && it.items.length) renderOutlineList(li, it.items);
      });
    };
    // Built lazily on first open, not eagerly — rendering a thumbnail per
    // page up front would do a lot of pdf.js work nobody may ever look at.
    let tocBuilt = false;
    const buildToc = async () => {
      if (tocBuilt) return;
      tocBuilt = true;
      tocPanel.createDiv({ cls: 'nx-ink-pdf-toc-heading', text: 'Pages' });
      const grid = tocPanel.createDiv('nx-ink-pdf-toc-thumbs');
      for (let n = 1; n <= pdf.numPages; n++) {
        const thumb = grid.createDiv('nx-ink-pdf-toc-thumb');
        const canvas = thumb.createEl('canvas');
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 110 / base.width });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = '110px';
        canvas.style.height = (110 * canvas.height / canvas.width) + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        thumb.createDiv({ cls: 'nx-ink-pdf-toc-thumb-label', text: String(n) });
        thumb.onclick = () => { setTocOpen(false); jumpTo(n); };
      }
      if (outline && outline.length) {
        tocPanel.createDiv({ cls: 'nx-ink-pdf-toc-heading', text: 'Outline' });
        renderOutlineList(tocPanel, outline);
      }
    };
    // Toggle the panel FIRST, build its (possibly slow, possibly failing)
    // content after — otherwise a thrown error inside buildToc (e.g. a page
    // that fails to render) left the button looking completely dead, since
    // the toggle used to run only after buildToc had already resolved.
    tocBtn.onclick = () => {
      try {
        setTocOpen(!tocOpen);
      } catch (e) { console.error('[Nexus] ink pdf toc toggle:', e); }
      buildToc().catch((e) => console.error('[Nexus] ink pdf toc build:', e));
    };

    const renderPageMode = async () => {
      pagesWrap.removeClass('nx-ink-pdf-book');
      pagesWrap.empty();
      const page = await pdf.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      lastRenderWidth = el.clientWidth || 700;
      const viewport = page.getViewport({ scale: lastRenderWidth / base.width });
      const canvas = pagesWrap.createEl('canvas', { cls: 'nx-ink-pdf-canvas' });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // Explicit px width/height, not CSS width:100%;height:auto — that left
      // the actual displayed size up to the browser re-deriving it from the
      // canvas's raster attributes on every layout, which went stale (and
      // once clipped the page under overflow:hidden) as soon as the
      // container was resized without a re-render telling it otherwise.
      // Set BEFORE the async render so layout is stable while pdf.js draws.
      canvas.style.width = lastRenderWidth + 'px';
      canvas.style.height = (lastRenderWidth * canvas.height / canvas.width) + 'px';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      label.setText(pageNum + ' / ' + pdf.numPages);
      prevBtn.toggleClass('is-disabled', pageNum <= 1);
      nextBtn.toggleClass('is-disabled', pageNum >= pdf.numPages);
    };
    const renderBookMode = async () => {
      pagesWrap.addClass('nx-ink-pdf-book');
      pagesWrap.empty();
      const right = pageNum + 1 <= pdf.numPages ? pageNum + 1 : null;
      lastRenderWidth = el.clientWidth || 700;
      const targetW = (lastRenderWidth - 10) / 2;   // minus the gap between the two pages
      for (const n of [pageNum, right]) {
        if (!n) continue;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: targetW / base.width });
        const canvas = pagesWrap.createEl('canvas', { cls: 'nx-ink-pdf-canvas' });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        // Book-mode canvases are flex:1 1 0;width:auto (equal-width row) —
        // only height needs to be pinned explicitly, matching whatever
        // width flex ends up giving this canvas (~targetW either way).
        canvas.style.height = (targetW * canvas.height / canvas.width) + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
      label.setText(right ? pageNum + '-' + right + ' / ' + pdf.numPages : pageNum + ' / ' + pdf.numPages);
      prevBtn.toggleClass('is-disabled', pageNum <= 1);
      nextBtn.toggleClass('is-disabled', !right);
    };
    const renderEndlessMode = async () => {
      pagesWrap.removeClass('nx-ink-pdf-book');
      pagesWrap.empty();
      label.setText(pdf.numPages + ' pages');
      lastRenderWidth = el.clientWidth || 700;
      const targetW = lastRenderWidth;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: targetW / base.width });
        const canvas = pagesWrap.createEl('canvas', { cls: 'nx-ink-pdf-canvas', attr: { 'data-page': n } });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = targetW + 'px';
        canvas.style.height = (targetW * canvas.height / canvas.width) + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
    };
    const render = () => {
      if (mode === 'page') return renderPageMode();
      if (mode === 'book') return renderBookMode();
      return renderEndlessMode();
    };
    // Nothing previously told the canvases to re-rasterize when the note
    // pane itself got wider/narrower (splitting panes, resizing the window,
    // toggling a sidebar) — only our own size buttons triggered a re-render.
    // The canvas raster stayed pinned to whatever el.clientWidth was at the
    // last render, and left the rest to CSS width:100%/height:auto to catch
    // up, which is exactly what silently drifted out of sync (and, combined
    // with overflow:hidden, could clip the page). A ResizeObserver re-renders
    // whenever el's actual width changes meaningfully; the width check
    // against lastRenderWidth avoids re-triggering on our OWN render() calls
    // (which don't change el's outer size) or looping on sub-pixel noise.
    let resizeRaf = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        const w = el.clientWidth;
        if (!w || Math.abs(w - lastRenderWidth) < 2) return;
        render();
      });
    });
    resizeObserver.observe(el);
    const jumpTo = async (n) => {
      pageNum = Math.min(Math.max(1, n), pdf.numPages);
      if (mode === 'endless') { const c = pagesWrap.querySelector('[data-page="' + pageNum + '"]'); if (c) c.scrollIntoView({ block: 'start' }); }
      else await render();
    };

    prevBtn.onclick = () => {
      if (mode === 'book') { if (pageNum > 1) { pageNum = Math.max(1, pageNum - 2); renderBookMode(); } }
      else if (mode === 'page' && pageNum > 1) { pageNum--; renderPageMode(); }
    };
    nextBtn.onclick = () => {
      if (mode === 'book') { if (pageNum + 1 < pdf.numPages) { pageNum = Math.min(pdf.numPages, pageNum + 2); renderBookMode(); } }
      else if (mode === 'page' && pageNum < pdf.numPages) { pageNum++; renderPageMode(); }
    };
    // Each button toggles between its own mode and 'page' — the three modes
    // are mutually exclusive, so picking one while another is active just
    // switches directly rather than needing to cycle back through 'page'.
    const setMode = (m) => {
      mode = m;
      bookBtn.toggleClass('is-active', mode === 'book');
      modeBtn.toggleClass('is-active', mode === 'endless');
      const navOff = mode === 'endless';
      prevBtn.toggleClass('is-disabled', navOff);
      nextBtn.toggleClass('is-disabled', navOff);
      render();
    };
    bookBtn.onclick = () => setMode(mode === 'book' ? 'page' : 'book');
    modeBtn.onclick = () => setMode(mode === 'endless' ? 'page' : 'endless');
    // Force-apply the default size the same JS !important way the size
    // buttons do, rather than trusting the CSS default width:50% alone — that
    // was exactly the same class of bug max-height had (a same-specificity
    // theme rule silently won the cascade coin-flip against our stylesheet).
    await applySize();
  }
}

module.exports = InkPdfEmbeds;
