'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · vault paths
 *  Naming a new file and making room for it: one rule for what a file may be
 *  called, one for what a second file of the same name becomes, one way to
 *  create a folder. Pure except ensureFolder, which takes the adapter it uses.
 * ========================================================================== */

/* A file name that is a name and not a path: no separators or link syntax, no
   leading dot (that would hide the file), no trailing dot or space (Windows
   drops them), cut at `max` characters without splitting an emoji. */
function safeFileName(text, fallback = 'Untitled', max = 120) {
  const cleaned = String(text || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ')
    .trim().replace(/^\.+/, '').trim();
  const out = Array.from(cleaned).slice(0, max).join('').replace(/[. ]+$/, '');
  return out || fallback;
}

/* `folder/base.ext`, or `folder/base (2).ext` and up when that is taken.
   `exists(path)` decides what counts as taken. */
function uniquePath(exists, folder, base, ext) {
  const dir = String(folder || '').replace(/\/+$/, '');
  const at = (name) => (dir ? dir + '/' : '') + name + '.' + ext;
  if (!exists(at(base))) return at(base);
  for (let n = 2; ; n++) if (!exists(at(base + ' (' + n + ')'))) return at(base + ' (' + n + ')');
}

/* An `exists` for uniquePath that counts a file name as taken when ANY file in
   the vault has it, ignoring case: `[[Dune.jpg]]` resolves by name, so a second
   Dune.jpg in another folder would make the link point at the wrong image. */
function nameTakenAnywhere(paths) {
  const names = new Set();
  for (const p of paths) names.add(String(p).slice(String(p).lastIndexOf('/') + 1).toLowerCase());
  return path => names.has(String(path).slice(String(path).lastIndexOf('/') + 1).toLowerCase());
}

/* Create a folder and every parent it needs, one segment at a time.
   `adapter.mkdir` is NOT the same call on both platforms: asked for "a/b"
   where "a" does not exist yet, the desktop creates both and the mobile
   adapter refuses — which once broke every download into a nested folder on
   the second device. */
async function ensureFolder(adapter, folder) {
  let at = '';
  for (const part of String(folder || '').split('/')) {
    if (!part) continue;
    at = at ? at + '/' + part : part;
    if (await adapter.exists(at)) continue;
    try { await adapter.mkdir(at); }
    catch (e) {
      // Two writers creating the same new folder race each other; the loser
      // only has to care if the folder is still not there afterwards.
      if (!(await adapter.exists(at))) throw new Error('could not create the folder "' + at + '": ' + (e && e.message ? e.message : 'unknown'));
    }
  }
}

module.exports = { safeFileName, uniquePath, nameTakenAnywhere, ensureFolder };
