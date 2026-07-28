# Nexus Suite

One Obsidian plugin instead of a dozen. Every module is a toggle, so you only
run what you use.

| Module | What it does | Replaces |
|---|---|---|
| **Dashboard** | Rendered start page: cards, stats, quick actions | homepage plugins |
| **Theme** | Colour palette, spacing, corner radius | style-settings |
| **Explorer** | Folder cards and ribbon in the file tree | — |
| **Folder Notes** | A note per folder + folder-overview blocks | folder-notes |
| **Icons** | An icon for any folder or file | icon-folder |
| **Interface** | Hides parts of the Obsidian chrome | hider |
| **Banner** | Image at the top of a note, grouped picker | pexels-banner |
| **Callouts** | Icon and colour per callout type | callout-manager |
| **Columns** | Side-by-side text via a code block | columns |
| **Typography** | Replaces `--` `...` `->` while you type | smart-typography |
| **Properties** | Hides individual frontmatter properties | — |
| **Tags** | Rename, merge and remove tags vault-wide | tag-wrangler |
| **Quick Sketch** | Low-latency vector drawing in a note | — |
| **Ink Capture** | Scans and handwriting into the vault | — |
| **Calendar** | Month view over your daily notes | calendar |
| **CalDAV** | Server accounts, local calendars, events, tasks | — |
| **Search** | Weighted over title, tags, headings, properties, text | omnisearch |
| **Workspaces** | Save and switch pane layouts | — |

Built for a card-based vault layout and designed to work on mobile as well as
desktop (the bundle is a single file, no runtime `require` of sibling modules).

## Install

Not in the community store — install via
[BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install **BRAT** from the community plugin store.
2. `BRAT: Add a beta plugin for testing` → `vredix-openvuture/nexus-suite`
3. Enable **Nexus Suite** in Settings → Community plugins.

BRAT checks for a new release on every Obsidian start and updates in place.

The matching theme lives at
[vredix-openvuture/nexus-theme](https://github.com/vredix-openvuture/nexus-theme).

## Build & source layout

The plugin **source** lives in `src/`. Obsidian still only ever loads the
bundled `main.js` + `styles.css` at the plugin root — those are **build outputs,
don't edit them by hand** (and they're gitignored; releases carry them). esbuild
bundles `src/` into a single file each, so mobile stays intact.

```sh
npm install        # once — pulls esbuild into ./node_modules (stignored, never synced)
npm run dev        # watch: rebuilds main.js + styles.css on every save in src/
npm run build      # one production build (minified, no sourcemap) — the resting state
```

While `npm run dev` runs, edit anything under `src/`, then reload the plugin in
Obsidian (disable/enable, or `Cmd/Ctrl-R`). Dev builds emit an external
`main.js.map` (stignored) so devtools maps back to the `src/` files.

**Before you stop working, run `npm run build`** so the synced `main.js` is the
small minified one (~160 KB) rather than the fat dev build.

To cut a release, use `./release.sh <version>` — it builds, bumps the manifest,
tags and uploads the three assets BRAT needs.

### Source layout

```
src/
  main.js            entry — the NexusSuite plugin class; wires every module together
  constants.js       data tables: extensions, view ids, DEFAULT_SETTINGS, weather, palettes, typography rules
  settings.js        NexusSettingsTab
  lib/
    helpers.js       renderMd, daily-note, ink zoom/pan, pdf page, colour conversion
    inputs.js        reusable settings inputs (autocomplete, multi-row, property rules, icon field)
    caldav.js        CalDAV client (RFC 4791) over requestUrl — DESKTOP ONLY
    ical.js          dependency-free iCalendar (RFC 5545) parser/serializer for VEVENT/VTODO
    recur.js         RRULE expansion, always bounded to the visible range
    calstore.js      event cache + local calendars as vault JSON, so mobile renders offline
    tasks.js         projects & tasks as Markdown — the .md files are the source of truth
  views/
    calendar.js      NexusCalendarView (sidebar)
    calendarpage.js  full-page calendar (month/week/day), renders from the cache
    timers.js        timer sidebar view + done/config modals
    ink.js           ink-capture gallery view + tag modal
    sketch.js        Quick Sketch — vector drawing engine + SVG (de)serialization
    homepage.js      NexusHomepageView (the hub)
  modals/
    pickers.js       popup menu + icon picker (leaf UI)
    callout.js       callout editor / insert / suggest
    cards.js         homepage card config modals (card/list/quicknote/stat/action/hero)
    image.js         hero image config, vault picker, zoom/crop
    misc.js          generic name-input modal
    search.js        fuzzy search suggest modal
    banner.js        top-banner modal
    workspace.js     workspace switcher
    account.js       CalDAV account add/edit + calendar discovery
    event.js         create/edit a VEVENT in a local calendar
    task.js          quick-add a task to a local project
  styles/
    index.css        @imports the parts below, IN ORDER (cascade-preserving) → styles.css
    01-core.css … 13-calendar-page.css
```

**Secrets:** CalDAV credentials live in `localStorage` (device-local, never
synced, never in `data.json`). Use an app-specific password. `data.json` holds
only non-secret account config — and is gitignored regardless.

Every module is CommonJS (`require` / `module.exports`); esbuild resolves the
local graph. The dependency graph is a DAG (nothing requires `main`), so there
are no circular-load pitfalls.

> `_pre-split-backup/` holds the pre-split `main.js` / `styles.css` (stignored).
