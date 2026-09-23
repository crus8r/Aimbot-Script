// Palms, shade trees, the beach, and the sea.
import * as THREE from 'three';
import { partsByMaterial, mat4, WORLD_U } from './build.js';
import { M, std } from './materials.js';
import { beachHeight, BEACH } from './layout.js';
import { rng } from './textures.js';

// A palm: curved, tapering, ringed trunk; a crown of arching fronds.
export function palmParts(seed = 1, height = 8) {
  const r = rng(seed);
  const pieces = [];
  const bend = 0.6 + r() * 1.4;
  const lean = r() * Math.PI * 2;
  const lx = Math.cos(lean), lz = Math.sin(lean);
  const N = 14, S = 8;
  const pos = [], uv = [], idx = [];
  const center = (t) => new THREE.Vector3(lx * bend * t * t, height * t, lz * bend * t * t);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const c = center(t);
    const rad = 0.24 - 0.09 * t + (i % 2 ? 0.012 : 0);
    for (let j = 0; j <= S; j++) {
      const a = (j / S) * Math.PI * 2;
      pos.push(c.x + Math.cos(a) * rad, c.y, c.z + Math.sin(a) * rad);
      uv.push(j / S, t * height / 1.2);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < S; j++) {
    const a = i * (S + 1) + j, b = a + S + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();
  pieces.push({ geo: trunk, material: M.bark() });

  const topC = center(1);
  const fronds = [];
  const nF = 11;
  for (let k = 0; k < nF; k++) {
    const phi = (k / nF) * Math.PI * 2 + r() * 0.4;
    const dir = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const L = 3.2 + r() * 1.3;
    const lift = 0.2 + r() * 0.5;
    const fp = [], fuv = [], fi = [];
    const SEG = 10;
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG;
      const along = u * L;
      const y = L * (lift * u - 0.85 * u * u);
      const w = 0.75 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.6) + 0.04;
      const c = topC.clone().addScaledVector(dir, along).add(new THREE.Vector3(0, y, 0));
      // A shallow V: the leaflets droop from the spine.
      for (const [o, dy, v] of [[-1, -0.18, 0], [0, 0.04, 0.5], [1, -0.18, 1]]) {
        fp.push(c.x + side.x * w * o, c.y + dy * w, c.z + side.z * w * o);
        fuv.push(u, v);
      }
    }
    for (let s = 0; s < SEG; s++) {
      const a = s * 3;
      fi.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    g.setIndex(fi);
    g.computeVertexNormals();
    fronds.push(g);
  }
  for (const g of fronds) pieces.push({ geo: g, material: M.frond() });
  const nut = new THREE.SphereGeometry(0.11, 6, 5);
  const nutM = std('#5a3f22', { rough: 0.7, key: 'coconut' });
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    pieces.push({ geo: nut, material: nutM, m: mat4(topC.x + Math.cos(a) * 0.22, topC.y - 0.25, topC.z + Math.sin(a) * 0.22) });
  }
  return partsByMaterial(pieces).map((p) => ({ ...p, shadow: true }));
}

// A rounded shade tree: trunk plus lumpy canopy blobs.
export function treeParts(seed = 1) {
  const r = rng(seed);
  const pieces = [];
  const h = 3 + r() * 1.2;
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, h, 7);
  pieces.push({ geo: trunk, material: M.bark(), m: mat4(0, h / 2, 0) });
  const blobs = 4 + Math.floor(r() * 3);
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(1.1 + r() * 0.7, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const s = 0.85 + r() * 0.3;
      p.setXYZ(k, p.getX(k) * s, p.getY(k) * s * 0.85, p.getZ(k) * s);
    }
    g.computeVertexNormals();
    const a = (i / blobs) * Math.PI * 2;
    const rr = i === 0 ? 0 : 0.9;
    pieces.push({ geo: g, material: M.leaves(), m: mat4(Math.cos(a) * rr, h + 0.6 + r() * 0.8, Math.sin(a) * rr) });
  }
  return partsByMaterial(pieces).map((p) => ({ ...p, shadow: true }));
}

export function buildBeach(game) {
  const { scene } = game;
  const x0 = BEACH.promenade1, x1 = BEACH.sandEnd + 30;
  const z0 = -260, z1 = 260;
  const nx = 40, nz = 60;
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const r = rng(5);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const bump = x > BEACH.promenade1 + 2 && x < BEACH.sandEnd - 20 ? (Math.sin(z * 0.07) * Math.sin(x * 0.11)) * 0.08 + (r() - 0.5) * 0.03 : 0;
    p.setY(i, beachHeight(x) + bump);
    uv.setXY(i, x / 6, z / 6);
  }
  g.computeVertexNormals();
  const sand = new THREE.Mesh(g, M.sand());
  sand.receiveShadow = true;
  scene.add(sand);
  // Damp sand darker near the waterline: a second, thin strip.
  const wet = new THREE.Mesh(new THREE.PlaneGeometry(24, z1 - z0), std('#9c8664', { rough: 0.35, key: 'wetsand', transparent: true, opacity: 0.35 }));
  wet.rotation.x = -Math.PI / 2;
  const shoreX = shoreline();
  wet.position.set(shoreX - 4, BEACH.water + 0.03, 0);
  scene.add(wet);
}

export function shoreline() {
  // Where beachHeight crosses the water level.
  let lo = BEACH.promenade1, hi = BEACH.sandEnd + 30;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (beachHeight(m) > BEACH.water) lo = m; else hi = m; }
  return lo;
}

// The sea: no planar reflection (it would double the draw calls); instead
// two scrolling normal maps, a fresnel toward the sky colour, and foam where
// the water is shallow near the known shoreline.
export function buildOcean(game, normals) {
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ color: '#1f6f7f', roughness: 0.08, metalness: 0.1, normalMap: normals, transparent: true, opacity: 0.93 });
  m.normalScale.set(0.55, 0.55);
  const shore = shoreline();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WORLD_U.time;
    sh.uniforms.uShore = { value: shore };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos2;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uShore; varying vec3 vWorldPos2;')
      .replace('#include <normal_fragment_maps>', `
        vec2 wuv = vWorldPos2.xz * 0.045;
        vec3 n1 = texture2D(normalMap, wuv + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, wuv * 1.9 - vec2(uTime * 0.017, -uTime * 0.01)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3((n1.xy + n2.xy) * normalScale, n1.z * n2.z));
        normal = normalize(tbn * mapN);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dist = vWorldPos2.x - uShore;
        float shallow = 1.0 - smoothstep(0.0, 28.0, dist);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.62, 0.6), shallow * 0.8);
        float wave = sin(dist * 0.9 - uTime * 1.3 + sin(vWorldPos2.z * 0.05) * 2.0);
        float foam = smoothstep(0.75, 1.0, wave) * (1.0 - smoothstep(0.0, 9.0, dist)) + (1.0 - smoothstep(0.0, 1.6, dist));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), clamp(foam, 0.0, 1.0) * 0.75);
        diffuseColor.a = mix(0.55, 0.95, smoothstep(0.0, 6.0, dist));`);
  };
  const g = new THREE.PlaneGeometry(4000, 4000, 1, 1);
  g.rotateX(-Math.PI / 2);
  // tangents for tbn: PlaneGeometry has uvs, three computes tbn from derivatives.
  const sea = new THREE.Mesh(g, m);
  sea.position.set(shore + 2000 - 2, BEACH.water, 0);
  sea.receiveShadow = true;
  game.scene.add(sea);
  return sea;
}
