'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · task board (kanban over the tasks)
 *  The second way of looking at the tasks page: the same task notes as cards in
 *  columns instead of a list. Nothing here owns state —
 *
 *    · which column a task sits in = `bucket:` in its own task note
 *    · a task in the "done" column  = `status: completed`, as everywhere else
 *
 *  so the board, the list, the agenda block and the server never disagree.
 *
 *  VIKUNJA: a Vikunja project brings its OWN buckets (its kanban view). When the
 *  project is a Vikunja one and this device has the credential, the columns come
 *  from the server and a drag is pushed straight back to it — the `bucket:` line
 *  in the note is then the offline copy that keeps the board readable on the
 *  tablet, where no sync runs.
 * ========================================================================== */

const { Notice, moment, setIcon } = require('obsidian');
const { TASK_BUCKETS } = require('../constants.js');
const { bucketKind, kindVar, nxEdgeScroller } = require('./kanban.js');
const tasks = require('./tasks.js');

function priorityLabel(p) {
  const n = parseInt(p, 10) || 0;
  return n <= 0 ? '' : n >= 7 ? 'High' : n >= 4 ? 'Medium' : 'Low';
}

class NexusTaskBoard {
  constructor(view) {
    this.view = view;
    this.plugin = view.plugin;
    this.app = view.app;
    this.remote = null;      // {project, buckets:[{id,title}], error} — Vikunja columns
    this._pulling = false;
  }

  /* ---- columns ------------------------------------------------------------ */

  localBuckets() {
    const t = (this.plugin.settings.tasksCalendar || {}).tasks || {};
    const list = (t.buckets || []).map(x => String(x).trim()).filter(Boolean);
    return list.length ? list : TASK_BUCKETS.slice();
  }
  /* The Vikunja columns win for a Vikunja project — anything else would show a
     board that the server does not have. */
  columns() {
    const r = this.remote;
    if (r && r.project === this.view.sel && r.buckets && r.buckets.length) {
      return r.buckets.map(b => ({ title: b.title, id: b.id, kind: bucketKind(b.title), limit: b.limit }));
    }
    return this.localBuckets().map(title => ({ title, id: null, kind: bucketKind(title), limit: 0 }));
  }
  doneColumn(cols) { return cols.find(c => c.kind === 'done') || null; }

  /* Which column a task belongs in: what its note says, unless it is done — a
     completed task belongs under "done" even if its bucket was never set.

     A bucket nobody configured (column renamed, Vikunja bucket gone) keeps its
     OWN name and gets a column of its own further right. Quietly folding those
     cards into the first column would look like the board had rearranged your
     work behind your back. */
  columnOf(task, cols) {
    const done = this.doneColumn(cols);
    if (task.done && done) return done.title;
    const raw = String(task.bucket || '').trim();
    if (!raw) return cols.length ? cols[0].title : '';
    const hit = cols.find(c => c.title.toLowerCase() === raw.toLowerCase());
    if (!hit) return raw;                                   // → a stray column
    // An open task must not sit under "done" just because its bucket says so.
    return hit.kind === 'done' ? (cols[0] ? cols[0].title : raw) : hit.title;
  }

  /* ---- Vikunja ------------------------------------------------------------ */

  vikunjaProject(d) {
    const p = d.byName.get(this.view.sel);
    if (!p || p.provider !== 'vikunja') return null;
    const fm = (this.app.metadataCache.getFileCache(p.file) || {}).frontmatter || {};
    const remoteId = fm['nexus-id'] ? String(fm['nexus-id']) : '';
    if (!remoteId) return null;
    const acc = ((this.plugin.settings.tasksCalendar || {}).accounts || [])
      .find(a => a.kind === 'vikunja' && (!p.account || a.id === p.account));
    if (!acc) return null;
    return { note: p, remoteId, account: acc };
  }
  client(acc) {
    let fsOk = false; try { require('fs'); fsOk = true; } catch (e) {}
    if (!fsOk) return null;                                  // mobile reads the notes only
    const cred = this.plugin.getCredential(acc.id);
    if (!cred || !cred.secret) return null;
    const { VikunjaClient } = require('./vikunja.js');
    return new VikunjaClient({ base: acc.serverUrl, token: cred.secret });
  }

  /* Pull the project's buckets and write each task's column into its note. Runs
     in the background: the board renders from the notes right away and simply
     repaints when the server answered. */
  async pullVikunja(d) {
    if (this._pulling) return;
    const vp = this.vikunjaProject(d);
    if (!vp) { this.remote = null; return; }
    if (this.remote && this.remote.project === this.view.sel && this.remote.fresh) return;
    const client = this.client(vp.account);
    if (!client) return;
    this._pulling = true;
    try {
      const buckets = await client.listBuckets(vp.remoteId);
      if (!buckets.length) { this.remote = { project: this.view.sel, buckets: [], fresh: true }; return; }
      const byTask = new Map();
      buckets.forEach(b => b.taskIds.forEach(id => byTask.set(String(id), b.title)));
      this.remote = { project: this.view.sel, buckets, fresh: true, error: '' };

      let changed = 0;
      for (const t of d.items) {
        if (t.provider !== 'vikunja' || !t.remoteId) continue;
        const want = byTask.get(String(t.remoteId));
        if (!want || want === t.bucket) continue;
        await tasks.setTaskBucket(this.plugin, t, want);
        changed++;
      }
      if (changed) new Notice('Nexus: ' + changed + ' task(s) sorted into their Vikunja columns.');
      this.view.reload();
    } catch (e) {
      this.remote = { project: this.view.sel, buckets: [], fresh: true, error: (e && e.message) || String(e) };
      console.error('[nexus-suite] vikunja buckets', e);
    } finally {
      this._pulling = false;
    }
  }
  /* A drag on a Vikunja task has to reach the server, or the next sync would
     quietly drag the card back. */
  async pushVikunja(d, task, columnTitle) {
    const vp = this.vikunjaProject(d);
    if (!vp || task.provider !== 'vikunja' || !task.remoteId) return;
    const bucket = (this.remote && this.remote.buckets || []).find(b => b.title === columnTitle);
    if (!bucket) return;
    const client = this.client(vp.account);
    if (!client) return;
    try { await client.moveTaskToBucket(vp.remoteId, bucket.id, task.remoteId); }
    catch (e) {
      new Notice('Vikunja: the card could not be moved — ' + ((e && e.message) || e));
      console.error('[nexus-suite] vikunja move', e);
    }
  }

  /* ---- actions ------------------------------------------------------------ */

  async drop(d, task, column, cols) {
    const done = this.doneColumn(cols);
    const wantDone = !!(done && column.title === done.title);
    if (wantDone !== task.done) await this.view.toggle(task, wantDone);
    await tasks.setTaskBucket(this.plugin, task, cols[0] && column.title === cols[0].title ? '' : column.title);
    if (task.provider === 'vikunja') await this.pushVikunja(d, task, column.title);
    this.view.schedule();
  }

  /* ---- render ------------------------------------------------------------- */

  render(main, d) {
    const cols = this.columns();
    const items = this.view.visible(d);
    const wrap = main.createDiv('nx-tb');

    if (this.remote && this.remote.error) {
      wrap.createDiv({ cls: 'nx-tb-warn', text: 'Vikunja columns unavailable (' + this.remote.error + ') — showing your own columns.' });
    }
    const board = wrap.createDiv('nx-tb-cols');
    const byCol = new Map(cols.map(c => [c.title, []]));
    items.forEach(t => {
      const key = this.columnOf(t, cols);
      if (!byCol.has(key)) byCol.set(key, []);
      byCol.get(key).push(t);
    });

    cols.forEach(c => this.column(board, d, c, byCol.get(c.title) || [], cols));
    // Tasks whose bucket no longer exists as a column keep a home of their own —
    // losing them because someone renamed a column would be the worst outcome.
    Array.from(byCol.keys()).filter(k => !cols.find(c => c.title === k)).forEach(k => {
      this.column(board, d, { title: k, id: null, kind: 'open', limit: 0, stray: true }, byCol.get(k), cols);
    });

    // Vikunja columns are fetched after the first paint so the board never waits
    // on the network.
    const vp = this.vikunjaProject(d);
    if (vp) window.setTimeout(() => this.pullVikunja(d), 0);
  }

  column(board, d, col, items, cols) {
    const el = board.createDiv('nx-tb-col is-' + col.kind + (col.stray ? ' is-stray' : ''));
    el.dataset.col = col.title;
    el.style.setProperty('--nx-kb-kind', kindVar(col.kind));

    const head = el.createDiv('nx-tb-col-head');
    head.createSpan({ cls: 'nx-tb-col-dot' });
    head.createSpan({ cls: 'nx-tb-col-title', text: col.title });
    const openN = items.filter(t => !t.done).length;
    const cnt = head.createSpan({ cls: 'nx-tb-col-count', text: col.limit ? openN + '/' + col.limit : String(items.length) });
    if (col.limit && openN > col.limit) cnt.addClass('is-over');
    if (col.stray) head.setAttribute('aria-label', 'No column of this name — from the task notes');

    const list = el.createDiv('nx-tb-cards');
    list.dataset.col = col.title;
    items.forEach(t => this.card(list, d, t, cols));
    if (!items.length) list.createDiv({ cls: 'nx-tb-none', text: '—' });

    if (this.view.sel && !col.stray) this.addRow(el, d, col);
  }

  card(list, d, t, cols) {
    const today = moment().format('YYYY-MM-DD');
    const overdue = !t.done && t.dueDay && t.dueDay < today;
    const c = list.createDiv('nx-tb-card' + (t.done ? ' is-done' : '') + (overdue ? ' is-overdue' : ''));

    const box = c.createEl('input', { cls: 'nx-tb-check', attr: { type: 'checkbox' } });
    box.checked = t.done;
    box.onclick = (e) => e.stopPropagation();
    box.onchange = () => { c.addClass('is-busy'); this.view.toggle(t, box.checked); };

    const body = c.createDiv('nx-tb-card-body');
    body.createDiv({ cls: 'nx-tb-card-t', text: t.title });
    const meta = body.createDiv('nx-tb-card-meta');
    if (t.dueDay) {
      const m = moment(t.dueDay, 'YYYY-MM-DD');
      meta.createSpan({
        cls: 'nx-tb-due' + (overdue ? ' is-late' : '') + (t.dueDay === today ? ' is-today' : ''),
        text: t.dueDay === today ? 'today' : m.format('D MMM') + (t.timed ? ' · ' + t.timed : ''),
      });
    }
    if (t.repeat) setIcon(meta.createSpan({ cls: 'nx-tb-rep' }), 'repeat');
    const pl = priorityLabel(t.priority);
    if (pl) meta.createSpan({ cls: 'nx-tb-prio is-' + pl.toLowerCase(), text: pl });
    if (!this.view.sel && t.project) meta.createSpan({ cls: 'nx-tb-chip', text: t.project });
    if (t.provider !== 'local' && !t.remoteId) meta.createSpan({ cls: 'nx-tb-pending', text: 'not synced yet' });
    if (!meta.childElementCount) meta.remove();

    c.onclick = (e) => {
      if (c.hasClass('is-dragging')) return;
      this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(t.file);
    };
    this.drag(c, d, t, cols);
  }

  addRow(colEl, d, col) {
    // No + in front of the field, same as the kanban board: the dashed row and
    // the placeholder already say what it is.
    const row = colEl.createDiv('nx-tb-add');
    const input = row.createEl('input', { cls: 'nx-tb-add-input', attr: { type: 'text', placeholder: 'New task' } });
    input.onkeydown = async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      input.disabled = true;
      try {
        const p = d.byName.get(this.view.sel);
        if (!p) { new Notice('Pick a project first.'); return; }
        const res = await tasks.createTask(this.plugin, this.view.sel, {
          title, provider: p.provider, account: p.account,
          status: col.kind === 'done' ? 'completed' : 'needs-action',
        });
        // The column is the note's own line — set it right after creation so the
        // card appears where it was typed, not in the first column.
        const first = this.columns()[0];
        if (res && res.file && (!first || col.title !== first.title)) {
          await this.app.fileManager.processFrontMatter(res.file, fm => { fm.bucket = col.title; });
        }
        if (p.provider !== 'local') this.plugin.queueTaskSync();
        this.view.schedule();
      } finally { input.disabled = false; }
    };
  }

  /* Pointer drag, same idiom as the note board — HTML5 drag & drop does not
     exist under a finger on the tablet. */
  drag(cardEl, d, task, cols) {
    cardEl.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button > 0) return;
      if (e.target && e.target.closest && e.target.closest('.nx-tb-check')) return;
      const startX = e.clientX, startY = e.clientY;
      let ghost = null, moved = false;
      const scroller = nxEdgeScroller(cardEl.closest('.nx-tb-cols'));
      const colAt = (ev) => {
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        return under && under.closest ? under.closest('.nx-tb-col:not(.is-stray)') : null;
      };
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
        if (!moved) {
          moved = true;
          cardEl.addClass('is-dragging');
          ghost = document.body.createDiv('nx-kb-ghost');
          ghost.setText(task.title);
        }
        ghost.style.left = ev.clientX + 12 + 'px';
        ghost.style.top = ev.clientY + 12 + 'px';
        scroller.at(ev.clientX);
        document.querySelectorAll('.nx-tb-col.is-over').forEach(x => x.removeClass('is-over'));
        const target = colAt(ev);
        if (target) target.addClass('is-over');
      };
      const up = async (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        scroller.stop();
        if (ghost) ghost.remove();
        document.querySelectorAll('.nx-tb-col.is-over').forEach(x => x.removeClass('is-over'));
        const target = moved ? colAt(ev) : null;
        window.setTimeout(() => cardEl.removeClass('is-dragging'), 0);
        if (!target) return;
        const title = target.dataset.col;
        const col = cols.find(c => c.title === title);
        if (!col || title === this.columnOf(task, cols)) return;
        await this.drop(d, task, col, cols);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }
}

module.exports = { NexusTaskBoard };
