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

const { TFile } = require('obsidian');
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
    baseTag: fm['nexus-updated'] != null ? String(fm['nexus-updated']) : '',
    href: fm['nexus-href'] || '',
    projectLink: fm['nexus-project'] || '',
    title: fm.title || file.basename,
    description: '',   // filled by caller via read()
    due: fm.due || '', priority: parseInt(fm.priority, 10) || 0,
    done: (fm.status === 'completed' || fm.done === true),
    repeat: fm.repeat || '',
  };
}

/* ── find a synced task note by its remote identity (not by file name) ── */
function findTaskNote(plugin, provider, account, remoteId) {
  const items = tasks.itemsFolder(plugin) + '/';
  const want = String(remoteId);
  for (const f of plugin.app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(items)) continue;
    const fm = (plugin.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
    if (fm['nexus-type'] !== 'task' || (fm['nexus-provider'] || '') !== provider) continue;
    if (account && fm['nexus-account'] && String(fm['nexus-account']) !== String(account)) continue;
    if (String(fm['nexus-id'] == null ? '' : fm['nexus-id']) === want) return f;
  }
  return null;
}

/* ── write / overwrite a synced task note ──
     The note is named after its TITLE and renamed when the title changes on the
     server; the id lives in the frontmatter. Identity therefore never depends
     on the file name — callers hand over the known file, and the lookups below
     only catch the leftovers (crash mid-sync, notes from the id-named era). */
function taskKey(id) { return 'vk-' + String(id).replace(/[^\w.-]+/g, '_'); }
async function writeTaskNote(plugin, remote, projectName, existing) {
  const app = plugin.app;
  const provider = remote.provider || 'vikunja';
  const key = taskKey(remote.remoteId);
  const lines = ['---', 'nexus-type: task', 'nexus-provider: ' + provider,
    'nexus-account: ' + (remote.account || ''),
    'nexus-id: ' + JSON.stringify(String(remote.remoteId)),
    'nexus-updated: ' + JSON.stringify(String(remote.updated || ''))];
  if (remote.href) lines.push('nexus-href: ' + JSON.stringify(remote.href));
  lines.push('nexus-project: "[[' + projectName + ']]"',
    'title: ' + JSON.stringify(remote.title || ''),
    'status: ' + (remote.done ? 'completed' : 'needs-action'),
    'due: ' + (remote.due || ''), 'priority: ' + (remote.priority || 0),
    'repeat: ' + (remote.repeat || ''), '---', '', (remote.description || ''));
  const body = lines.join('\n');
  const title = tasks.sanitize(remote.title || '') || key;
  let file = existing instanceof TFile ? existing : null;
  if (!file) file = findTaskNote(plugin, provider, remote.account, remote.remoteId);
  if (!file) {
    // notes written before task notes were named after their title
    const legacy = app.vault.getAbstractFileByPath(tasks.taskPath(plugin, key));
    if (legacy instanceof TFile) file = legacy;
  }
  plugin._taskWriting = true;
  try {
    if (file) {
      const want = tasks.freeTaskPath(plugin, title, file);
      // renameFile also rewrites the link in the project checklist — that's why
      // a title change on the server doesn't strand the checklist line
      if (want !== file.path) { try { await app.fileManager.renameFile(file, want); } catch (e) {} }
      await app.vault.modify(file, body);
    } else {
      await tasks.ensureItemsFolder(plugin);
      file = await app.vault.create(tasks.freeTaskPath(plugin, title), body);
    }
  } finally { plugin._taskWriting = false; }
  return { key: file.basename, file };
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

/* Parse a leading YAML frontmatter block straight from file CONTENT. We do NOT
   use metadataCache here: it lags right after a note is created, so on the FIRST
   sync every freshly-written task would be missing frontmatter and get dropped
   from the checklist (→ empty "## Tasks"). Reading content is race-free. */
function parseFmBlock(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim();
    if (v && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) { try { v = JSON.parse(v); } catch (e) { v = v.slice(1, -1); } }
    fm[k] = v;
  }
  return fm;
}

/* Has the server seen this note in its current shape? True only when the sync
   base still matches what's on disk — i.e. nothing changed here since the last
   successful exchange. That is the condition for hiding a completed task: a tick
   the server hasn't got yet must stay visible and revocable. */
function isSynced(fm, text, basename, base) {
  if (!base) return false;
  const id = String(fm['nexus-id'] == null ? '' : fm['nexus-id']);
  if (!id) return false;
  const b = base[id];
  if (!b) return false;
  return b.localHash === localHash({
    title: fm.title || basename,
    description: stripFrontmatter(text).trim(),
    due: fm.due || '',
    priority: parseInt(fm.priority, 10) || 0,
    done: (fm.status === 'completed' || fm.done === true || fm.done === 'true'),
    repeat: fm.repeat || '',
  });
}

/* Rebuild the "## Tasks" checklist of the given projects from the task notes on
   disk in a single content-based pass (race-free, no metadataCache). Completed
   tasks drop out of the list once the server has them (see isSynced). */
async function rebuildChecklists(plugin, projectNames, accountId, base) {
  const app = plugin.app, want = new Set(projectNames), byProject = {};
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(tasks.itemsFolder(plugin) + '/')) continue;
    let text; try { text = await app.vault.read(f); } catch (e) { continue; }
    const fm = parseFmBlock(text);
    const provider = fm['nexus-provider']; if (!provider || provider === 'local') continue;
    if (accountId && fm['nexus-account'] && fm['nexus-account'] !== accountId) continue;
    const pn = parseLink(fm['nexus-project'] || ''); if (!pn || !want.has(pn)) continue;
    const done = (fm.status === 'completed' || fm.done === true || fm.done === 'true');
    if (done && isSynced(fm, text, f.basename, base)) continue;
    const title = fm.title || f.basename;
    (byProject[pn] = byProject[pn] || []).push({ done, title, line: tasks.checklistLine(f.basename, title, done) });
  }
  // Stable order (open first, then A–Z): the vault's file order would reshuffle
  // the section on every sync and turn each one into a pointless diff.
  for (const pn of want) {
    const rows = (byProject[pn] || []).sort((a, b) => (a.done - b.done) || a.title.localeCompare(b.title));
    await tasks.rebuildChecklist(plugin, pn, rows.map(r => r.line));
  }
}
async function rebuildChecklistFor(plugin, projectName, accountId, base) { await rebuildChecklists(plugin, [projectName], accountId, base); }

/* ── Vikunja project background → the project note's banner ──
     Vikunja lets a project carry a background image; the project note is the
     same project, so it gets the same picture. Downloaded once per project
     (missing file = fetch, present = keep) and never applied over a banner the
     user set themselves. Failure is silent: a picture must not fail a sync. ── */
async function ensureProjectBanner(plugin, account, client, proj, projectName) {
  if (!proj || !proj.hasBackground || !projectName) return false;
  const app = plugin.app;
  const pFile = app.vault.getAbstractFileByPath(tasks.projectPath(plugin, projectName));
  if (!(pFile instanceof TFile)) return false;
  const cur = ((app.metadataCache.getFileCache(pFile) || {}).frontmatter || {}).banner;
  const folder = ((plugin.settings.banner && plugin.settings.banner.folder) || 'attachments/banners').replace(/\/+$/, '');
  const path = folder + '/vikunja-' + account.id + '-' + proj.remoteId + '.jpg';
  let img = app.vault.getAbstractFileByPath(path);
  if (!img) {
    if (cur) return false;                       // user picked their own — don't even download
    let buf;
    try { buf = await client.getBackground(proj.remoteId); } catch (e) { return false; }
    if (!buf || !buf.byteLength) return false;
    const ad = app.vault.adapter;
    let curDir = '';
    for (const part of folder.split('/')) {
      curDir = curDir ? curDir + '/' + part : part;
      try { if (!(await ad.exists(curDir))) await ad.mkdir(curDir); } catch (e) {}
    }
    try { img = await app.vault.createBinary(path, buf); } catch (e) { return false; }
  }
  if (cur) return false;
  plugin._taskWriting = true;
  try { await app.fileManager.processFrontMatter(pFile, fm => { fm.banner = path; }); }
  catch (e) { return false; }
  finally { plugin._taskWriting = false; }
  return true;
}

/* ── Full two-way Vikunja sync. Returns {stats, conflicts}. First sync of an
     account is pure PULL (base is empty → nothing is pushed). ── */
async function syncVikunja(plugin, account, client) {
  const app = plugin.app;
  const base = await loadBase(plugin, account.id);
  const stats = { pulled: 0, pushed: 0, created: 0, deleted: 0, conflicts: 0, skipped: 0, banners: 0 };
  const conflicts = [];

  const projects = (await client.listProjects()).map(vik.mapProjectFromApi).filter(p => !p.archived);
  const projById = {}; projects.forEach(p => projById[p.remoteId] = p);
  const projName = {};
  for (const p of topoSort(projects)) {
    const parentName = p.parentId && projById[p.parentId] ? projName[p.parentId] : null;
    projName[p.remoteId] = await tasks.upsertProject(plugin, { title: p.title, parentName, provider: 'vikunja', remoteId: p.remoteId, account: account.id, color: p.color });
    try { if (await ensureProjectBanner(plugin, account, client, p, projName[p.remoteId])) stats.banners++; } catch (e) {}
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
      await writeTaskNote(plugin, remote, pn, local && local.file);
      base[id] = { localHash: localHash(remote), remoteTag: remote.updated };
      touched.add(pn); stats[dec.action === 'pull' ? 'pulled' : 'created']++;
    } else if (dec.action === 'push') {
      const updated = await client.updateTask(id, vik.mapTaskToApi(local));
      const m = vik.mapTaskFromApi(updated); m.account = account.id;
      const pn2 = projName[m.projectId] || pn;
      await writeTaskNote(plugin, m, pn2, local && local.file);
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
      const pn = projName[m.projectId] || pName;
      // reuse the very note the user typed into — deleting and re-creating it
      // would break its links and lose anything they wrote in the body
      await writeTaskNote(plugin, m, pn, n.file);
      base[m.remoteId] = { localHash: localHash(m), remoteTag: m.updated };
      touched.add(pn); stats.created++;
    } catch (e) { console.error('[Nexus] create remote task failed:', e); }
  }

  Object.values(projName).forEach(n => touched.add(n));   // rebuild ALL project checklists (repairs earlier empty ones)
  await rebuildChecklists(plugin, Array.from(touched), account.id, base);
  await saveBase(plugin, account.id, base);
  return { stats, conflicts };
}

/* ── apply a single conflict resolution ('server' keeps remote, 'mine' pushes local) ── */
async function applyResolution(plugin, account, client, rec, choice) {
  const base = await loadBase(plugin, account.id);
  if (choice === 'server' && rec.remote) {
    await writeTaskNote(plugin, rec.remote, rec.projectName, rec.local && rec.local.file);
    base[rec.id] = { localHash: localHash(rec.remote), remoteTag: rec.remote.updated };
  } else if (choice === 'mine' && rec.local) {
    const updated = await client.updateTask(rec.id, vik.mapTaskToApi(rec.local));
    const m = vik.mapTaskFromApi(updated); m.account = account.id;
    await writeTaskNote(plugin, m, rec.projectName, rec.local && rec.local.file);
    base[rec.id] = { localHash: localHash(m), remoteTag: m.updated };
  }
  await saveBase(plugin, account.id, base);
  await rebuildChecklistFor(plugin, rec.projectName, account.id, base);
}

module.exports = {
  fnv1a, canonical, localHash, reconcile, stripFrontmatter, readTaskNote, writeTaskNote, taskKey,
  findTaskNote, isSynced,
  loadBase, saveBase, baseIndexPath, CANON_FIELDS,
  syncVikunja, applyResolution, rebuildChecklistFor, rebuildChecklists,
  ensureProjectBanner,
};
