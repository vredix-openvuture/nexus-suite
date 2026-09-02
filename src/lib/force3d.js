'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the three-dimensional force layout
 *
 *  The galaxy map's arithmetic and nothing else: no DOM, no Obsidian, no
 *  canvas. That is the whole reason it is its own file — a layout that can be
 *  stepped in a test is a layout whose behaviour can be asserted.
 *
 *  The camera lives here for the same reason. Turning a point into a pixel is
 *  the same kind of pure arithmetic the layout is, and "a nearer node is drawn
 *  larger" is a claim a test should be able to make.
 *
 *  Deterministic on purpose. A vault that unfolds differently on every open
 *  can neither be asserted about nor returned to, so the only randomness here
 *  comes from a seeded generator.
 *
 *  COST. Repulsion is every pair against every other, O(n²) per step. Measured
 *  on this machine, whole unfold, not one step:
 *
 *      150 notes    468 steps      45 ms   0.10 ms/step
 *      400 notes    248 steps     134 ms   0.54 ms/step
 *      800 notes    600 steps   1 303 ms   2.17 ms/step
 *     1500 notes    600 steps   4 557 ms   7.59 ms/step
 *
 *  Only the unfolding pays it — once settled the view never steps again and a
 *  frame costs a projection and a sort, O(n log n). So a vault of a few hundred
 *  notes opens instantly; at fifteen hundred the unfold is four and a half
 *  seconds here and, on a tablet, several times that, which is where it stops
 *  being pleasant. Beyond that the honest fix is a Barnes-Hut octree, not a
 *  bigger step budget: the ceiling is the pair count, and no amount of tuning
 *  moves a quadratic.
 * ========================================================================== */

const DEFAULTS = {
  seed: 1,
  linkDistance: 60,     // the rest length of a link
  repulsion: 1600,      // Coulomb constant — how hard two notes push apart
  spring: 0.06,         // Hooke constant of a link
  centre: 0.012,        // pull towards the origin, so the cloud cannot drift away
  damping: 0.82,        // share of the velocity a node keeps into the next step
  maxStep: 12,          // the furthest a node may travel in one step
  minDist2: 4,          // below this two nodes count as coincident
  settleEnergy: 0.02,   // mean kinetic energy at which the layout is finished
  maxSteps: 600,        // hard ceiling, so a pathological graph still stops
};

/* mulberry32 — small, fast, and the same sequence on every platform. */
function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Links arrive as [a, b] or {source, target} and carry ids, not indices. One
   undirected edge per pair: the resolved-link map lists A→B and B→A. */
function edgeList(nodes, links) {
  const index = new Map();
  nodes.forEach((n, i) => { if (!index.has(n.id)) index.set(n.id, i); });
  const seen = new Set();
  const out = [];
  (links || []).forEach(l => {
    if (!l) return;
    const a = index.get(Array.isArray(l) ? l[0] : l.source);
    const b = index.get(Array.isArray(l) ? l[1] : l.target);
    if (a == null || b == null || a === b) return;
    const key = a < b ? a + ':' + b : b + ':' + a;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([a, b]);
  });
  return out;
}

function createLayout(spec, options) {
  const o = Object.assign({}, DEFAULTS, options || {});
  const rand = rng(o.seed);
  const nodes = ((spec && spec.nodes) || []).map((n, i) => ({
    id: n && n.id != null ? n.id : i, data: n,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, deg: 0,
  }));
  const edges = edgeList(nodes, spec && spec.links);
  edges.forEach(([a, b]) => { nodes[a].deg++; nodes[b].deg++; });

  /* Seeded on a Fibonacci sphere rather than at random: an even shell is far
     from the degenerate everyone-in-one-spot case, so the first steps do the
     work of separating clusters instead of the work of untangling a knot. The
     radius jitter is what the seed actually changes. */
  const shell = o.linkDistance * Math.max(1, Math.cbrt(nodes.length)) * 1.2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  nodes.forEach((n, i) => {
    const t = nodes.length > 1 ? 1 - (i / (nodes.length - 1)) * 2 : 0;
    const ring = Math.sqrt(Math.max(0, 1 - t * t));
    const a = golden * i;
    const r = shell * (0.7 + rand() * 0.5);
    n.x = Math.cos(a) * ring * r; n.y = t * r; n.z = Math.sin(a) * ring * r;
  });

  const sim = { nodes, edges, options: o, settled: nodes.length === 0, energy: 0, steps: 0 };

  sim.step = function () {
    if (sim.settled) return sim.energy;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < o.minDist2) {
          /* Two notes on the exact same point have no direction to push along.
             The seeded generator supplies one; without it this is the NaN. */
          dx = rand() - 0.5; dy = rand() - 0.5; dz = rand() - 0.5;
          const m = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (m > 0) { dx /= m; dy /= m; dz /= m; } else { dx = 1; dy = 0; dz = 0; }
          d2 = o.minDist2;
        } else {
          const m = Math.sqrt(d2);
          dx /= m; dy /= m; dz /= m;
        }
        const f = o.repulsion / d2;
        a.vx -= f * dx; a.vy -= f * dy; a.vz -= f * dz;
        b.vx += f * dx; b.vy += f * dy; b.vz += f * dz;
      }
    }
    for (let e = 0; e < edges.length; e++) {
      const a = nodes[edges[e][0]], b = nodes[edges[e][1]];
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(d > 1e-6)) continue;          // coincident: repulsion already handled it
      const f = (d - o.linkDistance) * o.spring;
      dx = f * dx / d; dy = f * dy / d; dz = f * dz / d;
      a.vx += dx; a.vy += dy; a.vz += dz;
      b.vx -= dx; b.vy -= dy; b.vz -= dz;
    }
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      p.vx -= p.x * o.centre; p.vy -= p.y * o.centre; p.vz -= p.z * o.centre;
      p.vx *= o.damping; p.vy *= o.damping; p.vz *= o.damping;
      /* The one clamp that keeps an inverse-square force from throwing a node
         into the distance on the first iteration, before damping can bite. */
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
      if (speed > o.maxStep) { const s = o.maxStep / speed; p.vx *= s; p.vy *= s; p.vz *= s; }
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      energy += p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
    }
    sim.energy = n ? energy / n : 0;
    sim.steps++;
    if (sim.energy < o.settleEnergy || sim.steps >= o.maxSteps) sim.settled = true;
    return sim.energy;
  };

  sim.run = function (max) {
    let done = 0;
    while (!sim.settled && done < (max == null ? o.maxSteps : max)) { sim.step(); done++; }
    return done;
  };

  /* How far the cloud reaches, for framing it in a viewport. */
  sim.radius = function () {
    let r = 0;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      const d = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      if (d > r) r = d;
    }
    return r;
  };

  return sim;
}

/* ---- the camera ----------------------------------------------------------
 *  One point, rotated and divided. `flatten` is the 3D↔2D dial and it moves
 *  three things at once: the rotation back to square on, the depth to zero and
 *  the perspective divide to an identity — so the flat graph is the same code
 *  path rather than a second one, and any value in between is a frame of the
 *  transition.
 * ------------------------------------------------------------------------- */
function project(p, cam, w, h) {
  const flat = Math.max(0, Math.min(1, cam.flatten || 0));
  const yaw = (cam.yaw || 0) * (1 - flat), pitch = (cam.pitch || 0) * (1 - flat);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = p.x * cy + p.z * sy;
  const z1 = p.z * cy - p.x * sy;
  const y1 = p.y * cp - z1 * sp;
  const z = (p.y * sp + z1 * cp) * (1 - flat);      // camera space: larger is nearer
  const dist = cam.distance || 900;
  const near = dist * 0.15;                          // never divide by a node behind the lens
  const persp = dist / Math.max(near, dist - z);
  const k = persp + (1 - persp) * flat;
  const zoom = cam.zoom == null ? 1 : cam.zoom;
  return { x: w / 2 + x1 * k * zoom, y: h / 2 + y1 * k * zoom, z: z, k: k };
}

/* Painter's algorithm: farthest first, so what is in front covers what is
   behind. Without this the depth cues fight each other and the picture reads
   as one flat tangle. */
function sortByDepth(items) {
  items.sort((a, b) => a.z - b.z);
  return items;
}

/* 0 at the front of the cloud, 1 at the back — how far a node has receded. */
function depthFade(z, radius) {
  if (!(radius > 0)) return 0;
  return Math.max(0, Math.min(1, 0.5 - z / (2 * radius)));
}

/* The zoom that puts a cloud of this radius inside a viewport of this size. */
function fitZoom(radius, w, h) {
  if (!(radius > 0)) return 1;
  return (Math.min(w, h) * 0.42) / radius;
}

module.exports = { DEFAULTS, createLayout, edgeList, rng, project, sortByDepth, depthFade, fitZoom };
