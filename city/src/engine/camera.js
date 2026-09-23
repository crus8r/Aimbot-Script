// Third-person camera: orbits a pivot at the head, pulls in when a wall is
// between it and the character, and follows a car from behind when driving.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class FollowCamera {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.yaw = Math.PI;            // camera sits behind a +Z-facing character
    this.pitch = 0.22;
    this.dist = 4.2;
    this.distTarget = 4.2;
    this.actualDist = 4.2;
    this.pivot = new THREE.Vector3();
    this.shoulder = 0.38;
    this.fovBase = 62;
    this.mode = 'foot';
    this.sensitivity = 0.0026;
  }

  input(inp, dt) {
    this.yaw -= inp.mouse.dx * this.sensitivity;
    this.pitch += inp.mouse.dy * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.9, 1.25);
    if (inp.mouse.wheel) this.distTarget = THREE.MathUtils.clamp(this.distTarget + inp.mouse.wheel * 0.6, 1.4, 12);
    // Keyboard look for viewers without a mouse.
    if (inp.down('ArrowLeft')) this.yaw += dt * 1.8;
    if (inp.down('ArrowRight')) this.yaw -= dt * 1.8;
    if (inp.down('ArrowUp')) this.pitch = Math.max(-0.9, this.pitch - dt * 1.2);
    if (inp.down('ArrowDown')) this.pitch = Math.min(1.25, this.pitch + dt * 1.2);
  }

  // Direction the camera looks along the ground: movement is relative to it.
  groundForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt, target, { speed = 0, driving = null } = {}) {
    let desiredPivot;
    if (driving) {
      desiredPivot = _v.copy(driving.object.position).add(new THREE.Vector3(0, 1.5, 0));
      // Swing behind the car as it moves; mouse can still look around.
      const carYaw = driving.heading + Math.PI;
      if (Math.abs(driving.speed) > 2 && !this.lookingAround) {
        let d = carYaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 2.2);
        this.pitch += (0.18 - this.pitch) * Math.min(1, dt * 1.5);
      }
      this.distTarget = Math.max(this.distTarget, 6.5);
    } else {
      desiredPivot = target.headPosition(_v);
      desiredPivot.y += 0.05;
    }
    const k = Math.min(1, dt * (driving ? 8 : 14));
    this.pivot.lerp(desiredPivot, this.pivot.lengthSq() === 0 ? 1 : k);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _d.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).normalize();
    // Over-the-shoulder offset to the right of the view direction.
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = this.pivot.clone().addScaledVector(right, driving ? 0 : this.shoulder * Math.min(1, this.actualDist / 4));
    // Walls: shorten the boom to just in front of whatever blocks it.
    const hit = this.physics.raycast(pivot, _d, this.distTarget + 0.3, (b) => !b.noCam && !(driving && b.ref === driving));
    const want = Math.max(0.35, Math.min(this.distTarget, hit - 0.3));
    this.actualDist = want < this.actualDist ? want : this.actualDist + (want - this.actualDist) * Math.min(1, dt * 3);
    this.camera.position.copy(pivot).addScaledVector(_d, this.actualDist);
    // Keep the lens above whatever ground is there.
    const g = this.physics.groundAt(this.camera.position.x, this.camera.position.z, this.camera.position.y + 1, 0.5) + 0.25;
    if (this.camera.position.y < g) this.camera.position.y = g;
    this.camera.lookAt(pivot);
    const fov = this.fovBase + Math.min(12, Math.max(0, speed - 4) * 1.2);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
  }
}
