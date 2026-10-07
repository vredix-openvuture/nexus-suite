'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · a connection
 *  Adding the WebDAV server the vault syncs against. A connection is declared
 *  here and never edited afterwards: the fields that make it up are a unit, and
 *  half-changing one produces something that fails at the next sync instead of
 *  at the moment you typed it. Change one by removing it and adding it again.
 *
 *  Secrets go to localStorage (device-local, never synced); the rest goes to
 *  the per-device store, because a connection is this machine's, not the
 *  vault's. Nothing here is written to a shared setting.
 * ========================================================================== */

const { Modal, Setting, Notice } = require('obsidian');

class NexusAccountModal extends Modal {
  constructor(plugin, onSave) {
    super(plugin.app);
    this.plugin = plugin;
    // Vault sync is the only kind left (the Vikunja accounts went with the
    // tasks module, see docs/removed-features.md).
    this.entry = { label: '', url: '', username: '' };
    this.secret = '';
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-account-modal');
    contentEl.createEl('h3', { text: 'Add a server' });
    this._renderVaultSync(contentEl);

    new Setting(contentEl).setName('Connection').setDesc('Ask the server whether it is there and whether it knows you.')
      .addButton(b => b.setButtonText('Test').setCta().onClick(() => this._test(b)));

    const foot = contentEl.createDiv('nx-account-foot');
    foot.createDiv().style.flex = '1';
    foot.createEl('button', { text: 'Save', cls: 'mod-cta' }).onclick = () => this._save();
  }

  _renderVaultSync(e) {
    new Setting(e).setName('This device is called')
      .setDesc('Shows up in the name of a conflict copy, so you can tell which machine wrote it.')
      .addText(t => t.setPlaceholder(this.plugin.deviceId()).setValue(this.entry.label).onChange(v => this.entry.label = v));
    new Setting(e).setName('Server URL').setDesc('The folder the vault lives in, e.g. https://cloud.example.com/remote.php/dav/files/me/Vault')
      .addText(t => { t.setPlaceholder('https://…').setValue(this.entry.url).onChange(v => this.entry.url = v.trim()); t.inputEl.style.width = '100%'; });
    new Setting(e).setName('User name')
      .addText(t => t.setValue(this.entry.username).onChange(v => this.entry.username = v.trim()));
    new Setting(e).setName('App password').setDesc('Device-local, never synced. Use an app password, not your account password — then losing this device costs you one revocation and nothing else.')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(this.secret).onChange(v => this.secret = v); });
  }

  async _test(btn) {
    btn.setButtonText('Testing…').setDisabled(true);
    try {
      const message = await this.plugin.testConnection(Object.assign({}, this.entry, { secret: this.secret }));
      new Notice('Nexus: ' + message + '.');
    } catch (e) { new Notice('Nexus: ' + (e && e.message ? e.message : 'the test failed.')); }
    finally { btn.setButtonText('Test').setDisabled(false); }
  }

  async _save() {
    if (!this.entry.url) { new Notice('Nexus: a server needs a URL.'); return; }
    this.plugin.setCredential('vaultsync', { username: this.entry.username, secret: this.secret });
    await this.plugin.setDeviceSetting('vaultSyncUrl', this.entry.url);
    await this.plugin.setDeviceSetting('vaultSyncDeviceName', this.entry.label);
    if (this.plugin.vaultSync) this.plugin.vaultSync.schedule();
    new Notice('Server saved: ' + this.entry.url);
    if (this.onSave) this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusAccountModal };
