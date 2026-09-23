// Sunny Lane: grass, a road, pavements, street lamps, trees, and houses
// across the road for the view. The three lots on the near side are where
// the presets live; everything here is scenery, merged into a few meshes.
import * as THREE from 'three';
import { Batcher, Instancer, box, plane, mat4, WORLD_U } from '../world/build.js';
import { M } from '../world/materials.js';
import { PROPS, builtParts } from '../world/props.js';
import { LightPool } from '../world/lights.js';
import { rng } from '../world/textures.js';
import { GROUND } from './finishes.js';
import { House } from './house.js';
import { LOTS, LOT } from './plans.js';

export const STREET = { walk0: 14, road0: 16.4, road1: 23.6, walk1: 26 };

// Houses across the road: one room, windows all round, a hip roof.
const BACKDROP = [
  { x: -56, w: 11, d: 9, ext: 'sidingSage', roof: 'slate' },
  { x: -32, w: 12, d: 8, ext: 'stuccoPink', roof: 'terracotta' },
  { x: -8, w: 13, d: 9, ext: 'sidingWhite', roof: 'cedar' },
  { x: 16, w: 10, d: 8, ext: 'brick', roof: 'slate' },
  { x: 40, w: 12, d: 9, ext: 'stuccoSand', roof: 'terracotta' },
  { x: 62, w: 11, d: 8, ext: 'sidingBlue', roof: 'sage' },
];

export function buildStreet(game) {
  const { scene, physics } = game;
  const B = new Batcher(scene, 400);
  const I = new Instancer(scene);
  const lights = new LightPool(scene, game.quality === 'low' ? 6 : 10);
  const r = rng(7);

  // Ground and the lane.
  B.add(plane(1600, 1600, { tile: 4 }), M.grass(), mat4(0, 0, 0), { shadow: false });
  const S = STREET;
  B.add(box(260, 0.14, S.road0 - S.walk0, { tile: 2 }), M.sidewalk(), mat4(0, 0.07, (S.walk0 + S.road0) / 2), { shadow: false });
  B.add(box(260, 0.14, S.walk1 - S.road1, { tile: 2 }), M.sidewalk(), mat4(0, 0.07, (S.road1 + S.walk1) / 2), { shadow: false });
  B.add(plane(260, S.road1 - S.road0, { tile: 6 }), M.asphalt(), mat4(0, 0.015, (S.road0 + S.road1) / 2), { shadow: false });
  for (let x = -128; x < 128; x += 6) B.add(plane(3, 0.14), M.yellowPaint(), mat4(x, 0.02, (S.road0 + S.road1) / 2), { shadow: false });
  physics.add({ x: 0, z: (S.walk0 + S.road0) / 2, hx: 130, hz: (S.road0 - S.walk0) / 2, y0: 0, y1: 0.14, walk: true, tag: 'kerb' });

  // Lot furniture that isn't furniture: paths, drives, patios, sand.
  for (const lot of LOTS) {
    const plan = game.plans[lot.plan];
    const y = plan.yard || {};
    const flat = (rects, mat, h, tile = 1) => {
      for (const [x0, z0, x1, z1] of rects || []) {
        const w = x1 - x0, d = z1 - z0;
        B.add(box(w, h, d, { tile }), mat, mat4(lot.cx + (x0 + x1) / 2, h / 2, lot.cz + (z0 + z1) / 2), { shadow: false });
      }
    };
    flat(y.path, GROUND.path(), 0.03, 1.2);
    flat(y.patio, GROUND.path(), 0.03, 1.2);
    flat(y.drive, M.sidewalk(), 0.03, 2);
    flat(y.sand, M.sand(), 0.02, 3);
    // Where the drive crosses the pavement, the kerb drops.
    for (const [x0, , x1] of y.drive || []) B.add(box(x1 - x0, 0.15, S.road0 - S.walk0 + 0.02), M.sidewalk(), mat4(lot.cx + (x0 + x1) / 2, 0.075, (S.walk0 + S.road0) / 2), { shadow: false });
  }

  // Street lamps along the near pavement, trees along both.
  for (const name of ['lamp', 'tree0', 'tree1', 'tree2', 'palm0', 'palm2']) {
    I.define(name, builtParts(name).map((p) => ({ geo: p.geo, material: p.material, shadow: true })));
  }
  const place = (name, x, z, rot = 0, s = 1) => {
    I.place(name, mat4(x, 0.14, z, rot, s, s, s));
    const def = PROPS[name];
    if (def.collider) physics.add({ x, z, hx: def.collider.hx, hz: def.collider.hz, y0: 0, y1: def.collider.h, tag: name });
  };
  for (let x = -112; x <= 112; x += 24) {
    // The lamp's arm reaches out over the road.
    place('lamp', x + 12, S.road0 - 0.4, 0);
    lights.add({ pos: new THREE.Vector3(x + 12, 6.2, S.road0 - 0.4 + 1.35), night: true, intensity: 40, range: 20 });
  }
  for (let x = -120; x <= 120; x += 12 + Math.floor(r() * 6)) {
    if (Math.abs(((x + 14) % 28 + 28) % 28 - 14) < 3) continue;
    place(`tree${Math.floor(r() * 3)}`, x, S.walk1 - 0.9, r() * 6, 0.9 + r() * 0.3);
  }
  // Behind the lots and past both ends: a screen of trees.
  for (let x = -130; x <= 130; x += 5 + r() * 4) place(r() < 0.8 ? `tree${Math.floor(r() * 3)}` : 'palm0', x, -17 - r() * 10, r() * 6, 1 + r() * 0.5);
  for (const sx of [-1, 1]) for (let z = -14; z <= 12; z += 5 + r() * 3) place(`tree${Math.floor(r() * 3)}`, sx * (44 + r() * 8), z, r() * 6, 1 + r() * 0.4);
  // Between lots: a tree or two in each 2m gap.
  for (const gx of [-42, -14, 14, 42]) for (const z of [-9, 2, 10]) place(`tree${(gx + z + 60) % 3}`, gx, z, r() * 6, 0.8 + r() * 0.3);

  B.flush();
  I.flush();

  // Houses across the road, frozen at build time.
  const across = [];
  for (const [i, h] of BACKDROP.entries()) {
    const lot = { id: `X${i}`, cx: h.x, cz: 39, w: h.w + 6, d: h.d + 6 };
    const hw = h.w / 2, hd = h.d / 2;
    const plan = {
      exterior: h.ext, roof: h.roof, pitch: 0.5,
      rooms: [{ id: 'r', name: 'r', rect: [-hw, -hd, hw, hd], floor: 'oak', wall: 'cream' }],
      openings: [
        { kind: 'front', x: -hw + 2.5, z: -hd }, { x: hw - 2.5, z: -hd, w: 1.8 }, { x: 0.5, z: -hd, w: 1.4 },
        { x: -hw + 2.5, z: hd, w: 1.4 }, { x: hw - 2.5, z: hd, w: 1.4 }, { x: -hw, z: 0, w: 1.2 }, { x: hw, z: 0, w: 1.2 },
      ],
    };
    const house = new House(game, lot, plan);
    house.freeze();
    across.push(house);
    // Front path to the pavement.
    const p = new THREE.Mesh(box(1.2, 0.03, 39 - hd - S.walk1), GROUND.path());
    p.position.set(h.x - hw + 2.5, 0.015, (S.walk1 + 39 - hd) / 2);
    p.receiveShadow = true;
    scene.add(p);
  }

  const street = { lights, across };
  game.updaters.push((dt, g) => { WORLD_U.time.value += dt; WORLD_U.night.value = g.day.night; });
  return street;
}

// Lot bounds in world space (with the pavement in front, for walking home).
export function lotBounds(lot) {
  return { x0: lot.cx - LOT.w / 2, z0: lot.cz - LOT.d / 2, x1: lot.cx + LOT.w / 2, z1: STREET.road0 - 0.1 };
}
