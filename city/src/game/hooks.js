// Interactive fixtures inside rooms: TVs that switch on, lamps, the jukebox,
// fridges with drinks in them, the wardrobe, sinks and cash registers.
import * as THREE from 'three';
import { box } from '../world/build.js';
import { std } from '../world/materials.js';

const _v = new THREE.Vector3();

export function registerHooks(game) {
  const world = game.world;
  for (const room of world.rooms) {
    for (const h of room.hooks) {
      const make = HOOKS[h.kind];
      if (make) make(game, room, h);
    }
    // The piano plays while someone sits at it.
    const pianoSeat = world.seats.find((s) => s.room === room && s.kind === 'piano');
    if (pianoSeat && game.audio) {
      const src = game.audio.piano(pianoSeat.pos);
      pianoSeat.onSit = () => src.start();
      const stand = pianoSeat.onStand;
      game.updaters.push(() => { if (src.playing && pianoSeat.occupant?.state !== 'seated') src.stop(); });
    }
  }
}

// Front of a fixture, `d` metres out along its facing.
function front(h, d) {
  return new THREE.Vector3(h.pos.x + Math.sin(h.yaw) * d, h.pos.y, h.pos.z + Math.cos(h.yaw) * d).setY(h.room.y);
}

const HOOKS = {
  tv(game, room, h) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 144;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: '#050608', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0, roughness: 0.2 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(h.w, h.h), mat);
    screen.position.copy(h.pos).add(new THREE.Vector3(Math.sin(h.yaw) * 0.03, 0, Math.cos(h.yaw) * 0.03));
    screen.rotation.y = h.yaw;
    game.scene.add(screen);
    const tv = { on: room.kind === 'apartment', channel: 0, t: 0 };
    const draw = () => {
      tv.t += 0.2;
      drawTV(c.getContext('2d'), tv);
      tex.needsUpdate = true;
    };
    game.updaters.push((dt) => {
      mat.emissiveIntensity = tv.on ? 1.1 : 0;
      if (tv.on) { tv.acc = (tv.acc || 0) + dt; if (tv.acc > 0.1) { tv.acc = 0; draw(); } }
    });
    if (tv.on) draw();
    const pos = front(h, 2.0);
    game.interactions.add({ kind: 'tv', pos, radius: 2.6, label: () => (!tv.on ? 'Turn the TV on' : tv.channel < 2 ? 'Next channel' : 'Turn the TV off'), act: (a) => {
      if (!tv.on) tv.on = true;
      else if (tv.channel === 2) { tv.on = false; tv.channel = 0; }
      else tv.channel++;
      a.playLayer('point', { mask: 'armR', time: 1.2 });
      game.audio?.blip(tv.on ? 660 : 330);
    } });
    room.tv = tv;
  },

  lamp(game, room, h) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(h.small ? 0.06 : 0.09, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe0a8' }));
    glow.position.copy(h.pos);
    game.scene.add(glow);
    const spot = game.world.lights.add({ pos: h.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), color: '#ffcf90', intensity: h.small ? 4 : 8, range: 6, priority: 5 });
    game.interactions.add({ kind: 'lamp', pos: front(h, 0.7), radius: 1.5, label: () => (spot.on ? 'Turn lamp off' : 'Turn lamp on'), act: (a) => {
      spot.on = !spot.on;
      glow.visible = spot.on;
      a.playLayer('use', { mask: 'armR', time: 1 });
      game.audio?.blip(spot.on ? 1200 : 900, 0.04, 0.1);
      game.world.lights._t = 0;
    } });
  },

  jukebox(game, room, h) {
    const src = game.audio?.jukebox(h.pos, { on: room.kind === 'bar', room });
    game.interactions.add({ kind: 'jukebox', pos: front(h, 0.9), radius: 1.6, label: () => (src?.wantOn ? 'Stop the music' : 'Play the jukebox'), act: (a) => {
      src?.toggle();
      a.playLayer('use', { mask: 'armR', time: 1 });
    } });
  },

  fridge(game, room, h) {
    game.interactions.add({ kind: 'fridge', pos: front(h, h.drinks ? 0.6 : 0.8), radius: h.drinks ? 3 : 1.4, label: (a) => (a.held ? null : 'Grab a drink'), act: (a) => {
      a.playLayer('use', { mask: 'armR', time: 1 });
      game.later(0.45, () => { giveDrink(game, a); game.audio?.fizz(); });
    } });
  },

  drink(game, room, h) {
    game.interactions.add({ kind: 'drink', pos: front(h, 0.7), radius: 1.4, label: (a) => (a.held ? null : 'Get some water'), act: (a) => {
      a.playLayer('use', { mask: 'armR', time: 1 });
      game.later(0.45, () => giveDrink(game, a, 'cup'));
    } });
  },

  wardrobe(game, room, h) {
    game.interactions.add({ kind: 'wardrobe', pos: front(h, 0.8), radius: 1.6, label: () => 'Change outfit', act: (a) => {
      a.playLayer('use', { mask: 'armR', time: 1 });
      game.later(0.5, () => game.swapPlayer(a.modelKey, true));
    } });
  },

  sink(game, room, h) {
    game.interactions.add({ kind: 'sink', pos: front(h, 0.3), radius: 1.3, label: () => 'Wash your hands', act: (a) => { a.playLayer('use', { mask: 'arms', time: 1.4 }); game.audio?.fizz(); } });
  },

  stove(game, room, h) {
    game.interactions.add({ kind: 'stove', pos: front(h, 0.3), radius: 1.3, label: () => 'Cook something', act: (a) => { a.playLayer('use', { mask: 'arms', time: 1.4 }); game.audio?.blip(220, 0.3, 0.08); } });
  },

  register(game, room, h) {
    game.interactions.add({ kind: 'register', pos: front(h, 0.8), radius: 1.6, label: () => 'Pay', act: (a) => {
      a.playLayer('use', { mask: 'armR', time: 1 });
      game.audio?.blip(1320, 0.06); game.later(0.09, () => game.audio?.blip(1760, 0.08));
      const clerk = game.crowd?.npcs.find((n) => n.job === 'clerk' && n.post?.room === room);
      if (clerk) game.speech.say(clerk.actor, 'Thanks, have a good one!', { priority: 2 });
    } });
  },

  use(game, room, h) {
    game.interactions.add({ kind: 'use', pos: front(h, 0.5), radius: 1.4, label: () => h.label || 'Use', act: (a) => { a.playLayer('use', { mask: 'armR', time: 1.2 }); game.audio?.blip(990, 0.05); } });
  },
};

// One frame of whatever the TV is showing: news, a cartoon, or bars.
export function drawTV(x, tv) {
  if (tv.channel === 0) {
    // News: anchor desk, ticker.
    x.fillStyle = '#1d3557'; x.fillRect(0, 0, 256, 144);
    x.fillStyle = '#e63946'; x.fillRect(0, 112, 256, 32);
    x.fillStyle = '#f1faee'; x.font = 'bold 14px sans-serif';
    const msg = tv.ticker || 'PORT SOLANA NEWS  ·  SURF ADVISORY FOR SOLANA BEACH  ·  NEON LOUNGE ADDS LIVE PIANO  ·  DINER PIE SHORTAGE ENTERS THIRD DAY  ·  ';
    x.fillText(msg + msg, -((tv.t * 40) % 900), 133);
    x.fillStyle = '#a8dadc'; x.fillRect(96, 30, 64, 70);
    x.fillStyle = '#e9c46a'; x.beginPath(); x.arc(128, 48, 16, 0, 7); x.fill();
    x.fillStyle = '#264653'; x.fillRect(40, 92, 176, 20);
  } else if (tv.channel === 1) {
    // Cartoon: bouncing shapes.
    x.fillStyle = '#8ecae6'; x.fillRect(0, 0, 256, 144);
    x.fillStyle = '#90be6d'; x.fillRect(0, 110, 256, 34);
    const b = Math.abs(Math.sin(tv.t * 2)) * 60;
    x.fillStyle = '#ffb703'; x.beginPath(); x.arc(80 + Math.sin(tv.t) * 40, 100 - b, 18, 0, 7); x.fill();
    x.fillStyle = '#fb8500'; x.fillRect(170 + Math.cos(tv.t * 1.3) * 30, 80, 30, 30);
  } else {
    const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    cols.forEach((col, i) => { x.fillStyle = col; x.fillRect((i * 256) / 7, 0, 256 / 7 + 1, 110); });
    x.fillStyle = '#111'; x.fillRect(0, 110, 256, 34);
  }
}

// Held drinks follow the right hand; E drinks, Q drops.
export function giveDrink(game, actor, kind = 'can') {
  if (actor.held) return;
  const colors = ['#d62828', '#f77f00', '#2a9d8f', '#1d3557', '#8338ec'];
  const geo = kind === 'cup' ? new THREE.CylinderGeometry(0.035, 0.028, 0.09, 12) : new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12);
  const mesh = new THREE.Mesh(geo, std(kind === 'cup' ? '#f4f4f2' : colors[Math.floor(Math.random() * colors.length)], { rough: 0.3, metal: kind === 'cup' ? 0 : 0.6, key: `held${kind}` }));
  mesh.castShadow = true;
  game.scene.add(mesh);
  actor.held = { mesh, kind, sips: 0 };
}

export function updateHeld(game) {
  for (const a of game.actors) {
    const h = a.held;
    if (!h) continue;
    const hand = a.bones.get('RightHand'), mid = a.bones.get('RightHandMiddle1') || hand, idx = a.bones.get('RightHandIndex1'), pinky = a.bones.get('RightHandPinky1');
    const p0 = hand.getWorldPosition(new THREE.Vector3());
    const p1 = mid.getWorldPosition(new THREE.Vector3());
    const along = p1.clone().sub(p0).normalize();
    // Across the knuckles: the can's axis when it is gripped.
    const across = idx && pinky ? idx.getWorldPosition(new THREE.Vector3()).sub(pinky.getWorldPosition(new THREE.Vector3())).normalize() : new THREE.Vector3(0, 1, 0);
    const palm = new THREE.Vector3().crossVectors(across, along).normalize();
    h.mesh.position.copy(p0).lerp(p1, 0.9).addScaledVector(palm, 0.045);
    h.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), across);
    h.mesh.visible = a.object.visible;
  }
}

export function heldInteraction(game, actor) {
  if (!actor.held) return null;
  return { kind: 'held', label: () => 'Take a sip   ·   Q: drop it', act: (a) => {
    a.playLayer('drink', { mask: ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'Head', 'Neck'], time: 2.2, opts: a.state === 'seated' ? { seated: true, h: a.seat.h } : undefined });
    // The authored drink clip lifts at 2.6s; start the layer there.
    a.layer.t = 2.4;
    a.layer.until = 4.6;
    a.held.sips++;
  } };
}

export function dropHeld(game, actor) {
  if (!actor.held) return;
  const m = actor.held.mesh;
  actor.held = null;
  // Let it fall to the ground and stay a while.
  const vy = { v: 0 };
  const g = game.physics.groundAt(m.position.x, m.position.z, m.position.y) + 0.06;
  const fall = (dt) => {
    vy.v -= 9.8 * dt;
    m.position.y = Math.max(g, m.position.y + vy.v * dt);
    if (m.position.y <= g) { m.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2); game.updaters.splice(game.updaters.indexOf(fall), 1); game.later(30, () => m.removeFromParent()); }
  };
  game.updaters.push(fall);
}
