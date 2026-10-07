'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · book sources
 *  Public catalogues, asked in parallel, merged by the user's order: per field
 *  the first source that has it wins, covers are collected from all. None of
 *  them is complete — on 2026-10-07 Open Library did not know a common dtv
 *  paperback and the DNB did not know a Puffin one — which is why there are
 *  several and why the order is the user's.
 * ========================================================================== */

const { requestUrl } = require('obsidian');

const SOURCES = [
  { id: 'dnb', label: 'DNB (Deutsche Nationalbibliothek)', needsKey: false },
  { id: 'openlibrary', label: 'Open Library', needsKey: false },
  // Anonymous requests get HTTP 429 with a quota of 0, so a key is required.
  { id: 'google', label: 'Google Books', needsKey: true },
];

const FIELDS = ['title', 'subtitle', 'publisher', 'year', 'pages', 'language', 'description'];
const empty = () => ({ title: '', subtitle: '', authors: [], publisher: '', year: '',
  pages: '', language: '', description: '', genres: [], covers: [] });
const yearOf = s => (String(s || '').match(/\d{4}/) || [''])[0];
const uniq = a => [...new Set(a.filter(Boolean))];

function parseGoogle(json) {
  const v = json && json.items && json.items[0] && json.items[0].volumeInfo;
  if (!v || !v.title) return null;
  const r = empty();
  r.title = v.title; r.subtitle = v.subtitle || ''; r.authors = v.authors || [];
  r.publisher = v.publisher || ''; r.year = yearOf(v.publishedDate);
  r.pages = v.pageCount ? String(v.pageCount) : ''; r.language = v.language || '';
  r.description = v.description || ''; r.genres = v.categories || [];
  const l = v.imageLinks || {};
  const img = l.extraLarge || l.large || l.medium || l.thumbnail;
  if (img) r.covers.push(img.replace(/^http:/, 'https:').replace(/&edge=curl/, ''));
  return r;
}

function parseOpenLibrary(json, isbn) {
  const b = json && json['ISBN:' + isbn];
  if (!b || !b.title) return null;
  const r = empty();
  r.title = b.title; r.subtitle = b.subtitle || '';
  r.authors = (b.authors || []).map(a => a.name);
  r.publisher = (b.publishers && b.publishers[0] && b.publishers[0].name) || '';
  r.year = yearOf(b.publish_date);
  r.pages = b.number_of_pages ? String(b.number_of_pages) : '';
  r.genres = (b.subjects || []).map(s => s.name).slice(0, 8);
  r.covers.push((b.cover && (b.cover.large || b.cover.medium))
    || 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false');
  r.covers = r.covers.map(u => u.replace(/^http:/, 'https:'));
  return r;
}

/* MARC21 from the DNB's SRU interface. 245 title, 100/700 people, 264/260
   imprint, 300 extent, 041 language, 650 subjects. MARC wraps sort-skipped
   articles in control characters, ends fields with ISBD punctuation, and the
   DNB delivers decomposed (NFD) umlauts, which are composed here. */
function parseDnb(xml, isbn) {
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
  const fields = [...doc.getElementsByTagNameNS('*', 'datafield')];
  if (!fields.length) return null;
  const clean = s => String(s || '').normalize('NFC').replace(/[\u0098\u009c]/g, '').replace(/\s*[/:;,.]\s*$/, '').trim();
  const subs = (tag, code) => fields.filter(f => f.getAttribute('tag') === tag)
    .flatMap(f => [...f.getElementsByTagNameNS('*', 'subfield')])
    .filter(s => s.getAttribute('code') === code).map(s => clean(s.textContent));
  const first = (tag, code) => subs(tag, code)[0] || '';
  const flip = n => n.includes(', ') ? n.split(', ').slice(1).join(', ') + ' ' + n.split(', ')[0] : n;
  const r = empty();
  r.title = first('245', 'a');
  if (!r.title) return null;
  r.subtitle = first('245', 'b');
  const people = fields.filter(f => f.getAttribute('tag') === '100' || f.getAttribute('tag') === '700')
    .filter(f => {
      const roles = [...f.getElementsByTagNameNS('*', 'subfield')]
        .filter(s => s.getAttribute('code') === '4' || s.getAttribute('code') === 'e').map(s => s.textContent);
      return f.getAttribute('tag') === '100' || roles.some(x => /aut|Verfasser/i.test(x));
    })
    .map(f => [...f.getElementsByTagNameNS('*', 'subfield')].find(s => s.getAttribute('code') === 'a'))
    .filter(Boolean).map(s => flip(clean(s.textContent)));
  r.authors = uniq(people);
  r.publisher = first('264', 'b') || first('260', 'b');
  r.year = yearOf(first('264', 'c') || first('260', 'c'));
  const extent = first('300', 'a');   // "220 S." — the S. marks pages
  r.pages = (extent.match(/(\d+)\s*S\b/) || extent.match(/(\d+)/) || [null, ''])[1];
  r.language = first('041', 'a');
  r.genres = uniq(subs('650', 'a')).slice(0, 8);
  r.covers.push('https://portal.dnb.de/opac/mvb/cover?isbn=' + isbn);
  return r;
}

function urlFor(id, isbn, key) {
  if (id === 'dnb') return 'https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D'
    + isbn + '&recordSchema=MARC21-xml';
  if (id === 'openlibrary') return 'https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&jscmd=data&format=json';
  return 'https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&key=' + encodeURIComponent(key || '');
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

async function querySource(id, isbn, key, opts) {
  const meta = SOURCES.find(s => s.id === id);
  if (meta && meta.needsKey && !key) throw new Error('no API key');
  const request = opts.request || requestUrl;
  const res = await withTimeout(request({ url: urlFor(id, isbn, key), throw: false }), opts.timeoutMs || 8000);
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  if (id === 'dnb') return parseDnb(res.text, isbn);
  if (id === 'openlibrary') return parseOpenLibrary(res.json, isbn);
  return parseGoogle(res.json);
}

async function queryAll(isbn, sources, opts = {}) {
  const settled = await Promise.allSettled(sources.map(s => querySource(s.id, isbn, s.key, opts)));
  const records = [], status = [];
  settled.forEach((r, i) => {
    const id = sources[i].id;
    if (r.status === 'fulfilled') {
      status.push({ id, ok: true, found: !!r.value });
      if (r.value) records.push({ id, record: r.value });
    } else status.push({ id, ok: false, found: false, error: r.reason && r.reason.message || String(r.reason) });
  });
  return { records, status };
}

function merge(records) {
  const out = empty();
  for (const { record } of records) {
    for (const f of FIELDS) if (!out[f] && record[f]) out[f] = record[f];
    if (!out.authors.length && record.authors.length) out.authors = record.authors.slice();
    if (!out.genres.length && record.genres.length) out.genres = record.genres.slice();
  }
  const seen = new Set();
  out.covers = [];
  for (const { id, record } of records) for (const url of record.covers)
    if (!seen.has(url)) { seen.add(url); out.covers.push({ url, source: id }); }
  return out;
}

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function extFor(type) { return EXT[type] || 'jpg'; }

function headerOf(headers, name) {
  for (const k of Object.keys(headers || {})) if (k.toLowerCase() === name) return headers[k];
  return '';
}

/* An image counts only when it is one: status 200, an image type, and more
   than a placeholder pixel. Everything else is null, never an exception. */
async function loadImage(url, opts = {}) {
  try {
    const request = opts.request || requestUrl;
    const res = await withTimeout(request({ url, throw: false }), opts.timeoutMs || 8000);
    const type = String(headerOf(res.headers, 'content-type')).split(';')[0].trim().toLowerCase();
    const bytes = res.arrayBuffer;
    if (res.status !== 200 || !/^image\//.test(type) || !bytes || bytes.byteLength < 1000) return null;
    return { bytes, type, ext: extFor(type) };
  } catch (e) { return null; }
}

async function loadCovers(covers, opts = {}) {
  const got = await Promise.all(covers.map(c => loadImage(c.url, opts)));
  return covers.map((c, i) => got[i] && Object.assign({ url: c.url, source: c.source }, got[i])).filter(Boolean);
}

module.exports = { SOURCES, parseGoogle, parseOpenLibrary, parseDnb, queryAll, merge, loadImage, loadCovers, extFor };
