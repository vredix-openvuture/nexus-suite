'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the plugin's data directory
 *  Where the plugin keeps its own JSON — today the sync state, once the local
 *  calendars (see docs/removed-features.md).
 *
 *  The data dir defaults to .nexus-calendar INSIDE the plugin folder: it sticks
 *  to the plugin, stays out of the file explorer / search / graph, and survives
 *  updates (BRAT and manual installs only replace main.js, styles.css and
 *  manifest.json). Still syncs, as long as the sync covers .obsidian. Anyone
 *  who deliberately excludes .obsidian from sync can switch it back to a normal
 *  vault folder in the settings.
 * ========================================================================== */

function pluginDir(plugin) {
  return plugin.app.vault.configDir + '/plugins/' + ((plugin.manifest && plugin.manifest.id) || 'nexus-suite');
}
function dataDir(plugin) {
  const tc = (plugin.settings && plugin.settings.tasksCalendar) || {};
  if ((tc.dataLocation || 'plugin') === 'plugin') return pluginDir(plugin) + '/.nexus-calendar';
  return (tc.dataFolder || '_nexus').replace(/\/+$/, '');
}
async function ensureFolder(plugin, path) {
  const ad = plugin.app.vault.adapter;
  const parts = path.split('/');
  let cur = '';
  for (const p of parts) {
    cur = cur ? cur + '/' + p : p;
    try { if (!(await ad.exists(cur))) await ad.mkdir(cur); } catch (e) {}
  }
}
async function readJSON(plugin, path) {
  const ad = plugin.app.vault.adapter;
  try { if (await ad.exists(path)) return JSON.parse(await ad.read(path)); } catch (e) {}
  return null;
}
async function writeJSON(plugin, path, obj) {
  const ad = plugin.app.vault.adapter;
  await ensureFolder(plugin, path.split('/').slice(0, -1).join('/'));
  await ad.write(path, JSON.stringify(obj, null, 0));
}

module.exports = { pluginDir, dataDir, ensureFolder, readJSON, writeJSON };
