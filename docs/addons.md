# Add-ons

Companion plugins that extend the suite, each in its own public GitHub repo
(user-facing description: wiki `concepts/addons.md`).

| File | Job |
|---|---|
| `src/lib/addons.js` | The catalogue (`ADDONS`) and `AddonManager`: latest release from the GitHub API (failures cached 10 min), download through `requestUrl`, checks (github.com only, manifest id, `minAppVersion`, `isDesktopOnly`), staged write (`<name>.new` then rename), enable/disable via `app.plugins`, uninstall with the add-on's `forgetDeviceData()`. |
| `src/features/addon-host.js` | Mixed into the plugin: `addons`, `registerSettingsPage`, `redrawSettings` (skips while a text field has the focus), `announceReady` (workspace event `nexus-suite:ready` at the end of every onload). |
| `src/settings/addons.js` | The Add-ons page: one row per add-on, switch, update, remove. Busy state lives on the manager. |
| `src/settings.js` | The nav group "Add-ons": the catalogue page plus one page per registered add-on (`addon:<id>`). |

Adding an add-on: one entry in `ADDONS`, a public repo whose releases carry `main.js` and
`manifest.json` (and `styles.css` if it has one), tagged `vX.Y.Z` or `X.Y.Z`.

Tests: `test/smoke.html` (settings pages, download/update/refusals/uninstall with a fake GitHub
and adapter). The real download path was run once against the v0.1.0 release of nexus-vikunja.
