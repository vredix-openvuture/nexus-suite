'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · add-ons
 *  Plugins that extend the suite but are not part of it — Nexus Vikunja is the
 *  first. Each one is its own public GitHub repo with releases, like the suite
 *  itself. Switching one on in Settings → Nexus Suite → Add-ons downloads its
 *  latest release into .obsidian/plugins/<id>/ and enables it; it then shows
 *  its settings as a page in the suite's settings (features/addon-host.js).
 *
 *  The download is what BRAT does: the release's main.js, manifest.json and
 *  styles.css through requestUrl, so it works on a phone as well. It runs
 *  whatever the repo releases, on every device — trust is in the repo, the
 *  same as with BRAT. What is checked: the files come from github.com, the
 *  manifest names this add-on, and this device can run it.
 * ========================================================================== */

const { requestUrl, Platform, requireApiVersion } = require('obsidian');

/* The catalogue. A new add-on is one line here and a public repo with a
   release carrying at least main.js and manifest.json. */
const ADDONS = [
  {
    id: 'nexus-vikunja',
    name: 'Nexus Vikunja',
    repo: 'vredix-openvuture/nexus-vikunja',
    icon: 'square-kanban',
    sub: 'Vikunja projects as kanban boards: a page per project, cards straight from the Vikunja API, a note per task.',
  },
];

const FILES = ['main.js', 'manifest.json', 'styles.css'];
const REQUIRED = ['main.js', 'manifest.json'];
const FAILURE_MS = 10 * 60 * 1000;   // a failed GitHub question is not asked again for this long

/* "0.10.2" > "0.9.9" — enough of semver for release tags. */
function newer(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function fromGithub(url) {
  try { return new URL(url).hostname === 'github.com'; } catch (e) { return false; }
}

class AddonManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.latestCache = new Map();   // repo → { version, assets } | { error, at }
    this.busy = new Set();          // add-on ids with an install or update running
  }

  list() { return ADDONS; }
  dir(id) { return this.app.vault.configDir + '/plugins/' + id; }
  plugins() { return this.app.plugins || {}; }
  installedVersion(id) {
    const m = this.plugins().manifests && this.plugins().manifests[id];
    return m ? m.version : '';
  }
  isEnabled(id) {
    const p = this.plugins();
    return !!(p.enabledPlugins && p.enabledPlugins.has(id));
  }

  /* The newest release: its version and where each file is. A failure is
     remembered for ten minutes, or every redraw of the settings would ask
     GitHub again and use up its 60 anonymous requests an hour. */
  async latest(addon, fresh) {
    const cached = this.latestCache.get(addon.repo);
    if (cached && !fresh && (!cached.error || Date.now() - cached.at < FAILURE_MS)) {
      if (cached.error) throw new Error(cached.error);
      return cached;
    }
    try {
      const info = await this.ask(addon);
      this.latestCache.set(addon.repo, info);
      return info;
    } catch (e) {
      this.latestCache.set(addon.repo, { error: e.message, at: Date.now() });
      throw e;
    }
  }
  async ask(addon) {
    let res;
    try {
      res = await requestUrl({ url: 'https://api.github.com/repos/' + addon.repo + '/releases/latest',
        headers: { Accept: 'application/vnd.github+json' }, throw: false });
    } catch (e) {
      throw new Error('GitHub could not be reached (' + (e && e.message ? e.message : e) + ')');
    }
    if (res.status === 404) throw new Error(addon.repo + ' has no release yet');
    if (res.status < 200 || res.status >= 300) throw new Error('asking GitHub for ' + addon.repo + ' failed with ' + res.status);
    const assets = {};
    for (const a of (res.json && res.json.assets) || []) {
      if (FILES.indexOf(a.name) >= 0 && fromGithub(a.browser_download_url)) assets[a.name] = a.browser_download_url;
    }
    const missing = REQUIRED.filter(f => !assets[f]);
    if (missing.length) throw new Error('the release of ' + addon.repo + ' lacks ' + missing.join(', '));
    return { version: String(res.json.tag_name || '').replace(/^v/, ''), assets };
  }

  updateAvailable(addon) {
    const info = this.latestCache.get(addon.repo);
    return !!info && !info.error && !!this.installedVersion(addon.id) && newer(info.version, this.installedVersion(addon.id));
  }

  /* Can this device run that manifest? Asked before anything is written, so a
     release this phone cannot load never replaces the one it can. */
  refusal(manifest) {
    if (manifest.isDesktopOnly && Platform && Platform.isMobile) return 'it runs on the desktop only';
    if (manifest.minAppVersion && typeof requireApiVersion === 'function' && !requireApiVersion(manifest.minAppVersion)) {
      return 'it needs Obsidian ' + manifest.minAppVersion + ' or later';
    }
    return '';
  }

  /* Download the latest release and swap it in. `turnOn` says whether it runs
     afterwards; an update keeps whatever state the add-on had.
     Every file is downloaded and staged as "<name>.new" before any live file
     is touched; the swap after that is a rename per file. */
  async install(addon, turnOn) {
    if (this.busy.has(addon.id)) throw new Error('already busy with ' + addon.name);
    this.busy.add(addon.id);
    try {
      const wasOn = this.isEnabled(addon.id);
      const info = await this.latest(addon, true);
      const files = {};
      for (const name of FILES) {
        if (!info.assets[name]) continue;
        let res;
        try { res = await requestUrl({ url: info.assets[name], throw: false }); }
        catch (e) { throw new Error('downloading ' + name + ' failed (' + (e && e.message ? e.message : e) + ')'); }
        if (res.status < 200 || res.status >= 300) throw new Error('downloading ' + name + ' failed with ' + res.status);
        files[name] = res.text;
      }
      let manifest;
      try { manifest = JSON.parse(files['manifest.json']); } catch (e) { throw new Error('its manifest.json is not valid JSON'); }
      if (manifest.id !== addon.id) throw new Error('the release is for "' + manifest.id + '", not "' + addon.id + '"');
      const refused = this.refusal(manifest);
      if (refused) throw new Error('version ' + manifest.version + ' cannot run here: ' + refused);

      const adapter = this.app.vault.adapter;
      const dir = this.dir(addon.id);
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      for (const name of Object.keys(files)) await adapter.write(dir + '/' + name + '.new', files[name]);
      for (const name of FILES) {
        const live = dir + '/' + name;
        if (await adapter.exists(live)) await adapter.remove(live);   // also a file this release no longer has
        if (files[name] != null) await adapter.rename(live + '.new', live);
      }

      const p = this.plugins();
      await p.loadManifests();
      // A running add-on is running the old code: off and on loads the new one.
      if (wasOn) await p.disablePlugin(addon.id);
      if (turnOn || wasOn) await this.turnOn(addon);
      return manifest.version;
    } finally {
      this.busy.delete(addon.id);
    }
  }

  /* enablePluginAndSave says false — it does not throw — when Obsidian would
     not load the plugin (restricted mode, a manifest it rejects, an onload that
     threw). That has to be said, not reported as "on". */
  async turnOn(addon) {
    const ok = await this.plugins().enablePluginAndSave(addon.id);
    if (ok === false) throw new Error('Obsidian did not load it — restricted mode, or its start failed (see the console)');
  }

  async enable(addon) {
    if (!this.installedVersion(addon.id)) return this.install(addon, true);
    await this.turnOn(addon);
    return this.installedVersion(addon.id);
  }

  async disable(addon) { await this.plugins().disablePluginAndSave(addon.id); }

  /* Off, and its folder gone — with its settings (data.json) in it. Before
     that the add-on is asked to forget what it keeps outside the vault on this
     device (keys in the secret storage, cached data), if it offers that. */
  async uninstall(addon) {
    const running = this.plugins().plugins && this.plugins().plugins[addon.id];
    if (running && typeof running.forgetDeviceData === 'function') {
      try { await running.forgetDeviceData(); }
      catch (e) { console.warn('[Nexus] ' + addon.id + ' could not forget its device data:', e); }
    }
    await this.disable(addon);
    const dir = this.dir(addon.id);
    if (await this.app.vault.adapter.exists(dir)) await this.app.vault.adapter.rmdir(dir, true);
    await this.plugins().loadManifests();
  }
}

module.exports = { AddonManager, ADDONS, newer, fromGithub };
