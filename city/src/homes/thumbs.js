// Catalogue pictures, rendered from the real furniture: one small offscreen
// renderer, a studio light, a three-quarter view fitted to each piece.
// Rendered on demand (a category at a time) and kept.
import * as THREE from 'three';
import { prepared } from './catalog.js';

export class Thumbs {
  constructor(models, size = 128) {
    this.models = models;
    this.size = size;
    this.cache = new Map();
    this.renderer = null;
  }

  init() {
    if (this.renderer) return true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = this.size;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(this.size, this.size, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
    } catch {
      return false;
    }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9aa6a0', 2.2));
    const key = new THREE.DirectionalLight('#fff4e0', 2.4);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    return true;
  }

  // A data URL for a catalogue entry (null if it can't be drawn yet).
  get(entry) {
    if (this.cache.has(entry.id)) return this.cache.get(entry.id);
    if (!this.init()) return null;
    const prep = prepared(entry, this.models);
    if (!prep) return null;
    const g = new THREE.Group();
    if (prep.proto) g.add(prep.proto.clone());
    else for (const p of prep.parts) g.add(new THREE.Mesh(p.geo, p.material));
    this.scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(0.15, sphere.radius);
    const d = r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
    const dir = new THREE.Vector3(0.62, 0.55, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, d);
    this.camera.near = d / 50; this.camera.far = d * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(sphere.center);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(g);
    this.cache.set(entry.id, url);
    return url;
  }
}
