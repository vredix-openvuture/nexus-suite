'use strict';

/* ============================================================================
 *  NEXUS SUITE · MAIN PLUGIN — entry
 *  NexusSuite plugin class; wires every module together. esbuild bundles this into main.js.
 * ========================================================================== */

const { MarkdownView, Menu, Notice, Plugin, TFile, arrayBufferToBase64, loadPdfJs, moment, setIcon } = require('obsidian');
const { NexusBannerImportModal, NexusBannerModal } = require('./modals/banner.js');
const { NexusCalendarView } = require('./views/calendar.js');
const { NexusCalendarPageView } = require('./views/calendarpage.js');
const { NexusTasksPageView } = require('./views/taskspage.js');
const { NexusEventModal } = require('./modals/event.js');
const { NexusTaskModal } = require('./modals/task.js');
const calstore = require('./lib/calstore.js');
const tasks = require('./lib/tasks.js');
const sync = require('./lib/sync.js');
const ical = require('./lib/ical.js');
const { CalDavClient } = require('./lib/caldav.js');
const { VikunjaClient } = require('./lib/vikunja.js');
const { NexusConflictModal } = require('./modals/conflict.js');
const { NexusCalloutInsertModal, NexusCalloutSuggest } = require('./modals/callout.js');
const { CAL_VIEW, CAL_PAGE_VIEW, TASKS_VIEW, DEFAULT_SETTINGS, HOME_VIEW, IMG_EXT, INK_DOWNSCALE_EXT, INK_EXT, INK_MAX_DIM, INK_VIEW, NX_MODULES, PALETTES, PEN_IDS, ST_SYMBOL_RULES, TIMER_VIEW } = require('./constants.js');
const { nxAllFolders, nxAllNames, nxAllPropKeys, nxAllTags, nxInkZoomEnd, nxInkZoomMove, nxInkZoomStart, nxPdfDestPage, nxPropValues, renderMd } = require('./lib/helpers.js');
const { NexusAgenda } = require('./lib/agenda.js');
const { NexusBoard } = require('./lib/board.js');
const { NexusEditorial } = require('./lib/editorial.js');
const { NexusFocus } = require('./lib/focus.js');
const { NexusFolderNotes } = require('./lib/foldernotes.js');
const { NexusHomepageView } = require('./views/homepage.js');
const { NexusIcons } = require('./lib/icons.js');
const { NexusSprint } = require('./lib/sprint.js');
const { NexusTagTools } = require('./lib/tagtools.js');
const { NexusInkGalleryView, NexusInkTagModal } = require('./views/ink.js');
const { NexusSketchSurface, parseSketchSVG, ratioWH, PEN_TYPES } = require('./views/sketch.js');
const { NexusNameModal } = require('./modals/misc.js');
const { NexusSearchModal } = require('./modals/search.js');
const { NexusSettingsTab } = require('./settings.js');
const { NexusTimerDoneModal, NexusTimerSidebarView } = require('./views/timers.js');
const { NexusWorkspaceModal } = require('./modals/workspace.js');

module.exports = class NexusSuite extends Plugin {
  async onload() {
    await this.loadSettings();
    await this._guard('calmigrate', () => this.migrateCalendarData());
    this.searchIndex = new Map();
    this._inkPending = new Set();
    this._inkProcessing = new Set();
    this._inkSelfCreated = new Set();

    // Each feature's init is isolated: one throwing (e.g. a platform quirk on
    // mobile) must NOT abort onload and take every later feature — incl. the
    // code-block processors — down with it. See _guard.
    // ── Fonts (bundle handwritten font for ALL platforms, incl. mobile) ──
    await this._guard('fonts', () => this.registerFonts());

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

    // ── Writing aids: focus mode, sprints, editorial blocks ──
    this._guard('focus', () => { this.focus = new NexusFocus(this); this.focus.init(); });
    this._guard('sprint', () => { this.sprint = new NexusSprint(this); this.sprint.init(); });
    this._guard('editorial', () => { this.editorial = new NexusEditorial(this); this.editorial.init(); });
    this._guard('board', () => { this.board = new NexusBoard(this); this.board.init(); });
    // ── Agenda code block (one day: events + tasks + backlinks, for daily notes) ──
    this._guard('agenda', () => { this.agenda = new NexusAgenda(this); this.agenda.init(); });

    // ── Banner ──
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshBanner()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshBanner()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshBanner()));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => {
      const v = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (v && v.file === f) this.refreshBanner();
    }));
    this.registerEvent(this.app.workspace.on("resize", () => this.refreshBanner()));
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
    this.registerDomEvent(document, 'contextmenu', (e) => {
      if (!this.settings.propertyHider.enabled) return;
      const propEl = e.target && e.target.closest ? e.target.closest('.metadata-property') : null;
      if (!propEl) return;
      const inp = propEl.querySelector('.metadata-property-key-input');
      const key = propEl.dataset.propertyKey || (inp && inp.value);
      if (!key) return;
      this._watchForPropMenu(key);
    }, { capture: true });
    this.register(() => this._stopPropMenuWatch());

    // ── Columns (reading-mode code block) ──
    this.registerMarkdownCodeBlockProcessor('columns', (source, el, ctx) => {
      if (!this.settings.columns.enabled) { el.createEl('pre').createEl('code', { text: source }); return; }
      const delim = (this.settings.columns.delimiter || '===').trim();
      const re = new RegExp('^\\s*' + delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');
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

    // ── Protokoll (whole-note endless drawing surface) ──
    // A `nexus: protokoll` note renders 100% NATIVELY (title / properties /
    // banner) — the plugin just injects the endless sketch surface BELOW the
    // note content via the refreshBanner() wiring (see updateProtokoll). No
    // custom view, no code block.
    this.addCommand({ id: 'nexus-new-protokoll', name: 'New slate (drawing note)', callback: () => this.createProtokollNote() });
    this.addCommand({ id: 'nexus-toggle-slate', name: 'Toggle slate mode',
      checkCallback: (checking) => {
        const v = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!v || !v.file || v.file.extension !== 'md') return false;
        if (!checking) this.toggleSlate(v.file);
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

    // ── Tasks & Calendar (full-page CalDAV + local calendars) ──
    this.registerView(CAL_PAGE_VIEW, (leaf) => new NexusCalendarPageView(leaf, this));
    if (this.settings.tasksCalendar.enabled && this.settings.tasksCalendar.ribbon) {
      this.addRibbonIcon('calendar-check', NX_MODULES.tasksCalendar.name, () => this.openCalendarPage());
    }
    this.addCommand({ id: 'nexus-open-calendar-page', name: 'Open the full-page calendar', callback: () => this.openCalendarPage() });
    // ── Tasks page (project tree + task list) ──
    this.registerView(TASKS_VIEW, (leaf) => new NexusTasksPageView(leaf, this));
    if (this.settings.tasksCalendar.enabled && this.settings.tasksCalendar.ribbon) {
      this.addRibbonIcon('list-checks', 'Tasks', () => this.openTasksPage());
    }
    this.addCommand({ id: 'nexus-open-tasks-page', name: 'Open the tasks page', callback: () => this.openTasksPage() });
    this.addCommand({ id: 'nexus-sync-taskcal', name: 'Sync calendars and tasks now', callback: () => { new Notice('Nexus: syncing…'); this.syncTaskCal().then(r => new Notice('Nexus sync\n' + ((r && r.lines) || ['done']).join('\n'), 9000)); } });
    this.addCommand({ id: 'nexus-new-event', name: 'New event', callback: () => {
      if (!this.settings.tasksCalendar.enabled) { new Notice(NX_MODULES.tasksCalendar.name + ' is switched off.'); return; }
      if (!(this.settings.tasksCalendar.localCalendars || []).length) { new Notice('Create a local calendar first (Settings → ' + NX_MODULES.tasksCalendar.name + ').'); return; }
      new NexusEventModal(this, {}, null).open();
    }});
    this.app.workspace.onLayoutReady(() => { if (this.settings.tasksCalendar.enabled && this.settings.tasksCalendar.syncOnStartup) this._guard('taskcal-sync', () => this.syncTaskCal()); });
    this.registerInterval(window.setInterval(() => { if (this.settings.tasksCalendar.enabled) this.syncTaskCal(); }, Math.max(5, this.settings.tasksCalendar.syncIntervalMin || 15) * 60000));

    // ── Todos (local projects/tasks as Markdown) ──
    this.addCommand({ id: 'nexus-new-task', name: 'New task', callback: () => {
      if (!this.settings.tasksCalendar.enabled) { new Notice(NX_MODULES.tasksCalendar.name + ' is switched off.'); return; }
      new NexusTaskModal(this, null).open();
    }});
    this.addCommand({ id: 'nexus-new-project', name: 'New task project', callback: async () => {
      if (!this.settings.tasksCalendar.enabled) { new Notice(NX_MODULES.tasksCalendar.name + ' is switched off.'); return; }
      const name = await new NexusNameModal(this.app, 'New project name', 'Project').openAndGet();
      if (!name) return;
      const file = await tasks.createProject(this, name);
      this.app.workspace.getLeaf(false).openFile(file);
    }});
    // Live checklist: toggling a checkbox in a project note flips its task
    // (a repeating task advances its due date and the box resets). Guarded so
    // our own writes don't re-trigger it.
    this.registerEvent(this.app.vault.on('modify', (f) => { if (this.settings.tasksCalendar.enabled) this._guard('task-checklist', () => tasks.onProjectNoteModify(this, f)); }));
    // Task notes are named after their title; notes from the id-named era get
    // renamed once (their links follow) and the old `<!-- nx:id -->` markers go.
    this.app.workspace.onLayoutReady(() => window.setTimeout(() => this._guard('task-names', () => this.migrateTaskNames()), 2500));

    // ── Homepage view ──
    this.registerView(HOME_VIEW, (leaf) => new NexusHomepageView(leaf, this));
    if (this.settings.homepage.enabled && this.settings.homepage.ribbon) {
      this.addRibbonIcon('home', NX_MODULES.homepage.name, () => this.openHomepage(true));
    }

    // ── Ink Capture (inbox watcher + gallery view) ──
    this.app.workspace.onLayoutReady(() => this.ensureInkFolders());
    this.registerEvent(this.app.vault.on('create', (f) => this._onInkVaultCreate(f)));
    this.registerView(INK_VIEW, (leaf) => new NexusInkGalleryView(leaf, this));
    if (this.settings.inkCapture.ribbon) {
      this.addRibbonIcon('camera', NX_MODULES.inkCapture.name, () => this.activateInkGallery());
    }
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
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this._syncTimerSidebar()));
    // On startup, clean up a possibly restored (empty) timer sidebar.
    this.app.workspace.onLayoutReady(() => this._syncTimerSidebar());

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
    this.addCommand({ id: 'nexus-open-homepage', name: 'Open dashboard', callback: () => this.openHomepage(true) });

    // ── Homepage on startup ──
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.homepage.enabled && this.settings.homepage.openOnStartup) this.openHomepage(false);
    });

    this.applyThemeSettings();
    this.applyNoteBgStrength();
    this.applyExplorer();
    this.applyRibbon();

    this.addSettingTab(new NexusSettingsTab(this.app, this));
    console.log('[Nexus] Suite loaded · Banner module:', this.settings.banner.enabled);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(CAL_VIEW);
    this.app.workspace.detachLeavesOfType(CAL_PAGE_VIEW);
    this.app.workspace.detachLeavesOfType(TASKS_VIEW);
    this.app.workspace.detachLeavesOfType(HOME_VIEW);
    this.app.workspace.detachLeavesOfType(TIMER_VIEW);
    this.app.workspace.detachLeavesOfType(INK_VIEW);
    (this._inkPdfDocs || []).forEach((pdf) => { try { pdf.destroy(); } catch (e) {} });
    this._inkPdfDocs = [];
    const pel = document.getElementById('nx-palette-style'); if (pel) pel.remove();
    document.body.removeClass('nx-explorer-folders');
    document.body.removeClass('nx-ribbon-hover');
    document.body.removeClass('nx-ribbon-hidden');
    { const rs = document.getElementById('nx-ribbon-style'); if (rs) rs.remove(); }
    ['--nx-gap', '--nx-radius', '--nx-home-gap', '--nx-home-pad', '--nx-home-col', '--nx-home-row', '--nx-fld-intensity']
      .forEach(v => document.body.style.removeProperty(v));
    if (this._scrollRef && this._scrollRef.el) this._scrollRef.el.removeEventListener('scroll', this._scrollRef.fn);
    if (this._propStyle) this._propStyle.remove();
    document.body.removeClass('nx-reveal-props');
    document.querySelectorAll('.nx-prop-toggle').forEach(e => e.remove());
    if (this.folderNotes) this.folderNotes.unload();
    if (this.icons) this.icons.unload();
    if (this.focus) this.focus.unload();
    if (this.sprint) this.sprint.unload();
    if (this.editorial) this.editorial.unload();
  }

  /* ---- Settings ---- */
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // ensure deep defaults per module
    for (const k of Object.keys(DEFAULT_SETTINGS))
      this.settings[k] = Object.assign({}, DEFAULT_SETTINGS[k], (data && data[k]) || {});
    // Migration: old image cards (homepage.images) → widget system
    const hp = this.settings.homepage;
    if (hp.images && hp.images.length && (!hp.widgets || !hp.widgets.length)) {
      hp.widgets = hp.images.map(it => Object.assign({ type: 'image', uid: 'w' + Math.random().toString(36).slice(2, 9) }, it));
    }
    hp.images = [];
    (hp.widgets || []).forEach(w => { if (!w.uid) w.uid = 'w' + Math.random().toString(36).slice(2, 9); });
    // Migration: quicksketch single palette → named palettes. If the vault has a
    // customised flat `palette` but no `palettes` yet, seed "Default" from it and
    // keep `palette` as an ALIAS of the active palette's colours array.
    const qs = this.settings.quicksketch;
    if (qs) {
      const hadPalettes = !!(data && data.quicksketch && Array.isArray(data.quicksketch.palettes) && data.quicksketch.palettes.length);
      if (!hadPalettes && Array.isArray(qs.palette) && qs.palette.length) {
        qs.palettes = [{ name: 'Default', colors: qs.palette.slice(0, 8) }];
      }
      if (!Array.isArray(qs.palettes) || !qs.palettes.length) qs.palettes = [{ name: 'Default', colors: ['#2f2f2f'] }];
      if (qs.activePalette == null || qs.activePalette >= qs.palettes.length) qs.activePalette = 0;
      qs.palette = qs.palettes[qs.activePalette].colors;
      // Migration: one shared favourites triplet → one PER PEN. A 10px marker
      // and a 2px pencil never wanted the same three quick widths.
      const DEF_FAV = [1.5, 3, 8];
      if (!qs.sizeFavorites || Array.isArray(qs.sizeFavorites)) {
        const base = (Array.isArray(qs.sizeFavorites) && qs.sizeFavorites.length) ? qs.sizeFavorites.slice(0, 3) : DEF_FAV;
        const per = {};
        PEN_IDS.forEach(p => { per[p] = (p === 'marker' ? [6, 10, 18] : base).slice(0, 3); });
        qs.sizeFavorites = per;
      }
      PEN_IDS.forEach(p => {
        const v = qs.sizeFavorites[p];
        if (!Array.isArray(v) || !v.length) qs.sizeFavorites[p] = (p === 'marker' ? [6, 10, 18] : DEF_FAV).slice();
      });
    }
    // Migration: fixed ink sources (paper/saber/butterfly as an object) → a
    // user-defined LIST. Only "paper" stays mandatory (the in-app camera).
    const ink = this.settings.inkCapture;
    if (ink) {
      if (ink.sources && !Array.isArray(ink.sources)) {
        const LABEL = { paper: 'Paper (camera)', saber: 'Saber', butterfly: 'Butterfly' };
        ink.sources = Object.entries(ink.sources).map(([id, src]) => ({
          id, label: LABEL[id] || id, folder: (src && src.folder) || ('Inbox/' + id), enabled: !src || src.enabled !== false,
        }));
      }
      if (!Array.isArray(ink.sources)) ink.sources = [];
      if (!ink.sources.some(x => x && x.id === 'paper'))
        ink.sources.unshift({ id: 'paper', label: 'Paper (camera)', folder: 'Inbox/Paper', enabled: true });
    }
    // Tasks & Calendar: backfill nested defaults (shallow per-key merge above
    // does not deep-merge saved partial objects).
    const tc = this.settings.tasksCalendar;
    if (tc) {
      if (!Array.isArray(tc.accounts)) tc.accounts = [];
      if (!Array.isArray(tc.localCalendars)) tc.localCalendars = [];
      if (!Array.isArray(tc.hiddenCalendars)) tc.hiddenCalendars = [];
      if (!tc.tasks || typeof tc.tasks !== 'object') tc.tasks = Object.assign({}, DEFAULT_SETTINGS.tasksCalendar.tasks);
      // No stored dataLocation = an install from before the move into the plugin
      // folder. The new default would silently point at an empty directory, so
      // remember to carry the old vault folder over in onload.
      this._calLegacyFolder = (data && data.tasksCalendar && data.tasksCalendar.dataLocation)
        ? null : ((data && data.tasksCalendar && data.tasksCalendar.dataFolder) || '_nexus');
    }
  }

  /* Carry an existing vault-folder calendar store into the plugin folder once.
     Copies, never deletes — the old folder stays as a fallback until you remove
     it yourself. */
  async migrateCalendarData() {
    const legacy = this._calLegacyFolder;
    this._calLegacyFolder = null;
    const tc = this.settings.tasksCalendar;
    if (!tc || !legacy) return;
    tc.dataLocation = 'plugin';
    const moved = await calstore.migrate(this, legacy);
    await this.saveSettings();
    if (moved) new Notice('Nexus: calendar data copied into the plugin folder ("' + legacy + '" can be deleted).');
  }

  /* ---- Per-device dashboard -------------------------------------------------
     The device ID lives in localStorage (per device/installation, NOT in the
     vault → NOT synced by Syncthing). The dashboard documents live in
     homepage.profiles[deviceId] and do sync — but each device reads only its
     own entry. hp() returns the active document:
       perDevice OFF → the shared top-level homepage (behavior as before);
       perDevice ON  → the device profile (cloned from the shared document on
                       first access). */
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
  async saveSettings() { await this.saveData(this.settings); }

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
      try { this.updateProtokoll(view); } catch (e) { console.error('[Nexus] updateProtokoll:', e); }
      try { this.mountSlateControl(view); } catch (e) { console.error('[Nexus] mountSlateControl:', e); }
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

  /* Make bundled fonts available on EVERY platform (incl. Obsidian mobile) by
     reading the file straight from the vault's fonts/ folder and inlining it as
     an @font-face data-URI. This deliberately does NOT rely on OS-installed
     fonts or a desktop-only font-loader plugin — a data-URI resolves identically
     on desktop and mobile. Monospace intentionally isn't bundled: it uses the
     platform's own --font-monospace, which always exists. */
  async registerFonts() {
    const fonts = [
      { family: 'Grape Nuts', file: 'GrapeNuts-Regular.ttf' },
    ];
    let css = '';
    for (const f of fonts) {
      const path = this.app.vault.configDir + '/fonts/' + f.file;
      try {
        if (!(await this.app.vault.adapter.exists(path))) {
          console.warn('[Nexus] font missing:', path);
          continue;
        }
        const b64 = arrayBufferToBase64(await this.app.vault.adapter.readBinary(path));
        css += "@font-face{font-family:'" + f.family + "';font-display:swap;" +
               "src:url(data:font/ttf;base64," + b64 + ") format('truetype');}\n";
      } catch (e) { console.error('[Nexus] font load failed:', f.file, e); }
    }
    if (!css) return;
    let styleEl = document.getElementById('nx-fonts');
    if (!styleEl) styleEl = document.head.createEl('style', { attr: { id: 'nx-fonts' } });
    styleEl.textContent = css;
    this.register(() => styleEl.remove());   // remove @font-face on plugin unload
  }

  /* Note style — background pattern (grid/lined/dotted) + font (mono/handwritten),
     both driven by frontmatter and aligned to the line grid. */
  updateNoteBg(view) {
    if (!view) return;
    const el = view.contentEl;
    el.classList.remove('nx-bg-lined', 'nx-bg-grid', 'nx-bg-dotted', 'nx-font-mono', 'nx-font-hand');
    if (!view.file) return;
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;

    // Font FIRST — the class changes the line height, which the grid measurement
    // below must see so the pattern still snaps to the text baseline.
    const font = fm && fm['note-font'];
    const fmap = { mono: 'nx-font-mono', hand: 'nx-font-hand' };
    if (font && fmap[font]) el.classList.add(fmap[font]);

    // Background pattern.
    const bg = fm && fm['note-bg'];
    const map = { lined: 'nx-bg-lined', grid: 'nx-bg-grid', dotted: 'nx-bg-dotted' };
    if (!bg || !map[bg]) return;
    // Measure the line height → align the grid to it (text sits on the line)
    const c = el.querySelector('.cm-content') || el.querySelector('.markdown-preview-view');
    if (c) {
      const cs = getComputedStyle(c);
      let lh = parseFloat(cs.lineHeight);
      if (isNaN(lh)) lh = (parseFloat(cs.fontSize) || 16) * 1.5;
      // Snap the period to WHOLE device pixels → even spacing even with
      // fractional screen scaling (otherwise sometimes 1, sometimes 2 device px).
      const dpr = window.devicePixelRatio || 1;
      el.style.setProperty('--nx-bg-line', (Math.round(lh * dpr) / dpr) + 'px');
    }
    el.classList.add(map[bg]);
  }

  mountBgControl(view) {
    if (!view) return;
    const el = view.contentEl;
    let btn = el.querySelector(':scope > .nx-bg-btn');
    if (!this.settings.banner.enabled || !view.file) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el.createDiv('nx-bg-btn');
      setIcon(btn, 'palette');
      btn.setAttribute('aria-label', 'Note style — background & font');
      btn.onclick = (evt) => { if (view.file) this.openBgMenu(evt, view.file); };
    }
  }

  openBgMenu(evt, file) {
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter;
    const curBg = (fm && fm['note-bg']) || 'none';
    const curFont = (fm && fm['note-font']) || 'normal';
    const menu = new Menu();

    // ── Background pattern ──
    const bgOpt = (label, val, icon) => menu.addItem(i =>
      i.setTitle(label).setIcon(icon).setChecked(curBg === val).onClick(() => this.setNoteBg(file, val)));
    bgOpt('No background', 'none', 'x');
    bgOpt('Lined', 'lined', 'menu');
    bgOpt('Grid', 'grid', 'grid');
    bgOpt('Dotted', 'dotted', 'more-horizontal');

    // ── Pattern strength: an inline stepper, because how visible the pattern is
    //    depends on the palette and you want to judge it while looking at the
    //    note. The −/+ spans swallow the click so the menu stays open and you
    //    can tap your way to the right value in one go. ──
    if (curBg !== 'none') {
      menu.addItem(i => {
        const frag = document.createDocumentFragment();
        const row = document.createElement('div');
        row.className = 'nx-bgstep';
        const mk = (txt, cls) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s; };
        const dec = mk('−', 'nx-bgstep-btn');
        const val = mk('', 'nx-bgstep-val');
        const inc = mk('+', 'nx-bgstep-btn');
        const paint = () => {
          const v = this.settings.banner.bgStrength;
          val.textContent = 'Strength ' + (v == null ? 4.5 : v).toFixed(1) + ' %';
        };
        // On POINTERDOWN, not click: a menu that closes on click would tear the
        // row out from under a click listener. This way the value always lands,
        // and swallowing the click on top keeps the menu open for the next tap.
        const step = (d) => async (ev) => {
          ev.preventDefault(); ev.stopImmediatePropagation();
          const s = this.settings.banner;
          const cur = s.bgStrength == null ? 4.5 : s.bgStrength;
          s.bgStrength = Math.round(Math.max(0.5, Math.min(30, cur + d)) * 10) / 10;
          this.applyNoteBgStrength(); paint();
          await this.saveSettings();
        };
        const swallow = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
        dec.addEventListener('pointerdown', step(-0.5));
        inc.addEventListener('pointerdown', step(+0.5));
        dec.addEventListener('click', swallow);
        inc.addEventListener('click', swallow);
        paint();
        row.append(dec, val, inc);
        frag.appendChild(row);
        i.setTitle(frag).setIcon('contrast');
      });
    }

    menu.addSeparator();

    // ── Font ──
    const fontOpt = (label, val, icon) => menu.addItem(i =>
      i.setTitle(label).setIcon(icon).setChecked(curFont === val).onClick(() => this.setNoteFont(file, val)));
    fontOpt('Normal font', 'normal', 'type');
    fontOpt('Monospace', 'mono', 'code');
    fontOpt('Handwritten', 'hand', 'pen-tool');

    menu.showAtMouseEvent(evt);
  }

  async setNoteBg(file, val) {
    await this.app.fileManager.processFrontMatter(file, f => {
      if (val === 'none') delete f['note-bg']; else f['note-bg'] = val;
    });
    this.refreshBanner();
  }

  async setNoteFont(file, val) {
    await this.app.fileManager.processFrontMatter(file, f => {
      if (val === 'normal') delete f['note-font']; else f['note-font'] = val;
    });
    this.refreshBanner();
  }

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
      const dest = this.app.metadataCache.getFirstLinkpathDest(wl[1].trim(), sourcePath);
      return dest ? this.app.vault.getResourcePath(dest) : null;
    }
    if (/^https?:\/\//.test(value)) return value;
    const f = this.app.vault.getAbstractFileByPath(value);
    if (f) return this.app.vault.getResourcePath(f);
    return value;
  }

  /* ---- Banner groups ------------------------------------------------------
     A group IS a subfolder of the banner folder — no parallel bookkeeping in
     data.json that could drift out of sync with the vault. Sorting images in
     the file explorer regroups them, and every move/rename goes through
     fileManager.renameFile so the [[banner]] links in notes follow along. */
  bannerRoot() { return (this.settings.banner.folder || '').trim().replace(/^\/|\/$/g, ''); }
  bannerImages() {
    const root = this.bannerRoot();
    return this.app.vault.getFiles()
      .filter(f => IMG_EXT.includes(f.extension.toLowerCase()) && (!root || f.path.startsWith(root + '/')));
  }
  /* Group of an image, relative to the banner root. '' = directly in the root. */
  bannerGroupOf(file) {
    const root = this.bannerRoot();
    const dir = (file.parent && file.parent.path) || '';
    if (!root) return '';
    return dir === root ? '' : dir.slice(root.length + 1);
  }
  /* All groups — read off the folder tree, so empty ones stay listed too. */
  bannerGroups() {
    const root = this.bannerRoot();
    if (!root) return [];
    const out = new Set();
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (!f || !f.children || !f.path) continue;                       // folders only
      if (f.path !== root && f.path.startsWith(root + '/')) out.add(f.path.slice(root.length + 1));
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }
  /* Folder path of a group, created on demand. '' → the banner root itself. */
  async ensureBannerGroup(name) {
    const root = this.bannerRoot();
    const rel = String(name || '').trim().replace(/^\/|\/$/g, '');
    const path = rel ? (root ? root + '/' + rel : rel) : root;
    if (path && !this.app.vault.getAbstractFileByPath(path)) {
      try { await this.app.vault.createFolder(path); } catch (e) {}
    }
    return path;
  }
  async moveBannerToGroup(file, group) {
    const dir = await this.ensureBannerGroup(group);
    const dest = (dir ? dir + '/' : '') + file.name;
    if (dest === file.path) return true;
    if (this.app.vault.getAbstractFileByPath(dest)) {
      new Notice('Nexus: "' + file.name + '" already exists in that group.');
      return false;
    }
    await this.app.fileManager.renameFile(file, dest);
    return true;
  }
  /* Every image in a group INCLUDING its subgroups — what a delete would take
     with it, so the count in the confirm and the rescue loop agree. */
  bannerGroupImages(rel) {
    return this.bannerImages().filter(f => {
      const g = this.bannerGroupOf(f);
      return g === rel || g.startsWith(rel + '/');
    });
  }
  async renameBannerGroup(oldRel, newRel) {
    const root = this.bannerRoot();
    if (!root) return false;
    const from = this.app.vault.getAbstractFileByPath(root + '/' + oldRel);
    const to = (String(newRel || '').trim().replace(/^\/|\/$/g, ''));
    if (!from || !to || to === oldRel) return false;
    if (this.app.vault.getAbstractFileByPath(root + '/' + to)) {
      new Notice('Nexus: group "' + to + '" already exists.');
      return false;
    }
    await this.app.fileManager.renameFile(from, root + '/' + to);
    if (this.settings.banner.defaultGroup === oldRel) { this.settings.banner.defaultGroup = to; await this.saveSettings(); }
    return true;
  }
  /* Dissolve a group: its images move back to the banner root (links follow),
     then the now-empty folder goes to the trash. Never deletes an image. */
  async deleteBannerGroup(rel) {
    const root = this.bannerRoot();
    if (!root) return false;
    const folder = this.app.vault.getAbstractFileByPath(root + '/' + rel);
    if (!folder) return false;
    // Subgroups included — otherwise trashing the folder would take nested
    // images with it, and "no image is deleted" would be a lie.
    for (const img of this.bannerGroupImages(rel)) {
      try { await this.moveBannerToGroup(img, ''); } catch (e) {}
    }
    try { await this.app.fileManager.trashFile(folder); } catch (e) {}
    const def = this.settings.banner.defaultGroup;
    if (def === rel || (def || '').startsWith(rel + '/')) { this.settings.banner.defaultGroup = ''; await this.saveSettings(); }
    return true;
  }
  /* Filename for an imported banner. Tokens: {{name}} (original filename),
     {{note}}, {{date}}, {{time}}. Anything else is taken literally. */
  bannerFileName(origName, noteFile) {
    const tpl = String(this.settings.banner.nameTemplate || '{{name}}').trim() || '{{name}}';
    const now = moment();
    return tpl
      .replace(/\{\{\s*name\s*\}\}/gi, origName)
      .replace(/\{\{\s*note\s*\}\}/gi, (noteFile && noteFile.basename) || '')
      .replace(/\{\{\s*date\s*\}\}/gi, now.format('YYYY-MM-DD'))
      .replace(/\{\{\s*time\s*\}\}/gi, now.format('HH-mm'))
      .trim() || origName;
  }

  /* Choose an image via the system file dialog, copy it into the chosen banner
     group and set it as the banner. */
  importBannerFromSystem(noteFile) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      try {
        const f = input.files && input.files[0];
        if (!f) return;
        const ext = ((f.name.split('.').pop() || 'png').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'png';
        const origName = f.name.replace(/\.[^.]+$/, '');
        const picked = await new NexusBannerImportModal(this, this.bannerFileName(origName, noteFile)).openAndGet();
        if (!picked) return;   // cancelled
        const dir = await this.ensureBannerGroup(picked.group);
        const base = (picked.name.trim() || origName).replace(/[\\/:*?"<>|]/g, '_');
        const mk = (n) => (dir ? dir + '/' : '') + base + (n ? '-' + n : '') + '.' + ext;
        let dest = mk(0), i = 1;
        while (this.app.vault.getAbstractFileByPath(dest)) dest = mk(i++);
        const buf = await f.arrayBuffer();
        const img = await this.app.vault.createBinary(dest, buf);
        await this.app.fileManager.processFrontMatter(noteFile, fm => {
          fm.banner = '[[' + this.app.metadataCache.fileToLinktext(img, noteFile.path) + ']]';
        });
        this.refreshBanner();
        new Notice('Banner set: ' + dest);
      } catch (e) {
        new Notice(NX_MODULES.banner.name + ': import failed (' + e.message + ')');
      }
    };
    input.click();
  }

  /* Move the banner image vertically by dragging (→ banner-y-pct). */
  async startBannerDrag(file) {
    // Prefer the ACTIVE (visible) view — the same file can be open in several
    // leaves, and grabbing a background copy would build the overlay off-screen.
    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file !== file) {
      view = this.app.workspace.getLeavesOfType('markdown')
        .map(l => l.view).find(v => (v instanceof MarkdownView) && v.file === file && v.contentEl.offsetParent !== null);
    }
    if (!view) return;
    const el = view.contentEl;
    if (!el.classList.contains('nx-has-banner')) { new Notice('Nexus: Set a banner first.'); return; }
    const stale = el.querySelector('.nx-banner-drag'); if (stale) stale.remove();   // was: return (a stale overlay blocked re-opening)

    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    const src = this.resolveBannerSrc(fm.banner, file.path);
    const tabs = view.containerEl.closest('.workspace-tabs');
    const bar = tabs && tabs.querySelector(':scope > .workspace-tab-header-container');
    const behind = el.classList.contains('nx-banner-behind');
    const barH = behind && bar ? bar.getBoundingClientRect().height : 0;
    let height = Number(fm['banner-height']) || this.settings.banner.height;

    // Load the image dimensions → clamp limit (don't drag past the image edge)
    let scaledH = 0, cardW = 0;
    await new Promise(res => {
      const im = new Image();
      im.onload = () => {
        cardW = ((el.querySelector('.cm-editor') || el).clientWidth) || 800;
        scaledH = cardW * (im.naturalHeight / im.naturalWidth);
        res();
      };
      im.onerror = res;
      im.src = src;
    });
    // Available pan range in px, AT THIS (fixed-during-the-drag) pane width —
    // cardW doesn't change mid-drag, so plain px is accurate for the live
    // preview; only converted to a %-of-range on save (finish(), below), so it
    // stays correct when the note is later viewed at a different pane width.
    const availRange = () => Math.max(0, scaledH - (barH + height));
    const minOff = () => (scaledH ? Math.min(0, -(scaledH - (barH + height))) : -4000);

    // Reconstruct the starting px offset from the saved percentage, measured
    // fresh at the CURRENT width (not whatever width it was last saved at).
    const startPct = Number(fm['banner-y-pct']) || 0;
    let offset = -(startPct / 100) * availRange();
    const setPos = (v) => {
      el.style.setProperty('--nx-banner-pos-y', v + 'px');
      if (bar) bar.style.setProperty('--nx-banner-pos-y', v + 'px');
    };

    const overlay = el.createDiv('nx-banner-drag');
    const applyHeight = () => {
      el.style.setProperty('--nx-banner-height', height + 'px');
      // cardW is fixed for the duration of this drag (only the height handle
      // and the vertical pan move, the window itself isn't being resized) →
      // this aspect-ratio IS the exact final value once banner-ref-w=cardW
      // gets saved, so there's no visual jump when the drag ends.
      el.style.setProperty('--nx-banner-ar', String(cardW / height));
      overlay.style.height = (barH + height) + 'px';
    };
    applyHeight();
    overlay.createDiv({ cls: 'nx-banner-drag-hint', text: '↕ Area = move · bottom = height' });
    const done = overlay.createDiv('nx-banner-drag-done');
    setIcon(done, 'check');
    done.setAttribute('aria-label', 'Done');
    const resizeH = overlay.createDiv('nx-banner-resize');

    let mode = null, startY = 0, startOffset = 0, startHeight = 0;
    const onMove = (e) => {
      if (mode === 'pos') {
        offset = Math.max(minOff(), Math.min(0, startOffset + (e.clientY - startY)));
        setPos(offset);
      } else if (mode === 'size') {
        height = Math.max(80, Math.min(900, startHeight + (e.clientY - startY)));
        applyHeight();
        offset = Math.max(minOff(), offset);  // keep the position within the valid range
        setPos(offset);
      }
    };
    const finish = async () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();   // removes the overlay's own pointer listeners with it
      const ar = availRange();
      const posPct = ar > 0 ? Math.min(100, Math.max(0, (-offset / ar) * 100)) : 0;
      await this.app.fileManager.processFrontMatter(file, f => {
        f['banner-height'] = Math.round(height);   // overrides the settings value
        f['banner-ref-w'] = Math.round(cardW);      // pane width this crop was calibrated at
        f['banner-y-pct'] = Math.round(posPct * 100) / 100;
        delete f['banner-y'];   // superseded by banner-y-pct (width-independent)
      });
      this.refreshBanner();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(); } };

    // POINTER events (mouse + TOUCH + pen) — the old mouse-only handlers never
    // fired for touch, so dragging/resizing did nothing on the tablet. Pointer
    // capture on the overlay keeps move/up flowing even for touch (which
    // implicitly captures to the pointerdown target).
    overlay.style.touchAction = 'none';
    const inDone = (t) => t === done || done.contains(t);
    const inResize = (t) => t === resizeH || resizeH.contains(t);
    overlay.addEventListener('pointerdown', (e) => {
      if (inDone(e.target)) { e.preventDefault(); e.stopPropagation(); finish(); return; }
      mode = inResize(e.target) ? 'size' : 'pos';
      startY = e.clientY;
      if (mode === 'size') startHeight = height; else startOffset = offset;
      try { overlay.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', () => { mode = null; });
    overlay.addEventListener('pointercancel', () => { mode = null; });
    document.addEventListener('keydown', onKey);
  }

  /* ---- Property Hider ---- */
  applyPropertyHider() {
    if (!this._propStyle) this._propStyle = document.head.createEl('style', { attr: { id: 'nx-prop-hider' } });
    const s = this.settings.propertyHider;
    if (!s.enabled || !s.hidden.length) {
      this._propStyle.textContent = '';
      document.body.removeClass('nx-reveal-props');
      this.mountPropToggle();
      return;
    }
    const esc = (k) => (window.CSS && CSS.escape) ? CSS.escape(k) : k.replace(/"/g, '\\"');
    const hide = s.hidden.map(k => `.metadata-property[data-property-key="${esc(k)}"]`).join(',');
    const show = s.hidden.map(k => `body.nx-reveal-props .metadata-property[data-property-key="${esc(k)}"]`).join(',');
    this._propStyle.textContent = `${hide}{display:none!important;}${show}{display:flex!important;opacity:.45;}`;
    document.body.toggleClass('nx-reveal-props', !!s.reveal);
    this.mountPropToggle();
  }
  async hideProperty(key) {
    const h = this.settings.propertyHider.hidden;
    if (!h.includes(key)) h.push(key);
    await this.saveSettings();
    this.applyPropertyHider();
  }
  async unhideProperty(key) {
    this.settings.propertyHider.hidden = this.settings.propertyHider.hidden.filter(k => k !== key);
    await this.saveSettings();
    this.applyPropertyHider();
  }

  /* ---- Callouts ---- */
  /* Inject one <style> that sets --callout-icon + --callout-color per type,
     light/dark aware. Same result as eth-p Callout Manager, but managed here. */
  applyCallouts() {
    if (!this._calloutStyle) this._calloutStyle = document.head.createEl('style', { attr: { id: 'nx-callouts' } });
    const s = this.settings.callouts;
    if (!s.enabled) { this._calloutStyle.textContent = ''; return; }
    const esc = (k) => (window.CSS && CSS.escape) ? CSS.escape(k) : k.replace(/"/g, '\\"');
    let css = '';
    for (const c of s.items) {
      const id = (c.id || '').toLowerCase().trim();
      if (!id) continue;
      const sel = `.callout[data-callout="${esc(id)}"]`;
      // Emitted as a BARE "r, g, b" triplet — that is Obsidian's convention for
      // --callout-color (core: `--callout-default: var(--color-blue-rgb)`) and
      // every core rule consumes it as rgb(var(--callout-color)) /
      // rgba(var(--callout-color), .1). Wrapping it in rgb() here would nest a
      // colour inside rgb()'s channel args → invalid → core silently drops the
      // title/icon colour for exactly the custom types we manage. Same triplet
      // form the eth-p Callout Manager stores, so the migration is 1:1.
      const decl = [];
      if (c.color) decl.push(`--callout-color:${c.color};`);
      if (c.icon) decl.push(`--callout-icon:${c.icon.startsWith('lucide-') ? c.icon : 'lucide-' + c.icon};`);
      if (decl.length) css += `${sel}{${decl.join('')}}\n`;
      if (c.colorLight) css += `.theme-light ${sel}{--callout-color:${c.colorLight};}\n`;
      if (c.colorDark)  css += `.theme-dark ${sel}{--callout-color:${c.colorDark};}\n`;
    }
    this._calloutStyle.textContent = css;
  }
  /* One-time import of the user's existing callouts from the eth-p Callout
     Manager plugin (icons + colors, incl. light/dark colorScheme conditions),
     so switching to this module loses nothing. Re-runnable via the settings
     "Import" button (sets migrated=false first). */
  async migrateCallouts() {
    const s = this.settings.callouts;
    if (s.migrated) return;
    s.migrated = true;
    try {
      const path = this.app.vault.configDir + '/plugins/callout-manager/data.json';
      if (await this.app.vault.adapter.exists(path)) {
        const raw = JSON.parse(await this.app.vault.adapter.read(path));
        const rules = (raw && raw.callouts && raw.callouts.settings) || {};
        const have = new Set(s.items.map(i => i.id));
        for (const [id, list] of Object.entries(rules)) {
          if (have.has(id)) continue;
          const item = { id, icon: '', color: '', colorLight: '', colorDark: '' };
          for (const rule of (list || [])) {
            const ch = rule.changes || {}, cond = rule.condition || {};
            if (ch.icon) item.icon = ch.icon.replace(/^lucide-/, '');
            if (ch.color) {
              if (cond.colorScheme === 'light') item.colorLight = ch.color;
              else if (cond.colorScheme === 'dark') item.colorDark = ch.color;
              else item.color = ch.color;
            }
          }
          if (item.icon || item.color || item.colorLight || item.colorDark) s.items.push(item);
        }
      }
    } catch (e) { console.error('[Nexus] callout migration failed:', e); }
    await this.saveSettings();
  }
  mountPropToggle() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const addBtn = view.contentEl.querySelector('.metadata-add-button');
    if (!addBtn || !addBtn.parentElement) return;
    let toggle = addBtn.parentElement.querySelector('.nx-prop-toggle');
    if (!this.settings.propertyHider.enabled) { if (toggle) toggle.remove(); return; }
    if (!toggle) {
      toggle = createDiv('nx-prop-toggle');
      addBtn.after(toggle);
      toggle.onclick = async () => {
        this.settings.propertyHider.reveal = !this.settings.propertyHider.reveal;
        await this.saveSettings();
        this.applyPropertyHider();
      };
    }
    const rev = this.settings.propertyHider.reveal;
    setIcon(toggle, rev ? 'eye' : 'eye-off');
    toggle.setAttribute('aria-label', rev ? 'Hide hidden properties' : 'Show hidden properties');
    toggle.toggleClass('is-active', rev);
  }
  /* Inject a "Hide/Show property" item into the NATIVE property context menu.
     Obsidian gives us no API event for this menu, so we watch the DOM — but only
     for a menu that is NEW (added after the right-click) and already POPULATED.
     That avoids the old bug of grabbing a stale/hidden leftover `.menu` (which is
     why the item never showed up). The observer self-stops on success/timeout. */
  _watchForPropMenu(key) {
    this._stopPropMenuWatch();
    const known = new Set(document.body.querySelectorAll('.menu'));
    const tryInject = () => {
      for (const menu of document.body.querySelectorAll('.menu')) {
        if (known.has(menu) || menu.dataset.nxHideInjected) continue;
        if (!menu.querySelector('.menu-item')) continue;   // not filled in yet → wait
        menu.dataset.nxHideInjected = '1';
        this._injectHideItem(menu, key);
        this._stopPropMenuWatch();
        return true;
      }
      return false;
    };
    if (tryInject()) return;                               // menu already open & ready
    this._propObs = new MutationObserver(() => tryInject());
    this._propObs.observe(document.body, { childList: true, subtree: true });
    this._propTimer = window.setTimeout(() => this._stopPropMenuWatch(), 1500);
  }
  _stopPropMenuWatch() {
    if (this._propObs) { this._propObs.disconnect(); this._propObs = null; }
    if (this._propTimer) { window.clearTimeout(this._propTimer); this._propTimer = null; }
  }
  _injectHideItem(menu, key) {
    const hidden = this.settings.propertyHider.hidden.includes(key);
    const item = createDiv('menu-item tappable');
    const icon = item.createDiv('menu-item-icon');
    setIcon(icon, hidden ? 'eye' : 'eye-off');
    item.createDiv({ cls: 'menu-item-title', text: hidden ? 'Show property' : 'Hide property' });
    item.addEventListener('click', () => {
      if (hidden) this.unhideProperty(key); else this.hideProperty(key);
      menu.remove();
    });
    // Match the native hover highlight (Obsidian toggles .selected on the item).
    item.addEventListener('mouseenter', () => {
      menu.querySelectorAll('.menu-item.selected').forEach(el => el.removeClass('selected'));
      item.addClass('selected');
    });
    item.addEventListener('mouseleave', () => item.removeClass('selected'));
    // IMPORTANT: the real structure is .menu > .menu-scroll > .menu-group > .menu-item,
    // and the separators are children of .menu-scroll (NOT of .menu). Inserting
    // relative to .menu threw a NotFoundError (silent) → this is why the item never
    // appeared. Give our item its own .menu-group and place it above the first
    // separator, i.e. just above the "Remove" group.
    const scroll = menu.querySelector('.menu-scroll') || menu;
    const group = createDiv('menu-group');
    group.appendChild(item);
    const sep = scroll.querySelector('.menu-separator');
    if (sep) scroll.insertBefore(group, sep); else scroll.appendChild(group);
  }

  /* ---- Smart Typography ---- */
  handleTypography(editor) {
    const s = this.settings.typography;
    if (!s.enabled || this._stBusy) return;
    const cur = editor.getCursor();
    const upto = editor.getLine(cur.line).slice(0, cur.ch);
    const lc = upto.toLowerCase();

    for (const rule of ST_SYMBOL_RULES) {
      if (!s[rule.grp]) continue;
      if (lc.endsWith(rule.m)) {
        const from = { line: cur.line, ch: cur.ch - rule.m.length };
        this._replace(editor, from, cur, rule.r);
        return;
      }
    }
    if (s.quotes) {
      const last = upto.slice(-1);
      if (last === '"' || last === "'") {
        const before = upto.slice(-2, -1);
        const opening = before === '' || /[\s([{<]/.test(before);
        const rep = last === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’');
        this._replace(editor, { line: cur.line, ch: cur.ch - 1 }, cur, rep);
      }
    }
  }
  _replace(editor, from, to, text) {
    this._stBusy = true;
    editor.replaceRange(text, from, to);
    editor.setCursor({ line: from.line, ch: from.ch + text.length });
    this._stBusy = false;
  }

  /* ---- Search index ---- */
  async buildSearchIndex() {
    for (const f of this.app.vault.getMarkdownFiles()) await this.indexFile(f);
  }
  /* One entry per note, with the FIELDS kept apart instead of one blob: the
     search ranks a title hit above a tag hit above a heading hit …, which is
     impossible once everything is flattened into a single lowercase string. */
  async indexFile(f) {
    if (!f || f.extension !== 'md') return;
    try {
      const content = (await this.app.vault.cachedRead(f)).slice(0, 20000);
      const cache = this.app.metadataCache.getFileCache(f) || {};

      const tags = [];
      const fmTags = (cache.frontmatter || {}).tags;
      if (typeof fmTags === 'string') tags.push(...fmTags.split(/[,\s]+/));
      else if (Array.isArray(fmTags)) tags.push(...fmTags.map(String));
      if (Array.isArray(cache.tags)) tags.push(...cache.tags.map(x => x.tag));

      const headings = (cache.headings || []).map(h => String(h.heading || ''));

      // Frontmatter as "key: value" strings — searching "status offen" should
      // hit a note with `status: offen`, not just one that mentions either word.
      const props = [];
      const fm = cache.frontmatter || {};
      for (const k of Object.keys(fm)) {
        if (k === 'position') continue;
        const v = fm[k];
        const vals = Array.isArray(v) ? v : [v];
        for (const one of vals) {
          if (one == null || typeof one === 'object') continue;
          props.push(k + ': ' + String(one));
        }
      }

      this.searchIndex.set(f.path, {
        basename: f.basename,
        content,
        lower: content.toLowerCase(),
        tags: tags.map(t => String(t).replace(/^#/, '').toLowerCase()).filter(Boolean),
        headings,
        headingsLower: headings.map(h => h.toLowerCase()),
        props,
        propsLower: props.map(p => p.toLowerCase()),
      });
    } catch (e) {}
  }

  /* ---- Calendar ---- */
  async activateCalendar() {
    let leaf = this.app.workspace.getLeavesOfType(CAL_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: CAL_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /* ---- Homepage ---- */
  async openHomepage(force) {
    // Reuse an existing homepage tab, otherwise open in the active area.
    let leaf = this.app.workspace.getLeavesOfType(HOME_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: HOME_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /* ---- Tasks & Calendar ----
     Credentials live in localStorage (device-local, NOT synced by Syncthing —
     same precedent as deviceId()). data.json holds only non-secret account
     config. Network sync runs on DESKTOP only (behind the fs-guard); the tablet
     renders from the vault cache Syncthing delivers. */
  credKey(id) { return 'nexus-suite-cred-' + id; }
  getCredential(id) { try { return JSON.parse(window.localStorage.getItem(this.credKey(id)) || '{}') || {}; } catch (e) { return {}; } }
  setCredential(id, obj) { try { window.localStorage.setItem(this.credKey(id), JSON.stringify(obj || {})); } catch (e) {} }

  refreshCalendarViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(CAL_PAGE_VIEW)) {
      const v = leaf.view; if (v && typeof v.reload === 'function') v.reload();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(TASKS_VIEW)) {
      const v = leaf.view; if (v && typeof v.reload === 'function') v.reload();
    }
    // Agenda blocks read the same cache — and it lives under .obsidian/, so no
    // vault event tells them it moved.
    if (this.agenda) this.agenda.refreshAll();
  }

  /* date/mode are optional — an agenda block hands them over so "open in
     calendar" lands on the day it was showing, not on today. */
  async openCalendarPage(date, mode) {
    let leaf = this.app.workspace.getLeavesOfType(CAL_PAGE_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: CAL_PAGE_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const v = leaf.view;
    if (v && date && v.cursor) {
      v.cursor = moment(date);
      if (mode) v.mode = mode;
      if (typeof v.reload === 'function') v.reload(); else if (typeof v.render === 'function') v.render();
    }
  }

  /* One-off rename of id-named task notes (see tasks.migrateTaskNoteNames). */
  async migrateTaskNames() {
    const t = this.settings.tasksCalendar;
    if (!t || !t.enabled || (t.tasks && t.tasks.namesMigrated)) return;
    const res = await tasks.migrateTaskNoteNames(this);
    t.tasks = Object.assign({}, t.tasks, { namesMigrated: true });
    await this.saveSettings();
    if (res.renamed || res.cleaned) {
      new Notice('Nexus: ' + res.renamed + ' task note(s) renamed to their title, ' + res.cleaned + ' checklist(s) cleaned up.', 8000);
      this.refreshCalendarViews();
    }
  }

  /* A task typed straight into a project note belongs on the server too, but
     one keystroke must not fire one sync — collect them and go once it's calm. */
  queueTaskSync(delayMs) {
    window.clearTimeout(this._taskSyncT);
    this._taskSyncT = window.setTimeout(() => {
      if (!this.settings.tasksCalendar.enabled) return;
      this.syncTaskCal().then(r => {
        const lines = (r && r.lines) || [];
        if (lines.length) new Notice('Nexus sync\n' + lines.join('\n'), 6000);
      });
    }, delayMs || 8000);
  }

  async openTasksPage() {
    let leaf = this.app.workspace.getLeavesOfType(TASKS_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: TASKS_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async syncTaskCal() {
    let fsOk = false; try { require('fs'); fsOk = true; } catch (e) {}
    if (!fsOk) return { lines: ['Sync runs on desktop only (mobile reads the synced cache).'] };
    if (this._syncing) return { lines: ['Already syncing…'] };
    const s = this.settings.tasksCalendar;
    if (!s || !s.enabled) return { lines: ['Module is OFF — turn on “Enabled” in Settings → Tasks & Calendar.'] };
    if (!(s.accounts || []).length) return { lines: ['No accounts saved. Add one and click Save.'] };
    this._syncing = true;
    const lines = [], pending = [];
    try {
      for (const acc of s.accounts) {
        const cred = this.getCredential(acc.id);
        if (!cred.secret) { lines.push(acc.label + ': no credential on this device'); continue; }
        try {
          if (acc.kind === 'vikunja') {
            const client = new VikunjaClient({ base: acc.serverUrl, token: cred.secret });
            const { stats, conflicts } = await sync.syncVikunja(this, acc, client);
            lines.push(acc.label + ': ' + stats.pulled + ' pulled · ' + stats.pushed + ' pushed · ' + stats.created + ' new · ' + conflicts.length + ' conflict(s)');
            if (conflicts.length) pending.push({ acc, client, conflicts });
          } else {
            const client = new CalDavClient({ serverUrl: acc.serverUrl, username: acc.username || cred.username, password: cred.secret });
            const results = await calstore.syncAccount(this, acc, client);
            const nCal = (acc.calendars || []).filter(c => c.enabled && c.component === 'VEVENT').length;
            const total = results.reduce((n, r) => n + (r.count || 0), 0);
            const errs = results.filter(r => r.error);
            let msg = acc.label + ': ' + total + ' events across ' + nCal + ' calendar(s)';
            if ((acc.calendars || []).some(c => c.enabled && c.component === 'VTODO')) {
              const { stats, conflicts } = await sync.syncCaldavTodos(this, acc, ical, client);
              msg += ' · tasks ' + stats.pulled + '↓/' + stats.pushed + '↑/' + stats.created + '+' + (conflicts.length ? ' · ' + conflicts.length + ' conflict(s)' : '');
              if (conflicts.length) pending.push({ acc, client, conflicts });
            }
            if (errs.length) msg += ' · errors: ' + errs.map(e => e.error).join('; ');
            lines.push(msg);
          }
        } catch (e) { lines.push(acc.label + ': ERROR — ' + (e && e.message || e)); console.error('[Nexus] sync "' + acc.label + '" failed:', e); }
      }
    } finally { this._syncing = false; }
    for (const p of pending) {
      if (s.conflictPolicy === 'ask') new NexusConflictModal(this, p.acc, p.client, p.conflicts, () => {}).open();
      else for (const rec of p.conflicts) { try { await sync.applyResolution(this, p.acc, p.client, rec, 'server'); } catch (e) {} }
    }
    this.refreshCalendarViews();   // cache lives under .obsidian/ → no vault event fires; refresh explicitly
    return { lines };
  }

  /* ---- Quick Sketch ----
     A `quicksketch` code block renders an interactive vector pad. The drawing
     lives in a standalone .svg sidecar (see views/sketch.js) named after a
     short id; the block body just carries `id: <id>` so the note stays clean.
     The id is assigned lazily on the FIRST committed stroke — viewing a note
     with an empty pad never modifies it. */
  _sketchFolder() { return (this.settings.quicksketch.folder || 'Inbox/Quicksketch').replace(/\/$/, ''); }
  _sketchPath(id) { return this._sketchFolder() + '/' + id + '.svg'; }
  async ensureSketchFolder() {
    if (!this.settings.quicksketch.enabled) return;
    const dir = this._sketchFolder();
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
  }
  async loadSketch(id) {
    const f = this.app.vault.getAbstractFileByPath(this._sketchPath(id));
    if (!(f instanceof TFile)) return null;
    try { return parseSketchSVG(await this.app.vault.read(f)); } catch (e) { return null; }
  }
  async saveSketch(id, svgText) {
    await this.ensureSketchFolder();
    const path = this._sketchPath(id);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.vault.modify(f, svgText);
    else await this.app.vault.create(path, svgText);
  }

  /* Parse the `key: value` body of a sketch block (id / ratio for now). */
  _parseSketchBody(source) {
    const out = {};
    (source || '').split('\n').forEach(line => {
      const m = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/);
      if (m) out[m[1].toLowerCase()] = m[2];
    });
    return out;
  }

  async renderSketch(source, el, ctx) {
    const s = this.settings.quicksketch;
    if (!s.enabled) { el.createEl('pre').createEl('code', { text: source }); return; }
    const params = this._parseSketchBody(source);
    const state = { id: params.id || null, writing: false };
    try {
      await this._renderSketchInner(source, el, ctx, s, params, state);
    } catch (err) {
      // Never leave the reader staring at raw `id: sk-…`. Show the saved drawing
      // as a plain image (it IS a standalone SVG) + a diagnostic, and log it.
      console.error('Nexus Suite: quicksketch render failed', err);
      el.empty();
      const box = el.createDiv('nx-sketch nx-sketch-fallback');
      const f = state.id && this.app.vault.getAbstractFileByPath(this._sketchPath(state.id));
      if (f) { const img = box.createEl('img', { cls: 'nx-sketch-fallback-img' }); img.src = this.app.vault.getResourcePath(f); }
      box.createDiv({ cls: 'nx-sketch-fallback-msg', text: 'Quick Sketch: editor unavailable here — ' + ((err && err.message) || 'error') });
    }
  }

  /* Paper-grain toggle for a saved sketch: its stored flag, else legacy "paperlike"
     (which always carried texture), else off for pre-texture sketches. */
  _resolvePaperStyle(data, s) {
    if (data && data.paperStyle != null) return !!data.paperStyle;
    if (data && data.paper === 'paperlike') return true;
    if (data) return false;
    return s.paperStyle !== false;
  }

  async _renderSketchInner(source, el, ctx, s, params, state) {
    const data = state.id ? await this.loadSketch(state.id) : null;
    // Saved sketch → honour its own stored geometry/paper; otherwise fall back to
    // block params, then the module defaults.
    let W, H, bg, paper, paperStyle, bgType, bgSize, bgOpacity, autoGrow;
    if (data) {
      W = data.w; H = data.h; bg = data.bg || s.bg;
      // Sketches saved before paper modes carry only `bg` → paper stays null and
      // the raw fill is honoured; newer ones restore their stored preset.
      paper = data.paper || null;
      paperStyle = this._resolvePaperStyle(data, s);
      bgType = data.bgType || 'none'; bgSize = data.bgSize || s.bgSize; bgOpacity = (data.bgOpacity != null) ? data.bgOpacity : s.bgOpacity;
      autoGrow = (data.autoGrow != null) ? data.autoGrow : s.autoGrow;
    } else {
      const wh = ratioWH(params.ratio || s.ratio); W = wh[0]; H = wh[1]; bg = s.bg;
      paper = (params.paper || s.paper || 'paper').toLowerCase();
      paperStyle = (params.paperstyle != null) ? (params.paperstyle === 'true') : (s.paperStyle !== false);
      bgType = (params.background || s.bgType || 'none').toLowerCase();
      bgSize = Number(params.gridsize) || s.bgSize;
      bgOpacity = (params.bgopacity != null) ? Number(params.bgopacity) : s.bgOpacity;
      autoGrow = !!s.autoGrow;
    }
    // Legacy "paperlike" preset → the "paper" (off-white) colour; its texture now
    // rides the separate paperStyle toggle (see _resolvePaperStyle).
    if (paper === 'paperlike') paper = 'paper';

    const wrap = el.createDiv('nx-sketch');
    const barWrap = wrap.createDiv('nx-sketch-bar-wrap');   // grid-rows wrapper → smooth collapse
    const bar = barWrap.createDiv('nx-sketch-bar');
    const pad = wrap.createDiv('nx-sketch-pad');            // height comes from the SVG (width:100%/height:auto), not CSS aspect-ratio

    const surface = new NexusSketchSurface(pad, {
      W, H, bg, paper, paperStyle, invertOnDark: s.invertOnDark !== false, ink: s.ink, penSizes: s.penSizes, pen: 'fountain',
      penConfig: (s.penConfig = s.penConfig || {}),   // live reference — pen menu edits apply on the next stroke
      shapeSnap: s.shapeSnap !== false,
      bgType, bgSize, bgOpacity, bgColor: s.bgColor, autoGrow,
      strokes: data ? data.strokes : [],
      resizable: true,
      onCommit: () => this._persistSketch(state, surface, ctx, el),
    });

    // View ⇄ Edit. View = clean, blended into the note, toolbar collapsed, not
    // drawable. Existing drawings open in View; new/empty pads open in Edit so
    // you can draw immediately. (Full-size editor comes later.)
    // Remember the mode PER ID across re-renders — the id-writeback on the first
    // stroke re-renders the block, and we must not snap back to View mid-drawing.
    const modes = (this._sketchMode = this._sketchMode || {});
    const setMode = (m) => {
      wrap.toggleClass('is-edit', m === 'edit');
      wrap.toggleClass('is-view', m === 'view');
      surface.setLocked(m !== 'edit');   // view: pinch/pan still work, drawing doesn't
      if (m === 'view') surface.setHeight(0);   // view is ALWAYS cropped to content (setHeight clamps up to the lowest stroke)
      if (state.id) modes[state.id] = m;
    };
    const enterBtn = pad.createDiv({ cls: 'nx-sketch-enter', attr: { 'aria-label': 'Edit sketch' } });
    setIcon(enterBtn, 'pencil');
    enterBtn.onclick = () => setMode('edit');
    // Compact code-block toolbar. Rebuildable so the full-size editor can resync
    // it (pen/colour/etc. may have changed there) on close.
    const buildInlineBar = () => {
      bar.empty();
      this._buildSketchBar(bar, surface, s, {
        mode: 'compact',
        // Leaving edit → view crops to content (setMode), then persist that height.
        onDone: () => { setMode('view'); if (surface.strokes.length) surface.persist(); },
        onFullscreen: () => this._openSketchFullscreen(surface, pad, wrap, s, buildInlineBar),
      });
    };
    buildInlineBar();
    const remembered = state.id && modes[state.id];
    const hasContent = !!(data && data.strokes && data.strokes.length);
    setMode(remembered || (hasContent ? 'view' : 'edit'));
  }

  /* Open a floating panel under `anchor` immediately; dismiss on outside
     pointerdown. Returns close(). Used for the press-and-hold size slider. */
  _showPopover(anchor, buildFn) {
    const panel = document.body.createDiv('nx-sk-pop');
    const close = () => { if (!panel.parentNode) return; panel.remove(); document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
    buildFn(panel, close);
    const r = anchor.getBoundingClientRect();
    panel.style.top = (r.bottom + 4) + 'px';
    panel.style.left = r.left + 'px';
    const pr = panel.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
    window.setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    return close;
  }

  /* Floating panel anchored under `anchor`, toggled on click, dismissed on any
     outside pointerdown. buildFn(panel, close) fills it. Used for
     custom colour and the live background controls. */
  _sketchPopover(anchor, buildFn) {
    let panel = null;
    const close = () => { if (!panel) return; panel.remove(); panel = null; document.removeEventListener('pointerdown', onDoc, true); };
    const onDoc = (e) => { if (panel && !panel.contains(e.target) && !anchor.contains(e.target)) close(); };
    anchor.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel) { close(); return; }
      panel = document.body.createDiv('nx-sk-pop');
      buildFn(panel, close);
      const r = anchor.getBoundingClientRect();
      panel.style.top = (r.bottom + 4) + 'px';
      panel.style.left = r.left + 'px';
      const pr = panel.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
      document.addEventListener('pointerdown', onDoc, true);
    });
  }

  /* A compact HSV colour picker: hue ring + inner saturation/value square + an
     opacity strip. onChange(color) fires live on every drag; onCommit(color)
     fires on release / hex edit (the point to persist). Emits "#rrggbb" when
     fully opaque, else "rgba(r,g,b,a)" — both render in SVG fill and on the
     live canvas, so stroke colour can now carry transparency. */
  _buildColorPicker(host, initial, onChange, onCommit) {
    host.addClass('nx-cp');
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const hsv2rgb = (h, s, v) => {
      h = (h % 360 + 360) % 360;
      const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
      return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    };
    const rgb2hsv = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
      return [h, mx ? d / mx : 0, mx];
    };
    const parse = (str) => {
      str = String(str || '').trim();
      let m = /^#([0-9a-f]{3})$/i.exec(str);
      if (m) { const t = m[1]; return [parseInt(t[0] + t[0], 16), parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16), 1]; }
      m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(str);
      if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] != null ? parseInt(m[2], 16) / 255 : 1];
      m = /^rgba?\(([^)]+)\)$/i.exec(str);
      if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return [p[0] | 0, p[1] | 0, p[2] | 0, (p[3] != null && !isNaN(p[3])) ? p[3] : 1]; }
      return [47, 47, 47, 1];
    };

    const init = parse(initial);
    let hsv = rgb2hsv(init[0], init[1], init[2]);
    let h = hsv[0], s = hsv[1], v = hsv[2], a = init[3], last = '';

    const wheel = host.createDiv('nx-cp-wheel');
    const ring = wheel.createDiv('nx-cp-ring');
    const ringThumb = wheel.createDiv('nx-cp-ring-thumb');
    const sv = wheel.createDiv('nx-cp-sv');
    const svThumb = sv.createDiv('nx-cp-sv-thumb');
    const alpha = host.createDiv('nx-cp-alpha');
    const alphaThumb = alpha.createDiv('nx-cp-alpha-thumb');
    const foot = host.createDiv('nx-cp-foot');
    const preview = foot.createDiv('nx-cp-preview');
    const hexInp = foot.createEl('input', { cls: 'nx-cp-hex', type: 'text' });

    const CENTER = 108, R = 89, SV = 104;   // wheel is 216px; SV square 104px centred
    const toStr = () => {
      const rgb = hsv2rgb(h, s, v);
      if (a >= 0.999) return '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('');
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(a * 100) / 100})`;
    };
    const paint = (emit) => {
      const hueCol = 'hsl(' + Math.round(h) + ', 100%, 50%)';
      const rgb = hsv2rgb(h, s, v), solid = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      sv.style.setProperty('--cp-hue', hueCol);
      alpha.style.setProperty('--cp-solid', solid);
      const rad = h * Math.PI / 180;
      ringThumb.style.left = (CENTER + R * Math.sin(rad)) + 'px';
      ringThumb.style.top = (CENTER - R * Math.cos(rad)) + 'px';
      ringThumb.style.background = hueCol;
      svThumb.style.left = (s * SV) + 'px';
      svThumb.style.top = ((1 - v) * SV) + 'px';
      svThumb.style.background = solid;
      last = toStr();
      preview.style.background = last;
      if (document.activeElement !== hexInp) hexInp.value = last;
      if (emit && onChange) onChange(last);
    };

    const drag = (el, onMove) => {
      let active = false;
      const move = (e) => { if (!active) return; e.preventDefault(); const r = el.getBoundingClientRect(); onMove(e.clientX - r.left, e.clientY - r.top, r); paint(true); };
      el.addEventListener('pointerdown', (e) => { active = true; try { el.setPointerCapture(e.pointerId); } catch (err) {} move(e); });
      el.addEventListener('pointermove', move);
      const up = () => { if (active && onCommit) onCommit(last); active = false; };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    // Ring: angle (0 at top, clockwise → matches the conic gradient) = hue.
    // Ignore the masked-out centre (that's the SV square) and the far corners.
    drag(ring, (x, y, r) => {
      const dx = x - r.width / 2, dy = y - r.height / 2, dist = Math.hypot(dx, dy);
      if (dist < 58 || dist > r.width / 2 + 6) return;
      h = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    });
    drag(sv, (x, y, r) => { s = clamp01(x / r.width); v = clamp01(1 - y / r.height); });
    drag(alpha, (x, y, r) => { a = clamp01(x / r.width); alphaThumb.style.left = (a * r.width) + 'px'; });

    hexInp.onchange = () => { const p = parse(hexInp.value); const c = rgb2hsv(p[0], p[1], p[2]); h = c[0]; s = c[1]; v = c[2]; a = p[3]; paint(true); if (onCommit) onCommit(last); };

    requestAnimationFrame(() => { const aw = alpha.getBoundingClientRect().width || 212; alphaThumb.style.left = (a * aw) + 'px'; });
    paint(false);
  }

  /* Build the sketch toolbar. Two variants:
       'compact' — the code-block bar. One non-wrapping row: pens · eraser ·
                   size · colours (flex, scrolls if many) · undo/redo · a ⋯
                   overflow menu (background / auto-grow / palettes / clear /
                   done) · a full-size-editor button.
       'full'    — the full-window editor. Same controls, but with room, so
                   background/palettes/auto-grow/clear sit inline and the last
                   button collapses the editor instead of hiding the bar. */
  _buildSketchBar(bar, surface, s, opts) {
    opts = opts || {};
    const full = opts.mode === 'full';
    const plugin = this;
    const iconBtn = (parent, icon, title, cb, cls) => {
      const b = parent.createDiv({ cls: 'nx-sk-btn' + (cls ? ' ' + cls : ''), attr: { 'aria-label': title } });
      setIcon(b, icon);
      if (cb) b.onclick = cb;
      return b;
    };
    const BG_ICON = { none: 'square', grid: 'layout-grid', graph: 'grid-3x3', lines: 'align-justify', dots: 'grip', cross: 'plus', isometric: 'triangle', isodots: 'grip' };

    // ── shared state referenced across groups ──
    let eraBtn, favWrap, colWrap, drawBtn, markerBtn;
    const PEN_META = { fountain: ['Fountain', 'pen-tool'], ballpoint: ['Ballpoint', 'pen'], pencil: ['Pencil', 'pencil'], brush: ['Brush', 'brush'], calligraphy: ['Calligraphy', 'feather'], marker: ['Marker', 'highlighter'] };
    const DRAW_PENS = ['fountain', 'ballpoint', 'pencil', 'brush', 'calligraphy'];
    let drawPen = DRAW_PENS.includes(surface.pen) ? surface.pen : 'fountain';   // the chosen drawing pen behind the first button
    const syncActive = () => {
      const drawing = surface.mode === 'draw';
      if (drawBtn) drawBtn.toggleClass('is-active', drawing && surface.pen !== 'marker');
      if (markerBtn) markerBtn.toggleClass('is-active', drawing && surface.pen === 'marker');
      if (eraBtn) eraBtn.toggleClass('is-active', surface.mode === 'erase');
    };
    const persistSize = () => { s.penSizes[surface.pen] = surface.getSize(); plugin.saveSettings(); };
    const drawWithCurrent = () => { surface.setMode('draw'); syncActive(); };

    /* ═══ pens: [drawing pen ▸ chooser] · eraser · highlighter ═══ */
    // Shared per-pen settings sheet (rebuilt in place). The value now lives IN
    // the label's flex row — never floated — so it can't overlap the rows below
    // (that was the marker-menu overlap).
    const buildPenSettings = (box, id) => {
      box.empty();
      const cfg = s.penConfig[id] || (s.penConfig[id] = {});
      const eff = () => Object.assign({}, PEN_TYPES[id], cfg);
      const slider = (lbl, key, min, max, step) => {
        const w = box.createDiv('nx-sk-slider');
        const head = w.createDiv('nx-sk-slider-lbl');
        head.createSpan({ text: lbl });
        const out = head.createSpan({ cls: 'nx-sk-slider-val', text: String(eff()[key]) });
        const r = w.createEl('input', { type: 'range' });
        r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(eff()[key] != null ? eff()[key] : min);
        r.oninput = () => { const v = Number(r.value); out.setText(String(v)); cfg[key] = v; };
        r.onchange = () => plugin.saveSettings();
      };
      slider('Smoothing', 'streamline', 0, 0.9, 0.05);
      slider('Pressure', 'thinning', 0, 1, 0.05);
      slider('Sharpness', 'taper', 0, 40, 1);
      slider('Speed fade', 'speedThin', 0, 0.8, 0.05);
      if (id === 'marker') {
        const tipRow = box.createDiv('nx-sk-bgtypes');
        [['round', 'Rounded'], ['flat', 'Straight']].forEach(([cap, lbl]) => {
          const b = tipRow.createDiv({ cls: 'nx-sk-bgtype', text: lbl });
          b.toggleClass('is-active', (eff().cap || 'flat') === cap);
          b.onclick = () => { cfg.cap = cap; plugin.saveSettings(); tipRow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active'); };
        });
        const ovRow = box.createDiv('nx-sk-cfgrow');
        ovRow.createSpan({ text: 'Self-overlap adds up' });
        const cb = ovRow.createEl('input', { type: 'checkbox' });
        cb.checked = !eff().noStack;
        cb.onchange = () => { cfg.noStack = !cb.checked; plugin.saveSettings(); };
      }
      const reset = box.createEl('button', { cls: 'nx-sk-savecol', text: 'Reset to defaults' });
      reset.onclick = () => { delete s.penConfig[id]; plugin.saveSettings(); buildPenSettings(box, id); };
    };
    // Drawing-pen button, already active → chooser: pick a drawing pen + tune it.
    const openDrawChooser = (anchor) => {
      plugin._showPopover(anchor, (pop) => {
        pop.addClass('nx-sk-penpop');
        pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Pen' });
        const row = pop.createDiv('nx-sk-penrow');
        const box = pop.createDiv('nx-sk-pensettings');
        DRAW_PENS.forEach(id => {
          const b = row.createDiv({ cls: 'nx-sk-penchip', attr: { 'aria-label': PEN_META[id][0] } });
          setIcon(b, PEN_META[id][1]);
          b.toggleClass('is-active', drawPen === id);
          b.onclick = () => {
            drawPen = id; surface.setPen(id); surface.setMode('draw'); setIcon(drawBtn, PEN_META[id][1]);
            row.querySelectorAll('.nx-sk-penchip').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
            syncActive(); renderFavs(); buildPenSettings(box, id);
          };
        });
        buildPenSettings(box, drawPen);
      });
    };
    const openMarkerConfig = (anchor) => {
      plugin._showPopover(anchor, (pop) => {
        pop.addClass('nx-sk-penpop');
        pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Highlighter' });
        buildPenSettings(pop.createDiv('nx-sk-pensettings'), 'marker');
      });
    };
    const buildPens = (parent) => {
      drawBtn = iconBtn(parent, PEN_META[drawPen][1], 'Pen (tap again: choose + settings)', null);
      drawBtn.onclick = () => {
        if (surface.mode === 'draw' && surface.pen !== 'marker') { openDrawChooser(drawBtn); return; }
        surface.setPen(drawPen); surface.setMode('draw'); setIcon(drawBtn, PEN_META[drawPen][1]); syncActive(); renderFavs();
      };
      eraBtn = iconBtn(parent, 'eraser', 'Erase', () => { surface.setMode('erase'); syncActive(); });
      markerBtn = iconBtn(parent, 'highlighter', 'Highlighter (tap again: settings)', null);
      markerBtn.onclick = () => {
        if (surface.mode === 'draw' && surface.pen === 'marker') { openMarkerConfig(markerBtn); return; }
        surface.setPen('marker'); surface.setMode('draw'); syncActive(); renderFavs();
      };
    };

    /* ═══ size favourites (dots sized to their width) ═══ */
    const dotPx = (px) => Math.max(2, Math.min(20, px));
    const SIZE_MIN = 0.5, SIZE_SPAN = 39.5;
    const sliderToPx = (t) => Math.round((SIZE_MIN + SIZE_SPAN * t * t) * 10) / 10;
    const pxToSlider = (v) => Math.round(Math.sqrt(Math.max(0, (v - SIZE_MIN) / SIZE_SPAN)) * 1000);
    /* Favourites belong to the ACTIVE PEN — a marker and a pencil have nothing
       useful to say about each other's widths. renderFavs() already runs on
       every pen switch, so the strip just follows along. */
    const favsOf = () => {
      const all = s.sizeFavorites && !Array.isArray(s.sizeFavorites) ? s.sizeFavorites : (s.sizeFavorites = {});
      const pen = surface.pen || 'fountain';
      if (!Array.isArray(all[pen]) || !all[pen].length) all[pen] = (pen === 'marker' ? [6, 10, 18] : [1.5, 3, 8]).slice();
      return all[pen];
    };
    const openSizeSlider = (anchor, dot, i) => {
      plugin._showPopover(anchor, (pop) => {
        const favs = favsOf();
        pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Size · ' + (PEN_META[surface.pen] ? PEN_META[surface.pen][0] : 'Pen') });
        const applyVal = (v) => {
          v = Math.max(0.1, Math.round(v * 10) / 10);
          favs[i] = v; out.setText(v + 'px');
          dot.style.setProperty('--d', dotPx(v) + 'px');
          surface.setSize(v); drawWithCurrent();
          favWrap.querySelectorAll('.nx-sk-fav').forEach(x => x.removeClass('is-active')); anchor.addClass('is-active');
        };
        const row = pop.createDiv('nx-sk-sizerow');
        const minus = row.createDiv({ cls: 'nx-sk-stepbtn', text: '−' });
        const r = row.createEl('input', { type: 'range' }); r.min = '0'; r.max = '1000'; r.step = '1'; r.value = String(pxToSlider(favs[i]));
        const plus = row.createDiv({ cls: 'nx-sk-stepbtn', text: '+' });
        const out = pop.createDiv({ cls: 'nx-sk-slider-val nx-sk-slider-val-block', text: favs[i] + 'px' });
        r.oninput = () => applyVal(sliderToPx(Number(r.value) / 1000));
        r.onchange = () => { plugin.saveSettings(); persistSize(); };
        minus.onclick = () => { applyVal(favs[i] - 0.1); r.value = String(pxToSlider(favs[i])); plugin.saveSettings(); persistSize(); };
        plus.onclick = () => { applyVal(favs[i] + 0.1); r.value = String(pxToSlider(favs[i])); plugin.saveSettings(); persistSize(); };
      });
    };
    const renderFavs = () => {
      if (!favWrap) return;
      favWrap.empty();
      const cur = surface.getSize();
      const favs = favsOf();
      favs.forEach((val, i) => {
        const b = favWrap.createDiv({ cls: 'nx-sk-fav', attr: { 'aria-label': val + 'px — tap to use, tap again to adjust' } });
        const dot = b.createDiv('nx-sk-fav-dot');
        dot.style.setProperty('--d', dotPx(val) + 'px');
        if (Math.abs(val - cur) < 0.01) b.addClass('is-active');
        b.onclick = () => {
          if (b.hasClass('is-active')) { openSizeSlider(b, dot, i); return; }
          surface.setSize(favs[i]); persistSize(); drawWithCurrent();
          favWrap.querySelectorAll('.nx-sk-fav').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
        };
      });
    };
    const buildSizes = (parent) => { favWrap = parent.createDiv('nx-sk-favs'); renderFavs(); };

    /* ═══ colours + palettes ═══ */
    const activePal = () => {
      if (!Array.isArray(s.palettes) || !s.palettes.length) s.palettes = [{ name: 'Default', colors: (s.palette || ['#2f2f2f']).slice(0, 8) }];
      if (s.activePalette == null || s.activePalette >= s.palettes.length) s.activePalette = 0;
      const pal = s.palettes[s.activePalette];
      s.palette = pal.colors;
      return pal;
    };
    // Palette switcher popover — named palettes, max 8 colours each. Reused by
    // the inline switcher (full) and the ⋯ menu (compact).
    const paletteBuild = (pop, closePop) => {
      pop.addClass('nx-sk-palpop');
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Palettes' });
      activePal();
      s.palettes.forEach((pal, idx) => {
        const row = pop.createDiv('nx-sk-palrow');
        row.toggleClass('is-active', idx === s.activePalette);
        if (idx === s.activePalette) {
          const nameInp = row.createEl('input', { type: 'text', cls: 'nx-sk-palname' });
          nameInp.value = pal.name || 'Palette';
          nameInp.onchange = () => { pal.name = nameInp.value.trim() || 'Palette'; plugin.saveSettings(); };
          nameInp.onclick = (e) => e.stopPropagation();
        } else {
          row.createSpan({ cls: 'nx-sk-palname-ro', text: pal.name || 'Palette' });
        }
        const sws = row.createDiv('nx-sk-palrow-sw');
        pal.colors.slice(0, 8).forEach(c => { const dot = sws.createDiv('nx-sk-paldot'); dot.style.setProperty('--c', c); });
        if (s.palettes.length > 1) {
          const del = row.createDiv({ cls: 'nx-sk-paldel', attr: { 'aria-label': 'Delete palette' } });
          setIcon(del, 'x');
          del.onclick = (e) => {
            e.stopPropagation();
            s.palettes.splice(idx, 1);
            if (s.activePalette >= s.palettes.length) s.activePalette = s.palettes.length - 1;
            s.palette = s.palettes[s.activePalette].colors;
            plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
          };
        }
        row.onclick = () => {
          if (idx === s.activePalette) return;
          s.activePalette = idx; s.palette = pal.colors;
          plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
        };
      });
      const newBtn = pop.createEl('button', { cls: 'nx-sk-savecol', text: '＋ New palette (copy of current)' });
      newBtn.onclick = () => {
        const pal = activePal();
        s.palettes.push({ name: 'Palette ' + (s.palettes.length + 1), colors: pal.colors.slice(0, 8) });
        s.activePalette = s.palettes.length - 1;
        s.palette = s.palettes[s.activePalette].colors;
        plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
      };
    };
    const renderSwatches = () => {
      if (!colWrap) return;
      colWrap.empty();
      const pal = activePal();
      pal.colors.forEach((col, idx) => {
        const sw = colWrap.createDiv('nx-sk-color');
        sw.style.setProperty('--c', col);
        sw.setAttribute('aria-label', col + ' (tap to use · tap again to edit · right-click to remove)');
        if (String(col).toLowerCase() === String(surface.color).toLowerCase()) sw.addClass('is-active');
        sw.onclick = () => {
          // Tap the ALREADY-selected swatch again → open the colour picker to
          // adjust that palette colour (hue/saturation/opacity), live.
          if (sw.hasClass('is-active')) {
            plugin._showPopover(sw, (pop) => {
              pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Adjust colour' });
              plugin._buildColorPicker(pop, pal.colors[idx],
                (out) => { pal.colors[idx] = out; s.palette = pal.colors; sw.style.setProperty('--c', out); surface.setColor(out); drawWithCurrent(); },
                () => plugin.saveSettings());
            });
            return;
          }
          surface.setColor(col); drawWithCurrent();
          colWrap.querySelectorAll('.nx-sk-color').forEach(x => x.removeClass('is-active')); sw.addClass('is-active');
        };
        sw.oncontextmenu = (e) => { e.preventDefault(); if (pal.colors.length > 1) { pal.colors = pal.colors.filter(c => c !== col); s.palette = pal.colors; plugin.saveSettings(); renderSwatches(); } };
      });
      // The "+" is an ADD affordance — with a full palette there is nothing to
      // add, so it goes away instead of promising a slot and then refusing.
      // Adjusting an existing colour stays available: tap its swatch twice.
      if (pal.colors.length < 8) {
        const cust = colWrap.createDiv('nx-sk-color nx-sk-color-custom');
        setIcon(cust, 'plus');
        cust.setAttribute('aria-label', 'Custom colour');
        plugin._sketchPopover(cust, (pop, closePop) => {
          pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Custom colour' });
          let v = /^(#|rgb)/i.test(surface.color || '') ? surface.color : '#2f2f2f';
          plugin._buildColorPicker(pop, v, (out) => { v = out; surface.setColor(out); drawWithCurrent(); });
          const save = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol', text: 'Save to palette' });
          save.onclick = () => {
            const p = activePal();
            if (p.colors.length >= 8) { new Notice('Nexus: palette is full (max 8 colours).'); return; }
            if (!p.colors.map(c => c.toLowerCase()).includes(v.toLowerCase())) { p.colors.push(v); s.palette = p.colors; plugin.saveSettings(); }
            renderSwatches(); closePop();
          };
        });
      }
      // Full editor keeps the palette switcher inline; the compact bar tucks it
      // into the ⋯ menu (room is tight there).
      if (full) {
        const switcher = colWrap.createDiv('nx-sk-color nx-sk-color-custom');
        setIcon(switcher, 'palette');
        switcher.setAttribute('aria-label', 'Palettes');
        plugin._sketchPopover(switcher, paletteBuild);
      }
    };
    const buildColors = (parent) => { colWrap = parent.createDiv('nx-sk-grp nx-sk-colors'); renderSwatches(); };

    /* ═══ background popover (reused inline + in ⋯) ═══ */
    const bgBuild = (pop, bgBtn) => {
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Paper' });
      const prow = pop.createDiv('nx-sk-bgtypes');
      [['native', 'Native'], ['paper', 'Paper'], ['white', 'White'], ['black', 'Black']].forEach(([id, label]) => {
        const b = prow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', surface.paper === id);
        b.onclick = () => {
          surface.setPaper(id); surface.persist();
          if (opts.onPaper) opts.onPaper(id);
          prow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
        };
      });
      // Paper texture — a toggle that lays the paper grain over ANY paper colour.
      const styleBtn = pop.createDiv({ cls: 'nx-sk-bgtype nx-sk-bgtoggle', text: 'Paper style (texture)' });
      styleBtn.toggleClass('is-active', surface.paperStyle);
      styleBtn.onclick = () => {
        const on = !surface.paperStyle;
        surface.setPaperStyle(on); surface.persist();
        styleBtn.toggleClass('is-active', on);
      };
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Pattern' });
      const trow = pop.createDiv('nx-sk-bgtypes');
      [['none', 'None'], ['grid', 'Grid'], ['graph', 'Graph'], ['lines', 'Lines'], ['dots', 'Dots'], ['cross', 'Cross'], ['isometric', 'Isometric'], ['isodots', 'Iso dots']].forEach(([id, label]) => {
        const b = trow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', surface.bgType === id);
        b.onclick = () => {
          surface.setBackground(id); surface.persist();
          if (bgBtn) { setIcon(bgBtn, BG_ICON[id] || 'layout-grid'); bgBtn.toggleClass('is-active', id !== 'none'); }
          trow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active')); b.addClass('is-active');
        };
      });
      const slider = (label, min, max, step, val, unit, onInput) => {
        const w = pop.createDiv('nx-sk-slider');
        const head = w.createDiv('nx-sk-slider-lbl');
        head.createSpan({ text: label });
        const out = head.createSpan({ cls: 'nx-sk-slider-val', text: val + unit });
        const r = w.createEl('input', { type: 'range' }); r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(val);
        r.oninput = () => { const v = Number(r.value); out.setText(v + unit); onInput(v); };
        r.onchange = () => surface.persist();
      };
      slider('Spacing', 16, 120, 2, surface.bgSize, '', v => surface.setBackground(null, v, null));
      slider('Opacity', 2, 60, 1, Math.round(surface.bgOpacity * 100), '%', v => surface.setBackground(null, null, v / 100));
    };

    /* ═══ auto-grow · clear ═══ */
    const toggleGrow = () => { surface.autoGrow = !surface.autoGrow; surface.persist(); return surface.autoGrow; };
    const clearBuild = (pop, close) => {
      pop.addClass('nx-sk-confirm');
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Clear sketch?' });
      pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'Removes every stroke (undo still works).' });
      const row = pop.createDiv('nx-sk-confirm-row');
      row.createEl('button', { text: 'Cancel' }).onclick = () => close();
      row.createEl('button', { cls: 'mod-warning', text: 'Clear' }).onclick = () => { surface.clear(); close(); };
    };

    /* ═══ compose: left tools · CENTRED colours · right actions ═══ */
    const left = bar.createDiv('nx-sk-grp nx-sk-grp-tools');
    buildPens(left);
    left.createDiv('nx-sk-sep');
    buildSizes(left);

    // Equal flexible spacers on both sides keep the colour block centred (it
    // still shrinks + scrolls internally when a palette is large).
    bar.createDiv('nx-sk-spacer');
    buildColors(bar);
    bar.createDiv('nx-sk-spacer');

    const right = bar.createDiv('nx-sk-grp nx-sk-grp-actions');
    if (full) {
      // Roomy: everything inline; last button collapses the editor.
      // Slate notes grow endlessly on their own → no auto-extend toggle there.
      if (!opts.slate) {
        const growBtn = iconBtn(right, 'chevrons-down', 'Auto-extend canvas downward', null);
        growBtn.toggleClass('is-active', surface.autoGrow);
        growBtn.onclick = () => growBtn.toggleClass('is-active', toggleGrow());
      }
      const bgBtn = iconBtn(right, BG_ICON[surface.bgType] || 'layout-grid', 'Background', null);
      bgBtn.toggleClass('is-active', surface.bgType !== 'none');
      plugin._sketchPopover(bgBtn, (pop) => bgBuild(pop, bgBtn));
      right.createDiv('nx-sk-sep');
      iconBtn(right, 'undo-2', 'Undo', () => surface.undo());
      iconBtn(right, 'redo-2', 'Redo', () => surface.redo());
      const clearBtn = iconBtn(right, 'trash-2', 'Clear', null);
      plugin._sketchPopover(clearBtn, clearBuild);
      if (opts.onCollapse) {   // fullscreen editor: exit button. Protokoll view: none.
        right.createDiv('nx-sk-sep');
        iconBtn(right, 'minimize-2', 'Close full-size editor', () => opts.onCollapse(), 'nx-sk-done');
      }
    } else {
      // Compact: undo/redo · ⋯ overflow · full-size editor · SAVE (always shown).
      iconBtn(right, 'undo-2', 'Undo', () => surface.undo());
      iconBtn(right, 'redo-2', 'Redo', () => surface.redo());
      right.createDiv('nx-sk-sep');
      const moreBtn = iconBtn(right, 'more-horizontal', 'More tools', null);
      plugin._sketchPopover(moreBtn, (pop, closePop) => {
        pop.addClass('nx-sk-menu');
        const item = (icon, label, cb, active) => {
          const it = pop.createDiv('nx-sk-menuitem');
          const ic = it.createDiv('nx-sk-menuitem-ic'); setIcon(ic, icon);
          it.createDiv({ cls: 'nx-sk-menuitem-lbl', text: label });
          if (active) it.addClass('is-active');
          if (cb) it.onclick = cb;
          return it;
        };
        item(BG_ICON[surface.bgType] || 'layout-grid', 'Background', () => { closePop(); plugin._showPopover(moreBtn, (p) => bgBuild(p)); });
        const growItem = item('chevrons-down', 'Auto-extend downward', null, surface.autoGrow);
        growItem.onclick = () => growItem.toggleClass('is-active', toggleGrow());
        item('palette', 'Palettes', () => { closePop(); plugin._showPopover(moreBtn, paletteBuild); });
        pop.createDiv('nx-sk-menu-sep');
        item('trash-2', 'Clear…', () => { closePop(); plugin._showPopover(moreBtn, clearBuild); });
      });
      iconBtn(right, 'maximize-2', 'Full-size editor', () => opts.onFullscreen && opts.onFullscreen(), 'nx-sk-fs');
      right.createDiv('nx-sk-sep');
      // Save & leave the editor — always visible (was buried in ⋯).
      iconBtn(right, 'check', 'Save & close', () => opts.onDone && opts.onDone(), 'nx-sk-done');
    }
    syncActive();
  }

  /* Full-size editor: re-parent the SAME surface into a full-window overlay
     with its own roomy toolbar. The engine only knows its host element, so
     moving the pad carries every stroke, undo step and the low-latency live
     canvas across intact — no second canvas, no state to sync. Closing moves
     the pad back inline and rebuilds the compact bar to reflect any changes. */
  _openSketchFullscreen(surface, pad, wrap, s, rebuildInlineBar) {
    if (document.body.querySelector('.nx-sketch-fs')) return;   // one editor at a time
    const wasLocked = surface.locked, wasGrow = surface.autoGrow;
    surface.setLocked(false);                                   // full-size editor always draws
    surface.autoGrow = true;                                    // endless downward while writing
    const overlay = document.body.createDiv('nx-sketch-fs');
    const barEl = overlay.createDiv('nx-sketch-bar nx-sketch-fs-bar');
    const stage = overlay.createDiv('nx-sketch-fs-stage');
    stage.appendChild(pad);                                     // move the live surface in

    // Endless paper: keep blank canvas below, and extend as the user scrolls
    // toward the bottom (units ↔ px via the pad's on-screen width).
    const unitsPerPx = () => surface.W / (pad.clientWidth || surface.W);
    const onScroll = () => {
      if (surface._resizing) return;
      if (stage.scrollTop + stage.clientHeight > stage.scrollHeight - 260)
        surface.setHeight(surface.H + Math.round(stage.clientHeight * 0.9 * unitsPerPx()));
    };
    stage.addEventListener('scroll', onScroll, { passive: true });
    // Start with ~1.6 screens of paper so the stage is scrollable immediately.
    // Retry until the pad has a real measured width (a 0-width first frame would
    // under-grow and leave nothing to scroll — the "can't scroll" bug).
    const ensurePaper = () => {
      const padW = pad.clientWidth;
      if (!padW) { requestAnimationFrame(ensurePaper); return; }
      const want = Math.round(stage.clientHeight * 1.6 * (surface.W / padW));
      if (surface.H < want) surface.setHeight(want);
    };
    requestAnimationFrame(ensurePaper);

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      stage.removeEventListener('scroll', onScroll);
      surface.autoGrow = wasGrow;
      surface.setHeight(0);                                     // trim empty bottom back to content (clamps up to content min)
      wrap.appendChild(pad);                                    // …and back inline
      overlay.remove();
      surface.setLocked(wasLocked);
      if (surface.strokes.length) surface.persist();            // save trimmed height (+strokes already auto-saved); skip empty→no premature id
      if (rebuildInlineBar) rebuildInlineBar();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    this._buildSketchBar(barEl, surface, s, { mode: 'full', onCollapse: close });
  }

  async _persistSketch(state, surface, ctx, el) {
    try {
      if (!state.id) {
        if (state.writing) return;              // one id assignment per block
        state.writing = true;
        state.id = 'sk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        (this._sketchMode = this._sketchMode || {})[state.id] = 'edit';   // stay in edit after the re-render
        await this.saveSketch(state.id, surface.toSVGString());
        await this._writeSketchId(ctx, el, state.id);
        state.writing = false;
      } else {
        await this.saveSketch(state.id, surface.toSVGString());
      }
    } catch (e) { console.error('Nexus: sketch save failed', e); new Notice('Nexus: could not save sketch.'); }
  }

  /* Insert `id: <id>` as the first body line of the code block, so the note
     re-renders bound to the just-written sidecar. Idempotent: bails if the
     block already has an id (guards the reading + live-preview double render). */
  async _writeSketchId(ctx, el, id) {
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;
    const apply = (content) => {
      const lines = content.split('\n');
      const body = lines.slice(info.lineStart + 1, info.lineEnd);
      if (body.some(l => /^\s*id\s*:/i.test(l))) return content;   // already assigned
      lines.splice(info.lineStart + 1, 0, 'id: ' + id);
      return lines.join('\n');
    };
    if (this.app.vault.process) await this.app.vault.process(file, apply);
    else { const c = await this.app.vault.read(file); const n = apply(c); if (n !== c) await this.app.vault.modify(file, n); }
  }

  /* ---- Slate (drawing note) ----
     A `nexus: slate` note renders 100% natively (title / properties / banner).
     We only INJECT an endless sketch surface below its content (into the
     reading-view / live-preview sizer). Driven by refreshBanner()'s per-view
     loop; re-injects after Obsidian re-renders. Drawing saves to the SAME .svg
     sidecar store as the quicksketch block (id in frontmatter `sketch`). */
  updateProtokoll(view) {
    if (!view || !view.file || view.file.extension !== 'md') return;
    if (!this.settings.quicksketch || this.settings.quicksketch.enabled === false) return;
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;
    const nx = fm ? String(fm.nexus).toLowerCase() : '';
    const isPk = nx === 'slate' || nx === 'protokoll';   // 'protokoll' = legacy
    view.contentEl.toggleClass('nx-pk-note', isPk);
    if (!isPk) {
      const h = view.contentEl.querySelector('.nx-pk-inline'); if (h) h.remove();
      if (view._nxPkObs) { view._nxPkObs.disconnect(); view._nxPkObs = null; }
      return;
    }

    // Inject into the CURRENTLY VISIBLE mode's container. Obsidian keeps the
    // inactive view in the DOM as display:none — blindly preferring reading
    // dropped the surface into a hidden 0×0 tree. Reading → the sizer (before
    // the pusher); live preview/source → the CM scroller (CM wipes sizer kids).
    const mode = view.getMode ? view.getMode() : 'source';
    let container, scroller, before = null;
    if (mode === 'preview') {
      const sizer = view.contentEl.querySelector('.markdown-reading-view .markdown-preview-sizer');
      if (sizer) { container = sizer; scroller = view.contentEl.querySelector('.markdown-reading-view .markdown-preview-view'); before = sizer.querySelector(':scope > .markdown-preview-pusher'); }
    } else {
      // Into the .cm-sizer (block flow → below the content), NOT the .cm-scroller
      // (a flex row → the surface would sit BESIDE the content).
      const cmSizer = view.contentEl.querySelector('.markdown-source-view .cm-sizer');
      if (cmSizer) { container = cmSizer; scroller = view.contentEl.querySelector('.markdown-source-view .cm-scroller'); }
    }
    if (!container) return;
    // Remove any host stranded in the other (now-hidden) mode container.
    view.contentEl.querySelectorAll('.nx-pk-inline').forEach(h => { if (h.parentElement !== container) h.remove(); });

    let host = container.querySelector(':scope > .nx-pk-inline');
    if (host) {
      if (host.dataset.file === view.file.path && (host._surface || host.dataset.mounting)) { this._pkObserve(view); return; }
      host.remove();
    }
    host = container.createDiv('nx-pk-inline');
    if (before && before.parentElement === container) container.insertBefore(host, before);
    host.dataset.file = view.file.path;
    host.dataset.mounting = '1';
    this.mountProtokollSurface(host, view.file, scroller);
    this._pkObserve(view);
  }

  _pkObserve(view) {
    if (view._nxPkObs) return;
    const obs = new MutationObserver(() => {
      if (view._nxPkT) return;
      view._nxPkT = window.setTimeout(() => { view._nxPkT = null; try { this.updateProtokoll(view); } catch (e) {} }, 300);
    });
    obs.observe(view.contentEl, { childList: true, subtree: true });
    view._nxPkObs = obs;
    this.register(() => obs.disconnect());
  }

  async mountProtokollSurface(host, file, scroller) {
    const s = this.settings.quicksketch;
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    let id = fm.sketch || null;
    if (!id) {
      // Assign the sidecar id ONCE, up front (not on first stroke) — a mid-draw
      // frontmatter write would re-render and interrupt the stroke.
      id = 'sk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try { await this.app.fileManager.processFrontMatter(file, f => { if (f.sketch) id = f.sketch; else f.sketch = id; }); } catch (e) {}
    }
    if (!host.isConnected) return;
    const data = await this.loadSketch(id);
    if (!host.isConnected) return;

    // Paper for a slate note: the note's own `sketch-bg` frontmatter is the
    // per-note override, else the sketch's stored preset, else the global default.
    let paper = (fm['sketch-bg'] || (data && data.paper) || s.paper || 'paper').toLowerCase();
    if (paper === 'paperlike') paper = 'paper';   // legacy preset → the off-white "paper" colour
    const paperStyle = this._resolvePaperStyle(data, s);

    const bar = host.createDiv('nx-sketch-bar nx-pk-bar');
    const pad = host.createDiv('nx-sketch-pad nx-pk-pad');
    const surface = new NexusSketchSurface(pad, {
      W: 1600, H: data ? data.h : 1200,
      bg: (data && data.bg) || '', paper, paperStyle, invertOnDark: s.invertOnDark !== false,
      ink: s.ink, penSizes: s.penSizes, pen: 'fountain',
      penConfig: (s.penConfig = s.penConfig || {}),
      shapeSnap: s.shapeSnap !== false,
      bgType: (data && data.bgType) || 'grid',
      bgSize: (data && data.bgSize) || s.bgSize,
      bgOpacity: (data && data.bgOpacity != null) ? data.bgOpacity : s.bgOpacity,
      bgColor: s.bgColor,
      autoGrow: true, fixedViewport: true,   // no pan/zoom — the note scroller scrolls
      strokes: data ? data.strokes : [],
      onCommit: () => { this.saveSketch(id, surface.toSVGString()); },
    });
    host._surface = surface;
    delete host.dataset.mounting;
    surface.setLocked(false);
    // In a slate note the paper picker writes the choice back to `sketch-bg` so
    // it stays the note's canonical override across reloads.
    this._buildSketchBar(bar, surface, s, { mode: 'full', slate: true,
      onPaper: (mode) => { this.app.fileManager.processFrontMatter(file, f => { f['sketch-bg'] = mode; }).catch(() => {}); } });

    // Endless downward using the note's OWN scroll container (passed in).
    if (!scroller) scroller = pad.closest('.markdown-preview-view, .cm-scroller') || pad.parentElement;
    const unitsPerPx = () => surface.W / (pad.clientWidth || surface.W);

    /* Geometry CSS cannot know, published as custom properties on .view-content
       (so both the full-bleed strip and the note's corner buttons inherit it):
         --nx-pk-w    the scroll container's inner width — the strip spans the
                      EDITOR PANE, not the window (100vw broke as soon as a
                      sidebar took width away and clipped the bar's right end)
         --nx-pk-off  how far left the strip must shift to reach that edge
         --nx-pk-top  the scroller's own padding-top (Obsidian's --file-margins);
                      the sticky bar docks above it, otherwise the paper scrolls
                      through the strip between pane top and bar
         --nx-pk-barh the bar's real height — the corner buttons sit below it */
    const root = host.closest('.view-content') || host.parentElement;
    const setVar = (k, v) => { if (root.style.getPropertyValue(k) !== v) root.style.setProperty(k, v); };
    const syncGeom = () => {
      if (!host.isConnected || !scroller || !root) { if (host._nxGeomObs) { host._nxGeomObs.disconnect(); host._nxGeomObs = null; } return; }
      const cs = window.getComputedStyle(scroller);
      const sr = scroller.getBoundingClientRect();
      setVar('--nx-pk-top', (parseFloat(cs.paddingTop) || 0) + 'px');
      setVar('--nx-pk-w', scroller.clientWidth + 'px');
      setVar('--nx-pk-barh', (bar.offsetHeight || 42) + 'px');
      // Static left edge of the strip = parent's content-box left. Read it
      // instead of zeroing the offset first, so this stays a single measure
      // pass (no write-read-write reflow inside the ResizeObserver).
      const parent = host.parentElement;
      if (parent) {
        const pcs = window.getComputedStyle(parent), pr = parent.getBoundingClientRect();
        const contentLeft = pr.left + (parseFloat(pcs.borderLeftWidth) || 0) + (parseFloat(pcs.paddingLeft) || 0);
        const innerLeft = sr.left + (parseFloat(cs.borderLeftWidth) || 0);
        setVar('--nx-pk-off', Math.round(innerLeft - contentLeft) + 'px');
      }
    };
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => syncGeom());
      ro.observe(scroller); ro.observe(bar);
      host._nxGeomObs = ro;
      this.register(() => ro.disconnect());
    }
    const onScroll = () => {
      if (!host.isConnected || !scroller) return;
      if (surface._resizing) return;
      if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 320)
        surface.setHeight(surface.H + Math.round(scroller.clientHeight * 0.9 * unitsPerPx()));
    };
    if (scroller) { this.registerDomEvent(scroller, 'scroll', onScroll, { passive: true }); requestAnimationFrame(syncGeom); }
    const ensure = () => {
      if (!host.isConnected) return;
      const w = pad.clientWidth;
      if (!w) { requestAnimationFrame(ensure); return; }
      const vh = scroller ? scroller.clientHeight : 700;
      const want = Math.round(vh * 1.4 * (surface.W / w));
      if (surface.H < want) surface.setHeight(want);
    };
    requestAnimationFrame(ensure);
  }

  async createProtokollNote() {
    if (!this.settings.quicksketch || this.settings.quicksketch.enabled === false) { new Notice(NX_MODULES.quicksketch.name + ' is switched off.'); return; }
    const stamp = moment().format('YYYY-MM-DD HH.mm');
    let base = 'Slate ' + stamp, path = base + '.md', i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = base + ' ' + (i++) + '.md';
    const id = 'sk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const file = await this.app.vault.create(path, `---\nnexus: slate\nsketch: ${id}\n---\n`);
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  /* Toggle a note between Slate (drawing) mode and plain markdown, in place —
     just flips the `nexus: slate` frontmatter; updateProtokoll (via the refresh
     wiring) shows/hides the sketch surface accordingly. */
  async toggleSlate(file) {
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, f => {
      const on = ['slate', 'protokoll'].includes(String(f.nexus).toLowerCase());
      if (on) delete f.nexus; else f.nexus = 'slate';
    });
  }

  /* A VISIBLE corner button injected into the note (like the banner/bg buttons),
     shown on EVERY markdown note so you can flip Slate mode either way — incl.
     from a plain .md back into a Slate. On view.contentEl (stable, survives CM
     re-renders); icon reflects the current state. addAction() proved invisible
     on mobile, so this is a plain injected button instead. */
  mountSlateControl(view) {
    if (!view || !view.file || view.file.extension !== 'md') return;
    const el = view.contentEl;
    let btn = el.querySelector(':scope > .nx-slate-btn');
    if (!this.settings.quicksketch || this.settings.quicksketch.enabled === false) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el.createDiv('nx-slate-btn');
      btn.onclick = () => { if (view.file) this.toggleSlate(view.file); };
    }
    const fm = (this.app.metadataCache.getFileCache(view.file) || {}).frontmatter;
    const on = !!(fm && ['slate', 'protokoll'].includes(String(fm.nexus).toLowerCase()));
    setIcon(btn, on ? 'file-text' : 'pen-line');
    btn.setAttribute('aria-label', on ? 'Switch to Markdown' : 'Switch to Slate (drawing)');
    btn.toggleClass('is-active', on);
  }

  /* ---- Ink Capture ----
     captureScan() writes the binary; _onInkVaultCreate (a folder-scoped vault
     'create' watcher over all settings.inkCapture.sources) is the single place
     that turns any image/PDF landing in a source folder into a sidecar —
     whether it came from our own button (Paper) or was dropped in some other
     way, e.g. a manual export from Saber/Butterfly synced in. Only
     button-triggered captures (tracked in _inkPending) get the tag-dialog
     popup afterwards. Excalidraw drawings are NOT sidecar'd — they're already
     native taggable .md files, just surfaced in the gallery (see
     NexusInkGalleryView._captures). */
  /* The configured sources, normalised. "paper" is guaranteed present (the
     in-app camera writes there); everything else the user added themselves. */
  inkSources() {
    const s = this.settings.inkCapture;
    if (!Array.isArray(s.sources)) s.sources = [];
    if (!s.sources.some(x => x && x.id === 'paper'))
      s.sources.unshift({ id: 'paper', label: 'Paper (camera)', folder: 'Inbox/Paper', enabled: true });
    return s.sources;
  }
  /* Unique, stable id for a new source — derived from its label, because the id
     is what lands in each sidecar's `ink-source` frontmatter. */
  inkSourceId(label) {
    const base = String(label || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source';
    const taken = new Set(this.inkSources().map(x => x.id));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(base + '-' + i)) i++;
    return base + '-' + i;
  }
  async ensureInkFolders() {
    for (const src of this.inkSources()) {
      if (!src.enabled) continue;
      const dir = (src.folder || '').replace(/\/$/, '');
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
    }
  }
  async activateInkGallery() {
    let leaf = this.app.workspace.getLeavesOfType(INK_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: INK_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
  captureScan() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,application/pdf';
    input.setAttribute('capture', 'environment');   // mobile: prefer the camera, but still lets you pick an existing file (incl. PDF)
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const paper = this.inkSources().find(x => x.id === 'paper') || {};
      const dir = (paper.folder || 'Inbox/Paper').replace(/\/$/, '');
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const base = 'Scan ' + moment().format('YYYY-MM-DD HHmmss');
      const mk = (n) => dir + '/' + base + (n ? '-' + n : '') + '.' + ext;
      let path = mk(0), i = 1;
      while (this.app.vault.getAbstractFileByPath(path)) path = mk(i++);
      this._inkPending.add(path);
      await this.app.vault.createBinary(path, await f.arrayBuffer());
    };
    input.click();
  }
  /* Polls adapter.stat until the file's size is non-zero and size+mtime are
     unchanged across two consecutive 300ms checks — i.e. the writer is done.
     Fully-written files pass on the second poll (~300ms added latency).
     Returns false if the file disappears or hasn't settled after ~15s (a
     still-running huge transfer — better to skip than to process half a
     file; the next 'create' or restart scan will retry it). Uses the
     adapter's stat, not the cached TFile.stat, so every poll hits the real
     on-disk state. Mobile-safe (DataAdapter.stat is plain Vault API). */
  async _waitForInkFileStable(path) {
    let prevSize = -1, prevMtime = -1;
    for (let i = 0; i < 50; i++) {
      let st;
      try { st = await this.app.vault.adapter.stat(path); } catch (e) { return false; }
      if (!st) return false;
      if (st.size > 0 && st.size === prevSize && st.mtime === prevMtime) return true;
      prevSize = st.size; prevMtime = st.mtime;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }
  async _onInkVaultCreate(f) {
    const s = this.settings.inkCapture;
    if (!s.enabled) return;
    if (f.extension === 'md') return;   // our own sidecar write
    if (!INK_EXT.includes((f.extension || '').toLowerCase())) return;   // also filters out folders (no .extension)
    // Cheap first check: thumbnails are always named "<id>.thumb.png".
    if (f.basename.endsWith('.thumb')) return;
    // PERSISTENT anti-recursion guard: our OWN capture attachments are named
    // `ink-<base36id>`. The in-memory _inkSelfCreated Set below can't cover files
    // re-surfaced by a Syncthing sync FROM ANOTHER DEVICE or a restart's startup
    // scan — and that gap is exactly what let the plugin re-capture its own
    // attachments into ever-deeper ink-in-ink folders across a multi-device mesh
    // (observed: 76 nested dupes, depth 21). A name check survives sync/restart/
    // multi-device, unlike any in-memory state. Our attachments never need
    // re-capturing, so skipping them unconditionally is always correct.
    if (/^ink-[a-z0-9]+$/i.test(f.basename)) return;
    if (this._inkSelfCreated && this._inkSelfCreated.delete(f.path)) return;
    // General, PERSISTENT safety net: the .thumb check and the pre-registered
    // attachment path only cover the two known derived-file cases; this is
    // the structural fallback for anything else (e.g. a restart where
    // Obsidian's startup scan "discovers" an existing attachment/thumbnail
    // and fires 'create' for it, with no memory of the in-session rename).
    // A folder-note capture folder is ALWAYS named after its sidecar (that's
    // the folder-notes convention we rely on), so this checks plain file
    // EXISTENCE at that exact expected path — not the metadataCache, which
    // during a bulk startup scan may not have parsed a sibling .md's
    // frontmatter yet and would make this check flaky/racy. Existence in the
    // vault's file index is synchronous and immediate, no such race.
    if (f.parent && f.parent.path && this.app.vault.getAbstractFileByPath(f.parent.path + '/' + f.parent.name + '.md')) return;
    // Fallback for the rare case the folder-note's name ever drifts from the
    // folder's own name (frontmatter-based, same as before).
    const sib = f.parent && f.parent.children;
    if (sib && sib.some((c) => c !== f && c.extension === 'md' &&
      ((this.app.metadataCache.getFileCache(c) || {}).frontmatter || {})['ink-source'])) return;
    const entry = this.inkSources().find(src =>
      src.enabled && src.folder && f.path.startsWith((src.folder || '').replace(/\/$/, '') + '/'));
    if (!entry) return;
    // Some adapters fire 'create' more than once for the same write (e.g. the
    // filesystem watcher noticing the file in addition to the Vault API's own
    // event) — without this guard that raced two full _makeInkSidecar runs on
    // the same file (double rename, duplicate embed attempts).
    if (this._inkProcessing.has(f.path)) return;
    this._inkProcessing.add(f.path);
    try {
      // Obsidian fires 'create' the moment a file EXISTS, not when it's fully
      // WRITTEN — file managers and exporters create-then-stream, so reading
      // right away can yield zero/partial bytes. Runtime-hit once: an
      // update-on-re-export read a still-empty drop and copied that
      // nothingness over the stored PDF, destroying it. Wait for the writer
      // to finish before touching the file at all.
      if (!(await this._waitForInkFileStable(f.path))) return;
      await this._makeInkSidecar(f, entry.id);
    } finally {
      this._inkProcessing.delete(f.path);
    }
  }
  /* Re-encodes the file in place if it's a raster image bigger than
     INK_MAX_DIM on its longest edge — pure canvas/createImageBitmap, no
     Electron/node dependency, so this stays mobile-safe. Leaves PDFs, SVGs and
     already-reasonably-sized images untouched. */
  async _maybeDownscaleInkImage(f) {
    const ext = (f.extension || '').toLowerCase();
    if (!INK_DOWNSCALE_EXT.includes(ext)) return;
    try {
      const buf = await this.app.vault.readBinary(f);
      const bitmap = await createImageBitmap(new Blob([buf]));
      const tooBig = bitmap.width > INK_MAX_DIM || bitmap.height > INK_MAX_DIM;
      if (!tooBig) { bitmap.close(); return; }
      const scale = INK_MAX_DIM / Math.max(bitmap.width, bitmap.height);
      const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
      const blob = await new Promise(res => canvas.toBlob(res, mime, 0.85));
      if (blob) await this.app.vault.modifyBinary(f, await blob.arrayBuffer());
    } catch (e) { console.error('[Nexus] ink downscale:', e); /* leave the original file untouched on failure */ }
  }
  /* Butterfly (infinite canvas) exports the SVG at the size of the whole
     virtual canvas, not just the drawn area — a small doodle can end up on a
     12000×13000px sheet, invisible once scaled into an embed. Fix: mount the
     SVG off-screen (real layout, not display:none) so the native SVG
     getBBox() can measure the ACTUAL drawn geometry, then rewrite viewBox/
     width/height to that bounding box (+ small padding). Pure DOM/SVG APIs,
     no Electron — mobile-safe. Leaves normally-sized SVGs untouched-ish (still
     re-tightens the box, harmless if it was already close to content). */
  async _maybeCropInkSvg(f) {
    if ((f.extension || '').toLowerCase() !== 'svg') return;
    let host = null;
    try {
      const buf = await this.app.vault.readBinary(f);
      const text = new TextDecoder().decode(buf);
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svgEl = doc.documentElement;
      if (!svgEl || svgEl.nodeName !== 'svg' || svgEl.querySelector('parsererror')) return;
      host = document.body.createDiv();
      host.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;';
      host.appendChild(svgEl);
      const bbox = svgEl.getBBox();
      if (!bbox || !bbox.width || !bbox.height) return;
      const pad = Math.max(bbox.width, bbox.height) * 0.04;
      const vb = [bbox.x - pad, bbox.y - pad, bbox.width + pad * 2, bbox.height + pad * 2];
      svgEl.setAttribute('viewBox', vb.join(' '));
      svgEl.setAttribute('width', String(vb[2]));
      svgEl.setAttribute('height', String(vb[3]));
      // Ink-drawing exports (Linwood/Butterfly) are transparent — whatever
      // background you saw was your SVG program's own canvas chrome, not part
      // of the file. Bake a real white "paper" rect in, behind the strokes,
      // so it looks like paper everywhere (Obsidian, any theme, any viewer).
      const bg = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', String(vb[0])); bg.setAttribute('y', String(vb[1]));
      bg.setAttribute('width', String(vb[2])); bg.setAttribute('height', String(vb[3]));
      bg.setAttribute('fill', '#ffffff');
      svgEl.insertBefore(bg, svgEl.firstChild);
      const out = new XMLSerializer().serializeToString(svgEl);
      await this.app.vault.modifyBinary(f, new TextEncoder().encode(out).buffer);
    } catch (e) { console.error('[Nexus] ink svg crop:', e); /* leave the original file untouched on failure */ }
    finally { if (host) host.remove(); }
  }
  /* Renders PDF page 1 to a cached PNG thumbnail (attPath + '.thumb.png'),
     using Obsidian's OWN bundled pdf.js (loadPdfJs() — no bundler needed, this
     is a documented Obsidian API, same lib Obsidian's own PDF viewer uses).
     Generated at capture time (and re-rendered when a re-export updates the
     capture) and stored in ink-thumb frontmatter, so the gallery just loads a
     plain image on every re-render instead of re-parsing the PDF each time.
     Returns null (silently) if pdf.js can't be loaded or rendering fails —
     the gallery falls back to a placeholder icon. */
  async _makeInkPdfThumb(attPath) {
    let pdf = null;
    try {
      if (!window.pdfjsLib) await loadPdfJs();
      const pdfjsLib = window.pdfjsLib;
      if (!pdfjsLib) return null;
      const file = this.app.vault.getAbstractFileByPath(attPath);
      if (!file) return null;
      const buf = await this.app.vault.readBinary(file);
      pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.max(500 / base.width, 0.2) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) return null;
      const thumbPath = attPath.replace(/\.pdf$/i, '') + '.thumb.png';
      const data = await blob.arrayBuffer();
      // Overwrite when the thumb already exists (re-export of an existing
      // capture re-renders it) — createBinary throws on existing files.
      const existing = this.app.vault.getAbstractFileByPath(thumbPath);
      if (existing) {
        await this.app.vault.modifyBinary(existing, data);
      } else {
        (this._inkSelfCreated || (this._inkSelfCreated = new Set())).add(thumbPath);
        await this.app.vault.createBinary(thumbPath, data);
      }
      return thumbPath;
    } catch (e) { console.error('[Nexus] ink pdf thumb:', e); return null; }
    // Release the document/worker — this shares Obsidian's OWN pdfjsLib
    // instance (that's the point of loadPdfJs()), so leaving it open here is
    // the prime suspect for the native embed viewer later failing to open
    // the exact same file (shows as "0 of 0" pages).
    finally { if (pdf) { try { await pdf.destroy(); } catch (e) {} } }
  }
  async _makeInkSidecar(f, sourceId) {
    const origPath = f.path;   // vault.rename mutates f.path below — keep the pre-move path for the _inkPending check
    const dirPath = f.parent && f.parent.path && f.parent.path !== '/' ? f.parent.path + '/' : '';
    // One folder per capture (Inbox/<Source>/<name>/, note + raw file + any
    // thumbnail all flat inside it — no further "attachments" nesting, the
    // capture folder itself is already the unit of encapsulation) instead of
    // a flat list + shared attachments folder — the note is a "folder note"
    // (folder-notes plugin, storageLocation:
    // insideFolder, syncFolderName:true keeps folder+note names in sync on
    // rename automatically, hideFolderNote hides it from the expanded
    // listing) so opening the capture stays a single click/tap on the folder,
    // same ergonomics as a flat note list, while everything for one capture
    // lives together. Nothing else needed to change for this — the gallery/
    // rename/watcher code all already goes through ink-file's full stored
    // path or plain TFile references, never assumes flat co-location.
    // Captures are keyed by drop NAME + FORMAT: a drop matching an existing
    // capture's name AND attachment extension is a re-export of that capture
    // (→ update in place, further below); the same name in a DIFFERENT
    // format is a legitimately separate note (a Saber PDF and e.g. a PNG may
    // share a title), so it gets its own capture under a numbered variant of
    // the name ("<name> 1", "<name> 2", … — the folder-note convention needs
    // folder and sidecar to share the name, so duplicate plain names can't
    // coexist). The loop scans those name slots in order until it finds
    // either the matching-format capture to update or a free slot to create
    // in; slots occupied by non-capture folders/files are skipped the same
    // way as foreign-format captures.
    const ext = (f.extension || '').toLowerCase();
    // Button-triggered captures (camera/scan) are always NEW captures — never
    // updates. Their timestamped names make a collision with an existing
    // capture near-impossible anyway (same wall-clock second), but if one
    // happens, silently overwriting that capture's file would lose it;
    // uniquifying into the next free name slot instead is always safe.
    const isButtonCapture = this._inkPending.has(origPath);
    let sidecar = null, existingAtt = null, captureDir, sidecarPath;
    for (let i = 0; ; i++) {
      const name = f.basename + (i ? ' ' + i : '');
      captureDir = dirPath + name;
      sidecarPath = captureDir + '/' + name + '.md';
      const sc = this.app.vault.getAbstractFileByPath(sidecarPath);
      if (sc) {
        // Resolve this capture's attachment — frontmatter first, falling
        // back to the id-naming convention for the startup-scan window where
        // the metadataCache hasn't parsed the sidecar yet (exactly when
        // Syncthing-synced re-exports get discovered).
        const fm = ((this.app.metadataCache.getFileCache(sc) || {}).frontmatter || {});
        let att = fm['ink-file'] && this.app.vault.getAbstractFileByPath(fm['ink-file']);
        if (!att) {
          const dir = this.app.vault.getAbstractFileByPath(captureDir);
          att = ((dir && dir.children) || []).find((c) =>
            c.extension && /^ink-/.test(c.basename) && !c.basename.endsWith('.thumb'));
        }
        if (!isButtonCapture && att && att.extension.toLowerCase() === ext) { sidecar = sc; existingAtt = att; break; }
        continue;
      }
      if (!this.app.vault.getAbstractFileByPath(captureDir)) break;
    }
    if (!sidecar) {
      // Shrink oversized raster captures BEFORE they ever get embedded — a
      // multi-thousand-pixel, tens-of-MB image has no business in a "scan"
      // pipeline and is also the prime suspect for Live Preview rendering an
      // embed twice while it decodes such a huge file.
      await this._maybeDownscaleInkImage(f);
      await this._maybeCropInkSvg(f);
      if (!this.app.vault.getAbstractFileByPath(captureDir)) { try { await this.app.vault.createFolder(captureDir); } catch (e) {} }
      // Named after the id (not the display name) — that way the sidecar can
      // be freely renamed later without the image/note association ever
      // depending on matching filenames.
      const id = 'ink-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      // Flat inside the capture folder — no separate "attachments" subfolder.
      // The capture folder IS already the unit of encapsulation; nesting
      // further just adds a click for no benefit (see _onInkVaultCreate for
      // how the thumbnail's own 'create' event is kept from being mistaken
      // for a fresh capture, now that "parent folder named attachments" is no
      // longer a usable signal).
      const attPath = captureDir + '/' + id + '.' + f.extension;
      // Pre-register BEFORE renaming: at this exact moment the sidecar .md
      // doesn't exist yet (that happens further below), so if vault.rename
      // ever fires so much as a stray 'create' for the destination — some
      // adapters do this for cross-directory moves — the sibling-sidecar
      // check in _onInkVaultCreate would find nothing there yet and
      // misidentify the attachment as a genuinely new capture, recursing
      // into an ever-deeper nested folder, again and again, within the same
      // session (not just across restarts like the thumbnail case above).
      (this._inkSelfCreated || (this._inkSelfCreated = new Set())).add(attPath);
      await this.app.vault.rename(f, attPath);
      const attName = attPath.split('/').pop();
      const thumbPath = f.extension.toLowerCase() === 'pdf' ? await this._makeInkPdfThumb(attPath) : null;

      // created/updated use a compact local-time stamp ('YYYY-MM-DD_HH:mm')
      // — anything READING them must parse that format explicitly (see
      // _sortKey; Date.parse chokes on the underscore). No 'type' key: a
      // note IS an ink capture iff it has 'ink-source' — that's the marker
      // every consumer (gallery filter, nx-ink-note class, watcher sibling
      // fallback) checks.
      const stamp = moment().format('YYYY-MM-DD_HH:mm');
      const body = '---\n'
        + 'tags:\n  - scribble\n'
        + 'id: ' + id + '\n'
        + 'created: ' + stamp + '\n'
        + 'updated: ' + stamp + '\n'
        + 'ink-source: ' + sourceId + '\n'
        + 'ink-file: "' + attPath.replace(/"/g, '\\"') + '"\n'
        + (thumbPath ? 'ink-thumb: "' + thumbPath.replace(/"/g, '\\"') + '"\n' : '')
        + '---\n\n'
        + '![[' + attName + ']]\n';
      sidecar = await this.app.vault.create(sidecarPath, body);
    } else {
      // RE-EXPORT of this capture (same name AND format, matched above).
      // Previously any name collision silently did nothing, which stranded
      // the new file as an orphan next to the capture folder and left the
      // stored attachment + thumbnail stale. Instead, update the capture in
      // place: normalize the drop exactly like a fresh capture, copy its
      // bytes into the existing id-named attachment (path stays stable, so
      // the sidecar's embed + frontmatter keep working untouched), re-render
      // the cached thumbnail, then trash the now-redundant drop.
      await this._maybeDownscaleInkImage(f);
      await this._maybeCropInkSvg(f);
      const newBytes = await this.app.vault.readBinary(f);
      // Never replace a good attachment with an empty read — the stability
      // wait in _onInkVaultCreate should make this unreachable, but blanking
      // the stored capture is the one non-recoverable outcome here (happened
      // once at runtime before that wait existed).
      if (!newBytes || !newBytes.byteLength) {
        console.warn('[Nexus] ink re-export skipped (empty read): ' + origPath);
        return sidecar;
      }
      await this.app.vault.modifyBinary(existingAtt, newBytes);
      const thumbPath = ext === 'pdf' ? await this._makeInkPdfThumb(existingAtt.path) : null;
      await this.app.fileManager.processFrontMatter(sidecar, (fr) => {
        fr.updated = moment().format('YYYY-MM-DD_HH:mm');
        if (thumbPath) fr['ink-thumb'] = thumbPath;   // heals a capture whose thumb failed at capture time, too
      });
      // Trash (not delete) — respects the user's "deleted files" setting and
      // keeps the drop recoverable in case the new export wasn't intended.
      await this.app.fileManager.trashFile(f);
      new Notice('Ink capture updated: ' + sidecar.basename);
    }
    if (this._inkPending.has(origPath)) {
      this._inkPending.delete(origPath);
      if (this.settings.inkCapture.tagOnCapture) {
        const res = await new NexusInkTagModal(this.app, sidecar.basename).openAndGet();
        if (res) {
          await this.app.fileManager.processFrontMatter(sidecar, fr => {
            fr.tags = Array.from(new Set(['scribble', ...(res.tags || [])]));   // 'scribble' is the always-on capture tag
            if (res.note) fr.note = res.note;
          });
          if (res.name && res.name !== sidecar.basename) sidecar = await this._renameInkSidecar(sidecar, res.name);
        }
      }
    }
    return sidecar;
  }
  /* Renames the sidecar note only — the attachment keeps its id-based
     filename, so this never needs to touch (or trust) the image. */
  async _renameInkSidecar(file, name) {
    const dirPath = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.path + '/' : '';
    const slug = String(name).trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!slug) return file;
    const mk = (n) => dirPath + slug + (n ? ' ' + n : '') + '.md';
    const dest0 = mk(0);
    if (dest0 === file.path) return file;
    let dest = dest0, i = 1;
    while (this.app.vault.getAbstractFileByPath(dest)) dest = mk(i++);
    await this.app.fileManager.renameFile(file, dest);
    return this.app.vault.getAbstractFileByPath(dest) || file;
  }

  /* ---- Timer (shared state, survives leaving the dashboard) ----
     _timers[uid] = { running, end(abs ms), remain(sec, paused), minutes, done }.
     Both the dashboard widget AND the sidebar render the same state via buildTimer(). */
  _timer(uid, minutes) {
    return this._timers[uid] || (this._timers[uid] =
      { running: false, end: 0, remain: (minutes || 5) * 60, minutes: minutes || 5, done: false });
  }
  timerRemaining(uid) {
    const t = this._timers[uid]; if (!t) return 0;
    return t.running ? (t.end - Date.now()) / 1000 : t.remain;
  }
  setTimerMinutes(uid, n) {
    const t = this._timer(uid); t.minutes = n;
    if (!t.running) { t.remain = n * 60; t.done = false; }
  }

  // Builds the timer UI into `parent` and returns a paint() function that the
  // caller ticks every second. onSetMinutes stores the new duration in the widget.
  buildTimer(parent, uid, opts, onSetMinutes) {
    opts = opts || {};
    const t = this._timer(uid, opts.minutes);
    if (opts.minutes != null) t.minutes = t.minutes || opts.minutes;
    const box = parent.createDiv('nx-home-live nx-timer');
    const disp = box.createDiv('nx-timer-disp');
    const ctrl = box.createDiv('nx-timer-ctrl');
    const fmt = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), sec = s % 60; return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec; };
    const mins = () => (this._timers[uid] && this._timers[uid].minutes) || opts.minutes || 5;
    const mkBtn = (icon, fn, cls) => {
      const b = ctrl.createEl('button', { cls: 'nx-timer-btn' + (cls ? ' ' + cls : '') });
      setIcon(b, icon);
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    // Set the time by CLICKING THE DISPLAY (no edit button). Works in any mode.
    const editTime = async () => {
      const v = await new NexusNameModal(this.app, 'Timer duration (minutes)', String(mins())).openAndGet();
      const n = parseInt(v, 10);
      if (isNaN(n) || n <= 0) return;
      const x = this._timers[uid]; x.minutes = n;
      if (!x.running) { x.remain = n * 60; x.done = false; }
      if (typeof onSetMinutes === 'function') await onSetMinutes(n);
      drawCtrl(); paint();
    };
    disp.addClass('nx-timer-editable');
    disp.setAttribute('aria-label', 'Set time (click)');
    disp.onclick = (e) => { e.stopPropagation(); editTime(); };
    const drawCtrl = () => {
      ctrl.empty();
      const tt = this._timers[uid]; if (!tt) return;
      mkBtn(tt.running ? 'pause' : 'play', () => {
        const x = this._timers[uid];
        if (x.running) { x.remain = this.timerRemaining(uid); x.running = false; }
        else { if (x.done) { x.done = false; x.remain = mins() * 60; } x.end = Date.now() + Math.max(1, this.timerRemaining(uid)) * 1000; x.running = true; }
        drawCtrl(); paint(); this._syncTimerSidebar();
      });
      mkBtn('rotate-ccw', () => { const x = this._timers[uid]; x.running = false; x.done = false; x.remain = mins() * 60; drawCtrl(); paint(); this._syncTimerSidebar(); });
      if (tt.done) mkBtn('check', () => { const x = this._timers[uid]; x.done = false; x.running = false; x.remain = mins() * 60; drawCtrl(); paint(); this._syncTimerSidebar(); }, 'nx-timer-dismiss');
    };
    let lastR = null, lastD = null;
    const paint = () => {
      const tt = this._timers[uid]; if (!tt) return;
      disp.setText(fmt(this.timerRemaining(uid)));
      if (tt.running !== lastR || tt.done !== lastD) {
        lastR = tt.running; lastD = tt.done;
        box.toggleClass('is-running', !!tt.running);
        box.toggleClass('is-done', !!tt.done);
        drawCtrl();
      }
    };
    drawCtrl(); paint();
    return paint;
  }

  // Global 1s tick (plugin level): detects expiry even without an open dashboard.
  _tickTimers() {
    const timers = this._timers || {};
    let fired = false;
    for (const uid in timers) {
      const t = timers[uid];
      if (t.running && !t.done && (t.end - Date.now()) <= 0) {
        t.running = false; t.remain = 0; t.done = true;
        this._fireTimerDone(uid);
        fired = true;
      }
    }
    if (fired) this._syncTimerSidebar();
  }

  _fireTimerDone(uid) {
    const t = this._timers[uid] || {};
    const minutes = t.minutes || 0;
    const msg = this._timerDoneMsg(uid);
    const title = (minutes ? minutes + '-minute timer finished.' : 'Timer finished.');
    const pauseSec = this._timerPauseSec(uid);
    // A real popup window (modal), visible no matter where you are in Obsidian.
    // With an active break timer it can only be closed after the break elapses.
    new NexusTimerDoneModal(this.app, title, msg, pauseSec).open();
    // Additionally a system notification (Electron renderer). Ask for permission once if needed.
    const body = title + (msg ? ' ' + msg : '');
    try {
      if (typeof Notification !== 'undefined') {
        const show = () => { try { new Notification('Nexus Timer', { body }); } catch (e) {} };
        if (Notification.permission === 'granted') show();
        else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') show(); });
      }
    } catch (e) {}
  }

  // Message shown in the done popup below the line — configurable per timer
  // widget in edit mode (item.doneMsg), otherwise a default text.
  _timerDoneMsg(uid) {
    const w = (this.hp().widgets || []).find(x => x.uid === uid);
    const m = w && typeof w.doneMsg === 'string' ? w.doneMsg.trim() : '';
    return m || 'Time for a little break!';
  }

  // Break duration in seconds (0 = no break timer). If active, it locks the
  // done popup's close button until the break has elapsed.
  _timerPauseSec(uid) {
    const w = (this.hp().widgets || []).find(x => x.uid === uid);
    if (!w || !w.pauseEnabled) return 0;
    const m = parseInt(w.pauseMinutes, 10);
    return (!isNaN(m) && m > 0) ? m * 60 : 0;
  }

  /* Sidebar control: a running/finished timer is mirrored into the sidebar as
     soon as the dashboard is NOT the active tab; back into the dashboard
     (sidebar closed) as soon as the homepage is opened again. */
  _syncTimerSidebar() {
    if (this._syncingTimer) return;
    const anyActive = Object.keys(this._timers || {}).some(uid => { const t = this._timers[uid]; return t && (t.running || t.done); });
    const homeActive = !!this.app.workspace.getActiveViewOfType(NexusHomepageView);
    const want = anyActive && !homeActive;
    const leaves = this.app.workspace.getLeavesOfType(TIMER_VIEW);
    if (want && !leaves.length) {
      this._syncingTimer = true;
      this._openTimerSidebar().finally(() => { this._syncingTimer = false; });
    } else if (!want && leaves.length) {
      this.app.workspace.detachLeavesOfType(TIMER_VIEW);
    } else if (want && leaves.length) {
      const v = leaves[0].view; if (v && v.render) v.render();
    }
  }
  async _openTimerSidebar() {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: TIMER_VIEW, active: false });
    this.app.workspace.revealLeaf(leaf);
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

  /* ---- Theme adjustments (palette + spacing) ----
     The palette overrides the wallust --wl-* slots via an injected <style>;
     spacing/sizes as CSS variables on <body> (override the theme defaults). */
  applyThemeSettings() {
    const t = this.settings.theme || {};
    let pel = document.getElementById('nx-palette-style');
    if (t.palette && t.palette !== 'dynamic' && PALETTES[t.palette]) {
      if (!pel) { pel = document.createElement('style'); pel.id = 'nx-palette-style'; document.head.appendChild(pel); }
      const decl = Object.entries(PALETTES[t.palette]).map(([k, v]) => '--wl-' + k + ': ' + v + ';').join(' ');
      pel.textContent = 'body.theme-dark, body.theme-light { ' + decl + ' }';
    } else if (pel) { pel.remove(); }

    /* Flat "70s color-block" surfaces (theme.css section 20) — only for the
       palettes that ship dedicated surface colours. Currently just "nexus". */
    const NX_BLOCKED = new Set(['nexus']);
    document.body.classList.toggle('nx-blocked', NX_BLOCKED.has(t.palette));

    const b = document.body;
    const setv = (k, v) => { if (v == null || v === '') b.style.removeProperty(k); else b.style.setProperty(k, v + 'px'); };
    setv('--nx-gap', t.gap);
    setv('--nx-radius', t.radius);
    setv('--nx-home-gap', t.homeGap);
    setv('--nx-home-pad', t.homePad);
    setv('--nx-home-row', t.homeRow);
  }

  /* Strength of the note background pattern (lined/grid/dotted). It's mixed
     out of --text-normal, so how visible it is depends entirely on the active
     palette — a fixed percentage that reads well on one background disappears
     on the next. Hence a setting instead of a constant. */
  applyNoteBgStrength() {
    const v = this.settings.banner && this.settings.banner.bgStrength;
    document.body.style.setProperty('--nx-bg-strength', (v == null ? 4.5 : v) + '%');
  }

  /* ---- Explorer polish ----
     Only toggles a body class; the actual styling of the folder cards lives in
     the Nexus theme (section 7) and therefore only applies with the theme active. */
  applyExplorer() {
    const s = this.settings.explorer || {};
    const on = !!(s.enabled && s.folderBg);
    document.body.classList.toggle('nx-explorer-folders', on);
    if (on && s.intensity != null)
      document.body.style.setProperty('--nx-fld-intensity', s.intensity + '%');
    else
      document.body.style.removeProperty('--nx-fld-intensity');
  }

  /* ---- Ribbon visibility (hover / always / hidden) ----
     Sets a body class AND injects the CSS rule itself (via <style>), so both
     ALWAYS come from the same call — independent of a theme/styles.css reload.
     Targets exactly .workspace-ribbon.mod-left (confirmed via devtools). */
  applyRibbon() {
    const mode = (this.settings.ribbon && this.settings.ribbon.mode) || 'always';
    document.body.classList.toggle('nx-ribbon-hover', mode === 'hover');
    document.body.classList.toggle('nx-ribbon-hidden', mode === 'hidden');
    let st = document.getElementById('nx-ribbon-style');
    if (!st) { st = document.createElement('style'); st.id = 'nx-ribbon-style'; document.head.appendChild(st); }
    st.textContent =
      'body.nx-ribbon-hidden .workspace-ribbon.mod-left,' +
      'body.nx-ribbon-hidden .side-dock-ribbon.mod-left{display:none !important;}' +
      // overlay instead of in-flow → expanding shifts NOTHING (no flicker).
      'body.nx-ribbon-hover .workspace{position:relative;}' +
      'body.nx-ribbon-hover .workspace-ribbon.mod-left,' +
      'body.nx-ribbon-hover .side-dock-ribbon.mod-left{' +
        'position:absolute !important;top:0;bottom:0;left:0;z-index:100;' +
        'width:56px !important;min-width:56px !important;max-width:56px !important;flex:0 0 56px !important;' +
        'overflow:hidden;' +
        'transform:translateX(calc(-100% + 10px));' +   // only 10px stick out as the hover zone
        'background:transparent !important;border-color:transparent !important;box-shadow:none !important;margin:0 !important;' +
        'transition:transform .16s ease,background .16s ease;}' +
      'body.nx-ribbon-hover .workspace-ribbon.mod-left:hover,' +
      'body.nx-ribbon-hover .side-dock-ribbon.mod-left:hover{' +
        'transform:translateX(0);' +
        'background:var(--nx-chip-side,var(--background-secondary)) !important;' +
        'border:1px solid var(--nx-border,var(--background-modifier-border)) !important;' +
        'border-radius:var(--nx-radius,12px) !important;margin:6px !important;}';
  }
};
