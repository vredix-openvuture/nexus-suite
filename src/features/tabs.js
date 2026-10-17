'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the dashboard tab and pinned tabs
 *  Opening the dashboard and the calendar, what happens on startup and in an
 *  empty workspace, and the tabs that stay pinned. Mixed into the plugin class.
 * ========================================================================== */

const { CAL_VIEW, CAPTURE_VIEW, GALAXY_VIEW, HOME_VIEW, NX_MODULES } = require('../constants.js');

class Tabs {

  /* ---- Calendar ---- */
  async activateCalendar() {
    let leaf = this.app.workspace.getLeavesOfType(CAL_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: CAL_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /* ---- Homepage ----
     Opening it never costs a note. The old version handed the ACTIVE leaf to
     setViewState, which silently replaced whatever was open in it — on startup
     that ate the tab you left behind. So: a dashboard that is already open is
     brought forward (the pinned one included, since that is a leaf like any
     other), an empty tab is taken over because an empty tab is not a note, and
     anything else gets a tab of its own. */
  async openHomepage() {
    // Two things ask for the dashboard at the same 150 ms mark — the pin
    // watchdog and the empty-main-area watcher. Without one promise to share,
    // the second gets past the "is one open?" check while the first is still
    // awaiting setViewState, and the vault ends up with two dashboards.
    if (!this._homeOpening) {
      this._homeOpening = this._openHomepageLeaf().then(
        (leaf) => { this._homeOpening = null; return leaf; },
        (err) => { this._homeOpening = null; throw err; });
    }
    return this._homeOpening;
  }
  async _openHomepageLeaf() {
    const workspace = this.app.workspace;
    const open = workspace.getLeavesOfType(HOME_VIEW)[0];
    if (open) { workspace.revealLeaf(open); return open; }
    const current = workspace.getLeaf(false);
    const leaf = this.leafType(current) === 'empty' ? current : workspace.getLeaf(true);
    await leaf.setViewState({ type: HOME_VIEW, active: true });
    workspace.revealLeaf(leaf);
    return leaf;
  }
  leafType(leaf) { return (leaf && leaf.view && leaf.view.getViewType) ? leaf.view.getViewType() : ''; }

  /* What happens to the dashboard when Obsidian starts: nothing, its own tab,
     or a cleared main area followed by its own tab. */
  async runHomepageStartup() {
    const home = this.settings.homepage;
    const mode = home.startup || 'off';
    if (!home.enabled || mode === 'off') return;
    if (mode === 'closeAll') this.closeMainAreaTabs();
    await this.openHomepage();
  }
  /* Every tab in the main area. Sidebars are not root leaves, so they stay —
     and a pinned Nexus page is left alone too: guardPinnedTabs would put it
     back 150 ms later anyway, so closing it only buys a flicker. */
  closeMainAreaTabs() {
    const pinned = this.pinnableTabs().filter(p => this.isTabPinned(p.key) && p.on()).map(p => p.type);
    const doomed = [];
    this.app.workspace.iterateRootLeaves(leaf => {
      const type = this.leafType(leaf);
      if (pinned.indexOf(type) < 0) doomed.push({ leaf, type });
    });
    for (const entry of doomed) {
      try { entry.leaf.detach(); }
      catch (e) { console.error('[Nexus] a tab could not be closed ("' + entry.type + '"):', e); }
    }
  }
  /* The last tab was closed → bring the dashboard up instead of an empty pane.
     Obsidian leaves an 'empty' leaf behind rather than nothing, so emptiness is
     counted rather than asked for. Guarded against re-entry, because opening the
     dashboard fires layout-change again; skipped while unloading, so onunload's
     detach is not undone the moment it happens. */
  maybeOpenHomepageWhenEmpty() {
    if (this._unloading || this._homeEmptyBusy) return;
    const home = this.settings.homepage;
    if (!home.enabled || !home.openWhenEmpty) return;
    let occupied = 0;
    this.app.workspace.iterateRootLeaves(leaf => {
      const type = this.leafType(leaf);
      if (type && type !== 'empty') occupied++;
    });
    if (occupied) return;
    this._homeEmptyBusy = true;
    this._homeEmptyTimer = window.setTimeout(async () => {
      try { if (!this._unloading) await this.openHomepage(); }
      catch (e) { console.error('[Nexus] the dashboard could not be opened:', e); }
      finally { this._homeEmptyBusy = false; }
    }, 150);
  }

  refreshCalendarViews() {
    // A week-start or day-text-key change has to reach the month grids.
    for (const leaf of this.app.workspace.getLeavesOfType(CAL_VIEW)) {
      const v = leaf.view; if (v && typeof v.render === 'function') v.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW)) {
      const v = leaf.view; if (v && typeof v.render === 'function') v.render();
    }
  }

  /* ---- Pinned tabs (the dashboard, the galaxy, the capture hub) ----
     A pinned page sits at the tab bar as its bare icon and stays there: Obsidian's
     own pin flag keeps the next opened file from replacing it, CSS takes away the
     close button (see 01-core.css), and the watchdog below reopens it if something
     detaches it anyway — Ctrl+W, "Close others", a workspace switch. Toggled from
     each page's tab menu (onPaneMenu) or in Settings → Dashboard. */
  pinnableTabs() {
    return [
      { key: 'home',     type: HOME_VIEW,     cls: 'nx-pin-home',  label: NX_MODULES.homepage.name,
        on: () => this.settings.homepage.enabled,      open: () => this.openHomepage() },
      { key: 'galaxy',   type: GALAXY_VIEW,   cls: 'nx-pin-galaxy', label: NX_MODULES.galaxy.name,
        on: () => this.settings.galaxy.enabled,        open: () => this.openGalaxy() },
      // A tab of its own, never the active one: openCaptureHub takes over the
      // current leaf, which the watchdog must not do to an open note.
      { key: 'captures', type: CAPTURE_VIEW,  cls: 'nx-pin-captures', label: 'Capture hub',
        on: () => true,
        open: () => this.app.workspace.getLeaf(true).setViewState({ type: CAPTURE_VIEW, active: true }) },
    ];
  }
  isTabPinned(key) { return !!(this.settings.pinnedTabs || {})[key]; }
  async setTabPinned(key, on) {
    this.settings.pinnedTabs = Object.assign({}, this.settings.pinnedTabs, { [key]: !!on });
    await this.saveSettings();
    this.applyPinnedTabs();
    if (on) { const e = this.pinnableTabs().find(p => p.key === key); if (e) e.open(); }
  }
  applyPinnedTabs() {
    this.pinnableTabs().forEach(p => {
      const on = this.isTabPinned(p.key) && p.on();
      document.body.classList.toggle(p.cls, on);
      this.app.workspace.getLeavesOfType(p.type).forEach(leaf => {
        try { if (leaf.setPinned) leaf.setPinned(on); } catch (e) {}
        // The icon-only look hangs on this class (01-core.css), so one rule set
        // serves every pinnable page instead of one copy per view type.
        if (leaf.tabHeaderEl) leaf.tabHeaderEl.classList.toggle('nx-pinned-tab', on);
      });
    });
  }
  /* Closed anyway? Bring it back once the layout has settled. Debounced, because
     one close fires several layout events, and skipped while unloading — the
     detachLeavesOfType in onunload must not be undone. */
  guardPinnedTabs() {
    if (this._unloading) return;
    window.clearTimeout(this._pinT);
    this._pinT = window.setTimeout(() => {
      if (this._unloading) return;
      this.applyPinnedTabs();
      this.pinnableTabs().forEach(p => {
        if (!this.isTabPinned(p.key) || !p.on()) return;
        if (this.app.workspace.getLeavesOfType(p.type).length) return;
        try { p.open(); } catch (e) {}
      });
    }, 150);
  }
}

module.exports = Tabs;
