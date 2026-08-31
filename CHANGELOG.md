# Changelog

Grouped by what changed for you, not by commit. Newest first.

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
