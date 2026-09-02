# The token contract

Binding for `src/styles/` and for `themes/Nexus/theme.css`. The geometry rules
that follow from it are in the theme's own `docs/style-guide.md`.

Binding for every CSS file in the plugin and in the theme. Written 2026-09-01
after the field review found, in the plugin's CSS alone, 184 literal
`border-radius` values against 45 that use a token, 41 separate button class
families, four separate implementations of "a row with an input and a delete
button", `1px solid …` written out 93 times, 89 raw `opacity:` literals and no
border or surface token at all.

## Where the tokens live

Two declarations of the same block, on purpose:

- **Plugin** — `src/styles/00-tokens.css`, on `:root`.
- **Theme** — `theme.css` section 1, on `.theme-dark, .theme-light`.

The theme's selector has the higher specificity, so with the Nexus theme active
the theme wins and with any other theme the plugin still has every token it
uses. Today the two disagree — the plugin falls back to `12px` and `10px` where
the theme says `15px` — which is why the plugin renders a different geometry
depending on the theme. That ends here.

The two blocks must be identical between the markers

```
/* >>> NX TOKENS >>> */   …   /* <<< NX TOKENS <<< */
```

and `test/tokens.sh` asserts it. A change to one without the other is a
failing test, not a style opinion.

## Radii — two, and that is all

The two names already exist and already mean the right thing. What was missing
is that anything obeyed them.

| Token | Value | For |
|---|---|---|
| `--nx-radius` | `15px` | Anything that **contains** something: cards, panels, modals, code blocks, callouts, banners, images, dropdown surfaces. |
| `--nx-r-tile` | `10px` | Anything that **is** a control: buttons, inputs, list rows, tabs, chips, tags, swatches, toggles. |

Two more exist and are **shapes, not radii**:

| `--nx-r-circle` | `50%` | Only where the element genuinely is a circle — a colour dot, an avatar. |
| `--nx-r-pill` | `999px` | Only a segmented control or a status pill whose *shape carries meaning*. An ordinary button is never a pill. |

`999px` appears 38× in the plugin today; nearly all of those are ordinary
buttons and become `--nx-r-tile`.

A literal radius anywhere outside the token blocks is a defect. The only
permitted literal is `0`.

The style variants (`nx-style-plain`, the ≤950px block, the Notion-like
palette) already override `--nx-radius` / `--nx-r-tile` and keep doing so —
that is the mechanism working, not an exception to it.

## Borders

`--nx-border` already exists and is a **colour**. It keeps that meaning.

| `--nx-bw` | `1px` | The one border width. |
| `--nx-border` | *(unchanged)* | The one line colour. |
| `--nx-hairline` | `var(--nx-bw) solid var(--nx-border)` | The shorthand. Replaces all 93 + 16 written-out `1px solid …`. |
| `--nx-border-strong` | `color-mix(in srgb, var(--nx-border) 100%, var(--nx-fg) 12%)` | Only for a line that has to survive next to a filled surface. |

One-sided borders stay banned by the style guide. The explorer rail is a rail,
not a border, and is the one thing that draws on a single edge.

## Surfaces

Surfaces are lifted from the ground, never tinted. `--nx-floor`, `--nx-chip`,
`--nx-chip-side` and `--nx-elevated` already do this for the big areas; what is
missing is the small end, which is where the 89 raw opacities sit.

| `--nx-op-faint` | `4%` | |
| `--nx-op-soft` | `8%` | |
| `--nx-op-strong` | `14%` | |
| `--nx-sf-1` | ground + `--nx-op-faint` | a list row, a hover |
| `--nx-sf-2` | ground + `--nx-op-soft` | a card, an inner panel |
| `--nx-sf-3` | ground + `--nx-op-strong` | a popover, a pressed state |

`--nx-surface-2` already exists inside one palette variant and means something
else; the new names avoid it deliberately.

## Controls — one height, one padding, one width

| `--nx-ctl-h` | `30px` | Every button, every input, every select. |
| `--nx-ctl-h-sm` | `24px` | Only inside a dense row — a delete button beside a field. |
| `--nx-ctl-pad-x` | `10px` | |
| `--nx-ctl-gap` | `6px` | Between a control and its neighbour. |
| `--nx-field-w` | `220px` | **The** width of a settings text field. The review found fields of different widths inside one tab; there is now one answer. |
| `--nx-row-h` | `34px` | The height of a list row — the icons page currently spends several lines on an icon and a button. |

## Spacing

`--nx-sp-1: 4px` · `--nx-sp-2: 8px` · `--nx-sp-3: 12px` · `--nx-sp-4: 18px` ·
`--nx-sp-5: 28px`. `--nx-gap` stays what it is: the gap between chips.

## The shared classes that replace the 41 families

Declared once in `src/styles/00-tokens.css`, used everywhere:

| Class | Replaces |
|---|---|
| `.nx-btn` (+ `.is-primary`, `.is-quiet`, `.is-danger`, `.is-icon`) | `.nx-banner-btn`, `.nx-bg-btn`, `.nx-cp-btn`, `.nx-home-btn`, `.nx-kb-add`, `.nx-sk-btn`, `.nx-slate-btn`, `.nx-tb-add`, `.nx-timer-btn`, `.nx-ws-add`, `.nx-propconn-btn`, `.nx-propgroup-add`, `.nx-propgroup-or`, `.nx-iconfield-btn`, `.nx-home-stat-add`, … |
| `.nx-input` | `.nx-multirow-input`, `.nx-proprow-key`, `.nx-proprow-val`, … |
| `.nx-row` (+ `.nx-row-main`, `.nx-row-aside`) | `.nx-multirow-row`, `.nx-proprow`, `.nx-set-list`, and every ad-hoc list row |
| `.nx-card` | every bespoke tile that is really a surface with a radius |

A new `.nx-*-btn` class is not written again. A button that has to look
different gets a modifier on `.nx-btn`, and the modifier is justified here.

## Values are a separate question

The **structure** above is not a matter of taste and is binding. The **numbers**
are, and `15px / 10px` is only what the theme happens to say today. Once
everything reads them from one place, four rendered variants of the pair go to
the user and the winner is a two-line edit. That is the entire point of the
file.
