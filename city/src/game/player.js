// The player's controller: turns keys into an Actor's intent and verbs.
import * as THREE from 'three';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

export const SPEEDS = { walk: 1.55, run: 4.2, sprint: 6.4 };

export class PlayerController {
  constructor(game, actor) {
    this.game = game;
    this.actor = actor;
    this.walkToggle = false;
  }

  update(dt) {
    const { input, follow } = this.game;
    const a = this.actor;
    if (a.state === 'driving') return;
    const it = a.intent;
    follow.groundForward(_f);
    _r.set(-_f.z, 0, _f.x);    // camera-right on the ground
    let mx = 0, mz = 0;
    if (input.down('KeyW')) mz += 1;
    if (input.down('KeyS')) mz -= 1;
    if (input.down('KeyA')) mx -= 1;
    if (input.down('KeyD')) mx += 1;
    it.dir.set(0, 0, 0).addScaledVector(_f, mz).addScaledVector(_r, mx);
    const moving = it.dir.lengthSq() > 0;
    if (moving) it.dir.normalize();
    if (input.hit('CapsLock', 'KeyC')) this.walkToggle = !this.walkToggle;
    const sprint = input.down('ShiftLeft', 'ShiftRight');
    it.speed = !moving ? 0 : sprint ? (this.walkToggle ? SPEEDS.run : SPEEDS.sprint) : this.walkToggle ? SPEEDS.run : SPEEDS.walk;
    it.face = null;

    // Leaving a seat/bed or an emote: any movement key does it.
    if (moving && (a.state === 'seated' || a.state === 'lying') && !a.busy) a.stand();
    if (moving && a.state === 'action') a.endAction();
    if (moving && a.layer?.loop && a.layer.name !== 'talk') a.stopLayer();
    if (input.hit('Space')) {
      if (a.state === 'free' && a.grounded) it.jump = true;
    }
  }
}
