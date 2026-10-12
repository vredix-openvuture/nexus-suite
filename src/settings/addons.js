'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings · add-ons
 *  The catalogue page (lib/addons.js): one row per add-on with its switch,
 *  the installed and the newest version, update and remove. An enabled add-on
 *  adds its own page under this one in the nav (main.js · registerSettingsPage).
 *  Mixed into the settings tab (lib/mixin.js); `this` is the tab.
 * ========================================================================== */

const { Notice, Setting } = require('obsidian');

class AddonPages {

  tAddons(e) {
    const manager = this.plugin.addons;
    e.createEl('p', { cls: 'setting-item-description', text:
      'Plugins that extend the suite without being part of it. Switching one on downloads its newest release from its '
      + 'GitHub repo into this vault and turns it on; its settings then appear as a page below Add-ons. '
      + 'Keys an add-on needs are kept in this device’s secret storage, never in the vault.' });

    // The busy flag lives on the manager, not on this draw: a redraw (an
    // add-on registering its page while it loads) must not clear it.
    const run = async (addon, what, fn) => {
      try { await fn(); }
      catch (err) { new Notice('Nexus: ' + what + ' ' + addon.name + ' failed — ' + (err && err.message ? err.message : err)); }
      finally { this.plugin.redrawSettings(); }
    };

    manager.list().forEach(addon => {
      const installed = manager.installedVersion(addon.id);
      const on = manager.isEnabled(addon.id);
      const row = new Setting(e).setName(addon.name).setDesc(addon.sub);
      const status = row.descEl.createDiv({ cls: 'nx-addon-status' });
      status.setText(manager.busy.has(addon.id) ? 'Downloading…'
        : installed ? 'Installed: ' + installed + (on ? '' : ' (off)') : 'Not installed');

      // The newest version is asked for once per session, after the page drew.
      manager.latest(addon).then(info => {
        if (!status.isConnected) return;
        if (installed && manager.updateAvailable(addon)) status.setText('Installed: ' + installed + ' · ' + info.version + ' available');
        else if (!installed) status.setText('Not installed · ' + info.version + ' available');
      }, err => { if (status.isConnected) status.setText((installed ? 'Installed: ' + installed + ' · ' : '') + 'GitHub: ' + err.message); });

      if (installed) {
        row.addExtraButton(b => b.setIcon('refresh-cw').setTooltip('Update to the newest release')
          .onClick(() => run(addon, 'updating', async () => {
            const v = await manager.install(addon, false);
            new Notice('Nexus: ' + addon.name + ' ' + v + ' is installed' + (manager.isEnabled(addon.id) ? '.' : ' (still off).'));
          })));
        row.addExtraButton(b => b.setIcon('trash-2').setTooltip('Remove from this vault')
          .onClick(async () => {
            const { NexusConfirmModal } = require('../modals/misc.js');
            const ok = await new NexusConfirmModal(this.app, 'Remove ' + addon.name + '?',
              'It is turned off and its folder deleted, with its settings. What it keeps on this device only (keys, cached data) is forgotten. '
              + 'Pages and notes it made stay in the vault.', 'Remove').openAndGet();
            if (ok) run(addon, 'removing', () => manager.uninstall(addon));
          }));
      }
      row.addToggle(t => t.setValue(on).onChange(v => {
        // A switch flipped while a download runs goes back, instead of
        // showing a state that is not true.
        if (manager.busy.has(addon.id)) { t.setValue(!v); return; }
        if (v) status.setText('Downloading…');
        run(addon, v ? 'installing' : 'turning off', async () => {
          if (!v) { await manager.disable(addon); return; }
          const version = await manager.enable(addon);
          new Notice('Nexus: ' + addon.name + ' ' + version + ' is on.');
        });
      }));
    });
  }
}

module.exports = AddonPages;
