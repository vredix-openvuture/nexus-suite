'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · editing a block board
 *  What a `source: block` card IS and what can be done to it: the seam the
 *  renderer talks to, the ⋮ menu, the card editor, and turning a card into a
 *  note. The block's TEXT — how a column and a card are written and read — is
 *  kanbanblock.js; the head, the column strip and the drag are kanban.js.
 *
 *  Nothing here touches the vault except createNote: a move, a rename and a
 *  tick are rewrites of the fence, which is the whole point of this source.
 * ========================================================================== */

const { Notice, TFile, moment } = require('obsidian');
const { bucketKind, cardTitle } = require('./kanbanblock.js');

/* ---- the seam ------------------------------------------------------------
   A source answers only two questions: where the cards come from, and where a
   move is written. Everything above it is one implementation.

     columns()                 [{ title, limit, kind, items, count }]
     total()                   the line under the board title
     fill(frame, item, ci, ii) what this card shows and does
     move(ci, ii, toCol, at)   persist a move — may be async
     add(ci, title)            make a card, or null: this source has none
     colMenu(evt, ci)          the ⋮ on a column, or null
     head(el) / tools(el)      what this source adds to the head
     after(el)                 anything that needs the cards in the DOM
*/

function blockSource(mod, cfg, el, ctx) {
  const save = () => mod.save(el, ctx, cfg);
  return {
    id: 'block',
    columns() {
      return cfg.buckets.map(b => {
        const open = b.cards.filter(c => !c.done).length;
        return {
          title: b.title, limit: b.limit, kind: bucketKind(b.title), items: b.cards,
          count: { text: b.limit ? open + '/' + b.limit : String(b.cards.length), over: !!b.limit && open > b.limit },
        };
      });
    },
    total() {
      const open = cfg.buckets.reduce((n, b) => n + b.cards.filter(c => !c.done).length, 0);
      const total = cfg.buckets.reduce((n, b) => n + b.cards.length, 0);
      return open + ' / ' + total;
    },
    fill(frame, card, ci, ii) {
      const note = card.link ? mod.noteByName(card.link) : null;
      const box = frame.lead.createEl('input', { cls: 'nx-kb-check', attr: { type: 'checkbox' } });
      box.checked = !!card.done;
      box.onclick = (e) => e.stopPropagation();
      box.onchange = () => { card.done = box.checked; save(); };
      frame.dots.onclick = (e) => { e.stopPropagation(); cardMenu(mod, e, cfg, ci, ii, el, ctx); };
      /* One click, the whole card. It used to open the linked note, which left a
         card with a note as the one thing on the board that could not be edited,
         and rename the rest — so the due date, the tags and the column each meant
         a trip through the ⋮ menu. The note is now a button inside the editor.
         Ctrl/⌘ still goes straight to the note, for a board used as an index. */
      frame.el.onclick = (e) => {
        if (frame.el.hasClass('is-dragging')) return;
        if (note && (e.ctrlKey || e.metaKey)) { mod.app.workspace.getLeaf('tab').openFile(note); return; }
        editCard(mod, cfg, ci, ii, el, ctx);
      };
      frame.el.oncontextmenu = (e) => { e.preventDefault(); cardMenu(mod, e, cfg, ci, ii, el, ctx); };
    },
    view(card) {
      const note = card.link ? mod.noteByName(card.link) : null;
      const chips = [];
      if (card.due && cfg.due !== false) {
        const today = moment().format('YYYY-MM-DD');
        const d = moment(card.due, 'YYYY-MM-DD');
        chips.push({ cls: 'due', text: card.due === today ? 'today' : d.isValid() ? d.format('D MMM') : card.due,
          mod: (!card.done && card.due < today ? 'is-late' : '') + (card.due === today ? ' is-today' : '') });
      }
      if (cfg.tags !== false) (card.tags || []).forEach(t => chips.push({ cls: 'tag', text: '#' + t }));
      return {
        lead: true, kind: null, done: card.done, missing: !!card.link && !note,
        icon: card.link ? (note ? 'file-text' : 'file-question') : '',
        iconLabel: card.link ? (note ? note.path : 'No note called "' + card.link + '"') : '',
        title: cardTitle(card), desc: card.desc || null, chips,
      };
    },
    move(ci, ii, toCol, at) { moveCard(cfg, ci, ii, toCol, at); return save(); },
    add(ci, title) {
      cfg.buckets[ci].cards.push({ done: false, link: '', alias: '', text: title, desc: '', due: '', tags: [] });
      return save();
    },
    colMenu(evt, ci) { mod.columnMenu(evt, cfg, ci, el, ctx); },
  };
}

function moveCard(cfg, bi, ci, toB, toIndex) {
  const from = cfg.buckets[bi], to = cfg.buckets[toB];
  if (!from || !to) return;
  const [card] = from.cards.splice(ci, 1);
  if (!card) return;
  let at = toIndex == null ? to.cards.length : toIndex;
  if (bi === toB && ci < at) at -= 1;                    // the gap it left shifts the target
  at = Math.max(0, Math.min(to.cards.length, at));
  // Dropping into a "done" column completes the card, dragging it out reopens
  // it — otherwise the column and the checkbox would tell different stories.
  const kind = bucketKind(to.title);
  if (kind === 'done') card.done = true;
  else if (bucketKind(from.title) === 'done' && card.done) card.done = false;
  to.cards.splice(at, 0, card);
}

function cardMenu(mod, evt, cfg, bi, ci, el, ctx) {
  const { NexusPopupMenu } = require('../modals/pickers.js');
  const { NexusNamePickModal } = require('../modals/misc.js');
  const card = cfg.buckets[bi].cards[ci];
  const note = card.link ? mod.noteByName(card.link) : null;
  const menu = new NexusPopupMenu(mod.app, cardTitle(card) || 'Card');

  if (note) {
    menu.addItem(i => i.setTitle('Open note').setIcon('file-text')
      .onClick(() => mod.app.workspace.getLeaf(false).openFile(note)));
    menu.addItem(i => i.setTitle('Open in a new tab').setIcon('layout')
      .onClick(() => mod.app.workspace.getLeaf('tab').openFile(note)));
    menu.addItem(i => i.setTitle('Unlink the note').setIcon('unlink').onClick(() => {
      if (!card.text) card.text = cardTitle(card);
      card.link = ''; card.alias = '';
      mod.save(el, ctx, cfg);
    }));
  } else {
    menu.addItem(i => i.setTitle('Create a note for this card').setIcon('file-plus')
      .onClick(() => createNote(mod, cfg, bi, ci, el, ctx)));
    menu.addItem(i => i.setTitle('Link an existing note').setIcon('link').onClick(() => {
      new NexusNamePickModal(mod.app, 'Which note?',
        mod.app.vault.getMarkdownFiles().map(f => f.path).sort((a, b) => a.localeCompare(b)),
        (path) => {
          const f = mod.app.vault.getAbstractFileByPath(path);
          if (!(f instanceof TFile)) return;
          card.link = f.basename;
          // The card keeps its own wording; the note name is only the target.
          if (card.text && card.text === f.basename) card.text = '';
          mod.save(el, ctx, cfg);
        }).open();
    }));
  }
  menu.addSeparator();
  menu.addItem(i => i.setTitle('Edit…').setIcon('pencil').onClick(() => editCard(mod, cfg, bi, ci, el, ctx)));
  menu.addItem(i => i.setTitle(card.due ? 'Due date (' + card.due + ')' : 'Due date').setIcon('calendar-days').onClick(async () => {
    const { NexusNameModal } = require('../modals/misc.js');
    const v = await new NexusNameModal(mod.app, 'Due date (YYYY-MM-DD, empty = none)', card.due || '', true).openAndGet();
    if (v == null) return;
    const t = String(v).trim();
    card.due = /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
    mod.save(el, ctx, cfg);
  }));
  menu.addItem(i => i.setTitle(card.done ? 'Mark as open' : 'Mark as done').setIcon(card.done ? 'circle' : 'check')
    .onClick(() => { card.done = !card.done; mod.save(el, ctx, cfg); }));
  menu.addSeparator();
  cfg.buckets.forEach((b, i) => {
    if (i === bi) return;
    menu.addItem(x => x.setTitle('Move to “' + b.title + '”').setIcon('arrow-right')
      .onClick(() => { moveCard(cfg, bi, ci, i, b.cards.length); mod.save(el, ctx, cfg); }));
  });
  menu.addSeparator();
  menu.addItem(i => i.setTitle('Delete card').setIcon('trash-2').onClick(() => {
    cfg.buckets[bi].cards.splice(ci, 1);
    mod.save(el, ctx, cfg);
  }));
  menu.showAtMouseEvent(evt);
}

async function editCard(mod, cfg, bi, ci, el, ctx) {
  const { NexusKanbanCardModal } = require('../modals/kanbancard.js');
  const { NexusNamePickModal } = require('../modals/misc.js');
  const bucket = cfg.buckets[bi];
  const card = bucket && bucket.cards[ci];
  if (!card) return;

  const res = await new NexusKanbanCardModal(mod.app, {
    card,
    columns: cfg.buckets.map(b => b.title),
    columnIndex: bi,
    note: card.link ? mod.noteByName(card.link) : null,
  }).openAndGet();
  if (!res) return;

  if (res.action === 'delete') {
    bucket.cards.splice(ci, 1);
    await mod.save(el, ctx, cfg);
    return;
  }

  // Matching the note's own name means "just show the note" — keep it clean.
  const edited = res.card;
  if (edited.link && edited.text && edited.text === (edited.alias || edited.link)) edited.text = '';
  if (res.action === 'unlink') {
    if (!edited.text) edited.text = edited.alias || edited.link;
    edited.link = ''; edited.alias = '';
  }
  Object.assign(card, {
    done: edited.done, text: edited.text, desc: edited.desc,
    due: edited.due, tags: edited.tags, link: edited.link, alias: edited.alias,
  });

  // The column is applied before anything that navigates away, so a card that
  // was moved and opened lands in the right place either way.
  let index = ci, at = bi;
  if (res.column !== bi && cfg.buckets[res.column]) {
    moveCard(cfg, bi, ci, res.column, cfg.buckets[res.column].cards.length);
    index = cfg.buckets[res.column].cards.length - 1;
    at = res.column;
  }
  await mod.save(el, ctx, cfg);

  if (res.action === 'open') {
    const note = card.link ? mod.noteByName(card.link) : null;
    if (note) mod.app.workspace.getLeaf(false).openFile(note);
    return;
  }
  if (res.action === 'create') {
    await createNote(mod, cfg, at, index, el, ctx);
    return;
  }
  if (res.action === 'link') {
    new NexusNamePickModal(mod.app, 'Which note?',
      mod.app.vault.getMarkdownFiles().map(f => f.path).sort((a, b) => a.localeCompare(b)),
      (path) => {
        const f = mod.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) return;
        const target = cfg.buckets[at] && cfg.buckets[at].cards[index];
        if (!target) return;
        target.link = f.basename;
        if (target.text && target.text === f.basename) target.text = '';
        mod.save(el, ctx, cfg);
      }).open();
  }
}

async function createNote(mod, cfg, bi, ci, el, ctx) {
  const card = cfg.buckets[bi] && cfg.buckets[bi].cards[ci];
  const title = card ? cardTitle(card) : '';
  if (!title) { new Notice('The card has no title yet.'); return; }
  const boardPath = ctx && ctx.sourcePath ? ctx.sourcePath : '';
  const boardFile = boardPath ? mod.app.vault.getAbstractFileByPath(boardPath) : null;
  let folder = (cfg.notes || mod.s.notesFolder || '').replace(/^\/|\/$/g, '');
  if (!folder && boardFile && boardFile.parent && boardFile.parent.path !== '/') folder = boardFile.parent.path;
  if (folder) await mod.ensureFolder(folder);

  let body = '';
  if (cfg.template) {
    const tf = mod.app.vault.getAbstractFileByPath(cfg.template.endsWith('.md') ? cfg.template : cfg.template + '.md');
    if (tf instanceof TFile) {
      try { body = await mod.app.vault.read(tf); }
      catch (e) { new Notice('Template could not be read: ' + cfg.template); }
    }
    else new Notice('Template not found: ' + cfg.template);
  }
  if (!body) {
    const fm = ['---', 'nexus-type: card'];
    if (boardFile) fm.push('nexus-board: "[[' + boardFile.basename + ']]"');
    if (card.due) fm.push('due: ' + card.due);
    if ((card.tags || []).length) fm.push('tags: [' + card.tags.join(', ') + ']');
    fm.push('---', '', '# ' + title, '');
    body = fm.join('\n');
  }
  const path = mod.freePath((folder ? folder + '/' : '') + mod.sanitize(title) + '.md');
  const file = await mod.app.vault.create(path, body);
  card.link = file.basename;
  if (card.text === file.basename) card.text = '';
  await mod.save(el, ctx, cfg);
  mod.app.workspace.getLeaf('tab').openFile(file);
}

module.exports = { blockSource };
