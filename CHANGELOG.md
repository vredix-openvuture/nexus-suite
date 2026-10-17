# Changelog

Grouped by what changed for you, not by commit. Newest first.

## 0.36.0 — 2026-10-17

### Added

- **Zen mode for the Sketch tab.** A button at the right end of its toolbar
  lifts the drawing over the whole window — no tab bar, ribbon, sidebars or
  status bar. Esc or the same button brings them back.
- **The pen's side button can move the page while held**, as in Krita: hovering
  or with the nib down, including a Huion whose nib arrives as touch. New action
  *Move the page while held*, and a *Huion / XP-Pen display* profile that puts it
  on the side button. With that action, a second side button reported as the
  middle button counts as the side button too.
- **No mouse arrow over the nib while a pen draws.** Hovering keeps it, since on
  a tablet without a screen it is the only way to aim.

- **Galaxy controls.** The slider button in the galaxy's bar opens a panel like
  Obsidian's graph controls: notes without links, node size, link thickness,
  names shown, idle turning, and the four forces (center, repel, link force,
  link distance). Forces reheat the layout live from where it stands. The link
  length slider moved there from Settings → Galaxy.
- **Middle mouse button drags a sketch around**: held and moved, it pans the
  plane or scrolls the page the sketch sits on, like one finger. It never counts
  as a tap, so double middle-clicks undo nothing.
- **Galaxy turn speed.** A slider under "Keep turning" in the galaxy panel.
- **Pin the galaxy and the capture hub to the tab bar**, like the dashboard: Settings → Dashboard →
  Pinned tabs, or right-click its tab. The icon-only look now hangs on one class
  (`.nx-pinned-tab`) for every pinnable page.
- **Galaxy star chart.** The map sits on the same star chart the theme draws
  behind Obsidian's graph: meridians, rings and an accent glow in the middle.

### Changed

- **Scanned PDFs open at 80% of the note width** instead of 50%, and the size
  you pick with −/+ is remembered for every PDF (`inkCapture.pdfSizePct`).
- **The galaxy shows groups, not a ball.** A link now pulls by the less-linked
  of its two notes, as in d3-force: a hub's many links each pull a little, so
  the groups around it stay apart. New default forces (center 0.002, repel
  6000, link 0.2, distance 35), and the camera backs off with a wide map so
  near notes no longer balloon in 3D.
- **Hovering a note in the galaxy holds it still** instead of letting it drift
  out from under the pointer, and the hover label now actually appears.
- **Big vaults unfold faster:** the layout steps by a time budget per frame
  instead of one step at a time above 600 notes.

### Removed

- **The `graph` sketch background** (engineering paper). A sketch saved with it
  shows the plain grid instead.

### Fixed

- **A mindmap fills the Sketch tab** right after a sheet is switched to one,
  instead of staying boxed at the sheet width with empty strips left and right
  until the tab was reopened.
- **A held side button no longer counts as the nib touching down**, which on a
  Huion switched its nib-as-touch drawing off for the rest of the session.
- **A touch counts as a Huion nib only straight out of pen hover** (within a
  second), so a finger on a 2-in-1 whose pen once hovered pans again.

- **A Huion pen on a Linux desktop draws instead of scrolling the sketch.** Under
  Wayland it hovers as `pen` but touches down as `touch`, which the sketch pad
  reads as a finger and pans with. On desktop, once a pen has been seen hovering
  but has never touched down as `pen`, a single touch is taken as its nib. One
  real pen contact turns that off again, so devices that report properly keep
  their fingers. The nib carries no pressure, so strokes have an even width.
  Tablets are unchanged: their pens arrive as `pen`.
- **The Capture button no longer uploads into nowhere when Ink Capture is off.**
  It said nothing and left the file unprocessed in the inbox; it now says the
  module is off and where to turn it on.
- **Sketch popovers no longer float on after the plugin unloads** (an update or
  a reload with the paper menu open left it on screen).
- The 3D/2D buttons now show which mode is active.
- **The galaxy opened as an empty pane.** Its note-opening method was called
  `open`, which replaced the view's own `open` that Obsidian uses to start it,
  so the map was never built. Renamed to `openNote`.

## 0.35.0 — 2026-10-12

### Added

- **Add-ons.** Settings → Nexus Suite → Add-ons lists plugins that extend the suite; the switch downloads one's
  newest GitHub release into the vault and turns it on, with update and remove. A running add-on
  shows its settings as a page under Add-ons. Keys stay in each device's secret storage. The
  first add-on is **Nexus Vikunja**.
- **Kanban boards from other plugins.** A board with a `source:` the suite does
  not know asks a registry (`kanban.registerSource`); a companion plugin fills
  it and the suite draws it. Until that plugin is loaded the board says so. The
  first one is the separate **Nexus Vikunja** plugin.
- **A progress notice while the vault syncs.** Every run, scheduled or not,
  shows one notice until it ends: what it is doing while both sides are listed,
  then a *Pulling* bar (server → this device) and a *Pushing* bar (this device →
  server) with their counts. A run with nothing to move only says *Up to date —
  nothing to do.* Pulling now runs before pushing.
- **An area eraser.** The eraser has an options row now: the stroke eraser
  takes whole strokes as before, the area eraser removes only the ink under its
  disc and cuts a stroke it crosses in two. Three disc sizes, a ring while the
  pen is down, one undo step per rub. The choice is remembered.

### Changed

- **Clicking a kanban card opens its note**, in a new tab — and makes one if the
  card has none, so every card is somewhere to write. The card editor moved to
  Ctrl/⌘-click and *Edit…* in the ⋮ menu. Folder boards open their notes in a
  new tab too, so the board stays open.
- **The Sketch tab draws paper, not only books.** Only a note with several
  pages is a notebook. One page of endless paper or a mindmap is an A4 sheet
  showing the drawing; one page of sectioned paper is a stack of sheets. *Cover…*
  is offered for notebooks only.
- **Deleting a page asks first, and really deletes it.** In the page list of the
  Sketch tab, removing a page now asks for confirmation, then puts its `.svg` in
  the trash. Before, the file stayed behind and showed up in the capture hub as
  an empty loose sheet.

### Fixed

- **Kanban: no second, offset outline when typing a new card.** Obsidian's own
  input border and focus ring were drawn inside the row's border.
- **The stroke eraser hits a stroke between its points**, not only at them.
- **Stickers, notes and images land where you are looking.** On a long endless
  or sectioned page they were placed in the middle of the whole sheet, which
  after scrolling is somewhere off screen.
- **"Sync failed … 423" on Nextcloud.** Nextcloud locks a file while something
  else reads it, and refused writes in that moment. A locked write is now asked
  for twice more within a few seconds and otherwise left for the next run,
  counted as *locked* instead of announced as a failure.

## 0.34.0 — 2026-10-11

### Changed

- **Backups are made by the server, beside the vault.** Once a day the server
  copies the vault folder into `<vault folder>-backup/<date>/` beside it —
  e.g. `Obsidian/nexus-backup/2026-10-11/` next to `Obsidian/nexus/`. A copy
  that is cut off stays a `.partial` and never counts as a backup.
  Nothing passes through the device, so a phone or tablet backs up a large vault
  too; the old daily zip was built in memory and a tablet failed on every run
  ("Invalid array length"). Only the first device of the day makes the snapshot.
  Zips from older versions move out of `_backups` into the new folder.

### Fixed

- **A device joining a vault no longer reports "clashes".** Its first sync
  listed every setting where its defaults differed from the vault's as changed
  on both sides. The vault's values were already taken; now nothing is
  announced until the devices have a common earlier state.

Commits: v0.33.0...v0.34.0

## 0.33.0 — 2026-10-11

### Added

- **Book capture.** ISBN scan or entry, DNB/Open Library/Google Books lookup, a
  note from your own template with the cover saved into the vault; fill the empty
  fields of an existing book note.

### Changed

- **A narrow settings window shows a page picker instead of the side menu.**
  Once the plugin's part of the settings dialog is narrower than about 640 px,
  a dropdown at the top (with ‹ › to step through the pages) replaces the menu;
  on a very narrow page, setting rows put their control under the name. The switch is measured on
  the tab itself, not on the window: a ~680 px settings window used to leave
  the page ~250 px and cut it off, because Obsidian's own sidebar takes the
  rest. This also replaces the phone's list-then-page layout. A long server
  address no longer widens the Vault sync page.
- **The plugin's settings use the whole settings window on desktop and tablet.** They
  used to stop at Obsidian's 700 px reading column and a fixed height of
  780 px; now they fill the height and grow up to 1100 px wide.
- **A second file of the same name is now `Name (2)`** wherever the plugin
  creates one — banner imports, scans, kanban card and board notes, sketch
  notes, exports, a renamed ink sidecar. They used to be `Name-1` or `Name 2`
  depending on which part of the plugin wrote them. File names are cleaned by
  one rule everywhere: `:` and the like become spaces, `#^[]` are dropped,
  names stop at 120 characters (a renamed scan note `10:30 Meeting #1` is now
  `10 30 Meeting 1`).
- **The hold menu on a note's sketch button ignores a press that moves.** A
  flick across the button scrolls instead of opening the menu, like the hold
  menus in the capture hub already did.
- **A folder the plugin cannot create is reported by name** instead of failing
  silently and then failing again on the file inside it. Quick Note and book
  capture show it in their notice; elsewhere it reaches the console.

### Fixed

- **A device lost its own sync server after its first sync** (found in a live
  test, laptop + tablet against Nextcloud). The other device's `data.json`
  replaced its own, so after the next restart the URL was gone while sync still
  showed as on. An incoming `data.json` is now merged three ways against the
  copy both devices last agreed on: a setting only one side changed is taken
  from that side, so a change made here and another made there both survive; a
  list of plain values (the exclude list) keeps both sides' additions and
  removals. What belongs to one device stays with it — its connection, and its
  own dashboard and name when the dashboard is per device. A setting both
  changed differently takes the other device's value, and the run's notice
  names it. The first run after this update (or a device joining) has no agreed
  copy yet: every setting that differs then takes the server's value, and the
  notice names those too. The merged file goes back to the server when it holds
  something the server's copy did not.
- **Two same-size edits a moment apart were never compared.** Both sides had
  changed, the sizes matched and the times were under two seconds apart, so the
  sync took them as equal; the devices then kept different text and every run
  said "nothing to do". With a record, a same-size change on both sides is now
  always compared byte for byte.
- **No conflict copies of config files.** A device joining used to get
  `core-plugins (conflict …).json` and `data (conflict …).json`, which then
  travelled everywhere. A config file changed on both sides now takes the
  server's copy; the other side's is discarded (logged to the console). Which
  side is newer cannot be told — the server's time is the upload's.
- **Settings changed on another device are taken in memory**, not only on disk
  (`onExternalSettingsChange`). The values are written into the objects and
  lists already in memory, so an open settings page, modal or dashboard card
  keeps editing the live settings, and the settings tab, dashboard, theme,
  explorer, callouts and banner are drawn again (the settings tab not while you
  type in it). Before, the next save wrote the old values back. The plugin's own
  writes are recognised by what was last written, and a file read while a save
  was under way is dropped — Obsidian mobile reports the plugin's own writes
  too, 86 times in seven seconds on the tablet, and answering each with a save
  made the sync upload `data.json` on every run.
- **A broken `data.json` on the server** (not JSON, or not a settings object)
  is replaced by this device's copy instead of failing every run.

### Removed

- **The *Shared vault* switch** under Vault sync. It saved a setting nothing
  read: the code that would have announced each device on the server was never
  called. `docs/removed-features.md` §9 has what it was and the way back.

### Internal

- **Cleanup pass** — dead code and CSS removed, duplicated helpers merged, the
  four largest files split by job (`src/features/`, `src/settings/`,
  `src/views/home/`, `src/views/sketch/`). The full list, with the reason and the
  commit for each item and how to roll it back: `docs/cleanup/2026-10-07.md`.

Commits: v0.32.0...v0.33.0

## 0.32.0 — 2026-10-07

### Added

- **The Sketch tab is a shelf of sketchbooks.** A card there is a book now, not a
  page: a note's pages are one cover, one name, one card and one delete that
  takes every page with it. Before this, a seven-page note appeared as seven
  separate drawings that each claimed to be a single page.

  The tile is a bound book — stitched spine, cover, page edges — rather than a
  thumbnail of the ink. A shelf answers *which one is this* and *how thick is
  it*; the drawing is one tap away either way.
- **A cover for each sketchbook**, from a card's own menu: five palette tones by
  four bindings — solid, linen, marble, ruled. Stored as two NAMES in the
  sidecar and mixed from the live palette when the tile is drawn, so a book
  follows the wallpaper instead of freezing one into every file. A sketch that
  was never given one still gets a cover: the tone is hashed from its id, so a
  shelf is never one flat colour and nothing is written to disk for it.
- **Long press a sketchbook** — right click on a desktop — for Rename, Cover,
  Go to the note and Delete. Rename and Cover write the sidecar directly and
  hand the same value to a pad that happens to be open on that drawing, so the
  next stroke cannot undo them. Deleting a book also stops the note naming its
  pages, or the next open would write a blank page one back. The hold is
  cancelled by movement, so a flick through the grid still scrolls.

- **Three kinds of paper, not one.** The background button opens with a **Paper
  type** row: *Endless* (what it always was), *Sectioned* and *Mindmap*. It is a
  per-sketch choice, with a default in Settings → Quick Sketch.
- **Sectioned paper** is the endless sheet cut into A4 pages with a small gap
  between them. The page edges are visible while you write and real in the
  exported file — a long note gains landmarks, and a printer gains pages. It
  always ends at a page edge, so it grows a whole sheet at a time. *A4 the wide
  way round* turns the pages to landscape and keeps the number of sheets.
- **Mindmap paper** is no sheet at all: a canvas with no edges, moved in every
  direction. One finger moves the camera at any zoom, two pinch it, and the
  wheel scrolls it. The saved file is cropped to what was actually drawn, and
  the camera is stored with the drawing, so a map reopens where you left it.
- **Two fingers, tapped three times: back to where you started.** On endless and
  sectioned paper that is the top of the sheet; on a mindmap it is the camera the
  drawing was opened with — the one fixed place a canvas without edges has.

### Changed

- **Two fingers tapped twice now waits out the multi-tap window** before it
  resets the zoom, the same way the one-finger undo does. Without the wait, every
  trip home would reset the zoom on its way there.
- **The page list shows the number on the thumbnail.** The name is the only line
  under the picture; a number and a name stacked below each other read as two
  competing titles.

### Fixed

- **Vault sync no longer turns a first run into a wall of conflicts.** A second
  device joining a vault that was already on the server made a conflict copy of
  almost every file: the server stamps its own time on an upload, and files of
  the same size were judged by time alone. They are now compared byte for byte,
  and only real differences become conflicts — reported in one notice, not one
  toast per file. A file that fails on every run is announced once, not on
  every scheduled sync. Files that already agree get a record straight away, so their
  next edit is a plain upload or download.
- **Vault sync keeps its record per device.** The state file is now
  `sync-state.<device id>.json`. The old shared `sync-state.json` could be
  carried to another device by Syncthing, which then judged every file against
  someone else's record. The old file is ignored and then removed; the first run
  after the update re-learns the state by comparing files. Identical files make
  no conflict, and a file that differs is always kept twice on that run, whatever
  the conflict rule says — with no record, "newer" or "server wins" would be a
  guess. A file deleted on one side before the update comes back on that run.
- **A failed daily backup no longer throws away the sync.** The record of the
  run is saved first; a backup refused by the server (413) is reported and tried
  again on the next run.
- **Other sync tools' working files are not uploaded:** Syncthing temp files and
  the Nextcloud desktop client's journal and log.
- **A sketchbook opened from the capture hub knows its note again.** The hub
  opened every drawing without one, so the Sketch tab had no page list: turning
  a page did nothing and adding one answered "this drawing does not belong to a
  note, so it has no pages" — about drawings that plainly did.
- **The page count is the note's page list.** The tile counted *sections inside
  one file* and, finding none, printed the words "one page" on every drawing in
  the vault.
- **A drawing's name survives being drawn on.** The name lives in the sidecar,
  but it was never handed to the canvas — and the canvas rewrites the whole
  metadata block on every committed stroke. A rename therefore lasted until the
  next stroke, and the SVG/PNG/PDF export always fell back to the id.
- **The "read / not read" chip is gone from the Sketch tab.** Handwriting
  recognition needs a desktop shell, so on a tablet it said "not read" about
  everything, for ever, with no way to change that from the device it was shown
  on.
- **A sketch in a note kept running after its block was replaced.** The commit
  debounce, the coasting scroll and the pad's own timers were tied to nothing;
  a block re-renders on the very first stroke, so they piled up. The pad now
  belongs to the element Obsidian owns — and the copy being replaced lets go
  quietly instead of writing its older drawing over its successor's.
- **The mini calendar marks day texts again.** The method behind the marks
  was lost in 0.30 while the view kept calling it, so every paint of the sidebar
  month ended in an error (after the grid was drawn) and the view never
  subscribed to note changes. The method is back.

### Removed

- **Tasks & Calendar, the whole module.** Gone: the full-page calendar and its
  pinnable tab, the tasks page with its project tree and board mode, local tasks
  and projects, *Track this note as a task* (`nexus-task: true`), the
  ```` ```nexus-agenda ```` block, the calendar and tasks side panels, the
  calendar and tasks dashboard cards, the Vikunja connection and its sync, and
  Chatter's *Track the note as a task* box. Its settings tab, ribbon icons and
  commands went with it.

  **Your notes stay.** Task and project notes are ordinary Markdown and are
  left exactly where they are; an old `nexus-agenda` block shows as a plain code
  block. The settings that outlived the module — *Week starts on* and the
  day-text frontmatter key — moved to **Settings → Mini calendar**, and a value
  you had set is carried over on the first load. The Vikunja tokens are removed
  from this device's storage at the same moment. `docs/removed-features.md` §8
  has every file, key and command, and the way back.

## 0.31.2 — 2026-09-04

### Fixed

- **The "this drawing" row was unusable.** Its entries reused the bar's own
  button, which is a fixed square — the label landed on top of the icon. They
  are wide labelled buttons of their own now, and they read as buttons.
- **The button sat with the pens.** It is not something you draw with, so it
  moved to the right, with the other things you do *to* a drawing.
- **The page count was too loud.** Back to the same size as everything else in
  the bar.
- **The paper button showed itself as on or off.** It opens a chooser; "on" is
  not a thing a paper picker can be, so it is a plain button now.

### Removed

- **The auto-extend button.** The Sketch tab grows endlessly anyway, and in a
  code block the setting (*Settings → Quick Sketch → Auto-extend*) still decides.
  One fewer switch in a bar that was competing with itself.

## 0.31.1 — 2026-09-04

### Fixed

- **A swipe on the sketch toolbar did nothing.** Obsidian walks up from a touch
  and gives up its own gestures — the drawer swipe, and the swipe down that
  opens the command palette — at the first ancestor marked `data-ignore-swipe`.
  That mark was on the whole sketch view, so the toolbar and everything above it
  lost them too. It sits on the drawing alone now: swipe down on the toolbar and
  the command palette opens, swipe on the canvas and you are drawing.

## 0.31.0 — 2026-09-04

### Changed

- **Outline, Export, Clear and "open the note beside" moved behind one button.**
  *This drawing* sits with the tools and opens the options row, the same way the
  pen does — four things reached once in a while were four buttons competing
  with the ones you reach for constantly. Each says what it is rather than
  relying on its icon.
- **The button back to the note switches THIS tab** instead of opening the note
  somewhere else and leaving the drawing standing. It says "switch", so it
  switches.
- **A new page inherits page one's paper** — colour, texture and grid. A second
  page on different paper is not a second page, it is a different pad.
- **The page count reads as a control**: its own surface, a border and a
  chevron. A count you cannot press is a fact with nothing to do.

### Added

- **A page can be named.** Type over "Page 2" in the page list. The name lives in
  that page's own sidecar, next to its strokes, so it travels with the drawing
  rather than with the note that happens to list it.

### Removed

- **The minimize button in the Sketch tab.** "Close the drawing" and "close the
  note" are not the same decision, and a button that looked like the first did
  the second. Closing the tab does it, and the empty paper below the last stroke
  is trimmed then.

## 0.30.0 — 2026-09-04

### Added

- **A note's drawing has pages.** Throw a finger sideways in the Sketch tab to
  turn one; throw it left off the last page and a new blank one is made. The
  button beside the page count lists every page as a thumbnail, opens one, adds
  one, or takes one out of the note. The note keeps the order in its own
  frontmatter — `sketch: [sk-a, sk-b]` — and a note that already names one
  drawing as a plain string stays exactly as it is until it gets a second page.
- **Two fingers, tapped twice, put the sheet back to page width.** Three
  simultaneous touches are a system gesture on a lot of Android tablets and
  never reach a web page, which is why the three-finger tap did nothing there.
  It still works where the OS allows it. A single two-finger tap keeps meaning
  nothing — that is where a pinch begins and ends.
- The zoom reset **says so even when it was already at 100 %**: "nothing
  happened" and "not recognised" otherwise look the same.

### Changed

- **The planner block and the calendar are one thing now.** Both read and write
  the same text — the day's own note. The `nexus-planner` fence keeps only which
  month it shows; its cell is a paragraph rather than a one-line field, and
  `Ctrl`/`⌘ + Enter` finishes it, the same as in the calendar.
- **Old planner lines move on request**, never behind your back: the command
  **Move planner lines into the daily notes** (also a button in Settings →
  Calendar → Planner) counts what it found, says how many notes it would create,
  and writes only after you say so. It never overwrites a day whose note already
  has a text, and it deletes nothing — the blocks keep their old lines, which the
  planner no longer reads.
- Taps are given more room: a burst may last 600 ms (was 500) and a run of them
  counts up to 420 ms apart (was 320). Human hands are slower than mouse
  numbers.

### Removed

- **The Tasks page can no longer be pinned to the tab bar**, and its switch is
  gone from Settings → Dashboard → Pinned tabs. The dashboard and the calendar
  keep theirs. `pinnedTabs.tasks` left in `data.json` is dead but harmless.
- The planner's own store: `Planner folder` and `File name` under Settings →
  Calendar, and the month notes they pointed at. Existing month notes are
  ordinary notes now — nothing reads them until you run the migration above.

## 0.29.0 — 2026-09-03

### Changed

- **The calendar is a month, and what each day is for.** One view — a month is
  the shape that answers "what does this look like"; a week or a day is a note.
  Every cell is a writing surface: tap it and type, not one line but as much as
  fits. The text fills the cell and is clipped at the bottom rather than pushing
  the row taller, because a month whose rows change height as you write is not a
  month. `Ctrl`/`⌘ + Enter` or tapping away saves, `Esc` puts back what was
  there.
- **The day's text lives in that day's own note**, as one frontmatter field
  (`important` by default, changeable under *Calendar → The day's text*). Not in
  a plugin file: Obsidian's search finds it, a template can prefill it, a
  Dataview query can read it, and it survives without this plugin. Writing on a
  day with no note yet creates one from your daily-note template.
- **The dashboard card, the sidebar panel and the agenda block follow.** All
  three listed events; all three now show what the coming days are for and what
  is due on them. The mini calendar marks a day that has a text.

### Removed

- **Events, and the local calendars they lived in.** After the CalDAV layer went
  in 0.27.0 they were the only event source left — a second place to write about
  a day, with an iCalendar parser and an RRULE engine behind it. Gone with them:
  the event dialog, the "New event" command, the calendar visibility panel, the
  week and day views, and the "only these calendars" filters.

  **Your data is not deleted** — the calendar JSON is simply no longer read, and
  the data folder itself stays (the sync state lives there). `dataLocation` and
  `dataFolder` are unchanged. `docs/removed-features.md` §6 has the full account
  and the way back.
- The `nexus-planner` block keeps its own lines in its own block and still
  works; the calendar no longer reads them. Two answers to one question — pick
  the storage you want.

## 0.28.1 — 2026-09-03

### Fixed

- **Finger taps were never recognised on a pen tablet.** Palm rejection counted
  the pen HOVERING over the glass, not just touching it — and on a tablet the
  pen is in your hand above the screen the whole time, so the 600 ms window
  never closed and every finger gesture was thrown away before it was read. The
  window now opens on pen **contact**. A palm that lands just before the nib is
  still caught: the pen touching down clears the touches it finds.
- **The tap thresholds were mouse numbers.** A three-finger tap is six pointer
  events with a human hand between them, and a finger on glass wanders further
  than a mouse: a tap may now last 500 ms (was 300), travel 18 px (was 10), and
  a run of taps counts up to 320 ms apart (was 260).

### Added

- **A tap says what it did** — a small read-out at the bottom left of the pad:
  *Undo*, *Redo*, *Page width*. An undo of a stroke you had already forgotten
  looks exactly like nothing happening, and this is also the only way to tell
  "the tap was not recognised" from "the tap did nothing".

## 0.28.0 — 2026-09-03

### Added

- **A drawing for every note, in its own tab.** The corner button at the top
  right of a markdown note opens that note's drawing in a Sketch tab; press and
  hold it to pick where — switch to it, put it to the left or right, or open a
  new tab. The tab's `file-text` button is the way back to the text. The note
  carries nothing but the id, so nothing about the drawings themselves changed.
- **Zoom you can see.** A **Zoom** button in the toolbar (`−`, the level, `+`,
  and *page width*), `ctrl`/`⌘` + wheel on the desktop, and a percentage pill in
  the bottom right that is now always on screen instead of appearing only once
  you were already lost. Tapping the pill goes back to page width.
- **Finger shortcuts on the canvas.** Three fingers, one tap = back to page
  width. Double tap = undo, triple tap = redo. Both in a code block and in the
  Sketch tab. Undo waits out the multi-tap window first, so a triple tap does
  not undo on its way to the redo, and a touch within 600 ms of the pen is still
  treated as a palm and ignored.

### Removed

- **Slate mode and the full-size editor.** Two more places to draw a big
  drawing, both worse than the Sketch tab: in a slate note the options row did
  not follow the scroll, so changing colour meant scrolling to the top of the
  note, and a magnified sheet had nowhere to go sideways. Neither is fixable
  where they lived. **Nothing was lost:** the sidecars, the ids and the
  `sketch:` frontmatter are untouched, so every drawing made in a slate note
  opens in the tab. A leftover `nexus: slate` line does nothing.

  Gone with them: the *Toggle slate mode* command, the two slate settings
  ("hide properties", "hide the app chrome") and the `sketch-bg` frontmatter
  override. `docs/removed-features.md` §5 has the full account.

### Fixed

- **The zoom pill never appeared while zoomed OUT.** The Sketch tab tested
  `z > 1.01`, so the whole 0.3–1 range left the read-out dim and the stage
  un-scrollable. It tests the distance from 1 now.
- **A touch in the app's first 600 ms was always read as a palm.** Palm
  rejection compared against `this._lastPen || 0`, and 0 is inside the window
  when the page has only just loaded. It starts at `-Infinity`.
- **A press-and-hold on a toolbar button could still fire the button.**
  `stopPropagation` does not reach another listener on the same element;
  `stopImmediatePropagation` does.

## 0.27.1 — 2026-09-02

The design-token contract moved into the repo (`docs/tokens.md`,
`docs/token-migration.md`). Nothing changed for anyone using the plugin.

## 0.27.0 — 2026-09-02

### Added

- **The galaxy.** The vault's links laid out in three dimensions and drawn on an
  ordinary canvas — drag to turn it, and a 2D/3D switch that animates rather
  than cuts. Depth is size, draw order and fade, never glow. No library and
  nothing added to the bundle; the layout is deterministic from a seed, so the
  same vault opens the same way twice. Obsidian's own graph view is a closed
  core plugin and cannot be given a toggle — this is a second view beside it.

  Measured, whole unfold: 150 notes in 45 ms, 800 in 1.3 s, 1500 in 4.6 s. Only
  the unfolding pays that. On a tablet the fifteen-hundred case is several times
  slower, which is where it stops being pleasant; the numbers are in the header
  of `lib/force3d.js` so nobody has to guess.
- **Settings for the galaxy** — ribbon, the idle drift, whether unlinked notes
  are shown, and how far apart linked notes settle. Four and no more: a graph
  with a dozen sliders is one nobody ends up looking at.
- **The capture hub.** Ink Capture's gallery grew into one view for everything
  you catch rather than write: scans, drawings and spoken notes, in three tabs
  that never mix. The old view id still opens it, on the Ink tab, so a saved
  workspace is unaffected.

  Ink and Quick Sketch are tile grids. **Chatter is a list** — a spoken note has
  no picture, so the first line of the transcript takes the width a cover would
  have wasted. That is why the three are not one layout.

  One toolbar over all three: search, sort, and a select mode whose bulk actions
  replace the search row rather than stacking under it, which keeps it one line
  in a 280 px sidebar. Delete, filter, sort and multi-select — everything the
  gallery never had — arrive for all three at once. A delete names every file
  the thing is made of and asks first, by name.
- **Ink Capture can read its scans.** The recogniser Quick Sketch already used,
  pointed at captures, over as many as you select. The text goes into the note's
  **body**, not its frontmatter, so Obsidian's own search finds it — fenced by
  markers so a second reading replaces the first and never touches what you
  wrote. A PDF is read from its cached first page and says so.
- **A scan can be annotated in Quick Sketch.** The capture gains a sketch of its
  own — its id in the frontmatter, a pad in its body — rather than a sibling
  note that would be a second thing to find, tag and delete. The scan sits under
  the ink as a locked layer: not selectable, so nothing can move what you are
  drawing on. Deleting the capture takes the drawing with it.
- **A capture can have pages.** Merge two or more scans, or add a page from the
  pages dialog, and reorder or drop them there. `ink-pages` appears only once
  there is a second page, so an existing capture reads as a one-page list and is
  never rewritten, and `ink-file` keeps naming page one — an older version of
  the plugin shows the first page rather than nothing.
- **Move**, in the hub's bulk actions: the whole capture — sidecar, attachment,
  cached page — through Obsidian's own rename, so the links inside the note
  follow. A name collision is reported and left alone rather than overwritten.
  Hidden on the Sketch tab, where a sketch is found by its folder and moving one
  would quietly break it.
- **Three capture cards for the dashboard**, placed separately: Ink Capture,
  Quick Sketch and Chatter. Each is a count, the newest thing and a way into its
  hub tab — a summary and a door, never a gallery. Three cards and not one,
  because a vault that only scans and never speaks should not carry two thirds
  of an empty card.
- **A week mode for the calendar card**: one row per day, empty days included,
  the planner's line as the text and the events as a dot. The agenda mode
  answers "what is next"; this answers "what does this week look like", and a
  free Thursday is part of that answer.
- **The capture hub in the sidebar**, and a **Scratch panel** — an empty surface
  that writes the note itself, keeping the draft until you save, so a closed
  panel or a restart cannot eat a thought. Its folder and template are set from
  a gear in the panel: they are per device, and that is the only place you are
  when you care about them.
- **Chatter** — the spoken-note module has a name of its own at last, beside Ink
  Capture and Quick Sketch. Its settings key and command id are unchanged: a key
  lives in a file you already have and an id is what a hotkey is stored against,
  so renaming them would silently unbind a hotkey and buy nothing the display
  name does not.
- **The dashboard's writing pad is Scratch.** It shared the word "quicknote"
  with the module you speak into while having nothing to do with speech — half
  of why the name confused. Existing cards are migrated on load, every device
  profile included, and a title you chose is left alone.
- **The timer is an ordinary sidebar panel**, opened by *Open the timer panel*
  and closed by you. It used to open itself whenever a timer started and detach
  itself the moment none ran, which also tore away a panel you had deliberately
  opened. It keeps its own timers now, per device; a *running* dashboard timer
  is shown beside them, set back and without a remove button, because it is only
  visiting.
- **The calendar reads the planner.** A month resolves to one note holding a
  `nexus-planner` block; its line for a day shows in the month cell and can be
  typed there. Two surfaces, one store, and the plan stays plain text.
- **Every code-block feature shows the block.** Kanban, columns, the folder
  board and the folder overview each carry a real, copyable example on their own
  settings page. One helper writes the fence, so no page can get it wrong.
- **A long settings page folds into its sections.** Quick Sketch was eight
  sections and three screens; its headings are handles now. Only pages with four
  or more sections get it, and what you leave open stays open on that device.
- **Hide the attachment folder** (Settings → Explorer). Defaults to whatever
  Obsidian is set to use. The files do not move and links keep working.
- **The settings tab has a phone layout at last.** The rail and the panel become
  one drill-down column below 620 px, with a way back. The stylesheet had
  carried that layout for a long time; nothing ever switched it on.

### Changed

- **The board and the kanban board are one block.** They looked alike and were
  built on opposite ideas; now `nexus-kanban` has a `source:` key and everything
  else — head, column strip, card, the drag with its edge auto-scroll and drop
  marker, the column colours — is written once. `source: block` is what every
  board written so far already is, unchanged. `source: folder` is the old
  subject dashboard: cards are the notes of a folder, the column is the note's
  own frontmatter, and dragging writes the value back into the note, with the
  first column meaning "no value set".
- **`nexus-board` keeps rendering, in the shape you wrote it.** It is the same
  block with `source: folder` pre-set and it reads *and writes back* its own
  spellings. A board is one hand-editable text, so a save must not reshape it:
  `states: A, B, C` stays one line, `statusproperty:` stays itself, and a fence
  that never needed a `source:` line never grows one. A WIP limit is the one
  thing that forces the heading form, because a `states:` list has no room for
  it.
- **The grid and the link web moved into `nexus-graph`.** Neither has columns
  and neither writes anything back, which is why they were never a kanban board.
  `view: grid`, `view: graph`, `view: board`. An older `nexus-board` is
  delegated there, so those notes keep rendering.
- **The column-kind vocabulary is the union of both languages.** Board's red
  `fix` kind is gone: `Ausbessern`, `Fix` and `Wiederholen` now read as orange
  `wait`. That is a visible colour change for existing boards and for task-board
  columns with those names.
- **One file owns every shared number.** Radii, border width and colour, surface
  lifts, control height, field width and spacing are declared once, in a block
  identical in the theme and in the plugin. The two used to disagree, which is
  most of why the same element looked different depending on where it was drawn.
- **Two radii, 10 px and 6 px**, picked from four rendered variants. The theme
  said 15/10, but its own tablet and narrow-window blocks already overrode the
  container radius to 10 — so this makes every device draw the same corner and
  deletes those overrides rather than adding a third.
- **The Theme tab is style and palette, and nothing else.** The corner-radius
  and card-gap sliders are gone: geometry comes from the token block now, and a
  slider competing with it is how the same element ended up with a different
  corner on every page. Values anyone set are still honoured. The dashboard's
  grid sliders moved to Settings → Dashboard.
- **The settings nav and panel scroll separately.** Both used to sit in
  Obsidian's own scroller, so a long page scrolled the whole dialog.
- **A property filter is a list, not a wall of cards**, and the typography page
  dropped its arrows for two aligned columns — what you type, what you get.

### Security

- **Credentials are encrypted at rest where the operating system offers a
  keyring** (Electron `safeStorage`), so a backup of `~/.config` or a stolen
  disk cannot read them. It does **not** defend against anything running as you,
  and the settings page says so instead of showing a padlock that means more
  than it is: vault sync runs unattended, so whatever the plugin can open
  without you, so can a process in your session.

  Mobile has no keyring a plugin can reach; there a secret is stored as it was,
  and the note on that device says which of the two it is. A value encrypted on
  one machine is refused rather than misread on another.

### Fixed

- **Syncing no longer overwrites the other device's settings.** `data.json` is a
  file in the vault, so vault sync uploads it and the second device downloads it
  over its own settings, its device name included — which is why both machines
  ended up calling themselves the same thing. The connection, its schedule and
  the accounts now live under a per-device key; the file keeps syncing.
- **The dashboard no longer eats a tab at startup.** It asked the workspace for
  the current leaf and overwrote it. It now only *asks* whether that leaf is
  empty, and otherwise opens a tab of its own. Three modes and an "open it when
  the last tab closes" switch.
- **Connections are list entries**: add and remove, never edit in place, and
  removing one clears its credential — which vault sync did not do before.
- **Code blocks looked like separate strips glued together.** In Live Preview
  Obsidian puts `HyperMD-codeblock-bg` on every line of the block rather than on
  a wrapper, so a radius on it rounded all ten lines of a ten-line block
  individually. The first and last lines now carry the corners. Multi-line
  quotes had the same bug and the same fix.
- **The active file's background covered the explorer rail.**
- **A long folder list ran out of colour.** The rail's sweep normalised over
  seven positions, so from the eighth folder every rail was the same tone — and
  that tone was the darkest in the palette. It walks ten stops and turns around
  now, so no folder is ever colourless.
- **Every callout showed the same coloured dot.** The swatch was filled only
  when the colour had been overridden, which is almost never. An un-overridden
  type takes Obsidian's own colour — including the four whose variable is named
  differently from the callout.
- **A folder board grew a `tags: false` line nobody wrote.** `tags` is a card
  flag on a block board and a `show:` flag on a folder board; the serialiser
  emitted it in both places.
- **The plugin rendered with no borders under any theme but Nexus.** The
  hairline token's fallback pointed at a variable Obsidian declares on `body`,
  while the token itself is declared on `:root` — so the substitution failed
  there and the empty result inherited past the point where the variable exists.

### Removed

- **Focus mode, writing sprints and editorial blocks.** Unused. What they were
  and how to bring them back is in `docs/removed-features.md`, with the commit.
- **The CalDAV half of the calendar** — the network client, remote accounts,
  calendar mirroring and VTODO sync. Local calendars, the full-page view, both
  sidebar views, the pinnable tab and Vikunja all stay.

## 0.26.1 — 2026-09-01

### Fixed

- **The second device could not receive the vault.** Syncing appeared to work —
  and on the device that *uploads* it did — but the device downloading a vault
  it does not have yet failed on every file in a folder deeper than one level,
  over and over, because a file that never arrives never enters the state that
  says it did. `adapter.mkdir` is not the same call on both platforms: asked for
  `Tasks/Items` where `Tasks` does not exist, the desktop creates both and the
  mobile adapter refuses. The sync now builds a local path a segment at a time,
  the way the rest of the plugin already did. Reproduced in the test harness
  against a mobile-style adapter, so it stays fixed.
- **A folder on the server is created once per run, not once per file in it.** A
  first upload of a vault with a few hundred folders spent thousands of requests
  re-creating folders it had just made — slow everywhere, and on a server that
  rate-limits, a wall of failures with nothing to do with the files.

### Added

- **Settings → Vault sync → The last run.** What the last sync did, the first
  five failures in full, and a *Sync* button that reports right underneath.
  Every failure — not only those five — now also goes to the console as
  `[Nexus] sync failed on "<path>": <reason>`. Until now a failed run left a
  Notice that was already gone and nothing else to look at, which is no way to
  find out why a sync is failing on a tablet.

## 0.26.0 — 2026-08-31

### Changed

- **A kanban card opens an editor, not a rename box.** Clicking a card asked for
  its name and nothing else — and once a note was linked it opened the note
  instead, so a card with a note was the one thing on the board that could not
  be edited. One click now opens the whole card: text, description, due date,
  tags, done, which column it is in, and the note it points at with **To the
  note** as a button. Ctrl/⌘-click still goes straight to the note.
- **A card can carry a description.** Indented lines under the card line in the
  block are its own text and are shown under the title on the board — four lines
  at most, the rest cut off with an ellipsis. It stays a hand-editable block: the
  description is written back indented under its card, and an indented checklist
  line is still a card of its own.
- **The default columns are English.** They were `Backlog / In Arbeit /
  Erledigt` — a German default in an English plugin, and stored in `data.json`
  the first time anything saved, so changing the default alone would have left
  every existing vault on them. An untouched set is rewritten once to
  `Backlog / In progress / Done` (task board: `… / Waiting / Done`); columns
  anybody picked are theirs and are never renamed. A column whose name reads as
  done still completes a card in German, English or anything else.
- **The new-card row has no + in front of it** — on either board. The dashed row
  and the placeholder already say what it is.
- **QuickNote is written Quick Note**, like Quick Sketch and Ink Capture. The
  folder default (`Inbox/Quicknote`) is unchanged, because it is a path in your
  vault and not a label.
- **Vault sync and Quick Note left the "Drawing" settings group.** Neither draws
  anything. The group is now **Capture** — Quick Sketch, Ink Capture, Quick Note,
  all three "get the thing into the vault before it is gone" — and Vault sync
  sits with the other tools that act on the whole vault.

### Fixed

- **Quick Note said what it needs *after* the recording, not before.** With the
  local engine on a phone or tablet there is no shell to run a recogniser in, so
  you could speak a paragraph, wait, and then be told to switch engines — with
  the recording already gone. The recorder now refuses to start and says why,
  and a command naming a program that is not installed reports that by name
  instead of `spawn whisper-cli ENOENT`.

## 0.25.1 — 2026-08-31

### Fixed

- **Quick Sketch could not be zoomed.** In a note and in a slate note the pinch
  was never recognised at all: both fix the viewport so the note scroller does
  the scrolling, and the gesture was gated on that same flag. Fixing the
  viewport now only rules out *panning* it — pinching magnifies the sheet, from
  0.3× to 5×. A zoomed block scrolls sideways so the right-hand edge of the
  drawing stays reachable, and a pill in the corner shows the level and returns
  to 100% on a tap.
- **Native Obsidian controls ignored the palette.** A menu, a suggestion list, a
  checkbox, a toggle, a slider and a focus ring are painted by Obsidian from
  `--accent-h/-s/-l` — three numbers it takes from the accent picker, not from
  the theme — so they stayed on its default blue-violet while everything else
  followed the palette. The palette now hands those numbers over, converted from
  its own accent, and the dynamic wallust palette does the same by reading its
  live accent back off the page. Needs Nexus theme 0.7.1, which stops leaving
  the rest of Obsidian's variables unset.

## 0.25.0 — 2026-08-31

The release that works through `plan.md`: Quick Sketch becomes a notes app, the
kanban board stops losing edits, and the vault can live on your own server.

:::note
None of this has been run inside Obsidian yet. It is verified against a real DOM
with a stubbed Obsidian API (604 checks), and the PDF, the ZIP and the OCR
pipeline are checked against `qpdf`, `unzip` and `tesseract` — but icons, touch,
the tablet pen, the WebDAV round trip and the microphone still need a pass in the
app. This release exists so that pass can happen on the tablet.
:::

### Added

**Quick Sketch**

- **A toolbar you arrange yourself.** The tool row now has an options row under
  it holding whatever the active tool needs. Which buttons live in the bar and
  which in the `⋯` menu is yours to set, separately for a note and for the
  full-size editor — and separately per device.
- **Every tool keeps its own colour**, and can be put on its own palette.
- **Select**: lasso, rectangle or ellipse. Move, scale and rotate what you
  caught, recolour it, duplicate it, delete it. A shape recognised by holding
  the pen still keeps its description, so it can be re-cornered later instead of
  only scaled as a block.
- **Spacing**: drag a line down to open blank paper, up to close it again.
- **Insert**: images (embedded, so the file stays standalone), sticky notes and
  eight stickers.
- **Ruler**: a straight edge the pen slides along, free or locked to 0/45/90/135
  degrees.
- **Outline**: named marks down the page, and a list to jump between them —
  what an endless sheet needs instead of headings.
- **Export** as SVG, PNG or PDF.
- **Search sketches**, over the title, section names and sticky notes of every
  drawing. Handwriting is added on top by a recogniser you install yourself.
- **Pen buttons**: the side button, the eraser end and a double-tap, each mapped
  to an action, with presets per pen.
- **Slate notes** can hide the properties block and the app chrome.

**Elsewhere**

- **Any note can be a task.** `nexus-task: true` in the frontmatter puts it in
  the tasks view without moving it or making a second note.
- **A planner.** A ` ```nexus-planner ` block is a month on one screen with one
  line per day, for the thing daily notes are too detailed for.
- **Vault sync.** The whole vault to a WebDAV server, three-way, with a daily
  backup zip and conflict copies that never discard work. Runs on mobile.
- **QuickNote.** Speak a note instead of typing it.

### Fixed

- **A kanban board accepted one card and then silently ignored everything.**
  Adding a second card, renaming one, linking a note or setting a due date all
  appeared to work and changed nothing. The board could not find itself in the
  note again after Obsidian re-rendered it; it now finds itself by its content.
- **The options row was rebuilt on every colour tap**, tearing it out from under
  the finger that was tapping it.
- **A `]]>` in a section title or a sticky note truncated a sketch file** and
  left it unparseable.

### Changed

- **Scrolling in a sketch now coasts** after your finger lifts, like the note
  around it.
- **Zoom runs from 0.3× to 5×**, so a long page has an overview.
- **The sheet has a fixed width** (1100 px by default). That is what stops a
  tablet turned to landscape from rendering the same note at a bigger ink size.
- **On a phone the card layout is removed rather than shrunk**, and on a tablet
  it keeps its border but loses the shadow and half the gap.
- The theme's comments are now English throughout.

### For developers

- `./test/run.sh` — thirteen pages, ~604 checks, driven in headless Chromium
  against a real DOM with a stubbed Obsidian API.
- New modules: `lib/sketchselect`, `sketchcanvas`, `sketchobjects`,
  `sketchgestures`, `sketchexport`, `sketchsearch`, `blockedit`, `extcommand`,
  `planner`, `quicknote`, `vaultsync`, `vaultsyncrun`, `webdav`, `zip`.
- Documentation moved to its own repository:
  [nexus-suite-wiki](https://github.com/vredix-openvuture/nexus-suite-wiki).
