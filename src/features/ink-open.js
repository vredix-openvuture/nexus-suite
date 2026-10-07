'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · ink capture views
 *  Ink sources and folders, and opening the galaxy, the dock and the capture
 *  hub. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { moment } = require('obsidian');
const { INK_VIEW, CAPTURE_VIEW, GALAXY_VIEW } = require('../constants.js');
const { uniquePath } = require('../lib/vaultpaths.js');

class InkOpen {

  /* ---- Ink Capture ----
     captureScan() writes the binary; _onInkVaultCreate (a folder-scoped vault
     'create' watcher over all settings.inkCapture.sources) is the single place
     that turns any image/PDF landing in a source folder into a sidecar —
     whether it came from our own button (Paper) or was dropped in some other
     way, e.g. a manual export from Saber/Butterfly synced in. Only
     button-triggered captures (tracked in _inkPending) get the tag-dialog
     popup afterwards. Excalidraw drawings are NOT sidecar'd — they're already
     native taggable .md files, just surfaced in the hub (see
     lib/capture.js · isInkCapture). */
  /* The configured sources, normalised. "paper" is guaranteed present (the
     in-app camera writes there); everything else the user added themselves. */
  inkSources() {
    const s = this.settings.inkCapture;
    if (!Array.isArray(s.sources)) s.sources = [];
    if (!s.sources.some(x => x && x.id === 'paper'))
      s.sources.unshift({ id: 'paper', label: 'Paper (camera)', folder: 'Inbox/Paper', enabled: true });
    return s.sources;
  }
  /* Unique, stable id for a new source — derived from its label, because the id
     is what lands in each sidecar's `ink-source` frontmatter. */
  inkSourceId(label) {
    const base = String(label || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source';
    const taken = new Set(this.inkSources().map(x => x.id));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(base + '-' + i)) i++;
    return base + '-' + i;
  }
  async ensureInkFolders() {
    for (const src of this.inkSources()) {
      if (!src.enabled) continue;
      const dir = (src.folder || '').replace(/\/$/, '');
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
    }
  }
  /* The ribbon and the old command still say "ink gallery" and still work —
     they land on the hub's Ink tab. An already-open hub under EITHER id is
     reused, so the button never opens a second copy of the same thing. */
  /* One galaxy, reused: the layout takes a moment to settle, so a second one
     would be a second wait for the same picture. */
  async openGalaxy() {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(GALAXY_VIEW)[0];
    if (open) { ws.revealLeaf(open); return open; }
    const leaf = ws.getLeaf(true);
    await leaf.setViewState({ type: GALAXY_VIEW, active: true });
    ws.revealLeaf(leaf);
    return leaf;
  }

  /* One right-dock opener for every panel we register, so a new one is a line
     rather than another copy of the same six. */
  async openInDock(type) {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(type)[0];
    if (open) { ws.revealLeaf(open); return open; }
    const leaf = ws.getRightLeaf(false);
    if (!leaf) return null;
    await leaf.setViewState({ type, active: true });
    ws.revealLeaf(leaf);
    return leaf;
  }

  /* A setting changed under an open galaxy has to reach it — the layout is
     cached, so the view has to be told rather than noticing. */
  refreshGalaxy() {
    for (const leaf of this.app.workspace.getLeavesOfType(GALAXY_VIEW)) {
      const view = leaf.view;
      if (view && typeof view.reload === 'function') view.reload();
    }
  }

  activateInkGallery() { return this.openCaptureHub('ink'); }
  async openCaptureHub(tab) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(CAPTURE_VIEW)[0] || ws.getLeavesOfType(INK_VIEW)[0];
    if (!leaf) {
      leaf = ws.getLeaf(false);
      await leaf.setViewState({ type: CAPTURE_VIEW, active: true });
    }
    if (tab && leaf.view && leaf.view.hub) await leaf.view.hub.setTab(tab);
    ws.revealLeaf(leaf);
  }
  captureScan() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,application/pdf';
    input.setAttribute('capture', 'environment');   // mobile: prefer the camera, but still lets you pick an existing file (incl. PDF)
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const paper = this.inkSources().find(x => x.id === 'paper') || {};
      const dir = (paper.folder || 'Inbox/Paper').replace(/\/$/, '');
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = uniquePath(p => !!this.app.vault.getAbstractFileByPath(p), dir, 'Scan ' + moment().format('YYYY-MM-DD HHmmss'), ext);
      this._inkPending.add(path);
      await this.app.vault.createBinary(path, await f.arrayBuffer());
    };
    input.click();
  }
}

module.exports = InkOpen;
