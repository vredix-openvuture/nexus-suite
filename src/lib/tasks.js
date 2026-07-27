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

const { moment, TFile } = require('obsidian');

function key() { return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function sanitize(name) { return String(name || '').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function projectsFolder(plugin) { return (plugin.settings.tasksCalendar.tasks.projectsFolder || 'Tasks/Projects').replace(/\/+$/, ''); }
function itemsFolder(plugin) { return (plugin.settings.tasksCalendar.tasks.itemsFolder || 'Tasks/Items').replace(/\/+$/, ''); }
function projectPath(plugin, name) { return projectsFolder(plugin) + '/' + sanitize(name) + '.md'; }
function taskPath(plugin, k) { return itemsFolder(plugin) + '/' + k + '.md'; }

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

/* ── create a task note + append it to its project's checklist ── */
async function createTask(plugin, projectName, opts) {
  const app = plugin.app;
  opts = opts || {};
  const k = key();
  await ensureFolder(plugin, itemsFolder(plugin));
  const fm = ['---', 'nexus-type: task', 'nexus-provider: local', 'nexus-id: ' + k,
    'nexus-project: "[[' + sanitize(projectName) + ']]"',
    'status: ' + (opts.status || 'needs-action'),
    'due: ' + (opts.due || ''),
    'priority: ' + (opts.priority != null ? opts.priority : 0),
    'repeat: ' + (opts.repeat || ''),
    'completed: ', '---', '', (opts.description || '')].join('\n');
  const file = await app.vault.create(taskPath(plugin, k), fm);
  await addTaskToProject(plugin, projectName, k, opts.title || 'Untitled', false);
  return { key: k, file };
}

/* ── append a checklist line to the project's "## Tasks" section ── */
async function addTaskToProject(plugin, projectName, k, title, done) {
  const app = plugin.app;
  let pFile = app.vault.getAbstractFileByPath(projectPath(plugin, projectName));
  if (!pFile) pFile = await createProject(plugin, projectName);
  const line = '- [' + (done ? 'x' : ' ') + '] [[' + k + '|' + sanitize(title) + ']] <!-- nx:' + k + ' -->';
  let text = await app.vault.read(pFile);
  if (text.includes('<!-- nx:' + k + ' -->')) return;
  if (text.includes('## Tasks')) text = text.replace(/## Tasks\n/, '## Tasks\n' + line + '\n');
  else text += '\n## Tasks\n' + line + '\n';
  plugin._taskWriting = true;
  try { await app.vault.modify(pFile, text); } finally { plugin._taskWriting = false; }
}

/* ── read a task note's frontmatter via the metadata cache ── */
function taskState(plugin, k) {
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(taskPath(plugin, k));
  if (!file) return null;
  const fm = (app.metadataCache.getFileCache(file) || {}).frontmatter || {};
  return { file, status: fm.status || 'needs-action', due: fm.due || '', repeat: fm.repeat || '', priority: fm.priority || 0, done: (fm.status === 'completed') };
}

/* ── set a task done/undone. A repeating task advances its due instead. ──
     Returns { repeated:bool, newDue } so the caller can keep the box unchecked. */
async function setTaskDone(plugin, k, done) {
  const app = plugin.app;
  const st = taskState(plugin, k);
  if (!st) return { missing: true };
  let repeated = false, newDue = st.due;
  await app.fileManager.processFrontMatter(st.file, fm => {
    if (done && fm.repeat) {
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

/* ── vault.on('modify') handler: a project note's checkboxes changed → apply.
     Repeating tasks that got checked are advanced + the box reset to [ ]. ── */
async function onProjectNoteModify(plugin, file) {
  if (plugin._taskWriting) return;
  if (!(file instanceof TFile) || file.extension !== 'md') return;
  const app = plugin.app;
  const cache = app.metadataCache.getFileCache(file) || {};
  if (!cache.frontmatter || cache.frontmatter['nexus-type'] !== 'project') return;

  let text = await app.vault.read(file);
  const lineRe = /^(\s*)- \[( |x|X)\] (.*?)<!-- nx:([\w-]+) -->/gm;
  const changes = [];
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    const checked = m[2].toLowerCase() === 'x';
    const k = m[4];
    const st = taskState(plugin, k);
    if (!st) continue;
    if (checked !== st.done) changes.push({ k, checked, full: m[0], indent: m[1], mid: m[3] });
  }
  if (!changes.length) return;

  let rewrite = false;
  for (const ch of changes) {
    const res = await setTaskDone(plugin, ch.k, ch.checked);
    if (res.repeated && ch.checked) {
      // reset the box to unchecked in the project note
      const resetLine = ch.indent + '- [ ] ' + ch.mid + '<!-- nx:' + ch.k + ' -->';
      text = text.replace(ch.full, resetLine);
      rewrite = true;
    }
  }
  if (rewrite) {
    plugin._taskWriting = true;
    try { await app.vault.modify(file, text); } finally { plugin._taskWriting = false; }
  }
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
  createProject, createTask, addTaskToProject, setTaskDone, taskState,
  onProjectNoteModify, listProjects, advanceDue,
  projectPath, taskPath, projectsFolder, itemsFolder,
};
