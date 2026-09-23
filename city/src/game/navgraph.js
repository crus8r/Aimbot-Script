// Where pedestrians can walk: a graph along the middle of every sidewalk,
// across every zebra crossing, round the park, along the promenade and out
// onto the pier. Crossing edges remember which road they cross, so walkers
// can wait for the signal.
import * as THREE from 'three';
import { XS, ZS, HALF_ROAD, WALK_W, CURB_H, BEACH, blockRect } from '../world/layout.js';

export const PATH_INSET = 2.9;   // from the curb: clear of trees (1.0), benches (<2.1) and walls (4.5)

export class NavGraph {
  constructor() {
    this.nodes = [];
    this.byKey = new Map();
  }

  node(x, z, y = CURB_H, tag = '') {
    const k = `${Math.round(x * 2)},${Math.round(z * 2)}`;
    if (this.byKey.has(k)) return this.byKey.get(k);
    const n = { id: this.nodes.length, p: new THREE.Vector3(x, y, z), edges: [], tag };
    this.nodes.push(n);
    this.byKey.set(k, n);
    return n;
  }

  link(a, b, cross = null) {
    if (a === b) return;
    const d = a.p.distanceTo(b.p);
    a.edges.push({ to: b, d, cross });
    b.edges.push({ to: a, d, cross });
  }

  // Chain of nodes along a straight line, every ~12m.
  line(ax, az, bx, bz, y = CURB_H, tag = '') {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 12));
    let prev = this.node(ax, az, y, tag);
    const out = [prev];
    for (let i = 1; i <= n; i++) {
      const cur = this.node(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, y, tag);
      this.link(prev, cur);
      out.push(cur);
      prev = cur;
    }
    return out;
  }

  nearest(p, filter = null) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = (n.p.x - p.x) ** 2 + (n.p.z - p.z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // A* from node to node; returns the node list.
  path(a, b) {
    if (!a || !b) return null;
    const open = new Map([[a.id, a]]);
    const g = new Map([[a.id, 0]]);
    const f = new Map([[a.id, a.p.distanceTo(b.p)]]);
    const from = new Map();
    let guard = 0;
    while (open.size && guard++ < 5000) {
      let cur = null, cf = Infinity;
      for (const n of open.values()) { const v = f.get(n.id); if (v < cf) { cf = v; cur = n; } }
      if (cur === b) {
        const out = [cur];
        while (from.has(out[0].id)) out.unshift(from.get(out[0].id).node);
        // Carry crossing info onto the node you arrive at.
        return out.map((n, i) => ({ node: n, cross: i > 0 ? from.get(n.id)?.cross : null }));
      }
      open.delete(cur.id);
      for (const e of cur.edges) {
        const tg = g.get(cur.id) + e.d + (e.cross ? 6 : 0);
        if (tg < (g.get(e.to.id) ?? Infinity)) {
          from.set(e.to.id, { node: cur, cross: e.cross });
          g.set(e.to.id, tg);
          f.set(e.to.id, tg + e.to.p.distanceTo(b.p));
          open.set(e.to.id, e.to);
        }
      }
    }
    return null;
  }

  randomNode(rand, filter) {
    const list = filter ? this.nodes.filter(filter) : this.nodes;
    return list[Math.floor(rand() * list.length)];
  }
}

export function buildNavGraph(world) {
  const G = new NavGraph();
  const P = PATH_INSET;
  const corners = {};
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const b = blockRect(i, j);
    const c = [[b.x0 + P, b.z0 + P], [b.x1 - P, b.z0 + P], [b.x1 - P, b.z1 - P], [b.x0 + P, b.z1 - P]];
    for (let k = 0; k < 4; k++) G.line(c[k][0], c[k][1], c[(k + 1) % 4][0], c[(k + 1) % 4][1], CURB_H, 'walk');
    corners[`${i},${j}`] = c.map(([x, z]) => G.node(x, z));
  }
  // Crossings between neighbouring blocks.
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const c = corners[`${i},${j}`];
    if (i < 4) {
      const e = corners[`${i + 1},${j}`];
      G.link(c[1], e[0], { road: 'ns', x: XS[i + 1] });
      G.link(c[2], e[3], { road: 'ns', x: XS[i + 1] });
    }
    if (j < 3) {
      const s = corners[`${i},${j + 1}`];
      G.link(c[3], s[0], { road: 'ew', z: ZS[j + 1] });
      G.link(c[2], s[1], { road: 'ew', z: ZS[j + 1] });
    }
  }
  // Promenade along the beach, joined to the beachfront blocks across Ocean Drive.
  const promX = BEACH.promenade0 + 4.6;
  const prom = G.line(promX, -190, promX, 190, CURB_H, 'promenade');
  for (let j = 0; j < 4; j++) {
    const c = corners[`4,${j}`];
    for (const k of [1, 2]) {
      const n = c[k];
      const target = G.nearest(n.p, (m) => m.tag === 'promenade');
      G.link(n, target, { road: 'ns', x: XS[5], unsignalled: true });
    }
  }
  // Out along the pier.
  const pierStart = G.node(BEACH.promenade1 + 3, 0, BEACH.deckY, 'pier');
  G.link(G.nearest(new THREE.Vector3(promX, 0, 0), (m) => m.tag === 'promenade'), pierStart);
  G.line(BEACH.promenade1 + 3, 0.8, BEACH.pierEnd - 9, 0.8, BEACH.deckY, 'pier');
  G.link(pierStart, G.nearest(new THREE.Vector3(BEACH.promenade1 + 3, 0, 0.8), (m) => m.tag === 'pier' && m !== pierStart));
  // Park: paths from each edge's middle to the fountain ring.
  const park = world.plan.special.find((s) => s.kind === 'park');
  if (park) {
    const cx = (park.x0 + park.x1) / 2, cz = (park.z0 + park.z1) / 2;
    const ring = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ring.push(G.node(cx + Math.sin(a) * 6.5, cz + Math.cos(a) * 6.5, CURB_H, 'park')); }
    for (let k = 0; k < 8; k++) G.link(ring[k], ring[(k + 1) % 8]);
    for (const [dx, dz, k] of [[0, -1, 4], [0, 1, 0], [-1, 0, 6], [1, 0, 2]]) {
      const edgeMid = G.nearest(new THREE.Vector3(cx + dx * 30, 0, cz + dz * 30), (m) => m.tag === 'walk');
      const mid = G.node(cx + dx * 16, cz + dz * 16, CURB_H, 'park');
      G.link(edgeMid, mid);
      G.link(mid, ring[k]);
    }
  }
  return G;
}
