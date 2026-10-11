'use strict';

/* ============================================================================
 *  NEXUS SUITE · MAIN PLUGIN — entry
 *  The plugin class: onload registers every view, command and event, and the
 *  per-device settings live here. Each feature's methods are in src/features/
 *  and mixed in at the bottom (lib/mixin.js). esbuild bundles this into main.js.
 * ========================================================================== */

const { MarkdownView, Notice, Plugin, moment } = require('obsidian');
const { NexusCalendarView } = require('./views/calendar.js');
const { NexusSketchPaneView } = require('./views/sketchpane.js');
const { NexusCalloutInsertModal, NexusCalloutSuggest } = require('./modals/callout.js');
const { BAR_DEFAULTS, BAR_ITEMS, BAR_ITEM_IDS, CAL_VIEW, HOME_VIEW, INK_VIEW, CAPTURE_VIEW, GALAXY_VIEW, SCRATCH_VIEW, SIDE_CAPTURE_VIEW, NX_MODULES, SKETCH_VIEW, TIMER_VIEW } = require('./constants.js');
const { nxAllFolders, nxAllNames, nxAllPropKeys, nxAllTags, nxInkZoomEnd, nxInkZoomMove, nxInkZoomStart, nxPropValues, renderMd } = require('./lib/helpers.js');
const { NexusPlanner } = require('./views/plannerblock.js');
const { NexusVaultSync } = require('./lib/vaultsyncrun.js');
const deviceSettings = require('./lib/devicesettings.js');
const { NexusKanban } = require('./lib/kanban.js');
const { NexusFolderNotes } = require('./lib/foldernotes.js');
const { NexusHomepageView } = require('./views/homepage.js');
const { NexusIcons } = require('./lib/icons.js');
const { NexusTagTools } = require('./lib/tagtools.js');
const { NexusCaptureHubView } = require('./views/capturehub.js');
const { NexusGalaxyView } = require('./views/galaxy.js');
const { NexusScratchView } = require('./views/scratch.js');
const { escapeRegExp } = require('./lib/text.js');
const { NexusSearchModal } = require('./modals/search.js');
const { NexusSettingsTab } = require('./settings.js');
const { NexusTimerSidebarView } = require('./views/timers.js');
const { NexusWorkspaceModal } = require('./modals/workspace.js');
const { mixin } = require('./lib/mixin.js');

class NexusSuite extends Plugin {
  async onload() {
    await this.loadSettings();
    this.searchIndex = new Map();
    this._inkPending = new Set();
    this._inkProcessing = new Set();
    this._inkSelfCreated = new Set();

    // Each feature's init is isolated: one throwing (e.g. a platform quirk on
    // mobile) must NOT abort onload and take every later feature — incl. the
    // code-block processors — down with it. See _guard.
    // ── Fonts (bundle handwritten font for ALL platforms, incl. mobile) ──
    await this._guard('fonts', () => this.registerFonts());
    this.applyHandFont();
    // Obsidian fires css-change from updateFontSize(), so the handwritten note
    // follows the font-size setting and the zoom shortcuts like everything else.
    this.registerEvent(this.app.workspace.on('css-change', () => this.applyHandFont()));

    // ── Callouts (custom icons/colors via CSS; import from Callout Manager) ──
    await this._guard('callouts', async () => {
      await this.migrateCallouts();
      this.applyCallouts();
      this.register(() => { if (this._calloutStyle) this._calloutStyle.remove(); });
    });
    this.addCommand({ id: 'nexus-insert-callout', name: 'Insert a callout',
      editorCallback: (editor) => new NexusCalloutInsertModal(this.app, this, editor).open() });
    this.registerEditorSuggest(new NexusCalloutSuggest(this.app, this));

    // ── Hider (live CSS classes) ──
    this._guard('hider', () => this.applyHider());

    // ── Explorer companions: folder notes, per-path icons, tag tools ──
    this._guard('foldernotes', () => { this.folderNotes = new NexusFolderNotes(this); this.folderNotes.init(); });
    this._guard('icons', () => { this.icons = new NexusIcons(this); this.icons.init(); });
    this._guard('tagtools', () => { this.tagTools = new NexusTagTools(this); this.tagTools.init(); });

    // One module, three fences: ```nexus-kanban```, the ```nexus-board``` alias
    // it absorbed, and ```nexus-graph``` for the grid and the link web.
    this._guard('kanban', () => { this.kanban = new NexusKanban(this); this.kanban.init(); });
    this._guard('planner', () => { this.planner = new NexusPlanner(this); this.planner.init(); });
    this._guard('vaultSync', () => { this.vaultSync = new NexusVaultSync(this); this.vaultSync.init(); });

    // ── Banner ──
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshBanner()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshBanner()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshBanner()));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => {
      const v = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (v && v.file === f) this.refreshBanner();
    }));
    this.registerEvent(this.app.workspace.on("resize", () => this.refreshBanner()));
    // The link cache finishes filling AFTER the first notes have already
    // rendered — on mobile noticeably later. Without this, a banner whose
    // [[link]] could not be resolved at render time simply stayed missing until
    // something else happened to trigger a refresh.
    this.registerEvent(this.app.metadataCache.on('resolved', () => {
      this._bannerRetries = 0;
      this.refreshBanner();
    }));
    // On load, render for the already-open note (fires no event).
    // Twice: immediately + delayed, because the layout measurement (grey bar /
    // full width) has not settled on the first pass.
    this.app.workspace.onLayoutReady(() => {
      this.refreshBanner();
      window.setTimeout(() => this.refreshBanner(), 120);
    });

    // ── Property Hider ──
    this._guard('propertyHider', () => this.applyPropertyHider());
    const refreshProps = () => this.mountPropToggle();
    this.registerEvent(this.app.workspace.on('active-leaf-change', refreshProps));
    this.registerEvent(this.app.workspace.on('file-open', refreshProps));
    this.registerEvent(this.app.workspace.on('layout-change', refreshProps));
    const propKeyAt = (e) => {
      if (!this.settings.propertyHider.enabled) return null;
      const propEl = e.target && e.target.closest ? e.target.closest('.metadata-property') : null;
      if (!propEl) return null;
      const inp = propEl.querySelector('.metadata-property-key-input');
      return propEl.dataset.propertyKey || (inp && inp.value) || null;
    };
    this.registerDomEvent(document, 'contextmenu', (e) => {
      const key = propKeyAt(e);
      if (key) this._watchForPropMenu(key);
    }, { capture: true });
    // Mobile: a long press does NOT fire `contextmenu`. Obsidian opens the
    // property menu from its own hold timer (and on some builds a plain tap on
    // the key opens it too) — neither is something a plugin can hook. So we
    // don't try to predict the gesture at all: any press over a property arms a
    // watcher, and whatever menu turns up next gets the item.
    //
    // The previous version ran its own 300ms hold timer and cancelled it on the
    // first `touchmove`. On a phone a finger always drifts a pixel or two during
    // a long press, so the timer was cancelled before it ever fired and "Hide
    // property" never appeared — the bug this replaces. Only a real drag
    // (> DRAG_PX, i.e. a scroll) disarms it now.
    const DRAG_PX = 14;
    let propTouch = null;
    const armProp = (e) => {
      const key = propKeyAt(e);
      if (!key) return;
      const t = (e.touches && e.touches[0]) || e;
      propTouch = { x: t.clientX, y: t.clientY };
      // Snapshot the menus open RIGHT NOW: Obsidian's own hold timer may beat
      // us to it, and a menu that already existed must not count as "new".
      this._watchForPropMenu(key, new Set(document.body.querySelectorAll('.menu')), 3000);
    };
    this.registerDomEvent(document, 'touchstart', armProp, { capture: true, passive: true });
    // Pen and touch both go through pointerdown; mouse is already covered by the
    // contextmenu path above and must not arm a watcher on every left-click.
    this.registerDomEvent(document, 'pointerdown', (e) => { if (e.pointerType !== 'mouse') armProp(e); }, { capture: true, passive: true });
    this.registerDomEvent(document, 'touchmove', (e) => {
      if (!propTouch) return;
      const t = e.touches && e.touches[0];
      if (t && Math.hypot(t.clientX - propTouch.x, t.clientY - propTouch.y) > DRAG_PX) { propTouch = null; this._stopPropMenuWatch(); }
    }, { capture: true, passive: true });
    this.registerDomEvent(document, 'touchcancel', () => { propTouch = null; this._stopPropMenuWatch(); }, { capture: true, passive: true });
    this.register(() => this._stopPropMenuWatch());

    // ── Image separator ──
    // A thin strip of a picture instead of a horizontal rule. The block only
    // stores the link and two numbers; the crop is a CSS window onto the full
    // image, so no file has to be prepared and the band can be moved later.
    this.registerMarkdownCodeBlockProcessor('nexus-separator', (src, el, ctx) => this.renderSeparator(src, el, ctx));
    this.addCommand({ id: 'nexus-insert-separator', name: 'Insert an image separator',
      editorCallback: (editor, view) => {
        const { NexusSeparatorModal } = require('./modals/separator.js');
        const path = (view && view.file && view.file.path) || '';
        new NexusSeparatorModal(this, path, (cfg) => {
          const lines = ['```nexus-separator', 'image: [[' + cfg.link + ']]', 'height: ' + cfg.height, 'position: ' + cfg.position];
          if (cfg.fade) lines.push('fade: true');
          if (!cfg.round) lines.push('round: false');
          lines.push('```', '');
          editor.replaceSelection(lines.join('\n'));
        }).open();
      } });

    // ── Columns (reading-mode code block) ──
    this.registerMarkdownCodeBlockProcessor('columns', (source, el, ctx) => {
      if (!this.settings.columns.enabled) { el.createEl('pre').createEl('code', { text: source }); return; }
      const delim = (this.settings.columns.delimiter || '===').trim();
      const re = new RegExp('^\\s*' + escapeRegExp(delim) + '\\s*$');
      const parts = source.split('\n');
      const cols = [[]];
      for (const line of parts) { if (re.test(line)) cols.push([]); else cols[cols.length - 1].push(line); }
      const wrap = el.createDiv('nx-columns');
      wrap.style.setProperty('--nx-col-gap', this.settings.columns.gap || '1.5rem');
      cols.forEach(lines => {
        const c = wrap.createDiv('nx-column');
        renderMd(this, lines.join('\n'), c, ctx.sourcePath);
      });
    });

    // ── Quick Sketch (draw-on-canvas code block; sidecar .svg) ──
    this.app.workspace.onLayoutReady(() => this.ensureSketchFolder());
    this.registerMarkdownCodeBlockProcessor('quicksketch', (source, el, ctx) => this.renderSketch(source, el, ctx));
    // One sketch as its own tab — see views/sketchpane.js and openSketchInSplit.
    this.registerView(SKETCH_VIEW, (leaf) => new NexusSketchPaneView(leaf, this));
    /* The id → note index (see sketchOwners) is built from frontmatter, so it is
       only ever wrong after frontmatter changed. Dropping it is cheap; keeping a
       stale one would open a drawing beside the wrong note. */
    const dropSketchOwners = () => { this._sketchOwnerIndex = null; };
    this.registerEvent(this.app.metadataCache.on('changed', dropSketchOwners));
    this.registerEvent(this.app.metadataCache.on('resolved', dropSketchOwners));
    this.registerEvent(this.app.vault.on('delete', dropSketchOwners));
    this.registerEvent(this.app.vault.on('rename', dropSketchOwners));
    this.addCommand({ id: 'nexus-insert-sketch', name: 'Insert a sketch',
      editorCallback: (editor) => {
        if (!this.settings.quicksketch.enabled) { new Notice(NX_MODULES.quicksketch.name + ' is switched off.'); return; }
        editor.replaceSelection('```quicksketch\n```\n');
      } });
    // Keep touches that land ON an editing sketch canvas from reaching Obsidian's
    // own gesture handlers — otherwise an edge-swipe on the pad opens a sidebar.
    // Scoped strictly to the surface (capture phase, so it wins before Obsidian),
    // so scrolling the note anywhere else is untouched. The pad does its own
    // pan/zoom via pointer events.
    // Both modes: in view mode the surface handles gestures too (pinch zoom /
    // page scroll via the engine), so Obsidian must not also see these touches.
    // Also shields the banner move/resize overlay — otherwise a touch-drag there
    // reaches Obsidian's mobile gesture handler and pops the command palette.
    // IMPORTANT: the banner overlay gets stopPropagation but NOT preventDefault —
    // preventDefault on touchmove cancels the active touch-pointer (pointercancel)
    // and kills the pointer-based drag. It has touch-action:none for scroll
    // prevention. The sketch pad still needs preventDefault (finger pan).
    const guardHit = (e) => (e.target && e.target.closest) ? e.target.closest('.nx-sketch-surface, .nx-banner-drag') : null;
    this.registerDomEvent(document, 'touchstart', (e) => { if (guardHit(e)) e.stopPropagation(); }, { capture: true, passive: false });
    this.registerDomEvent(document, 'touchmove', (e) => {
      const t = guardHit(e);
      if (!t) return;
      e.stopPropagation();
      if (t.classList.contains('nx-sketch-surface')) e.preventDefault();
    }, { capture: true, passive: false });

    // ── A note's own drawing ──
    // The note holds only the sidecar id (frontmatter `sketch`) and a corner
    // button; the drawing itself lives in the Sketch tab. See the
    // "A note's own sketch" section below.
    this.addCommand({ id: 'nexus-new-protokoll', name: 'New sketch note', callback: () => this.createSketchNote() });
    this.addCommand({ id: 'nexus-planner-to-daily-notes', name: 'Move planner lines into the daily notes',
      callback: () => this.migratePlannerLines() });
    this.addCommand({ id: 'nexus-insert-planner', name: 'Insert a planner',
      editorCallback: (editor) => {
        const { plannerTemplate } = require('./lib/planner.js');
        const body = plannerTemplate(moment().format('YYYY-MM-DD'));
        editor.replaceSelection('```nexus-planner\n' + body + '\n```\n');
      } });
    this.addCommand({ id: 'nexus-quicknote', name: 'Chatter (speak a note)',
      callback: () => {
        if (!this.settings.quicknote || this.settings.quicknote.enabled === false) {
          new Notice('Nexus: Chatter is off — Settings → Chatter.');
          return;
        }
        const { NexusQuickNoteModal } = require('./modals/quicknote.js');
        new NexusQuickNoteModal(this).open();
      } });
    this.addCommand({ id: 'nexus-book-capture', name: 'Capture book',
      callback: () => this.openBookCapture('create') });
    this.addCommand({ id: 'nexus-book-fill', name: 'Fill book from ISBN',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.openBookCapture('fill', file);
        return true;
      } });
    this.addCommand({ id: 'nexus-search-sketches', name: 'Search sketches', callback: () => this.openSketchSearch() });
    this.addCommand({ id: 'nexus-ocr-sketch', name: 'Read the handwriting in this sketch',
      callback: () => this.ocrActiveSketch() });
    this.addCommand({ id: 'nexus-open-note-sketch', name: "Open this note's sketch",
      checkCallback: (checking) => {
        const v = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!v || !v.file || v.file.extension !== 'md') return false;
        if (!checking) this.openNoteSketch(v.file, 'same');
        return true;
      } });
    this.addCommand({ id: 'nexus-open-note-sketch-beside', name: "Open this note's sketch beside it",
      checkCallback: (checking) => {
        const v = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!v || !v.file || v.file.extension !== 'md') return false;
        if (!checking) this.openNoteSketch(v.file, 'right');
        return true;
      } });

    // ── Smart Typography ──
    this.registerEvent(this.app.workspace.on('editor-change', (editor) => this.handleTypography(editor)));

    // ── Search: build & maintain the index ──
    this.app.workspace.onLayoutReady(() => this.buildSearchIndex());
    this.registerEvent(this.app.vault.on('modify', (f) => this.indexFile(f)));
    this.registerEvent(this.app.vault.on('create', (f) => this.indexFile(f)));
    // The index also carries tags/headings/frontmatter, and those only become
    // correct once the metadata cache has parsed the file — 'modify' alone
    // would index against the previous parse.
    this.registerEvent(this.app.metadataCache.on('changed', (f) => this.indexFile(f)));
    this.registerEvent(this.app.vault.on('delete', (f) => this.searchIndex.delete(f.path)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { this.searchIndex.delete(old); this.indexFile(f); }));

    // ── Calendar view ──
    this.registerView(CAL_VIEW, (leaf) => new NexusCalendarView(leaf, this));
    if (this.settings.calendar.enabled && this.settings.calendar.ribbon) {
      this.addRibbonIcon('calendar', NX_MODULES.calendar.name, () => this.activateCalendar());
    }

    // ── Homepage view ──
    this.registerView(HOME_VIEW, (leaf) => new NexusHomepageView(leaf, this));
    if (this.settings.homepage.enabled && this.settings.homepage.ribbon) {
      this.addRibbonIcon('home', NX_MODULES.homepage.name, () => this.openHomepage());
    }

    // ── Ink Capture (inbox watcher + gallery view) ──
    this.app.workspace.onLayoutReady(() => this.ensureInkFolders());
    this.registerEvent(this.app.vault.on('create', (f) => this._onInkVaultCreate(f)));
    // The hub, registered twice: under its own id, and under the gallery's old
    // one so a saved workspace restores instead of showing "no view of type".
    // Each leaf keeps the id it was opened with (see NexusCaptureHubView.type).
    this.registerView(CAPTURE_VIEW, (leaf) => new NexusCaptureHubView(leaf, this, { type: CAPTURE_VIEW }));
    this.registerView(INK_VIEW, (leaf) => new NexusCaptureHubView(leaf, this, { type: INK_VIEW, tab: 'ink' }));
    if (this.settings.inkCapture.ribbon) {
      this.addRibbonIcon('camera', NX_MODULES.inkCapture.name, () => this.activateInkGallery());
    }
    this.addCommand({ id: 'nexus-open-captures', name: 'Open the capture hub', callback: () => this.openCaptureHub() });

    // ── Galaxy: the vault's links, turnable ──
    this.registerView(GALAXY_VIEW, (leaf) => new NexusGalaxyView(leaf, this));
    if (this.settings.galaxy.enabled && this.settings.galaxy.ribbon)
      this.addRibbonIcon('orbit', NX_MODULES.galaxy.name, () => this.openGalaxy());
    if (this.settings.bookCapture && this.settings.bookCapture.enabled)
      this.addRibbonIcon('book-open', NX_MODULES.bookCapture.name, () => this.openBookCapture('create'));
    this.addCommand({ id: 'nexus-open-galaxy', name: 'Open the galaxy', callback: () => this.openGalaxy() });

    /* The same hub in the sidebar. A second view id rather than a flag, because
       Obsidian remembers a leaf by its type: one id would mean a hub in the
       main area and a hub in the dock could not both be restored. */
    this.registerView(SIDE_CAPTURE_VIEW, (leaf) => new NexusCaptureHubView(leaf, this, { type: SIDE_CAPTURE_VIEW }));
    this.addCommand({ id: 'nexus-open-captures-sidebar', name: 'Open the capture hub in the sidebar',
      callback: () => this.openInDock(SIDE_CAPTURE_VIEW) });
    this.registerView(SCRATCH_VIEW, (leaf) => new NexusScratchView(leaf, this));
    this.addCommand({ id: 'nexus-open-scratch', name: 'Open the scratch panel',
      callback: () => this.openInDock(SCRATCH_VIEW) });
    this.addCommand({ id: 'nexus-capture-scan', name: 'Capture a scan', callback: () => {
      if (this.settings.inkCapture.enabled) this.captureScan();
      else new Notice(NX_MODULES.inkCapture.name + ' is switched off.');
    }});
    this.addCommand({ id: 'nexus-open-ink-gallery', name: 'Open the ink gallery', callback: () => this.activateInkGallery() });
    // Hover-zoom over sidecar images (see nxInkZoomStart/Move/End near the top
    // of the file for why this grows real width/height instead of using
    // transform:scale — the latter blurs SVG/vector content badly). One set of
    // delegated listeners instead of per-embed handlers — embeds are rendered
    // by Obsidian itself, we never get a creation hook to attach to.
    const inkImgAt = (e) => e.target && e.target.closest ? e.target.closest('.nx-ink-note .internal-embed.image-embed img') : null;
    this.registerDomEvent(document, 'mouseover', (e) => {
      const img = inkImgAt(e);
      if (!img || img._nxZoomBase) return;
      nxInkZoomStart(img);
      nxInkZoomMove(img, e.clientX, e.clientY);
    });
    // Coalesced to at most one resize/reflow per animation frame — mousemove
    // can fire far faster than the browser can actually repaint, and SVG
    // content is notably more expensive to re-rasterize on every size change
    // than a bitmap; letting calls pile up faster than they can be painted is
    // what made this feel stuttery rather than smooth.
    this.registerDomEvent(document, 'mousemove', (e) => {
      const img = inkImgAt(e);
      if (!img || !img._nxZoomBase) return;
      if (img._nxZoomRaf) return;
      const cx = e.clientX, cy = e.clientY;
      img._nxZoomRaf = requestAnimationFrame(() => { img._nxZoomRaf = null; nxInkZoomMove(img, cx, cy); });
    });
    // Step proportional to the actual wheel delta instead of a fixed amount
    // per event — trackpads fire many small-delta events per gesture, so a
    // fixed step per event felt jumpy; a mouse's larger per-notch delta still
    // lands close to the old fixed step.
    this.registerDomEvent(document, 'wheel', (e) => {
      const img = inkImgAt(e);
      if (!img) return;
      e.preventDefault();
      const cur = parseFloat(img.dataset.nxZoom) || 2.4;
      img.dataset.nxZoom = String(Math.min(6, Math.max(1, cur - e.deltaY * 0.003)));
      if (!img._nxZoomBase) nxInkZoomStart(img);
      nxInkZoomMove(img, e.clientX, e.clientY);
    }, { passive: false });
    this.registerDomEvent(document, 'mouseout', (e) => {
      const img = inkImgAt(e);
      if (!img || !img._nxZoomBase || img.contains(e.relatedTarget)) return;
      nxInkZoomEnd(img);
    });

    // ── Timer (shared state + sidebar) ──
    this._timers = {};
    this.registerView(TIMER_VIEW, (leaf) => new NexusTimerSidebarView(leaf, this));
    this.registerInterval(window.setInterval(() => this._tickTimers(), 1000));
    // Leaving/entering the dashboard → mirror the timer into the sidebar or back.
    this.addCommand({ id: 'nexus-open-timers', name: 'Open the timer panel', callback: () => this.openTimerSidebar() });

    // ── Commands ──
    this.addCommand({ id: 'nexus-search', name: 'Open search', callback: () => {
      if (this.settings.search.enabled) new NexusSearchModal(this).open();
      else new Notice(NX_MODULES.search.name + ' is switched off.');
    }});
    this.addCommand({ id: 'nexus-open-calendar', name: 'Open calendar in the sidebar', callback: () => this.activateCalendar() });
    this.addCommand({ id: 'nexus-workspaces', name: 'Open the workspace switcher', callback: () => {
      if (!this.settings.workspaces.enabled) { new Notice(NX_MODULES.workspaces.name + ' is switched off.'); return; }
      if (this._wsModal) { this._wsModal.move(1); return; }   // already open → keep cycling
      const release = (this.settings.workspaces.selectMode || 'release') === 'release';
      const m = new NexusWorkspaceModal(this, release);
      m.open();
      m.move(1);   // alt-tab feel: jump straight to the next
    }});
    // Releasing Ctrl/Alt confirms in release mode. Raw keyup listener, because
    // Obsidian hotkeys only know keydown. (Opening/cycling runs through the
    // command or the modal scope, see NexusWorkspaceModal.)
    this.registerDomEvent(document, 'keyup', (e) => this.handleWsKeyup(e), { capture: true });
    this.addCommand({ id: 'nexus-open-homepage', name: 'Open dashboard', callback: () => this.openHomepage() });

    // ── Homepage on startup, and when the last tab is closed ──
    // The layout-change listener is only subscribed once the layout is READY:
    // while Obsidian rebuilds the saved session the main area is transiently
    // empty, and reacting to that opens a dashboard beside the very tabs it is
    // still restoring.
    this.app.workspace.onLayoutReady(() => {
      this._guard('homepage-startup', () => this.runHomepageStartup());
      this.registerEvent(this.app.workspace.on('layout-change', () => this.maybeOpenHomepageWhenEmpty()));
    });

    // ── Pinned tabs ──
    // The pin survives a restart, so the pages come back on their own; the
    // watchdog then keeps them there.
    this.app.workspace.onLayoutReady(() => this.guardPinnedTabs());
    this.registerEvent(this.app.workspace.on('layout-change', () => this.guardPinnedTabs()));

    this.applyThemeSettings();
    this.applyNoteBgStrength();
    this.applyExplorer();
    this.applyRibbon();

    this.settingTab = new NexusSettingsTab(this.app, this);
    this.addSettingTab(this.settingTab);
    console.log('[Nexus] Suite loaded · Banner module:', this.settings.banner.enabled);
  }

  onunload() {
    // Before anything detaches: the pin watchdog must not reopen what we close.
    this._unloading = true;
    window.clearTimeout(this._pinT);
    window.clearTimeout(this._homeEmptyTimer);
    document.body.removeClass('nx-pin-home');
    this.app.workspace.detachLeavesOfType(CAL_VIEW);
    this.app.workspace.detachLeavesOfType(HOME_VIEW);
    this.app.workspace.detachLeavesOfType(TIMER_VIEW);
    this.app.workspace.detachLeavesOfType(INK_VIEW);
    this.app.workspace.detachLeavesOfType(CAPTURE_VIEW);
    this.app.workspace.detachLeavesOfType(GALAXY_VIEW);
    this.app.workspace.detachLeavesOfType(SIDE_CAPTURE_VIEW);
    this.app.workspace.detachLeavesOfType(SCRATCH_VIEW);
    this.app.workspace.detachLeavesOfType(SKETCH_VIEW);
    (this._inkPdfDocs || []).forEach((pdf) => { try { pdf.destroy(); } catch (e) {} });
    this._inkPdfDocs = [];
    const pel = document.getElementById('nx-palette-style'); if (pel) pel.remove();
    document.body.removeClass('nx-explorer-folders');
    document.body.removeClass('nx-ribbon-hover');
    document.body.removeClass('nx-ribbon-hidden');
    { const rs = document.getElementById('nx-ribbon-style'); if (rs) rs.remove(); }
    { const es = document.getElementById('nx-explorer-style'); if (es) es.remove(); }
    ['--nx-gap', '--nx-radius', '--nx-home-gap', '--nx-home-pad', '--nx-home-col', '--nx-home-row', '--nx-fld-intensity', '--nx-hand-size']
      .forEach(v => document.body.style.removeProperty(v));
    if (this._scrollRef && this._scrollRef.el) this._scrollRef.el.removeEventListener('scroll', this._scrollRef.fn);
    if (this._propStyle) this._propStyle.remove();
    document.body.removeClass('nx-reveal-props');
    document.querySelectorAll('.nx-prop-toggle').forEach(e => e.remove());
    if (this.folderNotes) this.folderNotes.unload();
    if (this.icons) this.icons.unload();
  }

  _hpDocFields() { return ['name', 'hero', 'heroPosY', 'heroHeight', 'greetStyle', 'heroStyle', 'btnStyle', 'widgets', 'layout', 'stats', 'cards', 'hidden', 'actions', 'bg']; }
  deviceId() {
    if (this._deviceId) return this._deviceId;
    let id = null;
    try { id = window.localStorage.getItem('nexus-suite-device-id'); } catch (e) {}
    if (!id) {
      id = 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try { window.localStorage.setItem('nexus-suite-device-id', id); } catch (e) {}
    }
    this._deviceId = id;
    return id;
  }

  /* ---- Per-device settings --------------------------------------------------
     The one home for anything that describes THIS machine rather than the
     vault: the sync connection and its schedule. Stored in
     data.json under deviceId(), so the file still syncs and is still backed up
     while no device can overwrite another's entry — lib/devicesettings.js says
     why that is the shape. Anything shared (an exclude list, a conflict policy)
     stays where it is, at module level. */
  deviceSetting(key, fallback) {
    const value = deviceSettings.deviceStore(this.settings, this.deviceId())[key];
    return value === undefined ? fallback : value;
  }
  async setDeviceSetting(key, value) {
    deviceSettings.deviceStore(this.settings, this.deviceId())[key] = value;
    await this.saveSettings();
  }

  /* data.json was replaced underneath the plugin: Obsidian calls this when
     another tool wrote the file, and vault sync calls adoptIncomingSettings
     itself after a download. Without it the settings in memory were the old
     ones, and the next save wrote them back over what had just arrived.

     Obsidian mobile also calls it for the plugin's OWN writes (86 calls in
     7 s on the tablet, 2026-10-11), and memory may be ahead of the file while a
     save is still under way. So the file is compared with what this device
     last wrote, not with memory, and nothing is taken during a save: otherwise
     a setting changed mid-save was rolled back, and every save answered itself
     with another one. What was last written is also the base of the merge —
     it is what the file said before somebody else replaced it. */
  async onExternalSettingsChange() {
    if (this._settingsWrites) return;
    const generation = this._settingsGeneration || 0;
    const base = this._lastWrittenSettings;
    const incoming = await this.loadData();
    // A save that started while the file was being read makes what was read
    // stale: taking it would roll that save back.
    if (this._settingsWrites || (this._settingsGeneration || 0) !== generation) return;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
    if (base && deviceSettings.sameJson(incoming, base)) return;
    await this.adoptIncomingSettings(incoming, base);
  }

  /* Merge an incoming data.json into the settings (lib/devicesettings.js
     mergeIncoming), apply it and save it. Returns `sendBack` — the merged file
     holds something the incoming one did not (this device's bag, a setting
     changed here), so the caller should send it back — and the `clashes`, the
     settings both sides changed, where the incoming value won. */
  async adoptIncomingSettings(incoming, base) {
    const { merged, clashes } = deviceSettings.mergeIncoming(incoming, this.settings, this.deviceId(), base);
    const sendBack = !deviceSettings.sameJson(merged, incoming);
    const before = JSON.parse(JSON.stringify(this.settings));
    await this._replaceSettingsInPlace(merged);
    const changed = !deviceSettings.sameJson(before, this.settings);
    // Saved when memory moved, or when the file on disk does not say what
    // memory says yet (the incoming file replaced it, or never reached it).
    if (changed || !deviceSettings.sameJson(this._lastWrittenSettings, this.settings)) await this.saveSettings();
    if (changed) this.reapplySettings();
    return { sendBack, clashes };
  }

  /* Settings pages, modals, views and dashboard cards keep pieces of
     `plugin.settings` in variables. Swapping in a new object left them editing
     a detached copy, and their next save wrote the new one without the edit.
     So the merged values go INTO the existing objects and lists, all the way
     down (devicesettings.assignInPlace).

     loadSettings has no await when it is handed the data, so it has run to the
     end by the time it returns its promise; `this.settings` is put back before
     anything else can run, and nobody sees the intermediate object. The
     migrations that touch this device (credentials of removed modules) are
     left out: an incoming file is not this device's history. */
  async _replaceSettingsInPlace(raw) {
    const live = this.settings;
    let loading;
    this._adoptingSettings = true;
    try { loading = this.loadSettings(raw); } finally { this._adoptingSettings = false; }
    const fresh = this.settings;
    this.settings = live;
    await loading;                 // a failure surfaces here, with the live settings already back
    deviceSettings.assignInPlace(live, fresh);
  }

  reapplySettings() {
    const hooks = ['applyThemeSettings', 'applyExplorer', 'applyCallouts', 'applyNoteBgStrength', 'applyHider',
      'applyHandFont', 'applyRibbon', 'applyPropertyHider', 'refreshBanner', 'refreshCalendarViews', 'refreshGalaxy'];
    for (const hook of hooks) {
      if (typeof this[hook] !== 'function') continue;
      try { this[hook](); } catch (e) { console.warn('[Nexus] re-applying settings: ' + hook + ' failed:', e); }
    }
    try { this.app.workspace.getLeavesOfType('nx-homepage').forEach(l => { try { l.view.render(); } catch (e) {} }); }
    catch (e) { console.warn('[Nexus] re-drawing the dashboard failed:', e); }
    // The settings tab is redrawn only when nobody is typing in it: a redraw
    // throws away the field with the caret in it.
    const tab = this.settingTab;
    try {
      const shown = tab && tab.containerEl && tab.containerEl.isShown && tab.containerEl.isShown();
      const typing = shown && document.activeElement && tab.containerEl.contains(document.activeElement);
      if (shown && !typing) tab.display();
    } catch (e) { console.warn('[Nexus] re-drawing the settings tab failed:', e); }
    if (this.vaultSync) this.vaultSync.schedule();
  }

  /* ---- Sketch toolbar layout ------------------------------------------------
     Which buttons a toolbar shows is a property of the DEVICE, not of the
     vault: a phone wants three buttons and a menu where a desktop wants all of
     them. So the shared setting is only the default, and a device may keep its
     own copy in localStorage — never in the vault, so Syncthing can't carry
     one machine's cramped phone bar onto another's monitor.

     Shape either way: { mode: 'pinned'|'reveal', compact: [ids], full: [ids] }.
     A null list means "the built-in default", so a vault that never touches
     this keeps working when BAR_DEFAULTS changes. */
  barKey() { return 'nexus-suite-sketchbar'; }
  barOverride() {
    try { return JSON.parse(window.localStorage.getItem(this.barKey()) || 'null'); } catch (e) { return null; }
  }
  setBarOverride(obj) {
    try {
      if (obj) window.localStorage.setItem(this.barKey(), JSON.stringify(obj));
      else window.localStorage.removeItem(this.barKey());
    } catch (e) {}
  }
  barConfig(s) {
    const shared = s.bar || (s.bar = { mode: 'pinned', compact: null, full: null });
    const dev = this.barOverride();
    const cfg = (dev && dev.enabled) ? Object.assign({}, shared, dev) : shared;
    const list = (v, def) => {
      // Unknown ids are dropped, so a list written by a newer version can't
      // render a button this one has no builder for.
      if (!Array.isArray(v)) return def.slice();
      const keep = v.filter(id => BAR_ITEM_IDS.includes(id));
      // A bar with no tool at all cannot draw — that is a broken editor, not a
      // preference, so the pen comes back.
      if (!keep.some(id => (BAR_ITEMS.find(i => i.id === id) || {}).kind === 'tool')) keep.unshift('pen');
      return keep;
    };
    return {
      mode: cfg.mode === 'reveal' ? 'reveal' : 'pinned',
      compact: list(cfg.compact, BAR_DEFAULTS.compact),
      full: list(cfg.full, BAR_DEFAULTS.full),
    };
  }
  /* Suggestion sources for the card config modals (nxAutocomplete calls these
     on the plugin object — they must exist here, not just on the view). */
  _allFolders() { return nxAllFolders(this.app); }
  _allTags() { return nxAllTags(this.app); }
  _allNames() { return nxAllNames(this.app); }
  _allPropKeys() { return nxAllPropKeys(this.app); }
  _propValues(key) { return nxPropValues(this.app, key); }

  hp() {
    const home = this.settings.homepage;
    if (!home || !home.perDevice) return home;
    const id = this.deviceId();
    const profs = home.profiles || (home.profiles = {});
    if (!profs[id]) {
      const seed = {};
      for (const f of this._hpDocFields()) {
        if (home[f] === undefined) continue;
        try { seed[f] = JSON.parse(JSON.stringify(home[f])); } catch (e) { seed[f] = home[f]; }
      }
      profs[id] = seed;
    }
    return profs[id];
  }
  deviceLabel() {
    const names = (this.settings.homepage && this.settings.homepage.profileNames) || {};
    return names[this.deviceId()] || '';
  }
  async setDeviceLabel(v) {
    const home = this.settings.homepage;
    const names = home.profileNames || (home.profileNames = {});
    names[this.deviceId()] = (v || '').trim();
    await this.saveSettings();
  }
  async resetDeviceDashboard() {
    const home = this.settings.homepage;
    if (home.profiles) delete home.profiles[this.deviceId()];
    await this.saveSettings();   // hp() rebuilds the profile from the template on next access
  }
  /* What was written is remembered, and a write in progress is counted, for
     onExternalSettingsChange. */
  async saveSettings() {
    this._settingsWrites = (this._settingsWrites || 0) + 1;
    this._settingsGeneration = (this._settingsGeneration || 0) + 1;
    try {
      this._lastWrittenSettings = JSON.parse(JSON.stringify(this.settings));
      await this.saveData(this.settings);
    } finally { this._settingsWrites--; }
  }

  /* Run one feature's init in isolation: if it throws (often a platform quirk on
     mobile), log it and carry on so the REST of the plugin still loads. Without
     this, a single early failure in onload silently kills every feature
     registered after it (code-block processors, views, commands…). */
  async _guard(name, fn) {
    try { await fn(); }
    catch (e) { console.error('[Nexus] feature "' + name + '" init failed (continuing):', e); }
  }

  /* ---- Hider ---- */
  applyHider() {
    const s = this.settings.hider;
    const map = {
      'nx-hide-tooltips': s.enabled && s.tooltips,
      'nx-hide-scrollbars': s.enabled && s.scrollbars,
      'nx-hide-status': s.enabled && s.status,
      'nx-hide-titlebar': s.enabled && s.titlebar,
      'nx-hide-vaultname': s.enabled && s.vaultname,
      'nx-hide-tabbar': s.enabled && s.tabbar,
      'nx-hide-instructions': s.enabled && s.instructions,
      'nx-hide-sidebar-ribbon': s.enabled && s.ribbon,
      'nx-hide-explorer-buttons': s.enabled && s.explorerButtons,
    };
    for (const [cls, on] of Object.entries(map)) document.body.toggleClass(cls, !!on);
  }

  /* ---- Banner + note background ----
     Render for ALL open markdown panes (not just the active one — in a split
     the active pane may be the graph/info, which would leave the note empty). */
  refreshBanner() {
    // ALWAYS remove a stale "banner behind the tab bar" — even when no markdown
    // leaf is open right now (e.g. only the homepage). Otherwise the banner of
    // the previously opened note stays stuck behind the tab bar. updateBanner
    // re-applies it for the active note afterwards.
    document.querySelectorAll('.workspace-tab-header-container.nx-bar-has-banner').forEach(b => {
      b.classList.remove('nx-bar-has-banner', 'nx-bar-banner-off');
      b.style.removeProperty('--nx-banner-img');
      b.style.removeProperty('--nx-banner-w');
      b.style.removeProperty('--nx-banner-x');
      b.style.removeProperty('--nx-banner-scroll');
    });
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      try { this.updateBanner(view); } catch (e) { console.error('[Nexus] updateBanner:', e); }
      try { this.mountBannerControl(view); } catch (e) { console.error('[Nexus] mountBannerControl:', e); }
      try { this.updateNoteBg(view); } catch (e) { console.error('[Nexus] updateNoteBg:', e); }
      try { this.mountBgControl(view); } catch (e) { console.error('[Nexus] mountBgControl:', e); }
      try { this.updateInkNoteClass(view); } catch (e) { console.error('[Nexus] updateInkNoteClass:', e); }
      try { this.updateInkPdfEmbeds(view); } catch (e) { console.error('[Nexus] updateInkPdfEmbeds:', e); }
      try { this.mountSketchControl(view); } catch (e) { console.error('[Nexus] mountSketchControl:', e); }
    }
  }

  /* Marks Ink Capture sidecar notes (frontmatter type: ink-capture) with a
     class so styles.css can size/center their single embedded image
     consistently — deliberately gated on that exact frontmatter value so
     regular notes' embeds are never touched. Piggybacks on the same
     refreshBanner() event wiring (active-leaf-change/file-open/layout-change/
     metadataCache-changed/resize) instead of registering its own events. */
  updateInkNoteClass(view) {
    if (!view || !view.file) return;
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;
    view.contentEl.toggleClass('nx-ink-note', !!(fm && fm['ink-source']));
  }

  /* ---- Workspace quick switcher (Ctrl+Alt+Tab) ----
     Releasing Ctrl/Alt confirms the selection in release mode. Opening &
     cycling run through the command or the modal scope. */
  handleWsKeyup(e) {
    const m = this._wsModal;
    if (!m || !m.releaseMode) return;
    // ONLY confirm when a MODIFIER key is released (not during normal typing —
    // otherwise it fires while typing a name and endlessly opens new fields).
    // Include AltGr/Meta.
    const k = e.key;
    if (k === 'Control' || k === 'Alt' || k === 'AltGraph' || k === 'Meta' || k === 'OS') {
      m.confirmSelection();
    }
  }
}

// Everything else the plugin does lives in src/features/, one file per job.
mixin(NexusSuite, [
  require('./features/settings-migrations.js'),
  require('./features/ink-pdf.js'),
  require('./features/note-decor.js'),
  require('./features/banner.js'),
  require('./features/banner-library.js'),
  require('./features/property-hider.js'),
  require('./features/callouts.js'),
  require('./features/typography.js'),
  require('./features/tabs.js'),
  require('./features/connection.js'),
  require('./features/image-separator.js'),
  require('./features/quick-capture.js'),
  require('./features/ocr.js'),
  require('./features/sketch-store.js'),
  require('./features/sketch-block.js'),
  require('./features/color-picker.js'),
  require('./features/sketch-export.js'),
  require('./features/sketch-bar.js'),
  require('./features/sketch-open.js'),
  require('./features/ink-open.js'),
  require('./features/ink-import.js'),
  require('./features/ink-sidecar.js'),
  require('./features/timer-state.js'),
  require('./features/theme.js'),
]);

module.exports = NexusSuite;
