// Hero props from real models (Khronos sample assets, see assets/CREDITS.md),
// placed at spots the rooms leave for them. Each is normalised to a real
// size on load: the files come in whatever units their authors used.
import * as THREE from 'three';
import { makeSeat } from '../game/seats.js';
import { loadGLB } from '../core/loadglb.js';

const FILES = {
  armchair: { file: 'ChairDamaskPurplegold', size: { y: 1.0 } },
  boombox: { file: 'BoomBox', size: { x: 0.5 } },
  vase: { file: 'GlassVaseFlowers', size: { y: 0.45 } },
  lantern: { file: 'Lantern', size: { y: 0.42 } },
  bottle: { file: 'WaterBottle', size: { y: 0.24 } },
  truck: { file: 'CesiumMilkTruck', size: { z: 6.2 } },
  sofa: { file: 'GlamVelvetSofa', size: { x: 2.2 } },
};

export async function loadModelProps(game, keys = Object.keys(FILES)) {
  const out = {};
  await Promise.all(Object.entries(FILES).filter(([k]) => keys.includes(k)).map(async ([k, def]) => {
    try {
      const g = await loadGLB(game.loader, `assets/props/${def.file}.glb`);
      const root = g.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const [axis, want] = Object.entries(def.size)[0];
      const s = want / size[axis];
      // Pivot at the base centre, scaled to size.
      const inner = new THREE.Group();
      root.position.sub(new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2));
      inner.add(root);
      inner.scale.setScalar(s);
      inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      out[k] = { proto: inner, size: size.multiplyScalar(s) };
    } catch (e) { console.warn(`prop ${k} failed`, e); }
  }));
  return out;
}

function put(game, props, key, x, y, z, rot = 0) {
  const p = props[key];
  if (!p) return null;
  const o = p.proto.clone();
  o.position.set(x, y, z);
  o.rotation.y = rot;
  game.scene.add(o);
  return o;
}

export function placeModelProps(game, props) {
  const world = game.world;
  for (const room of world.rooms) {
    const at = (lx, ly, lz, rot = 0) => { const [x, z] = room.w(lx, lz); return [x, room.y + ly, z, room.yaw + rot]; };
    if (room.kind === 'apartment') {
      const a = room.armchairSpot;
      if (a && props.armchair) {
        put(game, props, 'armchair', ...at(a.x, 0, a.z, a.rot));
        const [x, y, z, h] = at(a.x, 0, a.z + 0.02, a.rot);
        const seat = makeSeat({ x: x + Math.sin(h) * 0.04, y, z: z + Math.cos(h) * 0.04, heading: h, h: 0.45, kind: 'sofa', opts: { lean: -8 } });
        seat.room = room;
        world.addSeat(seat, 'apartment');
        const c = room.w(a.x, a.z);
        game.physics.add({ x: c[0], z: c[1], hx: 0.4, hz: 0.4, rot: room.yaw + a.rot, y0: room.y, y1: room.y + 1.0, tag: 'furniture', noCam: true });
      }
      put(game, props, 'boombox', ...at(3.8 + 0.55, 0.5, -room.D / 2 + 5 + 0.35, 0));
      put(game, props, 'vase', ...at(-room.W / 2 + 3.4, 0.77, room.D / 2 - 2.2));
    }
    if (room.kind === 'diner') {
      put(game, props, 'vase', ...at(-3.5, 0.77, 0.6));
      put(game, props, 'vase', ...at(0.5, 0.77, 0.6));
    }
    if (room.kind === 'bar') {
      put(game, props, 'lantern', ...at(1.0, 1.07, room.D / 2 - 1.6));
      put(game, props, 'lantern', ...at(-4.4, 1.07, -4.8));
    }
    if (room.kind === 'office') {
      put(game, props, 'bottle', ...at(-1.4, 0.76, -room.D / 2 + 2.3));
      put(game, props, 'bottle', ...at(3.3, 0.76, -room.D / 2 + 5.3));
      put(game, props, 'vase', ...at(-room.W / 2 + 3.4, 1.07, room.D / 2 - 3.2));
    }
    if (room.kind === 'boutique' && props.sofa) {
      // The velvet sofa stands in for the procedural one's look.
      put(game, props, 'sofa', ...at(1.5, 0, room.D / 2 - 1.2, Math.PI));
    }
  }
  // A food truck on Main Street by the pier.
  if (props.truck) {
    const t = put(game, props, 'truck', 170, 0.02, 4.75, Math.PI / 2);
    game.physics.add({ x: 170, z: 4.75, hx: 3.1, hz: 1.2, rot: Math.PI / 2, y0: 0, y1: 2.6, tag: 'truck', noCam: true });
    return t;
  }
  return null;
}
