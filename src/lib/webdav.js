'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · WebDAV client
 *  Files over HTTP. This is the sibling of lib/caldav.js: same transport, same
 *  auth, different verbs — CalDAV moves calendar objects, WebDAV moves files,
 *  and a vault is files.
 *
 *  Everything goes through Obsidian's `requestUrl`, which has no CORS to argue
 *  with and works on MOBILE as well as on the desktop. That matters more than
 *  it sounds: a vault sync that only runs on a laptop is not a vault sync.
 * ========================================================================== */

const { requestUrl } = require('obsidian');

function base64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/* Join a base URL and a vault-relative path without ever producing a double
   slash or losing a segment — and encode each segment separately, so a folder
   called "My Notes" survives and a slash in a name cannot escape the path. */
function joinUrl(base, path) {
  const root = String(base || '').replace(/\/+$/, '');
  const parts = String(path || '').split('/').filter(Boolean).map(encodeURIComponent);
  return parts.length ? root + '/' + parts.join('/') : root + '/';
}

/* The reverse: a href out of a PROPFIND response back to a vault path, relative
   to the collection that was asked about. Servers answer with absolute paths,
   full URLs, and sometimes with a trailing slash, so all three are handled. */
function hrefToPath(href, baseUrl) {
  let value = String(href || '');
  try { value = decodeURIComponent(value); } catch (e) { /* leave it as it came */ }
  const base = String(baseUrl || '');
  let root;
  try { root = decodeURIComponent(new URL(base).pathname); }
  catch (e) { root = base.replace(/^https?:\/\/[^/]+/i, ''); }
  root = root.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(value)) {
    try { value = decodeURIComponent(new URL(value).pathname); } catch (e) { /* keep it */ }
  }
  if (root && value.indexOf(root) === 0) value = value.slice(root.length);
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function textOf(node, tag) {
  if (!node) return '';
  const found = node.getElementsByTagName(tag);
  if (found && found.length) return (found[0].textContent || '').trim();
  const local = node.getElementsByTagNameNS ? node.getElementsByTagNameNS('*', tag) : null;
  return local && local.length ? (local[0].textContent || '').trim() : '';
}

/* Parse a PROPFIND multistatus into entries. Anything the server answered that
   we cannot make sense of is skipped rather than guessed at. */
function parseListing(xml, baseUrl) {
  const doc = new DOMParser().parseFromString(xml || '', 'text/xml');
  if (!doc || doc.querySelector('parsererror')) return [];
  const responses = doc.getElementsByTagNameNS('*', 'response');
  const out = [];
  for (let i = 0; i < responses.length; i++) {
    const node = responses[i];
    const href = textOf(node, 'href');
    if (!href) continue;
    const path = hrefToPath(href, baseUrl);
    const isCollection = node.getElementsByTagNameNS('*', 'collection').length > 0;
    const modified = textOf(node, 'getlastmodified');
    const size = parseInt(textOf(node, 'getcontentlength'), 10);
    out.push({
      path,
      folder: isCollection,
      mtime: modified ? Date.parse(modified) || 0 : 0,
      size: isFinite(size) ? size : 0,
      etag: textOf(node, 'getetag').replace(/^W\//, '').replace(/"/g, ''),
    });
  }
  return out;
}

const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?>'
  + '<d:propfind xmlns:d="DAV:"><d:prop>'
  + '<d:resourcetype/><d:getlastmodified/><d:getcontentlength/><d:getetag/>'
  + '</d:prop></d:propfind>';

class WebDavClient {
  constructor(opts) {
    opts = opts || {};
    this.baseUrl = String(opts.baseUrl || '').replace(/\/+$/, '');
    this.username = opts.username || '';
    this.password = opts.password || '';
    this.auth = this.username ? 'Basic ' + base64(this.username + ':' + this.password) : '';
  }

  headers(extra) {
    const h = Object.assign({}, extra || {});
    if (this.auth) h.Authorization = this.auth;
    return h;
  }

  async request(method, path, opts) {
    opts = opts || {};
    const res = await requestUrl({
      url: typeof path === 'string' && /^https?:\/\//i.test(path) ? path : joinUrl(this.baseUrl, path),
      method,
      headers: this.headers(opts.headers),
      body: opts.body,
      throw: false,
    });
    return res;
  }

  /* One level of a collection. Returns [] for a folder that is not there, which
     is the honest answer to "what is in it" and lets a first sync just work. */
  async list(path) {
    const res = await this.request('PROPFIND', path, {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return [];
    if (res.status !== 207 && res.status !== 200) {
      throw new Error('listing "' + (path || '/') + '" failed with ' + res.status);
    }
    const self = String(path || '').replace(/^\/+|\/+$/g, '');
    return parseListing(res.text, this.baseUrl).filter(e => e.path !== self);
  }

  /* Everything under a folder. Depth: infinity is what this wants, but plenty
     of servers refuse it, so the walk is done a level at a time. */
  async listTree(path, skip) {
    const out = [];
    const queue = [String(path || '')];
    const seen = new Set();
    while (queue.length) {
      const at = queue.shift();
      if (seen.has(at)) continue;
      seen.add(at);
      let entries;
      try { entries = await this.list(at); }
      catch (e) { throw new Error('walking "' + (at || '/') + '": ' + e.message); }
      for (const entry of entries) {
        if (skip && skip(entry.path, entry.folder)) continue;
        if (entry.folder) queue.push(entry.path);
        else out.push(entry);
      }
    }
    return out;
  }

  async exists(path) {
    const res = await this.request('HEAD', path);
    return res.status >= 200 && res.status < 300;
  }

  async get(path) {
    const res = await this.request('GET', path);
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) throw new Error('downloading "' + path + '" failed with ' + res.status);
    return res;
  }

  async put(path, body, contentType) {
    const res = await this.request('PUT', path, {
      body,
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
    });
    if (res.status < 200 || res.status >= 300) throw new Error('uploading "' + path + '" failed with ' + res.status);
    return res;
  }

  async remove(path) {
    const res = await this.request('DELETE', path);
    // Already gone is the outcome that was asked for.
    if (res.status === 404) return true;
    if (res.status < 200 || res.status >= 300) throw new Error('deleting "' + path + '" failed with ' + res.status);
    return true;
  }

  /* Create a collection and every parent it needs. A server that already has it
     answers 405, which is success for this purpose. */
  async ensureFolder(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    let at = '';
    for (const part of parts) {
      at = at ? at + '/' + part : part;
      const res = await this.request('MKCOL', at);
      if (res.status === 405 || res.status === 301) continue;   // there already
      if (res.status < 200 || res.status >= 300) {
        throw new Error('creating the folder "' + at + '" failed with ' + res.status);
      }
    }
    return true;
  }

  /* Does this URL answer, and are the credentials right? Reported as a sentence
     rather than a status code, because that is what a settings page has room
     to show. */
  async check() {
    let res;
    try {
      res = await this.request('PROPFIND', '', { headers: { Depth: '0' }, body: PROPFIND_BODY });
    } catch (e) {
      return { ok: false, message: 'the server could not be reached: ' + (e && e.message ? e.message : 'unknown error') };
    }
    if (res.status === 401) return { ok: false, message: 'the server refused the user name or password' };
    if (res.status === 403) return { ok: false, message: 'the account is not allowed into that folder' };
    if (res.status === 404) return { ok: false, message: 'that folder does not exist on the server' };
    if (res.status === 405) return { ok: false, message: 'the URL answered, but not as WebDAV — check the path' };
    if (res.status !== 207 && res.status !== 200) return { ok: false, message: 'the server answered with ' + res.status };
    return { ok: true, message: 'connected' };
  }
}

module.exports = { WebDavClient, joinUrl, hrefToPath, parseListing, base64, PROPFIND_BODY };
