'use strict';

/* ============================================================================
 *  NEXUS SUITE · Constants & data tables
 *  Extensions, view ids, defaults, weather codes, card defs, palettes, typography rules.
 * ========================================================================== */

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

const INK_EXT = IMG_EXT.concat(['pdf']);   // Ink Capture also accepts PDF exports (Saber/Butterfly notebooks)

const INK_DOWNSCALE_EXT = ['png', 'jpg', 'jpeg', 'webp'];   // safe canvas.toBlob formats (no animated gif, no bmp/avif quirks)

const INK_MAX_DIM = 2000;   // px, longest edge — a "scan" never needs to be bigger than this

/* NB: Quick Edit (QE_DIR / externalEdit) was parked on 2026-07-27 —
   see .ideas/quickedit/ for the full feature and how to bring it back. */

const CAL_VIEW = 'nx-calendar';

const CAL_PAGE_VIEW = 'nx-calendar-page';   // full-page month/week/day calendar (sidebar CAL_VIEW stays)

const TASKS_VIEW = 'nx-tasks';              // project/task board (later milestones)

const HOME_VIEW = 'nx-homepage';

const SKETCH_VIEW = 'nx-sketch-pane';   // one sketch as its own tab (split next to the note)

/* The calendar/tasks cards as side panels (see views/sidebar.js) */
const SIDE_CAL_VIEW = 'nx-side-calendar';
const SIDE_TASKS_VIEW = 'nx-side-tasks';

const TIMER_VIEW = 'nx-timers';   // running timers move here when the dashboard is left

/* The capture hub (scans, sketches, spoken notes). INK_VIEW is the gallery it
   grew out of and stays registered against the same view as an alias, so a
   workspace saved before the hub existed still opens — on the Ink tab. */
const CAPTURE_VIEW = 'nx-captures';
const GALAXY_VIEW = 'nx-galaxy';
const SCRATCH_VIEW = 'nx-scratch';
const SIDE_CAPTURE_VIEW = 'nx-captures-side';
const INK_VIEW = 'nx-ink-gallery';

/* Columns of the task board when nothing else says otherwise. Also the
   fallback at every read site: loadSettings only merges one level deep, so a
   vault that already has `tasksCalendar.tasks` never sees a new nested key. */
const TASK_BUCKETS = ['Backlog', 'In progress', 'Waiting', 'Done'];

const DEFAULT_SETTINGS = {
  banner:     { enabled: true,  height: 250, fade: true, folder: 'attachments/banners', behindTabs: true,
                nameTemplate: '{{name}}', defaultGroup: '', collapsed: {}, bgStrength: 4.5,
                /* image separator — the last shape used, so the next one starts there */
                sepHeight: 26, sepPosition: 50, sepFade: false, sepRound: true,
                /* Handwritten note font as a factor of the app's font size. 1.54 is
                   measured, not guessed: Grape Nuts' x-height is 0.35em against a
                   sans' 0.54em, so 0.54/0.35 puts both at the same READ size. */
                handScale: 1.54 },
  hider:      { enabled: false, tooltips: false, scrollbars: false, status: false,
                titlebar: false, vaultname: false, tabbar: false, instructions: false,
                ribbon: false, explorerButtons: false },
  columns:    { enabled: true,  gap: '1.5rem', delimiter: '===' },
  /* `startup` replaced the openOnStartup toggle: 'off' | 'tab' (never replaces
     an open note) | 'closeAll' (clear the main area first). */
  homepage:   { enabled: false, name: '', hero: '', widgets: [], layout: {}, stats: [{ kind: 'total' }, { kind: 'streak' }], ribbon: true,
                startup: 'tab', openWhenEmpty: false,
                perDevice: false, profiles: {}, profileNames: {} },
  /* fields = which parts of a note the search looks at; the weights that rank
     them live in modals/search.js (FIELDS). */
  search:     { enabled: true, fields: { title: true, tags: true, headings: true, props: true, text: true } },
  typography: { enabled: true,  dashes: true, ellipsis: true, quotes: true, arrows: true, symbols: true },
  calendar:   { enabled: true,  ribbon: true },
  tasksCalendar: { enabled: false, ribbon: true, dataLocation: 'plugin', dataFolder: '_nexus',
    defaultView: 'month', weekStart: 'locale',
    syncOnStartup: true, syncIntervalMin: 15, conflictPolicy: 'server',   // 'server' | 'ask'
    // accounts moved into the per-device store (devices[id].taskAccounts) —
    // every device signs itself in. The name still works as a live alias, see
    // loadSettings.

    localCalendars: [],  // {id,name,color}
    hiddenCalendars: [], // per-calendar visibility toggle (calKey strings that are HIDDEN)
    /* Where a month's planner note lives. The calendar month view reads and
       writes the ```nexus-planner``` block in this note, so the block and the
       calendar are two views of one file — see lib/planner.js. */
    planner: { folder: 'Planner', pattern: 'YYYY-MM' },
    tasks: { projectsFolder: 'Tasks/Projects', itemsFolder: 'Tasks/Items', providerDefault: 'local', buckets: TASK_BUCKETS.slice() } },
  propertyHider: { enabled: true, hidden: [], reveal: false },
  callouts:   { enabled: true, migrated: false, items: [] },
  workspaces: { enabled: true, selectMode: 'release' },
  /* NB: tasksCalendar.dataLocation ('plugin' | 'vault') decides where the
     calendar cache + local calendars live — see calstore.dataDir(). */
  /* The galaxy: the vault's links laid out in three dimensions and drawn on an
     ordinary canvas. `drift` is the slow idle turn — the thing that makes it
     feel alive rather than parked — and it is the first setting anyone will
     want off, so it is a switch and not a slider. */
  galaxy:     { enabled: true, ribbon: true, drift: true, linkDistance: 60, showOrphans: true },
  explorer:   { enabled: true,  folderBg: true, intensity: 22,
                hideAttachments: false, attachmentFolder: '' },
  /* Folder notes — defaults mirror the folder-notes plugin's own so an
     existing vault of "{{folder_name}}" notes keeps working unchanged. */
  folderNotes: { enabled: true, noteName: '{{folder_name}}', fileType: 'md', storage: 'inside',
    openTrigger: 'click',        // click | ctrl | alt | off
    openInNewTab: false, focusExistingTab: false, collapseOnClick: false,
    hideInExplorer: true, underline: true, bold: false, italic: false, openFromPath: true,
    autoCreate: false, templatePath: '',
    syncRename: true, syncDelete: false, confirmDelete: true, confirmRename: true,
    excludeFolders: [], supportedTypes: ['md', 'canvas', 'base'] },
  icons:      { enabled: true, map: {} },
  /* Kanban: the standalone ```nexus-kanban``` boards, both sources — the cards
     inside the block and the notes of a folder — plus ```nexus-graph```. The
     task board on the tasks page has no switch of its own: it is a way of
     looking at the tasks module and lives and dies with it. */
  kanban:     { enabled: true, buckets: ['Backlog', 'In progress', 'Done'],
                notesFolder: '', boardsFolder: '', compact: false, statusProperty: 'status' },
  /* The paper planner: a month on one screen with ONE line per day. Not the
     tasks module — that answers what is due, this answers what a month is for. */
  planner:    { enabled: true },
  /* Vault sync over WebDAV. Credentials are NOT here — they live in
     localStorage per device (plugin.getCredential), because data.json is a file
     in the vault and the vault is the thing being synced. */
  /* Chatter: a note you speak. Sister of Quick Sketch — catch the thought,
     The stored key stays `quicknote`: it is a name inside a file people already
     have, and a display name buys everything renaming it would. The dashboard's
     scratch card is the one that HAD to be renamed — it shared this word while
     having nothing to do with speech.
     decide about it later. `local` runs a program you installed and nothing
     leaves the machine; `browser` needs no install and works on a phone, but
     most builds send the audio to the browser vendor. */
  quicknote:  { enabled: true, folder: 'Inbox/Quicknote', engine: 'local',
    command: 'whisper-cli -f {in} -otxt -of {out} -l auto',
    language: 'en-US', asTask: false, openAfter: true },
  /* url, deviceName, onStart and intervalMin are NOT here: they describe one
     machine and live in the per-device store (see lib/devicesettings.js).
     What is left is shared policy — the same answer on every device. */
  vaultSync:  { enabled: false,
    config: true,           // carry .obsidian too, minus the device-specific files
    backup: true, keepBackups: 30,
    conflict: 'keepBoth',   // keepBoth | newer | local | remote
    shared: false,          // announce this device, and say who else is in the vault
    exclude: [] },
  tagTools:   { enabled: true },
  inkCapture: { enabled: true, ribbon: true, tagOnCapture: true,
    /* Only "paper" is fixed — that's the in-app camera capture. Every other
       source is whatever app the user exports from; they name it themselves. */
    sources: [{ id: 'paper', label: 'Paper (camera)', folder: 'Inbox/Paper', enabled: true }],
    excalidraw: { enabled: true } },
  quicksketch: { enabled: true, folder: 'Inbox/Quicksketch', ratio: '16:9',
    paper: 'paper',       // native | paper | white | black — solid fill + matching grid colour; per-note override via frontmatter `sketch-bg`
    paperStyle: true,     // subtle paper-grain texture overlay (independent of paper colour)
    invertOnDark: true,   // on a dark paper (black), lift only near-black ink so drawings stay readable
    bg: '#f7f6f2', ink: '#2f2f2f',
    palette: ['#2f2f2f', '#1e6fd9', '#d92f2f', '#1f9e57', '#e0a800'],   // ACTIVE colours (alias of palettes[activePalette].colors)
    palettes: [{ name: 'Default', colors: ['#2f2f2f', '#1e6fd9', '#d92f2f', '#1f9e57', '#e0a800'] }],   // named palettes, max 8 colours each
    activePalette: 0,
    penSizes: { fountain: 3, ballpoint: 2, pencil: 2.5, brush: 5, calligraphy: 3.5, marker: 10 },   // on-screen px, remembered per pen
    penConfig: {},                                         // per-pen behaviour overrides (streamline/thinning/taper/speedThin/cap/noStack)
    sizeFavorites: [1.5, 3, 8],                            // quick-set px favorites
    shapeSnap: true,                                       // hold pen still after drawing → snap to line/rect/ellipse/triangle
    autoGrow: false,                                       // extend canvas downward while drawing near the bottom
    // bgSize 27 ≈ 5 mm squares like real DIN-A4 grid paper: canvas width 1600
    // units ≙ 297 mm (A4 landscape) → 5 mm ≙ ~26.9 units.
    bgType: 'none', bgSize: 27, bgOpacity: 0.12, bgColor: '#334155',
    /* Toolbar layout. `mode` decides whether the options row under the tools
       stays open or opens on demand; `compact`/`full` list which buttons live
       in the bar — everything else in BAR_ITEMS goes to the ⋯ menu. A single
       device can keep its own copy of all three (plugin.barConfig). */
    bar: { mode: 'pinned', compact: null, full: null },
    /* Cap on how wide the sheet renders, in CSS px (0 = fill the pane).
       Endless paper has a fixed width, so a tablet turned to landscape
       must not stretch it — same note, same ink size, either way round. */
    paperWidth: 1100,
    /* Pen buttons and taps: a profile picks the presets, `penMap` overrides a
       single gesture. See lib/sketchgestures.js for what a browser can and
       cannot see a stylus do. */
    /* Handwriting recognition runs a binary the user already has, so the
       plugin stays one file and the text never leaves the machine.
       Desktop only — a phone has no shell to run it in. */
    ocr: { enabled: false, command: 'tesseract {in} {out} -l eng', onSave: false },
    penProfile: 'generic',
    penMap: {},
    toolColors: {},     // toolId → the ink last used with that tool
    toolPalettes: {} },  // toolId → index into `palettes` (unset = the active one)
  ribbon:     { mode: 'hover' },   // 'hover' | 'always' | 'hidden'
  /* Nexus pages that live permanently at the tab bar as an icon (see
     applyPinnedTabs): pinned in Obsidian's own sense, close button hidden,
     reopened by the watchdog if something detaches them anyway. */
  pinnedTabs: { home: false, calendar: false, tasks: false },
  /* Settings that belong to ONE machine, keyed by plugin.deviceId(): the sync
     connection, its schedule, the task accounts. In data.json so they are
     synced and backed up, keyed so no device overwrites another's entry — the
     same arrangement homepage.profiles already uses. See lib/devicesettings.js. */
  devices:    {},
  /* `style` = the SHAPE of the interface (see THEME_STYLES), `palette` only its
     colours. Changing the style changes what the app looks like; changing the
     palette tints whatever the style built. */
  theme:      { style: 'mirobo', palette: 'nexus', gap: null, radius: null, homeGap: null, homePad: null, homeCols: 24, homeRow: 40 },
};

/* WMO weather codes → short text (open-meteo) */

/* WMO weather codes → short text (open-meteo) */
const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Rime fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Freezing rain', 57: 'Freezing rain', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };

const WMO_ICON = { 0: 'sun', 1: 'sun', 2: 'cloud-sun', 3: 'cloud', 45: 'cloud-fog', 48: 'cloud-fog', 51: 'cloud-drizzle', 53: 'cloud-drizzle', 55: 'cloud-drizzle', 61: 'cloud-rain', 63: 'cloud-rain', 65: 'cloud-rain-wind', 71: 'cloud-snow', 73: 'cloud-snow', 75: 'cloud-snow', 80: 'cloud-rain', 81: 'cloud-rain', 82: 'cloud-rain-wind', 95: 'cloud-lightning', 96: 'cloud-lightning', 99: 'cloud-lightning' };

/* Homepage cards: metadata + default config (filter/size). Runtime merge
   via view._cfg(id) → new fields always get defaults, even after saving. */

/* Homepage cards: metadata + default config (filter/size). Runtime merge
   via view._cfg(id) → new fields always get defaults, even after saving. */
const CARD_DEFS = {
  projects: { icon: 'folder-kanban',  title: 'Active projects',    def: { w: 6, h: 8, folder: 'Projects', tags: '', statuses: ['active'], sort: 'due', count: 6 } },
  meetings: { icon: 'calendar-clock', title: 'Meetings',           def: { w: 6, h: 8, folder: 'Meetings', mode: 'auto', count: 5 } },
  reading:  { icon: 'book-open',      title: 'Currently reading',  def: { w: 6, h: 13, folder: 'Books', tags: '', states: ['reading'], planned: true, coverField: 'cover', count: 12 } },
  ideas:    { icon: 'lightbulb',      title: 'Ideas',              def: { w: 6, h: 8, folder: 'Ideas', statuses: ['in-review', 'new'], count: 6 } },
  recent:   { icon: 'history',        title: 'Recently edited',    def: { w: 9, h: 11, exclude: '', count: 8 } },
};

/* Default primary actions of the homepage (kind + label + icon). Kinds:
   journal | newNote | search | calendar | command(arg=cmdId) | note(arg=Name) | url(arg) */

/* Default primary actions of the homepage (kind + label + icon). Kinds:
   journal | newNote | search | calendar | command(arg=cmdId) | note(arg=Name) | url(arg) */
const NX_DEFAULT_ACTIONS = [
  { kind: 'journal',  label: "Today's journal", icon: 'sun' },
  { kind: 'newNote',  label: 'New note',        icon: 'file-plus' },
  { kind: 'search',   label: 'Search',          icon: 'search' },
  { kind: 'calendar', label: 'Calendar',        icon: 'calendar' },
];

/* Obsidian's built-in callout types with their default lucide icons (for preview
   + recognition in the Callouts manager). id = canonical type; aliases share the
   same styling in Obsidian and are only needed to avoid listing them as "custom". */

/* Obsidian's built-in callout types with their default lucide icons (for preview
   + recognition in the Callouts manager). id = canonical type; aliases share the
   same styling in Obsidian and are only needed to avoid listing them as "custom". */
/* Four of Obsidian's callout types are written one way and stored under
   another: its variables are --callout-default/-summary/-fail/-error. Without
   the mapping those four read back empty and their swatch falls to grey, which
   is what made the settings list look like one dot repeated. */
const NX_CALLOUT_VARS = { note: 'default', abstract: 'summary', failure: 'fail', danger: 'error' };

const NX_BUILTIN_CALLOUTS = [
  { id: 'note',     icon: 'pencil',          aliases: [] },
  { id: 'abstract', icon: 'clipboard-list',  aliases: ['summary', 'tldr'] },
  { id: 'info',     icon: 'info',            aliases: [] },
  { id: 'todo',     icon: 'check-circle-2',  aliases: [] },
  { id: 'tip',      icon: 'flame',           aliases: ['hint', 'important'] },
  { id: 'success',  icon: 'check',           aliases: ['check', 'done'] },
  { id: 'question', icon: 'help-circle',     aliases: ['help', 'faq'] },
  { id: 'warning',  icon: 'alert-triangle',  aliases: ['caution', 'attention'] },
  { id: 'failure',  icon: 'x',               aliases: ['fail', 'missing'] },
  { id: 'danger',   icon: 'zap',             aliases: ['error'] },
  { id: 'bug',      icon: 'bug',             aliases: [] },
  { id: 'example',  icon: 'list',            aliases: [] },
  { id: 'quote',    icon: 'quote',           aliases: ['cite'] },
];

const NX_BUILTIN_IDS = new Set(NX_BUILTIN_CALLOUTS.map(b => b.id));

/* Greeting styles for the homepage (h = hour, n = name). */

/* Greeting styles for the homepage (h = hour, n = name). */
const NX_GREETINGS = {
  classic:   (h, n) => (h < 5 ? 'Good night' : h < 11 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + (n ? ', ' + n : ''),
  formal:    (h, n) => (h < 11 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + (n ? ', ' + n : '') + '.',
  buddy:     (h, n) => (h < 11 ? 'Morning' : h < 18 ? 'Hey' : 'Evening') + (n ? ', ' + n : '') + "! How's it going?",
  funny:     (h, n) => ['Hiya', 'Well hello', 'Hey hey', 'Yo'][h % 4] + (n ? ', ' + n : '') + ' 🐸',
  commander: (h, n) => 'Commander' + (n ? ' ' + n : '') + ' — systems ready.',
  zen:       (h, n) => 'Welcome' + (n ? ', ' + n : '') + '. Take a breath.',
  motivate:  (h, n) => "Let's go" + (n ? ', ' + n : '') + "! You've got this. 💪",
  hacker:    (h, n) => 'root@' + (n || 'nexus') + ':~$ welcome',
};

/* ── INTERFACE STYLES ───────────────────────────────────────────────────────
   Each one sets a body class the theme (and the plugin's own CSS) reacts to.
   They are shapes, not colours: every style works with every palette.

     mirobo  the card look Nexus was built as — each pane a rounded, tinted
             chip floating on the desk, named after the velumeron/quickshell
             style it copies.
     plain   "almost nothing": no chips, no gaps, no tint. One flat surface,
             hairlines instead of borders, small radii — the Notion end of the
             range, where the writing is the only thing with any weight. */
const THEME_STYLES = {
  mirobo: { cls: 'nx-style-mirobo', name: 'Mirobo',
            sub: 'Every pane a rounded, tinted card on a desk — the Nexus signature' },
  plain:  { cls: 'nx-style-plain', name: 'Almost nothing',
            sub: 'Flat surfaces, hairlines, barely any radius — everything steps back behind the text' },
};

/* Fixed color palettes → override the wallust --wl-* slots (color3 = accent,
   color0 = dark base, color5 = border source). "dynamic" = wallust snippet
   (only follows the wallpaper when the Velumeron desktop shell is running).

   "nexus" = the theme's own signature palette and the DEFAULT: "Ember & Prussian"
   — a molten Rain-Boots orange accent (color3) over a deep Aubergine ground
   (color0), with a cool Prussian-Blue second hue on the borders (color5) as a
   complementary counterpoint. Madder Lake + Claret fill the warm red/wine slots.
   A fiery sunset-over-blue signature, straight off the reference swatch card.
   Works on ANY machine, with or without the desktop shell. (The light-text tones
   foreground/color15 are light warm tints of the same family — a dark theme
   needs a legible light ink; the identity hues are the five swatch colours 1:1.)

   The five entries after it are sibling signature palettes offered as options
   in the dropdown (same colour math, different combination). Their identity
   lives in color0 (base) · color3 (accent) · color5 (second hue) · color15. */
const PALETTES = {
  nexus:      { background: '#26121b', foreground: '#f0d9cd', color0: '#26121b', color1: '#ce3737', color2: '#c9863f', color3: '#fb6734', color4: '#1b3854', color5: '#1b3854', color6: '#3d6d8c', color7: '#e7d2c7', color8: '#8a6a63', color9: '#e5544a', color10: '#d8a24a', color11: '#fb8b4e', color12: '#4d7ea0', color13: '#6b1a34', color14: '#5a86a4', color15: '#ffe7dc' },
  /* The plain one. Unlike the signature palettes it carries `dark` and `light`
     blocks: the theme derives its surfaces by mixing the accent into them, and
     a neutral scheme is defined by NOT doing that. Those blocks hold the mode's
     --wl-* slots too, so "Minimal" simply IS light or dark — whichever mode
     Obsidian is in. `slots` are what both modes share. */
  minimal:    { slots: { color1: '#eb5757', color2: '#0f7b6c', color3: '#2383e2', color4: '#529cca', color6: '#529cca', color9: '#d44c47', color10: '#4dab9a', color11: '#d9730d', color12: '#529cca', color13: '#9065b0', color14: '#529cca' },
                dark: { '--wl-background': '#191919', '--wl-foreground': '#d4d4d4', '--wl-color0': '#191919', '--wl-color5': '#2f2f2f', '--wl-color7': '#d4d4d4', '--wl-color8': '#9b9b9b', '--wl-color15': '#ffffff',
                        '--nx-desk': '#191919', '--nx-chip': '#191919', '--nx-chip-side': '#202020', '--nx-floor': '#202020',
                        '--nx-elevated': '#2a2a2a', '--nx-border': '#2f2f2f',
                        '--nx-fg': '#d4d4d4', '--nx-fg-muted': '#9b9b9b', '--nx-fg-bright': '#ffffff',
                        '--nx-accent': '#2383e2', '--nx-accent-fg': '#6aa9ea', '--nx-on-accent': '#ffffff',
                        '--nx-code': '#ff7369', '--nx-surface-2': 'rgba(255, 255, 255, 0.055)' },
                light: { '--wl-background': '#ffffff', '--wl-foreground': '#37352f', '--wl-color0': '#ffffff', '--wl-color5': '#e9e9e7', '--wl-color7': '#37352f', '--wl-color8': '#787774', '--wl-color15': '#1a1a19',
                         '--nx-desk': '#ffffff', '--nx-chip': '#ffffff', '--nx-chip-side': '#f7f7f5', '--nx-floor': '#f7f7f5',
                         '--nx-elevated': '#ffffff', '--nx-border': '#e9e9e7',
                         '--nx-fg': '#37352f', '--nx-fg-muted': '#787774', '--nx-fg-bright': '#1a1a19',
                         '--nx-accent': '#2383e2', '--nx-accent-fg': '#1b6fc0', '--nx-on-accent': '#ffffff',
                         '--nx-code': '#eb5757', '--nx-surface-2': 'rgba(135, 131, 120, 0.15)' } },
  azure:      { background: '#0a0e16', foreground: '#e6edf6', color0: '#0a0e16', color1: '#ff6b6b', color2: '#56d364', color3: '#4a9eff', color4: '#7cb0ff', color5: '#ff6b6b', color6: '#56c9d3', color7: '#d4dcea', color8: '#5f6b80', color9: '#ff8a8a', color10: '#7ee08c', color11: '#ffc266', color12: '#9cc2ff', color13: '#ff9db0', color14: '#7adbe4', color15: '#f4f8ff' },
  teal:       { background: '#08110f', foreground: '#e4efea', color0: '#08110f', color1: '#f2766b', color2: '#5fd39a', color3: '#2dd4bf', color4: '#38bdf8', color5: '#f0a830', color6: '#34d3c3', color7: '#d0e2db', color8: '#5e7168', color9: '#ff8f84', color10: '#7fe0b0', color11: '#f7c05a', color12: '#66cffb', color13: '#4de0cd', color14: '#7ee4d6', color15: '#eefaf6' },
  emerald:    { background: '#0a0f0b', foreground: '#e8f0e5', color0: '#0a0f0b', color1: '#ef6f6f', color2: '#34d399', color3: '#34d399', color4: '#56b6e0', color5: '#e8b84b', color6: '#45cfa8', color7: '#d3e2ce', color8: '#63745f', color9: '#ff8a8a', color10: '#63e0a8', color11: '#f2ca63', color12: '#78c8ea', color13: '#9ee0b4', color14: '#6fddc0', color15: '#f1faee' },
  slate:      { background: '#0d0f13', foreground: '#e7ebf1', color0: '#0d0f13', color1: '#f0787f', color2: '#63d59a', color3: '#22d3ee', color4: '#5aa8e0', color5: '#7c8aa0', color6: '#3fd3d3', color7: '#d2d8e0', color8: '#646b78', color9: '#ff9098', color10: '#82e0b0', color11: '#e0b866', color12: '#86bcf0', color13: '#59e0e0', color14: '#7ce0e0', color15: '#f3f7fb' },
  sunset:     { background: '#120a0c', foreground: '#f6e8e1', color0: '#120a0c', color1: '#ff6b6b', color2: '#9fc86a', color3: '#ff8c42', color4: '#6fb0d8', color5: '#ff5e8a', color6: '#f0a860', color7: '#ecd8cf', color8: '#7a5f60', color9: '#ff8a8a', color10: '#b9d98a', color11: '#ffb05e', color12: '#90bce0', color13: '#ff8ab0', color14: '#ffc27a', color15: '#fff0e7' },
  dracula:    { background: '#282a36', foreground: '#f8f8f2', color0: '#282a36', color1: '#ff5555', color2: '#50fa7b', color3: '#bd93f9', color4: '#8be9fd', color5: '#ff79c6', color6: '#8be9fd', color7: '#f8f8f2', color8: '#6272a4', color9: '#ff6e6e', color10: '#69ff94', color11: '#d6acff', color12: '#a4ffff', color13: '#ff92df', color14: '#a4ffff', color15: '#ffffff' },
  gruvbox:    { background: '#282828', foreground: '#ebdbb2', color0: '#282828', color1: '#cc241d', color2: '#98971a', color3: '#d79921', color4: '#458588', color5: '#b16286', color6: '#689d6a', color7: '#a89984', color8: '#928374', color9: '#fb4934', color10: '#b8bb26', color11: '#fabd2f', color12: '#83a598', color13: '#d3869b', color14: '#8ec07c', color15: '#ebdbb2' },
  solarized:  { background: '#002b36', foreground: '#93a1a1', color0: '#073642', color1: '#dc322f', color2: '#859900', color3: '#268bd2', color4: '#268bd2', color5: '#2aa198', color6: '#2aa198', color7: '#eee8d5', color8: '#586e75', color9: '#cb4b16', color10: '#586e75', color11: '#657b83', color12: '#839496', color13: '#6c71c4', color14: '#93a1a1', color15: '#fdf6e3' },
  nord:       { background: '#2e3440', foreground: '#d8dee9', color0: '#2e3440', color1: '#bf616a', color2: '#a3be8c', color3: '#88c0d0', color4: '#81a1c1', color5: '#5e81ac', color6: '#8fbcbb', color7: '#e5e9f0', color8: '#4c566a', color9: '#bf616a', color10: '#a3be8c', color11: '#ebcb8b', color12: '#81a1c1', color13: '#b48ead', color14: '#8fbcbb', color15: '#eceff4' },
  catppuccin: { background: '#1e1e2e', foreground: '#cdd6f4', color0: '#1e1e2e', color1: '#f38ba8', color2: '#a6e3a1', color3: '#cba6f7', color4: '#89b4fa', color5: '#f5c2e7', color6: '#94e2d5', color7: '#cdd6f4', color8: '#585b70', color9: '#f38ba8', color10: '#a6e3a1', color11: '#f9e2af', color12: '#89b4fa', color13: '#f5c2e7', color14: '#94e2d5', color15: '#a6adc8' },
  everforest: { background: '#2d353b', foreground: '#d3c6aa', color0: '#2d353b', color1: '#e67e80', color2: '#a7c080', color3: '#dbbc7f', color4: '#7fbbb3', color5: '#d699b6', color6: '#83c092', color7: '#d3c6aa', color8: '#859289', color9: '#e67e80', color10: '#a7c080', color11: '#dbbc7f', color12: '#7fbbb3', color13: '#d699b6', color14: '#83c092', color15: '#d3c6aa' },
  tokyonight: { background: '#1a1b26', foreground: '#c0caf5', color0: '#1a1b26', color1: '#f7768e', color2: '#9ece6a', color3: '#7aa2f7', color4: '#7dcfff', color5: '#bb9af7', color6: '#7dcfff', color7: '#c0caf5', color8: '#414868', color9: '#f7768e', color10: '#9ece6a', color11: '#e0af68', color12: '#7aa2f7', color13: '#bb9af7', color14: '#7dcfff', color15: '#c0caf5' },
};

/* ── PALETTE NAMES + ORDER ──────────────────────────────────────────────────
   A palette is picked by looking at it, so the label only has to NAME it — the
   colours are in the swatch next to it, not in the text. Grouped by what the
   palette IS, and inside a group by how likely it is to be wanted: the default
   first, the classics alphabetically.

   `dynamic` is not in PALETTES — it means "no fixed palette, follow the live
   wallust snippet" (Velumeron desktop shell). */
const PALETTE_NAMES = {
  nexus: 'Nexus', azure: 'Azure', teal: 'Teal', emerald: 'Emerald', slate: 'Slate', sunset: 'Sunset',
  minimal: 'Minimal',
  catppuccin: 'Catppuccin', dracula: 'Dracula', everforest: 'Everforest', gruvbox: 'Gruvbox',
  nord: 'Nord', solarized: 'Solarized', tokyonight: 'Tokyo Night',
  dynamic: 'Velumeron',
};
const PALETTE_GROUPS = [
  { title: 'Nexus', ids: ['nexus', 'azure', 'teal', 'emerald', 'slate', 'sunset'] },
  { title: 'Neutral', ids: ['minimal'] },
  { title: 'Classics', ids: ['catppuccin', 'dracula', 'everforest', 'gruvbox', 'nord', 'solarized', 'tokyonight'] },
  { title: 'Live', ids: ['dynamic'] },
];

/* Render markdown (new + old API) */

/* ── MODULE NAMES ───────────────────────────────────────────────────────────
   Each module is named after what it does, in plain words. The `sub` line adds
   the detail the name has no room for — it never just restates the name.

   ONLY the display side lives here. Module KEYS (settings.hider, …), command
   ids and CSS classes stay as they are — renaming those would break assigned
   hotkeys and everything already stored in data.json. */
const NX_MODULES = {
  homepage:      { name: 'Dashboard',    sub: 'Rendered start page with cards, stats and quick actions' },
  theme:         { name: 'Theme',        sub: 'Interface style and colour palette' },
  explorer:      { name: 'Explorer',     sub: 'Folder cards and the ribbon in the file tree' },
  folderNotes:   { name: 'Folder Notes', sub: 'A note that belongs to a folder, opened by clicking it' },
  icons:         { name: 'Icons',        sub: 'An icon for any folder or file in the explorer' },
  hider:         { name: 'Interface',    sub: 'Hide parts of the Obsidian interface' },
  banner:        { name: 'Banner',       sub: 'Image at the top of a note, plus the note background' },
  callouts:      { name: 'Callouts',     sub: 'Icon and colour per callout type' },
  columns:       { name: 'Columns',      sub: 'Side-by-side text via a code block' },
  typography:    { name: 'Typography',   sub: 'Replaces -- ... -> while you type' },
  propertyHider: { name: 'Properties',   sub: 'Hide individual frontmatter properties' },
  tagTools:      { name: 'Tags',         sub: 'Rename, merge and remove tags across the vault' },
  quicksketch:   { name: 'Quick Sketch', sub: 'Draw in a note with pen, touch or mouse' },
  inkCapture:    { name: 'Ink Capture',  sub: 'Scans and handwriting from other apps' },
  calendar:      { name: 'Mini calendar', sub: 'Month grid over your daily notes, in the sidebar' },
  tasksCalendar: { name: 'Calendar',     sub: 'Local calendars, events and tasks — the full-page view' },
  search:        { name: 'Search',       sub: 'Weighted search over title, tags, headings, properties, text' },
  workspaces:    { name: 'Workspaces',   sub: 'Save and switch pane layouts' },
  kanban:        { name: 'Kanban',       sub: 'Columns and cards in a note, or every note of a folder — plus the board view of your tasks' },
  planner:       { name: 'Planner',      sub: 'A month on one screen, one line per day — the paper-calendar view' },
  vaultSync:     { name: 'Vault sync',   sub: 'The whole vault to a WebDAV server, with daily backups and conflict copies' },
  quicknote:     { name: 'Chatter',      sub: 'A note you speak instead of type' },
  galaxy:        { name: 'Galaxy',       sub: 'The vault as a turnable map of its links' },
};

/* Pen ids in toolbar order — shared by the settings tab, the size-favourite
   migration and the sketch toolbar so they can never drift apart. */
const PEN_IDS = ['fountain', 'ballpoint', 'pencil', 'brush', 'calligraphy', 'marker'];
const PEN_LABELS = { fountain: 'Fountain', ballpoint: 'Ballpoint', pencil: 'Pencil', brush: 'Brush', calligraphy: 'Calligraphy', marker: 'Marker' };

/* ── The sketch toolbar, as a table ──────────────────────────────────────────
   ONE list describes the bar; the toolbar is a renderer over it. A `tool` owns
   the options row underneath (pen types, sizes, colours); an `action` just
   does something. Adding a tool later means adding a row here, not wiring
   another group by hand.

   Only these are movable between the bar and the ⋯ menu. The buttons that LEAVE
   the sketch — save & close, open in a Sketch tab — are never movable: burying
   "Save & close" in a menu is the exact bug that put it back into the bar, and a
   user cannot be allowed to re-create it. */
const BAR_ITEMS = [
  { id: 'pen',        kind: 'tool',   label: 'Pen',          icon: 'pen-tool' },
  { id: 'marker',     kind: 'tool',   label: 'Highlighter',  icon: 'highlighter' },
  { id: 'eraser',     kind: 'tool',   label: 'Eraser',       icon: 'eraser' },
  { id: 'select',     kind: 'tool',   label: 'Select',       icon: 'lasso' },
  { id: 'space',      kind: 'tool',   label: 'Spacing',      icon: 'between-horizontal-start' },
  { id: 'insert',     kind: 'tool',   label: 'Insert',       icon: 'image-plus' },
  { id: 'ruler',      kind: 'action', label: 'Ruler',        icon: 'ruler' },
  { id: 'outline',    kind: 'action', label: 'Outline',      icon: 'list-tree' },
  { id: 'export',     kind: 'action', label: 'Export',       icon: 'download' },
  { id: 'undo',       kind: 'action', label: 'Undo',         icon: 'undo-2' },
  { id: 'redo',       kind: 'action', label: 'Redo',         icon: 'redo-2' },
  { id: 'zoom',       kind: 'action', label: 'Zoom',         icon: 'zoom-in' },
  { id: 'background', kind: 'action', label: 'Background',   icon: 'layout-grid' },
  { id: 'grow',       kind: 'action', label: 'Auto-extend',  icon: 'chevrons-down' },
  { id: 'clear',      kind: 'action', label: 'Clear',        icon: 'trash-2' },
];
const BAR_ITEM_IDS = BAR_ITEMS.map(i => i.id);
/* What sits in the bar out of the box. The code block has room for the tools
   and the two everyone reaches for; the Sketch tab has room for all of it.
   Anything missing here starts in the ⋯ menu. */
const BAR_DEFAULTS = {
  compact: ['pen', 'marker', 'eraser', 'select', 'undo', 'redo'],
  full:    ['pen', 'marker', 'eraser', 'select', 'space', 'insert', 'ruler', 'outline', 'export', 'undo', 'redo', 'zoom', 'background', 'grow', 'clear'],
};
const BAR_MODES = { pinned: 'Always open', reveal: 'Opens when you pick a tool' };

/* Marquee shapes for the select tool. Same ids the surface accepts. */
/* Ruler angles offered in its popover. null = follow the direction the stroke
   starts in, which is what a real straight edge laid at any angle does. */
const RULER_ANGLES = [
  { id: '', label: 'Free' },
  { id: '0', label: '0°' },
  { id: '45', label: '45°' },
  { id: '90', label: '90°' },
  { id: '135', label: '135°' },
];

const SELECT_SHAPES = [
  { id: 'lasso',   label: 'Lasso',     icon: 'lasso' },
  { id: 'rect',    label: 'Rectangle', icon: 'square-dashed' },
  { id: 'ellipse', label: 'Ellipse',   icon: 'circle-dashed' },
];

const ST_SYMBOL_RULES = [
  { m: '--',   r: '–', grp: 'dashes' },
  { m: '–-',   r: '—', grp: 'dashes' },   // en-dash + hyphen → em-dash
  { m: '...',  r: '…', grp: 'ellipsis' },
  { m: '->',   r: '→', grp: 'arrows' },
  { m: '<-',   r: '←', grp: 'arrows' },
  { m: '=>',   r: '⇒', grp: 'arrows' },
  { m: '(c)',  r: '©', grp: 'symbols' },
  { m: '(r)',  r: '®', grp: 'symbols' },
  { m: '(tm)', r: '™', grp: 'symbols' },
];

module.exports = { IMG_EXT, INK_EXT, INK_DOWNSCALE_EXT, INK_MAX_DIM, CAL_VIEW, CAL_PAGE_VIEW, TASKS_VIEW, HOME_VIEW, SIDE_CAL_VIEW, SIDE_TASKS_VIEW, SKETCH_VIEW, TIMER_VIEW, INK_VIEW, CAPTURE_VIEW, GALAXY_VIEW, SCRATCH_VIEW, SIDE_CAPTURE_VIEW, DEFAULT_SETTINGS, WMO, WMO_ICON, CARD_DEFS, NX_DEFAULT_ACTIONS, NX_BUILTIN_CALLOUTS, NX_CALLOUT_VARS, NX_BUILTIN_IDS, NX_GREETINGS, NX_MODULES, PALETTES, PALETTE_GROUPS, PALETTE_NAMES, PEN_IDS, THEME_STYLES, PEN_LABELS, BAR_ITEMS, BAR_ITEM_IDS, BAR_DEFAULTS, BAR_MODES, SELECT_SHAPES, RULER_ANGLES, ST_SYMBOL_RULES, TASK_BUCKETS };
