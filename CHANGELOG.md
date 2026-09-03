# Changelog

Grouped by what changed for you, not by commit. Newest first.

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
