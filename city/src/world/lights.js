// Real point lights are expensive, so there are only a few. Every lamp in
// the city registers a light *spot*; each frame the nearest lit spots to the
// camera borrow a light from the pool. Far lamps glow (emissive + bloom),
// near ones actually light the pavement.
import * as THREE from 'three';

export class LightPool {
  constructor(scene, n = 10) {
    this.spots = [];
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 18, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
    this._t = 0;
  }

  // spot: { pos, color, intensity, range, night (only after dark), on }
  add(spot) {
    spot.on = spot.on ?? true;
    spot.color = new THREE.Color(spot.color || '#ffd9a0');
    this.spots.push(spot);
    return spot;
  }

  update(dt, camPos, night) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.25;
    const cand = [];
    for (const s of this.spots) {
      if (!s.on) continue;
      if (s.night && night < 0.3) continue;
      const d = s.pos.distanceToSquared(camPos);
      if (d > 60 * 60) continue;
      cand.push([d / (s.priority || 1), s]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const c = cand[i];
      // Never toggle .visible: a change in light count recompiles every
      // shader in the scene, a visible hitch. Unused lights just go dark.
      if (!c) { l.intensity = 0; continue; }
      const s = c[1];
      l.position.copy(s.pos);
      l.color.copy(s.color);
      l.distance = s.range || 18;
      l.intensity = (s.intensity ?? 30) * (s.night ? Math.min(1, (night - 0.3) / 0.4) : 1);
    }
  }
}
