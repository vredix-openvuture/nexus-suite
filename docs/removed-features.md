# Removed features

What was taken out of Nexus Suite, and everything needed to put it back. Nothing
here was broken — these are features that were dropped because they were not
used, not because they failed.

The last commit in which every file listed below still existed in full:

```
98c5f6ee43fbe0b1bf554fc34f21797ef3575681
```

To read any deleted file at that point:

```sh
git show 98c5f6ee43fbe0b1bf554fc34f21797ef3575681:src/lib/focus.js
```

---

## 1. Focus mode

Dimmed everything in the editor except the line (or paragraph) the cursor was
on, optionally scrolled that line to a fixed height (typewriter scrolling), and
synthesised a keystroke click through the Web Audio API. Editing only — reading
view has no cursor to focus on. No CodeMirror extension anywhere: the dimming
rode on CM's own `.cm-active` line class, paragraph scope was walked in the DOM,
and the scrolling moved `.cm-scroller` directly.

**File:** `src/lib/focus.js` (187 lines, `class NexusFocus`, exported as
`{ NexusFocus }`).

**Settings key** `focus` in `DEFAULT_SETTINGS` (`src/constants.js`):

```js
focus: { enabled: false, dim: true, scope: 'line', dimOpacity: 45,
         typewriter: false, typewriterOffset: 50,
         sound: false, soundStyle: 'soft', soundVolume: 25, bell: false },
```

`scope` was `'line' | 'paragraph'`, `soundStyle` was `'soft' | 'mechanical'`.

**Command:** `nexus-toggle-focus` — "Toggle focus mode".

**Body classes / custom properties:** `nx-focus`, `nx-focus-para` (both on
`document.body`), `nx-focus-in` (per line, added by `markParagraph`),
`--nx-focus-dim` (the dim opacity as a 0–1 fraction).

**Module table entry** (`NX_MODULES` in `src/constants.js`):

```js
focus: { name: 'Focus', sub: 'Dims everything but the line you are writing' },
```

**Settings tab:** method `tFocus(e)` in `src/settings.js`, reached from the nav
row `{ id: 'focus', icon: 'crosshair', fn: (e) => this.tFocus(e) }` in the
group "In the note". The volume slider had a *Try it* button that called
`plugin.focus.click()` with `sound` forced on for one shot.

**Wiring in `src/main.js`:** the require, one `_guard('focus', …)` call in
`onload()` (under the comment `// ── Writing aids: focus mode, sprints,
editorial blocks ──`) and `if (this.focus) this.focus.unload();` in `onunload()`.

**CSS:** the first block of `src/styles/15-writing.css` (whole file deleted).

**Cross-module coupling:** the writing sprint could switch focus mode on for the
duration of a run (`sprint.focusDuringSprint`) and restore it afterwards.

---

## 2. Writing sprint

A timed writing run against a word goal. The run lived on the plugin instance,
not on a view, so it survived switching notes or closing the tab. Words were
counted as a **delta per file** against the count when the sprint first saw that
file: only what you added counted, deleting took it away again, and switching
notes kept adding to the same total. Frontmatter and code fences were stripped
before counting, and a token had to start with a letter or digit so bare list
dashes did not inflate the score. Progress showed in the status bar; clicking it
stopped the sprint. A summary modal reported words, time and words per minute.

**File:** `src/lib/sprint.js` (228 lines). Exported
`{ NexusSprint, NexusSprintStartModal, countWords }` — it also contained
`NexusSprintDoneModal` (not exported).

**Settings key** `sprint`:

```js
sprint: { enabled: true, minutes: 15, words: 300, useTime: true, useWords: true,
          statusBar: true, focusDuringSprint: false, doneMessage: '' },
```

**Commands:** `nexus-start-sprint` — "Start a writing sprint";
`nexus-stop-sprint` — "Stop the writing sprint".

**CSS classes** (all in `src/styles/15-writing.css`): `.nx-sprint-bar` (the
status-bar item, plus `.is-done`), `.nx-sprint-icon`, `.nx-sprint-time`,
`.nx-sprint-track`, `.nx-sprint-fill`, `.nx-sprint-count`, `.nx-sprint-modal`,
`.nx-sprint-row`, `.nx-sprint-label`, `.nx-sprint-num`, `.nx-sprint-unit`,
`.nx-sprint-bar-actions`, `.nx-sprint-done`, `.nx-sprint-stats`,
`.nx-sprint-stat`, `.nx-sprint-stat-num`, `.nx-sprint-stat-label`,
`.nx-sprint-msg`.

**Module table entry:**

```js
sprint: { name: 'Sprint', sub: 'Timed writing against a word goal' },
```

**Settings tab:** method `tSprint(e)` in `src/settings.js`, nav row
`{ id: 'sprint', icon: 'timer', fn: (e) => this.tSprint(e) }` in the group
"Tools".

**Wiring in `src/main.js`:** require, `_guard('sprint', …)`, and
`if (this.sprint) this.sprint.unload();` in `onunload()`.

---

## 3. Editorial blocks

Margin notes, pull quotes, drop caps, ornamental dividers and the alternate
checklist-state icons — the page furniture a printed book has and a plain
markdown note does not. Each was its own switch, and each was pure CSS gated by
a body class, so turning one off cost nothing at runtime and never touched the
note text. Margin note, pull quote and ornament were **ordinary callout types**
(`> [!margin]`, `> [!pullquote]`, `> [!ornament]`), so a note kept rendering
without the plugin instead of turning into broken syntax.

**File:** `src/lib/editorial.js` (102 lines, `class NexusEditorial`).

**Settings key** `editorial`:

```js
editorial: { enabled: true, margin: true, marginWidth: 200, pullquote: true,
             dropcap: false, ornament: true, ornamentGlyph: '❦', taskStates: true },
```

**Commands:**

| id | Name |
|---|---|
| `nexus-insert-margin` | Insert a margin note |
| `nexus-insert-pullquote` | Insert a pull quote |
| `nexus-task-state` | Set the checklist state |
| `nexus-insert-ornament` | Insert an ornamental divider |

`nexus-task-state` opened a menu of the states below and rewrote every touched
line: a task line got its character swapped, a plain line became a task line, so
it doubled as "make this a task".

**Body classes / custom properties:** `nx-ed-margin`, `nx-ed-pullquote`,
`nx-ed-dropcap`, `nx-ed-ornament`, `nx-task-states`, `--nx-ed-ornament` (the
glyph, quoted, for `content:`), `--nx-ed-margin-w`.

**Module table entry:**

```js
editorial: { name: 'Editorial', sub: 'Margin notes, pull quotes, drop caps, ornaments' },
```

**Settings tab:** method `tEditorial(e)` in `src/settings.js`, nav row
`{ id: 'editorial', icon: 'pilcrow', fn: (e) => this.tEditorial(e) }` in the
group "In the note". It rendered a live legend of every checklist state using
the same markup a note gets (`.nx-task-legend`, `.nx-task-legend-item`,
`.nx-task-legend-ch`, `.nx-task-legend-lbl`).

**Wiring in `src/main.js`:** require, `_guard('editorial', …)`, and
`if (this.editorial) this.editorial.unload();` in `onunload()`.

**CSS:** the editorial half of `src/styles/15-writing.css` and the whole of
`src/styles/19-task-states.css` (90 lines — every rule was gated on
`body.nx-task-states`, which only `editorial.js` ever set). Both files deleted,
along with their `@import` lines in `src/styles/index.css`.

### The `TASK_STATES` table

Lived in `src/constants.js` and was exported. Its only two consumers were
`editorial.js` (the command menu) and `settings.js` (the legend), so it went
with them. The character is what goes between the brackets; Obsidian puts it on
the line as `data-task` and the CSS turned it into an icon. Order is how the
states were offered in the command.

```js
const TASK_STATES = [
  [' ', 'Open'], ['x', 'Done'], ['/', 'In progress'], ['>', 'Forwarded'], ['<', 'Scheduled'],
  ['!', 'Important'], ['?', 'Question'], ['-', 'Cancelled'], ['*', 'Star'], ['"', 'Quote'],
  ['l', 'Location'], ['b', 'Bookmark'], ['i', 'Information'], ['I', 'Idea'],
  ['p', 'Pro'], ['c', 'Con'], ['u', 'Up'], ['d', 'Down'],
  ['f', 'Fire'], ['k', 'Key'], ['w', 'Win'], ['S', 'Amount'],
];
```

---

## 4. The CalDAV network layer

Server calendars over CalDAV (RFC 4791): discovery, an event mirror pulled into
the vault cache, write-through PUT/DELETE for events, and a full two-way VTODO
task sync. Desktop only — it ran behind the `require('fs')` guard and used
Obsidian's `requestUrl` to bypass CORS and send WebDAV methods.

**What stayed:** everything that is not the network. The full-page calendar view
(`CAL_PAGE_VIEW`), its ribbon icon, its pinnable tab-bar entry, local calendars,
the event modal, RRULE expansion (`src/lib/recur.js`), the tasks page, and the
whole Vikunja task sync. The settings module is still called `tasksCalendar` in
`data.json`; only its display name changed to "Calendar".

### `src/lib/caldav.js` — deleted whole

197 lines, `class CalDavClient`, exported as `{ CalDavClient }`. Flows were
ported from velumeron's `caldav-client.py`; XML was queried by `localName` so
the namespace prefix (`d:` / `D:` / `dav:`) did not matter across servers.

| Method | What it did |
|---|---|
| `constructor({serverUrl, username, password})` | Basic auth header, base64 via `btoa(unescape(encodeURIComponent(s)))` |
| `req(method, url, {headers, body, depth})` | `requestUrl` with `throw:false`, follows up to 3 redirects manually |
| `discover()` | principal → calendar-home-set → calendar collections |
| `_findPrincipal()` | PROPFIND `current-user-principal`, falls back to `/.well-known/caldav` |
| `_findHomeSet(principalUrl)` | PROPFIND `calendar-home-set` |
| `_listCalendars(homeUrl)` | PROPFIND Depth 1; returns `{href, display, color, component, ctag, syncToken}`; `component` is `VTODO` only when the collection supports VTODO and not VEVENT |
| `getCtag(calHref)` | cheap change gate: `{ctag, syncToken}` |
| `listComponents(calHref, comp, start, end)` | `calendar-query` REPORT with an optional time-range → `[{href, etag, ics}]` |
| `syncCollection(calHref, syncToken)` | `sync-collection` REPORT → `{changed, removed, syncToken}` (never wired up to a caller) |
| `putResource(url, ics, etag)` | `If-Match` on update, `If-None-Match: *` when `etag === null` |
| `deleteResource(url, etag)` | `If-Match` when an etag is known |

### `src/lib/calstore.js` — partly cut

Removed: `remoteDir(plugin, accId)`, `syncAccount(plugin, account, client)`, the
remote-mirror loop at the top of `loadCalendars()`, `writeRemoteEvent(plugin,
cal, ev, client)` and `deleteRemoteEvent(plugin, cal, ev, client)`, plus those
five names from `module.exports`.

The on-disk layout was:

```
<dataDir>/calendar/remote/<accountId>/<calendarId>.json   server mirror (desktop-owned)
<dataDir>/calendar/local/<calendarId>.json                local calendars (offline)
```

A mirror file looked like:

```json
{ "schema": 1, "kind": "remote", "accountId": "acc-…", "calendarId": "…",
  "href": "https://…", "display": "…", "color": "#…",
  "component": "VEVENT", "readOnly": true, "ctag": "…", "events": [ … ] }
```

`syncAccount` pulled a window of −60 to +400 days, skipped a calendar whose
`ctag` had not moved, and parsed each resource with `ical.parseResource`.
`writeRemoteEvent` was an immediate ETag-guarded PUT: `If-Match` on update (412
→ `{conflict:true}`, caller re-pulls), `If-None-Match: *` for a new event, then
the same event was written into the mirror file.

`loadCalendars` still loads the local calendars; the removed half walked
`<dataDir>/calendar/remote/<accountId>/` for every account and pushed each JSON
file it found. **Any `calendar/remote/` tree left in a vault is now inert data —
it is neither read nor deleted.**

### `src/lib/ical.js` — the serializer half removed

The parser stays (`unfold`, `parseLine`, `parse`, `parseResource`,
`normalizeEvent`, `normalizeTodo`, `parseWhen`, `whenToMoment`,
`unescapeText`). Removed, because CalDAV PUT was their only caller:
`serializeEvent(ev, moment)`, `serializeTodo(task, moment)` and their private
helpers `escapeText`, `foldLine` (75-octet line folding), `whenProp`,
`nowStamp`.

### `src/lib/sync.js` — the VTODO half removed

Removed: `vtodoDue(vt)`, `syncCaldavTodos(plugin, account, ical, client)` (the
whole two-way VTODO sync — each enabled VTODO calendar became a project note,
tasks became task notes, ETag was the remote tag), the `'cd-'` arm of
`taskKey(provider, id)`, the `account.kind === 'caldav'` branch of
`applyResolution` (which serialized the local task and force-PUT it), the
`ical` require, and `syncCaldavTodos` from `module.exports`.

`taskKey` was:

```js
function taskKey(provider, id) { return (provider === 'caldav' ? 'cd-' : 'vk-') + String(id).replace(/[^\w.-]+/g, '_'); }
```

The pure `reconcile()` core, the base index, the conflict records and everything
Vikunja are untouched — `syncCaldavTodos` used the same `reconcile()`.

### `src/modals/account.js` — now Vikunja only

The class is still `NexusAccountModal` and the file still exists (Vikunja needs
it). Removed: the `CalDavClient` require, the account-type dropdown (there is
only one kind left), `_renderCaldav()` (server URL / username / app password /
"Connect & discover"), `_discover(btn)`, `_renderCalendars()` and the
`'CalDAV'` label fallback in `_save()`.

Two things guard the leftovers. The constructor no longer clones the whole
account object — it copies only `{id, kind:'vikunja', label, serverUrl}`, so a
save can never write `username`, `principalHref`, `homeSet` or `calendars[]`
back into `data.json`. And an account whose stored `kind` is not `'vikunja'`
opens as a dead end (`this.legacyKind`): the modal says the kind is gone and
offers only *Close*, because its URL is a DAV path and its secret an app
password, so editing it into a Vikunja account would produce one that fails at
every sync. To restore CalDAV, both guards have to come out, along with the
`acc.kind !== 'vikunja'` skip in `syncTaskCal()`.

Discovery wrote back onto the account object:

```js
this.acc.principalHref = res.principalHref;
this.acc.homeSet = res.homeSet;
this.acc.calendars = res.calendars.map(c => Object.assign(c, { id: c.href, enabled: prev[c.href] != null ? prev[c.href] : true }));
```

CSS that went dead with it, in `src/styles/13-calendar-page.css`:
`.nx-account-cals`, `.nx-account-cal`, `.nx-account-swatch`,
`.nx-account-calname`, `.nx-account-badge`. `.nx-account-empty` stays — the
Vikunja account list and the local-calendar list still use it.

### `src/modals/event.js` — local calendars only

Removed: the `CalDavClient` require, `_remoteClient(cal)` (the fs guard, the
account lookup and the credential lookup that built a client), the remote branch
of `_save()` and of `_delete()`. `calTok(c)` lost its `'remote:'` arm, the
calendar list no longer accepts `kind === 'remote'`, and the dropdown no longer
appends `"  (server)"`.

### `src/views/calendarpage.js`

`calKey(c)` lost its `'remote:'` arm — it now reads
`c.kind === 'tasks' ? 'tasks:due' : 'local:' + c.calendarId`. **Any
`hiddenCalendars` entry starting with `remote:` in `data.json` is now dead but
harmless.** The calendar-panel row no longer branches on `kind === 'remote'`,
and the two hint strings that named CalDAV were rewritten. The Sync button
stayed — Vikunja tasks still sync through it.

### `src/main.js`

Removed: the `CalDavClient` require, the `ical` require (its only use was
handing `ical` to `syncCaldavTodos`), and the CalDAV `else` branch inside
`syncTaskCal()`. `syncTaskCal()` itself, `credKey`/`getCredential`/
`setCredential`, `refreshCalendarViews()` and `migrateCalendarData()` all stay.

`syncTaskCal()` gained a guard that skips any account whose `kind` is not
`'vikunja'` and reports it in the result lines, so an account left over from
CalDAV says what is wrong instead of handing a CalDAV URL to `VikunjaClient`.
That guard is what a CalDAV re-add would have to relax.

### `src/constants.js`

`accounts`, `syncOnStartup`, `syncIntervalMin` and `conflictPolicy` all **stay**
inside `tasksCalendar` — Vikunja accounts live in the same `accounts` array and
Vikunja syncs on the same schedule with the same conflict policy. What changed
is only the account shape: `kind` is now always `'vikunja'`, and
`principalHref`, `homeSet`, `username` and `calendars[]` are no longer written
by anything. The old shape was:

```js
accounts: [], // {id,kind,label,serverUrl,username,principalHref,homeSet,
              //  calendars:[{id,href,display,color,component,enabled,ctag,syncToken}]}
```

Two `NX_MODULES` display names were changed so the two calendar modules can be
told apart. The settings **keys** were not touched — `data.json` in the dev
vault holds live user data.

| Key | Before | After |
|---|---|---|
| `tasksCalendar` | `CalDAV` · "Server accounts, local calendars, events and tasks" | `Calendar` · "Local calendars, events and tasks — the full-page view" |
| `calendar` | `Calendar` · "Month view over your daily notes" | `Mini calendar` · "Month grid over your daily notes, in the sidebar" |

### `src/settings.js`

`tTasksCalendar` kept "Sync on startup", "Sync interval" and "Conflict policy" —
Vikunja uses all three. The accounts section is still there; only its heading,
its empty-state text and the CalDAV-specific fallback label changed.

---

## 5. Slate mode and the full-size editor

Two ways of drawing that both did what the Sketch tab does, in a worse place.

**Slate mode** turned a whole markdown note into endless paper: a note with
`nexus: slate` in its frontmatter kept its title, properties and banner, and the
plugin injected a drawing surface below them, into the note's own scroll
container. **The full-size editor** was a full-window overlay reached from a
`quicksketch` block's `⛶` button; it re-parented the block's live pad into
itself so no drawing state had to be copied.

**Why they went:** in a slate note the toolbar was sticky but the options row
under it was not, so changing colour meant scrolling back to the top of the
note; and a magnified sheet had nowhere to go sideways, because the note's own
scroller was pinned to `overflow-x: hidden` to stop the full-bleed strip
spilling. Both are structural, and both are answered for free by a drawing that
lives in its own tab. Two big canvases with two sets of geometry bugs became
one.

**What replaced them:** frontmatter `sketch: <id>` on any note, a corner button
(`.nx-sketch-open`) that opens that drawing in the Sketch tab, and the tab's own
`file-text` button as the way back. **No data migration:** the sidecar store,
the ids and the `sketch:` frontmatter key are unchanged, so every drawing made
in a slate note opens in the tab. A leftover `nexus: slate` line is inert.

The last commit in which all of this still existed in full:

```
d5cf931
```

### `src/main.js` — removed

| Removed | What it did |
|---|---|
| `updateProtokoll(view)` | per-view driver off the `refreshBanner()` wiring: set `nx-pk-note`, picked the reading-view sizer or the CM sizer, and injected/removed `.nx-pk-inline` |
| `_pkObserve(view)` | a `MutationObserver` on `view.contentEl` that re-injected the surface after Obsidian re-rendered, debounced 300 ms |
| `mountProtokollSurface(host, file, scroller)` | built the bar and pad, assigned the sidecar id up front (a mid-draw frontmatter write would have interrupted the stroke), resolved the paper from `sketch-bg`, and ran `syncGeom()` |
| `syncGeom()` (inside it) | published `--nx-pk-w`, `--nx-pk-off`, `--nx-pk-top` and `--nx-pk-barh` on `.view-content`, measured off the note's scroll container, under a `ResizeObserver` |
| `toggleSlate(file)` | flipped the `nexus: slate` frontmatter |
| `mountSlateControl(view)` | the corner button, as an on/off toggle |
| `_openSketchFullscreen(surface, pad, wrap, s, rebuildInlineBar)` | the overlay: moved the pad into `.nx-sketch-fs`, gave it a `full` toolbar, endless paper, a zoom pill and an Escape key handler, then moved the pad back and rebuilt the inline bar |

Commands `nexus-toggle-slate` ("Toggle slate mode") went with them.
`nexus-new-protokoll` kept its id — renaming it would have dropped anyone's
hotkey — but is now "New sketch note" and calls `createSketchNote()`.

`_activeSketchSurface()` looked for `.nx-sketch-fs .nx-sketch-pad` first and
`.nx-pk-inline` last; it now asks the workspace for an open Sketch tab.

`_buildSketchBar` lost `opts.slate` (which skipped the auto-extend toggle,
because a slate note grew on its own) and `opts.onFullscreen`.

### `src/views/sketch.js` — `fixedViewport` removed

`opts.fixedViewport` existed for slate paper only: no viewBox pan, no sideways
scroll and no sideways fling, because the note's scroller owned the vertical and
nothing owned the horizontal. Nothing sets it any more. It gated four places:
the fling's `vx`, the fling step's `scrollLeft`, the pinch/scroll decision in
`_applyGesture`, and the drag's `scrollLeft`.

### `src/constants.js` — settings removed

```js
hideFrontmatter: false,   // slate notes: hide the properties block above the paper
immersive: false,         // slate notes: hide tab bar, status bar and ribbon while one is open
```

Both sat in `DEFAULT_SETTINGS.quicksketch`. **Left in `data.json` they are
dead but harmless.** Their two settings toggles came out of `src/settings.js`
("Slate notes: hide properties", "Slate notes: hide the app chrome").

Frontmatter `sketch-bg: black` — a per-note paper override, read by
`mountProtokollSurface` and written back by the paper picker — is no longer read
by anything. The paper now travels in the sidecar, where it always also was.

### `src/styles/12-sketch.css` — removed

The whole `PROTOKOLL` block at the head of the file (about 60 lines): the
`.nx-pk-note` content-collapse and text-hiding rules, `.nx-pk-inline` with its
measured full-bleed width, the sticky `.nx-pk-bar` docked at
`calc(-1 * var(--nx-pk-top))`, the corner-button offset derived from
`--nx-pk-barh`, `.nx-pk-pad`, and the `overflow-x: hidden` on the note's
scrollers. Plus the `FULL-SIZE EDITOR` block (`.nx-sketch-fs`,
`.nx-sketch-fs-bar`, `.nx-sketch-fs-stage` and its mobile padding), and the two
chrome switches `.nx-pk-hide-fm` / `body.nx-sk-immersive`.

`.nx-slate-btn` was renamed `.nx-sketch-open` — same slot, same look, different
job. `src/styles/02-banner.css` lost its `.nx-pk-note >` variants of the
three-corner-button rules; the `.nx-has-banner >` ones stayed.

### To bring Slate mode back

It needs the CSS block, `updateProtokoll` + `_pkObserve` +
`mountProtokollSurface`, the `refreshBanner()` call, `fixedViewport` in the
engine, and the two settings. What it would still not have is a sticky options
row or a reachable zoom — those were never solved there, which is why it went.

---

## 6. Events and the local calendars

Everything the calendar knew about *appointments*. What is left is the month,
what each day is **for** (`lib/daytext.js`, one frontmatter field of that day's
own note) and the tasks due on it.

**Why:** after the CalDAV network layer went (§4), local calendars were the only
event source left — one more place to type something that the daily note
already holds, with an RFC 5545 parser and an RRULE engine behind it. The user's
call: a month, a text per day, nothing else.

**Your data is not deleted.** The calendar JSON under
`<dataDir>/calendar/local/*.json` is simply no longer read. `dataDir` itself
stays — the sync state lives there — and its setting is unchanged.

The last commit in which all of this still existed in full:

```
1393cdb
```

### Deleted whole

| File | What it was |
|---|---|
| `src/lib/ical.js` | 198 lines. A dependency-free iCalendar (RFC 5545) reader/writer for VEVENT and VTODO: line unfolding, parameter parsing, `DATE` vs `DATE-TIME`, TZID pass-through. |
| `src/lib/recur.js` | 133 lines. RRULE expansion (FREQ/INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY), always bounded to the visible range so an endless rule could not run away, plus EXDATE and RECURRENCE-ID overrides. |
| `src/modals/event.js` | 124 lines. `NexusEventModal` — the new/edit/read dialog: title, all-day toggle, start and end, location, description, calendar picker, delete. |

### `src/lib/calstore.js` → `src/lib/datadir.js`

The file kept only what was never about calendars: `pluginDir`, `dataDir`,
`ensureFolder`, `readJSON`, `writeJSON` — which is what `lib/sync.js` uses. Gone
with the rename: `localDir`, `calId`, `loadCalendars`, `createLocalCalendar`,
`saveLocalEvent`, `deleteLocalEvent`, `expandRange` (the range aggregator that
ran every stored event through `recur.expand`) and `migrate`.

`migrate` had one caller, `main.js · migrateCalendarData`, which carried a
pre-0.20 vault folder into the plugin folder on load. Both are gone, and so is
the `_calLegacyFolder` flag `loadSettings` set for it.

### `src/views/calendarpage.js` — rewritten, 409 → ~230 lines

Month only. Gone: `mode` and the week/day renderers, the view switch, the
calendar visibility panel (`hiddenCalendars`), the "+ Event" button, the chips
built from occurrences, `calKey()`, and the empty-state hint that offered to add
a local calendar. The planner line it used to draw is now the **day's text**,
read and written through `lib/daytext.js` instead of `lib/planner.js`.

### The other surfaces

| File | What changed |
|---|---|
| `src/lib/agenda.js` | `calendars()`, `events()`, `eventRow()` and `openEvent()` removed. The block's `calendar:` section now shows the day's text; its `calendars:` config key is ignored. |
| `src/views/sidebar.js` | The calendar panel listed occurrences; it now lists the coming days with their text and what is due. Its "+" (new event) is gone — the tasks panel keeps its own. |
| `src/views/homepage.js` | The calendar card's three modes read day texts and due tasks instead of events. The month grid's dot became two: written / due. |
| `src/views/calendar.js` | Unchanged except that a day is now also marked when it has a day text, not only a planner line. |
| `src/modals/cards.js` | The card config lost "Only these calendars" and "Include events already over". |

### Settings

Removed from `DEFAULT_SETTINGS.tasksCalendar`: `localCalendars`,
`hiddenCalendars`, `defaultView`. **Left in `data.json` they are dead but
harmless.** Added: `dayTextKey` (default `'important'`).

The settings tab lost "Default view" and the whole *Local calendars* section,
and gained *The day's text* in its place.

Commands removed: `nexus-new-event` ("New event").

### To bring events back

`git show 1393cdb:src/lib/ical.js` and the two files beside it, the
calendar half of `calstore.js`, and the event branches listed above. What would
also have to come back is the choice the removal made: two places to write about
a day. The day's text is in the note; an event was in a plugin file.

---

## 7. The planner's own store, and the Tasks pinned tab

Two small removals from the same release.

### The planner block no longer holds its own lines

It used to be the store: `YYYY-MM-DD: text` lines inside the
```` ```nexus-planner ```` fence, in a month note the plugin resolved from a
folder and a file-name pattern. It now reads and writes the same field the
calendar does — that day's own note — so the fence carries only which month it
shows.

**Nothing is deleted.** Old lines stay in their blocks, inert. The command
**Move planner lines into the daily notes** (`nexus-planner-to-daily-notes`,
`src/lib/plannermigrate.js`) copies them across on request: it reports what it
found before it writes, never overwrites a day whose note already has a text,
and creates a daily note only for a day that has none.

Removed from `src/lib/planner.js`: `monthNotePath`, `readMonthPlan`,
`readMonthPlans`, `writeMonthEntry` and `ensureParentFolder` — the whole month
note layer. `parsePlanner`, `stringifyPlanner` and `setEntry` stay: the fence
still carries config, and the migration reads the old entries with them.

Removed from `DEFAULT_SETTINGS.tasksCalendar`: `planner` (`{ folder, pattern }`).
Added at the top level: `plannerMigrated`. The settings tab lost *Planner folder*
and *File name* and gained the migration button.

`src/views/calendar.js` lost `markPlanned()` and the vault watchers that fed it:
the mini calendar marks a day that has a **text**, which is now the same
statement.

### The Tasks page cannot be pinned to the tab bar

`pinnableTabs()` in `src/main.js` lost its `tasks` entry, and the CSS lost
`body.nx-pin-tasks` in `01-core.css` and `21-style-plain.css`. The dashboard and
the calendar keep theirs. `pinnedTabs.tasks` in an existing `data.json` is dead
but harmless; the settings row is generated from `pinnableTabs()`, so it
disappeared with the entry.

To bring it back: one row in `pinnableTabs()` and the three selector lists.
