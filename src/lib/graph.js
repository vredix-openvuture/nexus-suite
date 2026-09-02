'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the folder web
 *  A ```nexus-graph``` block shows the same notes a folder board shows, but
 *  arranged by what they are rather than by where they stand:
 *
 *      view: graph   the notes as nodes, the links between them as edges
 *      view: grid    every note once, as a sorted wall of cards
 *
 *  Both were modes of the old ```nexus-board```. They are not a kanban board —
 *  neither has columns and neither writes anything back into a note — so they
 *  live here instead of inside the board that does. The force layout is also
 *  the starting point for the vault-wide galaxy map.
 *
 *  Cards, columns and the config are kanban's; this file adds the two
 *  arrangements and nothing else.
 * ========================================================================== */

const { setIcon } = require('obsidian');
const { KIND_SLOT } = require('./kanbanblock.js');
const { cardFrame } = require('./kanban.js');
const folder = require('./board.js');

/* ---- the block ------------------------------------------------------------ */

function render(mod, src, cfg, el, ctx, opts) {
  const app = mod.app;
  if (el._nxRO) { try { el._nxRO.disconnect(); } catch (e) {} el._nxRO = null; }
  el.empty();
  // The view buttons re-render the same element as the column board, so the
  // classes that board set have to go with it.
  el.removeClass('nx-kb'); el.removeClass('is-folder'); el.removeClass('is-compact');
  el.addClass('nx-graph');
  el.toggleClass('is-sm', cfg.size === 'small');
  el.toggleClass('is-lg', cfg.size === 'large');
  el._nxSrc = src;
  el._nxFence = (opts && opts.fence) || 'nexus-graph';
  el._nxRepaint = (next) => {
    try { mod.render(next != null ? next : src, el, ctx, opts); }
    catch (e) { console.error('[nexus-suite] ' + el._nxFence + ' repaint', ctx && ctx.sourcePath, e); }
  };

  const source = folder.folderSource(mod, cfg, el, ctx);
  const cols = source.columns();
  const notes = [].concat(...cols.map(c => c.items));

  const head = el.createDiv('nx-kb-head');

  head.createDiv({ cls: 'nx-kb-title', text: cfg.title || (source.root ? source.root.split('/').pop() : 'Folder') });
  if (source.head) source.head(head, cols);
  head.createDiv({ cls: 'nx-kb-count', text: source.total() });

  const tools = head.createDiv('nx-kb-tools');
  /* The three arrangements of one set of notes, switchable from the block —
     writing the choice back into the fence, because the fence is the config. */
  [['grid', 'layout-grid', 'Every note as a card'],
   ['board', 'columns-3', 'Columns by working state'],
   ['graph', 'git-fork', 'The links between them']].forEach(([id, icon, label]) => {
    const b = tools.createDiv('nx-kb-tool' + (cfg.mode === id ? ' is-active' : ''));
    setIcon(b, icon);
    b.setAttribute('aria-label', label);
    b.onclick = () => mod.save(el, ctx, Object.assign({}, cfg, {
      mode: id,
      // Picking a view is the user saying which one — from here the block says
      // it too, even if it never carried the line before.
      given: Object.assign({}, cfg.given, { mode: (cfg.given && cfg.given.mode) || 'view' }),
    }));
  });
  if (source.tools) source.tools(tools, { filter: cfg.mode !== 'graph' });

  if (!notes.length) {
    el.createDiv({ cls: 'nx-kb-empty',
      text: source.root ? 'No notes in "' + source.root + '" yet.' : 'Set a folder in the settings.' });
    return;
  }

  if (cfg.mode !== 'graph') {
    const grid = el.createDiv('nx-graph-grid');
    const order = cols.map(c => c.id);
    const colOf = new Map();
    cols.forEach(c => c.items.forEach(f => colOf.set(f.path, c)));
    folder.sortNotes(app, notes, cfg, order).forEach(f => {
      const col = colOf.get(f.path) || cols[0];
      const frame = cardFrame(grid, source.view(f, col));
      source.fill(frame, f, 0, 0, col);
      if (!frame.meta.childElementCount) frame.meta.remove();
    });
    if (cfg.excerpt !== false) folder.fillExcerpts(app, notes, el);
  }
  if (cfg.mode === 'graph' || cfg.graph) {
    const links = folder.linkMap(app, notes);
    graphInto(app, el, notes, links, cfg, (f) => folder.bucketKindOfNote(app, f, cfg, cols));
  }
}

/* ---- the force layout ----------------------------------------------------- */

/* Laid out once and drawn to a canvas by hand: a few hundred nodes of a folder
   need no animation loop, and a static picture costs nothing on the tablet. */
function graphInto(app, el, notes, links, cfg, kindOf) {
  const wrap = el.createDiv('nx-graph-canvas');
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
    const slot = KIND_SLOT[kindOf(n.f)] || KIND_SLOT.open;
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
    const line = css('--nx-graph-edge', 'rgba(150,150,160,.35)');
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
      // A note nothing links to gets a ring, so an orphan is visible without
      // counting edges.
      if (n.deg === 0) {
        c.strokeStyle = n.color; c.globalAlpha = lit ? .5 : .12; c.lineWidth = 1;
        c.beginPath(); c.arc(n.x, n.y, r + 2.5, 0, Math.PI * 2); c.stroke();
      }
    });
    c.globalAlpha = 1;
  };
  const nodeAt = (x, y) => {
    let best = null, bd = 196;
    nodes.forEach(n => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = n; } });
    return best;
  };
  const label = wrap.createDiv('nx-graph-label');
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
    const path = n ? n.path : null;
    if (path === hi) return;
    hi = path; hiSet = path ? (links.get(path) || new Set()) : new Set();
    canvas.style.cursor = path ? 'pointer' : 'default';
    label.setText(n ? n.f.basename + ' · ' + n.deg + ' link(s)' : '');
    el.toggleClass('is-linking', !!path);
    el.querySelectorAll('.nx-kb-card').forEach(cd => {
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
    if (n) app.workspace.getLeaf(false).openFile(n.f);
  });
  wrap._nxHighlight = (path, rel) => { hi = path; hiSet = rel || new Set(); draw(); };
  window.requestAnimationFrame(() => { layout(); draw(); });
  if (window.ResizeObserver) {
    // Only a real width change is worth a relayout — a scrollbar appearing is not.
    const ro = new ResizeObserver(() => {
      if (Math.abs((wrap.clientWidth || 0) - W) < 20) return;
      layout(); draw();
    });
    ro.observe(wrap);
    el._nxRO = ro;
  }
  return wrap;
}

module.exports = { render, graphInto };
