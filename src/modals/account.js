'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · a connection
 *  Adding a connection — a Vikunja account, or the WebDAV server the vault
 *  syncs against. Both kinds are declared here and never edited afterwards: the
 *  fields that make up a connection are a unit, and half-changing one produces
 *  something that fails at the next sync instead of at the moment you typed it.
 *  Change one by removing it and adding it again.
 *
 *  Secrets go to localStorage (device-local, never synced); the rest goes to
 *  the per-device store, because a connection is this machine's, not the
 *  vault's. Nothing here is written to a shared setting.
 * ========================================================================== */

const { Modal, Setting, Notice } = require('obsidian');

class NexusAccountModal extends Modal {
  constructor(plugin, connection, onSave) {
    super(plugin.app);
    this.plugin = plugin;
    const given = connection || {};
    this.kind = given.kind === 'vaultsync' ? 'vaultsync' : 'vikunja';
    this.entry = { kind: this.kind, label: '', serverUrl: '', url: '', username: '' };
    this.secret = '';
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-account-modal');
    contentEl.createEl('h3', { text: this.kind === 'vaultsync' ? 'Add a server' : 'Add an account' });

    if (this.kind === 'vaultsync') this._renderVaultSync(contentEl);
    else this._renderVikunja(contentEl);

    new Setting(contentEl).setName('Connection').setDesc('Ask the server whether it is there and whether it knows you.')
      .addButton(b => b.setButtonText('Test').setCta().onClick(() => this._test(b)));

    const foot = contentEl.createDiv('nx-event-foot');
    foot.createDiv().style.flex = '1';
    foot.createEl('button', { text: 'Save', cls: 'mod-cta' }).onclick = () => this._save();
  }

  _renderVikunja(e) {
    new Setting(e).setName('Label').setDesc('What to call it in the list, e.g. Vikunja.')
      .addText(t => t.setValue(this.entry.label).onChange(v => this.entry.label = v));
    new Setting(e).setName('Server URL').setDesc('Vikunja base URL, e.g. https://vikunja.example (no /api needed).')
      .addText(t => { t.setValue(this.entry.serverUrl).onChange(v => this.entry.serverUrl = v.trim()); t.inputEl.style.width = '100%'; });
    new Setting(e).setName('API token').setDesc('A Vikunja API token (Settings → API tokens in Vikunja). Device-local, never synced — so if this device is lost you revoke this one token and no other device notices.')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(this.secret).onChange(v => this.secret = v); });
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
      const message = await this.plugin.testConnection(this.kind, Object.assign({}, this.entry, { secret: this.secret }));
      new Notice('Nexus: ' + message + '.');
    } catch (e) { new Notice('Nexus: ' + (e && e.message ? e.message : 'the test failed.')); }
    finally { btn.setButtonText('Test').setDisabled(false); }
  }

  async _save() {
    if (this.kind === 'vaultsync') {
      if (!this.entry.url) { new Notice('Nexus: a server needs a URL.'); return; }
      this.plugin.setCredential('vaultsync', { username: this.entry.username, secret: this.secret });
      await this.plugin.setDeviceSetting('vaultSyncUrl', this.entry.url);
      await this.plugin.setDeviceSetting('vaultSyncDeviceName', this.entry.label);
      if (this.plugin.vaultSync) this.plugin.vaultSync.schedule();
      new Notice('Server saved: ' + this.entry.url);
    } else {
      if (!this.entry.serverUrl) { new Notice('Nexus: an account needs a server URL.'); return; }
      const account = { id: 'acc-' + Date.now().toString(36), kind: 'vikunja',
        label: this.entry.label || 'Vikunja', serverUrl: this.entry.serverUrl };
      this.plugin.settings.tasksCalendar.accounts.push(account);
      this.plugin.setCredential(account.id, { secret: this.secret });
      await this.plugin.saveSettings();
      new Notice('Account saved: ' + account.label);
    }
    if (this.onSave) this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusAccountModal };
