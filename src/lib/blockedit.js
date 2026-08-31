'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · editing a code block from its own rendering
 *  Shared by every block that IS its data — the kanban board, the planner.
 *
 *  getSectionInfo alone is not enough to find the block again. It maps a
 *  rendered element back to its source lines, and it stops answering once
 *  Obsidian has re-rendered the block and detached the element the handlers
 *  were bound to — which is exactly what the first save causes. Every edit
 *  after that then failed silently, which is what made a kanban board look like
 *  it accepted one card and nothing else.
 *
 *  So the block is found by its CONTENT: the body we last rendered identifies
 *  this block, and that is what distinguishes it from a second one of the same
 *  kind in the same note.
 * ========================================================================== */

function fenceEnd(lines, start) {
  let end = start + 1;
  while (end < lines.length && lines[end].trim().indexOf('```') !== 0) end++;
  return end;
}

function locateFencedBlock(lines, tag, previousSrc, info) {
  const bodyOf = (start, end) => lines.slice(start + 1, end).join('\n');
  const want = previousSrc == null ? '' : previousSrc;

  if (info && lines[info.lineStart] && lines[info.lineStart].trim().indexOf('```') === 0
      && bodyOf(info.lineStart, info.lineEnd) === want) {
    return { start: info.lineStart, end: info.lineEnd };
  }
  const fences = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().indexOf('```' + tag) === 0) fences.push(i);
  }
  for (const start of fences) {
    const end = fenceEnd(lines, start);
    if (bodyOf(start, end) === want) return { start, end };
  }
  // One block of this kind in the note is unambiguous even when its text has
  // drifted (someone edited the fence by hand between renders).
  if (fences.length === 1) return { start: fences[0], end: fenceEnd(lines, fences[0]) };
  return null;
}

/* Write `src` back into the block `el` came from. `previousSrc` is the body
   that is in the FILE right now — the caller has to capture it before it
   repaints, because repainting sets the new one on the element. Returns what
   happened rather than throwing, so the caller decides how loudly to complain. */
async function saveFencedBlock(app, TFile, el, ctx, tag, src, previousSrc) {
  const file = ctx && ctx.sourcePath ? app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
  if (!(file instanceof TFile)) return { ok: false, reason: 'the note this block lives in could not be found' };
  const text = await app.vault.read(file);
  const lines = text.split('\n');
  let info = null;
  try { info = ctx && ctx.getSectionInfo ? ctx.getSectionInfo(el) : null; } catch (e) {}
  const at = locateFencedBlock(lines, tag, previousSrc == null ? '' : previousSrc, info);
  if (!at) return { ok: false, reason: 'this block could not be located in the note' };
  lines.splice(at.start + 1, at.end - at.start - 1, ...src.split('\n'));
  await app.vault.modify(file, lines.join('\n'));
  // The block on screen is now this text; the next save locates itself by it.
  el._nxSrc = src;
  return { ok: true };
}

module.exports = { fenceEnd, locateFencedBlock, saveFencedBlock };
