// Walking around furniture: an occupancy grid over the lot (25cm cells),
// rasterised from the same collision boxes the physics uses, grown by a
// body's radius, searched with A* and then pulled tight so a path is a few
// straight legs instead of a staircase of cells.
import * as THREE from 'three';

const CELL = 0.25;
const RADIUS = 0.24;

export class NavGrid {
  constructor(physics, bounds) {
    this.physics = physics;
    this.setBounds(bounds);
  }

  // bounds: world {x0, z0, x1, z1}
  setBounds(b) {
    this.b = b;
    this.nx = Math.ceil((b.x1 - b.x0) / CELL);
    this.nz = Math.ceil((b.z1 - b.z0) / CELL);
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.dirty = true;
  }

  cellOf(x, z) { return [Math.floor((x - this.b.x0) / CELL), Math.floor((z - this.b.z0) / CELL)]; }
  center(i, j) { return [this.b.x0 + (i + 0.5) * CELL, this.b.z0 + (j + 0.5) * CELL]; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }
  free(i, j) { return this.inside(i, j) && !this.blocked[j * this.nx + i]; }

  rebuild() {
    this.blocked.fill(0);
    const { b } = this;
    for (const box of this.physics.all) {
      if (!box.solid || box.disabled || box.walk) continue;
      if (box.y1 - box.y0 < 0.3 && box.y0 < 0.3) continue;        // a kerb, not a wall
      if (box.y0 > 1.6) continue;                                   // overhead
      const r = box.r + RADIUS;
      if (box.x + r < b.x0 || box.x - r > b.x1 || box.z + r < b.z0 || box.z - r > b.z1) continue;
      const [i0, j0] = this.cellOf(box.x - r, box.z - r);
      const [i1, j1] = this.cellOf(box.x + r, box.z + r);
      for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
          const [cx, cz] = this.center(i, j);
          const dx = cx - box.x, dz = cz - box.z;
          const lx = Math.abs(dx * box.c - dz * box.s), lz = Math.abs(dx * box.s + dz * box.c);
          // Rounded-rectangle test: the box grown by the radius.
          const ox = Math.max(0, lx - box.hx), oz = Math.max(0, lz - box.hz);
          if (ox * ox + oz * oz < RADIUS * RADIUS) this.blocked[j * this.nx + i] = 1;
        }
      }
    }
    this.dirty = false;
  }

  // Nearest free cell to a point (a chair's stand point can sit inside the
  // grown outline of its own table).
  nearestFree(x, z, maxR = 10) {
    const [ci, cj] = this.cellOf(x, z);
    if (this.free(ci, cj)) return [ci, cj];
    let best = null, bd = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !this.free(i, j)) continue;
        const [px, pz] = this.center(i, j);
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) { bd = d; best = [i, j]; }
      }
      if (best) return best;
    }
    return null;
  }

  // A path of world points from (x0,z0) to (x1,z1), or null.
  find(x0, z0, x1, z1) {
    if (this.dirty) this.rebuild();
    const s = this.nearestFree(x0, z0, 6), g = this.nearestFree(x1, z1, 10);
    if (!s || !g) return null;
    const { nx } = this;
    const N = nx * this.nz;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const si = s[1] * nx + s[0], gi = g[1] * nx + g[0];
    const h = (i) => { const dx = Math.abs((i % nx) - g[0]), dz = Math.abs(Math.floor(i / nx) - g[1]); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const heap = new Heap();
    gScore[si] = 0;
    heap.push(si, h(si));
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false, iter = 0;
    while (heap.size && iter++ < 60000) {
      const cur = heap.pop();
      if (cur === gi) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % nx, cj = Math.floor(cur / nx);
      for (const [di, dj, cost] of dirs) {
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        // No cutting corners past a blocked cell.
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
        const n = nj * nx + ni;
        const t = gScore[cur] + cost;
        if (t < gScore[n]) { gScore[n] = t; came[n] = cur; heap.push(n, t + h(n)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = gi; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.center(c % nx, Math.floor(c / nx)));
    // Exact ends: start where we are, finish where asked (if it's walkable).
    pts[0] = [x0, z0];
    if (this.free(...this.cellOf(x1, z1))) pts[pts.length - 1] = [x1, z1];
    return this.smooth(pts).map(([x, z]) => new THREE.Vector3(x, 0, z));
  }

  // String pulling: keep a point only when the straight line past it would
  // cross a blocked cell.
  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.clear(pts[a], pts[b])) b--;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }

  clear(p, q) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.ceil(d / (CELL * 0.4));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const [i, j] = this.cellOf(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
      if (!this.free(i, j)) return false;
    }
    return true;
  }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    let i = k.length;
    k.push(key); p.push(pri);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= pri) break;
      k[i] = k[par]; p[i] = p[par];
      i = par;
    }
    k[i] = key; p[i] = pri;
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mp = lp;
        if (l < k.length && p[l] < mp) { m = l; mp = p[l]; }
        if (r < k.length && p[r] < mp) { m = r; mp = p[r]; }
        if (m === i) break;
        k[i] = k[m]; p[i] = p[m];
        i = m;
      }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
}
