'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sync engine (three-way, conflict-aware)
 *  Two-way sync between provider tasks (Vikunja REST) and the Markdown notes.
 *  Per item we track three fingerprints:
 *    · remoteTag  — provider `updated` timestamp
 *    · localHash  — FNV-1a over the canonical local fields (no crypto → mobile-safe)
 *    · base       — {localHash, remoteTag} captured at the last successful sync
 *  reconcile() is PURE (unit-tested in Node). The orchestrator applies the
 *  actions and hands genuine collisions to the conflict UI (policy 'ask') or
 *  lets the server win (policy 'server').
 *
 *  Safety (v1): a deleted LOCAL note is RE-CREATED from the server rather than
 *  deleting the remote task — no destructive remote deletes from note absence.
 * ========================================================================== */

const { moment, TFile } = require('obsidian');
const tasks = require('./tasks.js');

/* ── FNV-1a (32-bit) over a string → hex ── */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/* ── canonical, order-stable representation of the diffable fields ── */
const CANON_FIELDS = ['title', 'description', 'due', 'priority', 'done', 'repeat'];
function canonical(t) {
  return CANON_FIELDS.map(k => k + '=' + (k === 'done' ? (t[k] ? '1' : '0') : (t[k] == null ? '' : String(t[k])))).join('\n');
}
function localHash(t) { return fnv1a(canonical(t)); }

/* ── PURE reconcile. Inputs may be null when absent. base = {localHash, remoteTag}|null.
   Returns { action, reason }. action ∈ skip|push|pull|create-local|create-remote|
   delete-local|conflict. ── */
function reconcile(local, remote, base) {
  const hasL = !!local, hasR = !!remote;
  const lHash = hasL ? localHash(local) : null;
  const rTag = hasR ? (remote.updated || '') : null;
  const lChanged = hasL && (!base || lHash !== base.localHash);
  const rChanged = hasR && (!base || rTag !== base.remoteTag);

  if (hasL && hasR) {
    if (!lChanged && !rChanged) return { action: 'skip' };
    if (lChanged && !rChanged) return { action: 'push' };
    if (!lChanged && rChanged) return { action: 'pull' };
    return { action: 'conflict', reason: 'both-changed' };
  }
  if (!hasL && hasR) {
    if (!base) return { action: 'create-local' };          // new remote task
    if (rChanged) return { action: 'conflict', reason: 'local-deleted-vs-remote-changed' };
    return { action: 'create-local', reason: 're-create (local note gone; remote kept — no destructive remote delete)' };
  }
  if (hasL && !hasR) {
    if (!base) return { action: 'create-remote' };          // new local task → push to server
    if (lChanged) return { action: 'conflict', reason: 'remote-deleted-vs-local-changed' };
    return { action: 'delete-local', reason: 'remote task gone' };
  }
  return { action: 'skip' };
}

/* ── strip a leading YAML frontmatter block → body text ── */
function stripFrontmatter(text) {
  const m = text.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? text.slice(m[0].length) : text;
}

/* ── read a synced task note's canonical fields + identity ── */
function readTaskNote(plugin, file) {
  const fm = (plugin.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
  return {
    file, key: file.basename,
    provider: fm['nexus-provider'] || '', account: fm['nexus-account'] || '',
    remoteId: fm['nexus-id'] != null ? String(fm['nexus-id']) : '',
    baseTag: fm['nexus-updated'] || '',
    projectLink: fm['nexus-project'] || '',
    title: fm.title || file.basename,
    description: '',   // filled by caller via read()
    due: fm.due || '', priority: parseInt(fm.priority, 10) || 0,
    done: (fm.status === 'completed' || fm.done === true),
    repeat: fm.repeat || '',
  };
}

/* ── write / overwrite a Vikunja task note ── */
async function writeTaskNote(plugin, remote, projectName) {
  const app = plugin.app;
  const key = 'vk-' + remote.remoteId;
  const path = tasks.taskPath(plugin, key);
  const fm = ['---', 'nexus-type: task', 'nexus-provider: vikunja',
    'nexus-account: ' + (remote.account || ''),
    'nexus-id: ' + remote.remoteId, 'nexus-updated: ' + (remote.updated || ''),
    'nexus-project: "[[' + projectName + ']]"',
    'title: ' + JSON.stringify(remote.title || ''),
    'status: ' + (remote.done ? 'completed' : 'needs-action'),
    'due: ' + (remote.due || ''), 'priority: ' + (remote.priority || 0),
    'repeat: ' + (remote.repeat || ''), '---', '', (remote.description || '')].join('\n');
  let file = app.vault.getAbstractFileByPath(path);
  plugin._taskWriting = true;
  try {
    if (file) await app.vault.modify(file, fm);
    else { await tasks.ensureItemsFolder(plugin); file = await app.vault.create(path, fm); }
  } finally { plugin._taskWriting = false; }
  return { key, file };
}

/* ── base index (per account) under the data dir ── */
const calstore = require('./calstore.js');
function baseIndexPath(plugin, accountId) { return calstore.dataDir(plugin) + '/sync/vikunja-' + accountId + '.base.json'; }
async function loadBase(plugin, accountId) { return (await calstore.readJSON(plugin, baseIndexPath(plugin, accountId))) || {}; }
async function saveBase(plugin, accountId, base) { await calstore.writeJSON(plugin, baseIndexPath(plugin, accountId), base); }

const vik = require('./vikunja.js');

function parseLink(s) { const m = String(s || '').match(/\[\[([^\]|#]+)/); return m ? m[1].trim() : ''; }
function topoSort(projects) {
  const byId = {}; projects.forEach(p => byId[p.remoteId] = p);
  const out = [], seen = new Set();
  const visit = (p) => { if (!p || seen.has(p.remoteId)) return; if (p.parentId && byId[p.parentId]) visit(byId[p.parentId]); seen.add(p.remoteId); out.push(p); };
  projects.forEach(visit); return out;
}
function projIdByName(projName, name) { for (const id in projName) if (projName[id] === name) return id; return null; }

async function rebuildChecklistFor(plugin, projectName, accountId) {
  const app = plugin.app, lines = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(tasks.itemsFolder(plugin) + '/')) continue;
    const n = readTaskNote(plugin, f);
    if (n.provider !== 'vikunja' || (accountId && n.account && n.account !== accountId)) continue;
    if (parseLink(n.projectLink) !== projectName) continue;
    lines.push('- [' + (n.done ? 'x' : ' ') + '] [[' + n.key + '|' + (n.title || n.key) + ']] <!-- nx:' + n.key + ' -->');
  }
  await tasks.rebuildChecklist(plugin, projectName, lines);
}

/* ── Full two-way Vikunja sync. Returns {stats, conflicts}. First sync of an
     account is pure PULL (base is empty → nothing is pushed). ── */
async function syncVikunja(plugin, account, client) {
  const app = plugin.app;
  const base = await loadBase(plugin, account.id);
  const stats = { pulled: 0, pushed: 0, created: 0, deleted: 0, conflicts: 0, skipped: 0 };
  const conflicts = [];

  const projects = (await client.listProjects()).map(vik.mapProjectFromApi).filter(p => !p.archived);
  const projById = {}; projects.forEach(p => projById[p.remoteId] = p);
  const projName = {};
  for (const p of topoSort(projects)) {
    const parentName = p.parentId && projById[p.parentId] ? projName[p.parentId] : null;
    projName[p.remoteId] = await tasks.upsertProject(plugin, { title: p.title, parentName, provider: 'vikunja', remoteId: p.remoteId, account: account.id });
  }

  const remoteTasks = {};
  for (const p of projects) {
    let raw; try { raw = await client.listTasks(p.remoteId); } catch (e) { continue; }
    for (const rt of raw) { const m = vik.mapTaskFromApi(rt); m.account = account.id; remoteTasks[m.remoteId] = m; }
  }

  const localByRemote = {}, localNew = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(tasks.itemsFolder(plugin) + '/')) continue;
    const n = readTaskNote(plugin, f);
    if (n.provider !== 'vikunja' || (n.account && n.account !== account.id)) continue;
    n.description = stripFrontmatter(await app.vault.read(f)).trim();
    if (n.remoteId) localByRemote[n.remoteId] = n; else localNew.push(n);
  }

  const touched = new Set();
  const nameFor = (remote, local) => (remote && projName[remote.projectId]) || (local && parseLink(local.projectLink)) || 'Vikunja';
  const ids = new Set(Object.keys(remoteTasks).concat(Object.keys(localByRemote)));
  for (const id of ids) {
    const remote = remoteTasks[id] || null, local = localByRemote[id] || null, b = base[id] || null;
    const dec = reconcile(local, remote, b);
    const pn = nameFor(remote, local);
    if (dec.action === 'pull' || dec.action === 'create-local') {
      await writeTaskNote(plugin, remote, pn);
      base[id] = { localHash: localHash(remote), remoteTag: remote.updated };
      touched.add(pn); stats[dec.action === 'pull' ? 'pulled' : 'created']++;
    } else if (dec.action === 'push') {
      const updated = await client.updateTask(id, vik.mapTaskToApi(local));
      const m = vik.mapTaskFromApi(updated); m.account = account.id;
      const pn2 = projName[m.projectId] || pn;
      await writeTaskNote(plugin, m, pn2);
      base[id] = { localHash: localHash(m), remoteTag: m.updated };
      touched.add(pn2); stats.pushed++;
    } else if (dec.action === 'delete-local') {
      if (local && local.file) { plugin._taskWriting = true; try { await app.vault.delete(local.file); } catch (e) {} finally { plugin._taskWriting = false; } }
      delete base[id]; touched.add(pn); stats.deleted++;
    } else if (dec.action === 'conflict') {
      conflicts.push({ account: account.id, id, projectName: pn, local, remote, reason: dec.reason }); stats.conflicts++;
    } else { stats.skipped++; }
  }

  for (const n of localNew) {
    const pName = parseLink(n.projectLink);
    const pid = projIdByName(projName, pName);
    if (!pid) continue;
    try {
      const created = await client.createTask(pid, vik.mapTaskToApi(n));
      const m = vik.mapTaskFromApi(created); m.account = account.id;
      if (n.file) { plugin._taskWriting = true; try { await app.vault.delete(n.file); } catch (e) {} finally { plugin._taskWriting = false; } }
      const pn = projName[m.projectId] || pName;
      await writeTaskNote(plugin, m, pn);
      base[m.remoteId] = { localHash: localHash(m), remoteTag: m.updated };
      touched.add(pn); stats.created++;
    } catch (e) { console.error('[Nexus] create remote task failed:', e); }
  }

  for (const pn of touched) await rebuildChecklistFor(plugin, pn, account.id);
  await saveBase(plugin, account.id, base);
  return { stats, conflicts };
}

/* ── apply a single conflict resolution ('server' keeps remote, 'mine' pushes local) ── */
async function applyResolution(plugin, account, client, rec, choice) {
  const base = await loadBase(plugin, account.id);
  if (choice === 'server' && rec.remote) {
    await writeTaskNote(plugin, rec.remote, rec.projectName);
    base[rec.id] = { localHash: localHash(rec.remote), remoteTag: rec.remote.updated };
  } else if (choice === 'mine' && rec.local) {
    const updated = await client.updateTask(rec.id, vik.mapTaskToApi(rec.local));
    const m = vik.mapTaskFromApi(updated); m.account = account.id;
    await writeTaskNote(plugin, m, rec.projectName);
    base[rec.id] = { localHash: localHash(m), remoteTag: m.updated };
  }
  await saveBase(plugin, account.id, base);
  await rebuildChecklistFor(plugin, rec.projectName, account.id);
}

module.exports = {
  fnv1a, canonical, localHash, reconcile, stripFrontmatter, readTaskNote, writeTaskNote,
  loadBase, saveBase, baseIndexPath, CANON_FIELDS,
  syncVikunja, applyResolution, rebuildChecklistFor,
};
