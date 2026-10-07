'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings · vault sync and calendar
 *  Settings pages: Vault sync (with its server list) and the mini calendar.
 *  Mixed into the settings tab (lib/mixin.js); `this` is the tab.
 * ========================================================================== */

const { Notice, Setting, moment } = require('obsidian');
const { NexusAccountModal } = require('../modals/account.js');
const vaultsync = require('../lib/vaultsync.js');
const daytext = require('../lib/daytext.js');

class VaultPages {

  /* ── Connections ──────────────────────────────────────────────────────────
     A connection is an ENTRY, not a row of text fields. It is declared once in
     a modal and afterwards only tested or removed: editing it in place lets
     half a connection be saved — a new URL against the old password — and the
     first news of that is a failed sync. To change one, remove it and add it
     again. The vault-sync server is the only kind left; the Vikunja accounts
     that shared this list went with the tasks module (docs/removed-features.md). */
  /* What happens to a secret on THIS device. It is written where the reader is
     about to type one, and it is deliberately unflattering: a padlock that
     overstates itself is worse than no padlock. */
  secretNote(parent) {
    const on = this.plugin.secretsEncrypted();
    const p = parent.createEl('p', { cls: 'setting-item-description' });
    p.createSpan({ text: on
      ? 'Stored on this device only, encrypted with the system keyring — a backup or a stolen disk cannot read it. '
      : 'Stored on this device only, in plain text: there is no keyring here that a plugin can reach. ' });
    p.createSpan({ text: 'Nothing running as you is stopped by this either way, because sync has to open the secret without you. Use a token you can revoke.' });
    return p;
  }

  connectionList(wrap) {
    const paint = () => {
      wrap.empty();
      const list = wrap.createDiv('nx-list');
      const url = this.plugin.deviceSetting('vaultSyncUrl', '');
      const entries = url ? [{ id: 'vaultsync',
        title: this.plugin.deviceSetting('vaultSyncDeviceName', '') || this.plugin.deviceId(),
        sub: 'webdav · ' + url }] : [];

      if (!entries.length) {
        list.createDiv('nx-row').createDiv({ cls: 'nx-row-sub', text: 'No server yet.' });
      }
      entries.forEach(entry => {
        const row = list.createDiv('nx-row');
        const main = row.createDiv('nx-row-main');
        main.createDiv({ cls: 'nx-row-title', text: entry.title });
        main.createDiv({ cls: 'nx-row-sub', text: entry.sub });
        const aside = row.createDiv('nx-row-aside');
        const test = aside.createEl('button', { cls: 'nx-btn is-sm', text: 'Test' });
        test.onclick = async () => {
          test.disabled = true; test.textContent = 'Testing…';
          try { new Notice('Nexus: ' + (await this.plugin.testConnection()) + '.'); }
          catch (err) { new Notice('Nexus: ' + (err && err.message ? err.message : 'the test failed.')); }
          test.disabled = false; test.textContent = 'Test';
        };
        const remove = aside.createEl('button', { cls: 'nx-btn is-sm is-quiet is-danger', text: 'Remove' });
        remove.onclick = async () => { await this.removeConnection(); paint(); };
      });
      // One vault lives on one server, so the sync list stops at one entry.
      if (entries.length) return;
      const add = list.createEl('button', { cls: 'nx-btn nx-list-add', text: 'Add a server' });
      add.onclick = () => new NexusAccountModal(this.plugin, paint).open();
    };
    paint();
  }
  /* Removing a connection takes its credential with it: a stored password for a
     server nothing lists any more is not a convenience, it is a leftover. */
  async removeConnection() {
    this.plugin.setCredential('vaultsync', {});
    /* The vault-wide husks the migration reads from are emptied as well.
       Left behind, a device whose id changed — localStorage cleared, a
       reinstall — would migrate the removed server straight back in. Emptied
       rather than deleted, so the key itself stays recognisable in the file. */
    const legacy = this.plugin.settings.vaultSync;
    legacy.url = '';
    legacy.deviceName = '';
    await this.plugin.setDeviceSetting('vaultSyncUrl', '');
    await this.plugin.setDeviceSetting('vaultSyncDeviceName', '');
    if (this.plugin.vaultSync) this.plugin.vaultSync.schedule();
  }

  tVaultSync(e) {
    const s = this.plugin.settings.vaultSync;   // shared policy only — the connection is per device
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The whole vault to a WebDAV server: Nextcloud, a Synology, or anything else that speaks it. Three-way, so a file you delete stays deleted instead of coming back, and a file you have not downloaded yet is not mistaken for one you removed. Credentials stay on this device and never go into the vault — which matters here more than usual, because the vault is what gets uploaded.' });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Server' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'The server, the user name and this device\'s name belong to THIS device: they are stored under its own key, so a sync carries them nowhere. Every device connects itself. A connection cannot be edited afterwards — remove it and add it again.' });
    this.connectionList(e.createDiv('nx-set-list'));
    this.secretNote(e);

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'When' });
    new Setting(e).setName('Sync on start').setDesc('So a device you pick up is already what you left. Per device.')
      .addToggle(t => t.setValue(this.plugin.deviceSetting('vaultSyncOnStart', true) !== false)
        .onChange(async v => { await this.plugin.setDeviceSetting('vaultSyncOnStart', v); }));
    new Setting(e).setName('Every').setDesc('Minutes between syncs. 0 = only when you ask. Per device — a phone on mobile data and a desktop rarely want the same number.')
      .addText(t => t.setPlaceholder('15').setValue(String(this.plugin.deviceSetting('vaultSyncIntervalMin', 15)))
        .onChange(async v => {
          const minutes = parseInt(v, 10);
          await this.plugin.setDeviceSetting('vaultSyncIntervalMin', isFinite(minutes) && minutes > 0 ? minutes : 0);
          if (this.plugin.vaultSync) this.plugin.vaultSync.schedule();
        }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'What' });
    new Setting(e).setName('Carry the settings too')
      .setDesc('Syncs .obsidian as well, so plugins and themes follow you — except the files that describe THIS machine: the window layout, the mobile layout, the graph view and the sync\'s own state. Those would rearrange panes you deliberately arranged.')
      .addToggle(t => t.setValue(s.config !== false).onChange(async v => { s.config = v; await this.save(); }));
    new Setting(e).setName('Never sync').setDesc('One per line. A trailing slash means a folder; * matches anything.')
      .addTextArea(t => {
        t.inputEl.rows = 3;
        t.setPlaceholder('Archive/\n*.tmp').setValue((s.exclude || []).join('\n'))
          .onChange(async v => { s.exclude = v.split('\n').map(x => x.trim()).filter(Boolean); await this.save(); });
      });

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'When two devices disagree' });
    new Setting(e).setName('Conflicts')
      .setDesc(vaultsync.CONFLICT_POLICIES.map(p => p.label + ': ' + p.note).join(' · '))
      .addDropdown(dd => {
        vaultsync.CONFLICT_POLICIES.forEach(p => dd.addOption(p.id, p.label));
        dd.setValue(s.conflict || 'keepBoth').onChange(async v => { s.conflict = v; await this.save(); });
      });

    /* What the last run actually did, including what it could not do. Without
       this the only trace of a failure was a Notice that had already gone and a
       console the tablet does not have — "thousands of sync errors" with no way
       to see a single one of them. */
    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'The last run' });
    const runBox = e.createDiv('nx-sync-report');
    const paintRun = () => {
      runBox.empty();
      const r = this.plugin.vaultSync && this.plugin.vaultSync.lastReport;
      if (!r) {
        runBox.createDiv({ cls: 'setting-item-description', text: 'Nothing has run on this device since Obsidian started.' });
        return;
      }
      runBox.createDiv({ cls: 'setting-item-description',
        text: this.plugin.vaultSync.describe(r) + (r.seconds ? ' (' + r.seconds + 's)' : '') });
      if (r.blocked) runBox.createDiv({ cls: 'nx-sync-err', text: 'Stopped: ' + r.blocked });
      if (r.error) runBox.createDiv({ cls: 'nx-sync-err', text: 'Failed: ' + r.error });
      (r.errors || []).forEach(line => runBox.createDiv({ cls: 'nx-sync-err', text: line }));
      if (r.failed > (r.errors || []).length) {
        runBox.createDiv({ cls: 'setting-item-description',
          text: 'and ' + (r.failed - r.errors.length) + ' more — every one of them is in the console.' });
      }
    };
    paintRun();
    new Setting(e).setName('Sync now').setDesc('Runs it and shows what happened, right here.')
      .addButton(b => b.setButtonText('Sync').setCta().onClick(async () => {
        if (!this.plugin.vaultSync) return;
        b.setDisabled(true).setButtonText('Syncing…');
        try { await this.plugin.vaultSync.syncNow(true); } finally {
          b.setDisabled(false).setButtonText('Sync');
          paintRun();
        }
      }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Backups' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'One zip a day into _backups on the server, taken after the first sync of the day. The oldest are removed once there are more than you want to keep.' });
    new Setting(e).setName('Daily backup')
      .addToggle(t => t.setValue(s.backup !== false).onChange(async v => { s.backup = v; await this.save(); }));
    new Setting(e).setName('Keep').setDesc('How many archives stay on the server.')
      .addText(t => t.setPlaceholder('30').setValue(String(s.keepBackups == null ? 30 : s.keepBackups))
        .onChange(async v => { const n = parseInt(v, 10); s.keepBackups = isFinite(n) && n > 0 ? n : 30; await this.save(); }));
    new Setting(e).setName('Back up now').setDesc('Does not wait for the daily one.')
      .addButton(b => b.setButtonText('Back up').onClick(() => {
        if (this.plugin.vaultSync) this.plugin.vaultSync.backupNow(true);
      }));

    new Setting(e).setName('Sync now')
      .addButton(b => b.setButtonText('Sync').setCta().onClick(async () => {
        if (!this.plugin.vaultSync) return;
        b.setDisabled(true).setButtonText('Syncing…');
        await this.plugin.vaultSync.syncNow(true);
        b.setDisabled(false).setButtonText('Sync');
      }));
  }
  tCalendar(e) {
    const s = this.plugin.settings.calendar;
    this.head(e, s);
    new Setting(e).setName('Show ribbon icon').setDesc('Reload the plugin after changing.')
      .addToggle(t => t.setValue(s.ribbon).onChange(async v => { s.ribbon = v; await this.save(); }));
    e.createEl('p', { cls: 'setting-item-description', text: 'Uses your Daily Notes settings (folder/format/template). Command "Open calendar".' });
    // The month grid only: the planner block sets its own `weekstart:` line.
    // Obsidian's own locale stays untouched.
    new Setting(e).setName('Week starts on')
      .setDesc('Applies to the mini calendar. A planner block sets its own with a weekstart: line.')
      .addDropdown(d => {
        d.addOption('locale', 'Locale default (' + moment.weekdays()[moment().startOf('week').day()] + ')');
        moment.weekdays().forEach((name, i) => d.addOption(String(i), name));
        d.setValue(s.weekStart == null ? 'locale' : String(s.weekStart));
        d.onChange(async v => { s.weekStart = v; await this.save(); this.plugin.refreshCalendarViews(); });
      });

    // ── The day's text ──
    e.createEl('h4', { text: "The day's text", cls: 'nx-callout-h' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'What a day is for lives in that day\u2019s own note, as one frontmatter field. The planner block writes it; the mini calendar marks the days that have one. Not in a plugin file \u2014 in the note, where Obsidian\u2019s search finds it and a template or a Dataview query can read it.' });
    new Setting(e).setName('Frontmatter key')
      .setDesc('The field the text is written to. Default: important.')
      .addText(t => t.setPlaceholder(daytext.DEFAULT_KEY).setValue(s.dayTextKey || daytext.DEFAULT_KEY)
        .onChange(async v => { s.dayTextKey = (v || '').trim() || daytext.DEFAULT_KEY; await this.save(); this.plugin.refreshCalendarViews(); }));

    // ── The planner block ──
    e.createEl('h4', { text: 'Planner', cls: 'nx-callout-h' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'A \u201cnexus-planner\u201d block renders a whole month of the same day texts, writable in place. It used to keep its lines inside the block; the command below carries any it still holds into the daily notes. It reports what it will do before it writes, never overwrites a day that already has a text, and deletes nothing.' });
    new Setting(e).setName('Old planner lines')
      .setDesc(this.plugin.settings.plannerMigrated
        ? 'Already moved once. Running it again only picks up lines added since.'
        : 'Not moved yet. Blocks that still hold lines are showing the daily notes instead.')
      .addButton(b => b.setButtonText('Move them into the daily notes')
        .onClick(() => this.plugin.migratePlannerLines()));
  }
}

module.exports = VaultPages;
