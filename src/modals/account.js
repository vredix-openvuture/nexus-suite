'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · account
 *  Add / edit a CalDAV account. Runs discovery (principal → home-set →
 *  calendars) and lets the user enable individual calendars. Credentials go to
 *  localStorage (device-local, NOT synced); only non-secret config is saved to
 *  data.json. Use an APP PASSWORD, never the primary account password.
 * ========================================================================== */

const { Modal, Setting, Notice, setIcon } = require('obsidian');
const { CalDavClient } = require('../lib/caldav.js');

class NexusAccountModal extends Modal {
  constructor(plugin, account, onSave) {
    super(plugin.app);
    this.plugin = plugin;
    this.acc = account ? JSON.parse(JSON.stringify(account)) : { id: null, kind: 'caldav', label: '', serverUrl: '', username: '', calendars: [] };
    this.onSave = onSave;
    this.password = this.acc.id ? (this.plugin.getCredential(this.acc.id).secret || '') : '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-account-modal');
    contentEl.createEl('h3', { text: this.acc.id ? 'Edit account' : 'Add CalDAV account' });

    new Setting(contentEl).setName('Label').setDesc('e.g. Nextcloud, Vikunja')
      .addText(t => t.setValue(this.acc.label).onChange(v => this.acc.label = v));
    new Setting(contentEl).setName('Server URL').setDesc('Base CalDAV URL (e.g. https://nextcloud.example/remote.php/dav)')
      .addText(t => { t.setValue(this.acc.serverUrl).onChange(v => this.acc.serverUrl = v.trim()); t.inputEl.style.width = '100%'; });
    new Setting(contentEl).setName('Username')
      .addText(t => t.setValue(this.acc.username).onChange(v => this.acc.username = v.trim()));
    new Setting(contentEl).setName('App password').setDesc('An app-specific password (device-local, never synced).')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(this.password).onChange(v => this.password = v); });

    const disc = new Setting(contentEl).setName('Calendars')
      .setDesc('Connect to fetch the calendar list, then enable the ones you want.');
    disc.addButton(b => b.setButtonText('Connect & discover').setCta().onClick(() => this._discover(b)));

    this.calWrap = contentEl.createDiv('nx-account-cals');
    this._renderCalendars();

    const foot = contentEl.createDiv('nx-event-foot');
    const spacer = foot.createDiv(); spacer.style.flex = '1';
    const save = foot.createEl('button', { text: 'Save', cls: 'mod-cta' });
    save.onclick = () => this._save();
  }

  async _discover(btn) {
    if (!this.acc.serverUrl || !this.acc.username || !this.password) { new Notice('Nexus: fill URL, username and password first.'); return; }
    let fsOk = false; try { require('fs'); fsOk = true; } catch (e) {}
    if (!fsOk) { new Notice('Nexus: discovery runs on desktop (mobile reads the synced cache).'); return; }
    btn.setButtonText('Connecting…').setDisabled(true);
    try {
      const client = new CalDavClient({ serverUrl: this.acc.serverUrl, username: this.acc.username, password: this.password });
      const res = await client.discover();
      this.acc.principalHref = res.principalHref;
      this.acc.homeSet = res.homeSet;
      // merge: keep previously-enabled flags by href
      const prev = {}; (this.acc.calendars || []).forEach(c => prev[c.href] = c.enabled);
      this.acc.calendars = res.calendars.map(c => Object.assign(c, { id: c.href, enabled: prev[c.href] != null ? prev[c.href] : true }));
      new Notice('Found ' + this.acc.calendars.length + ' calendars.');
      this._renderCalendars();
    } catch (e) {
      new Notice('Nexus: discovery failed — ' + (e && e.message || e));
    } finally { btn.setButtonText('Connect & discover').setDisabled(false); }
  }

  _renderCalendars() {
    this.calWrap.empty();
    if (!this.acc.calendars || !this.acc.calendars.length) { this.calWrap.createDiv({ cls: 'nx-account-empty', text: 'No calendars yet — connect above.' }); return; }
    this.acc.calendars.forEach(c => {
      const row = this.calWrap.createDiv('nx-account-cal');
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = !!c.enabled;
      cb.onchange = () => c.enabled = cb.checked;
      const sw = row.createSpan('nx-account-swatch'); if (c.color) sw.style.background = c.color;
      row.createSpan({ cls: 'nx-account-calname', text: c.display });
      row.createSpan({ cls: 'nx-account-badge', text: c.component === 'VTODO' ? 'Tasks' : 'Events' });
    });
  }

  async _save() {
    if (!this.acc.label) this.acc.label = this.acc.username || 'CalDAV';
    const accs = this.plugin.settings.tasksCalendar.accounts;
    if (!this.acc.id) { this.acc.id = 'acc-' + Date.now().toString(36); accs.push(this.acc); }
    else { const i = accs.findIndex(a => a.id === this.acc.id); if (i >= 0) accs[i] = this.acc; else accs.push(this.acc); }
    this.plugin.setCredential(this.acc.id, { username: this.acc.username, secret: this.password });
    await this.plugin.saveSettings();
    if (this.onSave) this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusAccountModal };
