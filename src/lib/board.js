'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the folder source
 *  The other half of the kanban board: `source: folder` turns the columns into
 *  a question about the vault instead of a list inside the fence.
 *
 *  It does not filter. That is the whole design brief — a hand-built board
 *  shows what you remembered to put on it; this shows EVERY note of the folder,
 *  so nothing can quietly go missing. A note's column lives in its own
 *  frontmatter (`status:` by default), so it survives without the plugin and
 *  any other card, list or search can read it too.
 *
 *  The first column is the ABSENCE of a value: dropping a note there deletes
 *  the property rather than writing `status: open` into every note in the vault
 *  for no gain.
 *
 *  Everything visible — the column strip, the drag, the card — comes from
 *  kanban.js. This file only answers where the cards are and where a move goes.
 * ========================================================================== */

const { Notice, setIcon } = require('obsidian');
const { bucketKind, kindVar } = require('./kanbanblock.js');

const OPEN = 'open';
/* Labels only: the id is the slugged label and the kind is read off the name,
   so a column called "Ausbessern" is the same kind of column on every board.

   German while the block board's defaults are English, on purpose: these words
   are WRITTEN INTO the notes, and every board that never named its columns has
   vaults full of `status: In Arbeit`. Translating them would move those notes
   into a column nobody configured. */
const DEFAULT_STATES = ['Offen', 'In Arbeit', 'Ausbessern', 'Erledigt'];

const slugState = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '-');

/* ---- reading the vault ---------------------------------------------------- */

/* Which folder a board is asking about. An empty `folder:` means "the one this
   note is in" — and if the note is at the vault root there is no such folder,
   so the board shows nothing rather than claiming the whole vault. The answer
   is never written back into the fence: the board is supposed to follow the
   note, not to be pinned the first time it saves. */
function folderRoot(app, cfg, ctx) {
  if (cfg.folder) return cfg.folder.replace(/^\/|\/$/g, '');
  const here = ctx && ctx.sourcePath ? app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
  return here && here.parent && here.parent.path !== '/' ? here.parent.path : '';
}
/* The folder's notes, plus the folder note beside it — `SCHOOL/Biology.md` is
   the note that IS the folder under the folder-notes convention, so a board
   that leaves it out is missing its own subject. */
function notesIn(app, root) {
  if (!root) return [];
  return app.vault.getMarkdownFiles()
    .filter(f => f.path === root + '.md' || f.path.startsWith(root + '/'));
}
/* The note's column, as the note itself spells it. The id is the slug, so
   "In Review" and "in review" are one column; the raw value is kept because it
   is what gets written back — a card must never rewrite a note's wording. */
function stateOf(app, file, cfg) {
  const fm = (app.metadataCache.getFileCache(file) || {}).frontmatter || {};
  const raw = fm[cfg.statusProp];
  if (raw == null || raw === '') return { id: OPEN, label: '' };
  const label = String(Array.isArray(raw) ? raw[0] : raw).trim();
  return { id: slugState(label) || OPEN, label };
}
/* Links between the notes of THIS folder only — a link pointing outside says
   nothing about how well the subject hangs together. */
function linkMap(app, files) {
  const inScope = new Set(files.map(f => f.path));
  const links = app.metadataCache.resolvedLinks || {};
  const out = new Map();
  files.forEach(f => out.set(f.path, new Set()));
  for (const src of inScope) {
    for (const dest of Object.keys(links[src] || {})) {
      if (dest === src || !inScope.has(dest)) continue;
      out.get(src).add(dest);
      out.get(dest).add(src);
    }
  }
  return out;
}
function sortNotes(app, items, cfg, order) {
  const dir = cfg.dir === 'desc' ? -1 : 1;
  const by = {
    name: (a, b) => a.basename.localeCompare(b.basename),
    modified: (a, b) => a.stat.mtime - b.stat.mtime,
    created: (a, b) => a.stat.ctime - b.stat.ctime,
    state: (a, b) => {
      const ids = order || [];
      const ia = ids.indexOf(stateOf(app, a, cfg).id), ib = ids.indexOf(stateOf(app, b, cfg).id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.basename.localeCompare(b.basename);
    },
  };
  items.sort((a, b) => dir * (by[cfg.sort] || by.name)(a, b));
  return items;
}
async function fillExcerpts(app, notes, el) {
  for (const f of notes) {
    const cards = el.querySelectorAll('.nx-kb-card[data-path="' + CSS.escape(f.path) + '"]');
    if (!cards.length) continue;
    let text = '';
    try {
      const raw = await app.vault.cachedRead(f);
      text = raw.replace(/^---\n[\s\S]*?\n---\n?/, '')
        .split('\n').map(l => l.trim())
        .find(l => l && !/^[#>\-*=`|]/.test(l)) || '';
    } catch (e) { console.warn('[nexus-suite] board excerpt', f.path, e); }
    cards.forEach(c => {
      const box = c.querySelector('.nx-kb-card-desc');
      if (!box) return;
      if (text) { box.setText(text.slice(0, 160)); c.dataset.hay = (c.dataset.hay || '') + ' ' + text.toLowerCase(); }
      else box.remove();
    });
  }
}
async function setState(app, file, label, cfg) {
  try {
    await writeState(app, file, label, cfg);
  } catch (e) {
    // Nothing above this awaits us — a pointer-up handler and a menu click both
    // fire and forget — so a failed write has to say so here or nowhere.
    new Notice('Nexus: “' + file.basename + '” could not be updated — ' + (e && e.message ? e.message : e));
    console.error('[nexus-suite] board setState', file.path, e);
  }
}
async function writeState(app, file, label, cfg) {
  await app.fileManager.processFrontMatter(file, fm => {
    // The first column is the absence of a value — writing it would litter
    // every note with `status: open` for no gain.
    if (!label) delete fm[cfg.statusProp];
    else fm[cfg.statusProp] = label;
  });
}

/* ---- columns -------------------------------------------------------------- */

/* The configured columns, plus one for every value the notes carry that nobody
   configured. Dropping an unknown value would silently hide notes, which is the
   one thing this board must not do. */
function foldColumns(app, cfg, notes) {
  // A board that names no columns gets the default ones written into its own
  // config, so the ⋮ menu and the fence are editing the same list.
  if (!(cfg.buckets || []).length)
    cfg.buckets = DEFAULT_STATES.map(title => ({ title, limit: 0, cards: [], extra: [] }));
  const titles = cfg.buckets.map(b => b.title);
  const limits = cfg.buckets.map(b => b.limit || 0);
  const cols = titles.map((title, i) => ({
    id: i === 0 ? OPEN : slugState(title),
    title, limit: limits[i] || 0,
    kind: i === 0 ? 'open' : bucketKind(title),
    items: [],
  }));
  // Two columns whose names slug to the same id: the FIRST one keeps them, so a
  // careless rename empties a column rather than silently re-filing its notes.
  const known = new Map();
  cols.forEach(c => { if (!known.has(c.id)) known.set(c.id, c); });
  const extra = new Map();
  notes.forEach(f => {
    const state = stateOf(app, f, cfg);
    if (known.has(state.id)) known.get(state.id).items.push(f);
    else {
      if (!extra.has(state.id)) extra.set(state.id, { label: state.label, items: [] });
      extra.get(state.id).items.push(f);
    }
  });
  // A stray column is named the way the notes name it, not the way the id is
  // spelled — dropping a card into it must write back the same words.
  extra.forEach((hit, id) => cols.push({
    id, title: hit.label || id, limit: 0, kind: bucketKind(hit.label || id), items: hit.items, stray: true,
  }));
  const order = cols.map(c => c.id);
  cols.forEach(c => {
    sortNotes(app, c.items, cfg, order);
    const n = c.items.length;
    c.count = { text: c.limit ? n + '/' + c.limit : String(n), over: !!c.limit && n > c.limit };
  });
  return cols;
}

/* ---- one card ------------------------------------------------------------- */

/* What a folder card SHOWS — handed to kanban's cardFrame, which is the same
   frame the block board and the graph block's grid draw. */
function cardView(app, file, cfg, links, kind) {
  const cache = app.metadataCache.getFileCache(file) || {};
  const fm = cache.frontmatter || {};
  const chips = [];
  if (cfg.tags !== false) {
    const tags = [];
    if (typeof fm.tags === 'string') tags.push(...fm.tags.split(/[,\s]+/));
    else if (Array.isArray(fm.tags)) tags.push(...fm.tags.map(String));
    (cache.tags || []).forEach(t => tags.push(t.tag));
    [...new Set(tags.map(t => String(t).replace(/^#/, '')).filter(Boolean))].slice(0, 3)
      .forEach(t => chips.push({ cls: 'tag', text: '#' + t }));
  }
  if (cfg.props) {
    cfg.props.split(',').map(x => x.trim()).filter(Boolean).forEach(key => {
      const v = fm[key];
      if (v == null || v === '') return;
      chips.push({ cls: 'prop', text: String(Array.isArray(v) ? v.join(', ') : v) });
    });
  }
  const n = (links.get(file.path) || new Set()).size;
  if (cfg.links !== false) chips.push({ cls: 'links' + (n ? '' : ' is-none'), icon: 'link', text: String(n), label: n + ' link(s) inside this folder' });
  return {
    lead: cfg.state !== false, kind, state: cfg.state !== false && kind !== 'open',
    orphan: cfg.orphans !== false && !n,
    title: file.basename,
    desc: cfg.excerpt !== false ? '' : null,   // '' = an empty slot fillExcerpts writes into
    chips,
  };
}

/* ---- the seam ------------------------------------------------------------- */

function folderSource(mod, cfg, el, ctx) {
  const app = mod.app;
  const selfPath = ctx && ctx.sourcePath;
  const root = folderRoot(app, cfg, ctx);
  const notes = notesIn(app, root).filter(f => f.path !== selfPath);
  const links = linkMap(app, notes);
  let cols = [];

  const openMenu = (evt, file, col) => {
    const { NexusPopupMenu } = require('../modals/pickers.js');
    const menu = new NexusPopupMenu(app, file.basename);
    menu.addItem(i => i.setTitle('Open').setIcon('file-text')
      .onClick(() => app.workspace.getLeaf(false).openFile(file)));
    menu.addItem(i => i.setTitle('Open in a new tab').setIcon('layout')
      .onClick(() => app.workspace.getLeaf('tab').openFile(file)));
    menu.addSeparator();
    cols.forEach(c => {
      const cur = c.id === col.id;
      menu.addItem(i => {
        i.setTitle(c.title).setIcon(cur ? 'check' : 'circle').setChecked(cur).setDisabled(cur);
        if (!cur) i.onClick(async () => { await setState(app, file, c.id === OPEN ? '' : c.title, cfg); mod.refreshFolderBoards(); });
      });
    });
    menu.showAtMouseEvent(evt);
  };
  /* Hovering a card reveals its web: everything unrelated steps back instead of
     the related ones shouting. */
  const highlight = (file, on) => {
    el.toggleClass('is-linking', on);
    if (!on) {
      el.querySelectorAll('.is-linked').forEach(c => c.removeClass('is-linked'));
      const off = el.querySelector('.nx-graph-canvas');
      if (off && off._nxHighlight) off._nxHighlight(null, new Set());
      return;
    }
    const rel = links.get(file.path) || new Set();
    el.querySelectorAll('.nx-kb-card').forEach(c => {
      c.toggleClass('is-linked', c.dataset.path === file.path || rel.has(c.dataset.path));
    });
    const web = el.querySelector('.nx-graph-canvas');
    if (web && web._nxHighlight) web._nxHighlight(file.path, rel);
  };

  /* The column's name IS the value in the notes, so a rename has to go into
     them too — otherwise every note in it falls out of the board into a column
     nobody configured. Column 0 is the absence of a value and names nothing. */
  const renameColumn = async (i, title) => {
    if (!cfg.buckets[i]) return;
    const moving = cols[i] ? cols[i].items.slice() : [];
    // Two columns with one id is how a rename quietly re-files a whole folder.
    const id = i === 0 ? OPEN : slugState(title);
    if (cols.some((c, n) => n !== i && !c.stray && c.id === id)) {
      new Notice('Nexus: there is already a column called “' + title + '”.');
      return;
    }
    const was = cfg.buckets[i].title;
    cfg.buckets[i].title = title;
    // The notes are only touched once the block itself is written: a rename
    // that did not reach the fence must not leave the notes saying something
    // no column claims.
    if (await mod.save(el, ctx, cfg) === false) { cfg.buckets[i].title = was; return; }
    if (i > 0) for (const f of moving) await setState(app, f, title, cfg);
    mod.refreshFolderBoards();
  };

  return {
    id: 'folder',
    root,
    renameColumn,
    columns() { cols = foldColumns(app, cfg, notes); return cols; },
    total() { return notes.length + (notes.length === 1 ? ' note' : ' notes'); },

    // Counts per column — the overview line that says where the folder stands.
    head(head, list) {
      if (cfg.state === false) return;
      const tally = head.createDiv('nx-kb-tally');
      list.forEach(c => {
        if (!c.items.length) return;
        const chip = tally.createSpan('nx-kb-tally-chip');
        chip.style.setProperty('--nx-kb-kind', kindVar(c.kind));
        chip.createSpan({ cls: 'nx-kb-tally-dot' });
        chip.createSpan({ text: c.items.length + ' ' + c.title });
      });
    },
    tools(tools, opts) {
      // No cards to narrow down in the graph view, so no field offering to.
      if (!opts || opts.filter !== false) {
        const search = tools.createEl('input', { cls: 'nx-kb-search', attr: { type: 'text', placeholder: 'filter …' } });
        search.oninput = () => {
          const q = search.value.trim().toLowerCase();
          el.querySelectorAll('.nx-kb-card').forEach(c => {
            c.toggleClass('is-filtered', !!q && !(c.dataset.hay || '').includes(q));
          });
        };
      }
      const gear = tools.createDiv('nx-kb-tool');
      setIcon(gear, 'settings-2');
      gear.setAttribute('aria-label', 'Board settings');
      gear.onclick = () => {
        const { NexusBoardConfigModal } = require('../modals/board.js');
        new NexusBoardConfigModal(mod.plugin, cfg, (next) => mod.save(el, ctx, next)).open();
      };
    },

    view(file, col) { return cardView(app, file, cfg, links, col.kind); },
    fill(frame, file, ci, ii, col) {
      frame.el.dataset.path = file.path;
      frame.el.dataset.hay = file.basename.toLowerCase() + ' ' + (frame.meta.textContent || '').toLowerCase();
      if (frame.lead) {
        // Click the dot to walk through the columns — no menu for the common move.
        const dot = frame.lead.createDiv('nx-kb-card-dot');
        dot.setAttribute('aria-label', col.title + ' — click for the next one');
        dot.onclick = async (e) => {
          // Only the configured columns are in the cycle — stepping into one
          // that exists solely because some note says so is not a move anybody
          // asked for.
          const ring = cols.slice(0, cfg.buckets.length);
          const at = ring.indexOf(col);
          e.stopPropagation();
          const next = ring[(at + 1) % Math.max(1, ring.length)];
          await setState(app, file, !next || at < 0 || next.id === OPEN ? '' : next.title, cfg);
          mod.refreshFolderBoards();
        };
      }
      frame.dots.onclick = (e) => { e.stopPropagation(); openMenu(e, file, col); };
      frame.el.onclick = (e) => {
        if (frame.el.hasClass('is-dragging')) return;
        app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(file);
      };
      frame.el.oncontextmenu = (e) => { e.preventDefault(); openMenu(e, file, col); };
      if (cfg.links !== false) {
        frame.el.addEventListener('pointerenter', () => highlight(file, true));
        frame.el.addEventListener('pointerleave', () => highlight(file, false));
      }
    },

    /* A move is written into the NOTE, not into the fence — which is the whole
       difference between the two sources. The drop index is ignored: the order
       inside a column is the sort, and nothing stores it. */
    async move(ci, ii, toCol) {
      const file = cols[ci] && cols[ci].items[ii];
      const to = cols[toCol];
      if (!file || !to || to.id === cols[ci].id) return;
      await setState(app, file, to.id === OPEN ? '' : to.title, cfg);
      mod.refreshFolderBoards();
    },
    add: null,
    colMenu(evt, ci) {
      if (!cfg.buckets[ci]) return;
      mod.columnMenu(evt, cfg, ci, el, ctx, { folder: true, fixedFirst: true, rename: renameColumn });
    },

    after(el2) {
      if (!notes.length) {
        const strip = el2.querySelector('.nx-kb-cols');
        const msg = createDiv({ cls: 'nx-kb-empty',
          text: root ? 'No notes in "' + root + '" yet.' : 'Set a folder in the settings.' });
        strip.parentElement.insertBefore(msg, strip);
        return;
      }
      if (cfg.excerpt !== false) fillExcerpts(app, notes, el2);
      if (cfg.graph) require('./graph.js').graphInto(app, el2, notes, links, cfg,
        (f) => bucketKindOfNote(app, f, cfg, cols));
    },
  };
}
/* The colour a note's node gets in the graph — the kind of the column it is in. */
function bucketKindOfNote(app, file, cfg, cols) {
  const state = stateOf(app, file, cfg);
  const hit = (cols || []).find(c => c.id === state.id);
  return hit ? hit.kind : bucketKind(state.label || state.id);
}

/* Everything the settings modal needs to talk about a folder board without
   reaching into the renderer. */
function countNotes(app, cfg) {
  try { return notesIn(app, (cfg.folder || '').replace(/^\/|\/$/g, '')).length; } catch (e) { return 0; }
}

module.exports = {
  folderSource, notesIn, linkMap, sortNotes, fillExcerpts,
  bucketKindOfNote, countNotes, DEFAULT_STATES,
};