'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · scratch
 *  The pad you type into: a note named after the moment it was written.
 *
 *  It lives here rather than on the dashboard because the sidebar panel writes
 *  the same note, and two copies of "make a timestamped file, maybe through a
 *  template" would have drifted the first time one of them learned something.
 * ========================================================================== */

const { moment, Notice } = require('obsidian');

/* Tokens a template understands. `{{content}}` decides where what you typed
   goes; without it the text is appended, because losing it would be worse than
   putting it in the wrong place. */
async function applyTemplate(app, templatePath, text, stamp, now) {
  const raw = String(templatePath || '').trim();
  if (!raw) return text;
  const path = raw.endsWith('.md') ? raw : raw + '.md';
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) { new Notice('Nexus: template "' + raw + '" not found.'); return text; }
  const filled = (await app.vault.read(file))
    .replace(/\{\{\s*date\s*\}\}/gi, now.format('YYYY-MM-DD'))
    .replace(/\{\{\s*time\s*\}\}/gi, now.format('HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/gi, stamp);
  return /\{\{\s*content\s*\}\}/i.test(filled)
    ? filled.replace(/\{\{\s*content\s*\}\}/gi, text)
    : filled.replace(/\s*$/, '') + '\n\n' + text;
}

/* Two notes in the same minute would collide, so the second one earns seconds
   rather than overwriting the first. */
function scratchPath(folder, stamp, seconds, taken) {
  const dir = String(folder || '').trim().replace(/^\/|\/$/g, '');
  const at = (name) => (dir ? dir + '/' : '') + name + '.md';
  return taken(at(stamp)) ? at(stamp + '-' + seconds) : at(stamp);
}

async function saveScratch(app, cfg, text) {
  const now = moment();
  const stamp = now.format('YYYY-MM-DD_HH-mm');
  const folder = String(cfg.folder || '').trim().replace(/^\/|\/$/g, '');
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (e) { /* a race with another save */ }
  }
  const path = scratchPath(folder, stamp, now.format('ss'),
    (p) => !!app.vault.getAbstractFileByPath(p));
  const body = await applyTemplate(app, cfg.template, text, stamp, now);
  return app.vault.create(path, body);
}

module.exports = { applyTemplate, scratchPath, saveScratch };
