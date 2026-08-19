# Nexus Suite

One Obsidian plugin instead of a dozen. Every module is a toggle, so you only
run what you use.

| Module | What it does | Replaces |
|---|---|---|
| **Dashboard** | Rendered start page: cards, stats, quick actions | homepage plugins |
| **Theme** | Interface style, colour palette, spacing, corner radius | style-settings |
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
| **Kanban** | Boards with columns and cards in a note, plus the board view of your tasks | kanban |
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

## Look: style + palette

Two independent decisions, both in Settings → Theme:

**Style** — the *shape* of the interface:

| Style | What it does |
|---|---|
| **Mirobo · cards** (default) | Every pane is a rounded, tinted card floating on a desk — the Nexus signature, named after the velumeron/quickshell look it copies |
| **Almost nothing** | No cards, no gaps, no tint. One flat surface, hairlines instead of borders, 4px radii — the Notion end of the range. The accent survives only where it means something: active, due, done |

The style also reaches the plugin's own surfaces (dashboard, boards, tasks page,
agenda, banner), so the app changes as a whole and not just around the edges.
Card gap and corner radius are Mirobo settings — "Almost nothing" has no cards
to space out, so those two sliders disappear with it.

**Palette** — the *colour* of whatever the style built. Six Nexus signature
palettes (Ember & Prussian is the default), the built-in ones (Dracula, Nord,
Gruvbox, …), plus two plain ones:

| Palette | |
|---|---|
| **Dark · plain** | Neutral greys on near-black, one blue accent — picking it also puts Obsidian in dark mode |
| **Light · plain** | Neutral greys on white — and switches Obsidian to light mode |

Those two are the ones to pair with "Almost nothing" for the full Notion look;
every other combination works as well.

## Tasks

Projects and tasks are ordinary notes: a **project note** (`nexus-type: project`)
holds a live `## Tasks` checklist, each **task note** its frontmatter. Both are
named after their title — ids live in the frontmatter, never in a file name or a
checklist line. Notes from the earlier id-named scheme are renamed once, on
start-up; Obsidian rewrites their links, so nothing is lost.

- **Type a line to make a task.** Write `- [ ] Pay the invoice` under `## Tasks`
  and it becomes a task note, inheriting the project's provider and account —
  so a task typed into a Vikunja or CalDAV project gets pushed on the next sync.
  The line you are still typing is left alone until the cursor moves away.
- **Ticking works everywhere** — project note, agenda block, tasks page — and
  always writes to the task note and back to the checklist. A repeating task
  rolls its due date forward instead of closing.
- **Completed tasks leave the checklist once the server has them**, not the
  moment they're ticked: until the sync confirms, un-ticking is still possible.
- **Vikunja project backgrounds** become the project note's `banner:` (fetched
  once per project, never over a banner you set yourself).

The **tasks page** (ribbon `list-checks`, or *Open the tasks page*) is the task
counterpart of the full-page calendar: the project tree on the left — root
projects as image cards, subprojects indented with their rolled-up open count —
the selected project's tasks on the right, with a line at the bottom to add one.

## The agenda block

A ```` ```nexus-agenda ```` block puts one day — events, tasks, backlinks —
inside an ordinary note. Built for the daily-note template: drop it in once and
every daily note carries its own agenda.

````md
```nexus-agenda
date: note-date
show: calendar, tasks, linked
```
````

Ticking a task writes back to its task note **and** to the checklist line in its
project note; a repeating task advances its due date instead of closing.

| Key | Values | Default |
|---|---|---|
| `date` | `today` · `note-date` (from the file name, daily-note format) · `tomorrow` / `yesterday` · `+3` / `-1` · `2026-07-29` | `today` |
| `show` | any of `calendar`, `tasks`, `linked` — what isn't named is off | all three |
| `hide` | the same names, switched off individually | — |
| `title` | replaces the date heading | the day |
| `calendars` | calendar names, comma separated | all |
| `project` | project names, comma separated | all |
| `state` | `open` · `done` · `all` | `open` |
| `priority` | `>=5` · `=9` · `high` / `medium` / `low` | — |
| `due` | any of `day`, `overdue`, `week`, `month`, `upcoming`, `none`, `any` | `day, overdue` |
| `sort` | `smart` · `due` · `priority` · `title` | `smart` |
| `limit` | max number of tasks | all |
| `exclude` | folders kept out of the linked-notes list | — |
| `hide-empty` | `true` drops sections that have nothing to show | `false` |

A note whose name holds no date falls back to today, so the block is never a
dead end. `Insert an agenda block` in the command palette writes the skeleton.

## Kanban

Two boards, one idea: a column is a state, a card is a thing, dragging one
changes the other.

### A board in a note

A ```` ```nexus-kanban ```` block **is** the board — the columns and the cards
live inside the fence, so the board is one hand-editable text that travels with
the note and still says something without the plugin:

````md
```nexus-kanban
title: Roadmap
notes: Projects/Roadmap
## Backlog
- [ ] Rework the tab bar
- [ ] [[Kanban module|Kanban]] @2026-08-25 #plugin
## In Arbeit @2
- [ ] Vikunja buckets
## Erledigt
- [x] Pinned tabs
```
````

* `## Heading` = a column, `@2` behind it = its WIP limit (the count turns red
  above it).
* `- [ ] text` = a card, `[x]` = done, `[[Note]]` / `[[Note|Title]]` links it to
  a note, `@2026-08-25` a due date, `#tag` a tag.
* Drag with mouse or finger, between and inside columns. Dropping into a column
  whose name reads as "done" ticks the card; dragging it back out unticks it.
* A card can **get** a note: *Create a note for this card* writes it into the
  `notes:` folder (or next to the board), links it and opens it. *Link an
  existing note* points the card at one you already have.
* Anything the parser doesn't understand is written back untouched — a rewrite
  can't eat a line you typed.

| Key | Values | Default |
|---|---|---|
| `title` | board title | the note's name |
| `notes` | folder for notes created from cards | the board note's folder |
| `template` | note used as the body for new cards' notes | — |
| `compact` | `true` = narrower columns | `false` |
| `due` / `tags` / `counts` | `false` hides that part of a card / the head | on |

`New kanban board (note)` and `Insert a kanban board` are in the command
palette; the default columns come from Settings → Kanban.

### Your tasks as a board

The tasks page (`Open the tasks page`) has a **List / Board** switch. The board
shows the same task notes as cards:

* a task remembers its column in its own note (`bucket:`),
* the "done" column and the checkbox mean the same thing — dropping a card there
  completes the task,
* a column that only exists because a task note names it shows up dashed at the
  right, so nothing disappears when you rename a column.

**Vikunja projects bring their own columns.** For a project synced from Vikunja
the board uses the buckets of the project's kanban view and pushes a drag
straight back to the server; the `bucket:` line in the note is the offline copy,
so the board still reads correctly on the tablet, where no sync runs. Without a
credential on the device (or without a kanban view on the server) it falls back
to your own columns and says so.

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
    agenda.js        the ```nexus-agenda``` block: one day (events + tasks + backlinks) in a note
    kanban.js        the ```nexus-kanban``` block: the board IS the block's text (columns + cards)
    taskboard.js     the board mode of the tasks page; Vikunja projects use their server buckets
  views/
    calendar.js      NexusCalendarView (sidebar)
    calendarpage.js  full-page calendar (month/week/day), renders from the cache
    taskspage.js     full-page tasks: project tree + the selected project's tasks, as list or board
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
    01-core.css … 18-tasks-page.css
```

**Secrets:** CalDAV credentials live in `localStorage` (device-local, never
synced, never in `data.json`). Use an app-specific password. `data.json` holds
only non-secret account config — and is gitignored regardless.

Every module is CommonJS (`require` / `module.exports`); esbuild resolves the
local graph. The dependency graph is a DAG (nothing requires `main`), so there
are no circular-load pitfalls.

> `_pre-split-backup/` holds the pre-split `main.js` / `styles.css` (stignored).
