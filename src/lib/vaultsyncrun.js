'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · running a vault sync
 *  The half of the sync that touches things: reading the vault, talking to the
 *  server, writing files, rotating backups. The decisions all live next door in
 *  vaultsync.js, which is pure — this file only carries them out.
 *
 *  Credentials never go into the vault. They live in localStorage
 *  (plugin.getCredential): data.json is a file in the vault, and the vault is
 *  the thing being synced.
 * ========================================================================== */

const { Notice, TFile, TFolder, moment } = require('obsidian');
const sync = require('./vaultsync.js');
const { WebDavClient, joinUrl } = require('./webdav.js');
const { SyncProgress } = require('./syncprogress.js');
const { ensureFolder } = require('./vaultpaths.js');

/* Where backups lived until 2026-10: zips INSIDE the vault folder on the
   server. Still skipped by the sync, and moved out on the first backup run. */
const BACKUP_FOLDER = '_backups';
// Written by the removed "Shared vault" presence notes. Still skipped, so a
// server that has the folder never pulls it into the vault.
const PRESENCE_FOLDER = '_presence';

class NexusVaultSync {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.running = false;
    this.timer = null;
    this.lastReport = null;
  }
  get s() { return this.plugin.settings.vaultSync || {}; }
  get configDir() { return (this.app.vault && this.app.vault.configDir) || '.obsidian'; }
  /* Where this install keeps its settings — from the manifest, so a renamed
     plugin folder or another config folder still gets the merge. */
  get ownSettingsPath() {
    const dir = this.plugin.manifest && this.plugin.manifest.dir;
    return dir ? dir + '/data.json' : sync.OWN_SETTINGS;
  }

  /* The connection and the schedule belong to the DEVICE, not to the vault.
     data.json is synced, so a URL or a device name kept in it is the other
     machine's the moment a sync lands — which is exactly how two devices ended
     up calling themselves the same thing. Everything else on `s` is shared
     policy and stays there. */
  get url() { return this.plugin.deviceSetting('vaultSyncUrl', ''); }
  get deviceName() { return this.plugin.deviceSetting('vaultSyncDeviceName', ''); }
  get onStart() { return this.plugin.deviceSetting('vaultSyncOnStart', true) !== false; }
  get intervalMin() {
    const minutes = parseInt(this.plugin.deviceSetting('vaultSyncIntervalMin', 15), 10);
    return isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  init() {
    const p = this.plugin;
    p.addCommand({ id: 'nexus-sync-now', name: 'Sync the vault now', callback: () => this.syncNow(true) });
    p.addCommand({ id: 'nexus-sync-backup', name: 'Back the vault up to the server now', callback: () => this.backupNow(true) });
    this.schedule();
    // Syncing on start is what makes a second device useful at all: you open it
    // and it is already what you left.
    if (this.s.enabled && this.onStart) {
      this.app.workspace.onLayoutReady(() => window.setTimeout(() => this.syncNow(false), 2500));
    }
  }
  destroy() {
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    // A run stalled on a request would otherwise leave its notice up after unload.
    if (this._progress) this._progress.close();
  }

  schedule() {
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    const minutes = Math.max(1, this.intervalMin);
    if (!this.s.enabled || !this.intervalMin) return;
    this.timer = window.setInterval(() => this.syncNow(false), minutes * 60 * 1000);
  }

  client() {
    const cred = this.plugin.getCredential('vaultsync') || {};
    if (!this.url) throw new Error('no server URL is set — Settings → Vault sync');
    if (!cred.secret && !cred.username) throw new Error('no credentials on this device — Settings → Vault sync');
    return new WebDavClient({ baseUrl: this.url, username: cred.username || '', password: cred.secret || '' });
  }

  /* ── State ────────────────────────────────────────────────────────────────
     The record of the last agreement. It lives in the plugin folder under this
     device's id and is excluded from the sync — a base index that travelled
     between devices would describe someone else's agreement. The old shared
     `sync-state.json` is deliberately NOT read: on a vault that Syncthing also
     carried, it may be another device's, and trusting it would upload stale
     files over newer ones. Starting from nothing is safe now that a first run
     compares bytes instead of calling every file a conflict. */
  get statePath() { return sync.statePath(this.plugin.deviceId()); }
  async readState() {
    try {
      const raw = await this.app.vault.adapter.read(this.statePath);
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed.files === 'object') ? parsed : { files: {}, lastBackup: '' };
    } catch (e) { return { files: {}, lastBackup: '' }; }
  }
  /* The shared state file from before it was per device. Never read (see
     above), so once this device has its own it is only clutter. */
  async dropLegacyState() {
    const legacy = '.obsidian/plugins/nexus-suite/sync-state.json';
    try { if (await this.app.vault.adapter.exists(legacy)) await this.app.vault.adapter.remove(legacy); }
    catch (e) { console.warn('[Nexus] could not remove the old sync-state.json:', e); }
  }
  async writeState(state) {
    try { await this.app.vault.adapter.write(this.statePath, JSON.stringify(state)); }
    catch (e) { console.error('[Nexus] sync state could not be written:', e); }
  }

  /* Everything in the vault, including the dotfolders Obsidian's own file list
     hides — config sync is the whole point of D3, and `getFiles()` cannot see
     `.obsidian`. */
  async localIndex(skip) {
    const adapter = this.app.vault.adapter;
    const out = {};
    const walk = async (folder) => {
      let listing;
      try { listing = await adapter.list(folder); }
      catch (e) { return; }
      for (const file of listing.files) {
        if (skip(file)) continue;
        try {
          const stat = await adapter.stat(file);
          if (stat) out[file] = { mtime: stat.mtime || 0, size: stat.size || 0 };
        } catch (e) { /* a file that vanished mid-walk is simply not in the index */ }
      }
      for (const child of listing.folders) {
        if (skip(child + '/')) continue;
        await walk(child);
      }
    };
    await walk('');
    return out;
  }

  async remoteIndex(client, skip) {
    const entries = await client.listTree('', (path, folder) => {
      if (path === BACKUP_FOLDER || path.indexOf(BACKUP_FOLDER + '/') === 0) return true;
      if (path === PRESENCE_FOLDER || path.indexOf(PRESENCE_FOLDER + '/') === 0) return true;
      return skip(folder ? path + '/' : path);
    });
    const out = {};
    for (const entry of entries) out[entry.path] = { mtime: entry.mtime, size: entry.size };
    return out;
  }

  /* ── The run ───────────────────────────────────────────────────────────── */
  async syncNow(loud) {
    if (this.running) { if (loud) new Notice('Nexus: a sync is already running.'); return null; }
    if (!this.s.enabled) { if (loud) new Notice('Nexus: vault sync is off — Settings → Vault sync.'); return null; }
    this.running = true;
    this._remoteFolders = new Set();
    this._settingsClashes = [];
    this._agreedSettings = undefined;
    this._report = null;
    const started = Date.now();
    // Made inside the try: a notice that cannot be built must not leave
    // `running` set and stop every later run.
    let progress = null;
    try {
      progress = this.makeProgress();
      this._progress = progress;
      const client = this.client();
      const skip = sync.makeSkip({ config: !!this.s.config, exclude: this.s.exclude || [] });
      const state = await this.readState();
      this._state = state;
      const [local, remote] = await Promise.all([this.localIndex(skip), this.remoteIndex(client, skip)]);
      const plan = sync.planSync(local, remote, state.files, { skip });
      /* A wrong URL, or a folder renamed on the server, comes back as an empty
         listing — and every file then looks deleted remotely. Refusing is the
         only safe answer: a refused sync costs an afternoon, the other way
         round costs the vault. */
      const safety = sync.safetyCheck(plan, local, remote, state.files);
      if (!safety.safe) {
        new Notice('Nexus: sync stopped — ' + safety.reason + '.');
        return { blocked: safety.reason };
      }
      progress.plan(plan.download.length + plan.deleteLocal.length + plan.compare.length + plan.conflict.length,
        plan.upload.length + plan.deleteRemote.length);
      const report = await this.apply(client, plan, local, remote, state, progress);
      progress.status('Recording what both sides hold now…');
      await this.reconcile(client, report, state, skip);
      await this.recordSettingsBase(state, report, skip);
      report.settingsClashes = this._settingsClashes;
      // Saved before the backup: the backup is one large upload and the likeliest
      // thing to fail, and losing the record of what was just synced turned the
      // next run into a conflict on every file.
      await this.writeState(state);
      report.seconds = Math.round((Date.now() - started) / 100) / 10;
      this.lastReport = report;
      await this.dropLegacyState();
      progress.close();
      if (this.s.backup) await this.tryBackup(client, state, report);
      // A file that fails on every run is announced once, not every minute.
      const failedKey = report.errors.join('|');
      const newFailure = report.failed > 0 && failedKey !== this._lastFailedKey;
      this._lastFailedKey = failedKey;
      if (loud || report.conflicts || newFailure || report.backupError || report.settingsClashes.length) new Notice('Nexus: ' + this.describe(report));
      return report;
    } catch (err) {
      const message = err && err.message ? err.message : 'unknown error';
      new Notice('Nexus: sync failed — ' + message);
      return { error: message };
    } finally {
      if (progress) progress.close();
      this._progress = null;
      this.running = false;
    }
  }

  // Shown on every run, scheduled or not; tests swap in a silent one.
  makeProgress() { return new SyncProgress(); }

  describe(report) {
    if (!report) return 'nothing happened.';
    const bits = [];
    if (report.uploaded) bits.push(report.uploaded + ' up');
    if (report.downloaded) bits.push(report.downloaded + ' down');
    if (report.deleted) bits.push(report.deleted + ' removed');
    if (report.conflicts) bits.push(report.conflicts + ' conflict' + (report.conflicts === 1 ? '' : 's'));
    if (report.failed) bits.push(report.failed + ' failed (details in the console)');
    let text = bits.length ? 'sync done — ' + bits.join(', ') + '.' : 'sync done, nothing to do.';
    if (report.copies && report.copies.length) {
      text += ' Your side of ' + (report.copies.length === 1 ? 'the conflict is at "' + report.copies[0] + '".'
        : 'each conflict is kept beside it, e.g. "' + report.copies[0] + '".');
    }
    if (report.backupError) text += ' The daily backup failed: ' + report.backupError + '.';
    if (report.settingsClashes && report.settingsClashes.length) {
      text += ' Settings changed on this device and another one; the other device\'s are kept for: '
        + report.settingsClashes.slice(0, 5).join(', ') + (report.settingsClashes.length > 5 ? ' …' : '') + '.';
    }
    return text;
  }

  async apply(client, plan, local, remote, state, progress) {
    const report = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, failed: 0, errors: [], copies: [], failedPaths: new Set() };
    this._report = report;
    const fail = (path, err) => {
      report.failed++;
      report.failedPaths.add(path);
      const why = (err && err.message ? err.message : 'unknown');
      // Every one of them goes to the console, not only the first five. A run
      // that fails on hundreds of files is exactly the run whose report is too
      // small to say why, and on mobile the console is the only way in.
      console.error('[Nexus] sync failed on "' + path + '": ' + why);
      if (report.errors.length < 5) report.errors.push(path + ': ' + why);
    };
    // Which paths ended up in agreement; what each side actually looks like
    // afterwards is read back below, because the server stamps its own time on
    // an upload and guessing at it is what makes a sync loop.
    const settled = new Set();

    // Pull (server → device) first, then push: what arrives is in place before
    // anything of this device's goes up.
    for (const item of plan.download) {
      try { await this.download(client, item.path); report.downloaded++; settled.add(item.path); }
      catch (e) { fail(item.path, e); }
      progress.step('pull');
    }
    for (const item of plan.deleteLocal) {
      try { await this.removeLocal(item.path); report.deleted++; delete state.files[item.path]; }
      catch (e) { fail(item.path, e); }
      progress.step('pull');
    }
    for (const path of plan.adopt || []) state.files[path] = sync.agreement(local[path], remote[path]);
    for (const item of plan.compare || []) {
      try {
        if (await this.sameBytes(client, item.path)) { state.files[item.path] = sync.agreement(local[item.path], remote[item.path]); continue; }
        if (await this.settle(client, item, local, remote, state, report) !== 'config') report.conflicts++;
        settled.add(item.path);
      } catch (e) { fail(item.path, e); }
      finally { progress.step('pull'); }
    }
    // Conflicts count under pulling even when settling one also uploads: they
    // start from what the server has.
    for (const item of plan.conflict) {
      try {
        // A config file settled without a copy is not announced as a conflict:
        // there is nothing for anybody to look at.
        if (await this.settle(client, item, local, remote, state, report) !== 'config') report.conflicts++;
        settled.add(item.path);
      } catch (e) { fail(item.path, e); }
      progress.step('pull');
    }
    for (const item of plan.upload) {
      try { await this.upload(client, item.path); report.uploaded++; settled.add(item.path); }
      catch (e) { fail(item.path, e); }
      progress.step('push');
    }
    for (const item of plan.deleteRemote) {
      try { await client.remove(item.path); report.deleted++; delete state.files[item.path]; }
      catch (e) { fail(item.path, e); }
      progress.step('push');
    }
    report.settled = settled;
    return report;
  }

  /* Record what the two sides look like NOW for everything that moved. Read
     back rather than assumed: after a PUT the server holds its own modification
     time, and a base that stored the local one would call the remote side
     changed on the next run and download the file straight back. */
  async reconcile(client, report, state, skip) {
    if (!report.settled || !report.settled.size) return;
    const [local, remote] = await Promise.all([this.localIndex(skip), this.remoteIndex(client, skip)]);
    for (const path of report.settled) {
      if (!local[path] && !remote[path]) { delete state.files[path]; continue; }
      state.files[path] = sync.agreement(local[path], remote[path]);
    }
  }

  /* Whether this device and the server hold the same bytes for a path whose
     sizes match but whose times do not. One download per such file; on a first
     run that is the price of not copying the whole vault into conflict files. */
  async sameBytes(client, path) {
    const res = await client.get(path);
    if (!res) return false;
    const theirs = new Uint8Array(res.arrayBuffer);
    const mine = new Uint8Array(await this.app.vault.adapter.readBinary(path));
    if (theirs.length !== mine.length) return false;
    for (let i = 0; i < mine.length; i++) if (mine[i] !== theirs[i]) return false;
    return true;
  }

  async upload(client, path) {
    const adapter = this.app.vault.adapter;
    const folder = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) await this.ensureRemoteFolder(client, folder);
    const buffer = await adapter.readBinary(path);
    await client.put(path, buffer);
    // The settings file as it went up is what both sides now hold: the base of
    // the next merge (recordSettingsBase).
    if (path === this.ownSettingsPath) {
      try { this._agreedSettings = JSON.parse(new TextDecoder().decode(buffer)); } catch (e) { this._agreedSettings = undefined; }
    }
  }

  /* The same folder is not created once per file in it.

     `ensureFolder` walks the path with one MKCOL per segment, so a first upload
     of a vault with two hundred folders and two thousand files spent thousands
     of requests re-creating folders that were made moments earlier — slow
     everywhere, and on a server that rate-limits, a wall of failures that has
     nothing to do with the files. Remembered per run only, so a folder deleted
     between two syncs is still created again. */
  async ensureRemoteFolder(client, folder) {
    if (!this._remoteFolders) this._remoteFolders = new Set();
    if (this._remoteFolders.has(folder)) return;
    await client.ensureFolder(folder);
    let at = '';
    for (const part of String(folder).split('/')) {
      if (!part) continue;
      at = at ? at + '/' + part : part;
      this._remoteFolders.add(at);          // every parent exists too, by definition
    }
  }
  async download(client, path) {
    const res = await client.get(path);
    if (!res) throw new Error('the server no longer has it');
    if (path === this.ownSettingsPath && typeof this.plugin.adoptIncomingSettings === 'function') {
      await this.adoptSettings(client, path, res.arrayBuffer);
      return;
    }
    const folder = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) await this.ensureLocalFolder(folder);
    await this.app.vault.adapter.writeBinary(path, res.arrayBuffer);
  }

  /* The plugin's own data.json is merged, not written over (the plugin's
     adoptIncomingSettings, lib/devicesettings.js mergeIncoming), against the
     copy both sides last agreed on. When the merged file holds something the
     server's did not — this device's bag, a setting changed here — it goes
     straight back up. A server copy that is not a settings object at all is
     replaced by this device's, rather than failing on every run for ever. */
  async adoptSettings(client, path, bytes) {
    let incoming = null;
    try { incoming = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { incoming = null; }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      console.warn('[Nexus] sync: the server\'s "' + path + '" is not a settings file; this device\'s copy replaces it.');
      await this.upload(client, path);
      return;
    }
    const base = (this._state && this._state.settingsBase) || undefined;
    const result = await this.plugin.adoptIncomingSettings(incoming, base);
    /* Without an agreed copy there is nothing both sides changed FROM — on a
       device's first run every difference from its defaults would be listed
       as a clash. The server's values still win; they are just not announced. */
    if (base && result && result.clashes && result.clashes.length) this._settingsClashes.push(...result.clashes);
    this._agreedSettings = incoming;
    if (result && result.sendBack) {
      await this.upload(client, path);          // sets _agreedSettings to what went up
      if (this._report) this._report.uploaded++;
    }
  }

  /* The settings file as both sides now agree on it — the base of the next
     merge. Taken from the bytes that actually crossed this run, or, when the
     file did not move, from the local copy only while it still matches the
     record of the last agreement. Never from a file this run did not carry
     (config sync off) or that failed: a base that holds a change the other
     side never saw makes that change look agreed, and the next merge throws it
     away. */
  async recordSettingsBase(state, report, skip) {
    const path = this.ownSettingsPath;
    if ((skip && skip(path)) || (report.failedPaths && report.failedPaths.has(path))) return;
    if (this._agreedSettings !== undefined) { state.settingsBase = this._agreedSettings; return; }
    const record = sync.baseSide(state.files && state.files[path], 'local');
    if (!record) return;
    try {
      const stat = await this.app.vault.adapter.stat(path);
      if (!stat || stat.size !== record.size || Math.abs((stat.mtime || 0) - (record.mtime || 0)) > 2000) return;
      if (!state.settingsBase) state.settingsBase = JSON.parse(await this.app.vault.adapter.read(path));
    } catch (e) { /* no base is a safe base: differences are reported next time */ }
  }

  // One segment at a time: the mobile adapter refuses a missing parent.
  ensureLocalFolder(folder) { return ensureFolder(this.app.vault.adapter, folder); }

  async removeLocal(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile || file instanceof TFolder) {
      // Through the vault, so it lands in Obsidian's trash rather than being
      // gone: a sync deleting the wrong file has to be recoverable.
      await this.app.vault.trash(file, true);
      return;
    }
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(path)) await adapter.remove(path);
  }

  async settle(client, verdict, local, remote, state, report) {
    /* A path with no record has never been synced from here — the first run of
       a device, or the first after the state file became per device. Its "newer"
       side is then a guess (the server's time is the upload's, not the edit's),
       so no policy may discard anything: both are kept. */
    const known = !!(state.files && state.files[verdict.path]);
    if (sync.isConfigPath(verdict.path, this.configDir)) return this.settleConfig(client, verdict, known, local, remote, report);
    const policy = known ? (this.s.conflict || 'keepBoth') : 'keepBoth';
    const outcome = sync.resolveConflict(verdict, policy, local[verdict.path], remote[verdict.path]);
    if (outcome.act === 'upload') { await this.upload(client, verdict.path); return; }
    if (outcome.act === 'download') { await this.download(client, verdict.path); return; }
    if (outcome.act === 'deleteRemote') { await client.remove(verdict.path); delete state.files[verdict.path]; return; }
    if (outcome.act === 'deleteLocal') { await this.removeLocal(verdict.path); delete state.files[verdict.path]; return; }

    // keepBoth: this device's copy is set aside under a name that says where it
    // came from, then the server's version takes the original path.
    const stamp = moment().format('YYYY-MM-DD HHmm');
    const label = this.deviceName || this.plugin.deviceId();
    const copy = sync.conflictCopyName(verdict.path, label, stamp);
    const adapter = this.app.vault.adapter;
    if (local[verdict.path] && await adapter.exists(verdict.path)) {
      const buffer = await adapter.readBinary(verdict.path);
      await adapter.writeBinary(copy, buffer);
      await client.put(copy, buffer);
      if (report) report.copies.push(copy);
    }
    if (remote[verdict.path]) await this.download(client, verdict.path);
    else await this.removeLocal(verdict.path);
    // One Notice for the whole run (see describe), not one per file: a run
    // with two hundred conflicts buried the screen under two hundred toasts.
    console.warn('[Nexus] sync conflict on "' + verdict.path + '" — this device\'s copy is at "' + copy + '".');
  }

  /* A config file is settled without a copy (vaultsync.configConflict says
     why). The plugin's own settings always come down when the server has them:
     the download merges, keeps this device's bag, and sends the result back if
     the server's copy lacked it. Returns 'config' so the run does not announce
     a conflict nobody has anything to look at; it counts as a transfer. */
  async settleConfig(client, verdict, known, local, remote, report) {
    const path = verdict.path;
    let act = sync.configConflict(verdict, known, local[path], remote[path]).act;
    if (path === this.ownSettingsPath && remote[path]) act = 'download';
    if (act === 'upload') await this.upload(client, path);
    else await this.download(client, path);
    // Counted as the transfer it was, so a run that merged settings does not
    // report that nothing happened.
    if (report) report[act === 'upload' ? 'uploaded' : 'downloaded']++;
    console.info('[Nexus] sync: config file "' + path + '" changed on both sides, took the ' + (act === 'upload' ? 'local' : 'server') + ' copy.');
    return 'config';
  }

  /* ── Backups ───────────────────────────────────────────────────────────── */
  /* A failed backup is reported, never fatal: the files are already synced and
     their record saved. The day is not marked as backed up, so the next run
     tries again. */
  async tryBackup(client, state, report) {
    try {
      await this.maybeBackup(client, state);
      await this.writeState(state);
    } catch (err) {
      report.backupError = err && err.message ? err.message : 'unknown error';
      console.error('[Nexus] daily backup failed:', err);
    }
  }
  async maybeBackup(client, state) {
    const today = moment().format('YYYY-MM-DD');
    if (!sync.needsBackup(state.lastBackup, today)) return;
    await this.backup(client, false);
    state.lastBackup = today;
  }
  async backupNow(loud) {
    if (!this.s.enabled) { new Notice('Nexus: vault sync is off — Settings → Vault sync.'); return; }
    try {
      const client = this.client();
      const name = await this.backup(client, true);
      const state = await this.readState();
      state.lastBackup = moment().format('YYYY-MM-DD');
      await this.writeState(state);
      if (loud) new Notice('Nexus: backed up to ' + name + '.');
    } catch (err) {
      new Notice('Nexus: the backup failed — ' + (err && err.message ? err.message : 'unknown error'));
    }
  }
  /* The server copies the vault folder into "<folder>-backup/<date>". Every
     device asks after its first sync of the day; the first one makes it, the
     others find it there — one snapshot a day, not one per device.

     The copy goes to "<date>.partial-<device>" and only becomes "<date>" once
     it finished. A copy cut off by a proxy timeout or a full quota stays a
     .partial and is cleaned up later; a folder named by its date alone is
     always complete. A manual backup carries the time, so it never collides
     with the daily one. */
  async backup(client, manual) {
    const root = sync.backupFolderUrl(client.baseUrl);
    if (!root) throw new Error('the vault folder is the top of the WebDAV space, so there is no folder beside it for backups — sync the vault into a subfolder');
    const store = this.backupStore(client, root);
    const made = await store.request('MKCOL', '');
    if (!(made.status >= 200 && made.status < 300) && made.status !== 405 && made.status !== 301) {
      throw new Error('creating the backup folder ' + root + ' failed with ' + made.status);
    }
    if (!(await this.moveOldBackups(client, root))) {
      // Copying now would put the leftover zips into every snapshot.
      throw new Error('old backups in "' + BACKUP_FOLDER + '" could not all be moved to the backup folder; they were left where they are');
    }
    const now = moment();
    const today = now.format('YYYY-MM-DD');
    const name = sync.backupName(today, manual ? now.format('HHmm') : '');
    const label = decodeURIComponent(client.baseUrl.split('/').pop()) + '-backup/' + name;
    await this.dropStalePartials(store, today);
    if (!manual && await store.has(name)) return label;
    const partial = name + '.partial-' + this.plugin.deviceId();
    if (!(await client.copy('', joinUrl(root, partial)))) {
      // This device's own leftover from a run that died: replace it.
      await store.remove(partial);
      await client.copy('', joinUrl(root, partial));
    }
    if (!(await store.move(partial, joinUrl(root, name)))) await store.remove(partial);   // another device finished first
    await this.rotate(store);
    return label;
  }
  // A client rooted at the backup folder, so its listing reads as names.
  backupStore(client, root) {
    return new WebDavClient({ baseUrl: root, username: client.username, password: client.password });
  }
  /* A partial copy from an earlier day, or this device's from today, is a
     backup that never finished. Another device's from today may still be
     running and is left alone. */
  async dropStalePartials(store, today) {
    let listing;
    try { listing = await store.list(''); }
    catch (e) { return; }
    const mine = '.partial-' + this.plugin.deviceId();
    for (const entry of listing) {
      const n = entry.path.split('/').pop();
      const at = n.indexOf('.partial-');
      if (at < 0) continue;
      if (n.slice(0, 10) < today || n.slice(at) === mine) {
        try { await store.remove(n); } catch (e) { /* tried again next time */ }
      }
    }
  }
  /* The zips from before 2026-10 move to the new place once, so the rotation
     sees them and the vault folder holds only the vault. "_backups" is only
     removed once everything in it moved: a subfolder, or a zip whose name is
     already taken beside, stays where it is. */
  async moveOldBackups(client, root) {
    let old;
    try { old = await client.list(BACKUP_FOLDER); }
    catch (e) { console.warn('[Nexus] could not look into the old "' + BACKUP_FOLDER + '":', e); return false; }
    let allMoved = true;
    for (const entry of old) {
      if (entry.folder) { allMoved = false; continue; }
      const name = entry.path.split('/').pop();
      try { if (!(await client.move(entry.path, joinUrl(root, name)))) allMoved = false; }
      catch (e) { console.warn('[Nexus] could not move the old backup "' + name + '":', e); allMoved = false; }
    }
    if (old.length && allMoved) {
      try { await client.remove(BACKUP_FOLDER); } catch (e) { /* an empty folder left behind costs nothing */ }
    }
    return allMoved;
  }
  async rotate(store) {
    const keep = Math.max(1, parseInt(this.s.keepBackups, 10) || 30);
    let listing;
    try { listing = await store.list(''); }
    catch (e) { return; }
    const names = listing.map(e => e.path.split('/').pop()).filter(n => sync.backupDate(n));
    for (const name of sync.backupsToDelete(names, keep)) {
      try { await store.remove(name); }
      catch (e) { /* a backup that will not delete is not worth failing the run over */ }
    }
  }
}

module.exports = { NexusVaultSync, BACKUP_FOLDER, PRESENCE_FOLDER };
