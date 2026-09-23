// Geometry plumbing for the city: metric-UV boxes, and a batcher that merges
// thousands of pieces into a few meshes per material per chunk (so the city
// is tens of draw calls, and whole blocks still get frustum-culled).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared uniforms every city material listens to.
export const WORLD_U = { night: { value: 0 }, time: { value: 0 } };

// A box whose UVs are in tile units, so a 3m-tile texture tiles every 3m on
// any size of box. Faces: +x -x +y -y +z -z, 4 verts each.
export function box(w, h, d, { tile = 1, tileU, tileV, u0 = 0, v0 = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const tu = tileU ?? tile, tv = tileV ?? tile;
  const face = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = face[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * fw / tu, v0 + uv.getY(i) * fh / tv);
    }
  }
  return g;
}

export function plane(w, d, { tile = 1, u0 = 0, v0 = 0 } = {}) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * w / tile, v0 + uv.getY(i) * d / tile);
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

export function mat4(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

export class Batcher {
  constructor(scene, chunk = 76) {
    this.scene = scene;
    this.chunk = chunk;
    this.groups = new Map();
    this.meshes = [];
  }

  // Adds a geometry (consumed) under a material; `m` places it.
  add(geo, material, m, { shadow = true, receive = true, chunkKey } = {}) {
    if (m) geo.applyMatrix4(m);
    // Chunk by the piece's centre.
    let ck = chunkKey;
    if (ck === undefined) {
      geo.computeBoundingSphere();
      const c = geo.boundingSphere.center;
      ck = `${Math.floor(c.x / this.chunk)},${Math.floor(c.z / this.chunk)}`;
    }
    const key = `${material.uuid}|${ck}|${shadow}|${receive}`;
    let g = this.groups.get(key);
    if (!g) { g = { material, geos: [], shadow, receive }; this.groups.set(key, g); }
    g.geos.push(geo);
  }

  flush() {
    for (const g of this.groups.values()) {
      const norm = g.geos.map((x) => (x.index ? x.toNonIndexed() : x));
      for (const x of norm) {
        for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
        if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
      }
      const merged = mergeGeometries(norm, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, g.material);
      mesh.castShadow = g.shadow;
      mesh.receiveShadow = g.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.groups.clear();
  }
}

// Instanced props: one InstancedMesh per sub-mesh of a prop type.
export class Instancer {
  constructor(scene) {
    this.scene = scene;
    this.types = new Map();
  }

  // parts: [{ geo, material, shadow }]
  define(name, parts) { this.types.set(name, { parts, mats: [] }); }

  place(name, m) {
    const t = this.types.get(name);
    if (!t) throw new Error(`no prop type ${name}`);
    t.mats.push(m.clone());
  }

  flush() {
    for (const [name, t] of this.types) {
      if (!t.mats.length) continue;
      for (const p of t.parts) {
        const im = new THREE.InstancedMesh(p.geo, p.material, t.mats.length);
        t.mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = p.shadow ?? true;
        im.receiveShadow = true;
        im.name = `inst:${name}`;
        im.computeBoundingSphere();
        this.scene.add(im);
      }
    }
  }
}

// Merge a prop's parts into one geometry per material, for props built from
// many primitives (a bench is 9 boxes; it should be 2 draws for 40 benches).
export function partsByMaterial(pieces) {
  const byMat = new Map();
  for (const { geo, material, m } of pieces) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!byMat.has(material)) byMat.set(material, []);
    byMat.get(material).push(g);
  }
  return [...byMat].map(([material, geos]) => ({ geo: mergeGeometries(geos, false), material }));
}
