'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · kanban boards
 *  ONE board with TWO sources. The columns, the drag, the card and the column
 *  kinds are one implementation; the only thing that differs is where the cards
 *  come from and where a move is written.
 *
 *      source: block   (the default)
 *      ## Backlog
 *      - [ ] Rework the tab bar
 *      ## Doing @2
 *      - [ ] [[Kanban module|Kanban]] @2026-08-25 #plugin
 *      ## Done
 *      - [x] Ship the pinned tabs
 *
 *      source: folder
 *      folder: SCHOOL/Biology
 *      status: status
 *      ## Offen
 *      ## In Arbeit
 *      ## Erledigt
 *
 *  This file is everything both sources share: the head, the column strip, the
 *  card frame and the pointer drag. What a source has to answer for itself is
 *  in kanbanblock.js (the fence IS the board) and board.js (the notes of a
 *  folder are the cards) — see the seam described there.
 * ========================================================================== */

const { Notice, TFile, setIcon } = require('obsidian');
const blockedit = require('./blockedit.js');
const block = require('./kanbanblock.js');
const edit = require('./kanbanedit.js');
const { parseKanban, stringifyKanban, kindVar } = block;
const { blockSource } = edit;

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

/* ---- the card ------------------------------------------------------------- */

/* One card, whoever filled it — the column strip, the folder board and the
   graph block's grid all draw this and only differ in what goes in the slots.
   The caller wires the events, because only it knows what a click means. */
function cardFrame(parent, v) {
  const c = parent.createDiv('nx-kb-card'
    + (v.done ? ' is-done' : '') + (v.missing ? ' is-missing' : '')
    + (v.orphan ? ' is-orphan' : '') + (v.state ? ' has-state' : ''));
  if (v.kind) c.style.setProperty('--nx-kb-kind', kindVar(v.kind));
  const lead = v.lead ? c.createDiv('nx-kb-card-lead') : null;
  const body = c.createDiv('nx-kb-card-body');
  const line = body.createDiv('nx-kb-card-line');
  if (v.icon) {
    const ic = line.createSpan({ cls: 'nx-kb-card-ic' });
    setIcon(ic, v.icon);
    if (v.iconLabel) ic.setAttribute('aria-label', v.iconLabel);
  }
  line.createSpan({ cls: 'nx-kb-card-t', text: v.title || '(no title)' });
  // Four lines at most, the rest cut off with an ellipsis (CSS line-clamp) —
  // a card is a glance, and the whole text is one click away.
  if (v.desc != null) body.createDiv({ cls: 'nx-kb-card-desc', text: v.desc });
  const meta = body.createDiv('nx-kb-card-meta');
  (v.chips || []).forEach(ch => {
    const chip = meta.createSpan({ cls: 'nx-kb-' + ch.cls + (ch.mod ? ' ' + ch.mod : '') });
    if (ch.icon) setIcon(chip, ch.icon);
    chip.createSpan({ text: ch.text });
    if (ch.label) chip.setAttribute('aria-label', ch.label);
  });
  const dots = c.createDiv('nx-kb-card-menu');
  setIcon(dots, 'ellipsis-vertical');
  dots.setAttribute('aria-label', 'Card menu');
  return { el: c, lead, body, meta, dots };
}

/* ---- the module ----------------------------------------------------------- */

class NexusKanban {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
  get s() { return this.plugin.settings.kanban || {}; }

  init() {
    const p = this.plugin;
    const draw = (fence, defaults) => (src, el, ctx) => {
      try { this.render(src, el, ctx, { fence, defaults }); }
      catch (e) {
        el.empty();
        el.createDiv({ cls: 'nx-kb-empty', text: 'Kanban: ' + e.message });
        console.error('[nexus-suite] kanban', e);
      }
    };
    const statusProp = this.s.statusProperty || 'status';
    p.registerMarkdownCodeBlockProcessor('nexus-kanban', draw('nexus-kanban', { statusProp }));
    /* The old block, unchanged for whoever wrote it: its cards were always the
       notes of a folder, and `mode: grid` / `show: graph` still reach the views
       that moved into ```nexus-graph```. */
    p.registerMarkdownCodeBlockProcessor('nexus-board', draw('nexus-board',
      { source: 'folder', mode: 'grid', statusProp }));
    /* Where the grid and the force-directed web live now. Same config, same
       cards — only the arrangement differs, so it is the same processor. */
    p.registerMarkdownCodeBlockProcessor('nexus-graph', draw('nexus-graph',
      { source: 'folder', mode: 'graph', statusProp }));

    p.addCommand({ id: 'nexus-insert-kanban', name: 'Insert a kanban board',
      editorCallback: (editor) => editor.replaceSelection(this.blockText('')) });
    p.addCommand({ id: 'nexus-new-kanban', name: 'New kanban board (note)',
      callback: () => this.newBoardNote() });
    p.addCommand({ id: 'nexus-insert-board', name: 'Insert a folder board',
      editorCallback: (editor, view) => {
        const dir = view && view.file && view.file.parent ? view.file.parent.path : '';
        editor.replaceSelection(this.blockText('', dir));
      } });
    p.addCommand({ id: 'nexus-insert-graph', name: 'Insert a folder graph',
      editorCallback: (editor, view) => {
        const dir = view && view.file && view.file.parent ? view.file.parent.path : '';
        editor.replaceSelection('```nexus-graph\nfolder: ' + dir + '\nview: graph\n```\n');
      } });

    // A folder board is a view of the vault, so it has to follow the vault.
    ['create', 'delete', 'rename'].forEach(ev => p.registerEvent(this.app.vault.on(ev, () => this.refreshFolderBoards())));
    p.registerEvent(this.app.metadataCache.on('changed', () => this.refreshFolderBoards()));
  }
  refreshFolderBoards() {
    window.clearTimeout(this._t);
    this._t = window.setTimeout(() => {
      document.querySelectorAll('.nx-kb.is-folder, .nx-graph').forEach(el => {
        if (el._nxRepaint) try { el._nxRepaint(); }
        catch (e) { console.error('[nexus-suite] kanban refresh', e); }
      });
    }, 350);
  }

  /* The starting block — the columns come from the settings so a new board is
     already the board this vault works with. */
  blockText(title, folder) {
    const cols = (this.s.buckets && this.s.buckets.length ? this.s.buckets : ['Backlog', 'In progress', 'Done']);
    const lines = ['```nexus-kanban'];
    if (folder != null) lines.push('source: folder', 'folder: ' + folder);
    if (title) lines.push('title: ' + title);
    if (folder == null && this.s.notesFolder) lines.push('notes: ' + this.s.notesFolder);
    (folder != null ? require('./board.js').DEFAULT_STATES : cols).forEach(c => lines.push('## ' + c));
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

  render(src, el, ctx, opts) {
    const o = opts || {};
    if (this.s.enabled === false) {
      el.empty();
      el.addClass('nx-kb');
      el.createDiv({ cls: 'nx-kb-empty',
        text: 'This block needs the Kanban module — turn on “Enabled” in Settings → Kanban.' });
      return;
    }
    /* The only setting the parser is given is the default status property, and
       a folder board writes it into its own block on the first save on purpose:
       from then on the board names the property itself and a change in the
       settings cannot re-bucket a note. Everything else the settings say is
       applied where it is used (here, and in createNote). */
    const cfg = parseKanban(src, o.defaults);
    // The grid and the graph are their own block now; the old fence still
    // reaches them, so a note written before today renders what it always did.
    if (cfg.source === 'folder' && (cfg.mode === 'grid' || cfg.mode === 'graph')) {
      require('./graph.js').render(this, src, cfg, el, ctx, o);
      return;
    }
    if (el._nxRO) { try { el._nxRO.disconnect(); } catch (e) {} el._nxRO = null; }

    el.empty();
    // The view buttons re-render the same element as the other block, so the
    // classes that block set have to go with it.
    el.removeClass('nx-graph'); el.removeClass('is-sm'); el.removeClass('is-lg');
    el.addClass('nx-kb');
    el.toggleClass('is-compact', cfg.compact || !!this.s.compact);
    el.toggleClass('is-folder', cfg.source === 'folder');
    el._nxSrc = src;   // what is on the board right now — see save()/locateBlock
    el._nxFence = o.fence || 'nexus-kanban';
    el._nxRepaint = (next) => {
      try { this.render(next != null ? next : src, el, ctx, o); }
      catch (e) { console.error('[nexus-suite] ' + el._nxFence + ' repaint', ctx && ctx.sourcePath, e); }
    };

    const source = cfg.source === 'folder'
      ? require('./board.js').folderSource(this, cfg, el, ctx)
      : blockSource(this, cfg, el, ctx);
    const cols = source.columns();

    const head = el.createDiv('nx-kb-head');
    const boardNote = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    head.createDiv({ cls: 'nx-kb-title',
      text: cfg.title || (source.root ? source.root.split('/').pop() : boardNote ? boardNote.basename : 'Board') });
    if (source.head) source.head(head, cols);
    head.createDiv({ cls: 'nx-kb-count', text: source.total(cols) });

    const tools = head.createDiv('nx-kb-tools');
    const tool = (icon, label, fn) => {
      const b = tools.createDiv('nx-kb-tool');
      setIcon(b, icon);
      b.setAttribute('aria-label', label);
      b.onclick = fn;
      return b;
    };
    if (source.tools) source.tools(tools);
    if (source.id === 'block') {
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
    }

    const strip = el.createDiv('nx-kb-cols');
    if (!cols.length) {
      // Only a block board can have none: a folder board is given the default
      // columns rather than being left with nothing to drop into.
      strip.createDiv({ cls: 'nx-kb-empty', text: 'No columns yet — use + up there.' });
      return;
    }
    cols.forEach((col, i) => this.column(strip, cfg, source, col, i));
    if (source.after) source.after(el, cols);
  }

  column(strip, cfg, source, col, index) {
    const wrap = strip.createDiv('nx-kb-col is-' + col.kind + (col.stray ? ' is-stray' : ''));
    wrap.dataset.i = String(index);
    wrap.style.setProperty('--nx-kb-kind', kindVar(col.kind));

    const head = wrap.createDiv('nx-kb-col-head');
    head.createSpan({ cls: 'nx-kb-col-dot' });
    head.createSpan({ cls: 'nx-kb-col-title', text: col.title });
    if (cfg.counts !== false) {
      const cnt = head.createSpan({ cls: 'nx-kb-col-count', text: col.count.text });
      if (col.count.over) cnt.addClass('is-over');
    }
    if (source.colMenu && !col.stray) {
      const menu = head.createDiv('nx-kb-col-menu');
      setIcon(menu, 'ellipsis-vertical');
      menu.setAttribute('aria-label', 'Column menu');
      menu.onclick = (e) => { e.stopPropagation(); source.colMenu(e, index); };
    }

    const list = wrap.createDiv('nx-kb-cards');
    list.dataset.i = String(index);
    col.items.forEach((item, ii) => {
      const frame = cardFrame(list, source.view(item, col));
      frame.el.dataset.b = String(index);
      frame.el.dataset.c = String(ii);
      source.fill(frame, item, index, ii, col);
      if (!frame.meta.childElementCount) frame.meta.remove();
      this.dragSource(frame.el, source, index, ii);
    });
    if (!col.items.length && source.id === 'folder') list.createDiv({ cls: 'nx-kb-drop-hint', text: 'drop a note here' });

    if (!source.add) return;
    // No icon in front of the field: the dashed row and the placeholder already
    // say what it is, and the + was one more thing to draw on every column.
    const add = wrap.createDiv('nx-kb-add');
    const input = add.createEl('input', { cls: 'nx-kb-add-input', attr: { type: 'text', placeholder: 'New card' } });
    input.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      source.add(index, title);
    };
  }

  /* ---- menus -------------------------------------------------------------- */

  /* Shared by both sources. `opts.rename` lets the folder source carry the
     notes along with the label, and `opts.fixedFirst` keeps column 0 where it
     is: on a folder board it is the ABSENCE of the property, so moving another
     column in front of it would re-bucket every note in the folder. */
  columnMenu(evt, cfg, index, el, ctx, opts) {
    const o = opts || {};
    const { NexusPopupMenu } = require('../modals/pickers.js');
    const { NexusConfirmModal, NexusNameModal } = require('../modals/misc.js');
    const b = cfg.buckets[index];
    const menu = new NexusPopupMenu(this.app, b.title);
    menu.addItem(i => i.setTitle('Rename').setIcon('pencil').onClick(async () => {
      const name = await new NexusNameModal(this.app, 'Name of the column', b.title).openAndGet();
      if (!name || name === b.title) return;
      if (o.rename) { o.rename(index, name); return; }
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
    const first = o.fixedFirst ? 1 : 0;
    if (index > first) menu.addItem(i => i.setTitle('Move left').setIcon('arrow-left').onClick(() => {
      cfg.buckets.splice(index - 1, 0, cfg.buckets.splice(index, 1)[0]);
      this.save(el, ctx, cfg);
    }));
    if (index >= first && index < cfg.buckets.length - 1) menu.addItem(i => i.setTitle('Move right').setIcon('arrow-right').onClick(() => {
      cfg.buckets.splice(index + 1, 0, cfg.buckets.splice(index, 1)[0]);
      this.save(el, ctx, cfg);
    }));
    // Deleting a column would strand its cards. A folder board's cards are
    // notes and outlive the board, so it has no such item at all.
    if (o.folder) { menu.showAtMouseEvent(evt); return; }
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

  /* ---- moving cards -------------------------------------------------------- */


  /* Pointer-based drag — a finger on the tablet cannot use HTML5 drag & drop.
     The drop index comes from the card midpoints under the pointer, so a card
     can be placed inside a column and not just appended to it. One drag for
     both sources: only what `move` does with the result differs. */
  dragSource(cardEl, source, bi, ci) {
    const el = cardEl.closest('.nx-kb');
    cardEl.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button > 0) return;
      if (e.target && e.target.closest && e.target.closest('.nx-kb-card-lead, .nx-kb-card-menu')) return;
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
          ghost.setText((cardEl.querySelector('.nx-kb-card-t') || {}).textContent || 'Card');
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
        source.move(bi, ci, s.bucket, s.at);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  /* ---- the board back into the block --------------------------------------- */

  /* Finding the block again is shared with every other block that IS its data —
     see lib/blockedit.js for why getSectionInfo alone is not enough. */
  locateBlock(lines, previousSrc, info, fence) {
    return blockedit.locateFencedBlock(lines, fence || 'nexus-kanban', previousSrc, info);
  }

  async save(el, ctx, cfg) {
    const src = stringifyKanban(cfg);
    const fence = el._nxFence || 'nexus-kanban';
    // What is in the FILE right now — captured before the repaint, which
    // replaces it on the element.
    const previous = el._nxSrc;
    // Repaint from the new state first: the write goes through the vault and
    // Obsidian's own re-render lands a moment later — without this the card
    // would visibly snap back before it moves.
    if (el._nxRepaint) el._nxRepaint(src);
    const res = await blockedit.saveFencedBlock(this.app, TFile, el, ctx, fence, src, previous);
    if (!res.ok) new Notice('Nexus: ' + res.reason + ' — the board was not saved.');
    // Reported, not thrown: a caller that follows the write with vault changes
    // of its own (a column rename) has to know it did not land.
    return res.ok;
  }
}

/* The block format is re-exported here on purpose: kanban.js is what the rest
   of the suite (and the test harness) asks for a board, and which file inside
   the module holds the parser is nobody else's business. */
module.exports = Object.assign({}, block, edit, { NexusKanban, nxEdgeScroller, cardFrame });
