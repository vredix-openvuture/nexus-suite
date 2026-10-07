# Book capture — design

Date: 2026-10-07 · Status: approved in chat, awaiting spec review

Scan or type an ISBN, look the book up in public catalogues, and create a note
from a template the user picked — cover image downloaded into the vault. Also
fills the empty fields of a note that already exists.

## Principle

Nothing about the user's library is hardcoded. Only the barcode scanner and the
set of placeholder names are fixed. Template, folders, file names, sources and
the duplicate key all come from settings, per profile.

## Settings

A new module **Book capture** in the *Capture* group, off by default.

- **Profiles** — a list; each profile has:
  - `name` (shown when picking a profile, e.g. "Book", "eBook", "Audiobook")
  - `template` — path of any note in the vault used as the template
  - `folder` — where new notes go
  - `coverFolder` — where cover images go
  - `fileName` — pattern for the note, default `{{title}}`
  - `coverName` — pattern for the cover, default `{{title}}`
  - `isbnProperty` — frontmatter key holding the ISBN, used for the duplicate
    check and for fill mode (empty = no duplicate check by ISBN)
  - `coverProperty` — frontmatter key holding the cover link, used by fill mode
- **Sources** — global ordered list, each on/off: DNB (Deutsche
  Nationalbibliothek), Open Library, Google Books. Order decides which source
  wins a field. Default order is that one.
- **Google Books API key** — per device, through the plugin's credential store
  (never in data.json). Google answers anonymous requests with HTTP 429
  (`quota_limit_value: 0`, checked 2026-10-07), so without a key the Google
  source is skipped and the settings say so.
- **This device** — a status line: camera available, `BarcodeDetector`
  available. Shows a user why the scanner falls back before they try it.
- **Create example template** — button that writes a starter template note
  with every placeholder, so a new user has something to edit.
- The settings page validates each profile: template exists, folders exist,
  and lists placeholders in the template that are unknown.

Defaults: one profile "Books" with empty template/folders; the command refuses
with a notice until a template is set.

## Placeholders

Fixed set: `isbn, title, subtitle, author, authors, publisher, year, pages,
language, description, genres, cover, date`.

- `{{author}}` is all authors joined with `, `; `{{authors}}` is the list.
- `{{date}}` is today, `YYYY-MM-DD`.
- `{{cover}}` is the vault file name of the downloaded cover (for `[[…]]`/`![[…]]`).
- `{{authors}}` and `{{genres}}` are lists. On a YAML list line (`  - {{genres}}`)
  the line is repeated once per item; inline they join with `, `.
- `{{ask:Label|a,b,c}}` — choice asked in the preview dialog.
  `{{ask:Label}}` — free text asked in the preview dialog.
  The same label used twice is asked once.
- Fields no source delivers become empty. A YAML list line whose value is empty
  is dropped.
- Values inside frontmatter are YAML-escaped (quotes when needed).
- Unknown placeholders are left as written (and flagged in settings).

## Components

| File | Job |
|---|---|
| `src/lib/ean13.js` | decode EAN-13 from a luminance row; checksum; ISBN-10 ↔ 13 (pure) |
| `src/lib/bookscan.js` | camera stream, `BarcodeDetector` when available, else `ean13.js` over several scanlines per frame |
| `src/lib/booksources.js` | one adapter per source → `{title, subtitle, authors[], publisher, year, pages, language, description, genres[], covers[]}`; merge by source order |
| `src/lib/booktemplate.js` | placeholder engine (pure) |
| `src/modals/bookcapture.js` | profile pick → scanner → preview dialog → create / fill |
| `src/settings.js` | the Book capture section |

Scanner input paths: live camera, photo upload (`<input type=file capture>`),
typed ISBN. Only codes that pass the checksum and start with 978/979 count.

## Data flow — create

Command "Capture book" (+ ribbon icon, also reachable on mobile).

1. Pick a profile when there are several; last used is preselected.
2. Scan / type / photo → ISBN-13.
3. Duplicate check: notes in the profile folder whose `isbnProperty` equals the
   ISBN (ISBN-10 values normalised). Hit → "Already exists: open / fill / create anyway".
4. Query all enabled sources in parallel, 8 s timeout each, via `requestUrl`.
   Per field the first source in settings order that has it wins; covers from
   all sources are collected.
5. Preview dialog: editable fields, cover carousel, the `ask` fields.
   Covers are downloaded into memory while the dialog opens, so the carousel
   only ever shows images that actually loaded. The last carousel slot is
   always **Own image**: pick a file from the device, pick an image already in
   the vault, or paste an image URL.
6. "Create" stays disabled until a cover is chosen — when the template uses
   `{{cover}}` at all. Then: write the chosen image bytes to `coverFolder`,
   extension from the real content type; render the template; write the note
   to `folder`; open it. Name collisions get ` (2)`, ` (3)` — never overwrite.
   File names are stripped of characters Obsidian rejects.

## Data flow — fill

Command "Fill book from ISBN" on the active note.

- ISBN from `isbnProperty`, else scan.
- Preview shows only template properties that are empty or missing in the note,
  each with a checkbox. Existing values are never overwritten.
- The cover is offered only when `coverProperty` is empty or points to a
  file that does not exist — same carousel with **Own image** as in create.
- Writes go through `processFrontMatter`; the body is never touched.
- Profile = the one whose `folder` contains the note, else asked.

## Sources

- Google Books — `googleapis.com/books/v1/volumes?q=isbn:<isbn>&key=<key>`.
- Open Library — `openlibrary.org/api/books?bibkeys=ISBN:<isbn>&jscmd=data&format=json`,
  cover `covers.openlibrary.org/b/isbn/<isbn>-L.jpg?default=false`.
- DNB — SRU `services.dnb.de/sru/dnb` with `num=<isbn>`, MARC21-xml; cover via
  `portal.dnb.de/opac/mvb/cover?isbn=<isbn>` (200 image/jpeg for a German
  title, 404 otherwise — checked 2026-10-07). Open Library did not know the
  German test title; DNB did not know the English one. Both are needed.

## Errors

- No camera or permission denied → scanner pane shows the typed and photo
  input instead, with one line saying why.
- No source has the book → preview opens with only the ISBN filled; the note
  can still be created by hand.
- A source fails or times out → its name is shown as unavailable; the others count.
- No cover could be loaded from any source → the carousel opens on **Own
  image** with one line saying so. A note is never created with a missing or
  broken cover; the cover is already in memory when "Create" is pressed, so
  writing it cannot fail on the network.
- Template missing → notice naming the path, nothing written.

## Tests (`test/bookcapture.html` in `./test/run.sh`)

- EAN-13: synthetic barcodes drawn to canvas, with scale, blur, noise and slight
  tilt; wrong checksum rejected; ISBN-10 ↔ 13.
- Source adapters against recorded JSON/XML fixtures from each API; merge order.
- Template: YAML escaping, list-line expansion and dropping, `ask` dedup,
  unknown placeholders kept.
- Fill: only empty fields offered; nothing overwritten.
- Cover: all sources failing → dialog lands on Own image and Create is
  disabled until an image is chosen; own file / vault image / URL each end up
  as the written cover.
- Duplicate detection with ISBN-10 and ISBN-13 values; file name collision.

## Unverified until run on a device

- Whether Obsidian mobile grants `getUserMedia` camera access. Checked first,
  with a probe, before the scanner UI is built; the photo and typed paths work
  regardless.
- Whether the Android WebView exposes `BarcodeDetector`.

## Not in this version

Batch scanning a whole shelf; non-ISBN barcodes; per-profile source order.
