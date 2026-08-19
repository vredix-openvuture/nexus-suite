'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · Vikunja REST client + field mapping
 *  Self-contained (requestUrl + Bearer token) — no velumeron dependency. Logic
 *  ported from velumeron's vikunja-client.py. DESKTOP ONLY (behind fs-guard).
 *
 *  IMPORTANT: always paginate (`?per_page=&page=`) — the bare /projects call is
 *  blocked by the openresty WAF (HTTP 403); the paginated form passes.
 * ========================================================================== */

const { requestUrl } = require('obsidian');

const PER_PAGE = 50;
const EMPTY_DATE = /^0001-01-01/;   // Vikunja's "no date" sentinel

class VikunjaClient {
  constructor(opts) {
    this.base = String(opts.base || opts.serverUrl || '').replace(/\/+$/, '');
    // accept a CalDAV-style base (…/dav/principals/x/) → strip to scheme://host
    const m = this.base.match(/^(https?:\/\/[^/]+)/);
    if (m) this.origin = m[1]; else this.origin = this.base;
    this.token = opts.token || '';
  }
  _headers() { return { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }; }

  async _req(method, path, body) {
    const res = await requestUrl({
      url: this.origin + '/api/v1' + path, method,
      headers: this._headers(), body: body != null ? JSON.stringify(body) : undefined, throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      const e = new Error('Vikunja HTTP ' + res.status + ' on ' + method + ' ' + path);
      e.status = res.status; throw e;
    }
    return res;
  }

  async _getPaged(path) {
    const out = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= 200; page++) {
      const res = await this._req('GET', path + sep + 'per_page=' + PER_PAGE + '&page=' + page);
      const arr = res.json;
      if (!Array.isArray(arr) || !arr.length) break;
      out.push(...arr);
      const total = parseInt((res.headers && (res.headers['x-pagination-total-pages'] || res.headers['X-Pagination-Total-Pages'])) || '1', 10);
      if (page >= (total || 1)) break;
    }
    return out;
  }

  listProjects() { return this._getPaged('/projects'); }
  listTasks(projectId) { return this._getPaged('/projects/' + projectId + '/tasks?filter_include_nulls=true'); }
  getTask(id) { return this._req('GET', '/tasks/' + id).then(r => r.json); }
  async updateTask(id, patch) {
    // Vikunja replaces the task with the posted object → merge onto the current one.
    const cur = await this.getTask(id);
    const merged = Object.assign({}, cur, patch);
    return (await this._req('POST', '/tasks/' + id, merged)).json;
  }
  createTask(projectId, task) { return this._req('PUT', '/projects/' + projectId + '/tasks', task).then(r => r.json); }
  deleteTask(id) { return this._req('DELETE', '/tasks/' + id).then(() => true); }
  createProject(project) { return this._req('PUT', '/projects', project).then(r => r.json); }

  /* ── Kanban ──
     Vikunja ≥ 0.24 (this server: v2.x) hangs the kanban buckets off a project
     VIEW, not off the project: /projects/{p}/views → the one with
     view_kind "kanban" → /projects/{p}/views/{v}/buckets, each bucket carrying
     its tasks. Older servers exposed /projects/{p}/buckets directly, so both
     paths are tried and the caller only ever sees buckets. */
  listViews(projectId) { return this._req('GET', '/projects/' + projectId + '/views').then(r => r.json || []); }
  async kanbanViewId(projectId) {
    if (this._views && this._views[projectId] !== undefined) return this._views[projectId];
    let id = null;
    try {
      const views = await this.listViews(projectId);
      const kb = (Array.isArray(views) ? views : []).find(v => String(v.view_kind || v.viewKind || '').toLowerCase() === 'kanban');
      if (kb) id = kb.id;
    } catch (e) { if (e.status !== 404) throw e; }
    this._views = this._views || {};
    this._views[projectId] = id;
    return id;
  }
  /* → [{id, title, limit, position, taskIds:[…]}] (empty when the project has
       no kanban view — the caller then falls back to its own columns). */
  async listBuckets(projectId) {
    const viewId = await this.kanbanViewId(projectId);
    const path = viewId != null
      ? '/projects/' + projectId + '/views/' + viewId + '/buckets'
      : '/projects/' + projectId + '/buckets';
    let raw;
    try { raw = await this._getPaged(path); }
    catch (e) { if (e.status === 404) return []; throw e; }
    return (raw || []).map(b => ({
      id: b.id, title: b.title || '', limit: parseInt(b.limit, 10) || 0,
      position: b.position || 0,
      taskIds: (b.tasks || []).map(t => String(t.id)),
    }));
  }
  async moveTaskToBucket(projectId, bucketId, taskId) {
    const viewId = await this.kanbanViewId(projectId);
    const body = { task_id: parseInt(taskId, 10) || taskId, bucket_id: bucketId };
    const path = viewId != null
      ? '/projects/' + projectId + '/views/' + viewId + '/buckets/' + bucketId + '/tasks'
      : '/projects/' + projectId + '/buckets/' + bucketId + '/tasks';
    return (await this._req('POST', path, body)).json;
  }
  async createBucket(projectId, title) {
    const viewId = await this.kanbanViewId(projectId);
    const path = viewId != null
      ? '/projects/' + projectId + '/views/' + viewId + '/buckets'
      : '/projects/' + projectId + '/buckets';
    return (await this._req('PUT', path, { title })).json;
  }

  /* A project's background image (upload provider) as raw bytes, or null when
     there is none / the fetch fails — a missing banner must never fail a sync. */
  async getBackground(projectId) {
    let res;
    try {
      res = await requestUrl({
        url: this.origin + '/api/v1/projects/' + projectId + '/background', method: 'GET',
        headers: { Authorization: 'Bearer ' + this.token }, throw: false,
      });
    } catch (e) { return null; }
    if (!res || res.status < 200 || res.status >= 300) return null;
    return res.arrayBuffer || null;
  }
}

/* ── Field mapping: raw Vikunja API task → normalized Nexus task ──
   Normalized shape (canonical for diff/hash): {title, description, due, priority, done, repeat}
   plus identity/meta {remoteId, projectId, parentId, updated}. */
function toYmd(rfc) {
  if (!rfc || EMPTY_DATE.test(rfc)) return '';
  const m = String(rfc).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}
function repeatToRRule(repeatAfter, repeatMode) {
  // Vikunja repeat_after is seconds; repeat_mode 0=default,1=monthly,2=from-current-date.
  const s = parseInt(repeatAfter, 10) || 0;
  if (!s) return '';
  if (parseInt(repeatMode, 10) === 1) return 'FREQ=MONTHLY';
  const day = 86400;
  if (s % (7 * day) === 0) return 'FREQ=WEEKLY' + (s / (7 * day) > 1 ? ';INTERVAL=' + (s / (7 * day)) : '');
  if (s % day === 0) return 'FREQ=DAILY' + (s / day > 1 ? ';INTERVAL=' + (s / day) : '');
  return 'FREQ=DAILY;INTERVAL=' + Math.max(1, Math.round(s / day));
}
function rruleToRepeat(rrule) {
  // best-effort reverse → {repeat_after (s), repeat_mode}
  if (!rrule) return { repeat_after: 0, repeat_mode: 0 };
  const p = {}; String(rrule).split(';').forEach(x => { const [k, v] = x.split('='); if (v) p[k.toUpperCase()] = v; });
  const n = Math.max(1, parseInt(p.INTERVAL, 10) || 1);
  const day = 86400;
  if (p.FREQ === 'MONTHLY') return { repeat_after: 30 * day * n, repeat_mode: 1 };
  if (p.FREQ === 'WEEKLY') return { repeat_after: 7 * day * n, repeat_mode: 0 };
  if (p.FREQ === 'YEARLY') return { repeat_after: 365 * day * n, repeat_mode: 0 };
  return { repeat_after: day * n, repeat_mode: 0 };
}

function mapTaskFromApi(t) {
  return {
    remoteId: String(t.id),
    projectId: String(t.project_id),
    parentId: 0,   // Vikunja subtasks via related_tasks; deferred
    updated: t.updated || '',
    // canonical (diffable) fields:
    title: t.title || '',
    description: t.description || '',
    due: toYmd(t.due_date),
    priority: parseInt(t.priority, 10) || 0,
    done: !!t.done,
    repeat: repeatToRRule(t.repeat_after, t.repeat_mode),
  };
}

/* normalized (local) task → API patch for the changed canonical fields */
function mapTaskToApi(local) {
  const rep = rruleToRepeat(local.repeat);
  const patch = {
    title: local.title || '',
    description: local.description || '',
    priority: local.priority || 0,
    done: !!local.done,
    repeat_after: rep.repeat_after,
    repeat_mode: rep.repeat_mode,
  };
  patch.due_date = local.due ? (local.due + 'T00:00:00Z') : '0001-01-01T00:00:00Z';
  return patch;
}

function mapProjectFromApi(p) {
  return {
    remoteId: String(p.id),
    title: p.title || 'Project',
    parentId: p.parent_project_id ? String(p.parent_project_id) : 0,
    color: p.hex_color ? ('#' + String(p.hex_color).replace(/^#/, '')) : '',
    description: p.description || '',
    archived: !!p.is_archived,
    updated: p.updated || '',
    // set when the project has a background image on the server (upload
    // provider); the bytes come from GET /projects/{id}/background
    hasBackground: !!p.background_information,
    blurHash: p.background_blur_hash || '',
  };
}

module.exports = {
  VikunjaClient, mapTaskFromApi, mapTaskToApi, mapProjectFromApi,
  repeatToRRule, rruleToRepeat, toYmd,
};
