'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · the galaxy map
 *
 *  The vault as a map of stars: every note a point, every link a line, laid
 *  out in three dimensions by lib/force3d.js and drawn to an ordinary 2D
 *  canvas by hand — no library, no bundle growth (decision 7).
 *
 *  Obsidian's own graph view is a closed core plugin: it cannot be extended,
 *  read or drawn into. This is a second view, with the 2D/3D switch on it.
 *
 *  Depth is made of four things and none of them is a glow: the perspective
 *  divide, so a nearer note is genuinely larger; the painter's algorithm, so
 *  what is in front covers what is behind; a fade towards the ground colour,
 *  so the far side recedes instead of cluttering; and links drawn first and
 *  fainter than the notes they join.
 *
 *  The idle drift and the 2D/3D tween are the one place in this codebase with
 *  decorative motion. The style guide bans it and the user asked for exactly
 *  this — a galaxy you can turn in your hands — so the override is deliberate
 *  and it is confined to this view. prefers-reduced-motion switches both off.
 * ========================================================================== */

const { ItemView, setIcon } = require('obsidian');
const { GALAXY_VIEW, NX_MODULES } = require('../constants.js');
const f3 = require('../lib/force3d.js');

const DRIFT = 0.0011;      // radians of yaw per frame when nothing is touching it
const ORBIT = 0.006;       // radians per pixel dragged
const SPIN_DECAY = 0.94;   // how quickly a flick runs out
const HIT = 16;            // px around a note that count as pointing at it
const NAMES = 7;           // how many hubs carry their name on the map

const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/* Colours are read off the page, never written here — see readColours. */
const toRgb = (s) => { const m = String(s).match(/-?\d*\.?\d+/g) || []; return [+m[0] || 0, +m[1] || 0, +m[2] || 0]; };
const blend = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';

class NexusGalaxyView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.cam = { yaw: 0.6, pitch: -0.32, distance: 900, zoom: 0, flatten: 0 };
    this.spin = { yaw: 0, pitch: 0 };
    this.pan = { x: 0, y: 0 };
    this.pointers = new Map();
    this.userZoom = 1;
    this.flatTarget = 0;
    this.hover = null;
    this.pts = [];
    this.W = 0; this.H = 0;
    this.tick = this.tick.bind(this);
  }
  getViewType() { return GALAXY_VIEW; }
  getDisplayText() { return NX_MODULES.galaxy.name; }
  getIcon() { return 'orbit'; }

  async onOpen() {
    this.build();
    this.reload();
    // The link map is only correct once Obsidian has resolved it, and it moves
    // again on every edit — but a rebuild throws the layout away, so reload()
    // compares a signature and does nothing when nothing actually changed.
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.reload()));
    this.registerEvent(this.app.workspace.on('css-change', () => { this.readColours(); this.wake(); }));
  }
  onClose() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    return Promise.resolve();
  }

  get settings() { return this.plugin.settings.galaxy || {}; }

  /* ---- the frame ---------------------------------------------------------- */
  build() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nx-galaxy');
    const bar = root.createDiv('nx-galaxy-bar');
    this.modes = {};
    [['3d', '3D', 'Turn it'], ['2d', '2D', 'Lay it flat']].forEach(([id, text, tip]) => {
      const b = bar.createEl('button', { cls: 'nx-btn is-sm', text: text });
      b.setAttribute('aria-label', tip);
      b.onclick = () => this.setMode(id);
      this.modes[id] = b;
    });
    this.count = bar.createDiv('nx-galaxy-count');
    const reset = bar.createEl('button', { cls: 'nx-btn is-sm is-icon is-quiet' });
    setIcon(reset, 'locate-fixed');
    reset.setAttribute('aria-label', 'Back to the starting view');
    reset.onclick = () => {
      this.cam.yaw = 0.6; this.cam.pitch = -0.32;
      this.pan.x = this.pan.y = 0; this.userZoom = 1;
      this.spin.yaw = this.spin.pitch = 0;
      this.wake();
    };

    this.stage = root.createDiv('nx-galaxy-stage');
    this.canvas = this.stage.createEl('canvas');
    this.label = this.stage.createDiv('nx-galaxy-label');
    this.probe = this.stage.createDiv('nx-galaxy-probe');
    this.readColours();
    this.bindPointer();
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this.stage);
    }
    window.requestAnimationFrame(() => this.resize());
    this.setMode('3d');
  }

  /* The palette is the theme's, so it is read off a probe element rather than
     named here: a custom property computes to its own token text, but `color`
     always computes to an rgb() the canvas can use. */
  readColours() {
    const read = (name) => {
      this.probe.style.color = 'var(' + name + ')';
      return toRgb(getComputedStyle(this.probe).color);
    };
    this.col = {
      ground: read('--nx-gx-ground'), star: read('--nx-gx-star'),
      hub: read('--nx-gx-hub'), link: read('--nx-gx-link'), lit: read('--nx-gx-lit'),
    };
    this.face = getComputedStyle(this.stage).fontFamily || 'sans-serif';
  }

  resize() {
    if (!this.stage) return;
    const W = Math.round(this.stage.clientWidth) || 600;
    const H = Math.round(this.stage.clientHeight) || 400;
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
    this.ctx = this.canvas.getContext('2d');
    this.wake();
  }

  setMode(id) {
    this.flatTarget = id === '2d' ? 1 : 0;
    Object.keys(this.modes).forEach(k => this.modes[k].toggleClass('is-on', k === id));
    this.wake();
  }

  /* ---- the vault ---------------------------------------------------------- */
  reload() {
    const app = this.app;
    const files = app.vault.getMarkdownFiles();
    const resolved = app.metadataCache.resolvedLinks || {};
    const inScope = new Set(files.map(f => f.path));
    const links = [];
    Object.keys(resolved).forEach(src => {
      if (!inScope.has(src)) return;
      Object.keys(resolved[src] || {}).forEach(dest => {
        if (dest !== src && inScope.has(dest)) links.push([src, dest]);
      });
    });
    const s = this.settings;
    let notes = files;
    if (s.showOrphans === false) {
      const linked = new Set();
      links.forEach(l => { linked.add(l[0]); linked.add(l[1]); });
      notes = files.filter(f => linked.has(f.path));
    }
    const sig = notes.length + '/' + links.length + '/' + (s.linkDistance || 60);
    if (sig === this._sig && this.sim) return;
    this._sig = sig;

    this.files = new Map(notes.map(f => [f.path, f]));
    this.sim = f3.createLayout(
      { nodes: notes.map(f => ({ id: f.path })), links },
      { seed: 20260901, linkDistance: clamp(s.linkDistance || 60, 20, 200),
        // A big vault pays O(n²) per step, so it gets fewer of them rather
        // than a slower unfold — see the cost note in lib/force3d.js.
        maxSteps: notes.length > 900 ? 220 : 600 });
    this.neighbours = new Map();
    this.sim.edges.forEach(([a, b]) => {
      const ia = this.sim.nodes[a].id, ib = this.sim.nodes[b].id;
      if (!this.neighbours.has(ia)) this.neighbours.set(ia, new Set());
      if (!this.neighbours.has(ib)) this.neighbours.set(ib, new Set());
      this.neighbours.get(ia).add(ib); this.neighbours.get(ib).add(ia);
    });
    this.maxDeg = 1;
    this.sim.nodes.forEach(n => { if (n.deg > this.maxDeg) this.maxDeg = n.deg; });
    this.hubs = new Set(this.sim.nodes.slice().sort((a, b) => b.deg - a.deg).slice(0, NAMES)
      .filter(n => n.deg > 1).map(n => n.id));
    this.cam.zoom = 0;
    this.hover = null;
    if (this.count) this.count.setText(notes.length + ' notes · ' + this.sim.edges.length + ' links');
    this.wake();
  }

  /* ---- the loop ----------------------------------------------------------- */
  wake() { if (!this._raf) this._raf = window.requestAnimationFrame(this.tick); }
  tick() {
    this._raf = 0;
    if (!this.sim || !this.W) return;
    if (this.frame()) this._raf = window.requestAnimationFrame(this.tick);
  }
  frame() {
    const cam = this.cam, sim = this.sim, still = reduced();
    let busy = false;
    if (!sim.settled && !document.hidden) {
      // Stepped in the frame loop rather than up front, because watching the
      // vault unfold is half of what the user asked for.
      const n = sim.nodes.length;
      sim.run(n > 600 ? 1 : n > 250 ? 3 : 6);
      busy = true;
    }
    if (this.dragging) busy = true;
    else if (Math.abs(this.spin.yaw) > 2e-4 || Math.abs(this.spin.pitch) > 2e-4) {
      cam.yaw += this.spin.yaw; cam.pitch += this.spin.pitch;
      this.spin.yaw *= SPIN_DECAY; this.spin.pitch *= SPIN_DECAY;
      busy = true;
    } else if (!still && this.settings.drift !== false && cam.flatten < 0.5) {
      cam.yaw += DRIFT; busy = true;
    }
    cam.pitch = clamp(cam.pitch, -1.3, 1.3);
    if (cam.flatten !== this.flatTarget) {
      const step = still ? 1 : 0.045;
      cam.flatten += clamp(this.flatTarget - cam.flatten, -step, step);
      if (Math.abs(this.flatTarget - cam.flatten) < 0.004) cam.flatten = this.flatTarget;
      busy = true;
    }
    const want = f3.fitZoom(sim.radius(), this.W, this.H) * this.userZoom;
    if (!(cam.zoom > 0)) cam.zoom = want;
    else if (Math.abs(want - cam.zoom) > 5e-4) { cam.zoom += (want - cam.zoom) * 0.12; busy = true; }
    this.draw();
    return busy;
  }

  /* ---- the picture -------------------------------------------------------- */
  draw() {
    const c = this.ctx, W = this.W, H = this.H, col = this.col, sim = this.sim;
    if (!c || !W || !col) return;
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = css(col.ground);
    c.fillRect(0, 0, W, H);
    c.translate(this.pan.x, this.pan.y);

    const R = sim.radius() || 1;
    const solid = 1 - this.cam.flatten;     // laid flat there is no depth left to fade
    const pts = [];
    for (let i = 0; i < sim.nodes.length; i++) {
      const p = f3.project(sim.nodes[i], this.cam, W, H);
      p.n = sim.nodes[i];
      p.fog = f3.depthFade(p.z, R) * solid * 0.86;
      pts.push(p);
    }
    this.pts = pts;
    const hi = this.hover, near = hi ? this.neighbours.get(hi) : null;

    c.lineWidth = 1;
    for (let e = 0; e < sim.edges.length; e++) {
      const a = pts[sim.edges[e][0]], b = pts[sim.edges[e][1]];
      const lit = hi && (a.n.id === hi || b.n.id === hi);
      const fog = (a.fog + b.fog) / 2;
      c.globalAlpha = hi ? (lit ? 0.8 : 0.05) : 0.3 * (1 - fog * 0.55);
      c.strokeStyle = css(blend(lit ? col.lit : col.link, col.ground, fog));
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }

    const order = f3.sortByDepth(pts.slice());
    const scale = clamp(this.cam.zoom, 0.55, 1.5);
    c.globalAlpha = 1;
    for (let i = 0; i < order.length; i++) {
      const p = order[i], n = p.n;
      const weight = Math.sqrt(n.deg / this.maxDeg);   // hubs read as hubs
      let tone = blend(col.star, col.hub, weight);
      let fog = p.fog;
      if (hi) {
        if (n.id === hi) { tone = col.lit; fog = 0; }
        else if (near && near.has(n.id)) { tone = blend(tone, col.lit, 0.55); fog = Math.min(fog, 0.15); }
        else fog = Math.max(fog, 0.82);
      }
      c.fillStyle = css(blend(tone, col.ground, fog));
      c.beginPath();
      c.arc(p.x, p.y, Math.max(0.7, (1.9 + weight * 5.4) * p.k * scale), 0, Math.PI * 2);
      c.fill();
    }
    this.names(c, order, hi, near);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* A handful of names, so the thing reads as a map of somewhere rather than
     as a cloud of dots. Only the hubs, only the near half, and faded with the
     depth like everything else. */
  names(c, order, hi, near) {
    const col = this.col;
    c.font = '11px ' + this.face;
    c.textBaseline = 'middle';
    for (let i = 0; i < order.length; i++) {
      const p = order[i], id = p.n.id;
      const isHover = hi === id, isNear = hi && near && near.has(id);
      if (!isHover && !isNear && !(this.hubs.has(id) && p.fog < 0.42 && !hi)) continue;
      const file = this.files.get(id);
      if (!file) continue;
      const fade = isHover ? 0 : Math.min(0.72, p.fog + 0.12);
      c.fillStyle = css(blend(isHover || isNear ? col.lit : col.star, col.ground, fade));
      c.fillText(file.basename, p.x + 9 * p.k, p.y);
    }
  }

  /* ---- pointing at it ----------------------------------------------------- */
  nodeAt(x, y) {
    let best = null, bd = HIT * HIT;
    const px = x - this.pan.x, py = y - this.pan.y;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i];
      const d = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  setHover(p) {
    const id = p ? p.n.id : null;
    if (id === this.hover) return;
    this.hover = id;
    const file = id ? this.files.get(id) : null;
    this.label.setText(file ? file.basename + ' · ' + (p.n.deg || 0) + ' links' : '');
    this.canvas.style.cursor = id ? 'pointer' : 'grab';
    this.wake();
  }
  open(p) {
    const file = this.files.get(p.n.id);
    if (file) this.app.workspace.getLeaf(false).openFile(file);
  }
  spread() {
    const p = Array.from(this.pointers.values());
    if (p.length < 2) return 0;
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  /* Pointer events, not mouse events: this vault is read on a tablet, and a
     pen has to orbit the map exactly like a mouse does. */
  bindPointer() {
    const el = this.canvas;
    const at = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.registerDomEvent(el, 'pointerdown', (e) => {
      e.preventDefault();               // a drag must not start a text selection
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      this.pointers.set(e.pointerId, at(e));
      if (this.pointers.size === 1) {
        const p = at(e);
        this.dragging = { x: p.x, y: p.y, moved: 0, t: Date.now() };
        this.spin.yaw = this.spin.pitch = 0;
      } else if (this.pointers.size === 2) { this.dragging = null; this.pinch = this.spread(); }
      this.wake();
    });
    this.registerDomEvent(el, 'pointermove', (e) => {
      const p = at(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        const now = this.spread();
        if (now > 0 && this.pinch > 0) { this.userZoom = clamp(this.userZoom * (now / this.pinch), 0.3, 4); this.pinch = now; this.wake(); }
        return;
      }
      const d = this.dragging;
      if (!d) { this.setHover(this.nodeAt(p.x, p.y)); return; }
      const dx = p.x - d.x, dy = p.y - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = p.x; d.y = p.y;
      // Turning in 3D and panning in 2D are the same gesture; the dial decides
      // which of the two it currently is.
      const turn = 1 - this.cam.flatten;
      this.cam.yaw += dx * ORBIT * turn;
      this.cam.pitch += dy * ORBIT * turn;
      this.spin.yaw = dx * ORBIT * turn * 0.55;
      this.spin.pitch = dy * ORBIT * turn * 0.55;
      this.pan.x += dx * this.cam.flatten;
      this.pan.y += dy * this.cam.flatten;
      this.wake();
    });
    const release = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      const d = this.dragging;
      this.dragging = null;
      if (d && d.moved < 7 && Date.now() - d.t < 700) {
        this.spin.yaw = this.spin.pitch = 0;
        const hit = this.nodeAt(at(e).x, at(e).y);
        // A mouse has already hovered by the time it clicks; a finger has not,
        // so the first tap lights the note and the second one opens it.
        if (hit && (e.pointerType === 'mouse' || this.hover === hit.n.id)) this.open(hit);
        else this.setHover(hit);
      }
      if (reduced()) { this.spin.yaw = 0; this.spin.pitch = 0; }
      this.wake();
    };
    this.registerDomEvent(el, 'pointerup', release);
    this.registerDomEvent(el, 'pointercancel', release);
    this.registerDomEvent(el, 'pointerleave', () => { if (!this.dragging) this.setHover(null); });
    this.registerDomEvent(el, 'wheel', (e) => {
      e.preventDefault();
      this.userZoom = clamp(this.userZoom * Math.exp(-e.deltaY * 0.0015), 0.3, 4);
      this.wake();
    }, { passive: false });
  }
}

module.exports = { NexusGalaxyView };
