# Changelog

Grouped by what changed for you, not by commit. Newest first.

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
