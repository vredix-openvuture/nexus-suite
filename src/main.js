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
const { NexusSideView } = require('./views/sidebar.js');
const { NexusSketchPaneView } = require('./views/sketchpane.js');
const { NexusEventModal } = require('./modals/event.js');
const { NexusTaskModal } = require('./modals/task.js');
const calstore = require('./lib/calstore.js');
const tasks = require('./lib/tasks.js');
const sync = require('./lib/sync.js');
const { VikunjaClient } = require('./lib/vikunja.js');
const { NexusConflictModal } = require('./modals/conflict.js');
const { NexusCalloutInsertModal, NexusCalloutSuggest } = require('./modals/callout.js');
const { BAR_DEFAULTS, BAR_ITEMS, BAR_ITEM_IDS, SELECT_SHAPES, RULER_ANGLES, CAL_VIEW, CAL_PAGE_VIEW, TASKS_VIEW, DEFAULT_SETTINGS, HOME_VIEW, IMG_EXT, INK_DOWNSCALE_EXT, INK_EXT, INK_MAX_DIM, INK_VIEW, CAPTURE_VIEW, GALAXY_VIEW, SCRATCH_VIEW, SIDE_CAPTURE_VIEW, NX_MODULES, PALETTES, THEME_STYLES, PEN_IDS, SIDE_CAL_VIEW, SIDE_TASKS_VIEW, SKETCH_VIEW, ST_SYMBOL_RULES, TASK_BUCKETS, TIMER_VIEW } = require('./constants.js');
const { nxAllFolders, nxAllNames, nxAllPropKeys, nxAllTags, nxHexToHsl, nxInkZoomEnd, nxInkZoomMove, nxInkZoomStart, nxPdfDestPage, nxPropValues, renderMd } = require('./lib/helpers.js');
const { NexusAgenda } = require('./lib/agenda.js');
const { NexusPlanner } = require('./views/plannerblock.js');
const { NexusVaultSync } = require('./lib/vaultsyncrun.js');
const { WebDavClient } = require('./lib/webdav.js');
const deviceSettings = require('./lib/devicesettings.js');
const secrets = require('./lib/secrets.js');
const { NexusKanban } = require('./lib/kanban.js');
const { NexusFolderNotes } = require('./lib/foldernotes.js');
const { NexusHomepageView } = require('./views/homepage.js');
const { NexusIcons } = require('./lib/icons.js');
const { NexusTagTools } = require('./lib/tagtools.js');
const { NexusInkTagModal } = require('./views/ink.js');
const { NexusCaptureHubView } = require('./views/capturehub.js');
const { NexusGalaxyView } = require('./views/galaxy.js');
const { NexusScratchView } = require('./views/scratch.js');
const { NexusSketchSurface, parseSketchSVG, ratioWH, PEN_TYPES } = require('./views/sketch.js');
const sketchObjects = require('./lib/sketchobjects.js');
const penGestures = require('./lib/sketchgestures.js');
const sketchExport = require('./lib/sketchexport.js');
const sketchSearch = require('./lib/sketchsearch.js');
const quicknote = require('./lib/quicknote.js');
const extcommand = require('./lib/extcommand.js');
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
    // One sketch as its own tab — see views/sketchpane.js and openSketchInSplit.
    this.registerView(SKETCH_VIEW, (leaf) => new NexusSketchPaneView(leaf, this));
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
    this.addCommand({ id: 'nexus-track-note-as-task', name: 'Track this note as a task',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (checking) return true;
        this.toggleNoteTask(file);
        return true;
      } });
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
    this.addCommand({ id: 'nexus-search-sketches', name: 'Search sketches', callback: () => this.openSketchSearch() });
    this.addCommand({ id: 'nexus-ocr-sketch', name: 'Read the handwriting in this sketch',
      callback: () => this.ocrActiveSketch() });
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

    // ── Tasks & Calendar (full-page view over the local calendars) ──
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
    // ── The same two as side panels (see views/sidebar.js) ──
    this.registerView(SIDE_CAL_VIEW, (leaf) => new NexusSideView(leaf, this, 'calendar'));
    this.registerView(SIDE_TASKS_VIEW, (leaf) => new NexusSideView(leaf, this, 'tasks'));
    this.addCommand({ id: 'nexus-open-calendar-sidebar', name: 'Open the calendar in the sidebar', callback: () => this.openSidePanel('calendar') });
    this.addCommand({ id: 'nexus-open-tasks-sidebar', name: 'Open the tasks in the sidebar', callback: () => this.openSidePanel('tasks') });
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

    this.addSettingTab(new NexusSettingsTab(this.app, this));
    console.log('[Nexus] Suite loaded · Banner module:', this.settings.banner.enabled);
  }

  onunload() {
    // Before anything detaches: the pin watchdog must not reopen what we close.
    this._unloading = true;
    window.clearTimeout(this._pinT);
    window.clearTimeout(this._homeEmptyTimer);
    ['nx-pin-home', 'nx-pin-cal', 'nx-pin-tasks'].forEach(c => document.body.removeClass(c));
    this.app.workspace.detachLeavesOfType(CAL_VIEW);
    this.app.workspace.detachLeavesOfType(CAL_PAGE_VIEW);
    this.app.workspace.detachLeavesOfType(TASKS_VIEW);
    this.app.workspace.detachLeavesOfType(HOME_VIEW);
    this.app.workspace.detachLeavesOfType(TIMER_VIEW);
    this.app.workspace.detachLeavesOfType(INK_VIEW);
    this.app.workspace.detachLeavesOfType(CAPTURE_VIEW);
    this.app.workspace.detachLeavesOfType(GALAXY_VIEW);
    this.app.workspace.detachLeavesOfType(SIDE_CAPTURE_VIEW);
    this.app.workspace.detachLeavesOfType(SCRATCH_VIEW);
    this.app.workspace.detachLeavesOfType(SIDE_CAL_VIEW);
    this.app.workspace.detachLeavesOfType(SIDE_TASKS_VIEW);
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

  /* ---- Settings ---- */
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // ensure deep defaults per module
    for (const k of Object.keys(DEFAULT_SETTINGS))
      this.settings[k] = Object.assign({}, DEFAULT_SETTINGS[k], (data && data[k]) || {});
    /* Migration: the sync connection, its schedule and the task accounts were
       vault-wide, so every device read the one the last sync happened to
       deliver. They move into this device's bag; the vault-wide keys are left
       untouched, because the OTHER device reads the same data.json and still
       has to migrate its own copy. */
    deviceSettings.migrateDeviceSettings(this.settings, this.deviceId());
    this.migrateScratchCards();
    // Migration: old image cards (homepage.images) → widget system
    const hp = this.settings.homepage;
    /* Migration: the startup toggle became a three-way choice. Read from the
       SAVED data, not from hp — the default has already been merged in by now,
       so hp.startup is never missing. */
    const savedHome = (data && data.homepage) || {};
    if (savedHome.startup === undefined && savedHome.openOnStartup !== undefined) {
      hp.startup = savedHome.openOnStartup === false ? 'off' : 'tab';
    }
    delete hp.openOnStartup;
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
    /* The default columns used to be German, and a default is written into
       data.json the first time anything saves — so changing the default alone
       would leave every vault that ever opened the settings on "In Arbeit".
       An untouched set is rewritten once; columns anybody picked are theirs and
       are never renamed. `bucketsTranslated` marks it done. */
    if (!this.settings.bucketsTranslated) {
      const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
      const kb = this.settings.kanban;
      if (kb && same(kb.buckets, ['Backlog', 'In Arbeit', 'Erledigt'])) {
        kb.buckets = DEFAULT_SETTINGS.kanban.buckets.slice();
      }
      const tk = (this.settings.tasksCalendar || {}).tasks;
      if (tk && same(tk.buckets, ['Backlog', 'In Arbeit', 'Wartet', 'Erledigt'])) {
        tk.buckets = TASK_BUCKETS.slice();
      }
      this.settings.bucketsTranslated = true;
    }
    /* The Board module became the folder source of the kanban board. Its one
       setting moves along, so a vault that had chosen a status property keeps
       it — the defaults are already merged in by now, so "untouched" is the
       default value, not a missing key. The board key itself goes: nothing
       reads it any more. */
    if (this.settings.board) {
      const kanban = this.settings.kanban;
      const chosen = this.settings.board.statusProperty;
      // Read from the SAVED data: kanban.statusProperty did not exist before
      // this change, so a value there can only be one the user set afterwards
      // — and only then does it outrank what the Board page held.
      const already = ((data && data.kanban) || {}).statusProperty;
      if (kanban && chosen && already === undefined) kanban.statusProperty = chosen;
      delete this.settings.board;
    }
    // Tasks & Calendar: backfill nested defaults (shallow per-key merge above
    // does not deep-merge saved partial objects).
    const tc = this.settings.tasksCalendar;
    if (tc) {
      /* The accounts themselves live in the device bag now — but the tasks
         module, the board and the settings page all reach for them under this
         name, and one array in one place is the point. NOT enumerable: saving
         it would write this device's list over the shared key, which is the
         collision the whole change is about. The value it was migrated from is
         parked under accountsBeforeDeviceStore, so a device that updates later
         still finds it. */
      const store = deviceSettings.deviceStore(this.settings, this.deviceId());
      if (!Array.isArray(store.taskAccounts)) store.taskAccounts = [];
      Object.defineProperty(tc, 'accounts', {
        get: () => deviceSettings.deviceStore(this.settings, this.deviceId()).taskAccounts,
        set: (v) => { deviceSettings.deviceStore(this.settings, this.deviceId()).taskAccounts = Array.isArray(v) ? v : []; },
        enumerable: false, configurable: true,
      });
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
  /* The dashboard's pad used to be called "quicknote" and shared that word with
     the module you speak into. The card is now "scratch"; a stored card still
     carrying the old type would simply not render, so it is renamed on load.
     Every profile is walked, not just this device's — data.json travels. */
  migrateScratchCards() {
    const home = this.settings.homepage;
    if (!home) return;
    const rename = (list) => {
      if (!Array.isArray(list)) return 0;
      let n = 0;
      for (const card of list) {
        if (!card || card.type !== 'quicknote') continue;
        card.type = 'scratch';
        if (card.title === 'Quicknote') card.title = 'Scratch';
        n++;
      }
      return n;
    };
    let moved = rename(home.widgets);
    for (const profile of Object.values(home.profiles || {})) moved += rename(profile && profile.widgets);
    if (moved) console.log('[Nexus] renamed ' + moved + ' quicknote card(s) to scratch');
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
     vault: the sync connection, its schedule, the task accounts. Stored in
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
  /* Pick a file from the system, name it, drop it into a banner group.
     Returns the created TFile (null when cancelled) — the caller decides what
     it is FOR: a note banner, or an image separator. */
  importBannerImage(noteFile) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      // A cancelled file dialog fires no event at all — resolve on the window
      // regaining focus instead, so the caller is never left hanging.
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      input.onchange = async () => {
        try {
          const f = input.files && input.files[0];
          if (!f) { finish(null); return; }
          const ext = ((f.name.split('.').pop() || 'png').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'png';
          const origName = f.name.replace(/\.[^.]+$/, '');
          const picked = await new NexusBannerImportModal(this, this.bannerFileName(origName, noteFile)).openAndGet();
          if (!picked) { finish(null); return; }
          const dir = await this.ensureBannerGroup(picked.group);
          const base = (picked.name.trim() || origName).replace(/[\\/:*?"<>|]/g, '_');
          const mk = (n) => (dir ? dir + '/' : '') + base + (n ? '-' + n : '') + '.' + ext;
          let dest = mk(0), i = 1;
          while (this.app.vault.getAbstractFileByPath(dest)) dest = mk(i++);
          finish(await this.app.vault.createBinary(dest, await f.arrayBuffer()));
        } catch (e) {
          new Notice(NX_MODULES.banner.name + ': import failed (' + e.message + ')');
          finish(null);
        }
      };
      input.click();
    });
  }
  async importBannerFromSystem(noteFile) {
    const img = await this.importBannerImage(noteFile);
    if (!img) return;
    await this.app.fileManager.processFrontMatter(noteFile, fm => {
      fm.banner = '[[' + this.app.metadataCache.fileToLinktext(img, noteFile.path) + ']]';
    });
    this.refreshBanner();
    new Notice('Banner set: ' + img.path);
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
  /* "168, 130, 255" (Callout Manager's storage form) → rgb(168, 130, 255).
     Anything that already reads as a colour — #hex, rgb(), a var() — is passed
     through untouched. */
  /* Which convention THIS Obsidian build uses for --callout-color.
     Older builds store a bare "r, g, b" triplet and consume it as
     `rgba(var(--callout-color), .1)`; current builds store a COLOUR and consume
     it via `color-mix(… var(--callout-color) …)`. Emitting the wrong form makes
     every rule that reads the variable drop silently, so the callout loses its
     fill. That is why one vault could look different on two devices without
     anything being out of sync: the devices were on different Obsidian
     versions. Read from Obsidian's OWN value, so it is right on any build. */
  _calloutTripletMode() {
    try {
      const cs = getComputedStyle(document.body);
      const v = (cs.getPropertyValue('--callout-quote') || cs.getPropertyValue('--callout-note') || '').trim();
      return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v);
    } catch (e) { return false; }
  }
  applyCallouts() {
    const triplet = this._calloutTripletMode();
    const calloutColor = (v) => {
      const t = String(v || '').trim();
      const isTriplet = /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(t);
      if (triplet) {
        if (isTriplet) return t;
        const m = t.match(/^#([0-9a-f]{6})$/i);
        if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).join(', ');
        const m3 = t.match(/^#([0-9a-f]{3})$/i);
        if (m3) return [0, 1, 2].map(i => parseInt(m3[1][i] + m3[1][i], 16)).join(', ');
        return t;
      }
      return isTriplet ? 'rgb(' + t + ')' : t;
    };
    if (!this._calloutStyle) this._calloutStyle = document.head.createEl('style', { attr: { id: 'nx-callouts' } });
    // One normalised, ALWAYS-a-colour handle for the theme to consume, whichever
    // convention this build speaks. Emitted even when the module is switched
    // off, because the theme's callout fill depends on it. The theme keeps
    // `var(--nx-callout-c, var(--callout-color))` so it also stands alone.
    const norm = `.callout{--nx-callout-c:${triplet ? 'rgb(var(--callout-color))' : 'var(--callout-color)'};}\n`;
    const s = this.settings.callouts;
    if (!s.enabled) { this._calloutStyle.textContent = norm; return; }
    const esc = (k) => (window.CSS && CSS.escape) ? CSS.escape(k) : k.replace(/"/g, '\\"');
    let css = '';
    for (const c of s.items) {
      const id = (c.id || '').toLowerCase().trim();
      if (!id) continue;
      const sel = `.callout[data-callout="${esc(id)}"]`;
      // --callout-color is a COLOUR, not a triplet: Obsidian defines its own as
      // `--callout-quote: #9e9e9e` / `var(--color-blue)` and consumes them as
      // `color-mix(in oklch, var(--callout-color) 10%, transparent)` and
      // `color: var(--callout-color)`. (It used to be a bare "r, g, b" triplet —
      // that is what the eth-p Callout Manager still stores and what we migrate
      // from, so the value is wrapped on the way out. Emitting the raw triplet
      // made every rule that consumes it silently drop: colour-less callouts.)
      const decl = [];
      if (c.color) decl.push(`--callout-color:${calloutColor(c.color)};`);
      if (c.icon) decl.push(`--callout-icon:${c.icon.startsWith('lucide-') ? c.icon : 'lucide-' + c.icon};`);
      if (decl.length) css += `${sel}{${decl.join('')}}\n`;
      if (c.colorLight) css += `.theme-light ${sel}{--callout-color:${calloutColor(c.colorLight)};}\n`;
      if (c.colorDark)  css += `.theme-dark ${sel}{--callout-color:${calloutColor(c.colorDark)};}\n`;
    }
    this._calloutStyle.textContent = norm + css;
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
  _watchForPropMenu(key, knownBefore, ttl) {
    this._stopPropMenuWatch();
    const known = knownBefore || new Set(document.body.querySelectorAll('.menu'));
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
    this._propTimer = window.setTimeout(() => this._stopPropMenuWatch(), ttl || 2200);
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

  /* ---- Homepage ----
     Opening it never costs a note. The old version handed the ACTIVE leaf to
     setViewState, which silently replaced whatever was open in it — on startup
     that ate the tab you left behind. So: a dashboard that is already open is
     brought forward (the pinned one included, since that is a leaf like any
     other), an empty tab is taken over because an empty tab is not a note, and
     anything else gets a tab of its own. */
  async openHomepage() {
    // Two things ask for the dashboard at the same 150 ms mark — the pin
    // watchdog and the empty-main-area watcher. Without one promise to share,
    // the second gets past the "is one open?" check while the first is still
    // awaiting setViewState, and the vault ends up with two dashboards.
    if (!this._homeOpening) {
      this._homeOpening = this._openHomepageLeaf().then(
        (leaf) => { this._homeOpening = null; return leaf; },
        (err) => { this._homeOpening = null; throw err; });
    }
    return this._homeOpening;
  }
  async _openHomepageLeaf() {
    const workspace = this.app.workspace;
    const open = workspace.getLeavesOfType(HOME_VIEW)[0];
    if (open) { workspace.revealLeaf(open); return open; }
    const current = workspace.getLeaf(false);
    const leaf = this.leafType(current) === 'empty' ? current : workspace.getLeaf(true);
    await leaf.setViewState({ type: HOME_VIEW, active: true });
    workspace.revealLeaf(leaf);
    return leaf;
  }
  leafType(leaf) { return (leaf && leaf.view && leaf.view.getViewType) ? leaf.view.getViewType() : ''; }

  /* What happens to the dashboard when Obsidian starts: nothing, its own tab,
     or a cleared main area followed by its own tab. */
  async runHomepageStartup() {
    const home = this.settings.homepage;
    const mode = home.startup || 'off';
    if (!home.enabled || mode === 'off') return;
    if (mode === 'closeAll') this.closeMainAreaTabs();
    await this.openHomepage();
  }
  /* Every tab in the main area. Sidebars are not root leaves, so they stay —
     and a pinned Nexus page is left alone too: guardPinnedTabs would put it
     back 150 ms later anyway, so closing it only buys a flicker. */
  closeMainAreaTabs() {
    const pinned = this.pinnableTabs().filter(p => this.isTabPinned(p.key) && p.on()).map(p => p.type);
    const doomed = [];
    this.app.workspace.iterateRootLeaves(leaf => {
      const type = this.leafType(leaf);
      if (pinned.indexOf(type) < 0) doomed.push({ leaf, type });
    });
    for (const entry of doomed) {
      try { entry.leaf.detach(); }
      catch (e) { console.error('[Nexus] a tab could not be closed ("' + entry.type + '"):', e); }
    }
  }
  /* The last tab was closed → bring the dashboard up instead of an empty pane.
     Obsidian leaves an 'empty' leaf behind rather than nothing, so emptiness is
     counted rather than asked for. Guarded against re-entry, because opening the
     dashboard fires layout-change again; skipped while unloading, so onunload's
     detach is not undone the moment it happens. */
  maybeOpenHomepageWhenEmpty() {
    if (this._unloading || this._homeEmptyBusy) return;
    const home = this.settings.homepage;
    if (!home.enabled || !home.openWhenEmpty) return;
    let occupied = 0;
    this.app.workspace.iterateRootLeaves(leaf => {
      const type = this.leafType(leaf);
      if (type && type !== 'empty') occupied++;
    });
    if (occupied) return;
    this._homeEmptyBusy = true;
    this._homeEmptyTimer = window.setTimeout(async () => {
      try { if (!this._unloading) await this.openHomepage(); }
      catch (e) { console.error('[Nexus] the dashboard could not be opened:', e); }
      finally { this._homeEmptyBusy = false; }
    }, 150);
  }

  /* Ask a connection whether it is there and whether it knows this device.
     Both kinds answer here, because to the person adding one they are the same
     idea — and because the answer has to be a sentence, not a status code. */
  async testConnection(kind, entry) {
    const conn = entry || {};
    if (kind === 'vaultsync') {
      const url = conn.url || this.deviceSetting('vaultSyncUrl', '');
      if (!url) throw new Error('fill in the URL first');
      const cred = this.getCredential('vaultsync');
      const client = new WebDavClient({ baseUrl: url,
        username: conn.username !== undefined ? conn.username : (cred.username || ''),
        password: conn.secret !== undefined ? conn.secret : (cred.secret || '') });
      return (await client.check()).message;
    }
    const secret = conn.secret !== undefined ? conn.secret : (this.getCredential(conn.id).secret || '');
    if (!conn.serverUrl || !secret) throw new Error('fill in the URL and the token first');
    const client = new VikunjaClient({ base: conn.serverUrl, token: secret });
    const projects = await client.listProjects();
    return projects.length + ' projects visible';
  }

  /* ---- Tasks & Calendar ----
     Credentials live in localStorage (device-local, NOT synced by Syncthing —
     same precedent as deviceId()). data.json holds only non-secret account
     config. Network sync runs on DESKTOP only (behind the fs-guard); the tablet
     renders from the vault cache Syncthing delivers. */
  credKey(id) { return 'nexus-suite-cred-' + id; }
  /* The secret is encrypted at rest where the OS offers a keyring, and stored
     as it was where it does not — see lib/secrets.js for what that is and is
     not worth. Reading tolerates both, so a store written before this, or on a
     phone, still opens. */
  getCredential(id) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(this.credKey(id)) || '{}') || {};
      return Object.assign({}, raw, { secret: secrets.decrypt(raw.secret) });
    } catch (e) { return {}; }
  }
  setCredential(id, obj) {
    try {
      const value = Object.assign({}, obj || {});
      if (value.secret) value.secret = secrets.encrypt(value.secret);
      window.localStorage.setItem(this.credKey(id), JSON.stringify(value));
    } catch (e) { /* private mode, or a full store */ }
  }
  /* Whether THIS device can encrypt — the settings page says so per device
     rather than showing one padlock for a vault used from three machines. */
  secretsEncrypted() { return secrets.available(); }

  refreshCalendarViews() {
    // The sidebar month over the daily notes draws weeks too — a week-start
    // change has to reach it, not just the full-page calendar.
    for (const leaf of this.app.workspace.getLeavesOfType(CAL_VIEW)) {
      const v = leaf.view; if (v && typeof v.render === 'function') v.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW)) {
      const v = leaf.view; if (v && typeof v.render === 'function') v.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(CAL_PAGE_VIEW)) {
      const v = leaf.view; if (v && typeof v.reload === 'function') v.reload();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(TASKS_VIEW)) {
      const v = leaf.view; if (v && typeof v.reload === 'function') v.reload();
    }
    this.refreshSidePanels();
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

  /* Calendar / tasks as a side panel — right dock, because that is where a
     companion to the note you're writing belongs. */
  async openSidePanel(kind) {
    const type = kind === 'tasks' ? SIDE_TASKS_VIEW : SIDE_CAL_VIEW;
    let leaf = this.app.workspace.getLeavesOfType(type)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
  refreshSidePanels() {
    [SIDE_CAL_VIEW, SIDE_TASKS_VIEW].forEach(t => this.app.workspace.getLeavesOfType(t)
      .forEach(l => { if (l.view && l.view.reload) l.view.reload(); }));
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
        // Accounts saved before CalDAV was dropped are still in data.json —
        // their URL is not a Vikunja one, so say so instead of failing on it.
        const name = acc.label || acc.serverUrl || acc.id;
        if (acc.kind && acc.kind !== 'vikunja') { lines.push(name + ': ' + acc.kind + ' accounts are no longer supported — remove it in settings'); continue; }
        const cred = this.getCredential(acc.id);
        if (!cred.secret) { lines.push(name + ': no credential on this device'); continue; }
        try {
          const client = new VikunjaClient({ base: acc.serverUrl, token: cred.secret });
          const { stats, conflicts } = await sync.syncVikunja(this, acc, client);
          lines.push(name + ': ' + stats.pulled + ' pulled · ' + stats.pushed + ' pushed · ' + stats.created + ' new · ' + conflicts.length + ' conflict(s)');
          if (conflicts.length) pending.push({ acc, client, conflicts });
        } catch (e) { lines.push(name + ': ERROR — ' + (e && e.message || e)); console.error('[Nexus] sync "' + name + '" failed:', e); }
      }
    } finally { this._syncing = false; }
    for (const p of pending) {
      if (s.conflictPolicy === 'ask') new NexusConflictModal(this, p.acc, p.client, p.conflicts, () => {}).open();
      else for (const rec of p.conflicts) { try { await sync.applyResolution(this, p.acc, p.client, rec, 'server'); } catch (e) {} }
    }
    this.refreshCalendarViews();   // cache lives under .obsidian/ → no vault event fires; refresh explicitly
    return { lines };
  }

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
      const { NexusSeparatorModal } = require('./modals/separator.js');
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

  /* ---- Quick Sketch ----
     A `quicksketch` code block renders an interactive vector pad. The drawing
     lives in a standalone .svg sidecar (see views/sketch.js) named after a
     short id; the block body just carries `id: <id>` so the note stays clean.
     The id is assigned lazily on the FIRST committed stroke — viewing a note
     with an empty pad never modifies it. */
  _sketchFolder() { return (this.settings.quicksketch.folder || 'Inbox/Quicksketch').replace(/\/$/, ''); }
  _sketchPath(id) { return this._sketchFolder() + '/' + id + '.svg'; }
  /* ── Finding a sketch again ────────────────────────────────────────────────
     Every sidecar is read once and cached against its mtime: a search that
     re-parsed a hundred SVGs on every keystroke would be unusable, and a cache
     without the mtime would go stale the first time anything was edited. */
  async sketchDocuments() {
    const folder = (this.settings.quicksketch.folder || 'Inbox/Quicksketch').replace(/\/+$/, '');
    const cache = (this._sketchDocs = this._sketchDocs || new Map());
    const files = this.app.vault.getFiles()
      .filter(f => f.extension === 'svg' && f.path.startsWith(folder + '/'));
    const docs = [];
    const seen = new Set();
    for (const file of files) {
      seen.add(file.path);
      const stamp = file.stat ? file.stat.mtime : 0;
      const hit = cache.get(file.path);
      if (hit && hit.stamp === stamp) { docs.push(hit.doc); continue; }
      try {
        const data = parseSketchSVG(await this.app.vault.read(file));
        if (!data) continue;
        const doc = sketchSearch.sketchDocument(file.path, data);
        cache.set(file.path, { stamp, doc });
        docs.push(doc);
      } catch (e) { /* an unreadable sidecar is skipped, not fatal to the search */ }
    }
    for (const key of Array.from(cache.keys())) if (!seen.has(key)) cache.delete(key);
    return docs;
  }
  /* `nexus-task: true` in any note puts it in the tasks view without moving it.
     The command says which way it went, because a frontmatter field appearing
     silently is not feedback. */
  async toggleNoteTask(file) {
    const tasks = require('./lib/tasks.js');
    try {
      const on = await tasks.toggleNoteTask(this, file);
      new Notice(on
        ? 'Nexus: "' + file.basename + '" is now tracked in your tasks.'
        : 'Nexus: "' + file.basename + '" is no longer tracked.');
    } catch (err) {
      new Notice('Nexus: could not change tracking — ' + (err && err.message ? err.message : 'unknown error'));
    }
  }
  /* ── QuickNote ─────────────────────────────────────────────────────────────
     The recording goes to a program the user installed; the text comes back and
     becomes a note. Same bargain as the handwriting reader: nothing is uploaded
     and nothing is bundled, at the cost of being desktop only. */
  async transcribeAudio(blob) {
    const cfg = this.settings.quicknote || {};
    if (!this.ocrAvailable()) throw new Error('the local recogniser needs a desktop shell — switch to the browser engine in the settings');
    const built = extcommand.buildCommand(cfg.command || '', '', '');
    if (built.error) throw new Error(built.error);
    const cp = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-speech-'));
    const inPath = path.join(dir, 'clip.webm');
    const outStem = path.join(dir, 'clip');
    const argv = extcommand.buildCommand(cfg.command || '', inPath, outStem);
    try {
      fs.writeFileSync(inPath, Buffer.from(await blob.arrayBuffer()));
      const stdout = await new Promise((resolve, reject) => {
        cp.execFile(argv.command, argv.args, { timeout: 300000, maxBuffer: 8 * 1024 * 1024 }, (err, out, stderr) => {
          // ENOENT is the common one and "spawn whisper-cli ENOENT" says nothing
          // to anybody: the program in the settings is simply not installed.
          if (err && err.code === 'ENOENT') {
            reject(new Error('“' + argv.command + '” is not installed on this machine — install it, or change the command in Settings → Chatter.'));
          } else if (err) {
            reject(new Error((argv.command + ' failed: ' + (stderr || err.message)).trim()));
          } else resolve(out);
        });
      });
      // Some recognisers write a file, others just print. Both are accepted so
      // the command line is not forced into one shape.
      let raw = '';
      for (const candidate of [outStem + '.txt', outStem]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { raw = fs.readFileSync(candidate, 'utf8'); break; }
      }
      if (!raw) raw = String(stdout || '');
      return quicknote.cleanTranscript(raw);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  }
  async writeQuickNote(lines, meta) {
    const cfg = this.settings.quicknote || {};
    const folder = (cfg.folder || 'Inbox/Quicknote').replace(/\/+$/, '');
    await this.ensureFolderPath(folder);
    const stamp = moment().format('YYYY-MM-DD HHmm');
    const title = quicknote.titleFrom(lines, 'Chatter');
    let path = quicknote.notePath(folder, title, '');
    if (this.app.vault.getAbstractFileByPath(path)) path = quicknote.notePath(folder, title, stamp);
    const body = quicknote.noteBody(lines, {
      recorded: moment().format('YYYY-MM-DDTHH:mm'),
      seconds: meta && meta.seconds, engine: meta && meta.engine, task: meta && meta.task,
    });
    const file = await this.app.vault.create(path, body);
    if (cfg.openAfter !== false) this.app.workspace.getLeaf(false).openFile(file);
    return path;
  }
  /* Create a folder and its parents. The sketch module has its own version for
     its own folder; this is the general one. */
  async ensureFolderPath(folder) {
    const adapter = this.app.vault.adapter;
    let at = '';
    for (const part of String(folder).split('/')) {
      if (!part) continue;
      at = at ? at + '/' + part : part;
      try { if (!(await adapter.exists(at))) await adapter.mkdir(at); } catch (e) {}
    }
  }

  async openSketchSearch() {
    const { NexusSketchSearchModal } = require('./modals/sketchsearch.js');
    new NexusSketchSearchModal(this, await this.sketchDocuments()).open();
  }

  /* ── Handwriting ───────────────────────────────────────────────────────────
     The image goes to a binary the user already has and the text comes back.
     Desktop only: there is no shell on a phone, and pretending otherwise would
     mean a button that silently does nothing there. */
  ocrAvailable() {
    try { return !!(require('child_process') && require('fs') && require('os') && require('path')); }
    catch (e) { return false; }
  }
  async runSketchOcr(surface) {
    return this.runOcrOnImage(await this._sketchToPng(surface, 2), 'png');
  }

  /* The recogniser does not care where the picture came from: a sketch rendered
     to a bitmap and a scan already on disk are the same job. Splitting it here
     is what let Ink Capture reuse the engine Quick Sketch already had, instead
     of growing a second one. */
  async runOcrOnImage(bytes, ext) {
    const cfg = this.settings.quicksketch.ocr || {};
    if (!this.ocrAvailable()) throw new Error('handwriting recognition needs a desktop shell — it cannot run here');
    const png = bytes;
    const cp = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ocr-'));
    const inPath = path.join(dir, 'page.' + (ext || 'png'));
    // Tesseract appends its own .txt; the template is handed the stem, and the
    // reader below accepts either spelling so other engines fit too.
    const outStem = path.join(dir, 'page');
    const built = sketchSearch.buildOcrCommand(cfg.command || '', inPath, outStem);
    if (built.error) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(built.error); }
    try {
      fs.writeFileSync(inPath, Buffer.from(png));
      await new Promise((resolve, reject) => {
        cp.execFile(built.command, built.args, { timeout: 120000 }, (err, stdout, stderr) => {
          if (err) reject(new Error((built.command + ' failed: ' + (stderr || err.message)).trim()));
          else resolve(stdout);
        });
      });
      let raw = '';
      for (const candidate of [outStem + '.txt', outStem]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { raw = fs.readFileSync(candidate, 'utf8'); break; }
      }
      if (!raw) throw new Error(built.command + ' produced no text file');
      return sketchSearch.cleanOcrText(raw);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  }
  /* Read a scan. The attachment is already a picture, so this is the same
     engine with a different source — except for a PDF, where only the cached
     page-1 render exists as an image and the rest of the document is out of
     reach without a renderer we do not ship. That limit is said out loud rather
     than silently reading one page and calling it done. */
  async ocrInkCapture(item) {
    const capture = require('./lib/capture.js');
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!file) throw new Error('the note is gone');
    // Every page, in order, into one section — a multi-page capture you can
    // only search the first page of is not searchable.
    const pages = (item.pages && item.pages.length) ? item.pages : [{ file: item.file, thumb: item.thumb }];
    const lines = [];
    let partial = false, read = 0;
    for (const page of pages) {
      const isPdf = /\.pdf$/i.test(page.file || '');
      if (isPdf) partial = true;
      const source = isPdf ? page.thumb : (page.file || page.thumb);
      if (!source) continue;
      const image = this.app.vault.getAbstractFileByPath(source);
      if (!image) continue;
      const bytes = await this.app.vault.readBinary(image);
      lines.push.apply(lines, await this.runOcrOnImage(bytes, (image.extension || 'png').toLowerCase()));
      read++;
    }
    if (!read) throw new Error('this capture has no image to read');
    const after = capture.withOcrSection(await this.app.vault.read(file), lines);
    if (after != null) await this.app.vault.modify(file, after);
    return { lines: lines.length, partial };
  }

  async ocrActiveSketch() {
    const surface = this._activeSketchSurface();
    if (!surface) { new Notice('Nexus: open a sketch first.'); return; }
    new Notice('Nexus: reading the handwriting…');
    try {
      const lines = await this.runSketchOcr(surface);
      surface.setOcr(lines);
      this._sketchDocs = null;   // the index is stale now
      new Notice(lines.length ? 'Nexus: read ' + lines.length + ' line(s) — the sketch is searchable now.'
                              : 'Nexus: nothing legible was found.');
    } catch (err) {
      new Notice('Nexus: ' + (err && err.message ? err.message : 'handwriting recognition failed.'));
    }
  }
  /* The surface the user is looking at: the full-size editor wins, then any
     live pad in the note. */
  _activeSketchSurface() {
    const fs = document.body.querySelector('.nx-sketch-fs .nx-sketch-pad');
    if (fs && fs._surface) return fs._surface;
    const live = this._sketchLive ? Object.values(this._sketchLive) : [];
    for (const surface of live) if (surface && document.contains(surface.host)) return surface;
    const pk = document.querySelector('.nx-pk-inline');
    if (pk && pk._surface) return pk._surface;
    return null;
  }

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

    // Writing the id back modifies the note, which makes Obsidian re-render this
    // block — while the user may already be drawing on the pad being replaced.
    // Whatever that outgoing surface holds beyond what reached the file is
    // carried over here; without it those strokes were simply gone.
    let carried = data ? data.strokes : [];
    const outgoing = state.id && this._sketchLive ? this._sketchLive[state.id] : null;
    if (outgoing && outgoing.strokes && outgoing.strokes.length > carried.length) carried = outgoing.strokes;

    const wrap = el.createDiv('nx-sketch');
    // A finger stroke that starts near an edge is a drawer swipe to the mobile
    // gesture recogniser. It skips any subtree marked like this (same lever the
    // canvas uses) — the touch guards further up can't reach it, it listens in
    // the capture phase and was registered long before any plugin.
    wrap.dataset.ignoreSwipe = 'true';
    const barWrap = wrap.createDiv('nx-sketch-bar-wrap');   // grid-rows wrapper → smooth collapse
    const bar = barWrap.createDiv('nx-sketch-bar');
    const pad = wrap.createDiv('nx-sketch-pad');            // height comes from the SVG (width:100%/height:auto), not CSS aspect-ratio

    const surface = new NexusSketchSurface(pad, {
      W, H, bg, paper, paperStyle, invertOnDark: s.invertOnDark !== false, ink: s.ink, penSizes: s.penSizes, pen: 'fountain',
      paperWidth: s.paperWidth,   // the cap also travels into the full-size editor, which reparents this very pad
      pageZoom: true,             // pinch magnifies the SHEET here too — the viewBox zoom it used
                                  // to do could go in but never out, which is not a zoom
      penConfig: (s.penConfig = s.penConfig || {}),   // live reference — pen menu edits apply on the next stroke
      shapeSnap: s.shapeSnap !== false,
      bgType, bgSize, bgOpacity, bgColor: s.bgColor, autoGrow,
      strokes: carried,
      objects: (outgoing && outgoing.objects && outgoing.objects.length) ? outgoing.objects : (data ? data.objects : null),
      sections: data ? data.sections : null,
      ocr: data ? data.ocr : null,
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
    /* Zoomed, the sheet is wider than the note column: the block scrolls
       sideways, and the pill is the way back to 100% without having to pinch
       exactly onto it. */
    const zoomPill = wrap.createDiv({ cls: 'nx-sk-zoompill', text: '100%' });
    zoomPill.onclick = (e) => { e.stopPropagation(); surface.setPageZoom(1); };
    surface.onZoom = (z) => {
      wrap.toggleClass('is-zoomed', Math.abs(z - 1) > 0.01);
      zoomPill.setText(Math.round(z * 100) + '%');
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
        onSplit: true, sketchId: () => state.id, notePath: ctx && ctx.sourcePath,
      });
    };
    buildInlineBar();
    // This pad is now the live one for that id — so the NEXT re-render hands
    // over from here instead of from a stale predecessor.
    if (state.id) (this._sketchLive = this._sketchLive || {})[state.id] = surface;
    const remembered = state.id && modes[state.id];
    const hasContent = !!(carried && carried.length);
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

  /* An image placed in a sketch is embedded as a data URI, so the .svg sidecar
     stays a standalone file — a sidecar pointing at a vault path stops being
     standalone the moment it is copied. That makes size a real cost, so the
     picture is downscaled before it goes in. */
  _pickImageFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });
  }
  async _sketchImageData(file, maxDim) {
    const max = maxDim || 1400;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    // Line art and anything with transparency stays PNG; a photo is far smaller
    // as JPEG, and in a note that difference is worth choosing per file.
    const mime = /png|gif|webp|svg/i.test(file.type || '') ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => cv.toBlob(res, mime, 0.82));
    if (!blob) throw new Error('could not encode ' + (file.name || 'the image'));
    const href = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(String(reader.result));
      reader.onerror = () => rej(new Error('could not read ' + (file.name || 'the image')));
      reader.readAsDataURL(blob);
    });
    return { href, w, h };
  }

  /* ── Export ────────────────────────────────────────────────────────────────
     Rasterising goes through the SAME string the sidecar is written as, so what
     is exported is what is stored — not a second rendering that can disagree
     with it. */
  async _rasterSketch(surface, scale) {
    const svg = surface.toSVGString();
    const width = Math.max(1, Math.round(surface.W * (scale || 2)));
    const height = Math.max(1, Math.round(surface.H * (scale || 2)));
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error('the drawing could not be rendered'));
        el.src = url;
      });
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      return { canvas: cv, ctx, width, height };
    } finally { URL.revokeObjectURL(url); }
  }
  async _sketchToPng(surface, scale) {
    const { canvas } = await this._rasterSketch(surface, scale);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('the image could not be encoded');
    return new Uint8Array(await blob.arrayBuffer());
  }
  async _sketchToPdf(surface, scale) {
    const { canvas, ctx, width, height } = await this._rasterSketch(surface, scale);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const packed = await sketchExport.deflate(sketchExport.rgbaToRgbOnWhite(rgba));
    if (packed) {
      return sketchExport.pdfDocument(packed, {
        width, height, filter: 'FlateDecode',
        pageWidth: surface.W, pageHeight: surface.H,
      });
    }
    /* No CompressionStream on this runtime: fall back to JPEG, which every PDF
       reader takes as-is. Lossy, and the caller says so. */
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
    if (!blob) throw new Error('the page could not be encoded');
    return sketchExport.pdfDocument(new Uint8Array(await blob.arrayBuffer()), {
      width, height, filter: 'DCTDecode',
      pageWidth: surface.W, pageHeight: surface.H,
    });
  }
  /* Write the export next to the other sketches and say where it went — a file
     that appears somewhere unnamed may as well not have been written. */
  async _exportSketch(surface, format, scale) {
    const folder = (this.settings.quicksketch.folder || 'Inbox/Quicksketch').replace(/\/+$/, '');
    await this.ensureSketchFolder();
    const stamp = moment().format('YYYY-MM-DD HHmm');
    const spec = sketchExport.EXPORT_FORMATS.find(f => f.id === format) || sketchExport.EXPORT_FORMATS[0];
    const name = sketchExport.exportFileName(surface.title, spec.ext, stamp);
    let path = folder + '/' + name;
    for (let n = 2; this.app.vault.getAbstractFileByPath(path) && n < 100; n++) {
      path = folder + '/' + sketchExport.exportFileName(surface.title, spec.ext, stamp + ' ' + n);
    }
    if (format === 'svg') await this.app.vault.create(path, surface.toSVGString());
    else {
      const bytes = format === 'pdf'
        ? await this._sketchToPdf(surface, scale)
        : await this._sketchToPng(surface, scale);
      await this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return path;
  }

  /* Build the sketch toolbar: a TOOL row, and under it the OPTIONS row of
     whatever tool is active — pen types + sizes + colours for the pen, sizes +
     colours for the highlighter, nothing at all for the eraser (that row hides
     rather than sit there empty).

     `bar.mode` only decides whether the options row is pinned open or opens on
     a tool tap and closes again on the first stroke. Both render the SAME row,
     so this is one code path and not two toolbars.

     Which buttons sit in the bar and which fall into the ⋯ menu comes from
     BAR_ITEMS filtered by the user's list (barConfig) — separately for the code
     block ('compact') and the full-size editor ('full'). The buttons that leave
     the sketch (save, full size, split) are not in that list: they are always
     in the bar, because a user cannot be allowed to hide their way out. */
  _buildSketchBar(bar, surface, s, opts) {
    opts = opts || {};
    const full = opts.mode === 'full';
    const plugin = this;
    const layout = this.barConfig(s);
    const inBar = full ? layout.full : layout.compact;

    /* The options row is a SIBLING of the bar, so every caller's own layout —
       including the code block's collapse wrapper — keeps working untouched.
       Rebuilds call bar.empty(), which cannot reach a sibling, so a stale row
       from the previous build has to go first or they stack up. */
    const stale = bar.nextElementSibling;
    if (stale && stale.hasClass && stale.hasClass('nx-sketch-subbar')) stale.remove();
    const sub = createDiv('nx-sketch-subbar');
    bar.insertAdjacentElement('afterend', sub);

    const iconBtn = (parent, icon, title, cb, cls) => {
      const b = parent.createDiv({ cls: 'nx-sk-btn' + (cls ? ' ' + cls : ''), attr: { 'aria-label': title } });
      setIcon(b, icon);
      if (cb) b.onclick = cb;
      return b;
    };
    const BG_ICON = { none: 'square', grid: 'layout-grid', graph: 'grid-3x3', lines: 'align-justify', dots: 'grip', cross: 'plus', isometric: 'triangle', isodots: 'grip' };

    // ── shared state referenced across groups ──
    let favWrap, colWrap;
    let subOpen = false;                 // reveal mode only — pinned ignores it
    let lastTool = null;                 // what a gesture switches back TO
    let gestureHeldTool = null;          // the tool a hold-gesture interrupted
    const toolBtns = {};
    const PEN_META = { fountain: ['Fountain', 'pen-tool'], ballpoint: ['Ballpoint', 'pen'], pencil: ['Pencil', 'pencil'], brush: ['Brush', 'brush'], calligraphy: ['Calligraphy', 'feather'], marker: ['Marker', 'highlighter'] };
    const DRAW_PENS = ['fountain', 'ballpoint', 'pencil', 'brush', 'calligraphy'];
    let drawPen = DRAW_PENS.includes(surface.pen) ? surface.pen : 'fountain';   // the drawing pen behind the "pen" tool

    /* Which BAR_ITEM the surface is currently in. Everything per-tool (colour,
       palette, the options row) keys off this one function, so there is a
       single answer to "which tool is this" instead of three. */
    const TOOL_OF = () => (surface.mode === 'erase' ? 'eraser'
      : surface.mode === 'select' ? 'select'
      : surface.mode === 'space' ? 'space'
      : surface.mode === 'insert' ? 'insert'
      : surface.pen === 'marker' ? 'marker' : 'pen');
    const TOOL_LABEL = { pen: 'Pen', marker: 'Highlighter', eraser: 'Eraser', select: 'Select', space: 'Spacing', insert: 'Insert' };
    // Neither of these puts ink on the page, so neither owns a colour.
    const DRAWS = (tool) => ['eraser', 'select', 'space', 'insert'].indexOf(tool) < 0;

    const persistSize = () => { s.penSizes[surface.pen] = surface.getSize(); plugin.saveSettings(); };
    /* Picking a colour or a width does not change the TOOL, so only the tool
       buttons need re-syncing — rebuilding the options row on every swatch tap
       would tear it out from under the finger that is tapping it. Leaving the
       eraser this way does change the tool, so that case still rebuilds. */
    const drawWithCurrent = () => {
      const before = TOOL_OF();
      surface.setMode('draw');
      if (TOOL_OF() === before) syncTools(); else syncAll();
    };

    /* ═══ palettes + colours, per tool ═══ */
    const ensurePalettes = () => {
      if (!Array.isArray(s.palettes) || !s.palettes.length) s.palettes = [{ name: 'Default', colors: (s.palette || ['#2f2f2f']).slice(0, 8) }];
      if (s.activePalette == null || s.activePalette >= s.palettes.length) s.activePalette = 0;
      s.palette = s.palettes[s.activePalette].colors;   // legacy alias — the GLOBAL active one, not the tool's
      return s.palettes;
    };
    /* A palette belongs to a tool: the highlighter wants washes where the pen
       wants ink. A tool that was never given one uses the globally active
       palette, so nothing changes for anyone who never picks. */
    const palIdx = (tool) => {
      ensurePalettes();
      const chosen = (s.toolPalettes || (s.toolPalettes = {}))[tool];
      return (chosen != null && chosen >= 0 && chosen < s.palettes.length) ? chosen : s.activePalette;
    };
    const activePal = () => s.palettes[palIdx(TOOL_OF())];
    const rememberColor = (col) => { (s.toolColors || (s.toolColors = {}))[TOOL_OF()] = col; plugin.saveSettings(); };
    /* Each tool keeps the ink it was last used with. A tool that has never been
       used starts at the head of its own palette — except the pen on a fresh
       vault, which starts at the "default ink" setting. */
    const applyToolColor = () => {
      const tool = TOOL_OF();
      const colors = (s.toolColors || (s.toolColors = {}));
      if (colors[tool] == null) colors[tool] = (tool === 'pen' && s.ink) ? s.ink : activePal().colors[0];
      surface.setColor(colors[tool]);
    };

    /* ═══ per-pen behaviour sheet (smoothing, pressure, …) ═══ */
    // The value lives IN the label's flex row — never floated — so it can't
    // overlap the rows below (that was the marker-menu overlap).
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
    const openPenSettings = (anchor, id) => {
      plugin._showPopover(anchor, (pop) => {
        pop.addClass('nx-sk-penpop');
        pop.createDiv({ cls: 'nx-sk-pop-title', text: PEN_META[id][0] });
        buildPenSettings(pop.createDiv('nx-sk-pensettings'), id);
      });
    };

    /* ═══ size favourites (dots sized to their width) ═══ */
    const dotPx = (px) => Math.max(2, Math.min(20, px));
    const SIZE_MIN = 0.5, SIZE_SPAN = 39.5;
    const sliderToPx = (t) => Math.round((SIZE_MIN + SIZE_SPAN * t * t) * 10) / 10;
    const pxToSlider = (v) => Math.round(Math.sqrt(Math.max(0, (v - SIZE_MIN) / SIZE_SPAN)) * 1000);
    /* Favourites belong to the ACTIVE PEN — a marker and a pencil have nothing
       useful to say about each other's widths. */
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

    /* ═══ palette switcher — picks the palette for the CURRENT tool ═══ */
    const paletteBuild = (pop, closePop) => {
      pop.addClass('nx-sk-palpop');
      const tool = TOOL_OF();
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Palette · ' + (TOOL_LABEL[tool] || 'Pen') });
      ensurePalettes();
      const chosen = palIdx(tool);
      s.palettes.forEach((pal, idx) => {
        const row = pop.createDiv('nx-sk-palrow');
        row.toggleClass('is-active', idx === chosen);
        if (idx === chosen) {
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
            /* Tools pointing past the deleted entry would silently jump to a
               different palette — shift them down, and let the ones that used
               it fall back to the global default. */
            const map = s.toolPalettes || (s.toolPalettes = {});
            Object.keys(map).forEach(t => {
              if (map[t] === idx) delete map[t];
              else if (map[t] > idx) map[t] -= 1;
            });
            plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
          };
        }
        row.onclick = () => {
          if (idx === chosen) return;
          (s.toolPalettes || (s.toolPalettes = {}))[tool] = idx;
          /* The ink this tool was using may not exist in the new palette —
             land on its first swatch instead of on a colour nothing shows. */
          const colors = s.palettes[idx].colors;
          const cur = (s.toolColors || {})[tool];
          if (!cur || !colors.some(c => String(c).toLowerCase() === String(cur).toLowerCase())) {
            (s.toolColors || (s.toolColors = {}))[tool] = colors[0];
            surface.setColor(colors[0]);
          }
          plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
        };
      });
      const newBtn = pop.createEl('button', { cls: 'nx-sk-savecol', text: '＋ New palette (copy of current)' });
      newBtn.onclick = () => {
        const pal = activePal();
        s.palettes.push({ name: 'Palette ' + (s.palettes.length + 1), colors: pal.colors.slice(0, 8) });
        (s.toolPalettes || (s.toolPalettes = {}))[tool] = s.palettes.length - 1;
        plugin.saveSettings(); renderSwatches(); if (closePop) closePop();
      };
    };

    /* ═══ colour strip ═══ */
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
          // Tap the ALREADY-selected swatch again → adjust that palette colour
          // (hue/saturation/opacity), live.
          if (sw.hasClass('is-active')) {
            plugin._showPopover(sw, (pop) => {
              pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Adjust colour' });
              plugin._buildColorPicker(pop, pal.colors[idx],
                (out) => { pal.colors[idx] = out; sw.style.setProperty('--c', out); surface.setColor(out); rememberColor(out); drawWithCurrent(); },
                () => plugin.saveSettings());
            });
            return;
          }
          // In select mode the swatch also repaints what is selected — that is
          // what a colour means when ink is already on the page.
          if (TOOL_OF() === 'select') {
            surface.setColor(col);
            surface.setSelectionColor(col);
          } else {
            surface.setColor(col); rememberColor(col); drawWithCurrent();
          }
          colWrap.querySelectorAll('.nx-sk-color').forEach(x => x.removeClass('is-active')); sw.addClass('is-active');
        };
        sw.oncontextmenu = (e) => { e.preventDefault(); if (pal.colors.length > 1) { pal.colors = pal.colors.filter(c => c !== col); plugin.saveSettings(); renderSwatches(); } };
      });
      // The "+" is an ADD affordance — with a full palette there is nothing to
      // add, so it goes away instead of promising a slot and then refusing.
      if (pal.colors.length < 8) {
        const cust = colWrap.createDiv('nx-sk-color nx-sk-color-custom');
        setIcon(cust, 'plus');
        cust.setAttribute('aria-label', 'Custom colour');
        plugin._sketchPopover(cust, (pop, closePop) => {
          pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Custom colour' });
          let v = /^(#|rgb)/i.test(surface.color || '') ? surface.color : '#2f2f2f';
          plugin._buildColorPicker(pop, v, (out) => { v = out; surface.setColor(out); rememberColor(out); drawWithCurrent(); });
          const save = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol', text: 'Save to palette' });
          save.onclick = () => {
            const p = activePal();
            if (p.colors.length >= 8) { new Notice('Nexus: palette is full (max 8 colours).'); return; }
            if (!p.colors.map(c => c.toLowerCase()).includes(v.toLowerCase())) { p.colors.push(v); plugin.saveSettings(); }
            renderSwatches(); closePop();
          };
        });
      }
      // The swatch book sits at the end of the strip, where the colours are —
      // picking a palette IS a colour decision, not a menu item.
      const switcher = colWrap.createDiv('nx-sk-color nx-sk-color-custom');
      setIcon(switcher, 'palette');
      switcher.setAttribute('aria-label', 'Palette for this tool');
      plugin._sketchPopover(switcher, paletteBuild);
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

    /* ═══ export ═══ */
    const exportBuild = (pop, closePop) => {
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Export' });
      let scale = 2;
      const scaleRow = pop.createDiv('nx-sk-bgtypes');
      [['1', 1], ['2×', 2], ['3×', 3], ['4×', 4]].forEach(([label, value]) => {
        const b = scaleRow.createDiv({ cls: 'nx-sk-bgtype', text: label });
        b.toggleClass('is-active', value === scale);
        b.onclick = () => {
          scale = value;
          scaleRow.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active'));
          b.addClass('is-active');
        };
      });
      pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'Scale applies to PNG and PDF. SVG is vector and ignores it.' });
      sketchExport.EXPORT_FORMATS.forEach(spec => {
        const row = pop.createDiv('nx-sk-menuitem');
        const ic = row.createDiv('nx-sk-menuitem-ic');
        setIcon(ic, spec.id === 'svg' ? 'file-code' : spec.id === 'png' ? 'image' : 'file-text');
        row.createDiv({ cls: 'nx-sk-menuitem-lbl', text: spec.label + ' — ' + spec.note });
        row.onclick = async () => {
          closePop();
          try {
            surface.flush();   // export what is on the page, not what last reached disk
            const path = await plugin._exportSketch(surface, spec.id, scale);
            new Notice('Nexus: exported to ' + path);
          } catch (err) {
            new Notice('Nexus: export failed — ' + (err && err.message ? err.message : 'unknown error'));
          }
        };
      });
    };

    /* ═══ outline ═══ */
    /* A drawing has no headings to read, so the outline is made by hand: a mark
       at a y with a name on it. That is enough to jump around a page metres
       long, which is the whole problem an endless sheet creates. */
    const outlineBuild = (pop, closePop) => {
      pop.addClass('nx-sk-menu');
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Outline' });
      if (!surface.sections.length) {
        pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'No sections yet. Add one where you are and it becomes a place you can jump back to.' });
      }
      surface.sections.forEach((sec, i) => {
        const row = pop.createDiv('nx-sk-menuitem');
        const ic = row.createDiv('nx-sk-menuitem-ic');
        setIcon(ic, 'corner-down-right');
        row.createDiv({ cls: 'nx-sk-menuitem-lbl', text: sec.title || 'Section' });
        const del = row.createDiv({ cls: 'nx-sk-menuitem-x', attr: { 'aria-label': 'Remove section' } });
        setIcon(del, 'x');
        del.onclick = (ev) => { ev.stopPropagation(); surface.removeSection(i); closePop(); };
        row.onclick = () => {
          if (!surface.scrollToY(sec.y)) new Notice('Nexus: nothing to scroll here — open the sketch full size.');
          closePop();
        };
      });
      pop.createDiv('nx-sk-menu-sep');
      const add = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol', text: '＋ Section here' });
      add.onclick = async () => {
        const { NexusNameModal } = require('./modals/misc.js');
        const at = surface.viewCenter();
        closePop();
        const title = await new NexusNameModal(plugin.app, 'Name this section', '').openAndGet();
        if (title == null) return;
        surface.addSection(at.y, title.trim() || 'Section');
      };
    };

    /* ═══ ruler ═══ */
    const rulerBuild = (pop, anchor) => {
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Ruler' });
      const onRow = pop.createDiv('nx-sk-bgtypes');
      const toggle = onRow.createDiv({ cls: 'nx-sk-bgtype nx-sk-bgtoggle', text: 'Straight edge' });
      const paint = () => {
        toggle.toggleClass('is-active', surface.ruler.on);
        if (anchor) anchor.toggleClass('is-active', surface.ruler.on);
      };
      toggle.onclick = () => { surface.setRuler(!surface.ruler.on, surface.ruler.angle); paint(); };
      pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Angle' });
      const angles = pop.createDiv('nx-sk-bgtypes');
      RULER_ANGLES.forEach(a => {
        const b = angles.createDiv({ cls: 'nx-sk-bgtype', text: a.label });
        const current = surface.ruler.angle == null ? '' : String(surface.ruler.angle);
        b.toggleClass('is-active', current === a.id);
        b.onclick = () => {
          // Picking an angle arms the ruler: nobody chooses 45° to leave it off.
          surface.setRuler(true, a.id === '' ? null : a.id);
          angles.querySelectorAll('.nx-sk-bgtype').forEach(x => x.removeClass('is-active'));
          b.addClass('is-active');
          paint();
        };
      });
      pop.createDiv({ cls: 'nx-sk-confirm-msg', text: 'Free follows the direction each stroke starts in.' });
      paint();
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

    /* Every movable action, by id. The bar and the ⋯ menu both read this, so a
       button does the same thing wherever the user put it. */
    const ACTIONS = {
      undo:  { icon: 'undo-2', label: 'Undo', run: () => surface.undo() },
      redo:  { icon: 'redo-2', label: 'Redo', run: () => surface.redo() },
      background: {
        icon: () => BG_ICON[surface.bgType] || 'layout-grid', label: 'Background',
        active: () => surface.bgType !== 'none',
        popup: (anchor) => (pop) => bgBuild(pop, anchor),
      },
      // Slate notes grow endlessly on their own — the toggle would be a lie.
      grow:  { icon: 'chevrons-down', label: 'Auto-extend downward', skip: () => !!opts.slate,
               active: () => surface.autoGrow, run: () => toggleGrow() },
      clear: { icon: 'trash-2', label: 'Clear', popup: () => clearBuild },
      /* A straight edge is a constraint on the pen, not a mode of its own: it
         stays on while you keep drawing with whatever pen you had. */
      outline: { icon: 'list-tree', label: 'Outline', popup: () => outlineBuild },
      export: { icon: 'download', label: 'Export', popup: () => exportBuild },
      ruler: {
        icon: 'ruler', label: 'Ruler',
        active: () => surface.ruler.on,
        popup: (anchor) => (pop) => rulerBuild(pop, anchor),
      },
    };

    /* ═══ the options row ═══ */
    /* Pinned: the row is simply there. Reveal: a tool tap opens it and the
       first stroke closes it, so the canvas is whole while actually drawing. */
    const applyOpen = () => {
      sub.toggleClass('is-open', !sub.hasClass('is-empty') && (layout.mode === 'pinned' || subOpen));
    };
    const renderSub = () => {
      sub.empty();
      surface.onSelect = null;   // a rebuilt row must not be driven by the old one
      const tool = TOOL_OF();
      // The eraser has nothing to configure, so its row would be an empty strip
      // stealing canvas. It collapses instead.
      if (tool === 'eraser') { sub.addClass('is-empty'); applyOpen(); return; }
      sub.removeClass('is-empty');
      if (tool === 'select') { buildSelectRow(sub); applyOpen(); return; }
      if (tool === 'space') { buildSpaceRow(sub); applyOpen(); return; }
      if (tool === 'insert') { buildInsertRow(sub); applyOpen(); return; }
      if (tool === 'pen') {
        const row = sub.createDiv('nx-sk-grp nx-sk-subpens');
        DRAW_PENS.forEach(id => {
          const chip = row.createDiv({ cls: 'nx-sk-subpen', attr: { 'aria-label': PEN_META[id][0] + ' (tap again: settings)' } });
          setIcon(chip, PEN_META[id][1]);
          chip.toggleClass('is-active', surface.pen === id);
          chip.onclick = () => {
            if (surface.pen === id) { openPenSettings(chip, id); return; }
            drawPen = id;
            surface.setPen(id); surface.setMode('draw');
            applyToolColor();
            syncAll();
          };
        });
        sub.createDiv('nx-sk-sep');
      } else {
        const cfgBtn = iconBtn(sub, 'sliders-horizontal', 'Highlighter settings', null);
        cfgBtn.onclick = () => openPenSettings(cfgBtn, 'marker');
        sub.createDiv('nx-sk-sep');
      }
      buildSizes(sub);
      sub.createDiv('nx-sk-sep');
      buildColors(sub);
      applyOpen();
    };

    /* Select: the marquee shape, what can be done to what is caught in it, and
       the colours (which recolour the selection instead of only arming the pen). */
    const buildSelectRow = (parent) => {
      const shapes = parent.createDiv('nx-sk-grp nx-sk-subpens');
      SELECT_SHAPES.forEach(sh => {
        const chip = shapes.createDiv({ cls: 'nx-sk-subpen', attr: { 'aria-label': sh.label } });
        setIcon(chip, sh.icon);
        chip.toggleClass('is-active', surface.selectShape === sh.id);
        chip.onclick = () => {
          surface.setSelectShape(sh.id);
          shapes.querySelectorAll('.nx-sk-subpen').forEach(x => x.removeClass('is-active'));
          chip.addClass('is-active');
        };
      });
      parent.createDiv('nx-sk-sep');
      const dup = iconBtn(parent, 'copy', 'Duplicate', () => surface.duplicateSelection());
      const del = iconBtn(parent, 'trash-2', 'Delete selection', () => surface.deleteSelection());
      parent.createDiv('nx-sk-sep');
      buildColors(parent);
      const note = parent.createSpan({ cls: 'nx-sk-subnote' });
      /* The two buttons only mean something with something selected, and the
         count is the only feedback that the lasso caught what was intended. */
      const syncCount = () => {
        const n = surface.selection.length;
        dup.toggleClass('is-disabled', !n);
        del.toggleClass('is-disabled', !n);
        note.setText(n ? n + ' selected' : 'Draw around something');
      };
      surface.onSelect = syncCount;
      syncCount();
    };

    /* Insert: everything that is put ON the page rather than drawn on it.
       One tool instead of three, because an image, a sticker and a note are the
       same decision — "put a thing here" — and three bar buttons for it would
       crowd out the ones you reach for constantly. */
    const buildInsertRow = (parent) => {
      const imgBtn = iconBtn(parent, 'image-plus', 'Insert an image', null);
      imgBtn.onclick = async () => {
        const file = await plugin._pickImageFile();
        if (!file) return;
        try {
          const img = await plugin._sketchImageData(file);
          const at = surface.viewCenter();
          const box = sketchObjects.placeObject(at.x, at.y, img.w, img.h, surface.W * 0.7);
          surface.addObject(Object.assign({ kind: 'image', href: img.href }, box));
          setTool('select');
        } catch (err) {
          new Notice('Nexus: ' + (err && err.message ? err.message : 'could not insert that image.'));
        }
      };
      const noteBtn = iconBtn(parent, 'sticky-note', 'Sticky note', null);
      plugin._sketchPopover(noteBtn, (pop, closePop) => {
        pop.createDiv({ cls: 'nx-sk-pop-title', text: 'Sticky note' });
        const area = pop.createEl('textarea', { cls: 'nx-sk-notetext' });
        area.rows = 4;
        area.placeholder = 'What goes on the note';
        let colorId = sketchObjects.NOTE_COLORS[0].id;
        const row = pop.createDiv('nx-sk-notecolors');
        sketchObjects.NOTE_COLORS.forEach(c => {
          const chip = row.createDiv({ cls: 'nx-sk-notecolor', attr: { 'aria-label': c.label } });
          chip.style.setProperty('--c', c.fill);
          chip.toggleClass('is-active', c.id === colorId);
          chip.onclick = () => {
            colorId = c.id;
            row.querySelectorAll('.nx-sk-notecolor').forEach(x => x.removeClass('is-active'));
            chip.addClass('is-active');
          };
        });
        const add = pop.createEl('button', { cls: 'mod-cta nx-sk-savecol', text: 'Place note' });
        add.onclick = () => {
          const at = surface.viewCenter();
          surface.addObject({ kind: 'note', x: Math.round(at.x - 130), y: Math.round(at.y - 90), w: 260, h: 180, color: colorId, text: area.value });
          closePop();
          setTool('select');
        };
        window.setTimeout(() => area.focus(), 0);
      });
      parent.createDiv('nx-sk-sep');
      const stickers = parent.createDiv('nx-sk-grp nx-sk-subpens');
      sketchObjects.STICKERS.forEach(item => {
        const chip = stickers.createDiv({ cls: 'nx-sk-subpen', attr: { 'aria-label': item.label } });
        // The catalogue is drawn, not shipped as files — so the chip renders the
        // very same path the page will get.
        chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
          + ' stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="' + item.d + '"/></svg>';
        chip.onclick = () => {
          const at = surface.viewCenter();
          surface.addObject({ kind: 'sticker', id: item.id, x: Math.round(at.x - 45), y: Math.round(at.y - 45), w: 90, h: 90, color: surface.color });
          setTool('select');
        };
      });
    };

    /* Spacing has no options to set — only an instruction, because the gesture
       is not guessable from a bar icon. */
    const buildSpaceRow = (parent) => {
      parent.createSpan({ cls: 'nx-sk-subnote', text: 'Drag a line down to open blank paper, up to close it again. Everything below the line moves with it.' });
    };

    const setTool = (id) => {
      const from = TOOL_OF();
      if (from !== id) lastTool = from;
      if (id === 'eraser') surface.setMode('erase');
      else if (id === 'select') surface.setMode('select');
      else if (id === 'space') surface.setMode('space');
      else if (id === 'insert') surface.setMode('insert');
      else {
        surface.setPen(id === 'marker' ? 'marker' : drawPen);
        surface.setMode('draw');
        applyToolColor();   // after setPen — the colour belongs to the NEW tool
      }
      syncAll();
    };
    const syncTools = () => {
      const tool = TOOL_OF();
      Object.keys(toolBtns).forEach(id => toolBtns[id].toggleClass('is-active', id === tool));
    };
    const syncAll = () => { syncTools(); renderSub(); };

    /* ═══ compose: tools · spacer · actions · ⋯ · the ways out ═══ */
    const tools = bar.createDiv('nx-sk-grp nx-sk-grp-tools');
    inBar.filter(id => (BAR_ITEMS.find(i => i.id === id) || {}).kind === 'tool').forEach(id => {
      const item = BAR_ITEMS.find(i => i.id === id);
      const icon = id === 'pen' ? PEN_META[drawPen][1] : item.icon;
      const b = iconBtn(tools, icon, item.label, null);
      toolBtns[id] = b;
      b.onclick = () => {
        // Reveal mode: tapping the tool you are already using toggles its row.
        if (layout.mode === 'reveal') subOpen = (TOOL_OF() === id) ? !subOpen : true;
        setTool(id);
      };
    });

    bar.createDiv('nx-sk-spacer');
    const right = bar.createDiv('nx-sk-grp nx-sk-grp-actions');
    const barActions = inBar.filter(id => ACTIONS[id] && !(ACTIONS[id].skip && ACTIONS[id].skip()));
    barActions.forEach(id => {
      const act = ACTIONS[id];
      const b = iconBtn(right, typeof act.icon === 'function' ? act.icon() : act.icon, act.label, null);
      if (act.active) b.toggleClass('is-active', act.active());
      if (act.popup) plugin._sketchPopover(b, act.popup(b));
      else b.onclick = () => { act.run(); if (act.active) b.toggleClass('is-active', act.active()); };
    });

    /* Whatever the user left out of the bar. No leftovers → no ⋯ button, rather
       than a menu that opens on nothing. */
    const overflow = BAR_ITEMS
      .map(i => i.id)
      .filter(id => !inBar.includes(id))
      .filter(id => !(ACTIONS[id] && ACTIONS[id].skip && ACTIONS[id].skip()));
    if (overflow.length) {
      if (barActions.length) right.createDiv('nx-sk-sep');
      const moreBtn = iconBtn(right, 'more-horizontal', 'More tools', null);
      plugin._sketchPopover(moreBtn, (pop, closePop) => {
        pop.addClass('nx-sk-menu');
        overflow.forEach(id => {
          const item = BAR_ITEMS.find(i => i.id === id);
          const act = ACTIONS[id];
          const row = pop.createDiv('nx-sk-menuitem');
          const ic = row.createDiv('nx-sk-menuitem-ic');
          setIcon(ic, act ? (typeof act.icon === 'function' ? act.icon() : act.icon) : (id === 'pen' ? PEN_META[drawPen][1] : item.icon));
          row.createDiv({ cls: 'nx-sk-menuitem-lbl', text: item.label });
          if (!act) {
            row.toggleClass('is-active', TOOL_OF() === id);
            row.onclick = () => { closePop(); if (layout.mode === 'reveal') subOpen = true; setTool(id); };
            return;
          }
          if (act.active) row.toggleClass('is-active', act.active());
          if (act.popup) row.onclick = () => { closePop(); plugin._showPopover(moreBtn, act.popup(null)); };
          else row.onclick = () => { act.run(); if (act.active) row.toggleClass('is-active', act.active()); };
        });
      });
    }

    // The ways OUT of the sketch — never movable, never hidden.
    if (opts.onSplit || opts.onFullscreen || opts.onCollapse || opts.onDone) right.createDiv('nx-sk-sep');
    if (!full && opts.onFullscreen) {
      const fsBtn = iconBtn(right, 'maximize-2', 'Full-size editor', () => opts.onFullscreen(), 'nx-sk-fs');
      /* Press and hold (or right-click) the same button to put the sketch in a
         split instead. Only offered where there is a sketch to open — a pad
         that was never drawn on has no sidecar yet. */
      if (opts.onSplit) plugin._attachSplitMenu(fsBtn, opts);
    } else if (opts.onSplit) {
      const splitBtn = iconBtn(right, 'columns-2', 'Open beside the note', null, 'nx-sk-split');
      plugin._attachSplitMenu(splitBtn, opts, true);
    }
    if (opts.onCollapse) iconBtn(right, 'minimize-2', 'Close full-size editor', () => opts.onCollapse(), 'nx-sk-done');
    if (opts.onDone) iconBtn(right, 'check', 'Save & close', () => opts.onDone(), 'nx-sk-done');

    /* ═══ pen gestures ═══ */
    /* The surface reports which gesture happened; what it MEANS lives here,
       because everything a gesture can do is a toolbar action. A hold action
       remembers the tool it interrupted and puts it back on release. */
    surface.setPenMap(penGestures.resolveMap(s.penProfile, s.penMap));
    surface.onGesture = (action, phase) => {
      const current = TOOL_OF();
      if (action === 'eraseHold') {
        if (phase === 'start') {
          if (current === 'eraser') return false;
          gestureHeldTool = current;
          setTool('eraser');
        } else if (gestureHeldTool) {
          setTool(gestureHeldTool);
          gestureHeldTool = null;
        }
        return true;
      }
      if (phase === 'end') return false;   // everything else fires once, on press
      if (action === 'eraseToggle') { setTool(current === 'eraser' ? lastTool || 'pen' : 'eraser'); return true; }
      if (action === 'select') { setTool(current === 'select' ? lastTool || 'pen' : 'select'); return true; }
      if (action === 'lastTool') { setTool(lastTool || 'pen'); return true; }
      if (action === 'undo') { surface.undo(); return true; }
      if (action === 'redo') { surface.redo(); return true; }
      if (action === 'ruler') {
        surface.setRuler(!surface.ruler.on, surface.ruler.angle);
        syncAll();
        return true;
      }
      if (action === 'nextColor') {
        const colors = activePal().colors;
        if (!colors.length) return false;
        const at = colors.findIndex(c => String(c).toLowerCase() === String(surface.color).toLowerCase());
        const next = colors[(at + 1) % colors.length];
        surface.setColor(next);
        rememberColor(next);
        renderSwatches();
        return true;
      }
      return false;
    };

    /* Reveal mode closes the row on the first stroke. The listener hangs off the
       pad itself (not the document) so it dies with the pad; a rebuild would
       otherwise stack a second one on the same element. */
    const pad = surface.host;
    if (pad) {
      if (pad._nxSubClose) { pad.removeEventListener('pointerdown', pad._nxSubClose, true); pad._nxSubClose = null; }
      if (layout.mode === 'reveal') {
        pad._nxSubClose = () => { if (subOpen) { subOpen = false; applyOpen(); } };
        pad.addEventListener('pointerdown', pad._nxSubClose, true);
      }
    }

    if (DRAWS(TOOL_OF())) applyToolColor();
    syncAll();
  }

  /* Long-press / right-click on the full-size button → open the sketch beside
     the note. Long press, because a plain click already means "full size" and
     the tablet has no second mouse button. */
  _attachSplitMenu(btn, opts, clickOpens) {
    const open = (side) => {
      const id = opts.sketchId && opts.sketchId();
      if (!id) { new Notice('Draw something first — the sketch is saved on the first stroke.'); return; }
      this.openSketchInSplit(id, side, opts.notePath || '');
    };
    const menu = (evt) => {
      const m = new Menu();
      m.addItem(i => i.setTitle('Open to the left').setIcon('panel-left').onClick(() => open('left')));
      m.addItem(i => i.setTitle('Open to the right').setIcon('panel-right').onClick(() => open('right')));
      m.addItem(i => i.setTitle('Open in a new tab').setIcon('file-plus').onClick(() => open('tab')));
      if (evt && evt.clientX != null) m.showAtPosition({ x: evt.clientX, y: evt.clientY });
      else { const r = btn.getBoundingClientRect(); m.showAtPosition({ x: r.left, y: r.bottom }); }
    };
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e); });
    if (clickOpens) btn.onclick = (e) => { e.stopPropagation(); menu(e); };
    let holdT = null, held = false;
    const start = (e) => {
      held = false;
      window.clearTimeout(holdT);
      holdT = window.setTimeout(() => { held = true; menu(e); }, 500);
    };
    const cancel = () => window.clearTimeout(holdT);
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('pointercancel', cancel);
    // Swallow the click that follows a completed hold, so it doesn't ALSO open
    // the full-size editor behind the menu.
    btn.addEventListener('click', (e) => { if (held) { e.preventDefault(); e.stopPropagation(); held = false; } }, true);
  }

  /* side: 'left' | 'right' | 'tab' */
  async openSketchInSplit(id, side, notePath) {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(SKETCH_VIEW).find(l => l.view && l.view.id === id);
    if (existing) { ws.revealLeaf(existing); return; }
    let leaf;
    if (side === 'tab') leaf = ws.getLeaf('tab');
    else {
      const anchor = ws.getMostRecentLeaf() || ws.getLeaf(false);
      leaf = ws.createLeafBySplit(anchor, 'vertical', side === 'left');
    }
    await leaf.setViewState({ type: SKETCH_VIEW, active: true, state: { id, notePath: notePath || '' } });
    ws.revealLeaf(leaf);
  }

  /* Full-size editor: re-parent the SAME surface into a full-window overlay
     with its own roomy toolbar. The engine only knows its host element, so
     moving the pad carries every stroke, undo step and the low-latency live
     canvas across intact — no second canvas, no state to sync. Closing moves
     the pad back inline and rebuilds the compact bar to reflect any changes. */
  _openSketchFullscreen(surface, pad, wrap, s, rebuildInlineBar) {
    if (document.body.querySelector('.nx-sketch-fs')) return;   // one editor at a time
    const wasLocked = surface.locked, wasGrow = surface.autoGrow, wasZoom = surface.pageZoom;
    surface.setLocked(false);                                   // full-size editor always draws
    surface.autoGrow = true;                                    // endless downward while writing
    surface.pageZoom = true;                                    // pinch magnifies the sheet (out stops at 1× = normal)
    const overlay = document.body.createDiv('nx-sketch-fs');
    overlay.dataset.ignoreSwipe = 'true';   // full-size pad: same reason as the inline one
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

    // Zoom read-out: only visible above 1×, and tapping it goes straight back to
    // the normal state — the gesture is discoverable, the way out is obvious.
    const zoomPill = overlay.createDiv({ cls: 'nx-sk-zoompill', text: '100%' });
    zoomPill.onclick = () => surface.setPageZoom(1);
    surface.onZoom = (z) => {
      overlay.toggleClass('is-zoomed', z > 1.01);
      zoomPill.setText(Math.round(z * 100) + '%');
    };

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      stage.removeEventListener('scroll', onScroll);
      surface.setPageZoom(1);                                   // back to normal before the pad returns inline
      surface.onZoom = null;
      surface.pageZoom = wasZoom;
      surface.autoGrow = wasGrow;
      surface.setHeight(0);                                     // trim empty bottom back to content (clamps up to content min)
      wrap.appendChild(pad);                                    // …and back inline
      overlay.remove();
      surface.setLocked(wasLocked);
      if (surface.strokes.length) surface.persist();            // save trimmed height (+strokes already auto-saved); skip empty→no premature id
      else surface.flush();                                     // …but never drop a pending write on the way out
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
        (this._sketchLive = this._sketchLive || {})[state.id] = surface;  // …and hand the strokes over to the pad that replaces this one
        await this.saveSketch(state.id, surface.toSVGString());
        state.bound = await this._writeSketchId(ctx, el, state.id);
        state.writing = false;
      } else {
        await this.saveSketch(state.id, surface.toSVGString());
      }
      // The note may not have learned the id yet: getSectionInfo() comes up
      // empty often enough (mobile, and right after a re-render), and the old
      // code simply returned there. The sidecar existed, the block never got
      // `id:` — so the next reload rendered an empty pad and the drawing looked
      // like it had detached itself from the note. Keep retrying on every later
      // commit until it sticks, and say so if it never does.
      if (state.id && !state.bound) {
        state.bound = await this._writeSketchId(ctx, el, state.id);
        if (!state.bound) {
          state.bindTries = (state.bindTries || 0) + 1;
          if (state.bindTries === 3) new Notice('Nexus: this drawing is saved as ' + state.id + '.svg but could not be linked into the note yet.');
        }
      }
    } catch (e) { console.error('Nexus: sketch save failed', e); new Notice('Nexus: could not save sketch.'); }
  }

  /* Index of the ONE `quicksketch` block in `lines` that carries no id, or -1.
     Deliberately refuses to guess when a note holds several id-less pads —
     writing the id into the wrong block would be worse than not writing it. */
  _findIdlessSketchBlock(lines) {
    const fence = /^\s*(?:`{3,}|~{3,})\s*quicksketch\s*$/i;
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!fence.test(lines[i])) continue;
      let hasId = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*(?:`{3,}|~{3,})/.test(lines[j])) break;
        if (/^\s*id\s*:/i.test(lines[j])) { hasId = true; break; }
      }
      if (hasId) continue;
      if (found >= 0) return -1;   // ambiguous → leave the note alone
      found = i;
    }
    return found;
  }

  /* Insert `id: <id>` as the first body line of the code block, so the note
     re-renders bound to the just-written sidecar. Idempotent: bails if the
     block already has an id (guards the reading + live-preview double render). */
  async _writeSketchId(ctx, el, id) {
    const file = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    if (!(file instanceof TFile)) return false;
    const fence = /^\s*(?:`{3,}|~{3,})\s*quicksketch\s*$/i;
    let done = false;
    const apply = (content) => {
      const lines = content.split('\n');
      // Preferred: the exact block Obsidian says it is rendering — but only if
      // the line it points at really is our fence (a stale section info would
      // otherwise splice an `id:` into unrelated text).
      const info = ctx.getSectionInfo(el);
      let start = (info && fence.test(lines[info.lineStart] || '')) ? info.lineStart : this._findIdlessSketchBlock(lines);
      if (start < 0) return content;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\s*(?:`{3,}|~{3,})/.test(lines[i])) break;
        if (/^\s*id\s*:/i.test(lines[i])) { done = true; return content; }   // already assigned
      }
      lines.splice(start + 1, 0, 'id: ' + id);
      done = true;
      return lines.join('\n');
    };
    try {
      if (this.app.vault.process) await this.app.vault.process(file, apply);
      else { const c = await this.app.vault.read(file); const n = apply(c); if (n !== c) await this.app.vault.modify(file, n); }
    } catch (e) { console.error('Nexus: could not write the sketch id back', e); return false; }
    return done;
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
    const sk = this.settings.quicksketch;
    view.contentEl.toggleClass('nx-pk-hide-fm', isPk && !!sk.hideFrontmatter);
    /* Immersive is a body class because the chrome it hides lives outside this
       view. It is cleared whenever a slate note is not the one on screen. */
    document.body.toggleClass('nx-sk-immersive', isPk && !!sk.immersive);
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
      ink: s.ink, penSizes: s.penSizes, pen: 'fountain', paperWidth: s.paperWidth,
      penConfig: (s.penConfig = s.penConfig || {}),
      shapeSnap: s.shapeSnap !== false,
      bgType: (data && data.bgType) || 'grid',
      bgSize: (data && data.bgSize) || s.bgSize,
      bgOpacity: (data && data.bgOpacity != null) ? data.bgOpacity : s.bgOpacity,
      bgColor: s.bgColor,
      autoGrow: true, fixedViewport: true,   // no viewBox PAN — the note scroller scrolls
      // …but pinch still zooms the sheet. fixedViewport only rules out panning
      // the viewBox; without this the zoom gesture was never entered at all and
      // a slate note could not be zoomed by any means.
      pageZoom: true,
      strokes: data ? data.strokes : [],
      objects: data ? data.objects : [],
      sections: data ? data.sections : [],
      ocr: data ? data.ocr : [],
      onCommit: () => { this.saveSketch(id, surface.toSVGString()); },
    });
    host._surface = surface;
    delete host.dataset.mounting;
    surface.setLocked(false);
    // In a slate note the paper picker writes the choice back to `sketch-bg` so
    // it stays the note's canonical override across reloads.
    this._buildSketchBar(bar, surface, s, { mode: 'full', slate: true,
      // A slate note's drawing can go into a split too — the note's text and
      // its paper side by side.
      onSplit: true, sketchId: () => id, notePath: file.path,
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
     native taggable .md files, just surfaced in the hub (see
     lib/capture.js · isInkCapture). */
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
  /* The ribbon and the old command still say "ink gallery" and still work —
     they land on the hub's Ink tab. An already-open hub under EITHER id is
     reused, so the button never opens a second copy of the same thing. */
  /* One galaxy, reused: the layout takes a moment to settle, so a second one
     would be a second wait for the same picture. */
  async openGalaxy() {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(GALAXY_VIEW)[0];
    if (open) { ws.revealLeaf(open); return open; }
    const leaf = ws.getLeaf(true);
    await leaf.setViewState({ type: GALAXY_VIEW, active: true });
    ws.revealLeaf(leaf);
    return leaf;
  }

  /* One right-dock opener for every panel we register, so a new one is a line
     rather than another copy of the same six. */
  async openInDock(type) {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(type)[0];
    if (open) { ws.revealLeaf(open); return open; }
    const leaf = ws.getRightLeaf(false);
    if (!leaf) return null;
    await leaf.setViewState({ type, active: true });
    ws.revealLeaf(leaf);
    return leaf;
  }

  /* A setting changed under an open galaxy has to reach it — the layout is
     cached, so the view has to be told rather than noticing. */
  refreshGalaxy() {
    for (const leaf of this.app.workspace.getLeavesOfType(GALAXY_VIEW)) {
      const view = leaf.view;
      if (view && typeof view.reload === 'function') view.reload();
    }
  }

  activateInkGallery() { return this.openCaptureHub('ink'); }
  async openCaptureHub(tab) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(CAPTURE_VIEW)[0] || ws.getLeavesOfType(INK_VIEW)[0];
    if (!leaf) {
      leaf = ws.getLeaf(false);
      await leaf.setViewState({ type: CAPTURE_VIEW, active: true });
    }
    if (tab && leaf.view && leaf.view.hub) await leaf.view.hub.setTab(tab);
    ws.revealLeaf(leaf);
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
        if (!thumbPath) return;
        fr['ink-thumb'] = thumbPath;   // heals a capture whose thumb failed at capture time, too
        // ink-thumb IS page one's thumb, so on a multi-page capture the healed
        // path has to reach the page list too or the two quietly disagree.
        const inkpages = require('./lib/inkpages.js');
        const pages = inkpages.readPages(fr);
        if (pages.length > 1) { pages[0].thumb = thumbPath; inkpages.writePages(fr, pages); }
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

  /* The timer panel is an ordinary panel now: you open it, you close it, and it
     stays where you put it. It used to open itself whenever a timer started and
     call detachLeavesOfType the moment none was running — a panel that appears
     and vanishes on its own is not a panel, and it also meant a panel you had
     deliberately opened was torn away on the next leaf change. All that is left
     of that machinery is the repaint. */
  _syncTimerSidebar() {
    for (const leaf of this.app.workspace.getLeavesOfType(TIMER_VIEW)) {
      const view = leaf.view;
      if (view && typeof view.render === 'function') view.render();
    }
  }
  async openTimerSidebar() {
    const open = this.app.workspace.getLeavesOfType(TIMER_VIEW)[0];
    if (open) { this.app.workspace.revealLeaf(open); return open; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return null;
    await leaf.setViewState({ type: TIMER_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /* The panel keeps its own timers rather than mirroring the dashboard's: a
     dashboard card is part of a layout you arranged, a panel timer is the one
     you reach for while working, and tying them together meant the panel could
     only ever show what the dashboard already showed. Per device, because which
     timers you want at hand is not a thing to sync. */
  timerPanelList() {
    const list = this.deviceSetting('timerPanel', null);
    return Array.isArray(list) ? list : [];
  }
  async setTimerPanelList(list) {
    await this.setDeviceSetting('timerPanel', Array.isArray(list) ? list : []);
    this._syncTimerSidebar();
  }
  async addPanelTimer(minutes) {
    const list = this.timerPanelList().slice();
    list.push({ uid: 'panel-' + Date.now().toString(36), minutes: minutes || 5, caption: '' });
    await this.setTimerPanelList(list);
  }
  async removePanelTimer(uid) {
    await this.setTimerPanelList(this.timerPanelList().filter(t => t.uid !== uid));
    delete (this._timers || {})[uid];
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
    // "Dark" and "Light" were two entries for one neutral scheme (0.20.0) —
    // they are now the single "Minimal" palette, which follows Obsidian's own
    // light/dark mode. Fold the old ids over instead of leaving those vaults on
    // a palette that no longer exists.
    if (t.palette === 'dark' || t.palette === 'light') { t.palette = 'minimal'; this.saveSettings(); }

    /* The STYLE is the shape of the interface — one body class, and the theme
       plus the plugin's own CSS build a different app around it. Set before the
       palette so a style switch never renders half-tinted. */
    const style = THEME_STYLES[t.style] ? t.style : 'mirobo';
    Object.keys(THEME_STYLES).forEach(k => document.body.classList.toggle(THEME_STYLES[k].cls, k === style));

    let pel = document.getElementById('nx-palette-style');
    if (t.palette && t.palette !== 'dynamic' && PALETTES[t.palette]) {
      if (!pel) { pel = document.createElement('style'); pel.id = 'nx-palette-style'; document.head.appendChild(pel); }
      const p = PALETTES[t.palette];
      // A palette is either a flat map of --wl-* slots, or {slots, dark, light}
      // when it also has to pin the derived surfaces (the neutral ones do —
      // see PALETTES). `body.theme-*` outranks the theme's own `.theme-*`.
      const slots = p.slots || p;
      const vars = (obj) => Object.entries(obj).map(([k, v]) => k + ': ' + v + ';').join(' ');
      /* Obsidian derives its OWN native controls from --accent-h/-s/-l, which come
         from the accent picker in Appearance and default to hsl(258, 88%, 66%) —
         a blue-violet. 41 of its rules read var(--color-accent), and another 24
         read those raw components, so setting the colour alone still leaves two
         dozen native surfaces on Obsidian's blue while the theme goes coral.
         That is why menus and native elements were the things that looked wrong.
         The palette knows its accent as a hex, so it can hand over the three
         numbers exactly. */
      const accent = nxHexToHsl(slots.color3 || slots.color4 || '');
      const css = ['body.theme-dark, body.theme-light { '
        + Object.entries(slots).map(([k, v]) => '--wl-' + k + ': ' + v + ';').join(' ')
        + (accent ? ' --accent-h: ' + accent.h + '; --accent-s: ' + accent.s + '%; --accent-l: ' + accent.l + '%;' : '')
        + ' }'];
      if (p.dark) css.push('body.theme-dark { ' + vars(p.dark) + ' }');
      if (p.light) css.push('body.theme-light { ' + vars(p.light) + ' }');
      pel.textContent = css.join('\n');
    } else {
      /* The dynamic palette is written by the wallust snippet rather than here,
         so there are no slots to read from — but Obsidian's accent still has to
         be told about it, or every native control stays blue-violet while the
         rest of the app follows the wallpaper. Blank our own rule first, then
         read --wl-color3 back off the body: that is the live value, whatever
         set it. */
      if (pel) pel.textContent = '';
      const accent = nxHexToHsl(getComputedStyle(document.body).getPropertyValue('--wl-color3'));
      if (accent) {
        if (!pel) { pel = document.createElement('style'); pel.id = 'nx-palette-style'; document.head.appendChild(pel); }
        pel.textContent = 'body.theme-dark, body.theme-light { --accent-h: ' + accent.h
          + '; --accent-s: ' + accent.s + '%; --accent-l: ' + accent.l + '%; }';
      } else if (pel) { pel.remove(); }
    }

    /* Flat "70s color-block" surfaces (theme.css section 20) — only for the
       palettes that ship dedicated surface colours. Currently just "nexus". */
    const NX_BLOCKED = new Set(['nexus']);
    document.body.classList.toggle('nx-blocked', NX_BLOCKED.has(t.palette));

    const b = document.body;
    const setv = (k, v) => { if (v == null || v === '') b.style.removeProperty(k); else b.style.setProperty(k, v + 'px'); };
    // Card gap and corner radius describe the mirobo cards. In "almost nothing"
    // there are none, and an inline value from an earlier session would beat the
    // style's own tokens (inline > class) and put the gaps back.
    setv('--nx-gap', style === 'plain' ? null : t.gap);
    setv('--nx-radius', style === 'plain' ? null : t.radius);
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
    this.applyHiddenFolders();
  }

  /* Obsidian's own answer for where attachments go. It can be a plain folder,
     a path, "/" for the vault root, or "./" plus a name for a folder beside
     each note — the last two cannot be hidden as one entry in the tree, so they
     come back empty and the user names the folder themselves. */
  defaultAttachmentFolder() {
    const raw = (this.app.vault.getConfig && this.app.vault.getConfig('attachmentFolderPath')) || '';
    const path = String(raw).trim();
    if (!path || path === '/' || path.startsWith('./')) return '';
    return path.replace(/^\/+|\/+$/g, '');
  }

  /* Hiding is a stylesheet, not a class on the body: the rule has to name the
     folder, and the folder is a setting. One <style> element, rewritten in
     place, so the rule and the setting can never disagree. */
  applyHiddenFolders() {
    const s = this.settings.explorer || {};
    const id = 'nx-explorer-style';
    document.getElementById(id)?.remove();
    if (!s.enabled || !s.hideAttachments) return;
    const folder = (s.attachmentFolder || this.defaultAttachmentFolder()).replace(/^\/+|\/+$/g, '');
    if (!folder) return;
    // A vault path may hold quotes and backslashes; CSS.escape is for
    // identifiers, so the value is escaped as the string it is.
    const value = folder.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const el = document.createElement('style');
    el.id = id;
    el.textContent =
      '.nav-files-container .nav-folder:has(> .nav-folder-title[data-path="' + value + '"])' +
      ' { display: none; }';
    document.head.appendChild(el);
  }

  /* ---- Ribbon visibility (hover / always / hidden) ----
     Sets a body class AND injects the CSS rule itself (via <style>), so both
     ALWAYS come from the same call — independent of a theme/styles.css reload.
     Targets exactly .workspace-ribbon.mod-left (confirmed via devtools). */
  /* Handwritten note font: a factor of the app's own text size, published as a
     px value. It cannot be a calc() in the stylesheet — --font-text-size is
     exactly the variable being overridden, and a custom property defined in
     terms of itself is invalid at computed-value time. */
  /* The app's own text size, published so the note-font styles can compute
     from it (a custom property cannot be defined in terms of itself, which is
     why this detour through JS exists at all). The per-font factor lives in
     CSS — see styles/06-note-decor.css. */
  applyHandFont() {
    let base = 0;
    try { base = parseFloat(this.app.vault.getConfig('baseFontSize')); } catch (e) {}
    if (!base) base = parseFloat(getComputedStyle(document.body).getPropertyValue('--font-text-size')) || 16;
    const b = document.body;
    b.style.setProperty('--nx-base-size', base + 'px');
    b.style.setProperty('--nx-hand-scale', String(Number((this.settings.banner || {}).handScale) || 1.54));
  }

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

  /* ---- Pinned tabs (dashboard · calendar · tasks) ----
     A pinned page sits at the tab bar as its bare icon and stays there: Obsidian's
     own pin flag keeps the next opened file from replacing it, CSS takes away the
     close button (see 01-core.css), and the watchdog below reopens it if something
     detaches it anyway — Ctrl+W, "Close others", a workspace switch. Toggled from
     each page's tab menu (onPaneMenu) or in Settings → Dashboard. */
  pinnableTabs() {
    return [
      { key: 'home',     type: HOME_VIEW,     cls: 'nx-pin-home',  label: NX_MODULES.homepage.name,
        on: () => this.settings.homepage.enabled,      open: () => this.openHomepage() },
      { key: 'calendar', type: CAL_PAGE_VIEW, cls: 'nx-pin-cal',   label: NX_MODULES.tasksCalendar.name,
        on: () => this.settings.tasksCalendar.enabled, open: () => this.openCalendarPage() },
      { key: 'tasks',    type: TASKS_VIEW,    cls: 'nx-pin-tasks', label: 'Tasks',
        on: () => this.settings.tasksCalendar.enabled, open: () => this.openTasksPage() },
    ];
  }
  isTabPinned(key) { return !!(this.settings.pinnedTabs || {})[key]; }
  async setTabPinned(key, on) {
    this.settings.pinnedTabs = Object.assign({}, this.settings.pinnedTabs, { [key]: !!on });
    await this.saveSettings();
    this.applyPinnedTabs();
    if (on) { const e = this.pinnableTabs().find(p => p.key === key); if (e) e.open(); }
  }
  applyPinnedTabs() {
    this.pinnableTabs().forEach(p => {
      const on = this.isTabPinned(p.key) && p.on();
      document.body.classList.toggle(p.cls, on);
      this.app.workspace.getLeavesOfType(p.type).forEach(leaf => {
        try { if (leaf.setPinned) leaf.setPinned(on); } catch (e) {}
      });
    });
  }
  /* Closed anyway? Bring it back once the layout has settled. Debounced, because
     one close fires several layout events, and skipped while unloading — the
     detachLeavesOfType in onunload must not be undone. */
  guardPinnedTabs() {
    if (this._unloading) return;
    window.clearTimeout(this._pinT);
    this._pinT = window.setTimeout(() => {
      if (this._unloading) return;
      this.applyPinnedTabs();
      this.pinnableTabs().forEach(p => {
        if (!this.isTabPinned(p.key) || !p.on()) return;
        if (this.app.workspace.getLeavesOfType(p.type).length) return;
        try { p.open(); } catch (e) {}
      });
    }, 150);
  }
};
