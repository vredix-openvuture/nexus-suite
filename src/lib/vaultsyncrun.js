'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · running a vault sync
 *  The half of the sync that touches things: reading the vault, talking to the
 *  server, writing files, rotating backups. The decisions all live next door in
 *  vaultsync.js, which is pure — this file only carries them out.
 *
 *  Credentials never go into the vault. They live in localStorage next to the
 *  task-account ones (plugin.getCredential), for the same reason: data.json is
 *  a file in the vault, and the vault is the thing being synced.
 * ========================================================================== */

const { Notice, TFile, TFolder, moment } = require('obsidian');
const sync = require('./vaultsync.js');
const zip = require('./zip.js');
const { WebDavClient } = require('./webdav.js');

const STATE_PATH = '.obsidian/plugins/nexus-suite/sync-state.json';
const BACKUP_FOLDER = '_backups';
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
  destroy() { if (this.timer) { window.clearInterval(this.timer); this.timer = null; } }

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
     The record of the last agreement. It lives in the plugin folder and is
     itself excluded from the sync — a base index that travelled between devices
     would describe someone else's agreement. */
  async readState() {
    try {
      const raw = await this.app.vault.adapter.read(STATE_PATH);
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed.files === 'object') ? parsed : { files: {}, lastBackup: '' };
    } catch (e) { return { files: {}, lastBackup: '' }; }
  }
  async writeState(state) {
    try { await this.app.vault.adapter.write(STATE_PATH, JSON.stringify(state)); }
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
    const started = Date.now();
    try {
      const client = this.client();
      const skip = sync.makeSkip({ config: !!this.s.config, exclude: this.s.exclude || [] });
      const state = await this.readState();
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
      const report = await this.apply(client, plan, local, remote, state);
      await this.reconcile(client, report, state, skip);
      report.seconds = Math.round((Date.now() - started) / 100) / 10;
      this.lastReport = report;
      if (this.s.backup) await this.maybeBackup(client, state, skip);
      await this.writeState(state);
      if (loud || report.conflicts) new Notice('Nexus: ' + this.describe(report));
      return report;
    } catch (err) {
      const message = err && err.message ? err.message : 'unknown error';
      new Notice('Nexus: sync failed — ' + message);
      return { error: message };
    } finally {
      this.running = false;
    }
  }

  describe(report) {
    if (!report) return 'nothing happened.';
    const bits = [];
    if (report.uploaded) bits.push(report.uploaded + ' up');
    if (report.downloaded) bits.push(report.downloaded + ' down');
    if (report.deleted) bits.push(report.deleted + ' removed');
    if (report.conflicts) bits.push(report.conflicts + ' conflict' + (report.conflicts === 1 ? '' : 's'));
    if (report.failed) bits.push(report.failed + ' failed');
    return bits.length ? 'sync done — ' + bits.join(', ') + '.' : 'sync done, nothing to do.';
  }

  async apply(client, plan, local, remote, state) {
    const report = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, failed: 0, errors: [] };
    const fail = (path, err) => {
      report.failed++;
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

    for (const item of plan.upload) {
      try { await this.upload(client, item.path); report.uploaded++; settled.add(item.path); }
      catch (e) { fail(item.path, e); }
    }
    for (const item of plan.download) {
      try { await this.download(client, item.path); report.downloaded++; settled.add(item.path); }
      catch (e) { fail(item.path, e); }
    }
    for (const item of plan.deleteRemote) {
      try { await client.remove(item.path); report.deleted++; delete state.files[item.path]; }
      catch (e) { fail(item.path, e); }
    }
    for (const item of plan.deleteLocal) {
      try { await this.removeLocal(item.path); report.deleted++; delete state.files[item.path]; }
      catch (e) { fail(item.path, e); }
    }
    for (const item of plan.conflict) {
      try { await this.settle(client, item, local, remote, state); report.conflicts++; settled.add(item.path); }
      catch (e) { fail(item.path, e); }
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

  async upload(client, path) {
    const adapter = this.app.vault.adapter;
    const folder = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) await this.ensureRemoteFolder(client, folder);
    const buffer = await adapter.readBinary(path);
    await client.put(path, buffer);
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
    const folder = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) await this.ensureLocalFolder(folder);
    await this.app.vault.adapter.writeBinary(path, res.arrayBuffer);
  }

  /* Create a folder and every parent it needs, one segment at a time.

     `adapter.mkdir` is NOT the same call on both platforms: asked for
     "Tasks/Items" where "Tasks" does not exist yet, the desktop creates both
     and the mobile adapter refuses. So the device that downloads a vault it
     does not have yet — the second device, which is the whole point of the
     sync — failed on every file in a folder deeper than one level, while the
     device that uploads never noticed. The rest of the plugin already builds
     folders this way (`kanban.ensureFolder`, `plugin.ensureFolderPath`); the
     sync was the one place that did not. */
  async ensureLocalFolder(folder) {
    const adapter = this.app.vault.adapter;
    let at = '';
    for (const part of String(folder || '').split('/')) {
      if (!part) continue;
      at = at ? at + '/' + part : part;
      if (await adapter.exists(at)) continue;
      try { await adapter.mkdir(at); }
      catch (e) {
        // Two files in the same new folder race each other; the loser only has
        // to care if the folder is still not there afterwards.
        if (!(await adapter.exists(at))) throw new Error('could not create the folder "' + at + '": ' + (e && e.message ? e.message : 'unknown'));
      }
    }
  }
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

  async settle(client, verdict, local, remote, state) {
    const policy = this.s.conflict || 'keepBoth';
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
    }
    if (remote[verdict.path]) await this.download(client, verdict.path);
    else await this.removeLocal(verdict.path);
    new Notice('Nexus: conflict on "' + verdict.path + '" — your copy is at "' + copy + '".');
  }

  /* ── Backups ───────────────────────────────────────────────────────────── */
  async maybeBackup(client, state, skip) {
    const today = moment().format('YYYY-MM-DD');
    if (!sync.needsBackup(state.lastBackup, today)) return;
    await this.backup(client, skip);
    state.lastBackup = today;
  }
  async backupNow(loud) {
    if (!this.s.enabled) { new Notice('Nexus: vault sync is off — Settings → Vault sync.'); return; }
    try {
      const client = this.client();
      const skip = sync.makeSkip({ config: !!this.s.config, exclude: this.s.exclude || [] });
      const name = await this.backup(client, skip);
      const state = await this.readState();
      state.lastBackup = moment().format('YYYY-MM-DD');
      await this.writeState(state);
      if (loud) new Notice('Nexus: backed up as ' + name + '.');
    } catch (err) {
      new Notice('Nexus: the backup failed — ' + (err && err.message ? err.message : 'unknown error'));
    }
  }
  async backup(client, skip) {
    const adapter = this.app.vault.adapter;
    const index = await this.localIndex(skip);
    const entries = [];
    for (const path of Object.keys(index)) {
      try { entries.push({ name: path, data: new Uint8Array(await adapter.readBinary(path)), date: new Date(index[path].mtime) }); }
      catch (e) { /* a file that cannot be read is left out rather than failing the archive */ }
    }
    const archive = await zip.zipArchive(entries);
    const name = sync.backupName(this.app.vault.getName(), moment().format('YYYY-MM-DD'));
    await client.ensureFolder(BACKUP_FOLDER);
    await client.put(BACKUP_FOLDER + '/' + name, archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength), 'application/zip');
    await this.rotate(client);
    return name;
  }
  async rotate(client) {
    const keep = Math.max(1, parseInt(this.s.keepBackups, 10) || 30);
    let listing;
    try { listing = await client.list(BACKUP_FOLDER); }
    catch (e) { return; }
    const names = listing.filter(e => !e.folder && /\.zip$/i.test(e.path)).map(e => e.path.split('/').pop());
    for (const name of sync.backupsToDelete(names, keep)) {
      try { await client.remove(BACKUP_FOLDER + '/' + name); }
      catch (e) { /* a backup that will not delete is not worth failing the run over */ }
    }
  }

  /* ── Who else is in here ──────────────────────────────────────────────────
     Not live collaboration — see the README for why that needs a server this
     does not have. This is the honest part of the same idea: each device leaves
     a note saying it is here, so a shared vault can warn you that someone else
     is editing rather than letting you find out through a conflict. */
  async announce(client) {
    if (!this.s.shared) return [];
    const id = this.plugin.deviceId();
    const body = JSON.stringify({ device: this.deviceName || id, at: moment().format('YYYY-MM-DDTHH:mm:ss') });
    try {
      await client.ensureFolder(PRESENCE_FOLDER);
      await client.put(PRESENCE_FOLDER + '/' + id + '.json', body, 'application/json');
    } catch (e) { return []; }
    try {
      const listing = await client.list(PRESENCE_FOLDER);
      const others = [];
      for (const entry of listing) {
        if (entry.folder) continue;
        if (entry.path.indexOf(id) >= 0) continue;
        // Older than a quarter of an hour is not "here" any more.
        if (entry.mtime && Date.now() - entry.mtime > 15 * 60 * 1000) continue;
        others.push(entry.path.split('/').pop().replace(/\.json$/, ''));
      }
      return others;
    } catch (e) { return []; }
  }
}

module.exports = { NexusVaultSync, STATE_PATH, BACKUP_FOLDER, PRESENCE_FOLDER };
