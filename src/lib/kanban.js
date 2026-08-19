'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · kanban boards
 *  A ```nexus-kanban``` block IS the board — config lines, then one section per
 *  column and one checklist line per card:
 *
 *      title: Roadmap
 *      notes: Projects/Roadmap
 *      ## Backlog
 *      - [ ] Rework the tab bar
 *      ## Doing @2
 *      - [ ] [[Kanban module|Kanban]] @2026-08-25 #plugin
 *      ## Done
 *      - [x] Ship the pinned tabs
 *
 *  Why the cards live INSIDE the fence and not in the note body: a board note
 *  would otherwise render its columns twice — once as the board, once as plain
 *  markdown — and every card would need a hidden marker to stay addressable.
 *  Inside the block the whole board is ONE hand-editable text: it survives
 *  without the plugin, travels with the file, and needs no state in data.json.
 *
 *  Anything the parser does not understand is kept and written back untouched,
 *  so a rewrite (drag, rename, new card) can never eat a line someone typed.
 * ========================================================================== */

const { Notice, TFile, moment, setIcon } = require('obsidian');

const RE_HEAD = /^\s{0,3}#{1,6}\s+(.*)$/;
const RE_CARD = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/;
const RE_LINK = /\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/;
const RE_DUE = /(?:^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/;
const RE_TAG = /(?:^|\s)#([\p{L}\d/_-]+)/gu;

/* A column's colour says what KIND of column it is, read off its own name —
   nobody should have to configure "Done is green".

   These are Obsidian's SEMANTIC colours, not palette slots: on a warm palette
   (the theme's own "Ember & Prussian" has orange in color2, color3 AND color11)
   every column came out the same coral and the board lost its meaning. The
   theme already colours task states from the same three vars, so blue/orange/
   green is what the rest of the vault says too. */
const KIND_SLOT = {
  open:  ['--text-muted', '#8a8a95'],
  doing: ['--color-blue', '#4a9eff'],
  wait:  ['--color-orange', '#e9973f'],
  done:  ['--color-green', '#44cf6e'],
};
function bucketKind(title) {
  const t = String(title || '').toLowerCase();
  if (/erled|fertig|done|closed|abgeschlossen|ship/.test(t)) return 'done';
  if (/wart|block|halt|pause|später|spaeter|review|prüf|pruef/.test(t)) return 'wait';
  if (/arbeit|doing|progress|aktiv|wip|läuft|laeuft/.test(t)) return 'doing';
  return 'open';
}
function kindVar(kind) {
  const s = KIND_SLOT[kind] || KIND_SLOT.open;
  return 'var(' + s[0] + ', ' + s[1] + ')';
}
const truthy = (v) => /^(true|yes|1|on)$/i.test(String(v).trim());

/* Auto-scroll the column strip while a card is held against its edge. Without
   it, a board wider than the screen can only be dropped into the columns that
   happen to be visible — elementFromPoint knows nothing about what is scrolled
   out of view. Shared by both boards. */
function nxEdgeScroller(container) {
  let dir = 0, timer = null;
  const step = () => { if (dir && container) container.scrollLeft += dir * 14; };
  return {
    at(x) {
      if (!container) return;
      const r = container.getBoundingClientRect();
      const next = x < r.left + 64 ? -1 : x > r.right - 64 ? 1 : 0;
      dir = next;
      if (dir && timer == null) timer = window.setInterval(step, 16);
      if (!dir && timer != null) { window.clearInterval(timer); timer = null; }
    },
    stop() { if (timer != null) window.clearInterval(timer); timer = null; dir = 0; },
  };
}

/* ---- parse ---------------------------------------------------------------- */

/* One checklist line → card. `rest` keeps whatever is left after the link, the
   due date and the tags have been lifted out, so a card can carry free text
   next to a note link ("[[Spec]] second pass"). */
function parseCard(line) {
  const m = String(line).match(RE_CARD);
  if (!m) return null;
  let rest = m[2];
  const link = rest.match(RE_LINK);
  if (link) rest = rest.replace(RE_LINK, ' ');
  const due = rest.match(RE_DUE);
  if (due) rest = rest.replace(RE_DUE, ' ');
  const tags = [];
  rest = rest.replace(RE_TAG, (all, t) => { tags.push(t); return ' '; });
  const text = rest.replace(/\s+/g, ' ').trim();
  return {
    done: m[1].toLowerCase() === 'x',
    link: link ? link[1].trim() : '',
    alias: link && link[2] ? link[2].trim() : '',
    text,
    due: due ? due[1] : '',
    tags,
  };
}
/* What the card is CALLED — its own text wins, otherwise the note it points at. */
function cardTitle(card) {
  return card.text || card.alias || card.link || '';
}
function cardLine(card) {
  const bits = [];
  if (card.link) bits.push('[[' + card.link + (card.alias && card.alias !== card.link ? '|' + card.alias : '') + ']]');
  if (card.text) bits.push(card.text);
  if (card.due) bits.push('@' + card.due);
  (card.tags || []).forEach(t => bits.push('#' + t));
  return '- [' + (card.done ? 'x' : ' ') + '] ' + bits.join(' ');
}

function parseKanban(src, defaults) {
  const cfg = Object.assign({
    title: '', notes: '', template: '', compact: false, due: true, tags: true, counts: true,
  }, defaults || {}, { buckets: [], extra: [] });
  let cur = null;
  String(src || '').split('\n').forEach(raw => {
    const line = raw.replace(/\s+$/, '');
    const head = line.match(RE_HEAD);
    if (head) {
      let title = head[1].trim();
      let limit = 0;
      const lim = title.match(/\s+@(\d+)$/);
      if (lim) { limit = parseInt(lim[1], 10) || 0; title = title.slice(0, lim.index).trim(); }
      cur = { title, limit, cards: [], extra: [] };
      cfg.buckets.push(cur);
      return;
    }
    const card = parseCard(line);
    if (card) {
      // A card before the first heading still belongs somewhere — give it a home
      // rather than dropping it on the floor.
      if (!cur) { cur = { title: 'Backlog', limit: 0, cards: [], extra: [] }; cfg.buckets.push(cur); }
      cur.cards.push(card);
      return;
    }
    if (!line.trim()) return;
    if (cur) { cur.extra.push(line); return; }
    const i = line.indexOf(':');
    if (i < 0) { cfg.extra.push(line); return; }
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    switch (k) {
      case 'title': cfg.title = v; break;
      case 'notes': case 'folder': cfg.notes = v.replace(/^\/|\/$/g, ''); break;
      case 'template': cfg.template = v; break;
      case 'compact': cfg.compact = truthy(v); break;
      case 'due': cfg.due = truthy(v); break;
      case 'tags': cfg.tags = truthy(v); break;
      case 'counts': cfg.counts = truthy(v); break;
      default: cfg.extra.push(line); break;
    }
  });
  return cfg;
}

function stringifyKanban(cfg) {
  const out = [];
  if (cfg.title) out.push('title: ' + cfg.title);
  if (cfg.notes) out.push('notes: ' + cfg.notes);
  if (cfg.template) out.push('template: ' + cfg.template);
  if (cfg.compact) out.push('compact: true');
  if (cfg.due === false) out.push('due: false');
  if (cfg.tags === false) out.push('tags: false');
  if (cfg.counts === false) out.push('counts: false');
  (cfg.extra || []).forEach(l => out.push(l));
  (cfg.buckets || []).forEach(b => {
    out.push('## ' + b.title + (b.limit ? ' @' + b.limit : ''));
    (b.cards || []).forEach(c => out.push(cardLine(c)));
    (b.extra || []).forEach(l => out.push(l));
  });
  return out.join('\n');
}

/* ---- the module ----------------------------------------------------------- */

class NexusKanban {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
  get s() { return this.plugin.settings.kanban || {}; }

  init() {
    const p = this.plugin;
    p.registerMarkdownCodeBlockProcessor('nexus-kanban', (src, el, ctx) => {
      try { this.render(src, el, ctx); }
      catch (e) {
        el.empty();
        el.createDiv({ cls: 'nx-kb-empty', text: 'Kanban: ' + e.message });
        console.error('[nexus-suite] kanban', e);
      }
    });
    p.addCommand({ id: 'nexus-insert-kanban', name: 'Insert a kanban board',
      editorCallback: (editor) => editor.replaceSelection(this.blockText('')) });
    p.addCommand({ id: 'nexus-new-kanban', name: 'New kanban board (note)',
      callback: () => this.newBoardNote() });
  }

  /* The starting block — the columns come from the settings so a new board is
     already the board this vault works with. */
  blockText(title) {
    const cols = (this.s.buckets && this.s.buckets.length ? this.s.buckets : ['Backlog', 'In Arbeit', 'Erledigt']);
    const lines = ['```nexus-kanban'];
    if (title) lines.push('title: ' + title);
    if (this.s.notesFolder) lines.push('notes: ' + this.s.notesFolder);
    cols.forEach(c => lines.push('## ' + c));
    lines.push('```', '');
    return lines.join('\n');
  }

  async newBoardNote() {
    const { NexusNameModal } = require('../modals/misc.js');
    const name = await new NexusNameModal(this.app, 'Name of the board', 'Board').openAndGet();
    if (!name) return;
    const folder = (this.s.boardsFolder || '').replace(/^\/|\/$/g, '');
    if (folder) await this.ensureFolder(folder);
    const path = this.freePath((folder ? folder + '/' : '') + this.sanitize(name) + '.md');
    const file = await this.app.vault.create(path, '# ' + name + '\n\n' + this.blockText(name));
    this.app.workspace.getLeaf(false).openFile(file);
  }

  /* ---- vault helpers ------------------------------------------------------ */

  sanitize(name) { return String(name || '').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  freePath(path) {
    const dot = path.lastIndexOf('.');
    const base = path.slice(0, dot), ext = path.slice(dot);
    for (let i = 1; i < 500; i++) {
      const p = i === 1 ? base + ext : base + ' ' + i + ext;
      if (!this.app.vault.getAbstractFileByPath(p)) return p;
    }
    return base + ' ' + Date.now().toString(36) + ext;
  }
  async ensureFolder(path) {
    const ad = this.app.vault.adapter;
    let cur = '';
    for (const part of String(path).split('/')) {
      if (!part) continue;
      cur = cur ? cur + '/' + part : part;
      try { if (!(await ad.exists(cur))) await ad.mkdir(cur); } catch (e) {}
    }
  }
  noteByName(name) {
    if (!name) return null;
    return this.app.metadataCache.getFirstLinkpathDest(name, '') || null;
  }

  /* ---- render ------------------------------------------------------------- */

  render(src, el, ctx) {
    if (this.s.enabled === false) {
      el.empty();
      el.addClass('nx-kb');
      el.createDiv({ cls: 'nx-kb-empty', text: 'The Kanban module is off — turn on “Enabled” in Settings → Kanban.' });
      return;
    }
    // Parsed WITHOUT the settings mixed in: whatever the settings say must not
    // end up written into the user's block on the next save. They are applied
    // where they are used instead (here, and in createNote).
    const cfg = parseKanban(src);
    el.empty();
    el.addClass('nx-kb');
    el.toggleClass('is-compact', cfg.compact || !!this.s.compact);
    el._nxRepaint = (next) => { try { this.render(next != null ? next : src, el, ctx); } catch (e) {} };

    const head = el.createDiv('nx-kb-head');
    const boardNote = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    head.createDiv({ cls: 'nx-kb-title', text: cfg.title || (boardNote ? boardNote.basename : 'Board') });

    const open = cfg.buckets.reduce((n, b) => n + b.cards.filter(c => !c.done).length, 0);
    const total = cfg.buckets.reduce((n, b) => n + b.cards.length, 0);
    head.createDiv({ cls: 'nx-kb-count', text: open + ' / ' + total });

    const tools = head.createDiv('nx-kb-tools');
    const tool = (icon, label, fn) => {
      const b = tools.createDiv('nx-kb-tool');
      setIcon(b, icon);
      b.setAttribute('aria-label', label);
      b.onclick = fn;
      return b;
    };
    tool('plus', 'New column', async () => {
      const { NexusNameModal } = require('../modals/misc.js');
      const name = await new NexusNameModal(this.app, 'Name of the column', 'New column').openAndGet();
      if (!name) return;
      cfg.buckets.push({ title: name, limit: 0, cards: [], extra: [] });
      this.save(el, ctx, cfg);
    });
    tool('eraser', 'Remove all done cards', async () => {
      const { NexusConfirmModal } = require('../modals/misc.js');
      const n = cfg.buckets.reduce((x, b) => x + b.cards.filter(c => c.done).length, 0);
      if (!n) { new Notice('No done cards.'); return; }
      const ok = await new NexusConfirmModal(this.app, 'Remove ' + n + ' done card(s)?',
        'The cards disappear from the board. Notes they point at are kept.', 'Remove').openAndGet();
      if (!ok) return;
      cfg.buckets.forEach(b => { b.cards = b.cards.filter(c => !c.done); });
      this.save(el, ctx, cfg);
    });

    const cols = el.createDiv('nx-kb-cols');
    if (!cfg.buckets.length) {
      cols.createDiv({ cls: 'nx-kb-empty', text: 'No columns yet — use + up there.' });
      return;
    }
    cfg.buckets.forEach((b, i) => this.column(cols, cfg, b, i, el, ctx));
  }

  column(cols, cfg, bucket, index, el, ctx) {
    const kind = bucketKind(bucket.title);
    const col = cols.createDiv('nx-kb-col is-' + kind);
    col.dataset.i = String(index);
    col.style.setProperty('--nx-kb-kind', kindVar(kind));

    const head = col.createDiv('nx-kb-col-head');
    head.createSpan({ cls: 'nx-kb-col-dot' });
    head.createSpan({ cls: 'nx-kb-col-title', text: bucket.title });
    const open = bucket.cards.filter(c => !c.done).length;
    if (cfg.counts !== false) {
      const cnt = head.createSpan({ cls: 'nx-kb-col-count', text: bucket.limit ? open + '/' + bucket.limit : String(bucket.cards.length) });
      if (bucket.limit && open > bucket.limit) cnt.addClass('is-over');
    }
    const menu = head.createDiv('nx-kb-col-menu');
    setIcon(menu, 'ellipsis-vertical');
    menu.setAttribute('aria-label', 'Column menu');
    menu.onclick = (e) => { e.stopPropagation(); this.columnMenu(e, cfg, index, el, ctx); };

    const list = col.createDiv('nx-kb-cards');
    list.dataset.i = String(index);
    bucket.cards.forEach((card, ci) => this.card(list, cfg, index, ci, card, el, ctx));

    const add = col.createDiv('nx-kb-add');
    setIcon(add.createSpan({ cls: 'nx-kb-add-ic' }), 'plus');
    const input = add.createEl('input', { cls: 'nx-kb-add-input', attr: { type: 'text', placeholder: 'New card' } });
    input.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      bucket.cards.push({ done: false, link: '', alias: '', text: title, due: '', tags: [] });
      this.save(el, ctx, cfg);
    };
  }

  card(list, cfg, bi, ci, card, el, ctx) {
    const note = card.link ? this.noteByName(card.link) : null;
    const c = list.createDiv('nx-kb-card' + (card.done ? ' is-done' : '') + (card.link && !note ? ' is-missing' : ''));
    c.dataset.b = String(bi);
    c.dataset.c = String(ci);

    const box = c.createEl('input', { cls: 'nx-kb-check', attr: { type: 'checkbox' } });
    box.checked = !!card.done;
    box.onclick = (e) => e.stopPropagation();
    box.onchange = () => { card.done = box.checked; this.save(el, ctx, cfg); };

    const body = c.createDiv('nx-kb-card-body');
    const line = body.createDiv('nx-kb-card-line');
    if (card.link) {
      const ic = line.createSpan({ cls: 'nx-kb-card-ic' });
      setIcon(ic, note ? 'file-text' : 'file-question');
      ic.setAttribute('aria-label', note ? note.path : 'No note called "' + card.link + '"');
    }
    line.createSpan({ cls: 'nx-kb-card-t', text: cardTitle(card) || '(no title)' });

    const meta = body.createDiv('nx-kb-card-meta');
    if (card.due && cfg.due !== false) {
      const today = moment().format('YYYY-MM-DD');
      const late = !card.done && card.due < today;
      const d = moment(card.due, 'YYYY-MM-DD');
      meta.createSpan({
        cls: 'nx-kb-due' + (late ? ' is-late' : '') + (card.due === today ? ' is-today' : ''),
        text: card.due === today ? 'today' : d.isValid() ? d.format('D MMM') : card.due,
      });
    }
    if (cfg.tags !== false) (card.tags || []).forEach(t => meta.createSpan({ cls: 'nx-kb-tag', text: '#' + t }));
    if (!meta.childElementCount) meta.remove();

    const dots = c.createDiv('nx-kb-card-menu');
    setIcon(dots, 'ellipsis-vertical');
    dots.setAttribute('aria-label', 'Card menu');
    dots.onclick = (e) => { e.stopPropagation(); this.cardMenu(e, cfg, bi, ci, el, ctx); };

    c.onclick = (e) => {
      if (c.hasClass('is-dragging')) return;
      if (note) this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(note);
      else this.renameCard(cfg, bi, ci, el, ctx);
    };
    c.oncontextmenu = (e) => { e.preventDefault(); this.cardMenu(e, cfg, bi, ci, el, ctx); };
    this.dragSource(c, cfg, bi, ci, el, ctx);
  }

  /* ---- menus -------------------------------------------------------------- */

  columnMenu(evt, cfg, index, el, ctx) {
    const { NexusPopupMenu } = require('../modals/pickers.js');
    const { NexusConfirmModal, NexusNameModal } = require('../modals/misc.js');
    const b = cfg.buckets[index];
    const menu = new NexusPopupMenu(this.app, b.title);
    menu.addItem(i => i.setTitle('Rename').setIcon('pencil').onClick(async () => {
      const name = await new NexusNameModal(this.app, 'Name of the column', b.title).openAndGet();
      if (!name) return;
      b.title = name;
      this.save(el, ctx, cfg);
    }));
    menu.addItem(i => i.setTitle(b.limit ? 'WIP limit (' + b.limit + ')' : 'WIP limit').setIcon('gauge').onClick(async () => {
      const v = await new NexusNameModal(this.app, 'How many cards at most? (0 = no limit)', String(b.limit || 0)).openAndGet();
      if (v == null) return;
      b.limit = Math.max(0, parseInt(v, 10) || 0);
      this.save(el, ctx, cfg);
    }));
    menu.addSeparator();
    if (index > 0) menu.addItem(i => i.setTitle('Move left').setIcon('arrow-left').onClick(() => {
      cfg.buckets.splice(index - 1, 0, cfg.buckets.splice(index, 1)[0]);
      this.save(el, ctx, cfg);
    }));
    if (index < cfg.buckets.length - 1) menu.addItem(i => i.setTitle('Move right').setIcon('arrow-right').onClick(() => {
      cfg.buckets.splice(index + 1, 0, cfg.buckets.splice(index, 1)[0]);
      this.save(el, ctx, cfg);
    }));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Remove done cards').setIcon('eraser').onClick(() => {
      b.cards = b.cards.filter(c => !c.done);
      this.save(el, ctx, cfg);
    }));
    menu.addItem(i => i.setTitle('Delete column').setIcon('trash-2').onClick(async () => {
      if (b.cards.length) {
        const ok = await new NexusConfirmModal(this.app, 'Delete "' + b.title + '"?',
          b.cards.length + ' card(s) go with it. Notes they point at are kept.', 'Delete').openAndGet();
        if (!ok) return;
      }
      cfg.buckets.splice(index, 1);
      this.save(el, ctx, cfg);
    }));
    menu.showAtMouseEvent(evt);
  }

  cardMenu(evt, cfg, bi, ci, el, ctx) {
    const { NexusPopupMenu } = require('../modals/pickers.js');
    const { NexusNamePickModal } = require('../modals/misc.js');
    const card = cfg.buckets[bi].cards[ci];
    const note = card.link ? this.noteByName(card.link) : null;
    const menu = new NexusPopupMenu(this.app, cardTitle(card) || 'Card');

    if (note) {
      menu.addItem(i => i.setTitle('Open note').setIcon('file-text')
        .onClick(() => this.app.workspace.getLeaf(false).openFile(note)));
      menu.addItem(i => i.setTitle('Open in a new tab').setIcon('layout')
        .onClick(() => this.app.workspace.getLeaf('tab').openFile(note)));
      menu.addItem(i => i.setTitle('Unlink the note').setIcon('unlink').onClick(() => {
        if (!card.text) card.text = cardTitle(card);
        card.link = ''; card.alias = '';
        this.save(el, ctx, cfg);
      }));
    } else {
      menu.addItem(i => i.setTitle('Create a note for this card').setIcon('file-plus')
        .onClick(() => this.createNote(cfg, bi, ci, el, ctx)));
      menu.addItem(i => i.setTitle('Link an existing note').setIcon('link').onClick(() => {
        new NexusNamePickModal(this.app, 'Which note?',
          this.app.vault.getMarkdownFiles().map(f => f.path).sort((a, b) => a.localeCompare(b)),
          (path) => {
            const f = this.app.vault.getAbstractFileByPath(path);
            if (!(f instanceof TFile)) return;
            card.link = f.basename;
            // The card keeps its own wording; the note name is only the target.
            if (card.text && card.text === f.basename) card.text = '';
            this.save(el, ctx, cfg);
          }).open();
      }));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Rename').setIcon('pencil').onClick(() => this.renameCard(cfg, bi, ci, el, ctx)));
    menu.addItem(i => i.setTitle(card.due ? 'Due date (' + card.due + ')' : 'Due date').setIcon('calendar-days').onClick(async () => {
      const { NexusNameModal } = require('../modals/misc.js');
      const v = await new NexusNameModal(this.app, 'Due date (YYYY-MM-DD, empty = none)', card.due || '', true).openAndGet();
      if (v == null) return;
      const t = String(v).trim();
      card.due = /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
      this.save(el, ctx, cfg);
    }));
    menu.addItem(i => i.setTitle(card.done ? 'Mark as open' : 'Mark as done').setIcon(card.done ? 'circle' : 'check')
      .onClick(() => { card.done = !card.done; this.save(el, ctx, cfg); }));
    menu.addSeparator();
    cfg.buckets.forEach((b, i) => {
      if (i === bi) return;
      menu.addItem(x => x.setTitle('Move to “' + b.title + '”').setIcon('arrow-right')
        .onClick(() => { this.move(cfg, bi, ci, i, b.cards.length); this.save(el, ctx, cfg); }));
    });
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Delete card').setIcon('trash-2').onClick(() => {
      cfg.buckets[bi].cards.splice(ci, 1);
      this.save(el, ctx, cfg);
    }));
    menu.showAtMouseEvent(evt);
  }

  async renameCard(cfg, bi, ci, el, ctx) {
    const { NexusNameModal } = require('../modals/misc.js');
    const card = cfg.buckets[bi].cards[ci];
    const name = await new NexusNameModal(this.app, 'Card text', cardTitle(card)).openAndGet();
    if (name == null) return;
    const t = String(name).trim();
    // Matching the note name again means "just show the note" — keep it clean.
    card.text = (card.link && t === (card.alias || card.link)) ? '' : t;
    this.save(el, ctx, cfg);
  }

  /* A card without a note becomes one: the note is created in the board's
     `notes:` folder, the card starts pointing at it, and the note carries a
     link back so the board is findable from the note side too. */
  async createNote(cfg, bi, ci, el, ctx) {
    const card = cfg.buckets[bi].cards[ci];
    const title = cardTitle(card);
    if (!title) { new Notice('The card has no title yet.'); return; }
    const boardPath = ctx && ctx.sourcePath ? ctx.sourcePath : '';
    const boardFile = boardPath ? this.app.vault.getAbstractFileByPath(boardPath) : null;
    let folder = (cfg.notes || this.s.notesFolder || '').replace(/^\/|\/$/g, '');
    if (!folder && boardFile && boardFile.parent && boardFile.parent.path !== '/') folder = boardFile.parent.path;
    if (folder) await this.ensureFolder(folder);

    let body = '';
    if (cfg.template) {
      const tf = this.app.vault.getAbstractFileByPath(cfg.template.endsWith('.md') ? cfg.template : cfg.template + '.md');
      if (tf instanceof TFile) { try { body = await this.app.vault.read(tf); } catch (e) {} }
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
    const path = this.freePath((folder ? folder + '/' : '') + this.sanitize(title) + '.md');
    const file = await this.app.vault.create(path, body);
    card.link = file.basename;
    if (card.text === file.basename) card.text = '';
    await this.save(el, ctx, cfg);
    this.app.workspace.getLeaf('tab').openFile(file);
  }

  /* ---- moving cards -------------------------------------------------------- */

  move(cfg, bi, ci, toB, toIndex) {
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

  /* Pointer-based drag — a finger on the tablet cannot use HTML5 drag & drop.
     The drop index comes from the card midpoints under the pointer, so a card
     can be placed inside a column and not just appended to it. */
  dragSource(cardEl, cfg, bi, ci, el, ctx) {
    cardEl.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button > 0) return;
      if (e.target && e.target.closest && e.target.closest('.nx-kb-check, .nx-kb-card-menu')) return;
      const startX = e.clientX, startY = e.clientY;
      let ghost = null, moved = false, mark = null;
      const scroller = nxEdgeScroller(el.querySelector('.nx-kb-cols'));

      const spot = (ev) => {
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const list = under && under.closest ? under.closest('.nx-kb-cards') : null;
        if (!list || !el.contains(list)) return null;
        const cards = Array.from(list.querySelectorAll('.nx-kb-card')).filter(c => c !== cardEl);
        let at = cards.length;
        for (let i = 0; i < cards.length; i++) {
          const r = cards[i].getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { at = i; break; }
        }
        return { list, bucket: parseInt(list.dataset.i, 10), at, before: cards[at] || null };
      };
      const clear = () => {
        if (mark) { mark.remove(); mark = null; }
        el.querySelectorAll('.nx-kb-col.is-over').forEach(c => c.removeClass('is-over'));
      };
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
        if (!moved) {
          moved = true;
          cardEl.addClass('is-dragging');
          ghost = document.body.createDiv('nx-kb-ghost');
          ghost.setText(cardTitle(cfg.buckets[bi].cards[ci]) || 'Card');
        }
        ghost.style.left = ev.clientX + 12 + 'px';
        ghost.style.top = ev.clientY + 12 + 'px';
        scroller.at(ev.clientX);
        const s = spot(ev);
        clear();
        if (!s) return;
        s.list.closest('.nx-kb-col').addClass('is-over');
        mark = createDiv('nx-kb-mark');
        if (s.before) s.list.insertBefore(mark, s.before); else s.list.appendChild(mark);
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        scroller.stop();
        if (ghost) ghost.remove();
        const s = moved ? spot(ev) : null;
        clear();
        window.setTimeout(() => cardEl.removeClass('is-dragging'), 0);
        if (!moved || !s) return;
        if (s.bucket === bi && (s.at === ci || s.at === ci + 1)) return;   // dropped where it was
        this.move(cfg, bi, ci, s.bucket, s.at);
        this.save(el, ctx, cfg);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  /* ---- the board back into the block --------------------------------------- */

  async save(el, ctx, cfg) {
    const src = stringifyKanban(cfg);
    // Repaint from the new state first: the write goes through the vault and
    // Obsidian's own re-render lands a moment later — without this the card
    // would visibly snap back before it moves.
    if (el._nxRepaint) el._nxRepaint(src);
    const info = ctx && ctx.getSectionInfo ? ctx.getSectionInfo(el) : null;
    const file = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    if (!info || !(file instanceof TFile)) {
      new Notice('Nexus: could not locate the kanban block — the board was not saved.');
      return;
    }
    const lines = (await this.app.vault.read(file)).split('\n');
    lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...src.split('\n'));
    await this.app.vault.modify(file, lines.join('\n'));
  }
}

module.exports = {
  NexusKanban, parseKanban, stringifyKanban, parseCard, cardLine, cardTitle,
  bucketKind, kindVar, nxEdgeScroller,
};
