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
| **Planner** | A month on one screen, one line per day | — |
| **Vault sync** | The whole vault to a WebDAV server, with daily backups | Syncthing, Obsidian Sync |
| **QuickNote** | A note you speak instead of type | — |
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
| **Mirobo** (default) | Every pane is a rounded, tinted card floating on a desk — the Nexus signature, named after the velumeron/quickshell look it copies |
| **Almost nothing** | No cards, no gaps, no tint — the Notion end of the range: system sans, a 708px text column, 24px line height, headings by size and weight only, links underlined in text colour, red inline code on one grey surface, grey callouts, hairline tables, a 14px sidebar. The accent survives only where it means something: active, due, done |

The style also reaches the plugin's own surfaces (dashboard, boards, tasks page,
agenda, banner), so the app changes as a whole and not just around the edges.
Card gap and corner radius are Mirobo settings — "Almost nothing" has no cards
to space out, so those two sliders disappear with it.

**Palette** — the *colour* of whatever the style built. Picked from swatches,
not from names: each one is a disc in four quarters — ground, accent, second
hue, ink, the slots the theme derives everything from — next to a plain name.
Grouped as **Nexus** (the six signature palettes), **Neutral**, **Classics**
(Catppuccin, Dracula, Everforest, Gruvbox, Nord, Solarized, Tokyo Night) and
**Live**:

| Palette | |
|---|---|
| **Minimal** | Neutral greys with one blue accent, and the only palette that follows Obsidian's own light/dark mode: white page and #f7f7f5 sidebar in light, #191919 and #202020 in dark |

Minimal is the one to pair with "Almost nothing" for the full Notion look;
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

## Quick Sketch

A ```` ```quicksketch ```` block is a pad you draw on with pen, touch or mouse.
Each drawing is a standalone `.svg` sidecar: an image any tool can open, with the
raw stroke data (points and pressure) kept in its `<metadata>` so it stays
editable.

### The toolbar

Two rows. The top one holds the tools, the one under it holds the options of
whichever tool is active: pen types, widths and colours for the pen, widths and
colours for the highlighter. The eraser has nothing to configure, so that row
collapses instead of sitting there empty.

| Setting | Default | What it does |
|---|---|---|
| Options row | Always open | The row stays under the bar. |
| Options row | Opens when you pick a tool | The row opens on a tool tap and closes again on your first stroke, so the canvas is whole while you draw. |
| Just this device | off | Keeps a separate toolbar on this device in `localStorage`. Never synced, so a phone can hold three buttons while the desktop holds all of them. |

Which buttons live in the bar is yours to set, separately for a note and for the
full-size editor. Anything you leave out moves into the bar's `⋯` menu. Save,
full size and "open beside the note" are not in that list: they always stay in
the bar, because hiding the way out of an editor is not a preference.

At least one tool has to stay in the bar. Turning the last one off is refused.

### Tools

| Tool | What it does |
|---|---|
| **Pen** | Five nibs (fountain, ballpoint, pencil, brush, calligraphy), each with its own width, colour and behaviour sheet. |
| **Highlighter** | Translucent, and overlapping strokes of one colour do not stack darker. |
| **Eraser** | Removes whole strokes. |
| **Select** | Lasso, rectangle or ellipse. Move, scale and rotate what you caught, recolour it, duplicate it, delete it. |
| **Spacing** | Drag a line down to open blank paper, up to close it again. Everything below the line moves with it. |
| **Insert** | An image (embedded, so the file stays standalone), a sticky note, or one of eight stickers. |
| **Ruler** | A straight edge the pen slides along, free or locked to 0 / 45 / 90 / 135 degrees. Stays on across strokes. |
| **Outline** | Named marks down the page, and a list to jump between them. What an endless sheet needs instead of headings. |
| **Export** | SVG, PNG or PDF, written next to the sketch. |

A shape that was recognised by holding the pen still keeps its description, so it
can be re-cornered later and not just scaled as a block. Select it on its own and
its own control points appear.

### The page

The sheet has a **fixed width** (settings, default 1100 px) and grows downward
for as long as you keep writing. That cap is what stops a tablet turned to
landscape from rendering the same note at a bigger ink size. Zoom runs from 0.3×
for an overview to 5×, and a one-finger drag scrolls with the same throw as the
note around it.

### Pen buttons

| Gesture | Reported as |
|---|---|
| Side button | `PointerEvent.buttons` bit 2 |
| Eraser end | `PointerEvent.buttons` bit 5 |
| Double-tap | Two taps of the tip, timed and placed by the plugin |

Each maps to an action you pick, with presets per pen. Worth saying plainly: the
S Pen's air actions, the ones you do without touching the screen, are handled by
Android and never reach a web page. Neither does the Lenovo pen's top button. A
browser only sees what the pen does on or near the glass.

### Finding a sketch again

`Search sketches` searches the title, the section names and the sticky notes of
every sidecar. That works with nothing installed.

Handwriting is added on top by `Read the handwriting in this sketch`, which runs
a program you install yourself — the default command line is
`tesseract {in} {out} -l eng`. Nothing is uploaded and nothing is bundled; the
cost is that it is desktop only, because a phone has no shell to run it in. A hit
in recognised handwriting is labelled as such in the results, because it is a
guess.

### Colours per tool

Every tool remembers the ink it was last used with, so switching to the
highlighter and back does not cost you the pen's colour. A tool can also be put
on its own palette: pick the tool, then the swatch book at the end of the colour
strip. Tools you never assign follow the palette marked active in the settings.

The pen starts at the **Default ink color** setting on a vault that has never
drawn; every other tool starts at the head of its own palette.

Deleting a palette that a tool was using drops that tool back to the active one
rather than silently moving it to a different set of colours.

## Planner

A ```` ```nexus-planner ```` block is a month on one screen with **one line per
day**. It is not the tasks module and not the agenda: those answer what is due,
this answers what a month is *for*, which is a much shorter answer. Daily and
weekly notes stay where the detail goes.

````md
```nexus-planner
view: month
month: 2026-09
2026-09-03: Ship 0.25
2026-09-11: Dentist, 14:00
```
````

The block **is** the plan, the same way a kanban board is: one line per day
inside the fence, sorted by date, so it survives without the plugin and travels
with the note. `view: week` gives seven roomier rows instead; the arrows page
through months or weeks and write the new position back. Each cell has a small
button that opens that day's daily note, using the core plugin's own format, so
the planner never invents a second naming scheme.

## A note as a task

`nexus-task: true` in the frontmatter of **any** note puts it in the tasks view
and lets you tick it there, without moving it into the task folder and without a
second note standing in for it. Command *Track this note as a task* toggles it.

The case this exists for is a thought written down in the middle of something
else that should be picked up later. Taking it out of the note it belongs to
would take the context with it, which is why a checklist line somewhere else is
not good enough. Such a task shows a small note icon in the list, and clicking
it opens the whole thing rather than a stub.

## Vault sync

The whole vault to a WebDAV server: Nextcloud, a Synology, anything that speaks
it. Runs on mobile too, because it goes through Obsidian's own `requestUrl`.

**Three-way, not two-way.** It compares what is here, what is on the server, and
what was here the last time the two agreed. Without that third input a sync
cannot tell a file you *deleted* from a file that has not *arrived* yet — so it
either resurrects everything you delete or deletes everything you have not
downloaded. The record of the last agreement lives in the plugin folder and is
itself excluded from the sync.

| | |
|---|---|
| **Credentials** | localStorage, per device. Never in `data.json` — that is a file in the vault, and the vault is what gets uploaded. |
| **Conflicts** | Keep both by default: the server version keeps the file name, yours is saved beside it with the device name and time in it. Newer-wins, this-device-wins and server-wins are offered and are described as what they are, which is a choice to discard something. |
| **Deletions** | Go through Obsidian's trash, not `unlink`. A sync that deletes the wrong file has to be recoverable. |
| **Settings** | With *Carry the settings too* on, `.obsidian` travels — **except** `workspace.json`, `workspace-mobile.json`, `graph.json` and the sync's own state. Those describe this machine; carrying them would rearrange panes you deliberately arranged. |
| **Backups** | One zip a day into `_backups`, taken after the first sync of the day, oldest removed past the number you keep. The ZIP writer is in the plugin (`lib/zip.js`) for the same reason the PDF writer is: it has to stay one bundled file. |

### What it is not

*Shared vault* makes each device leave a note on the server saying it is here,
so you can be told when someone else is in the same vault. That is not live
co-editing. Two people typing in the same paragraph at the same time needs a
CRDT and a relay server holding the document in memory — a WebDAV server stores
files and answers requests, and no arrangement of file uploads adds up to
character-level merging. The honest version of that feature is a short sync
interval plus a warning that someone else is in here.

## QuickNote

Command *Quick note (speak it)* opens a recorder. Say the thing, press stop, and
it becomes a note — the first eight words become the file name, because that is
what you will be scanning for later, and the exact time goes in the frontmatter
where it does not have to be short.

Two recognisers, and the difference is stated rather than hidden:

- **A program on this machine** (default). Runs the command you configure on the
  recording, e.g. `whisper-cli -f {in} -otxt -of {out} -l de`. Nothing leaves the
  machine. Desktop only, because a phone has no shell to run it in.
- **The browser's own recogniser.** No install and it works on mobile — but most
  builds send the audio to the browser vendor to transcribe it, which is the
  opposite of local, so it is never the default.

Ticking *Track the note as a task* writes `nexus-task: true`, so a spoken
reminder turns up in the tasks view.

## Build & source layout

The plugin **source** lives in `src/`. Obsidian still only ever loads the
bundled `main.js` + `styles.css` at the plugin root — those are **build outputs,
don't edit them by hand** (and they're gitignored; releases carry them). esbuild
bundles `src/` into a single file each, so mobile stays intact.

```sh
npm install        # once — pulls esbuild into ./node_modules (stignored, never synced)
npm run dev        # watch: rebuilds main.js + styles.css on every save in src/
npm run build      # one production build (minified, no sourcemap) — the resting state
./test/run.sh      # toolbar tests; add "visual" to also write test/visual.png
```

`test/run.sh` bundles the plugin against a stub of the Obsidian API and drives
it in headless Chromium against a real DOM. It needs `chromium` and `python3` on
PATH. Thirteen pages, ~590 checks: the toolbar and its options row, selection and
transforms, the canvas and the spacing tool, objects and the ruler, pen gestures,
export (the PDF is checked byte by byte), sketch search and the OCR command line,
the kanban board writing itself back, notes as tasks, the planner, the sync
decision table with the ZIP writer, and QuickNote.

Some of it is verified outside the harness as well, because a structural check is
not proof a file opens: the exported PDF passes `qpdf --check` and renders with
`pdftoppm`, and a generated backup archive passes `unzip -t` and reads correctly
in Python's `zipfile`.

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
