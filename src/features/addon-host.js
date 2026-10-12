'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · hosting add-ons
 *  What an add-on (lib/addons.js) can ask of the suite, mixed into the plugin:
 *
 *    const suite = app.plugins.getPlugin('nexus-suite');
 *    const off = suite.registerSettingsPage({
 *      id: 'nexus-vikunja', name: 'Vikunja', sub: '…', icon: 'square-kanban',
 *      display: (containerEl) => { … },
 *    });
 *    // in onunload: off();
 *
 *  The page appears under Add-ons in the suite's settings nav. An add-on that
 *  loads before the suite finds no suite yet: it listens for the workspace
 *  event 'nexus-suite:ready', which the suite triggers at the end of every
 *  onload — also after a reload, when its page list starts empty again.
 * ========================================================================== */

const { AddonManager } = require('../lib/addons.js');

const READY_EVENT = 'nexus-suite:ready';

class AddonHost {
  get addons() {
    if (!this._addons) this._addons = new AddonManager(this);
    return this._addons;
  }

  get settingsPages() {
    if (!this._settingsPages) this._settingsPages = new Map();
    return this._settingsPages;
  }

  registerSettingsPage(page) {
    if (!page || !page.id || typeof page.display !== 'function') throw new Error('a settings page needs an id and a display function');
    this.settingsPages.set(page.id, page);
    this.redrawSettings();
    return () => {
      if (this.settingsPages.get(page.id) !== page) return;
      this.settingsPages.delete(page.id);
      this.redrawSettings();
    };
  }

  /* The one place the settings tab is redrawn from outside. Only when it is
     open and nobody is typing in it: a redraw throws away the field with the
     caret in it — including the one just tabbed into. */
  redrawSettings() {
    const tab = this.settingTab;
    try {
      const shown = tab && tab.containerEl && tab.containerEl.isShown && tab.containerEl.isShown();
      const el = document.activeElement;
      // Typing means a text field; a toggle or button that keeps the focus
      // after a click must not block the redraw it asked for.
      const typing = shown && el && tab.containerEl.contains(el)
        && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && /^(text|password|search|number|email|url|date)$/i.test(el.type || 'text')));
      if (shown && !typing) tab.display();
    } catch (e) { console.warn('[Nexus] re-drawing the settings tab failed:', e); }
  }

  announceReady() {
    try { this.app.workspace.trigger(READY_EVENT, this); }
    catch (e) { console.warn('[Nexus] telling the add-ons the suite is ready failed:', e); }
  }
}

module.exports = AddonHost;
