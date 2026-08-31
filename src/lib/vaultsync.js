'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · vault sync decisions
 *  Given what is here, what is on the server, and what was here the last time
 *  the two agreed, decide what to do about each file.
 *
 *  Three-way, not two-way, and that is the whole point. Comparing only local
 *  against remote cannot tell a file someone DELETED from a file that has not
 *  ARRIVED yet — so a two-way sync either resurrects everything you delete or
 *  deletes everything you have not downloaded. The third input is a record of
 *  the last agreement, and it makes both cases answerable.
 *
 *  Everything here is pure. The plan is a list of intentions; performing it is
 *  the plugin's job, and keeping the two apart is what makes the rules testable
 *  without a server.
 * ========================================================================== */

/* The record of the last agreement keeps BOTH sides, not one.

   This is not a detail. A file uploaded to a server comes back with the
   server's own modification time, which is not the local one — so a base that
   remembers a single timestamp declares the remote side "changed" on the very
   next run and downloads back what was just uploaded. Every sync would then
   re-transfer every file that had ever been uploaded, for ever. Recording the
   pair each side was last seen at is what makes the comparison mean anything. */
function baseSide(base, side) {
  if (!base) return null;
  // An older state file recorded one entry for both sides; read it as such
  // rather than treating every file as new.
  if (base.local === undefined && base.remote === undefined) return base;
  return base[side] || null;
}

/* Which side changed, judged against what that side looked like last time. */
function changedSince(entry, base) {
  if (!base) return !!entry;                       // it is new
  if (!entry) return true;                         // it is gone
  if (entry.size !== base.size) return true;
  // Modification times cross machines and file systems, so a small difference
  // is not evidence of an edit. Two seconds covers a FAT timestamp's own
  // resolution, which is the coarsest thing likely to be underneath.
  return Math.abs((entry.mtime || 0) - (base.mtime || 0)) > 2000;
}

const ACTIONS = ['upload', 'download', 'deleteRemote', 'deleteLocal', 'conflict', 'none'];

/* One file's verdict.

   The table, in words: if only one side moved, follow it. If both moved the
   same way (both deleted, or both now identical), there is nothing to do. If
   both moved differently, that is a conflict and NOTHING is overwritten
   without saying so — see resolveConflict. */
function decide(path, local, remote, base) {
  const localChanged = changedSince(local, baseSide(base, 'local'));
  const remoteChanged = changedSince(remote, baseSide(base, 'remote'));

  if (!local && !remote) return { path, action: 'none' };
  if (!localChanged && !remoteChanged) return { path, action: 'none' };

  if (localChanged && !remoteChanged) {
    if (!local) return { path, action: 'deleteRemote' };
    return { path, action: 'upload' };
  }
  if (remoteChanged && !localChanged) {
    if (!remote) return { path, action: 'deleteLocal' };
    return { path, action: 'download' };
  }

  // Both moved.
  if (!local && !remote) return { path, action: 'none' };            // both deleted it
  if (!local) return { path, action: 'conflict', reason: 'deleted here, changed on the server' };
  if (!remote) return { path, action: 'conflict', reason: 'changed here, deleted on the server' };
  if (local.size === remote.size && Math.abs((local.mtime || 0) - (remote.mtime || 0)) <= 2000) {
    return { path, action: 'none' };                                  // they agree already
  }
  return { path, action: 'conflict', reason: 'changed on both sides' };
}

/* The full plan. `local` and `remote` are maps of path → {mtime, size}; `base`
   is the same shape, recorded when the two last agreed. */
function planSync(local, remote, base, options) {
  const opts = options || {};
  const skip = opts.skip || (() => false);
  const paths = new Set();
  for (const key of Object.keys(local || {})) paths.add(key);
  for (const key of Object.keys(remote || {})) paths.add(key);
  for (const key of Object.keys(base || {})) paths.add(key);

  const plan = { upload: [], download: [], deleteRemote: [], deleteLocal: [], conflict: [], skipped: [] };
  for (const path of Array.from(paths).sort()) {
    if (skip(path)) { plan.skipped.push(path); continue; }
    const verdict = decide(path, (local || {})[path], (remote || {})[path], (base || {})[path]);
    if (verdict.action === 'none') continue;
    if (verdict.action === 'conflict') plan.conflict.push(verdict);
    else plan[verdict.action].push(verdict);
  }
  return plan;
}

function planSize(plan) {
  return plan.upload.length + plan.download.length
    + plan.deleteRemote.length + plan.deleteLocal.length + plan.conflict.length;
}

/* How a conflict is settled.

   'keepBoth' is the default and the only one that cannot lose work: the local
   copy is set aside under a name that says where it came from, and the server's
   version takes the original path. 'newer' and the two 'prefer' policies exist
   because sometimes you do know which side is right — but they are told to the
   user as what they are, which is a choice to discard something. */
const CONFLICT_POLICIES = [
  { id: 'keepBoth', label: 'Keep both', note: 'The server version wins the file name; yours is kept beside it.' },
  { id: 'newer', label: 'Newer wins', note: 'The older of the two is overwritten.' },
  { id: 'local', label: 'This device wins', note: 'The server version is overwritten.' },
  { id: 'remote', label: 'The server wins', note: 'Your version is overwritten.' },
];

function conflictCopyName(path, deviceLabel, stamp) {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const hasExt = dot > slash;
  const base = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  const tag = String(deviceLabel || 'this device').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'this device';
  return base + ' (conflict ' + tag + ' ' + stamp + ')' + ext;
}

function resolveConflict(verdict, policy, local, remote) {
  const path = verdict.path;
  if (policy === 'local') return { path, act: local ? 'upload' : 'deleteRemote' };
  if (policy === 'remote') return { path, act: remote ? 'download' : 'deleteLocal' };
  if (policy === 'newer') {
    const lt = local ? (local.mtime || 0) : -1;
    const rt = remote ? (remote.mtime || 0) : -1;
    if (lt === rt) return { path, act: 'keepBoth' };   // no way to choose, so do not
    return { path, act: lt > rt ? (local ? 'upload' : 'deleteRemote') : (remote ? 'download' : 'deleteLocal') };
  }
  return { path, act: 'keepBoth' };
}

/* ── What is not synced ──────────────────────────────────────────────────────
   Two lists, and the difference between them is the point of D3.

   ALWAYS excluded: things that describe THIS machine. A workspace layout is
   about the size of a window; carrying it to another device rearranges panes
   someone deliberately arranged. The sync's own state file is excluded for the
   obvious reason.

   Excluded only when config sync is OFF: the whole `.obsidian` folder. With it
   ON, everything in there travels EXCEPT the device-specific files above —
   which is what makes "my settings follow me, my window layout does not"
   possible at all. */
const DEVICE_FILES = [
  '.obsidian/workspace.json',
  '.obsidian/workspace-mobile.json',
  '.obsidian/graph.json',
  '.obsidian/plugins/nexus-suite/sync-state.json',
];
const ALWAYS_SKIP_PARTS = [
  '.git/', '.trash/', '.stfolder/', '.stversions/',
  'node_modules/', '.sync-conflict-', '.DS_Store',
];

function makeSkip(options) {
  const opts = options || {};
  const extra = (opts.exclude || []).map(s => String(s).trim()).filter(Boolean);
  return function skip(path) {
    const p = String(path || '');
    if (!p) return true;
    for (const part of ALWAYS_SKIP_PARTS) if (p.indexOf(part) >= 0) return true;
    for (const file of DEVICE_FILES) if (p === file) return true;
    if (!opts.config && p.indexOf('.obsidian/') === 0) return true;
    for (const pattern of extra) {
      if (pattern.endsWith('/') ? p.indexOf(pattern) === 0 : p === pattern) return true;
      if (pattern.indexOf('*') >= 0) {
        const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$');
        if (re.test(p)) return true;
      }
    }
    return false;
  };
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ── Backups ────────────────────────────────────────────────────────────────
   One archive a day, and only so many kept. Named so that sorting the names
   sorts them by age, which is what makes the rotation a one-liner. */
function backupName(vaultName, isoDate) {
  const safe = String(vaultName || 'vault').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'vault';
  return safe + ' ' + String(isoDate).slice(0, 10) + '.zip';
}
function backupsToDelete(names, keep) {
  const limit = Math.max(1, keep || 30);
  const sorted = names.slice().sort();          // names sort by date
  return sorted.length <= limit ? [] : sorted.slice(0, sorted.length - limit);
}
function needsBackup(lastIso, nowIso) {
  if (!lastIso) return true;
  return String(lastIso).slice(0, 10) !== String(nowIso).slice(0, 10);
}

/* ── Refusing to run ─────────────────────────────────────────────────────────
   A sync that has been pointed at the wrong URL, or at a folder that was
   renamed on the server, sees an empty listing. Every file then looks deleted
   remotely and the plan is to delete the whole vault. That is one typo away at
   all times, so it is checked rather than trusted.

   The rule is deliberately blunt: a run that would delete a lot of files that
   this device did not delete stops and says so. Losing an afternoon to a
   refused sync is recoverable; the other way round is not. */
const DELETE_FLOOR = 10;        // fewer than this is never suspicious
const DELETE_SHARE = 0.34;      // more than a third of what is known is

function safetyCheck(plan, local, remote, base) {
  const known = Object.keys(base || {}).length;
  const remoteCount = Object.keys(remote || {}).length;
  const localCount = Object.keys(local || {}).length;

  if (known > 0 && remoteCount === 0 && localCount > 0) {
    return { safe: false, reason: 'the server folder came back empty while ' + known
      + ' file(s) were expected there — check the URL before syncing, nothing was changed' };
  }
  const deletions = plan.deleteLocal.length;
  if (deletions > DELETE_FLOOR && known > 0 && deletions / known > DELETE_SHARE) {
    return { safe: false, reason: 'this would delete ' + deletions + ' of ' + known
      + ' files here, which looks like the server lost them rather than you removing them — nothing was changed' };
  }
  const removals = plan.deleteRemote.length;
  if (removals > DELETE_FLOOR && known > 0 && removals / known > DELETE_SHARE) {
    return { safe: false, reason: 'this would delete ' + removals + ' of ' + known
      + ' files on the server, which looks like this device lost them rather than you removing them — nothing was changed' };
  }
  return { safe: true };
}

/* What the two sides looked like once they agreed. Both are recorded, for the
   reason baseSide explains. */
function agreement(localEntry, remoteEntry) {
  const side = (e) => (e ? { mtime: e.mtime || 0, size: e.size || 0 } : null);
  return { local: side(localEntry), remote: side(remoteEntry) };
}

module.exports = {
  ACTIONS, CONFLICT_POLICIES, DEVICE_FILES, ALWAYS_SKIP_PARTS,
  DELETE_FLOOR, DELETE_SHARE, safetyCheck, agreement, baseSide,
  changedSince, decide, planSync, planSize,
  conflictCopyName, resolveConflict, makeSkip,
  backupName, backupsToDelete, needsBackup,
};
