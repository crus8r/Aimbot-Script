// Streets: asphalt, markings, crosswalks, raised sidewalks, and traffic
// signals whose lamps are shared materials the traffic system switches.
import * as THREE from 'three';
import { box, plane, mat4 } from './build.js';
import { M, std, nightLit } from './materials.js';
import { XS, ZS, HALF_ROAD, CURB_H, WALK_W, BEACH, blockRect } from './layout.js';

export const SIGNAL = {};   // materials: ns_red, ns_yellow, ns_green, ew_*, walk_ns, walk_ew, dont_ns, dont_ew

function signalMat(color) {
  return new THREE.MeshStandardMaterial({ color: '#111', emissive: new THREE.Color(color), emissiveIntensity: 0.05, roughness: 0.3 });
}

export function buildRoads(game, B) {
  const { physics } = game;
  const X0 = XS[0] - HALF_ROAD - WALK_W, X1 = XS[5] + HALF_ROAD;
  const Z0 = ZS[0] - HALF_ROAD - WALK_W, Z1 = ZS[4] + HALF_ROAD + WALK_W;

  // Asphalt: one plane per road segment so it chunks and culls.
  const asphalt = M.asphalt();
  for (const x of XS) {
    for (let j = 0; j < ZS.length - 1; j++) {
      // Segments meet at intersection centres so nothing overlaps (z-fighting).
      const z0 = j === 0 ? ZS[0] - HALF_ROAD : ZS[j], z1 = j === ZS.length - 2 ? ZS[j + 1] + HALF_ROAD : ZS[j + 1];
      B.add(plane(HALF_ROAD * 2, z1 - z0, { tile: 8, u0: x / 8, v0: z0 / 8 }), asphalt, mat4(x, 0, (z0 + z1) / 2), { shadow: false });
    }
  }
  for (const z of ZS) {
    for (let i = 0; i < XS.length - 1; i++) {
      const x0 = XS[i] + HALF_ROAD, x1 = XS[i + 1] - HALF_ROAD;
      B.add(plane(x1 - x0, HALF_ROAD * 2, { tile: 8, u0: x0 / 8, v0: z / 8 }), asphalt, mat4((x0 + x1) / 2, 0, z), { shadow: false });
    }
  }

  // Markings.
  const white = M.paint(), yellow = M.yellowPaint();
  const mark = (x, z, w, d, m, ry = 0) => B.add(plane(w, d), m, mat4(x, 0.012, z, ry), { shadow: false });
  for (const x of XS) for (let j = 0; j < ZS.length - 1; j++) {
    const a = ZS[j] + HALF_ROAD + 3.5, b = ZS[j + 1] - HALF_ROAD - 3.5;
    mark(x - 0.12, (a + b) / 2, 0.12, b - a, yellow);
    mark(x + 0.12, (a + b) / 2, 0.12, b - a, yellow);
    for (const s of [-1, 1]) mark(x + s * (HALF_ROAD - 2.3), (a + b) / 2, 0.12, b - a, white);
    // Stop lines.
    mark(x + 1.9, a - 0.3, 3.4, 0.4, white);
    mark(x - 1.9, b + 0.3, 3.4, 0.4, white);
  }
  for (const z of ZS) for (let i = 0; i < XS.length - 1; i++) {
    const a = XS[i] + HALF_ROAD + 3.5, b = XS[i + 1] - HALF_ROAD - 3.5;
    mark((a + b) / 2, z - 0.12, b - a, 0.12, yellow);
    mark((a + b) / 2, z + 0.12, b - a, 0.12, yellow);
    for (const s of [-1, 1]) mark((a + b) / 2, z + s * (HALF_ROAD - 2.3), b - a, 0.12, white);
    mark(a - 0.3, z - 1.9, 0.4, 3.4, white);
    mark(b + 0.3, z + 1.9, 0.4, 3.4, white);
  }
  // Zebra crossings on every approach.
  const zebra = (cx, cz, alongX) => {
    for (let k = -5; k <= 5; k++) {
      if (alongX) mark(cx, cz + k * 1.05, 2.6, 0.55, white);
      else mark(cx + k * 1.05, cz, 0.55, 2.6, white);
    }
  };
  for (const x of XS) for (const z of ZS) {
    const inside = (v, arr) => v > arr[0] - 1 && v < arr[arr.length - 1] + 1;
    if (z > ZS[0]) zebra(x, z - HALF_ROAD - 1.6, false);
    if (z < ZS[4]) zebra(x, z + HALF_ROAD + 1.6, false);
    if (x > XS[0]) zebra(x - HALF_ROAD - 1.6, z, true);
    if (x < XS[5] && inside(x, XS)) zebra(x + HALF_ROAD + 1.6, z, true);
  }

  // Sidewalk slabs: each block is one raised slab (buildings stand on it).
  const walk = M.sidewalk();
  const slab = (x0, x1, z0, z1, m = walk, tile = 3) => {
    const w = x1 - x0, d = z1 - z0;
    B.add(box(w, CURB_H, d, { tile, u0: x0 / tile, v0: z0 / tile }), m, mat4((x0 + x1) / 2, CURB_H / 2, (z0 + z1) / 2), { shadow: false });
    physics.add({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: w / 2, hz: d / 2, y0: 0, y1: CURB_H, walk: true, solid: false, tag: 'walk' });
  };
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const b = blockRect(i, j);
    slab(b.x0, b.x1, b.z0, b.z1);
    // Curb edge strip: a lighter band on the sidewalk's edge.
    const c = M.curb();
    const e = 0.3;
    B.add(box(b.x1 - b.x0, 0.02, e), c, mat4((b.x0 + b.x1) / 2, CURB_H + 0.005, b.z0 + e / 2), { shadow: false });
    B.add(box(b.x1 - b.x0, 0.02, e), c, mat4((b.x0 + b.x1) / 2, CURB_H + 0.005, b.z1 - e / 2), { shadow: false });
    B.add(box(e, 0.02, b.z1 - b.z0), c, mat4(b.x0 + e / 2, CURB_H + 0.005, (b.z0 + b.z1) / 2), { shadow: false });
    B.add(box(e, 0.02, b.z1 - b.z0), c, mat4(b.x1 - e / 2, CURB_H + 0.005, (b.z0 + b.z1) / 2), { shadow: false });
  }
  // Outer sidewalks (west, north, south of the ring road), then the edge.
  slab(X0 - 2, XS[0] - HALF_ROAD, Z0, Z1);
  slab(XS[0] - HALF_ROAD, BEACH.promenade0, ZS[0] - HALF_ROAD - WALK_W, ZS[0] - HALF_ROAD);
  slab(XS[0] - HALF_ROAD, BEACH.promenade0, ZS[4] + HALF_ROAD, ZS[4] + HALF_ROAD + WALK_W);
  // The promenade along the beach.
  slab(BEACH.promenade0, BEACH.promenade1, Z0 - 40, Z1 + 40, M.promenade(), 4);

  buildSignals(game, B);
}

function buildSignals(game, B) {
  for (const k of ['ns', 'ew']) {
    SIGNAL[`${k}_red`] = signalMat('#ff2a1a');
    SIGNAL[`${k}_yellow`] = signalMat('#ffb020');
    SIGNAL[`${k}_green`] = signalMat('#2aff7a');
    SIGNAL[`${k}_walk`] = signalMat('#e8f4ff');
    SIGNAL[`${k}_dont`] = signalMat('#ff6a20');
  }
  const pole = M.darkMetal();
  const housing = std('#1c1f22', { rough: 0.5, key: 'sighouse' });
  const lamp = new THREE.SphereGeometry(0.11, 10, 8);
  // A signal on each corner, facing the approach that stops at it.
  for (let i = 1; i < XS.length - 1; i++) for (let j = 1; j < ZS.length - 1; j++) {
    const x = XS[i], z = ZS[j];
    // Far-right corner of each approach, lamps facing the drivers.
    const corners = [
      [x + HALF_ROAD + 0.6, z - HALF_ROAD - 0.6, 0, 'ns'],              // northbound
      [x - HALF_ROAD - 0.6, z + HALF_ROAD + 0.6, Math.PI, 'ns'],        // southbound
      [x + HALF_ROAD + 0.6, z + HALF_ROAD + 0.6, -Math.PI / 2, 'ew'],   // eastbound
      [x - HALF_ROAD - 0.6, z - HALF_ROAD - 0.6, Math.PI / 2, 'ew'],    // westbound
    ];
    for (const [px, pz, h, road] of corners) {
      const y0 = CURB_H;
      B.add(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8), pole, mat4(px, y0 + 2.6, pz));
      // Mast arm over the road.
      const arm = 3.2;
      const dir = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
      const toRoad = road === 'ns' ? new THREE.Vector3(Math.sign(x - px), 0, 0) : new THREE.Vector3(0, 0, Math.sign(z - pz));
      const mid = new THREE.Vector3(px, y0 + 5.1, pz).addScaledVector(toRoad, arm / 2);
      B.add(new THREE.BoxGeometry(road === 'ns' ? arm : 0.12, 0.12, road === 'ns' ? 0.12 : arm), pole, mat4(mid.x, mid.y, mid.z));
      const head = new THREE.Vector3(px, y0 + 4.6, pz).addScaledVector(toRoad, arm - 0.3);
      B.add(new THREE.BoxGeometry(0.4, 1.1, 0.3), housing, mat4(head.x, head.y, head.z, h));
      const f = dir.clone().multiplyScalar(-0.16);
      // Lamps face oncoming traffic (opposite of the heading the pole faces).
      [['red', 0.33], ['yellow', 0], ['green', -0.33]].forEach(([c, dy]) => {
        B.add(lamp.clone(), SIGNAL[`${road}_${c}`], mat4(head.x - f.x, head.y + dy, head.z - f.z), { shadow: false });
      });
      // Pedestrian signal on the pole, facing across the street it guards.
      const other = road === 'ns' ? 'ew' : 'ns';
      B.add(new THREE.BoxGeometry(0.32, 0.32, 0.22), housing, mat4(px, y0 + 2.7, pz, h));
      B.add(new THREE.BoxGeometry(0.22, 0.1, 0.02), SIGNAL[`${other}_walk`], mat4(px - f.x * 0.75, y0 + 2.76, pz - f.z * 0.75, h), { shadow: false });
      B.add(new THREE.BoxGeometry(0.22, 0.1, 0.02), SIGNAL[`${other}_dont`], mat4(px - f.x * 0.75, y0 + 2.63, pz - f.z * 0.75, h), { shadow: false });
      game.physics.add({ x: px, z: pz, hx: 0.12, hz: 0.12, y0: 0, y1: 5.2, tag: 'pole', noCam: true });
    }
  }
}

// Called by traffic each frame with the current phase.
export function setSignals(phase) {
  // phase: { ns: 'green'|'yellow'|'red', ew: ..., walkNS: bool, walkEW: bool }
  for (const road of ['ns', 'ew']) {
    for (const c of ['red', 'yellow', 'green']) SIGNAL[`${road}_${c}`].emissiveIntensity = phase[road] === c ? 4 : 0.04;
    const walk = road === 'ns' ? phase.walkNS : phase.walkEW;
    SIGNAL[`${road}_walk`].emissiveIntensity = walk ? 2.5 : 0.03;
    SIGNAL[`${road}_dont`].emissiveIntensity = walk ? 0.03 : 2.5;
  }
}
