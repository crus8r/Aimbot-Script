// Collision for a city: everything solid is a vertical oriented box (a wall,
// a bench, a car). Characters are upright cylinders. That is enough for
// streets and rooms, and cheap enough to run for every pedestrian.
//
// Boxes low enough to step onto (curbs, stairs, sidewalks) are not walls:
// they are ground. `step` decides which is which.
import * as THREE from 'three';

const CELL = 8;
const STEP = 0.42;
const GRAVITY = 18;

export class Physics {
  constructor() {
    this.cells = new Map();
    this.all = new Set();
    this.groundFn = () => 0;       // terrain below all boxes
    this._stamp = 0;
    this.dynamic = new Set();      // moving boxes (cars, doors) re-inserted each frame
  }

  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  // box: { x, z, hx, hz, rot, y0, y1, walk (top is ground), solid, tag, ref }
  add(box) {
    box.rot = box.rot || 0;
    box.y0 = box.y0 ?? 0;
    box.y1 = box.y1 ?? 3;
    box.solid = box.solid ?? true;
    box.c = Math.cos(box.rot); box.s = Math.sin(box.rot);
    box.r = Math.hypot(box.hx, box.hz);
    this._insert(box);
    this.all.add(box);
    return box;
  }

  _insert(box) {
    const x0 = Math.floor((box.x - box.r) / CELL), x1 = Math.floor((box.x + box.r) / CELL);
    const z0 = Math.floor((box.z - box.r) / CELL), z1 = Math.floor((box.z + box.r) / CELL);
    box._cells = [];
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      let c = this.cells.get(k);
      if (!c) { c = []; this.cells.set(k, c); }
      c.push(box);
      box._cells.push(c);
    }
  }

  remove(box) {
    if (!box._cells) return;
    for (const c of box._cells) { const i = c.indexOf(box); if (i >= 0) c.splice(i, 1); }
    box._cells = null;
    this.all.delete(box);
  }

  // Move a box (car, door) — re-index it.
  update(box, x, z, rot) {
    for (const c of box._cells || []) { const i = c.indexOf(box); if (i >= 0) c.splice(i, 1); }
    box.x = x; box.z = z; box.rot = rot;
    box.c = Math.cos(rot); box.s = Math.sin(rot);
    this._insert(box);
  }

  near(x, z, r, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const c = this.cells.get(this.key(ix, iz));
      if (!c) continue;
      for (const b of c) {
        if (b._seen === stamp) continue;
        b._seen = stamp;
        out.push(b);
      }
    }
    return out;
  }

  // Point in box, in box-local XZ.
  local(b, x, z) {
    const dx = x - b.x, dz = z - b.z;
    return [dx * b.c - dz * b.s, dx * b.s + dz * b.c];
  }

  // Highest walkable surface under (x,z) not above fromY + step.
  groundAt(x, z, fromY, step = STEP, ignore = null) {
    let g = this.groundFn(x, z);
    const list = this.near(x, z, 0.1, this._tmp || (this._tmp = []));
    for (const b of list) {
      if (!b.walk || b === ignore || b.disabled) continue;
      if (b.y1 > fromY + step || b.y1 <= g) continue;
      const [lx, lz] = this.local(b, x, z);
      if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) g = b.y1;
    }
    return g;
  }

  // Push a circle (x,z,r) at height span [y0,y1] out of solid boxes.
  // Returns the pushed position and whether anything was hit.
  resolveCircle(pos, r, y0, y1, filter = null) {
    let hit = null;
    const list = this.near(pos.x, pos.z, r + 1, this._tmp2 || (this._tmp2 = []));
    for (let pass = 0; pass < 2; pass++) {
      for (const b of list) {
        if (!b.solid || b.disabled) continue;
        if (b.y1 <= y0 + (b.walk ? STEP : 0.05) || b.y0 >= y1) continue;
        if (filter && !filter(b)) continue;
        const [lx, lz] = this.local(b, pos.x, pos.z);
        const cx = Math.max(-b.hx, Math.min(b.hx, lx));
        const cz = Math.max(-b.hz, Math.min(b.hz, lz));
        let dx = lx - cx, dz = lz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx, nz, push;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; push = r - d;
        } else {
          // Centre inside the box: leave by the nearest face.
          const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
          if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; }
          else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
        }
        // Back to world.
        const wx = nx * b.c + nz * b.s, wz = -nx * b.s + nz * b.c;
        pos.x += wx * push; pos.z += wz * push;
        hit = b;
      }
    }
    return hit;
  }

  // One step of character motion from its intent.
  moveActor(a, dt, others = null) {
    const it = a.intent;
    const p = a.object.position;
    const locked = a.state !== 'free' || a.busy;
    const want = locked ? 0 : it.speed;
    const tx = it.dir.x * want, tz = it.dir.z * want;
    // Exponential approach: quick to start, quicker to stop, sluggish in air.
    const rate = a.grounded ? (want > a.speed ? 8 : 12) : 1.5;
    const k = Math.min(1, rate * dt);
    a.velocity.x += (tx - a.velocity.x) * k;
    a.velocity.z += (tz - a.velocity.z) * k;
    if (locked) { a.velocity.x = 0; a.velocity.z = 0; }

    // Turn toward travel (or an explicit facing).
    const faceDir = it.face ?? (want > 0.1 && it.dir.lengthSq() > 0.01 ? Math.atan2(it.dir.x, it.dir.z) : null);
    if (faceDir !== null && !locked) {
      let d = faceDir - a.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const rate = (a.grounded ? 9 : 3) * dt;
      a.heading += Math.max(-rate, Math.min(rate, d));
    }

    if (locked && a.state !== 'free') { a.speed = 0; return; }

    const ox = p.x, oz = p.z;
    p.x += a.velocity.x * dt;
    p.z += a.velocity.z * dt;

    // Vertical.
    if (a.grounded && it.jump && !locked) {
      a.velocity.y = 5.2;
      a.grounded = false;
      a.airTime = 0;
      a.onJump?.();
    }
    it.jump = false;
    const g = this.groundAt(p.x, p.z, p.y);
    if (a.grounded) {
      if (p.y - g > STEP + 0.05) { a.grounded = false; a.velocity.y = 0; a.airTime = 0; }
      else p.y += (g - p.y) * Math.min(1, dt * 18);
    }
    if (!a.grounded) {
      a.airTime += dt;
      a.velocity.y -= GRAVITY * dt;
      p.y += a.velocity.y * dt;
      const g2 = this.groundAt(p.x, p.z, p.y + 0.3);
      if (p.y <= g2 && a.velocity.y <= 0) {
        p.y = g2; a.grounded = true;
        const fall = a.airTime;
        a.velocity.y = 0;
        a.onLand?.(fall);
      }
    }

    this.resolveCircle(p, a.radius, p.y, p.y + a.height * 0.95);
    // Other actors: soft separation.
    if (others) {
      for (const o of others) {
        if (o === a || o.state === 'driving' || !o.object.visible) continue;
        const dx = p.x - o.object.position.x, dz = p.z - o.object.position.z;
        const rr = a.radius + o.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6 && Math.abs(p.y - o.object.position.y) < 1.2) {
          const d = Math.sqrt(d2);
          const push = (rr - d) * 0.5;
          p.x += dx / d * push; p.z += dz / d * push;
          a.onBump?.(o);
        }
      }
    }
    a.speed = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-4);
    if (a.speed < 0.05) a.speed = 0;
  }

  // Ray against boxes; returns distance to first hit (or maxDist).
  raycast(origin, dir, maxDist, filter = null) {
    let best = maxDist;
    const steps = Math.ceil(maxDist / CELL) + 1;
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(maxDist, i * CELL);
      const list = this.near(origin.x + dir.x * t, origin.z + dir.z * t, CELL, []);
      for (const b of list) {
        if (seen.has(b) || !b.solid || b.disabled || b.noCam) continue;
        seen.add(b);
        if (filter && !filter(b)) continue;
        const h = rayBox(origin, dir, b);
        if (h !== null && h < best) best = h;
      }
    }
    return best;
  }
}

// Slab test in box-local space.
function rayBox(o, d, b) {
  const dx = o.x - b.x, dz = o.z - b.z;
  const lox = dx * b.c - dz * b.s, loz = dx * b.s + dz * b.c;
  const ldx = d.x * b.c - d.z * b.s, ldz = d.x * b.s + d.z * b.c;
  let tmin = 0, tmax = Infinity;
  const axes = [[lox, ldx, b.hx], [loz, ldz, b.hz]];
  for (const [p, v, h] of axes) {
    if (Math.abs(v) < 1e-9) { if (p < -h || p > h) return null; continue; }
    let t1 = (-h - p) / v, t2 = (h - p) / v;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Vertical slab.
  if (Math.abs(d.y) < 1e-9) { if (o.y < b.y0 || o.y > b.y1) return null; }
  else {
    let t1 = (b.y0 - o.y) / d.y, t2 = (b.y1 - o.y) / d.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export { STEP };
