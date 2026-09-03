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
| **Mini calendar** | Month grid over your daily notes, in the sidebar | calendar |
| **Calendar** | A month, and what each day is for | — |
| **Search** | Weighted over title, tags, headings, properties, text | omnisearch |
| **Kanban** | Boards with columns and cards in a note, plus the board view of your tasks | kanban |
| **Planner** | A whole month of day texts, in a block | — |
| **Vault sync** | The whole vault to a WebDAV server, with daily backups | Syncthing, Obsidian Sync |
| **Chatter** | A note you speak instead of type | — |
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

**Style and palette are the whole tab.** Corner radius and card gap used to be
sliders here; they are geometry, and geometry comes from one token block that
the theme and the plugin share — see `themes/Nexus/docs/style-guide.md` and
`docs/tokens.md`. A slider competing with that block is how the same
element ended up with a different corner on every page. The dashboard's own grid
sliders moved to Settings → Dashboard, where the thing they size lives.
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

## The galaxy

Command *Open the galaxy*, or the ribbon's ⊙. Every note is a star, every link a
line, laid out in three dimensions and drawn on a plain canvas — drag to turn
it, and switch to 2D when you want the flat picture. A note's size is how many
links it has, so the hubs of the vault are visible without reading a single
title.

It is a second graph view, not a change to Obsidian's. Obsidian's own is a
closed core plugin: a plugin cannot add a toggle to it, read its layout or draw
into it.

Colour comes from the active palette, so it follows the theme. The layout is
deterministic — the same vault opens the same way every time — and it stops
when it has settled rather than spinning forever. Numbers for how long that
takes, and where it stops being pleasant, are at the top of `src/lib/force3d.js`.

## Hiding the attachment folder

Settings → Explorer → *Hide the attachment folder*. The name defaults to
whatever Obsidian is configured to use; if Obsidian keeps attachments beside
each note there is no single folder to hide and you name one yourself.

It hides the folder from the file tree and nothing else — the files stay where
they are and every link keeps working.

## Tasks

Projects and tasks are ordinary notes: a **project note** (`nexus-type: project`)
holds a live `## Tasks` checklist, each **task note** its frontmatter. Both are
named after their title — ids live in the frontmatter, never in a file name or a
checklist line. Notes from the earlier id-named scheme are renamed once, on
start-up; Obsidian rewrites their links, so nothing is lost.

- **Type a line to make a task.** Write `- [ ] Pay the invoice` under `## Tasks`
  and it becomes a task note, inheriting the project's provider and account —
  so a task typed into a Vikunja project gets pushed on the next sync.
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

A ```` ```nexus-agenda ```` block puts one day — what it is for, what is due,
what links to it — inside an ordinary note. Built for the daily-note template: drop it in once and
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
| `show` | any of `calendar` (the day's text), `tasks`, `linked` — what isn't named is off | all three |
| `hide` | the same names, switched off individually | — |
| `title` | replaces the date heading | the day |
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

One board, one idea: a column is a state, a card is a thing, dragging one
changes the other. What differs is only where the cards come from — the block
itself, a folder of notes, or your task list.

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
  the toolbar first, then the overflow menu
## In progress @2
- [ ] Vikunja buckets
## Done
- [x] Pinned tabs
```
````

* `## Heading` = a column, `@2` behind it = its WIP limit (the count turns red
  above it).
* `- [ ] text` = a card, `[x]` = done, `[[Note]]` / `[[Note|Title]]` links it to
  a note, `@2026-08-25` a due date, `#tag` a tag.
* **Indented lines under a card are its description**, shown under the title on
  the board — at most four lines, the rest cut off with an ellipsis. The whole
  text is in the card editor.
* **Clicking a card opens the card editor**: text, description, due date, tags,
  done, which column it is in, and the note it points at — with *To the note* as
  a button, so a card with a note can still be edited. Ctrl/⌘-click goes
  straight to the note, for a board used as an index.
* Drag with mouse or finger, between and inside columns. Dropping into a column
  whose name reads as "done" ticks the card; dragging it back out unticks it.
* A card can **get** a note: *Create a note* writes it into the `notes:` folder
  (or next to the board), links it and opens it. *Link a note* points the card
  at one you already have.
* Anything the parser doesn't understand is kept and written back — a rewrite
  can't eat a line you typed. (It is written back with the other config lines,
  so its position can move; blank lines inside the fence are not kept.)

| Key | Values | Default |
|---|---|---|
| `source` | `block` (the cards are in the fence) or `folder` | `block` |
| `title` | board title | the note's name |
| `notes` | folder for notes created from cards | the board note's folder |
| `template` | note used as the body for new cards' notes | — |
| `compact` | `true` = narrower columns | `false` |
| `due` / `tags` / `counts` | `false` hides that part of a card / the head | on |

`New kanban board (note)` and `Insert a kanban board` are in the command
palette; the default columns come from Settings → Kanban.

### A folder as the board

`source: folder` keeps the same columns and the same cards, and changes the one
thing that matters: the cards are now **every note of a folder**, and a column
is what a note's own frontmatter says. It never filters — a hand-built board
shows what you remembered to put on it, this shows the folder, so nothing goes
quietly missing.

````md
```nexus-kanban
source: folder
folder: SCHOOL/Biology
title: Biologie
status: status
props: due
## Offen
## In Arbeit @2
## Ausbessern
## Erledigt
```
````

* The headings are the columns, exactly as on a block board — `@2` is still a
  WIP limit.
* **The first column means "nothing set".** Dropping a note there deletes the
  property instead of writing `status: Offen` into every note you own.
* Dragging a card (or clicking its dot, or its ⋮ menu) writes the column's name
  into the note. A value nobody configured still gets a column of its own at the
  right — a note can never fall off the board.
* A card shows the note's first sentence, up to three tags, the properties named
  in `props:`, and how many notes of this folder it links to. Hovering one lights
  up its web; a note nothing links to gets a dashed edge.
* The filter field narrows the board without changing it, and the gear writes
  every setting back into the fence.

| Key | Values | Default |
|---|---|---|
| `folder` | the folder whose notes are the cards | the note's own folder |
| `status` | frontmatter property holding the column | `status` |
| `sort` / `dir` | `name` · `modified` · `created` · `state` / `asc` · `desc` | `name` / `asc` |
| `size` | `small` · `medium` · `large` | `medium` |
| `props` | comma-separated frontmatter keys, shown as badges | — |
| `excerpt` / `tags` / `links` / `orphans` / `state` | `false` hides that part of a card | on |

`Insert a folder board` writes the skeleton with the folder you are in already
filled in.

**The older ```` ```nexus-board ```` block still works.** It is the same board
with `source: folder` pre-set, and its own spellings (`states:`,
`statusproperty:`, `columns:`, `direction:`, `show:`) are read as the keys
above — **and written back as themselves**. A fence keeps the shape you typed
it in: `states: A, B, C` stays one line instead of becoming three headings, and
a fence that never needed a `source:` line never grows one. The only forced
change is a WIP limit, which has no spelling in a `states:` line and moves the
columns to headings.

### The same notes without columns

A ```` ```nexus-graph ```` block is the other half of that block: the same
folder, arranged by what the notes are instead of where they stand.

````md
```nexus-graph
folder: SCHOOL/Biology
view: graph
height: 260
```
````

* `view: grid` — every note once, as a sorted wall of the same cards.
* `view: graph` — the notes as dots and the links between them as lines,
  coloured by state, sized by how connected they are. Hovering a dot lights its
  neighbours; clicking one opens the note.
* `view: board` hands the block back to the columns above, and the three view
  buttons in its head switch between all three and write the choice into the
  fence — the line appears the moment you pick a view, not before.

`Insert a folder graph` is in the command palette. An older ```` ```nexus-board ````
with `mode: grid` or `show: graph` renders here on its own — nothing to change.

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

## The capture hub

Everything you caught rather than wrote — scans, drawings, spoken notes — under
one toolbar, on three tabs. It opens as a full tab or as a sidebar panel, and it
is laid out for ~280 px first.

The toolbar is written once and every tab gets it: search, sort, select mode,
and then **Tag**, **Move** and **Delete** over the selection. A tab may bring
verbs of its own; the Ink tab brings two.

### A capture is a set of files, never one

A scan is a note, the scan itself and — for a PDF — a cached render of its first
page. Delete and Move both act on that whole list, so neither can strand a
picture in a folder nothing points at any more. Move uses Obsidian's own
`renameFile`, which rewrites the note's `![[…]]` embed; a name already taken at
the destination blocks *that* capture by name and the rest still travel.

### Split it — a capture with pages

A capture can hold several pages. **Pages** on a scan's tile opens the list:
reorder with the arrows, drop one with the bin, or add one from a file. Adding
copies the file in straight away — a PDF has to be rendered before it can show
a thumbnail — but everything else waits for Save, and Cancel takes those copies
back out. Dropping a page trashes its file and removes its embed from the note.

Two or more scans selected, then **Merge**, makes them one capture: the first in
the shown order survives, the rest hand over their pages and their files move
into its folder. This is deliberately an explicit act — the folder watcher
cannot tell three photos of one letter from three unrelated scans that landed in
the same second, and un-merging is far harder than merging.

The frontmatter keeps its old shape and grows one key:

```yaml
ink-file:  "Inbox/Paper/Lease/ink-m4x8k1.pdf"        # always page one
ink-thumb: "Inbox/Paper/Lease/ink-m4x8k1.thumb.png"  # page one's cached render
ink-pages:                                            # only once there are two
  - file: "Inbox/Paper/Lease/ink-m4x8k1.pdf"
    thumb: "Inbox/Paper/Lease/ink-m4x8k1.thumb.png"
  - file: "Inbox/Paper/Lease/ink-m4x8k2.png"
```

A capture written before this has no `ink-pages` and simply reads as one page —
its frontmatter is never rewritten for being looked at. A capture written after
it still names page one in `ink-file`, so an older copy of the plugin shows the
first page rather than nothing. Back down to one page, `ink-pages` is removed
again and the capture is exactly the old shape.

The tile shows page one and, above two, how many there are.

### Mark it — annotate a scan

**Annotate** on a scan's tile opens it in the Quick Sketch canvas with the scan
as the bottom layer, sized to the page and **locked**: it is not selectable, so
no tap picks it up and no lasso catches it. Drawing on top is then just drawing.

The capture *gains* the sketch, it does not spawn a sibling note: the sketch id
goes into the capture's own `ink-sketch` frontmatter and a ```` ```quicksketch ````
block into its body, and the pad opens knowing the note it came from, so its
"show the note" button leads back. Annotating again reopens the same sketch.

A PDF has no image except that cached first page, so that is what goes on the
canvas — and it says so rather than annotating page one silently.

### Read it

**Read** runs the handwriting recogniser (Settings → Quick Sketch) over the
selected scans and writes what it finds into each note's body, fenced by
`%% nexus:ocr %%` markers so a second reading replaces the first and never
touches what you wrote yourself. Every page is read, in order. Desktop only —
the recogniser is a program on the machine — and the button is absent where it
cannot run.

## Quick Sketch

A ```` ```quicksketch ```` block is a pad you draw on with pen, touch or mouse.
Each drawing is a standalone `.svg` sidecar: an image any tool can open, with the
raw stroke data (points and pressure) kept in its `<metadata>` so it stays
editable.

### Where a drawing lives

Two places, and they are the same engine over the same sidecar.

A **code block** is a sketch inside the text: small, in the flow of the note,
with a compact toolbar. A **Sketch tab** is the drawing on its own, with the full
toolbar, the options row permanently in reach and room to zoom. Anything longer
than a doodle belongs in the tab.

Every markdown note can own a **drawing with pages**. The corner button at the
top right of a note is the way in: tap it to switch to the drawing, press and hold (or
right-click) to choose between *Switch to sketch*, *Open to the left*, *Open to
the right* and *Open in a new tab*. The button is hollow on a note that has none
yet and filled once there is one. The tab's `file-text` button is the way back to
the text.

The note holds nothing but the ids (`sketch: sk-…`, or a list once there is more
than one page). The first is written when you open the drawing, together with an
empty sidecar, so the tab always opens on a real file. `New sketch note` does
both in one step.

### Pages

Throw a finger **sideways** in the Sketch tab to turn a page — left for the next
one, right for the one before. Throw it left off the **last** page and a new
blank page is made: that is the way to add one. Only at 100 %; zoomed in,
sideways is how you look around the sheet.

A new page inherits **page one's paper** — colour, texture and grid. A second
page on different paper is not a second page, it is a different pad.

The page count is the button to the list: every page as a thumbnail, where you
open one, add one, name one, or take one out of the note. A name is typed over
"Page 2" and lives in that page's own sidecar, so it travels with the drawing
rather than with the note that lists it. Taking a page out leaves its `.svg`
where it is — a drawing is worth more than the line that pointed at it.

There is no close button: closing the tab closes it, and the blank paper
auto-grow left below the last stroke is trimmed then. The `file-text` button
switches **this** tab back to the text.

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
Sketch tab. Anything you leave out moves into the bar's `⋯` menu. Save and "open
in a Sketch tab" are not in that list: they always stay in the bar, because
hiding the way out of an editor is not a preference.

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
| **This drawing** | Not a pen: its options row holds the outline, export, "open the note beside this" and clear. Four things reached once in a while, behind one button instead of four. |
| **Outline** | Named marks down the page, and a list to jump between them. What an endless sheet needs instead of headings. |
| **Export** | SVG, PNG or PDF, written next to the sketch. |

A shape that was recognised by holding the pen still keeps its description, so it
can be re-cornered later and not just scaled as a block. Select it on its own and
its own control points appear.

### The page

The sheet has a **fixed width** (settings, default 1100 px) and grows downward
for as long as you keep writing. That cap is what stops a tablet turned to
landscape from rendering the same note at a bigger ink size. A one-finger drag
scrolls with the same throw as the note around it.

### Zoom

From 0.3× for an overview of a long page to 5×. Four ways in, because a pinch is
not available to everyone and is not visible to anyone:

| | |
|---|---|
| Pinch | Two fingers on the canvas |
| `ctrl` / `⌘` + wheel | The desktop's pinch. A plain wheel still scrolls the page |
| The **Zoom** button | `−`, the level, `+`, and *Page width (100 %)* |
| The pill, bottom right | Always shows the level; tap it for page width |

### Finger shortcuts

Fingers never draw — the pen does — so a tap is free to mean something:

| Gesture | Does |
|---|---|
| Two fingers, tapped twice | Back to page width |
| Three fingers, one tap | The same, where the OS lets three touches through |
| Double tap | Undo |
| Triple tap | Redo |

Two fingers carry the zoom reset because three simultaneous touches are a system
gesture on a lot of Android tablets and never reach the page at all. A *single*
two-finger tap stays free: that is where a pinch begins and ends.

Each one says what it did, briefly, at the bottom left of the pad — an undo of a
stroke you had already forgotten looks exactly like nothing happening.

Undo waits out the multi-tap window (about a third of a second) before it fires;
otherwise every triple tap would undo something on its way to the redo. A tap
within 600 ms of the pen **touching** the glass is a palm and is ignored, so a
hand resting mid-sentence cannot undo anything — a pen merely hovering does not
count, or a tablet with the pen in your hand would never see a tap at all. In a
code block in view mode only the zoom reset works: the drawing is read-only
there.

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

## The calendar

A month, and what each day is for. One view — a month is the only shape that
answers "what does this look like", and a week or a day is a note.

Every cell is a writing surface. Tap it and type what the day is for: not one
line, as much as fits. The text fills the cell and is clipped at the bottom
rather than pushing the row taller, because a month whose rows change height as
you write is not a month. `Ctrl`/`⌘ + Enter` or tapping away saves it, `Esc`
puts back what was there.

### Where the text lives

In that day's own note, as **one frontmatter field**:

```md
---
important: Ship 0.29, then rest
---
```

Not in a plugin file. Obsidian's own search finds it, a template can prefill it,
a Dataview query can read it, and it survives without this plugin. The field is
`important` by default and you can change it under **Calendar → The day's
text**. Writing on a day that has no note yet creates one, from your daily-note
template.

The rest of the cell: the **day number** opens the note, and tasks due that day
ride along as chips under the text. The sidebar mini calendar only *marks* a day
that has a text — a sidebar column is too narrow for a sentence.

There are **no events**. Local calendars, the event dialog, RRULE expansion and
the iCalendar parser were taken out — what is left is the month, the day texts
and what is due. `docs/removed-features.md` §6 has the account and the way back.

## Planner

A ```` ```nexus-planner ```` block is a month on one screen, showing **the same
text per day the calendar does** — a whole month of it in an ordinary note.

````md
```nexus-planner
view: month
month: 2026-09
```
````

The fence says only *which* month; what a day says lives in that day's own note
(see *The calendar*, above), so the block and the calendar page are one thing
seen twice and cannot disagree. `view: week` gives seven roomier rows instead;
the arrows page through months or weeks and write the new position back. Each
cell has a small button that opens that day's daily note, using the core
plugin's own format, so the planner never invents a second naming scheme.

Typing in a cell writes to the note, not to the block. `Ctrl`/`⌘ + Enter`
finishes, `Esc` puts back what was there.

### Lines the block still holds

Before this, the block WAS the store: `2026-09-03: Ship 0.25` lines inside the
fence. Those are no longer read. To carry them over, run **Move planner lines
into the daily notes** (also a button under *Settings → Calendar → Planner*):

- it counts what it found and says how many daily notes it would have to create
  **before** it writes anything;
- a day whose note already has a text is **left exactly as it is** and reported
  as such;
- nothing is deleted — the blocks keep their old lines, inert, so a run that
  went wrong costs nothing.

## A note as a task

`nexus-task: true` in the frontmatter of **any** note puts it in the tasks view
and lets you tick it there, without moving it into the task folder and without a
second note standing in for it. Command *Track this note as a task* toggles it.

The case this exists for is a thought written down in the middle of something
else that should be picked up later. Taking it out of the note it belongs to
would take the context with it, which is why a checklist line somewhere else is
not good enough. Such a task shows a small note icon in the list, and clicking
it opens the whole thing rather than a stub.

## The dashboard on startup

*Settings → Dashboard → On startup* has three answers, not a switch:

| | |
|---|---|
| **Nothing** | Obsidian opens the way it closed. |
| **Open it in a tab of its own** | The dashboard comes up **without ever replacing a note you left open**. Already open somewhere — the pinned tab included — and that one is brought forward; an empty tab is taken over, because an empty tab is not a note; otherwise it gets a tab of its own. |
| **Close every tab, then open it** | The main area is cleared first and the dashboard is what is left. Sidebars stay, and so do the pinned Nexus pages — the pin watchdog would only reopen them a moment later. |

*Open when the last tab closes* (off by default) brings the dashboard up instead
of leaving an empty pane behind when you close the final tab in the main area.

The old *Open on startup* toggle is migrated on the first load: on became *a tab
of its own*, off became *Nothing*.

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
| **Connections** | A connection is an **entry in a list**, not a row of text fields: you declare it once in a modal and afterwards only *Test* or *Remove* it. Half-editing one — a new URL against the old password — produces something whose first news of being wrong is a failed sync. To change one, remove it and add it again; removing it takes its stored credential with it. The Vikunja accounts under *Tasks & Calendar* are the same list, because they are the same idea. |
| **Per device** | The server, its user name, this device's name and the schedule (*Sync on start*, *Every*) belong to **this machine** and are stored under its own key in `data.json`, so a sync carries them nowhere. Every device connects itself — as do the Vikunja accounts. Shared policy is not per device: the exclude list, *Carry the settings too*, the conflict rule, *Shared vault* and the backup count are one answer for the whole vault. |
| **Conflicts** | Keep both by default: the server version keeps the file name, yours is saved beside it with the device name and time in it. Newer-wins, this-device-wins and server-wins are offered and are described as what they are, which is a choice to discard something. |
| **Deletions** | Go through Obsidian's trash, not `unlink`. A sync that deletes the wrong file has to be recoverable. |
| **Settings** | With *Carry the settings too* on, `.obsidian` travels — **except** `workspace.json`, `workspace-mobile.json`, `graph.json` and the sync's own state. Those describe this machine; carrying them would rearrange panes you deliberately arranged. |
| **Backups** | One zip a day into `_backups`, taken after the first sync of the day, oldest removed past the number you keep. The ZIP writer is in the plugin (`lib/zip.js`) for the same reason the PDF writer is: it has to stay one bundled file. |
| **Folders** | Created a segment at a time on both sides. `adapter.mkdir` is not the same call on desktop and mobile — asked for `Tasks/Items` where `Tasks` is missing, one makes both and the other refuses — so the device *receiving* a vault has to build the path itself. On the server side the folder is created once per run, not once per file in it. |
| **When it goes wrong** | Settings → Vault sync → **The last run** says what the run did, names the first five failures in full, and has a *Sync* button that reports right there. Every failure, not only those five, goes to the console as `[Nexus] sync failed on "<path>": <reason>`. |

### What it is not

*Shared vault* makes each device leave a note on the server saying it is here,
so you can be told when someone else is in the same vault. That is not live
co-editing. Two people typing in the same paragraph at the same time needs a
CRDT and a relay server holding the document in memory — a WebDAV server stores
files and answers requests, and no arrangement of file uploads adds up to
character-level merging. The honest version of that feature is a short sync
interval plus a warning that someone else is in here.

## Chatter

Named for what it is: the note you say before you have decided whether it is any
good. The stored settings key is still `quicknote` and so is the command id — a
key lives in a file you already have, and an id is what a hotkey is bound
against, so renaming either would cost something and buy nothing a display name
does not already give.


Command *Chatter (speak a note)* opens a recorder. Say the thing, press stop, and
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

Whether the recorder can run at all is decided **before** anything is recorded:
with the local engine on a phone or tablet, or with a command that is not set,
or with the browser engine on a device whose browser has no recogniser, the
button is dead and the reason stands where the status line would be. On a
desktop, a command naming a program that is not installed says exactly that
instead of `spawn … ENOENT`.

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
PATH. Eighteen pages, ~1220 checks: the toolbar and its options row, selection and
transforms, the canvas and the spacing tool, objects and the ruler, pen gestures,
export (the PDF is checked byte by byte), sketch search and the OCR command line,
the kanban board writing itself back, notes as tasks, the planner, the sync
decision table with the ZIP writer, Chatter, the capture hub, and the galaxy.

Two of those pages are the capture hub, on purpose. `capture.html` proves the
pure layer — what an item is, search, sort, select, a capture's page list and
the migration off the single-attachment shape. `inkvault.html` drives the same
code against a fake vault (a plain map of path → text) and reads back what
ended up on disk, because a delete that strands an attachment or a move that
leaves the frontmatter pointing at nowhere cannot show up in a pure test.

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
    datadir.js       where the plugin's own JSON lives (the sync state)
    daytext.js       what a day is FOR — one frontmatter field of that day's note
    plannermigrate.js the one-off move of old planner lines into the daily notes
    notesketches.js  the PAGES of a note's drawing: the id list in its frontmatter
    tasks.js         projects & tasks as Markdown — the .md files are the source of truth
    agenda.js        the ```nexus-agenda``` block: one day (its text + tasks + backlinks) in a note
    kanban.js        the ```nexus-kanban``` block: head, column strip, card and drag — shared by both sources
    kanbanblock.js   how a board is written down: the parser and the writer of the block's own text
    kanbanedit.js    source “block”: the fence IS the board — its card menu, card editor and write-back
    board.js         source “folder”: the notes of a folder are the cards, the column is their frontmatter
    graph.js         the ```nexus-graph``` block: the same notes as a grid or as a force-directed web
    taskboard.js     the board mode of the tasks page; Vikunja projects use their server buckets
    devicesettings.js settings that belong to ONE machine, keyed by device id inside data.json
    capture.js       the hub's pure layer: what an item is, search, sort, select, the move plan
    inkpages.js      a capture's pages — the list, its order, the migration, the annotated sketch
    inkactions.js    the writes: annotate a scan, add a page, save a page list, merge captures
  views/
    calendar.js      NexusCalendarView (sidebar)
    calendarpage.js  the month, its day texts and the tasks due on each day
    taskspage.js     full-page tasks: project tree + the selected project's tasks, as list or board
    timers.js        timer sidebar view + done/config modals
    ink.js           the capture hub's Ink tab: its adapter, its verbs and its card actions
    capturehub.js    the capture hub itself — one toolbar over a small per-tab adapter
    sketch.js        Quick Sketch — vector drawing engine + SVG (de)serialization
    homepage.js      NexusHomepageView (the hub)
  modals/
    pickers.js       popup menu + icon picker (leaf UI)
    callout.js       callout editor / insert / suggest
    cards.js         homepage card config modals (card/list/quicknote/stat/action/hero)
    image.js         hero image config, vault picker, zoom/crop
    misc.js          generic name-input modal
    kanbancard.js    one kanban card: text, description, due, tags, column, its note
    search.js        fuzzy search suggest modal
    banner.js        top-banner modal
    workspace.js     workspace switcher
    account.js       add a connection (Vikunja account or the WebDAV server) + test it
    event.js         create/edit a VEVENT in a local calendar
    task.js          quick-add a task to a local project
    capture.js       where a set of captures moves to, and what pages one capture is made of
  styles/
    index.css        @imports the parts below, IN ORDER (cascade-preserving) → styles.css
    00-tokens.css … 24-galaxy.css
```

**Styling rule:** every radius, border, surface, control height and spacing step
comes from `styles/00-tokens.css`. A literal `border-radius`, a written-out
`1px solid` or a bare `opacity:` that means "a lifted surface" is a defect — the
contract is `docs/tokens.md`. New UI uses the shared
`.nx-btn` / `.nx-input` / `.nx-row` / `.nx-card` classes; a button that has to
look different gets a modifier, not a new class. The `.nx-*-btn` classes that
still exist are legacy aliases waiting on a JS rename —
[`docs/token-migration.md`](docs/token-migration.md) is the checklist.

**Secrets:** the WebDAV password and the Vikunja API token live in
`localStorage` (device-local, never synced, never in `data.json`). Use an
app-specific password and an API token, never the primary one. `data.json`
holds only non-secret account config — and is gitignored regardless.

**Per-device settings:** everything that describes one machine rather than the
vault — the sync server it talks to, the schedule it keeps, the accounts it is
signed in to — lives in `data.json` under `devices[<device id>]`
(`lib/devicesettings.js`, reached through `plugin.deviceSetting()` /
`plugin.setDeviceSetting()`). In the file, so it is synced and backed up; keyed,
so no device can overwrite another's entry. That is the same arrangement
`homepage.profiles` uses, and it is why the vault sync can keep carrying
`data.json` without flattening the other device.

Every module is CommonJS (`require` / `module.exports`); esbuild resolves the
local graph. The dependency graph is a DAG (nothing requires `main`), so there
are no circular-load pitfalls.

> `_pre-split-backup/` holds the pre-split `main.js` / `styles.css` (stignored).
