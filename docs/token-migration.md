# Token migration — the class fold list

The plugin's CSS now reads every radius, border, surface, control height and
spacing step from the tokens in `src/styles/00-tokens.css`. The shared component
classes declared there — `.nx-btn`, `.nx-input`, `.nx-row`, `.nx-card` — are the
only ones a new feature may use.

Everything below is a **legacy class**: the markup that produces it lives in JS,
so it could not be renamed in the CSS pass. Each one now carries the canonical
geometry through an alias rule in the module file where it lives, marked with a
`Legacy alias of …` comment. The look is already correct; what is left is the
rename.

## How to finish the migration

For one class at a time:

1. Change the JS that creates the element to emit the shared class plus its
   modifiers, e.g. `createDiv('nx-tp-icon')` → `createDiv('nx-btn is-icon is-quiet')`.
2. Delete the alias rule in the module file.
3. Keep only the declarations the element genuinely needs beyond the shared one
   (a position, an accent tint, a scrim) and scope them to the new class.
4. Rebuild (`npm run build`) and check the element in the app.

A rename is finished when the module file has no rule left that sets `height`,
`padding`, `border`, `border-radius`, `background` or `font-size` on that class.

## Buttons → `.nx-btn`

| Legacy class | Modifiers it needs | File |
|---|---|---|
| `.nx-banner-btn` | `is-icon` (+ absolute position) | `02-banner.css` |
| `.nx-bg-btn` | `is-icon` (+ absolute position) | `02-banner.css` / `06-note-decor.css` |
| `.nx-slate-btn` | `is-icon` (+ absolute position) | `02-banner.css` / `12-sketch.css` |
| `.nx-sep-toggle` | `is-sm` | `02-banner.css` |
| `.nx-cal-nav button` | `is-quiet is-sm` | `03-calendar.css` |
| `.nx-home-btn` | — (keeps the hero's accent tint) | `04-homepage.css` |
| `.nx-home-btn-icononly` | `is-icon` | `04-homepage.css` / `10-hero-callouts-image.css` |
| `.nx-home-topbar .nx-home-btn` | `is-icon is-quiet` | `04-homepage.css` |
| `.nx-qn-save` | `is-primary` | `04-homepage.css` |
| `.nx-confirm-bar button` | — | `04-homepage.css` |
| `.nx-timer-btn` | `is-icon` | `04-homepage.css` |
| `.nx-orph-more` | `is-icon is-sm is-quiet` | `04-homepage.css` |
| `.nx-home-gear-corner` | `is-icon is-sm` (+ scrim) | `04-homepage.css` |
| `.nx-cardcfg-check` | `is-sm` | `05-modals.css` |
| `.nx-search-chip` | `is-sm` | `05-modals.css` |
| `.nx-prop-toggle` | `is-icon is-sm is-quiet` | `05-modals.css` |
| `.nx-banner-drag-done` | `is-icon is-primary` | `05-modals.css` |
| `.nx-bgstep-btn` | `is-icon is-sm` | `06-note-decor.css` |
| `.nx-banner-import-bar button` | — | `07-banner-modal.css` |
| `.nx-ws-act` | `is-icon is-sm` (+ scrim) | `08-workspace.css` |
| `.nx-ink-pdf-nav` | `is-quiet` | `11-ink.css` |
| `.nx-ink-tile-edit` | `is-icon is-sm` (+ scrim) | `11-ink.css` |
| `.nx-sk-btn` | `is-icon is-quiet` | `12-sketch.css` |
| `.nx-sk-subpen` | `is-icon is-quiet` | `12-sketch.css` |
| `.nx-sk-fav` | `is-icon is-quiet` | `12-sketch.css` |
| `.nx-sk-penchip` | `is-icon is-quiet` | `12-sketch.css` |
| `.nx-sk-stepbtn` | `is-icon is-sm` | `12-sketch.css` |
| `.nx-sk-menuitem-x` | `is-icon is-sm is-quiet` | `12-sketch.css` |
| `.nx-sk-palette-add` | `is-icon` + `.nx-list-add` | `12-sketch.css` |
| `.nx-sketch-enter` | `is-icon` (+ opaque ground) | `12-sketch.css` |
| `.nx-skpick-note` | — | `12-sketch.css` |
| `.nx-cp-btn` | — | `13-calendar-page.css` |
| `.nx-cp-primary` | `is-primary` | `13-calendar-page.css` |
| `.nx-cp-segbtn` | `is-quiet` (inside `.nx-cp-seg`) | `13-calendar-page.css` |
| `.nx-cp-calpanel-x` | `is-icon is-sm is-quiet` | `13-calendar-page.css` |
| `.nx-tagren-bar button` | — | `14-explorer-companions.css` |
| `.nx-ag-tool` | `is-icon is-quiet` | `17-agenda.css` |
| `.nx-side-tool` | `is-icon is-sm is-quiet` | `17-agenda.css` |
| `.nx-tp-icon` | `is-icon is-quiet` | `18-tasks-page.css` |
| `.nx-tp-chev` | `is-icon is-sm` (+ scrim) | `18-tasks-page.css` |
| `.nx-tp-segbtn` | `is-quiet` (inside `.nx-tp-seg`) | `18-tasks-page.css` |
| `.nx-kb-tool` | `is-icon is-quiet` (also the folder board's view buttons and gear) | `20-kanban.css` |
| `.nx-kb-col-menu` | `is-icon is-sm is-quiet` | `20-kanban.css` |
| `.nx-kb-card-menu` | `is-icon is-sm is-quiet` | `20-kanban.css` |
| `.nx-kb-add` / `.nx-tb-add` | `.nx-list-add` | `20-kanban.css` |
| `.nx-pl-tool` | `is-icon is-sm is-quiet` | `22-planner.css` |
| `.nx-pl-open` | `is-icon is-sm is-quiet` | `22-planner.css` |
| `.nx-qn-record` | — | `22-planner.css` |

## Fields → `.nx-input`

| Legacy class | Modifier | File |
|---|---|---|
| `.nx-qn-input` | `is-grow` (textarea) | `04-homepage.css` |
| `.nx-banner-import-input` | `is-grow` | `07-banner-modal.css` |
| `.nx-sk-notetext` | `is-grow` (textarea) | `12-sketch.css` |
| `.nx-cp-hex` | `is-grow` | `12-sketch.css` |
| `.nx-skpick-search` | `is-grow` | `12-sketch.css` |
| `.nx-tagren-input` | `is-grow` | `14-explorer-companions.css` |
| `.nx-kb-search` | `is-short` | `20-kanban.css` |
| `.nx-tp-select` | — (a `<select>` keeps an automatic width) | `18-tasks-page.css` |
| `.nx-tp-new-input` | `is-grow` | `18-tasks-page.css` |

Deliberately **not** `.nx-input`, because the point of each is that it does not
look like a field: `.nx-pl-input` (writing on paper), `.nx-kb-add-input` /
`.nx-tb-add-input` (inside the dashed add row), `.nx-sk-palname` (inline rename
with a dashed underline), `.nx-sk-colorinput` (a native colour swatch).

## Rows → `.nx-row`

| Legacy class | File |
|---|---|
| `.nx-home-item` | `04-homepage.css` |
| `.nx-popmenu-item` | `10-hero-callouts-image.css` |
| `.nx-ink-pdf-toc-list a` | `11-ink.css` |
| `.nx-sk-pen` | `12-sketch.css` |
| `.nx-sk-palrow` | `12-sketch.css` |
| `.nx-sk-menuitem` | `12-sketch.css` |
| `.nx-cp-calrow` | `13-calendar-page.css` |
| `.nx-iconlist-row` (inside an Obsidian `.setting-item`) | `14-explorer-companions.css` |
| `.nx-ag-row` | `17-agenda.css` |
| `.nx-ag-link` | `17-agenda.css` |
| `.nx-tp-all` | `18-tasks-page.css` |
| `.nx-tp-sub` | `18-tasks-page.css` |
| `.nx-tp-task` | `18-tasks-page.css` |

## Two defects left in `00-tokens.css` (owned elsewhere)

1. `--nx-hairline: var(--nx-bw) solid var(--nx-border)` has no fallback, and the
   plugin never declares `--nx-border` — only `themes/Nexus/theme.css` does. Under
   any other theme the custom property is invalid at computed-value time and every
   `border: var(--nx-hairline)` in the plugin resolves to no border at all. Same
   for `--nx-border-strong`. `01-core.css` re-declares both on `:root` with the
   fallback as a stopgap; move the fallback into `00-tokens.css` and delete that
   block.
2. `.nx-btn.is-primary:hover` uses a bare `var(--nx-accent)` while the resting
   rule above it uses `var(--nx-accent, var(--interactive-accent))` — without the
   Nexus theme a primary button goes transparent on hover.

## Still outside the contract

`src/styles/09-settings-inputs.css` was not part of this pass. It still holds
its own button, field and row families — `.nx-multirow-input` / `.nx-multirow-del`,
`.nx-proprow-key` / `.nx-proprow-val` / `.nx-proprow-del`, `.nx-propconn-btn`,
`.nx-propgroup-add`, `.nx-propgroup-or`, `.nx-iconfield-btn`,
`.nx-iconpicker-search` / `.nx-iconpicker-cell`, `.nx-ac-dropdown` / `.nx-ac-item`,
`.nx-settings-tab`, `.nx-stylepick-*`, `.nx-palpick-*`, `.nx-st-pair`, `.nx-hint`
— with their own radii and their own `1px solid`. `.nx-multirow-input` and
`.nx-proprow-key` / `-val` are byte-for-byte the same rule, as are
`.nx-multirow-del` and `.nx-proprow-del`; `.nx-proprow-key` is `flex: 0 0 38%`
next to a `flex: 1` sibling, which is the "two fields in the same tab are
different widths" the field review reported.

Folding it was out of scope for this pass (the file is owned elsewhere), which is
why the settings page is the one surface in the plugin that still brings its own
radii and its own `1px solid`. Every other file reads the tokens.

`19-touch.css` still has to reach into it for one thing: `.nx-multirow-del` and
`.nx-proprow-del` hardcode `26px`, which no token bump can move, so the touch
override for those two stayed.


## Still on the list

The CSS aliases above are the bridge; these are the markup changes that let them
be deleted.

- **`lib/inputs.js` builds its own rows.** `nxMultiRow` and `nxPropRows` emit
  `.nx-multirow-row` / `.nx-proprow` and their own field and delete classes.
  They now share one rule with `.nx-input` and `.nx-btn.is-icon`, so they look
  right — but the markup should simply be `.nx-row`, `.nx-input` and
  `.nx-btn`, and then the aliases go.
- **`settings.js · tIcons` builds each assigned icon as an Obsidian `Setting`.**
  The one-line row is reached with `:has(.nx-iconlist-row)` overrides in
  `14-explorer-companions.css` rather than with markup. Verified at 34 px, so it
  is correct — it is just reached the long way round.
