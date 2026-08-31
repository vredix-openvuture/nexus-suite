'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · tasks (projects + tasks as Markdown)
 *  Milestone 3 — LOCAL provider: the .md files are the source of truth.
 *    · Project note  = frontmatter {nexus-type:project,…} + a live "## Tasks"
 *      checklist of its tasks (+ "## Subprojects" links).
 *    · Task note     = frontmatter (status/due/priority/repeat/…) + description.
 *  Checking a task in the project note flips its state; a REPEAT task advances
 *  its due date instead of completing. Remote providers (CalDAV VTODO / Vikunja
 *  REST) plug into the SAME notes via the sync engine in later milestones.
 * ========================================================================== */

const { MarkdownView, Notice, moment, TFile } = require('obsidian');

function key() { return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function sanitize(name) { return String(name || '').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function projectsFolder(plugin) { return (plugin.settings.tasksCalendar.tasks.projectsFolder || 'Tasks/Projects').replace(/\/+$/, ''); }
function itemsFolder(plugin) { return (plugin.settings.tasksCalendar.tasks.itemsFolder || 'Tasks/Items').replace(/\/+$/, ''); }
function projectPath(plugin, name) { return projectsFolder(plugin) + '/' + sanitize(name) + '.md'; }
/* `k` is a task note's FILE NAME (its title). Ids live in the frontmatter — a
   note called after its own key is unreadable in the explorer, the graph and
   every link that points at it. */
function taskPath(plugin, k) { return itemsFolder(plugin) + '/' + k + '.md'; }

/* Free path for a task note titled `title`. Two tasks may legitimately share a
   title (different projects), so collisions get a counter rather than merging
   two tasks into one note. `ignore` = the note being renamed, which must not
   count as its own collision. */
function freeTaskPath(plugin, title, ignore) {
  const base = sanitize(title) || 'Task';
  const folder = itemsFolder(plugin);
  for (let i = 1; i < 500; i++) {
    const path = folder + '/' + (i === 1 ? base : base + ' ' + i) + '.md';
    const ex = plugin.app.vault.getAbstractFileByPath(path);
    if (!ex || ex === ignore) return path;
  }
  return folder + '/' + base + ' ' + Date.now().toString(36) + '.md';
}

/* ── one checklist line: `- [ ] [[Note name|Title]]` ──
     The link target IS the identity — no `<!-- nx:id -->` marker any more. */
function checklistLine(noteName, title, done, indent) {
  const alias = title && title !== noteName ? '|' + sanitize(title) : '';
  return (indent || '') + '- [' + (done ? 'x' : ' ') + '] [[' + noteName + alias + ']]';
}
function linkRe(noteName) {
  return new RegExp('\\[\\[' + noteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\||\\]\\])');
}
/* first wikilink of a checklist line → {link, alias} */
function parseTaskLine(line) {
  const m = String(line).match(/^(\s*)- \[( |x|X)\]\s*(.*)$/);
  if (!m) return null;
  const rest = m[3];
  const link = rest.match(/\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/);
  return {
    indent: m[1], done: m[2].toLowerCase() === 'x', rest,
    link: link ? link[1].trim() : '', alias: link && link[2] ? link[2].trim() : '',
    // legacy notes still carry the old marker — read it, never write it
    legacyKey: (rest.match(/<!-- nx:([\w.-]+) -->/) || [])[1] || '',
  };
}

async function ensureFolder(plugin, path) {
  const ad = plugin.app.vault.adapter;
  const parts = path.split('/'); let cur = '';
  for (const p of parts) { cur = cur ? cur + '/' + p : p; try { if (!(await ad.exists(cur))) await ad.mkdir(cur); } catch (e) {} }
}

/* ── advance a DUE date by one repeat period (RRULE FREQ/INTERVAL) ── */
function advanceDue(dueStr, repeat) {
  if (!dueStr || !repeat) return dueStr;
  const parts = {}; String(repeat).split(';').forEach(p => { const [k, v] = p.split('='); if (v) parts[k.toUpperCase()] = v; });
  const freq = (parts.FREQ || '').toUpperCase();
  const n = Math.max(1, parseInt(parts.INTERVAL, 10) || 1);
  const unit = freq === 'DAILY' ? 'day' : freq === 'WEEKLY' ? 'week' : freq === 'MONTHLY' ? 'month' : freq === 'YEARLY' ? 'year' : null;
  if (!unit) return dueStr;
  const m = moment(dueStr, dueStr.length > 10 ? undefined : 'YYYY-MM-DD');
  if (!m.isValid()) return dueStr;
  return m.add(n, unit).format(dueStr.length > 10 ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD');
}

/* ── create a project note (optionally as a subproject of parentName) ── */
async function createProject(plugin, name, parentName) {
  const app = plugin.app;
  const path = projectPath(plugin, name);
  await ensureFolder(plugin, projectsFolder(plugin));
  let file = app.vault.getAbstractFileByPath(path);
  if (!file) {
    const fmParent = parentName ? '\nnexus-parent: "[[' + sanitize(parentName) + ']]"' : '';
    const body = ['---', 'nexus-type: project', 'nexus-provider: local', 'nexus-id: ' + ('p-' + Date.now().toString(36)) + fmParent, '---',
      '# ' + sanitize(name), '', '## Subprojects', '', '## Tasks', ''].join('\n');
    file = await app.vault.create(path, body);
  }
  if (parentName) await _linkSubproject(plugin, parentName, name);
  return file;
}

async function _linkSubproject(plugin, parentName, childName) {
  const app = plugin.app;
  const pPath = projectPath(plugin, parentName);
  let pFile = app.vault.getAbstractFileByPath(pPath);
  if (!pFile) pFile = await createProject(plugin, parentName);
  const link = '- [[' + sanitize(childName) + ']]';
  let text = await app.vault.read(pFile);
  if (text.includes(link)) return;
  if (text.includes('## Subprojects')) text = text.replace(/## Subprojects\n/, '## Subprojects\n' + link + '\n');
  else text += '\n## Subprojects\n' + link + '\n';
  await app.vault.modify(pFile, text);
}

/* ── create a task note + append it to its project's checklist ──
     opts.provider/account let a task inherit its project's remote binding: a
     task note carrying a provider but NO `nexus-id` is exactly what the sync
     engine treats as "new here, push it" (see sync.js localNew). */
async function createTask(plugin, projectName, opts) {
  const app = plugin.app;
  opts = opts || {};
  const title = sanitize(opts.title) || 'Untitled';
  const provider = opts.provider || 'local';
  await ensureFolder(plugin, itemsFolder(plugin));
  const lines = ['---', 'nexus-type: task', 'nexus-provider: ' + provider];
  if (opts.account) lines.push('nexus-account: ' + opts.account);
  // local ids are ours to invent; a remote task has no id until the server gave one
  lines.push('nexus-id: ' + (provider === 'local' ? key() : ''),
    'nexus-project: "[[' + sanitize(projectName) + ']]"',
    'title: ' + JSON.stringify(title),
    'status: ' + (opts.status || 'needs-action'),
    'due: ' + (opts.due || ''),
    'priority: ' + (opts.priority != null ? opts.priority : 0),
    'repeat: ' + (opts.repeat || ''),
    'completed: ', '---', '', (opts.description || ''));
  const file = await app.vault.create(freeTaskPath(plugin, title), lines.join('\n'));
  if (!opts.skipChecklist) await addTaskToProject(plugin, projectName, file.basename, title, false);
  return { key: file.basename, file };
}

/* ── append a checklist line to the project's "## Tasks" section ── */
async function addTaskToProject(plugin, projectName, noteName, title, done) {
  const app = plugin.app;
  let pFile = app.vault.getAbstractFileByPath(projectPath(plugin, projectName));
  if (!pFile) pFile = await createProject(plugin, projectName);
  let text = await app.vault.read(pFile);
  if (linkRe(noteName).test(text)) return;
  const line = checklistLine(noteName, title, done);
  if (text.includes('## Tasks')) text = text.replace(/## Tasks\n/, '## Tasks\n' + line + '\n');
  else text += '\n## Tasks\n' + line + '\n';
  plugin._taskWriting = true;
  try { await app.vault.modify(pFile, text); } finally { plugin._taskWriting = false; }
}

/* ── tick/untick a task's checkbox in its project note ──
     For callers that complete a task somewhere else (agenda block, a view):
     the project note is the human-readable record, so its box must not be left
     disagreeing with the task note. Silent no-op when the line isn't there. */
async function setChecklistBox(plugin, projectName, noteName, done) {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(projectPath(plugin, projectName));
  if (!(file instanceof TFile)) return false;
  const text = await app.vault.read(file);
  const lines = text.split('\n');
  const want = linkRe(noteName);
  let hit = -1;
  for (let i = 0; i < lines.length; i++) {
    const p = parseTaskLine(lines[i]);
    if (!p) continue;
    if (p.link === noteName || (!p.link && p.legacyKey === noteName) || want.test(lines[i])) { hit = i; break; }
  }
  if (hit < 0) return false;
  const cur = parseTaskLine(lines[hit]);
  if (cur.done === !!done) return false;
  lines[hit] = lines[hit].replace(/- \[( |x|X)\]/, '- [' + (done ? 'x' : ' ') + ']');
  plugin._taskWriting = true;
  try { await app.vault.modify(file, lines.join('\n')); } finally { plugin._taskWriting = false; }
  return true;
}

/* ── read a task note's frontmatter via the metadata cache ── */
function taskStateOf(plugin, file) {
  if (!(file instanceof TFile)) return null;
  const fm = (plugin.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
  if (fm['nexus-type'] !== 'task') return null;
  return {
    file, title: fm.title || file.basename,
    provider: fm['nexus-provider'] || 'local', account: fm['nexus-account'] || '',
    status: fm.status || 'needs-action', due: fm.due || '', repeat: fm.repeat || '',
    priority: fm.priority || 0, done: (fm.status === 'completed'),
  };
}
function taskState(plugin, k) {
  const asTaskNote = taskStateOf(plugin, plugin.app.vault.getAbstractFileByPath(taskPath(plugin, k)));
  if (asTaskNote) return asTaskNote;
  // A note that tracks itself is keyed by its path, not by a basename in the
  // task folder — see listNoteTasks.
  return noteTaskStateOf(plugin, plugin.app.vault.getAbstractFileByPath(k));
}

/* ── set a task done/undone. A repeating task advances its due instead. ──
     Returns { repeated:bool, newDue } so the caller can keep the box unchecked. */
async function setTaskDone(plugin, k, done) {
  const app = plugin.app;
  const st = taskState(plugin, k);
  if (!st) return { missing: true };
  let repeated = false, newDue = st.due;
  await app.fileManager.processFrontMatter(st.file, fm => {
    // Repeat advances the due date here for local AND CalDAV (plain VTODO has no
    // server-side recurrence roll-over). Vikunja is the exception — its server
    // owns the repeat, so there we just mark done and let sync push it.
    if (done && fm.repeat && (fm['nexus-provider'] || 'local') !== 'vikunja') {
      newDue = advanceDue(fm.due, fm.repeat);
      fm.due = newDue;
      fm.status = 'needs-action';
      fm.completed = '';
      fm.sequence = (parseInt(fm.sequence, 10) || 0) + 1;
      repeated = true;
    } else {
      fm.status = done ? 'completed' : 'needs-action';
      fm.completed = done ? moment().format('YYYY-MM-DDTHH:mm') : '';
    }
  });
  return { repeated, newDue };
}

/* ── vault.on('modify') handler for a project note. Three jobs, all read off
     the checklist under "## Tasks":
       · a box that disagrees with its task note → apply it (a repeating task
         advances its due date and the box goes back to unchecked)
       · a hand-written line with no task behind it → CREATE the task: write the
         note, inherit the project's provider/account, turn the line into a link
         (a remote project then gets the task pushed on the next sync)
       · legacy `<!-- nx:id -->` markers disappear from any line we rewrite
     A line linking to a note that exists but isn't a task is left alone — a
     project note may hold ordinary checklists too. ── */
async function onProjectNoteModify(plugin, file) {
  if (plugin._taskWriting) return;
  if (!(file instanceof TFile) || file.extension !== 'md') return;
  const app = plugin.app;
  const cache = app.metadataCache.getFileCache(file) || {};
  const pfm = cache.frontmatter;
  if (!pfm || pfm['nexus-type'] !== 'project') return;

  const projectName = file.basename;
  const provider = pfm['nexus-provider'] || 'local';
  const account = pfm['nexus-account'] || '';
  const lines = (await app.vault.read(file)).split('\n');
  const changed = [];
  let rewrite = false, created = 0, inTasks = false;

  // Obsidian saves while you type, so the line under the cursor is still being
  // written — turning THAT into a task would make a note out of every half word.
  // It becomes one as soon as the cursor leaves it.
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const editor = view && view.file === file && view.editor ? view.editor : null;
  const typingLine = editor ? editor.getCursor().line : -1;

  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (head) { inTasks = /^tasks\b/i.test(head[1].trim()); continue; }
    const p = parseTaskLine(lines[i]);
    if (!p) continue;

    const noteName = p.link || p.legacyKey;
    const dest = noteName ? app.metadataCache.getFirstLinkpathDest(noteName, file.path) : null;
    const st = dest ? taskStateOf(plugin, dest) : null;

    if (st) {
      if (p.done !== st.done) {
        const res = await setTaskDone(plugin, dest.basename, p.done);
        // a repeat rolls forward instead of closing → the box goes back to open
        const box = res.repeated && p.done ? false : p.done;
        const next = checklistLine(dest.basename, st.title, box, p.indent);
        if (next !== lines[i]) { lines[i] = next; changed.push(i); rewrite = true; }
      } else if (p.legacyKey) {
        const next = checklistLine(dest.basename, st.title, p.done, p.indent);
        if (next !== lines[i]) { lines[i] = next; changed.push(i); rewrite = true; }
      }
      continue;
    }
    if (dest) continue;                      // links somewhere else — not ours
    if (!inTasks || i === typingLine) continue;   // only "## Tasks", never mid-typing

    const title = sanitize(p.rest.replace(/<!--[\s\S]*?-->/g, '').replace(/[[\]]/g, ' '));
    if (!title) continue;
    try {
      const res = await createTask(plugin, projectName, {
        title, provider, account, skipChecklist: true,
        status: p.done ? 'completed' : 'needs-action',
      });
      lines[i] = checklistLine(res.file.basename, title, p.done, p.indent);
      changed.push(i); rewrite = true; created++;
    } catch (e) { console.error('[nexus-suite] create task from checklist line', e); }
  }

  if (rewrite) {
    plugin._taskWriting = true;
    try {
      // Writing through the editor when the note is open keeps the cursor and
      // the undo history intact — vault.modify would replace the whole document
      // under the hands of whoever is typing in it.
      if (editor) changed.forEach(i => { if (editor.getLine(i) !== lines[i]) editor.setLine(i, lines[i]); });
      else await app.vault.modify(file, lines.join('\n'));
    } finally { plugin._taskWriting = false; }
  }
  if (created) {
    new Notice(created === 1 ? 'Task created' : created + ' tasks created');
    // a remote project owns its tasks on the server — get the new ones up there
    if (provider !== 'local' && plugin.queueTaskSync) plugin.queueTaskSync();
  }
}

async function ensureItemsFolder(plugin) { await ensureFolder(plugin, itemsFolder(plugin)); }

/* ── one-off migration: task notes used to be named after their id (t-… local,
     cd-… CalDAV, vk-… Vikunja). Rename each to its title — Obsidian's
     renameFile rewrites every link in the vault, so the project checklists
     follow by themselves — then drop the old `<!-- nx:id -->` markers and the
     now-redundant `[[Name|Name]]` aliases. Ids live on in the frontmatter. ── */
async function migrateTaskNoteNames(plugin) {
  const app = plugin.app;
  const items = itemsFolder(plugin) + '/';
  let renamed = 0, cleaned = 0;

  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(items)) continue;
    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
    if (fm['nexus-type'] !== 'task') continue;
    const title = sanitize(fm.title || '');
    if (!title || title === f.basename) continue;
    const want = freeTaskPath(plugin, title, f);
    if (want === f.path) continue;
    plugin._taskWriting = true;
    try { await app.fileManager.renameFile(f, want); renamed++; }
    catch (e) { console.error('[nexus-suite] rename task note', f.path, e); }
    finally { plugin._taskWriting = false; }
  }

  const projects = projectsFolder(plugin) + '/';
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(projects)) continue;
    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
    if (fm['nexus-type'] !== 'project') continue;
    const text = await app.vault.read(f);
    if (!text.includes('<!-- nx:') && !/\[\[([^\]|#]+)\|\1\]\]/.test(text)) continue;
    const next = text.split('\n').map(line => {
      if (!parseTaskLine(line)) return line;
      return line.replace(/\s*<!--\s*nx:[\w.-]+\s*-->/g, '')
        .replace(/\[\[([^\]|#]+)\|([^\]]*)\]\]/g, (all, tgt, alias) => (tgt.trim() === alias.trim() ? '[[' + tgt + ']]' : all))
        .replace(/\s+$/, '');
    }).join('\n');
    if (next === text) continue;
    plugin._taskWriting = true;
    try { await app.vault.modify(f, next); cleaned++; } finally { plugin._taskWriting = false; }
  }
  return { renamed, cleaned };
}

/* ── upsert a project note by title (stamps a provider + remote id) ── */
async function upsertProject(plugin, opts) {
  const name = sanitize(opts.title);
  let file = plugin.app.vault.getAbstractFileByPath(projectPath(plugin, name));
  if (!file) file = await createProject(plugin, name, opts.parentName);
  else if (opts.parentName) await _linkSubproject(plugin, opts.parentName, name);
  if (opts.provider || opts.remoteId != null || opts.color) {
    plugin._taskWriting = true;
    try { await plugin.app.fileManager.processFrontMatter(file, fm => {
      if (opts.provider) fm['nexus-provider'] = opts.provider;
      if (opts.remoteId != null) fm['nexus-id'] = opts.remoteId;
      if (opts.account) fm['nexus-account'] = opts.account;
      if (opts.color) fm['nexus-color'] = opts.color;   // provider colour → dot in the tasks view
    }); } finally { plugin._taskWriting = false; }
  }
  return name;
}

/* ── rewrite a project note's "## Tasks" section from a list of checklist lines ── */
async function rebuildChecklist(plugin, projectName, lines) {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(projectPath(plugin, projectName));
  if (!file) return;
  const text = await app.vault.read(file);
  const src = text.split('\n');
  const out = [];
  let i = 0, replaced = false;
  while (i < src.length) {
    if (/^##\s+Tasks\s*$/.test(src[i])) {
      out.push('## Tasks');
      lines.forEach(l => out.push(l));
      i++;
      while (i < src.length && !/^##\s+/.test(src[i])) i++;   // skip old section body
      replaced = true;
      continue;
    }
    out.push(src[i]); i++;
  }
  if (!replaced) { out.push('## Tasks'); lines.forEach(l => out.push(l)); }
  const next = out.join('\n');
  if (next === text) return;
  plugin._taskWriting = true;
  try { await app.vault.modify(file, next); } finally { plugin._taskWriting = false; }
}

/* ── the vault's task/project notes as plain records ──
     One reader for every consumer (agenda block, tasks view, future queries):
     the notes stay the source of truth, this is just the projection. ── */
function linkName(v) {
  return String(v == null ? '' : v).trim()
    .replace(/^["']|["']$/g, '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
}
function taskRecord(file, fm) {
  const due = String(fm.due || '').trim();
  return {
    file, key: file.basename, title: fm.title || file.basename,
    project: linkName(fm['nexus-project']),
    provider: fm['nexus-provider'] || 'local', account: fm['nexus-account'] || '',
    remoteId: fm['nexus-id'] == null ? '' : String(fm['nexus-id']),
    done: String(fm.status || '') === 'completed',
    due, dueDay: due ? due.slice(0, 10) : '', timed: due.length > 10 ? due.slice(11, 16) : '',
    priority: parseInt(fm.priority, 10) || 0, repeat: String(fm.repeat || ''),
    // Which column of the task board it sits in. Empty = the first column, so
    // an untouched vault has no `bucket:` lines at all.
    bucket: String(fm.bucket || '').trim(),
  };
}

/* ── move a task into a board column ──
     The column lives in the task note like every other task field. An empty
     title means the first column, which is the absence of a value — writing
     "bucket: Backlog" into every note would be noise. */
async function setTaskBucket(plugin, task, title) {
  const file = task && task.file ? task.file : task;
  if (!(file instanceof TFile)) return false;
  const want = String(title || '').trim();
  await plugin.app.fileManager.processFrontMatter(file, fm => {
    if (!want) delete fm.bucket; else fm.bucket = want;
  });
  return true;
}
/* ── A note that tracks itself ───────────────────────────────────────────────
   `nexus-task: true` in the frontmatter of ANY note makes that note a task: it
   turns up in the tasks view and can be ticked there, without being moved into
   the task folder and without a second note standing in for it.

   The case this exists for is a thought written down in the middle of something
   else that should be picked up later. Turning it into a task must not mean
   taking it out of the note it belongs to, or the context goes with it — which
   is exactly why a checklist line somewhere else is not good enough.

   The key is the note's PATH, because that is what identifies it; task notes
   keep using their basename, and taskState below accepts either. */
const NOTE_TASK_FIELD = 'nexus-task';

function isNoteTask(fm) {
  if (!fm) return false;
  if (fm['nexus-type'] === 'task') return false;   // a real task note, not a note tracking itself
  const raw = fm[NOTE_TASK_FIELD];
  if (raw === true) return true;
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return v === 'true' || v === 'yes' || v === 'y' || v === '1';
}
function noteTaskRecord(file, fm) {
  const due = String(fm.due || '').trim();
  return {
    file, key: file.path, title: fm.title || file.basename,
    project: linkName(fm['nexus-project']),
    // A note that tracks itself is never pushed anywhere: it is a note, and the
    // server has no concept of it.
    provider: 'local', account: '', remoteId: '',
    done: String(fm.status || '') === 'completed',
    due, dueDay: due ? due.slice(0, 10) : '', timed: due.length > 10 ? due.slice(11, 16) : '',
    priority: parseInt(fm.priority, 10) || 0, repeat: String(fm.repeat || ''),
    bucket: String(fm.bucket || '').trim(),
    fromNote: true,
  };
}
function noteTaskStateOf(plugin, file) {
  if (!(file instanceof TFile)) return null;
  const fm = (plugin.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
  if (!isNoteTask(fm)) return null;
  return {
    file, title: fm.title || file.basename,
    provider: 'local', account: '',
    status: fm.status || 'needs-action', due: fm.due || '', repeat: fm.repeat || '',
    priority: fm.priority || 0, done: (fm.status === 'completed'),
    fromNote: true,
  };
}
function listNoteTasks(plugin) {
  const app = plugin.app, out = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
    if (!isNoteTask(fm)) continue;
    out.push(noteTaskRecord(f, fm));
  }
  return out;
}
/* Turn tracking on or off for one note. Returns the new state so the caller can
   say which way it went. */
async function toggleNoteTask(plugin, file, on) {
  if (!(file instanceof TFile)) return null;
  const fm = (plugin.app.metadataCache.getFileCache(file) || {}).frontmatter;
  const want = (on == null) ? !isNoteTask(fm) : !!on;
  await plugin.app.fileManager.processFrontMatter(file, front => {
    if (want) front[NOTE_TASK_FIELD] = true;
    else {
      // Tracking stops; the status the note collected on the way stays, so
      // turning it back on does not silently resurrect it as open.
      delete front[NOTE_TASK_FIELD];
    }
  });
  return want;
}

function listTasks(plugin) {
  const app = plugin.app, items = itemsFolder(plugin) + '/', out = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(items)) continue;
    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
    if (!fm || fm['nexus-type'] !== 'task') continue;
    out.push(taskRecord(f, fm));
  }
  // Notes that track themselves live anywhere in the vault, so they are
  // collected separately and joined here — the tasks view sees one list.
  return out.concat(listNoteTasks(plugin));
}
function listProjectNotes(plugin) {
  const app = plugin.app, folder = projectsFolder(plugin) + '/', out = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(folder)) continue;
    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
    if (!fm || fm['nexus-type'] !== 'project') continue;
    out.push({
      file: f, name: f.basename, parent: linkName(fm['nexus-parent']),
      provider: fm['nexus-provider'] || 'local', account: fm['nexus-account'] || '',
      color: fm['nexus-color'] || '', banner: fm.banner || '',
    });
  }
  return out;
}

/* ── list all project notes (for pickers) ── */
function listProjects(plugin) {
  const folder = projectsFolder(plugin);
  return plugin.app.vault.getMarkdownFiles()
    .filter(f => f.path.startsWith(folder + '/'))
    .filter(f => { const fm = (plugin.app.metadataCache.getFileCache(f) || {}).frontmatter; return fm && fm['nexus-type'] === 'project'; })
    .map(f => f.basename);
}

module.exports = {
  createProject, createTask, addTaskToProject, setTaskDone, setChecklistBox,
  taskState, taskStateOf, onProjectNoteModify, listProjects, advanceDue, setTaskBucket,
  listTasks, listProjectNotes, taskRecord, linkName,
  NOTE_TASK_FIELD, isNoteTask, noteTaskRecord, noteTaskStateOf, listNoteTasks, toggleNoteTask,
  projectPath, taskPath, freeTaskPath, projectsFolder, itemsFolder, sanitize,
  checklistLine, parseTaskLine, linkRe,
  ensureItemsFolder, upsertProject, rebuildChecklist, migrateTaskNoteNames,
};
