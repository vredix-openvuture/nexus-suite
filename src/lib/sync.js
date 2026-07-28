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
const ical = require('./ical.js');

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

/* ── write / overwrite a synced task note (provider-generic: vikunja | caldav) ── */
function taskKey(provider, id) { return (provider === 'caldav' ? 'cd-' : 'vk-') + String(id).replace(/[^\w.-]+/g, '_'); }
async function writeTaskNote(plugin, remote, projectName) {
  const app = plugin.app;
  const provider = remote.provider || 'vikunja';
  const key = taskKey(provider, remote.remoteId);
  const path = tasks.taskPath(plugin, key);
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
  const fm = lines.join('\n');
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
    if (!n.provider || n.provider === 'local') continue;   // synced (vikunja/caldav) tasks only
    if (accountId && n.account && n.account !== accountId) continue;
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
    let m;
    if (account.kind === 'caldav') {
      const ics = ical.serializeTodo(Object.assign({ uid: rec.id }, rec.local), moment);
      const put = await client.putResource(rec.local.href || '', ics, '');   // force overwrite (keep mine)
      m = { provider: 'caldav', account: account.id, remoteId: rec.id, href: rec.local.href, updated: put.etag || '', title: rec.local.title, description: rec.local.description, due: rec.local.due, priority: rec.local.priority, done: rec.local.done, repeat: rec.local.repeat };
    } else {
      const updated = await client.updateTask(rec.id, vik.mapTaskToApi(rec.local));
      m = vik.mapTaskFromApi(updated); m.account = account.id;
    }
    await writeTaskNote(plugin, m, rec.projectName);
    base[rec.id] = { localHash: localHash(m), remoteTag: m.updated };
  }
  await saveBase(plugin, account.id, base);
  await rebuildChecklistFor(plugin, rec.projectName, account.id);
}

/* ── Full two-way CalDAV VTODO sync (Nextcloud Tasks / generic). Each enabled
     VTODO calendar = a project note; tasks = task notes. Same reconcile core +
     conflict handling as Vikunja. ETag is the remote tag. ── */
function vtodoDue(vt) { return vt.due ? (vt.due.d || (vt.due.dt ? vt.due.dt.slice(0, 10) : '')) : ''; }
async function syncCaldavTodos(plugin, account, ical, client) {
  const app = plugin.app;
  const base = await loadBase(plugin, account.id);
  const stats = { pulled: 0, pushed: 0, created: 0, deleted: 0, conflicts: 0, skipped: 0 };
  const conflicts = [];
  const cals = (account.calendars || []).filter(c => c.enabled && c.component === 'VTODO');
  const touched = new Set();

  for (const cal of cals) {
    const projectName = await tasks.upsertProject(plugin, { title: cal.display, provider: 'caldav', remoteId: cal.href, account: account.id });
    let resources; try { resources = await client.listComponents(cal.href, 'VTODO'); } catch (e) { continue; }
    const remoteTasks = {};
    for (const r of resources) {
      const parsed = ical.parseResource(r.ics || '');
      for (const vt of parsed.vtodos) {
        remoteTasks[vt.uid] = {
          provider: 'caldav', account: account.id, remoteId: vt.uid, href: r.href, updated: r.etag || '',
          title: vt.summary, description: vt.description || '', due: vtodoDue(vt),
          priority: vt.priority || 0, done: !!vt.completed, repeat: vt.rrule || '', projectName,
        };
      }
    }
    const localByRemote = {}, localNew = [];
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(tasks.itemsFolder(plugin) + '/')) continue;
      const n = readTaskNote(plugin, f);
      if (n.provider !== 'caldav' || (n.account && n.account !== account.id)) continue;
      if (parseLink(n.projectLink) !== projectName) continue;
      n.description = stripFrontmatter(await app.vault.read(f)).trim();
      if (n.remoteId) localByRemote[n.remoteId] = n; else localNew.push(n);
    }

    const ids = new Set(Object.keys(remoteTasks).concat(Object.keys(localByRemote)));
    for (const id of ids) {
      const remote = remoteTasks[id] || null, local = localByRemote[id] || null, b = base[id] || null;
      const dec = reconcile(local, remote, b);
      if (dec.action === 'pull' || dec.action === 'create-local') {
        await writeTaskNote(plugin, remote, projectName);
        base[id] = { localHash: localHash(remote), remoteTag: remote.updated };
        touched.add(projectName); stats[dec.action === 'pull' ? 'pulled' : 'created']++;
      } else if (dec.action === 'push') {
        const ics = ical.serializeTodo(Object.assign({ uid: id }, local), moment);
        const put = await client.putResource(local.href || (cal.href.replace(/\/$/, '') + '/' + encodeURIComponent(id) + '.ics'), ics, local.baseTag || '');
        if (put.status === 412) { conflicts.push({ account: account.id, id, projectName, local, remote, reason: 'precondition', ical }); stats.conflicts++; }
        else {
          const m = { provider: 'caldav', account: account.id, remoteId: id, href: local.href, updated: put.etag || '', title: local.title, description: local.description, due: local.due, priority: local.priority, done: local.done, repeat: local.repeat, projectName };
          await writeTaskNote(plugin, m, projectName);
          base[id] = { localHash: localHash(m), remoteTag: m.updated }; touched.add(projectName); stats.pushed++;
        }
      } else if (dec.action === 'delete-local') {
        if (local && local.file) { plugin._taskWriting = true; try { await app.vault.delete(local.file); } catch (e) {} finally { plugin._taskWriting = false; } }
        delete base[id]; touched.add(projectName); stats.deleted++;
      } else if (dec.action === 'conflict') { conflicts.push({ account: account.id, id, projectName, local, remote, reason: dec.reason, ical }); stats.conflicts++; }
      else stats.skipped++;
    }

    for (const n of localNew) {
      const uid = 'nx-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const ics = ical.serializeTodo(Object.assign({ uid }, n), moment);
      const url = cal.href.replace(/\/$/, '') + '/' + uid + '.ics';
      try {
        const put = await client.putResource(url, ics, null);
        if (n.file) { plugin._taskWriting = true; try { await app.vault.delete(n.file); } catch (e) {} finally { plugin._taskWriting = false; } }
        const m = { provider: 'caldav', account: account.id, remoteId: uid, href: url, updated: put.etag || '', title: n.title, description: n.description, due: n.due, priority: n.priority, done: n.done, repeat: n.repeat, projectName };
        await writeTaskNote(plugin, m, projectName);
        base[uid] = { localHash: localHash(m), remoteTag: m.updated }; touched.add(projectName); stats.created++;
      } catch (e) { console.error('[Nexus] create remote VTODO failed:', e); }
    }
  }
  for (const pn of touched) await rebuildChecklistFor(plugin, pn, account.id);
  await saveBase(plugin, account.id, base);
  return { stats, conflicts };
}

module.exports = {
  fnv1a, canonical, localHash, reconcile, stripFrontmatter, readTaskNote, writeTaskNote, taskKey,
  loadBase, saveBase, baseIndexPath, CANON_FIELDS,
  syncVikunja, syncCaldavTodos, applyResolution, rebuildChecklistFor,
};
