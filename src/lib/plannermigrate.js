'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · carrying old planner lines into the daily notes
 *  The planner used to keep a day's line inside its own ```nexus-planner```
 *  fence. It now reads and writes the same field the calendar does — the day's
 *  own note (lib/daytext.js). This moves what is already written.
 *
 *  Deliberately NOT automatic. It creates a daily note for every day that has a
 *  line and no note yet, which is a lot of files to make behind someone's back,
 *  so it is a command that reports first and writes second.
 *
 *  It never overwrites: a day whose note already holds a text is left alone and
 *  counted as a clash. It never deletes: the fence keeps its old lines, inert,
 *  so a run that went wrong costs nothing.
 * ========================================================================== */

const planner = require('./planner.js');
const daytext = require('./daytext.js');

/* Every day named by every nexus-planner fence in the vault, newest note last
   so a later one wins if two blocks name the same day. Reading the whole vault
   is fine for a one-off — this runs when a person asks it to. */
async function scan(app, plugin, moment) {
  const found = [];      // { date, text, from }
  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    let body = '';
    try { body = await app.vault.cachedRead(file); } catch (e) { continue; }
    if (body.indexOf('nexus-planner') < 0) continue;
    for (const src of fenceBodies(body)) {
      const cfg = planner.parsePlanner(src);
      for (const date of Object.keys(cfg.entries)) {
        found.push({ date, text: cfg.entries[date], from: file.path });
      }
    }
  }
  // One entry per day: the last block that named it decides.
  const byDate = new Map();
  found.forEach(e => byDate.set(e.date, e));

  const plan = { move: [], clash: [], creates: 0, blocks: new Set(found.map(e => e.from)) };
  for (const entry of byDate.values()) {
    const day = moment(entry.date, 'YYYY-MM-DD');
    const existing = daytext.readDayText(app, plugin, day);
    if (existing) { plan.clash.push(Object.assign({ existing }, entry)); continue; }
    if (!daytext.dailyNoteFor(app, day)) plan.creates++;
    plan.move.push(entry);
  }
  plan.move.sort((a, b) => (a.date < b.date ? -1 : 1));
  plan.clash.sort((a, b) => (a.date < b.date ? -1 : 1));
  return plan;
}

/* The text inside every ```nexus-planner fence, without the fence lines. */
function fenceBodies(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let open = null;
  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})\s*([a-zA-Z-]*)\s*$/.exec(line);
    if (fence && open === null && fence[2].toLowerCase() === 'nexus-planner') { open = []; continue; }
    if (fence && open !== null) { out.push(open.join('\n')); open = null; continue; }
    if (open !== null) open.push(line);
  }
  return out;
}

async function apply(app, plugin, moment, plan) {
  const result = { written: 0, failed: [] };
  for (const entry of plan.move) {
    const res = await daytext.writeDayText(app, plugin, moment(entry.date, 'YYYY-MM-DD'), entry.text);
    if (res.ok) result.written++;
    else result.failed.push(entry.date + ': ' + res.reason);
  }
  return result;
}

/* What the confirm dialog says. Written here rather than in the modal so the
   numbers and the wording are one thing and can be asserted. */
function describe(plan) {
  if (!plan.move.length && !plan.clash.length) {
    return 'No planner lines found. Nothing to move.';
  }
  const lines = [];
  lines.push(plan.move.length + ' day(s) from ' + plan.blocks.size + ' note(s) will be written into their daily notes.');
  if (plan.creates) lines.push(plan.creates + ' daily note(s) do not exist yet and will be created from your daily-note template.');
  if (plan.clash.length) lines.push(plan.clash.length + ' day(s) already have a text in their note and will be left exactly as they are.');
  lines.push('Nothing is deleted: the planner blocks keep their old lines, which the planner no longer reads.');
  return lines.join('\n\n');
}

module.exports = { scan, apply, describe, fenceBodies };
