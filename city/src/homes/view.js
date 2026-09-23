// The build-and-watch camera: looks down at a point on the ground from a
// yaw, a pitch and a distance, the way life sims do. Everything eases, so
// quarter turns and zooms glide instead of jumping.
//
// Pointer gestures are sorted here and handed on: a tap is a click for the
// current tool, a drag pans (or, if the tool claims it, drags furniture),
// right-drag orbits, two fingers pinch-zoom and twist.
import * as THREE from 'three';

const TAP_PX = 7;

export class HomeView {
  constructor(camera, dom, input) {
    this.camera = camera;
    this.dom = dom;
    this.input = input;
    this.target = new THREE.Vector3(0, 0, 2);
    this.goal = { x: 0, z: 2, yaw: Math.PI / 4, pitch: 0.8, dist: 24 };
    this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.dist = this.goal.dist;
    this.bounds = { x0: -20, x1: 20, z0: -20, z1: 22 };
    this.tool = null;               // { hover(ev), click(ev), dragStart(ev) -> bool, drag(ev), dragEnd(ev) }
    this.pointers = new Map();
    this.gesture = null;
    this.ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this.bind();
  }

  // ------------------------------------------------------------ pointer

  bind() {
    const el = this.dom;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.move(e));
    addEventListener('pointerup', (e) => this.up(e));
    addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  ndc(e) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  // A ray from the camera through the pointer.
  rayFrom(e) {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    return this.ray;
  }

  // Where the pointer meets the horizontal plane y.
  groundAt(e, y = 0) {
    const r = this.rayFrom(e).ray;
    if (Math.abs(r.direction.y) < 1e-4) return null;
    const t = (y - r.origin.y) / r.direction.y;
    if (t < 0) return null;
    return r.origin.clone().addScaledVector(r.direction, t);
  }

  down(e) {
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button, type: e.pointerType });
    if (this.pointers.size === 2) {
      // Second finger: whatever the first was doing becomes a pinch.
      if (this.gesture?.kind === 'tool') this.tool?.dragEnd?.(e, true);
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    this.gesture = { kind: 'pending', button: e.button, ev: e };
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && e.target === this.dom) this.tool?.hover?.(e);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (g.d > 10) this.zoomBy(g.d / d);
      let da = ang - g.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      this.goal.yaw -= da;
      this.panPixels(mx - g.mx, my - g.my);
      Object.assign(g, { d, ang, mx, my });
      return;
    }
    if (g.kind === 'pending') {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_PX) { if (p.type === 'mouse') this.tool?.hover?.(e); return; }
      if (g.button === 2 || g.button === 1) g.kind = 'orbit';
      else if (this.tool?.dragStart?.(g.ev)) g.kind = 'tool';
      else g.kind = 'pan';
    }
    if (g.kind === 'pan') this.panPixels(dx, dy);
    else if (g.kind === 'orbit') { this.goal.yaw -= dx * 0.008; this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 0.005, 0.3, 1.45); }
    else if (g.kind === 'tool') this.tool?.drag?.(e);
  }

  up(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (this.pointers.size === 1 && g?.kind === 'pinch') {
      // One finger lifted from a pinch: carry on panning with the other.
      this.gesture = { kind: 'pan' };
      return;
    }
    if (this.pointers.size) return;
    this.gesture = null;
    if (!g || cancelled) return;
    if (g.kind === 'pending' && g.button !== 2) this.tool?.click?.(e);
    else if (g.kind === 'pending' && g.button === 2) this.tool?.alt?.(e);
    else if (g.kind === 'tool') this.tool?.dragEnd?.(e);
  }

  // ------------------------------------------------------------ camera

  // Screen-space drag to ground-space pan: grab the ground and move it.
  panPixels(dx, dy) {
    const k = this.dist * 0.0016 * (720 / Math.max(400, innerHeight));
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // Right on screen is (cos, -sin) on the ground; up is away from camera.
    this.goal.x -= (dx * c + dy * s / Math.max(0.35, Math.sin(this.pitch))) * k;
    this.goal.z -= (-dx * s + dy * c / Math.max(0.35, Math.sin(this.pitch))) * k;
  }

  zoomBy(f) { this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * f, 4, 70); }

  // Quarter turns, the classic way.
  turn(dir) {
    const q = Math.PI / 2;
    this.goal.yaw = Math.round((this.goal.yaw - Math.PI / 4) / q) * q + Math.PI / 4 + dir * q;
  }

  focus(x, z, { dist, pitch, yaw, instant = false } = {}) {
    this.goal.x = x; this.goal.z = z;
    if (dist !== undefined) this.goal.dist = dist;
    if (pitch !== undefined) this.goal.pitch = pitch;
    if (yaw !== undefined) this.goal.yaw = yaw;
    if (instant) this.snap();
  }

  snap() {
    this.target.set(this.goal.x, 0, this.goal.z);
    this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.dist = this.goal.dist;
    this.apply();
  }

  // A panel covers the bottom `px` of the screen: slide the picture up by
  // half of it, so what the camera looks at stays in the part you can see.
  setSheet(px) {
    if (px > 0) this.camera.setViewOffset(innerWidth, innerHeight, 0, px / 2, innerWidth, innerHeight);
    else this.camera.clearViewOffset();
  }

  // Horizontal direction from the target to the camera.
  viewDir(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  update(dt, typing = false) {
    const inp = this.input;
    if (!typing) {
      const sp = this.dist * 0.9 * dt;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      let fx = 0, fz = 0;
      if (inp.down('KeyW', 'ArrowUp')) fz -= 1;
      if (inp.down('KeyS', 'ArrowDown')) fz += 1;
      if (inp.down('KeyA', 'ArrowLeft')) fx -= 1;
      if (inp.down('KeyD', 'ArrowRight')) fx += 1;
      this.goal.x += (fx * c + fz * s) * sp;
      this.goal.z += (-fx * s + fz * c) * sp;
      if (inp.hit('KeyQ') || inp.hit('Comma')) this.turn(-1);
      if (inp.hit('KeyE') || inp.hit('Period')) this.turn(1);
      if (inp.down('Equal', 'NumpadAdd', 'KeyZ')) this.zoomBy(1 - dt * 1.5);
      if (inp.down('Minus', 'NumpadSubtract', 'KeyX')) this.zoomBy(1 + dt * 1.5);
      if (inp.down('PageUp')) this.goal.pitch = Math.min(1.45, this.goal.pitch + dt);
      if (inp.down('PageDown')) this.goal.pitch = Math.max(0.3, this.goal.pitch - dt);
    }
    if (inp.mouse.wheel) this.zoomBy(Math.pow(1.12, inp.mouse.wheel));
    const b = this.bounds;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, b.x0, b.x1);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, b.z0, b.z1);
    const k = 1 - Math.exp(-dt * 9);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.dist += (this.goal.dist - this.dist) * k;
    this.apply();
  }

  apply() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist + 0.5,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target.x, this.target.y + 0.5, this.target.z);
  }
}
