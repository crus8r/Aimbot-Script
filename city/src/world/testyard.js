// A small yard for checking movement, seats and beds without the city.
import * as THREE from 'three';
import { makeSeat, seatInteraction } from '../game/seats.js';

export async function buildTestYard(game) {
  const { scene, physics } = game;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x8a9a7a, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8c8b0, roughness: 0.8 });
  const box = (x, z, w, d, h, y0 = 0, walk = false, m = mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    physics.add({ x, z, hx: w / 2, hz: d / 2, y0, y1: y0 + h, walk });
    return mesh;
  };
  box(0, -8, 12, 0.3, 3);                    // a wall
  box(6, 0, 4, 4, 0.15, 0, true);            // a curb-height platform
  for (let i = 0; i < 6; i++) box(-6, 2 + i * 0.35, 2, 0.35, 0.18 * (i + 1), 0, true); // stairs
  // Chair facing +Z at (2, 3).
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a });
  box(2, 3 - 0.05, 0.45, 0.45, 0.44, 0, false, chairMat);
  box(2, 3 - 0.27, 0.45, 0.06, 0.5, 0.44, false, chairMat);
  const chair = makeSeat({ x: 2, z: 3, heading: 0, h: 0.46, kind: 'chair' });
  game.interactions.add(seatInteraction(chair, game));
  // Bed along Z at (-2, 4): head end at -Z. Sit on its +X edge facing +X.
  const bedMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0 });
  box(-2, 4, 1.4, 2.0, 0.5, 0, false, bedMat);
  const bed = makeSeat({ x: -2 + 0.45, z: 4.2, heading: Math.PI / 2, h: 0.52, kind: 'bed' });
  game.interactions.add(seatInteraction(bed, game));
  game.testSeats = { chair, bed };
  const player = game.addActor(game.params.get('model') || 'man', {}, { name: 'You' });
  player.place(0, 0, 0, 0);
  game.setPlayer(player);
}
