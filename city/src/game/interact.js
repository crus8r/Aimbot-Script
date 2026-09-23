// Things you can press E on, and the little walk an actor takes to use them.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Interactions {
  constructor() {
    this.items = [];
    this.cells = new Map();
  }

  // item: { pos: Vector3, radius, label(actor) -> string|null, act(actor, game), kind, heading? }
  add(item) {
    item.radius = item.radius ?? 1.4;
    this.items.push(item);
    const k = this.key(item.pos.x, item.pos.z);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push(item);
    return item;
  }

  key(x, z) { return `${Math.floor(x / 10)},${Math.floor(z / 10)}`; }

  near(x, z) {
    const out = [];
    const cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = this.cells.get(`${cx + i},${cz + j}`);
      if (c) out.push(...c);
    }
    return out;
  }

  // Best item for an actor: close, roughly in front, usable now.
  best(actor) {
    const p = actor.object.position;
    const f = actor.forward(_v);
    let best = null, bestScore = Infinity;
    for (const it of this.near(p.x, p.z)) {
      if (it.disabled) continue;
      const dx = it.pos.x - p.x, dz = it.pos.z - p.z, dy = it.pos.y - p.y;
      const d = Math.hypot(dx, dz);
      if (d > it.radius || Math.abs(dy) > 2.2) continue;
      const label = it.label(actor);
      if (!label) continue;
      const facing = d > 0.01 ? (dx * f.x + dz * f.z) / d : 1;
      if (facing < -0.3 && d > 0.7) continue;
      const score = d - facing * 0.6;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }
}

// Walk an actor to a point and facing, then call `then`. The last half metre
// is a short slide so the actor lands exactly where a transition expects it.
export function approach(actor, point, heading, then, { speed = 1.5, slide = 0.28 } = {}) {
  actor.goal = { point: point.clone(), heading, then, speed, slide, t: 0, phase: 'walk' };
}

export function updateGoal(actor, dt, physics) {
  const g = actor.goal;
  if (!g) return false;
  const p = actor.object.position;
  const dx = g.point.x - p.x, dz = g.point.z - p.z;
  const d = Math.hypot(dx, dz);
  g.t += dt;
  if (g.phase === 'walk') {
    if (d < 0.45 || g.t > 8) {
      g.phase = 'slide';
      g.from = p.clone();
      g.fromH = actor.heading;
      g.st = 0;
      actor.intent.speed = 0;
      actor.velocity.set(0, 0, 0);
    } else {
      actor.intent.dir.set(dx / d, 0, dz / d);
      actor.intent.speed = Math.min(g.speed, 0.6 + d * 1.5);
      actor.intent.face = null;
      return true;
    }
  }
  if (g.phase === 'slide') {
    g.st += dt;
    const u = Math.min(1, g.st / g.slide);
    const e = u * u * (3 - 2 * u);
    p.x = g.from.x + (g.point.x - g.from.x) * e;
    p.z = g.from.z + (g.point.z - g.from.z) * e;
    let dh = g.heading - g.fromH;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    actor.heading = g.fromH + dh * e;
    actor.intent.speed = 0;
    actor.speed = 0;
    if (u >= 1) {
      actor.goal = null;
      g.then?.();
    }
    return true;
  }
  return false;
}
