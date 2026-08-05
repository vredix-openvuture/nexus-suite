'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · subject dashboard
 *  A ```nexus-board``` code block turns a normal .md note into the dashboard
 *  of one subject: EVERY note of the folder, always, as a card.
 *
 *  It does not filter. That is the whole design brief — a hand-built dashboard
 *  (or a base) shows what you remembered to put in it; this shows the folder,
 *  so nothing can quietly go missing. Two arrangements of the same set:
 *
 *    grid    every note as a card, sorted — the default view
 *    board   the same notes in columns by working state, drag to change it
 *
 *  The state lives in the note's own frontmatter (`status:` by default), so it
 *  survives without the plugin and any other card/list/search can use it too.
 *
 *  Why a code block and not a view: the subject page stays a real markdown
 *  file you can link to and back up — without the plugin it shows a code
 *  block, not a broken page.
 * ========================================================================== */

const { Notice, TFile, setIcon } = require('obsidian');

const OPEN = 'open';
const truthy = (v) => /^(true|yes|1|on)$/i.test(String(v).trim());

/* Working states carry meaning, so their colours are FIXED semantic slots from
   the active palette rather than hashed: red family = needs work, accent = in
   progress, green family = done. Everything the note doesn't say is "open". */
const STATE_SLOT = {
  open:       ['--text-muted', '#8a8a95'],
  doing:      ['--wl-color3', '#4a9eff'],
  fix:        ['--wl-color1', '#ff6b6b'],
  done:       ['--wl-color2', '#56d364'],
};
const DEFAULT_STATES = [
  { id: OPEN,  label: 'Offen',     kind: 'open' },
  { id: 'in-arbeit',  label: 'In Arbeit', kind: 'doing' },
  { id: 'ausbessern', label: 'Ausbessern', kind: 'fix' },
  { id: 'erledigt',   label: 'Erledigt',  kind: 'done' },
];
/* An unknown value in the frontmatter still deserves a column — losing a note
   because it says something we didn't plan for would defeat the point. */
function kindOf(id, states) {
  const hit = states.find(s => s.id === id);
  if (hit) return hit.kind;
  return /erled|done|fertig|gelernt/i.test(id) ? 'done'
    : /ausbess|fix|wiederhol|repeat/i.test(id) ? 'fix'
    : /arbeit|doing|progress|lern/i.test(id) ? 'doing' : 'open';
}
function stateVar(kind) {
  const s = STATE_SLOT[kind] || STATE_SLOT.open;
  return 'var(' + s[0] + ', ' + s[1] + ')';
}

/* ---- config: plain `key: value`, editable by hand --------------------- */
function parseBoard(src, defaults) {
  const cfg = Object.assign({
    folder: '', title: '', mode: 'grid', statusProp: 'status',
    states: DEFAULT_STATES.map(s => ({ ...s })),
    sort: 'name', dir: 'asc', size: 'medium',
    excerpt: true, tags: true, links: true, orphans: true, state: true,
    props: '', graph: false, height: 260,
  }, defaults || {});
  String(src || '').split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i < 0) return;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    const list = () => v.split(',').map(x => x.trim()).filter(Boolean);
    switch (k) {
      case 'folder': cfg.folder = v.replace(/^\/|\/$/g, ''); break;
      case 'title': cfg.title = v; break;
      case 'mode': case 'view': cfg.mode = /board|kanban|status/i.test(v) ? 'board' : 'grid'; break;
      case 'status': case 'statusproperty': cfg.statusProp = v || 'status'; break;
      case 'states': case 'columns':
        // "Offen, In Arbeit, Ausbessern, Erledigt" — the id is the slugged label
        cfg.states = list().map(label => ({
          id: label.toLowerCase().replace(/\s+/g, '-'), label, kind: kindOf(label.toLowerCase().replace(/\s+/g, '-'), []),
        }));
        if (cfg.states.length && cfg.states[0].kind !== 'open') cfg.states[0].kind = 'open';
        if (cfg.states.length) cfg.states[0].id = OPEN;   // first column = "no value set"
        break;
      case 'sort': cfg.sort = v.toLowerCase(); break;
      case 'dir': case 'direction': cfg.dir = /desc/i.test(v) ? 'desc' : 'asc'; break;
      case 'size': cfg.size = /small|large/i.test(v) ? v.toLowerCase() : 'medium'; break;
      case 'props': cfg.props = v; break;
      case 'height': cfg.height = Math.max(120, parseInt(v, 10) || 260); break;
      case 'show': {
        const on = new Set(list().map(x => x.toLowerCase()));
        ['excerpt', 'tags', 'links', 'orphans', 'state', 'graph'].forEach(f => { cfg[f] = on.has(f); });
        break;
      }
      default:
        if (['excerpt', 'tags', 'links', 'orphans', 'state', 'graph'].includes(k)) cfg[k] = truthy(v);
        break;
    }
  });
  if (!Array.isArray(cfg.states) || !cfg.states.length) cfg.states = DEFAULT_STATES.map(s => ({ ...s }));
  return cfg;
}
function stringifyBoard(cfg) {
  const out = ['folder: ' + cfg.folder];
  if (cfg.title) out.push('title: ' + cfg.title);
  out.push('mode: ' + (cfg.mode === 'board' ? 'board' : 'grid'));
  if (cfg.statusProp !== 'status') out.push('status: ' + cfg.statusProp);
  const labels = (cfg.states || []).map(s => s.label).join(', ');
  const def = DEFAULT_STATES.map(s => s.label).join(', ');
  if (labels && labels !== def) out.push('states: ' + labels);
  if (cfg.sort !== 'name') out.push('sort: ' + cfg.sort);
  if (cfg.dir !== 'asc') out.push('dir: ' + cfg.dir);
  if (cfg.size !== 'medium') out.push('size: ' + cfg.size);
  if (cfg.props) out.push('props: ' + cfg.props);
  const on = ['excerpt', 'tags', 'links', 'orphans', 'state', 'graph'].filter(f => cfg[f]);
  out.push('show: ' + (on.length ? on.join(', ') : 'none'));
  if (cfg.graph && cfg.height !== 260) out.push('height: ' + cfg.height);
  return out.join('\n');
}

class NexusBoard {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
  get s() { return this.plugin.settings.board; }

  init() {
    const p = this.plugin;
    p.registerMarkdownCodeBlockProcessor('nexus-board', (src, el, ctx) => {
      try { this.render(src, el, ctx); }
      catch (e) {
        el.empty();
        el.createDiv({ cls: 'nx-board-empty', text: 'Board: ' + e.message });
        console.error('[nexus-suite] board', e);
      }
    });
    p.addCommand({ id: 'nexus-insert-board', name: 'Insert a subject dashboard',
      editorCallback: (editor, view) => {
        const folder = view && view.file && view.file.parent ? view.file.parent.path : '';
        editor.replaceSelection('```nexus-board\nfolder: ' + folder +
          '\nmode: grid\nshow: excerpt, tags, links, state\n```\n');
      } });
    p.registerEvent(this.app.metadataCache.on('changed', () => this.refreshAll()));
    p.registerEvent(this.app.vault.on('delete', () => this.refreshAll()));
    p.registerEvent(this.app.vault.on('create', () => this.refreshAll()));
    p.registerEvent(this.app.vault.on('rename', () => this.refreshAll()));
  }
  refreshAll() {
    window.clearTimeout(this._t);
    this._t = window.setTimeout(() => {
      document.querySelectorAll('.nx-board').forEach(el => { if (el._nxRepaint) try { el._nxRepaint(); } catch (e) {} });
    }, 350);
  }

  /* ---- data -------------------------------------------------------------- */

  notesIn(cfg) {
    const root = (cfg.folder || '').replace(/^\/|\/$/g, '');
    return this.app.vault.getMarkdownFiles()
      .filter(f => !root || f.path === root + '.md' || f.path.startsWith(root + '/'));
  }
  stateOf(file, cfg) {
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    const raw = fm[cfg.statusProp];
    if (raw == null || raw === '') return OPEN;
    const id = String(Array.isArray(raw) ? raw[0] : raw).trim().toLowerCase().replace(/\s+/g, '-');
    return id || OPEN;
  }
  /* Links between the notes of THIS subject only — a link pointing outside says
     nothing about how well the subject hangs together. */
  linkMap(files) {
    const inScope = new Set(files.map(f => f.path));
    const links = this.app.metadataCache.resolvedLinks || {};
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
  sortNotes(items, cfg) {
    const dir = cfg.dir === 'desc' ? -1 : 1;
    const by = {
      name: (a, b) => a.basename.localeCompare(b.basename),
      modified: (a, b) => a.stat.mtime - b.stat.mtime,
      created: (a, b) => a.stat.ctime - b.stat.ctime,
      state: (a, b) => {
        const order = (cfg.states || []).map(s => s.id);
        const ia = order.indexOf(this.stateOf(a, cfg)), ib = order.indexOf(this.stateOf(b, cfg));
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.basename.localeCompare(b.basename);
      },
    };
    items.sort((a, b) => dir * (by[cfg.sort] || by.name)(a, b));
  }

  /* ---- render ------------------------------------------------------------ */

  render(src, el, ctx) {
    const cfg = parseBoard(src, { statusProp: (this.s && this.s.statusProperty) || 'status' });
    if (!cfg.folder) {
      const here = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
      if (here && here.parent && here.parent.path !== '/') cfg.folder = here.parent.path;
    }
    if (el._nxRO) { try { el._nxRO.disconnect(); } catch (e) {} el._nxRO = null; }
    el.empty();
    el.addClass('nx-board');
    el.toggleClass('is-sm', cfg.size === 'small');
    el.toggleClass('is-lg', cfg.size === 'large');
    el._nxRepaint = () => { try { this.render(src, el, ctx); } catch (e) {} };

    const selfPath = ctx && ctx.sourcePath;
    const notes = this.notesIn(cfg).filter(f => f.path !== selfPath);
    const links = this.linkMap(notes);

    // ── head ──
    const head = el.createDiv('nx-board-head');
    head.createDiv({ cls: 'nx-board-title', text: cfg.title || (cfg.folder ? cfg.folder.split('/').pop() : 'Board') });

    // Counts per state — the overview line that says where the subject stands.
    if (cfg.state) {
      const tally = head.createDiv('nx-board-tally');
      const counts = new Map();
      notes.forEach(f => { const s = this.stateOf(f, cfg); counts.set(s, (counts.get(s) || 0) + 1); });
      (cfg.states || []).forEach(st => {
        const n = counts.get(st.id) || 0;
        if (!n) return;
        const chip = tally.createSpan('nx-board-tally-chip');
        chip.style.setProperty('--nx-state', stateVar(st.kind));
        chip.createSpan({ cls: 'nx-board-tally-dot' });
        chip.createSpan({ text: n + ' ' + st.label });
      });
    }
    head.createDiv({ cls: 'nx-board-count', text: String(notes.length) + (notes.length === 1 ? ' note' : ' notes') });

    const tools = head.createDiv('nx-board-tools');
    const modeBtn = (id, icon, label) => {
      const b = tools.createDiv('nx-board-modebtn' + (cfg.mode === id ? ' is-active' : ''));
      setIcon(b, icon);
      b.setAttribute('aria-label', label);
      b.onclick = () => this.writeBack(el, ctx, Object.assign({}, cfg, { mode: id }));
      return b;
    };
    modeBtn('grid', 'layout-grid', 'All notes as a grid');
    modeBtn('board', 'columns-3', 'Columns by working state');
    const search = tools.createEl('input', { cls: 'nx-board-search', attr: { type: 'text', placeholder: 'filter …' } });
    const gear = tools.createDiv('nx-board-gear');
    setIcon(gear, 'settings-2');
    gear.setAttribute('aria-label', 'Board settings');
    gear.onclick = () => {
      const { NexusBoardConfigModal } = require('../modals/board.js');
      new NexusBoardConfigModal(this.plugin, cfg, (next) => this.writeBack(el, ctx, next)).open();
    };

    const body = el.createDiv('nx-board-body');
    if (!notes.length) {
      body.createDiv({ cls: 'nx-board-empty',
        text: cfg.folder ? 'No notes in "' + cfg.folder + '" yet.' : 'Set a folder in the settings.' });
    } else if (cfg.mode === 'board') {
      this.renderColumns(body, notes, cfg, links);
    } else {
      this.renderGrid(body, notes, cfg, links);
    }

    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      el.querySelectorAll('.nx-board-card').forEach(c => {
        c.toggleClass('is-filtered', !!q && !(c.dataset.hay || '').includes(q));
      });
      el.querySelectorAll('.nx-board-group').forEach(g => {
        g.toggleClass('is-empty', !g.querySelector('.nx-board-card:not(.is-filtered)'));
      });
    };

    if (cfg.excerpt) this.fillExcerpts(notes, el);
    if (cfg.graph && notes.length) this.graph(el, notes, links, cfg);
  }

  /* Every note, once, in a plain sorted grid. Nothing hidden, nothing grouped
     away — this is the view that answers "what is in this subject". */
  renderGrid(body, notes, cfg, links) {
    const items = notes.slice();
    this.sortNotes(items, cfg);
    const grid = body.createDiv('nx-board-grid');
    items.forEach(f => this.card(grid, f, cfg, links));
  }

  /* The same notes, arranged by working state. Exactly one column each, so the
     total still matches the grid. */
  renderColumns(body, notes, cfg, links) {
    const states = cfg.states || DEFAULT_STATES;
    const known = new Set(states.map(s => s.id));
    const buckets = new Map(states.map(s => [s.id, []]));
    const extra = new Map();
    notes.forEach(f => {
      const id = this.stateOf(f, cfg);
      if (known.has(id)) buckets.get(id).push(f);
      else { if (!extra.has(id)) extra.set(id, []); extra.get(id).push(f); }
    });
    const cols = states.map(s => ({ ...s, items: buckets.get(s.id) }))
      // A value the states list doesn't know still gets a column — dropping it
      // would silently hide notes, which is the one thing this must not do.
      .concat([...extra.entries()].map(([id, items]) => ({ id, label: id, kind: kindOf(id, states), items })));

    const wrap = body.createDiv('nx-board-cols');
    cols.forEach(col => {
      const c = wrap.createDiv('nx-board-col');
      c.dataset.state = col.id;
      c.style.setProperty('--nx-state', stateVar(col.kind));
      const ch = c.createDiv('nx-board-col-head');
      ch.createDiv('nx-board-col-dot');
      ch.createDiv({ cls: 'nx-board-col-name', text: col.label });
      ch.createDiv({ cls: 'nx-board-col-count', text: String(col.items.length) });
      const list = c.createDiv('nx-board-list');
      this.sortNotes(col.items, cfg);
      col.items.forEach(f => this.card(list, f, cfg, links));
      if (!col.items.length) list.createDiv({ cls: 'nx-board-drop-hint', text: 'drop a note here' });
    });
  }

  card(parent, file, cfg, links) {
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const stateId = this.stateOf(file, cfg);
    const kind = kindOf(stateId, cfg.states);
    const card = parent.createDiv('nx-board-card');
    card.dataset.path = file.path;
    card.dataset.state = stateId;
    card.style.setProperty('--nx-state', stateVar(kind));
    if (kind !== 'open') card.addClass('has-state');

    const top = card.createDiv('nx-board-card-top');
    if (cfg.state) {
      // Click the dot to walk through the states — no menu for the common move.
      const dot = top.createDiv('nx-board-card-dot');
      const label = (cfg.states.find(s => s.id === stateId) || {}).label || stateId;
      dot.setAttribute('aria-label', label + ' — click for the next state');
      dot.onclick = async (e) => {
        e.stopPropagation();
        const ids = (cfg.states || []).map(s => s.id);
        const i = ids.indexOf(stateId);
        const next = ids[(i + 1) % Math.max(1, ids.length)];
        await this.setState(file, next, cfg);
        this.refreshAll();
      };
    }
    top.createDiv({ cls: 'nx-board-card-title', text: file.basename });

    if (cfg.excerpt) card.createDiv({ cls: 'nx-board-card-excerpt' });

    const foot = card.createDiv('nx-board-card-foot');
    if (cfg.tags) {
      const tags = [];
      const fm = (cache.frontmatter || {}).tags;
      if (typeof fm === 'string') tags.push(...fm.split(/[,\s]+/));
      else if (Array.isArray(fm)) tags.push(...fm.map(String));
      (cache.tags || []).forEach(t => tags.push(t.tag));
      [...new Set(tags.map(t => String(t).replace(/^#/, '')).filter(Boolean))].slice(0, 3)
        .forEach(t => foot.createSpan({ cls: 'nx-board-tag', text: '#' + t }));
    }
    if (cfg.props) {
      const fm = cache.frontmatter || {};
      cfg.props.split(',').map(x => x.trim()).filter(Boolean).forEach(key => {
        const v = fm[key];
        if (v == null || v === '') return;
        foot.createSpan({ cls: 'nx-board-prop', text: String(Array.isArray(v) ? v.join(', ') : v) });
      });
    }
    const n = (links.get(file.path) || new Set()).size;
    if (cfg.links) {
      const b = foot.createSpan({ cls: 'nx-board-links' + (n ? '' : ' is-none') });
      setIcon(b, 'link');
      b.createSpan({ text: String(n) });
      b.setAttribute('aria-label', n + ' link(s) inside this subject');
    }
    if (cfg.orphans && !n) card.addClass('is-orphan');

    card.dataset.hay = (file.basename + ' ' + (foot.textContent || '')).toLowerCase();
    card.onclick = (e) => {
      if (card.hasClass('is-dragging')) return;
      this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(file);
    };
    card.oncontextmenu = (e) => { e.preventDefault(); this.cardMenu(e, file, cfg, stateId); };
    if (cfg.links) {
      card.addEventListener('pointerenter', () => this.highlight(card, file, links, true));
      card.addEventListener('pointerleave', () => this.highlight(card, file, links, false));
    }
    if (cfg.mode === 'board') this.dragSource(card, file, cfg);
    return card;
  }

  highlight(card, file, links, on) {
    const board = card.closest('.nx-board');
    if (!board) return;
    board.toggleClass('is-linking', on);
    if (!on) { board.querySelectorAll('.is-linked').forEach(c => c.removeClass('is-linked')); return; }
    const rel = links.get(file.path) || new Set();
    board.querySelectorAll('.nx-board-card').forEach(c => {
      c.toggleClass('is-linked', c.dataset.path === file.path || rel.has(c.dataset.path));
    });
    const g = board.querySelector('.nx-board-graph');
    if (g && g._nxHighlight) g._nxHighlight(file.path, rel);
  }

  async fillExcerpts(notes, el) {
    for (const f of notes) {
      const cards = el.querySelectorAll('.nx-board-card[data-path="' + CSS.escape(f.path) + '"]');
      if (!cards.length) continue;
      let text = '';
      try {
        const raw = await this.app.vault.cachedRead(f);
        text = raw.replace(/^---\n[\s\S]*?\n---\n?/, '')
          .split('\n').map(l => l.trim())
          .find(l => l && !/^[#>\-*=`|]/.test(l)) || '';
      } catch (e) {}
      cards.forEach(c => {
        const box = c.querySelector('.nx-board-card-excerpt');
        if (!box) return;
        if (text) { box.setText(text.slice(0, 160)); c.dataset.hay = (c.dataset.hay || '') + ' ' + text.toLowerCase(); }
        else box.remove();
      });
    }
  }

  /* ---- working state ------------------------------------------------------ */

  async setState(file, stateId, cfg) {
    await this.app.fileManager.processFrontMatter(file, fm => {
      // "open" is the absence of a value — writing it would litter every note
      // with status: open for no gain.
      if (!stateId || stateId === OPEN) delete fm[cfg.statusProp];
      else fm[cfg.statusProp] = (cfg.states.find(s => s.id === stateId) || {}).label || stateId;
    });
  }

  cardMenu(evt, file, cfg, stateId) {
    const { NexusPopupMenu } = require('../modals/pickers.js');
    const menu = new NexusPopupMenu(this.app, file.basename);
    menu.addItem(i => i.setTitle('Open').setIcon('file-text')
      .onClick(() => this.app.workspace.getLeaf(false).openFile(file)));
    menu.addItem(i => i.setTitle('Open in a new tab').setIcon('layout')
      .onClick(() => this.app.workspace.getLeaf('tab').openFile(file)));
    menu.addSeparator();
    (cfg.states || []).forEach(st => {
      const cur = st.id === stateId;
      menu.addItem(i => {
        i.setTitle(st.label).setIcon(cur ? 'check' : 'circle').setChecked(cur).setDisabled(cur);
        if (!cur) i.onClick(async () => { await this.setState(file, st.id, cfg); this.refreshAll(); });
      });
    });
    menu.showAtMouseEvent(evt);
  }

  /* Pointer-based drag — a finger on the tablet cannot use HTML5 drag & drop. */
  dragSource(card, file, cfg) {
    card.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button > 0) return;
      const startX = e.clientX, startY = e.clientY;
      let ghost = null, moved = false;
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
        if (!moved) {
          moved = true;
          card.addClass('is-dragging');
          ghost = document.body.createDiv('nx-board-ghost');
          ghost.setText(file.basename);
        }
        ghost.style.left = ev.clientX + 12 + 'px';
        ghost.style.top = ev.clientY + 12 + 'px';
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = under && under.closest ? under.closest('.nx-board-col') : null;
        document.querySelectorAll('.nx-board-col.is-over').forEach(c => c.removeClass('is-over'));
        if (target) target.addClass('is-over');
      };
      const up = async (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (ghost) ghost.remove();
        document.querySelectorAll('.nx-board-col.is-over').forEach(c => c.removeClass('is-over'));
        if (!moved) { card.removeClass('is-dragging'); return; }
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = under && under.closest ? under.closest('.nx-board-col') : null;
        const to = target ? target.dataset.state : null;
        window.setTimeout(() => card.removeClass('is-dragging'), 0);
        if (to && to !== card.dataset.state) {
          await this.setState(file, to, cfg);
          this.refreshAll();
        }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  /* ---- graph (optional) --------------------------------------------------- */
  graph(el, notes, links, cfg) {
    const wrap = el.createDiv('nx-board-graph');
    const nodes = notes.map(f => ({ f, path: f.path, x: 0, y: 0, vx: 0, vy: 0, deg: (links.get(f.path) || new Set()).size }));
    const byPath = new Map(nodes.map(n => [n.path, n]));
    const edges = [];
    const seen = new Set();
    for (const [src, set] of links) {
      for (const dest of set) {
        const key = src < dest ? src + '|' + dest : dest + '|' + src;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = byPath.get(src), b = byPath.get(dest);
        if (a && b) edges.push([a, b]);
      }
    }
    const canvas = wrap.createEl('canvas');
    let W = 0, H = cfg.height || 260, hi = null, hiSet = new Set();
    const css = (name, fb) => (getComputedStyle(el).getPropertyValue(name).trim() || fb);
    nodes.forEach(n => {
      const k = kindOf(this.stateOf(n.f, cfg), cfg.states);
      const slot = STATE_SLOT[k] || STATE_SLOT.open;
      n.color = css(slot[0], slot[1]);
    });
    const layout = () => {
      W = wrap.clientWidth || 600;
      const R = Math.min(W, H) * 0.38;
      nodes.forEach((n, i) => {
        const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        n.x = W / 2 + Math.cos(a) * R; n.y = H / 2 + Math.sin(a) * R; n.vx = n.vy = 0;
      });
      for (let step = 0; step < 240; step++) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
            const d = Math.sqrt(d2), f = 900 / d2;
            a.vx -= f * dx / d; a.vy -= f * dy / d;
            b.vx += f * dx / d; b.vy += f * dy / d;
          }
        }
        edges.forEach(([a, b]) => {
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy)), f = (d - 62) * 0.02;
          a.vx += f * dx / d; a.vy += f * dy / d;
          b.vx -= f * dx / d; b.vy -= f * dy / d;
        });
        nodes.forEach(n => {
          n.vx += (W / 2 - n.x) * 0.008; n.vy += (H / 2 - n.y) * 0.008;
          n.x += n.vx *= 0.72; n.y += n.vy *= 0.72;
          n.x = Math.max(14, Math.min(W - 14, n.x));
          n.y = Math.max(14, Math.min(H - 14, n.y));
        });
      }
    };
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const line = css('--nx-board-edge', 'rgba(150,150,160,.35)');
      edges.forEach(([a, b]) => {
        const lit = hi && (a.path === hi || b.path === hi);
        c.strokeStyle = lit ? (a.path === hi ? a.color : b.color) : line;
        c.globalAlpha = hi ? (lit ? .9 : .1) : .4;
        c.lineWidth = lit ? 1.6 : 1;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      });
      nodes.forEach(n => {
        const lit = !hi || n.path === hi || hiSet.has(n.path);
        const r = 3.5 + Math.min(5, n.deg * 0.9);
        c.fillStyle = n.color;
        c.globalAlpha = lit ? 1 : .15;
        c.beginPath(); c.arc(n.x, n.y, r, 0, Math.PI * 2); c.fill();
        if (n.deg === 0) { c.strokeStyle = n.color; c.globalAlpha = lit ? .5 : .12; c.lineWidth = 1;
          c.beginPath(); c.arc(n.x, n.y, r + 2.5, 0, Math.PI * 2); c.stroke(); }
      });
      c.globalAlpha = 1;
    };
    const nodeAt = (x, y) => {
      let best = null, bd = 196;
      nodes.forEach(n => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = n; } });
      return best;
    };
    const label = wrap.createDiv('nx-board-graph-label');
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      const path = n ? n.path : null;
      if (path === hi) return;
      hi = path; hiSet = path ? (links.get(path) || new Set()) : new Set();
      canvas.style.cursor = path ? 'pointer' : 'default';
      label.setText(n ? n.f.basename + ' · ' + n.deg + ' link(s)' : '');
      el.toggleClass('is-linking', !!path);
      el.querySelectorAll('.nx-board-card').forEach(cd => {
        cd.toggleClass('is-linked', !!path && (cd.dataset.path === path || hiSet.has(cd.dataset.path)));
      });
      draw();
    });
    canvas.addEventListener('pointerleave', () => {
      hi = null; hiSet = new Set(); label.setText('');
      el.removeClass('is-linking');
      el.querySelectorAll('.is-linked').forEach(c => c.removeClass('is-linked'));
      draw();
    });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (n) this.app.workspace.getLeaf(false).openFile(n.f);
    });
    wrap._nxHighlight = (path, rel) => { hi = path; hiSet = rel || new Set(); draw(); };
    window.requestAnimationFrame(() => { layout(); draw(); });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (Math.abs((wrap.clientWidth || 0) - W) < 20) return;
        layout(); draw();
      });
      ro.observe(wrap);
      el._nxRO = ro;
    }
  }

  /* ---- config back into the code block ------------------------------------ */
  async writeBack(el, ctx, cfg) {
    const info = ctx && ctx.getSectionInfo ? ctx.getSectionInfo(el) : null;
    const file = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    if (!info || !(file instanceof TFile)) { new Notice('Nexus: could not locate the board block.'); return; }
    const lines = (await this.app.vault.read(file)).split('\n');
    const body = stringifyBoard(cfg).split('\n');
    lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...body);
    await this.app.vault.modify(file, lines.join('\n'));
  }
}

module.exports = { NexusBoard, parseBoard, stringifyBoard, DEFAULT_STATES, kindOf, OPEN };
