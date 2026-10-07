'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · book templates
 *  Any note can be a template. {{field}} is filled from the book, {{ask:…}} is
 *  asked in the dialog. Inside frontmatter the result has to stay valid YAML,
 *  so values are escaped for where they sit, and a list line repeats once per
 *  value — `  - {{genres}}` becomes one tag per genre.
 * ========================================================================== */

const FIELDS = ['isbn', 'title', 'subtitle', 'author', 'authors', 'publisher', 'year',
  'pages', 'language', 'description', 'genres', 'cover', 'date'];
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function parseToken(raw) {
  raw = String(raw).trim();
  if (raw.startsWith('ask:')) {
    const [label, opts] = raw.slice(4).split('|');
    return { kind: 'ask', label: label.trim(),
      options: opts ? opts.split(',').map(s => s.trim()).filter(Boolean) : [] };
  }
  if (FIELDS.includes(raw)) return { kind: 'field', name: raw };
  return { kind: 'unknown' };
}

function scan(text) {
  const fields = new Set(), asks = [], unknown = [], seen = new Set();
  for (const m of String(text || '').matchAll(TOKEN)) {
    const t = parseToken(m[1]);
    if (t.kind === 'field') fields.add(t.name);
    else if (t.kind === 'ask') { if (!seen.has(t.label)) { seen.add(t.label); asks.push({ label: t.label, options: t.options }); } }
    else if (!unknown.includes(m[0])) unknown.push(m[0]);
  }
  return { fields: [...fields], asks, unknown, usesCover: fields.has('cover') };
}

/* Catalogue data is written by strangers: Open Library is a wiki anyone can
   edit. Other plugins run code they find in a new note — Templater's `<% %>`
   on file creation, Dataview's inline `$=` spans — so those markers are broken
   in every field value. Answers and the template itself are the user's own and
   stay as they are. */
function inert(value) {
  if (Array.isArray(value)) return value.map(inert);
  return String(value).replace(/<%/g, '<\u200B%').replace(/%>/g, '%\u200B>').replace(/`/g, '\u02BC');
}

// null = unknown placeholder, left exactly as written.
function valueOf(t, data, answers) {
  if (t.kind === 'ask') return answers[t.label] == null ? '' : answers[t.label];
  if (t.kind === 'field') return data[t.name] == null ? '' : inert(data[t.name]);
  return null;
}
const asText = v => Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v);
const oneLine = s => String(s).replace(/\s*\r?\n\s*/g, ' ').trim();

function yamlScalar(s) {
  s = oneLine(s);
  if (s === '') return '';
  const plain = !/[:#{}[\],&*!|>'"%@`]/.test(s) && !/^[-?\s]/.test(s)
    && !/^(true|false|null|yes|no|on|off|~)$/i.test(s);
  return plain ? s : '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(String(text || ''));
  if (!m) return { fm: null, body: String(text || '') };
  return { fm: m[1], body: String(text).slice(m[0].length) };
}

function renderFmLine(line, data, answers) {
  const tokens = [...line.matchAll(TOKEN)];
  if (!tokens.length) return [line];
  const item = /^(\s*-\s+)(.*)$/.exec(line);
  // A list item that is exactly one placeholder: one item per value, none when empty.
  if (item && tokens.length === 1 && item[2].trim() === tokens[0][0]) {
    const v = valueOf(parseToken(tokens[0][1]), data, answers);
    if (v === null) return [line];
    return (Array.isArray(v) ? v : [v]).map(x => oneLine(x)).filter(Boolean)
      .map(x => item[1] + yamlScalar(x));
  }
  // `key: {{x}}` — the whole value is the placeholder, so quote it as needed.
  const kv = /^(\s*[^\s:#-][^:]*:)\s+(.*)$/.exec(line);
  if (kv && tokens.length === 1 && kv[2].trim() === tokens[0][0]) {
    const v = valueOf(parseToken(tokens[0][1]), data, answers);
    if (v === null) return [line];
    const val = yamlScalar(asText(v));
    return [val ? kv[1] + ' ' + val : kv[1]];
  }
  // Unquoted value with placeholders mixed into literal text: render it, then
  // quote the whole result only if YAML needs it. Unknown placeholders stay raw.
  // A value opening with `[` or a single `{` is a YAML flow collection: keep it raw.
  const valuePart = item ? item[2] : kv ? kv[2] : null;
  const inFlowList = valuePart !== null && /^\[(?!\[)/.test(valuePart.trim());
  if (valuePart !== null && !/["']/.test(valuePart) && !/^(\[|\{(?!\{))/.test(valuePart.trim())
      && tokens.every(m => parseToken(m[1]).kind !== 'unknown')) {
    const prefix = item ? item[1] : kv[1] + ' ';
    const val = yamlScalar(renderPlain(valuePart, data, answers));
    if (val) return [prefix + val];
    return item ? [] : [kv[1]];
  }
  // A placeholder inside a larger value: escape for the quotes around it.
  let out = '', last = 0;
  for (const m of tokens) {
    const v = valueOf(parseToken(m[1]), data, answers);
    let s = m[0];
    if (v !== null) {
      s = oneLine(asText(v));
      const before = line.slice(0, m.index);
      const dq = (before.match(/(?<!\\)"/g) || []).length % 2 === 1;
      const sq = !dq && (before.match(/'/g) || []).length % 2 === 1;
      if (dq) s = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      else if (sq) s = s.replace(/'/g, "''");
      // Inside `[…]` every value is its own item, quoted on its own when needed.
      else if (inFlowList) s = [].concat(v).map(x => oneLine(x)).filter(Boolean).map(yamlScalar).join(', ');
    }
    out += line.slice(last, m.index) + s;
    last = m.index + m[0].length;
  }
  out += line.slice(last);
  if (item && out.slice(item[1].length).trim() === '') return [];
  return [out];
}

function renderPlain(text, data, answers) {
  return String(text).replace(TOKEN, (all, raw) => {
    const v = valueOf(parseToken(raw), data, answers);
    return v === null ? all : asText(v);
  });
}

function render(text, data, answers = {}) {
  const { fm, body } = splitFrontmatter(text);
  if (fm === null) return renderPlain(body, data, answers);
  const lines = fm.split(/\r?\n/).flatMap(l => renderFmLine(l, data, answers));
  return '---\n' + lines.join('\n') + '\n---\n' + renderPlain(body, data, answers);
}

function renderName(pattern, data) {
  return oneLine(renderPlain(pattern, data, {}));
}

function unquote(s) {
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
const isQuoted = s => /^(".*"|'.*')$/.test(s);

/* `[a, "b, c"]` → its items, split on commas outside quotes and outside
   `{{…}}`, so `[{{ask:Format|a,b}}]` in a template stays one item. */
function flowItems(s) {
  const items = [];
  let cur = '', q = '', depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && q === '"') cur += s[++i] || ''; else if (c === q) q = ''; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === '{' || c === '[') { depth++; cur += c; }
    else if (c === '}' || c === ']') { depth--; cur += c; }
    else if (c === ',' && depth <= 0) { items.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  items.push(cur.trim());
  return items.filter(x => x !== '');
}

/* Top-level keys of a frontmatter block, enough for templates: scalars,
   `- item` lists and `[a, b]` flow lists. `quoted` says which values were
   written in quotes (they stay text); a `{…}` flow map is kept as raw text and
   marked `flowMap`. Not a YAML parser, and does not pretend to be one. */
function frontmatterEntries(text) {
  const { fm } = splitFrontmatter(text);
  if (fm === null) return [];
  const out = [];
  let cur = null;
  for (const line of fm.split(/\r?\n/)) {
    const kv = /^([^\s#-][^:]*):\s*(.*)$/.exec(line);
    if (kv) {
      const raw = kv[2].trim();
      cur = { key: kv[1].trim() };
      if (/^\[(?!\[).*\]$/.test(raw)) {   // `[[link]]` is a wikilink, not a list
        const items = flowItems(raw.slice(1, -1));
        cur.value = items.map(unquote); cur.quoted = items.map(isQuoted);
      } else {
        cur.value = unquote(raw); cur.quoted = isQuoted(raw);
        if (/^\{(?!\{)/.test(raw)) cur.flowMap = true;
      }
      out.push(cur); continue;
    }
    const it = /^\s*-\s+(.*)$/.exec(line);
    if (it && cur) {
      if (!Array.isArray(cur.value)) {
        cur.value = cur.value === '' ? [] : [cur.value];
        cur.quoted = cur.value.length ? [cur.quoted] : [];
      }
      const raw = it[1].trim();
      cur.value.push(unquote(raw)); cur.quoted.push(isQuoted(raw));
    }
  }
  return out;
}

function bookData(record, extra) {
  const r = record || {};
  const authors = (r.authors || []).filter(Boolean);
  return {
    isbn: extra.isbn || '', title: r.title || '', subtitle: r.subtitle || '',
    author: authors.join(', '), authors, publisher: r.publisher || '', year: r.year || '',
    pages: r.pages || '', language: r.language || '', description: r.description || '',
    genres: (r.genres || []).filter(Boolean), cover: extra.cover || '', date: extra.date || '',
  };
}

module.exports = { FIELDS, inert, scan, render, renderName, frontmatterEntries, splitFrontmatter, bookData, yamlScalar };
