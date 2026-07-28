'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · orphan index
 *
 *  Builds the set of every vault path that is referenced SOMEWHERE. Anything
 *  not in that set is orphaned. Four sources, because Obsidian's link index
 *  alone produces false positives:
 *    1. metadataCache.resolvedLinks — links AND embeds in note bodies
 *    2. frontmatter — wikilinks (frontmatterLinks) *and* plain path strings
 *       (banner:/cover:/image: …), which Obsidian does NOT index as links
 *    3. canvas nodes (file nodes + wikilinks inside text nodes) — async, since
 *       .canvas is plain JSON without a metadata cache
 *    4. the dashboard's own settings (hero image, image widgets) — otherwise
 *       every picture you put on the homepage reports as an orphan
 * ========================================================================== */

const KIND_EXT = {
  note:  ['md'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif', 'ico', 'heic'],
  pdf:   ['pdf'],
  audio: ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'opus', '3gp', 'flac', 'aac'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'm4v'],
};
const KIND_ORDER = ['note', 'image', 'pdf', 'audio', 'video', 'other'];
const KIND_ICON  = { note: 'file-text', image: 'image', pdf: 'file', audio: 'music', video: 'film', other: 'paperclip' };
const KIND_LABEL = { note: 'Notes', image: 'Images', pdf: 'PDFs', audio: 'Audio', video: 'Video', other: 'Other files' };

function nxKindOf(file) {
  const ext = String(file.extension || '').toLowerCase();
  for (const k of KIND_ORDER) if (KIND_EXT[k] && KIND_EXT[k].includes(ext)) return k;
  return 'other';
}

function nxFormatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

/* A frontmatter string → vault path, or null. `strict` (used for plain,
   non-wikilink values) only accepts things that actually look like a file
   reference — otherwise "status: aktiv" would silently "link" a note called
   aktiv and hide it from the orphan list. */
function nxResolveRef(app, value, sourcePath, strict) {
  let v = String(value == null ? '' : value).trim();
  if (!v) return null;
  let looksLikeLink = false;
  const wl = v.match(/^!?\[\[([^\]]+)\]\]$/);                     // [[note]] / ![[img.png|300]]
  if (wl) { v = wl[1]; looksLikeLink = true; }
  else {
    const md = v.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);              // [x](path) / ![](path)
    if (md) { v = md[1]; looksLikeLink = true; }
  }
  v = v.split('|')[0].split('#')[0].trim();
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || v.startsWith('data:')) return null;   // URLs
  try { if (/%[0-9a-f]{2}/i.test(v)) v = decodeURIComponent(v); } catch (e) {}
  if (strict && !looksLikeLink && !(v.includes('/') || /\.[a-z0-9]{1,5}$/i.test(v))) return null;
  const direct = app.vault.getAbstractFileByPath(v);
  if (direct && direct.stat) return direct.path;                  // .stat → TFile, not a folder
  const dest = app.metadataCache.getFirstLinkpathDest(v, sourcePath || '');
  return dest ? dest.path : null;
}

/* Referenced paths from links/embeds + frontmatter. Synchronous — everything
   comes out of the metadata cache. opts: { frontmatter, plugin } */
function nxBuildRefIndex(app, opts) {
  const o = opts || {};
  const mc = app.metadataCache;
  const refs = new Set();

  const links = mc.resolvedLinks || {};
  for (const src in links) {
    const dests = links[src] || {};
    for (const dest in dests) if (dest !== src) refs.add(dest);   // self-links don't count
  }

  if (o.frontmatter !== false) {
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = mc.getFileCache(f);
      if (!cache) continue;
      // Obsidian ≥1.4 pre-parses wikilinks in frontmatter
      for (const l of (cache.frontmatterLinks || [])) {
        const p = nxResolveRef(app, l.link, f.path, false);
        if (p && p !== f.path) refs.add(p);
      }
      const fm = cache.frontmatter;
      if (!fm) continue;
      for (const key in fm) {
        if (key === 'position') continue;
        const vals = Array.isArray(fm[key]) ? fm[key] : [fm[key]];
        for (const v of vals) {
          if (typeof v !== 'string') continue;
          const p = nxResolveRef(app, v, f.path, true);
          if (p && p !== f.path) refs.add(p);
        }
      }
    }
  }

  if (o.plugin) for (const p of nxSettingsRefs(o.plugin)) refs.add(p);
  return refs;
}

/* Images the dashboard itself uses (hero + image widgets, across every
   per-device profile) — referenced, just not from a note. */
function nxSettingsRefs(plugin) {
  const out = new Set();
  const app = plugin.app;
  const add = (v) => { const p = nxResolveRef(app, v, '', false); if (p) out.add(p); };
  try {
    const home = (plugin.settings || {}).homepage;
    if (!home) return out;
    const docs = [home].concat(Object.values(home.profiles || {}));
    for (const doc of docs) {
      if (!doc) continue;
      if (doc.hero) add(doc.hero);
      for (const w of (doc.widgets || [])) {
        if (w.src) add(w.src);
        if (Array.isArray(w.images)) w.images.forEach(add);
      }
    }
  } catch (e) {}
  return out;
}

/* Canvas references. Async (JSON files have no metadata cache) — the caller
   caches the result and re-renders once it resolves. */
async function nxCanvasRefs(app) {
  const out = new Set();
  const canvases = app.vault.getFiles().filter(f => f.extension === 'canvas');
  for (const c of canvases) {
    let json;
    try { json = JSON.parse(await app.vault.cachedRead(c)); } catch (e) { continue; }
    for (const n of (json.nodes || [])) {
      if (n && n.file) { const p = nxResolveRef(app, n.file, c.path, false); if (p) out.add(p); }
      if (n && typeof n.text === 'string') {
        const re = /!?\[\[([^\]]+)\]\]/g;
        let m;
        while ((m = re.exec(n.text))) { const p = nxResolveRef(app, m[1], c.path, false); if (p) out.add(p); }
      }
    }
  }
  return out;
}

module.exports = { KIND_EXT, KIND_ICON, KIND_LABEL, KIND_ORDER, nxBuildRefIndex, nxCanvasRefs, nxFormatSize, nxKindOf, nxResolveRef };
