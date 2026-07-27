'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · CalDAV client (RFC 4791) over Obsidian requestUrl
 *  DESKTOP ONLY — instantiated behind the fs-guard sync loop. requestUrl
 *  bypasses CORS and sends arbitrary WebDAV methods (PROPFIND/REPORT/PUT).
 *  Discovery + read for Milestone 1; PUT/DELETE included for Milestone 2.
 *
 *  Flows ported from velumeron's caldav-client.py; XML queried by localName so
 *  the namespace prefix (d:/D:/dav:) does not matter across servers.
 * ========================================================================== */

const { requestUrl, moment } = require('obsidian');

function b64(s) {
  try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return btoa(s); }
}

class CalDavClient {
  constructor(opts) {
    this.serverUrl = String(opts.serverUrl || '').trim();
    this.username = opts.username || '';
    this.password = opts.password || '';
    this.auth = 'Basic ' + b64(this.username + ':' + this.password);
  }

  origin() { try { return new URL(this.serverUrl).origin; } catch (e) { return this.serverUrl; } }
  resolve(href) { try { return new URL(href, this.serverUrl).href; } catch (e) { return href; } }

  async req(method, url, { headers, body, depth } = {}) {
    const h = Object.assign({ Authorization: this.auth, 'Content-Type': 'application/xml; charset=utf-8' }, headers || {});
    if (depth != null) h.Depth = String(depth);
    let target = url;
    for (let hop = 0; hop < 3; hop++) {
      const res = await requestUrl({ url: target, method, headers: h, body, throw: false });
      if ([301, 302, 307, 308].includes(res.status) && res.headers && res.headers.location) {
        target = new URL(res.headers.location, target).href;
        continue;
      }
      return res;
    }
    throw new Error('CalDAV: too many redirects for ' + url);
  }

  /* ── XML helpers (namespace-agnostic by localName) ── */
  _xml(text) { return new DOMParser().parseFromString(text || '', 'application/xml'); }
  _els(node, local) {
    const out = [];
    const all = node.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].localName === local) out.push(all[i]);
    return out;
  }
  _first(node, local) { const e = this._els(node, local); return e.length ? e[0] : null; }
  _text(node, local) { const e = this._first(node, local); return e ? (e.textContent || '').trim() : ''; }
  _ok(response) {
    const st = this._first(response, 'status');
    if (!st) return true;
    const m = (st.textContent || '').match(/\s(\d{3})\s/);
    return m ? m[1].startsWith('2') : true;
  }
  _statusCode(response) {
    const st = this._first(response, 'status');
    const m = st ? (st.textContent || '').match(/\s(\d{3})\s/) : null;
    return m ? parseInt(m[1], 10) : 207;
  }

  /* ── Discovery: principal → calendar-home-set → calendar collections ── */
  async discover() {
    const principal = await this._findPrincipal();
    const home = await this._findHomeSet(principal);
    const calendars = await this._listCalendars(home);
    return { principalHref: principal, homeSet: home, calendars };
  }

  async _findPrincipal() {
    const body = '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
    // try the server URL directly, then the well-known path
    const tryUrls = [this.serverUrl, new URL('/.well-known/caldav', this.origin()).href];
    for (const u of tryUrls) {
      const res = await this.req('PROPFIND', u, { body, depth: 0 });
      if (res.status >= 200 && res.status < 300) {
        const doc = this._xml(res.text);
        const cup = this._first(doc, 'current-user-principal');
        const href = cup ? this._text(cup, 'href') : '';
        if (href) return this.resolve(href);
        // some servers answer the principal directly at the given URL
        return u;
      }
    }
    throw new Error('CalDAV: could not resolve principal (check URL / credentials)');
  }

  async _findHomeSet(principalUrl) {
    const body = '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><c:calendar-home-set/></d:prop></d:propfind>';
    const res = await this.req('PROPFIND', principalUrl, { body, depth: 0 });
    const doc = this._xml(res.text);
    const chs = this._first(doc, 'calendar-home-set');
    const href = chs ? this._text(chs, 'href') : '';
    return href ? this.resolve(href) : principalUrl;
  }

  async _listCalendars(homeUrl) {
    const body = '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"' +
      ' xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">' +
      '<d:prop><d:resourcetype/><d:displayname/><cs:getctag/><d:sync-token/>' +
      '<c:supported-calendar-component-set/><ic:calendar-color/></d:prop></d:propfind>';
    const res = await this.req('PROPFIND', homeUrl, { body, depth: 1 });
    const doc = this._xml(res.text);
    const cals = [];
    for (const resp of this._els(doc, 'response')) {
      const rtype = this._first(resp, 'resourcetype');
      const isCal = rtype && this._els(rtype, 'calendar').length;
      if (!isCal) continue;
      const href = this.resolve(this._text(resp, 'href'));
      const comps = this._els(resp, 'comp').map(c => (c.getAttribute('name') || '').toUpperCase());
      let component = 'VEVENT';
      if (comps.includes('VTODO') && !comps.includes('VEVENT')) component = 'VTODO';
      const colorEl = this._first(resp, 'calendar-color');
      cals.push({
        href,
        display: this._text(resp, 'displayname') || href,
        color: colorEl ? (colorEl.textContent || '').trim().slice(0, 7) : '',
        component,
        ctag: this._text(resp, 'getctag'),
        syncToken: this._text(resp, 'sync-token'),
      });
    }
    return cals;
  }

  /* ── cheap change gate: current ctag of a collection ── */
  async getCtag(calHref) {
    const body = '<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">' +
      '<d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>';
    const res = await this.req('PROPFIND', calHref, { body, depth: 0 });
    const doc = this._xml(res.text);
    return { ctag: this._text(doc, 'getctag'), syncToken: this._text(doc, 'sync-token') };
  }

  /* ── calendar-query REPORT (time-range) → [{href, etag, ics}] ── */
  async listComponents(calHref, comp, rangeStart, rangeEnd) {
    const fmt = (m) => moment(m).utc().format('YYYYMMDDTHHmmss') + 'Z';
    const body = '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="' + comp + '">' +
      (rangeStart && rangeEnd ? '<c:time-range start="' + fmt(rangeStart) + '" end="' + fmt(rangeEnd) + '"/>' : '') +
      '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
    const res = await this.req('REPORT', calHref, { body, depth: 1 });
    const doc = this._xml(res.text);
    const out = [];
    for (const resp of this._els(doc, 'response')) {
      if (!this._ok(resp)) continue;
      out.push({
        href: this.resolve(this._text(resp, 'href')),
        etag: this._text(resp, 'getetag'),
        ics: this._text(resp, 'calendar-data'),
      });
    }
    return out;
  }

  /* ── sync-collection REPORT (incremental) → {changed, removed, syncToken} ── */
  async syncCollection(calHref, syncToken) {
    const body = '<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:sync-token>' + (syncToken || '') + '</d:sync-token><d:sync-level>1</d:sync-level>' +
      '<d:prop><d:getetag/><c:calendar-data/></d:prop></d:sync-collection>';
    const res = await this.req('REPORT', calHref, { body, depth: 1 });
    const doc = this._xml(res.text);
    const changed = [], removed = [];
    for (const resp of this._els(doc, 'response')) {
      const href = this.resolve(this._text(resp, 'href'));
      if (this._statusCode(resp) === 404) { removed.push(href); continue; }
      const ics = this._text(resp, 'calendar-data');
      changed.push({ href, etag: this._text(resp, 'getetag'), ics });
    }
    const newToken = this._text(doc, 'sync-token');
    return { changed, removed, syncToken: newToken || syncToken };
  }

  /* ── writes (Milestone 2) ── */
  async putResource(url, ics, etag) {
    const headers = { 'Content-Type': 'text/calendar; charset=utf-8' };
    if (etag === null) headers['If-None-Match'] = '*';
    else if (etag) headers['If-Match'] = etag;
    const res = await this.req('PUT', url, { headers, body: ics });
    return { status: res.status, etag: res.headers ? (res.headers.etag || res.headers.Etag || '') : '' };
  }
  async deleteResource(url, etag) {
    const headers = {};
    if (etag) headers['If-Match'] = etag;
    const res = await this.req('DELETE', url, { headers });
    return { status: res.status };
  }
}

module.exports = { CalDavClient };
