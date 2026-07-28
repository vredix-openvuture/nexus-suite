'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · explorer icons
 *  Replaces obsidian-icon-folder: an icon per folder/file path, drawn in the
 *  file explorer. Uses the icon picker this plugin already ships, so the icons
 *  come from the same set as everywhere else and follow the theme accent.
 *
 *  Storage: settings.icons.map = { "<vault path>": "<lucide id>" | "<emoji>" }
 *  Paths move with renames (vault 'rename' rewrites the keys).
 * ========================================================================== */

const { Notice, getIconIds, setIcon } = require('obsidian');

/* icon-folder stores lucide ids as PascalCase with an "Li" prefix
   ("LiBookText"); ours are the plain lucide ids ("book-text"). Emoji entries
   pass through untouched. */
function nxIconFromLegacy(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!/^Li[A-Z]/.test(v)) return v;                       // emoji or a foreign pack → keep verbatim
  return v.slice(2)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])(\d)/g, '$1-$2')
    .toLowerCase();
}

class NexusIcons {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
  get s() { return this.plugin.settings.icons; }
  map() {
    if (!this.s.map || typeof this.s.map !== 'object') this.s.map = {};
    return this.s.map;
  }
  iconFor(path) { return this.map()[path] || ''; }

  async setIconFor(path, icon) {
    const m = this.map();
    if (icon) m[path] = icon; else delete m[path];
    await this.plugin.saveSettings();
    this.refresh();
  }

  /* One-time import of the icon-folder plugin's assignments. */
  async migrateFromIconFolder() {
    const path = this.app.vault.configDir + '/plugins/obsidian-icon-folder/data.json';
    let raw;
    try {
      if (!(await this.app.vault.adapter.exists(path))) { new Notice('Nexus: no icon-folder data found.'); return 0; }
      raw = JSON.parse(await this.app.vault.adapter.read(path));
    } catch (e) { new Notice('Nexus: could not read icon-folder data.'); return 0; }
    // icon-folder ships its own (newer) Lucide pack, so some of its ids simply
    // don't exist in Obsidian's built-in set. Those would import "fine" and
    // then render as nothing, with no hint why — so check against the real
    // list and name the ones that need re-picking.
    let known = null;
    try { known = new Set(getIconIds().map(x => x.replace(/^lucide-/, ''))); } catch (e) {}
    const m = this.map();
    let n = 0;
    const unresolved = [];
    for (const [k, v] of Object.entries(raw || {})) {
      if (k === 'settings' || typeof v !== 'string') continue;
      const icon = nxIconFromLegacy(v);
      if (!icon || m[k]) continue;
      // Emoji (anything that isn't a plain id) always works — it's just text.
      const isId = /^[a-z0-9-]+$/.test(icon);
      if (isId && known && !known.has(icon)) unresolved.push(k + ' (' + icon + ')');
      m[k] = icon; n++;
    }
    await this.plugin.saveSettings();
    this.refresh();
    if (unresolved.length) {
      new Notice('Nexus: imported ' + n + ' icon(s). ' + unresolved.length +
        ' use an icon Obsidian does not ship — pick a new one for: ' + unresolved.slice(0, 5).join(', ') +
        (unresolved.length > 5 ? ' …' : ''), 12000);
    } else {
      new Notice('Nexus: imported ' + n + ' icon(s).');
    }
    this._unresolved = unresolved;
    return n;
  }
  /* Which assignments point at an icon this Obsidian cannot draw. */
  unresolvedIcons() {
    let known;
    try { known = new Set(getIconIds().map(x => x.replace(/^lucide-/, ''))); } catch (e) { return []; }
    return Object.entries(this.map())
      .filter(([, v]) => /^[a-z0-9-]+$/.test(v) && !known.has(v))
      .map(([k]) => k);
  }

  init() {
    const p = this.plugin;

    p.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!this.s.enabled || !file || !file.path) return;
      const cur = this.iconFor(file.path);
      menu.addItem(i => i.setTitle(cur ? 'Change icon …' : 'Set icon …').setIcon('image')
        .onClick(() => this.pick(file.path)));
      if (cur) menu.addItem(i => i.setTitle('Remove icon').setIcon('x')
        .onClick(() => this.setIconFor(file.path, '')));
    }));

    // Keys are paths, so they have to follow renames — otherwise every rename
    // silently loses the icon.
    p.registerEvent(this.app.vault.on('rename', async (f, oldPath) => {
      const m = this.map();
      let touched = false;
      for (const key of Object.keys(m)) {
        if (key === oldPath) { m[f.path] = m[key]; delete m[key]; touched = true; }
        else if (key.startsWith(oldPath + '/')) { m[f.path + key.slice(oldPath.length)] = m[key]; delete m[key]; touched = true; }
      }
      if (touched) await this.plugin.saveSettings();
      this.refreshDebounced();
    }));
    p.registerEvent(this.app.vault.on('delete', async (f) => {
      const m = this.map();
      let touched = false;
      for (const key of Object.keys(m)) {
        if (key === f.path || key.startsWith(f.path + '/')) { delete m[key]; touched = true; }
      }
      if (touched) await this.plugin.saveSettings();
    }));

    this.app.workspace.onLayoutReady(() => {
      this.refresh();
      const container = document.querySelector('.nav-files-container');
      if (container && window.MutationObserver) {
        this._obs = new MutationObserver(() => this.refreshDebounced());
        this._obs.observe(container, { childList: true, subtree: true });
        p.register(() => { if (this._obs) { this._obs.disconnect(); this._obs = null; } });
      }
    });
    p.registerEvent(this.app.workspace.on('layout-change', () => this.refreshDebounced()));
  }

  pick(path) {
    const { NexusIconPickerModal } = require('../modals/pickers.js');
    new NexusIconPickerModal(this.app, this.iconFor(path), (picked) => this.setIconFor(path, picked)).open();
  }

  refreshDebounced() {
    window.clearTimeout(this._t);
    this._t = window.setTimeout(() => this.refresh(), 100);
  }
  /* Draws the icon into each explorer row. The element is reused across
     refreshes (data-nx-icon guards against re-rendering the same icon on
     every mutation, which would fight the explorer's own DOM churn). */
  refresh() {
    const on = this.s && this.s.enabled;
    const rows = document.querySelectorAll('.nav-files-container .nav-folder-title, .nav-files-container .nav-file-title');
    rows.forEach(el => {
      const path = el.getAttribute('data-path');
      const icon = on && path ? this.iconFor(path) : '';
      let host = el.querySelector(':scope > .nx-icon');
      if (!icon) { if (host) host.remove(); return; }
      if (!host) {
        host = el.createSpan('nx-icon');
        // Before the name, after the collapse arrow.
        const content = el.querySelector(':scope > .nav-folder-title-content, :scope > .nav-file-title-content');
        if (content) el.insertBefore(host, content);
      }
      if (host.dataset.nxIcon === icon) return;
      host.dataset.nxIcon = icon;
      host.empty();
      // Anything that isn't a plain lucide id is treated as literal text —
      // that is what makes emoji entries work without a second code path.
      if (/^[a-z0-9-]+$/.test(icon)) setIcon(host, icon);
      else host.setText(icon);
    });
  }

  unload() {
    document.querySelectorAll('.nx-icon').forEach(e => e.remove());
    if (this._obs) { this._obs.disconnect(); this._obs = null; }
  }
}

module.exports = { NexusIcons, nxIconFromLegacy };
