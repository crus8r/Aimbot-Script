/**
 * Character animation.
 *
 * Poses are authored as bone euler targets and blended toward; on top of that
 * sit additive layers — breathing, weight shift, head/eye aim, jaw — that run
 * continuously. The additive layers are what stop a held pose reading as a
 * mannequin, and they cost almost nothing.
 *
 * Bind pose has every bone axis-aligned with world, so for the LEFT arm a
 * positive Z rotation abducts and a negative X rotation swings forward; the
 * right arm mirrors Z and Y.
 */

import * as THREE from 'three';

const d = THREE.MathUtils.degToRad;

/**
 * Pose library. Values are euler triples in degrees for readability.
 * Only bones that differ from bind need listing.
 */
export const POSES = {
  idle: {
    upperArmL: [-4, 0, 6], foreArmL: [-14, 0, 3],
    upperArmR: [-4, 0, -6], foreArmR: [-14, 0, -3],
    spine: [1, 0, 0], chest: [-1, 0, 0], neck: [2, 0, 0],
  },
  idleAlt: {
    upperArmL: [-6, 0, 9], foreArmL: [-22, 0, 5],
    upperArmR: [-3, 0, -5], foreArmR: [-10, 0, -2],
    spine: [1, 3, 0], chest: [-1, -2, 0], neck: [1, -3, 0], hips: [0, 2, 0],
  },
  listen: {
    upperArmL: [-8, 0, 8], foreArmL: [-38, 0, 6],
    upperArmR: [-8, 0, -8], foreArmR: [-38, 0, -6],
    spine: [2, 0, 0], chest: [-2, 0, 0], neck: [4, 0, 3], head: [2, 0, 4],
  },
  talk: {
    upperArmL: [-16, 0, 14], foreArmL: [-58, 0, 10],
    upperArmR: [-6, 0, -8], foreArmR: [-22, 0, -4],
    spine: [1, -3, 0], chest: [-2, 2, 0], neck: [2, 2, 0],
  },
  talkBoth: {
    upperArmL: [-20, 0, 20], foreArmL: [-66, 0, 12],
    upperArmR: [-20, 0, -20], foreArmR: [-66, 0, -12],
    spine: [-2, 0, 0], chest: [3, 0, 0], neck: [-2, 0, 0],
  },
  sing: {
    upperArmL: [-14, 0, 28], foreArmL: [-30, 0, 10],
    upperArmR: [-14, 0, -28], foreArmR: [-30, 0, -10],
    spine: [-5, 0, 0], chest: [7, 0, 0], neck: [-6, 0, 0], head: [-4, 0, 0],
  },
  singBig: {
    upperArmL: [-30, 0, 68], foreArmL: [-24, 0, 8],
    upperArmR: [-30, 0, -68], foreArmR: [-24, 0, -8],
    spine: [-8, 0, 0], chest: [11, 0, 0], neck: [-9, 0, 0], head: [-7, 0, 0],
  },
  point: {
    upperArmL: [-72, 0, 16], foreArmL: [-8, 0, 2], handL: [0, 0, 0],
    upperArmR: [-4, 0, -6], foreArmR: [-14, 0, -3],
    spine: [2, -8, 0], chest: [-1, 6, 0], neck: [0, 4, 0],
  },
  cast: {
    upperArmL: [-84, 0, 24], foreArmL: [-30, 0, 10],
    upperArmR: [-84, 0, -24], foreArmR: [-30, 0, -10],
    spine: [-6, 0, 0], chest: [9, 0, 0], neck: [-8, 0, 0], head: [-5, 0, 0],
  },
  castOne: {
    upperArmL: [-96, 0, 18], foreArmL: [-18, 0, 6],
    upperArmR: [-10, 0, -8], foreArmR: [-26, 0, -4],
    spine: [-3, -6, 0], chest: [5, 4, 0], neck: [-4, 2, 0],
  },
  reach: {
    upperArmL: [-64, 0, 12], foreArmL: [-16, 0, 4],
    upperArmR: [-58, 0, -12], foreArmR: [-20, 0, -4],
    spine: [-4, 0, 0], chest: [6, 0, 0], neck: [-3, 0, 0],
  },
  afraid: {
    upperArmL: [-30, 0, 4], foreArmL: [-84, 0, 8],
    upperArmR: [-30, 0, -4], foreArmR: [-84, 0, -8],
    clavL: [0, 0, 8], clavR: [0, 0, -8],
    spine: [8, 0, 0], chest: [6, 0, 0], neck: [8, 0, 0], head: [6, 0, 0],
  },
  angry: {
    upperArmL: [-14, 0, 12], foreArmL: [-46, 0, 8],
    upperArmR: [-14, 0, -12], foreArmR: [-46, 0, -8],
    spine: [7, 0, 0], chest: [4, 0, 0], neck: [-4, 0, 0], head: [-3, 0, 0],
    hips: [3, 0, 0],
  },
  tender: {
    upperArmL: [-40, 0, 6], foreArmL: [-76, 0, 12],
    upperArmR: [-8, 0, -7], foreArmR: [-20, 0, -3],
    spine: [3, 0, 0], chest: [-2, 0, 0], neck: [5, 0, 2], head: [3, 0, 3],
  },
  resolute: {
    upperArmL: [-2, 0, 5], foreArmL: [-10, 0, 2],
    upperArmR: [-2, 0, -5], foreArmR: [-10, 0, -2],
    spine: [-3, 0, 0], chest: [4, 0, 0], neck: [-4, 0, 0], head: [-3, 0, 0],
  },
  sad: {
    upperArmL: [-2, 0, 3], foreArmL: [-18, 0, 2],
    upperArmR: [-2, 0, -3], foreArmR: [-18, 0, -2],
    clavL: [0, 0, -6], clavR: [0, 0, 6],
    spine: [9, 0, 0], chest: [5, 0, 0], neck: [12, 0, 0], head: [8, 0, 0],
  },
  joyful: {
    upperArmL: [-40, 0, 74], foreArmL: [-30, 0, 14],
    upperArmR: [-40, 0, -74], foreArmR: [-30, 0, -14],
    spine: [-7, 0, 0], chest: [9, 0, 0], neck: [-8, 0, 0], head: [-6, 0, 0],
  },
  wonder: {
    upperArmL: [-56, 0, 22], foreArmL: [-52, 0, 10],
    upperArmR: [-8, 0, -6], foreArmR: [-18, 0, -3],
    spine: [-5, 0, 0], chest: [6, 0, 0], neck: [-10, 0, 0], head: [-8, 0, 0],
  },
  bow: {
    upperArmL: [-18, 0, 10], foreArmL: [-40, 0, 6],
    upperArmR: [-18, 0, -10], foreArmR: [-40, 0, -6],
    spine: [34, 0, 0], chest: [12, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0],
    hips: [8, 0, 0],
  },
  kneel: {
    thighL: [-88, 0, 4], shinL: [96, 0, 0], footL: [-12, 0, 0],
    thighR: [-24, 0, -6], shinR: [30, 0, 0],
    upperArmL: [-14, 0, 8], foreArmL: [-40, 0, 6],
    upperArmR: [-14, 0, -8], foreArmR: [-40, 0, -6],
    spine: [6, 0, 0], hips: [0, 0, 0],
  },
  sit: {
    thighL: [-84, 2, 3], shinL: [80, 0, 0], footL: [4, 0, 0],
    thighR: [-84, -2, -3], shinR: [80, 0, 0], footR: [4, 0, 0],
    upperArmL: [-10, 0, 6], foreArmL: [-46, 0, 6],
    upperArmR: [-10, 0, -6], foreArmR: [-46, 0, -6],
    spine: [3, 0, 0], chest: [-1, 0, 0],
  },
};

/** Emotion -> a pose that reads it, for speaking and for singing. */
const EMOTION_POSE = {
  neutral: ['talk', 'idle'],
  angry: ['angry', 'talkBoth'],
  tender: ['tender', 'talk'],
  afraid: ['afraid', 'talk'],
  sad: ['sad', 'talk'],
  joyful: ['joyful', 'talkBoth'],
  resolute: ['resolute', 'talk'],
  wonder: ['wonder', 'talk'],
};

/** Choose a speaking pose for an emotion and intensity. */
export function poseForBeat(beat) {
  const emotion = beat.emotion || 'neutral';
  const options = EMOTION_POSE[emotion] || EMOTION_POSE.neutral;
  if (beat.type === 'lyric' || beat.singing) {
    return (beat.intensity ?? 0.4) > 0.55 ? 'singBig' : 'sing';
  }
  return (beat.intensity ?? 0.3) > 0.5 ? options[0] : options[1] || options[0];
}

const BONE_KEYS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'foreArmL', 'handL',
  'clavR', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
];

/**
 * Layered animator for one character.
 */
export class Animator {
  constructor(character, seed = 0) {
    this.character = character;
    this.bones = character.userData.bones;
    this.eyes = character.userData.eyes || [];
    this.seed = seed;

    this.current = {};
    this.target = {};
    for (const key of BONE_KEYS) {
      this.current[key] = new THREE.Vector3();
      this.target[key] = new THREE.Vector3();
    }

    this.poseName = 'idle';
    this.blendRate = 3.2;
    this.talking = 0;
    this.mouthOpen = 0;
    this.mouthTarget = 0;
    this.lookTarget = null;
    this.lookWeight = 0;
    this.blinkTimer = 1 + Math.random() * 3;
    this.blinkPhase = -1;
    this.blinkAmount = 0;   // read by the avatar expression driver
    this.emotion = 'neutral';
    this.gestureTimer = 0;
    this.walkPhase = 0;
    this.walkSpeed = 0;
    this.sitting = false;

    this.setPose('idle', true);
  }

  /** Apply a named pose as the new blend target. */
  setPose(name, immediate = false) {
    const pose = POSES[name] || POSES.idle;
    this.poseName = name;
    this.sitting = name === 'sit' || name === 'kneel';
    for (const key of BONE_KEYS) {
      const v = pose[key];
      this.target[key].set(v ? d(v[0]) : 0, v ? d(v[1]) : 0, v ? d(v[2]) : 0);
      if (immediate) this.current[key].copy(this.target[key]);
    }
  }

  /** Aim head and eyes at a world position. */
  lookAt(worldPosition, weight = 1) {
    this.lookTarget = worldPosition;
    this.lookWeightTarget = weight;
  }

  clearLook() { this.lookWeightTarget = 0; }

  /** 0..1 — drive from audio RMS for real lip sync, or leave to the talk layer. */
  setMouthOpen(v) { this.mouthTarget = THREE.MathUtils.clamp(v, 0, 1); }

  setTalking(on, intensity = 0.5) {
    this.talking = on ? Math.max(0.25, intensity) : 0;
  }

  /** Trigger a one-off emphasis gesture. */
  gesture(duration = 0.6) { this.gestureTimer = duration; }

  setWalking(speed) { this.walkSpeed = speed; }

  update(dt, elapsed) {
    const t = elapsed + this.seed * 7.31;

    // --- Blend toward the pose target ------------------------------------
    const k = 1 - Math.exp(-this.blendRate * dt);
    for (const key of BONE_KEYS) {
      this.current[key].lerp(this.target[key], k);
    }

    // --- Write base pose --------------------------------------------------
    for (const key of BONE_KEYS) {
      const bone = this.bones[key];
      if (!bone) continue;
      const c = this.current[key];
      bone.rotation.set(c.x, c.y, c.z);
    }

    // --- Additive: breathing ---------------------------------------------
    const breath = Math.sin(t * 1.15) * 0.5 + 0.5;
    if (this.bones.chest) {
      this.bones.chest.rotation.x += (breath - 0.5) * 0.035;
      this.bones.chest.scale.setScalar(1 + breath * 0.012);
    }
    if (this.bones.spine) this.bones.spine.rotation.x += (breath - 0.5) * 0.018;

    // --- Additive: idle weight shift and sway ----------------------------
    if (!this.sitting && this.walkSpeed < 0.05) {
      const sway = Math.sin(t * 0.42) * 0.030 + Math.sin(t * 0.27) * 0.018;
      const bobY = Math.sin(t * 0.84) * 0.006;
      if (this.bones.hips) {
        this.bones.hips.rotation.z += sway * 0.4;
        this.bones.hips.rotation.y += Math.sin(t * 0.31) * 0.035;
        this.bones.hips.position.y = 0.95 + bobY;
      }
      if (this.bones.chest) this.bones.chest.rotation.z -= sway * 0.25;
      // Arms trail the body sway slightly.
      if (this.bones.upperArmL) this.bones.upperArmL.rotation.x += Math.sin(t * 0.42 - 0.4) * 0.03;
      if (this.bones.upperArmR) this.bones.upperArmR.rotation.x += Math.sin(t * 0.42 - 0.6) * 0.03;
    }

    // --- Walk cycle -------------------------------------------------------
    if (this.walkSpeed > 0.05) {
      this.walkPhase += dt * this.walkSpeed * 4.6;
      const p = this.walkPhase;
      const swing = Math.sin(p) * 0.62 * Math.min(1, this.walkSpeed);
      const lift = Math.max(0, Math.sin(p)) * 0.5;
      const liftOpp = Math.max(0, Math.sin(p + Math.PI)) * 0.5;
      if (this.bones.thighL) this.bones.thighL.rotation.x += -swing;
      if (this.bones.thighR) this.bones.thighR.rotation.x += swing;
      if (this.bones.shinL) this.bones.shinL.rotation.x += lift;
      if (this.bones.shinR) this.bones.shinR.rotation.x += liftOpp;
      if (this.bones.upperArmL) this.bones.upperArmL.rotation.x += swing * 0.55;
      if (this.bones.upperArmR) this.bones.upperArmR.rotation.x += -swing * 0.55;
      if (this.bones.hips) {
        this.bones.hips.position.y = 0.95 + Math.abs(Math.sin(p)) * 0.022;
        this.bones.hips.rotation.y += Math.sin(p) * 0.09;
        this.bones.hips.rotation.z += Math.cos(p) * 0.05;
      }
      if (this.bones.chest) this.bones.chest.rotation.y -= Math.sin(p) * 0.07;
    }

    // --- Gesture beat -----------------------------------------------------
    if (this.gestureTimer > 0) {
      this.gestureTimer -= dt;
      const g = Math.sin((1 - Math.max(0, this.gestureTimer) / 0.6) * Math.PI);
      if (this.bones.foreArmL) this.bones.foreArmL.rotation.x -= g * 0.42;
      if (this.bones.upperArmL) this.bones.upperArmL.rotation.x -= g * 0.16;
      if (this.bones.chest) this.bones.chest.rotation.x -= g * 0.05;
    }

    // --- Talking: jaw and micro-motion -----------------------------------
    if (this.talking > 0) {
      // Syllabic envelope. Layered primes avoid an audible loop.
      const syl = (Math.sin(t * 11.0) * 0.5 + 0.5) * (Math.sin(t * 6.3) * 0.5 + 0.5);
      const emphasis = (Math.sin(t * 2.7) * 0.5 + 0.5);
      this.mouthTarget = Math.max(this.mouthTarget, syl * (0.35 + this.talking * 0.55) * (0.6 + emphasis * 0.6));
      if (this.bones.head) {
        this.bones.head.rotation.x += Math.sin(t * 5.1) * 0.020 * this.talking;
        this.bones.head.rotation.y += Math.sin(t * 3.3) * 0.032 * this.talking;
        this.bones.head.rotation.z += Math.sin(t * 2.1) * 0.016 * this.talking;
      }
    }

    this.mouthOpen += (this.mouthTarget - this.mouthOpen) * Math.min(1, dt * 22);
    this.mouthTarget *= Math.max(0, 1 - dt * 9);
    if (this.bones.jaw) {
      this.bones.jaw.rotation.x = this.mouthOpen * 0.34;
    }

    // --- Head / eye aim ---------------------------------------------------
    const lw = this.lookWeightTarget ?? 0;
    this.lookWeight += (lw - this.lookWeight) * Math.min(1, dt * 4);
    if (this.lookTarget && this.lookWeight > 0.01 && this.bones.head) {
      const head = this.bones.head;
      head.updateWorldMatrix(true, false);
      const headWorld = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      const toTarget = this.lookTarget.clone().sub(headWorld);

      // Express the aim in the character's own frame.
      const inv = new THREE.Matrix4().copy(this.character.matrixWorld).invert();
      const localDir = toTarget.clone().transformDirection(inv).normalize();
      const yaw = THREE.MathUtils.clamp(Math.atan2(localDir.x, localDir.z), -1.0, 1.0);
      const pitch = THREE.MathUtils.clamp(-Math.asin(localDir.y), -0.5, 0.5);

      const w = this.lookWeight;
      if (this.bones.neck) {
        this.bones.neck.rotation.y += yaw * 0.35 * w;
        this.bones.neck.rotation.x += pitch * 0.35 * w;
      }
      head.rotation.y += yaw * 0.55 * w;
      head.rotation.x += pitch * 0.5 * w;

      // Eyes finish the aim — this is what actually sells eye contact.
      const eyeYaw = THREE.MathUtils.clamp(yaw * 0.35, -0.28, 0.28);
      const eyePitch = THREE.MathUtils.clamp(pitch * 0.3, -0.2, 0.2);
      this.eyes.forEach((e) => {
        e.root.rotation.y = eyeYaw * w;
        e.root.rotation.x = eyePitch * w;
      });
    } else {
      this.eyes.forEach((e) => {
        e.root.rotation.y *= 1 - Math.min(1, dt * 3);
        e.root.rotation.x *= 1 - Math.min(1, dt * 3);
      });
    }

    // --- Blinking ---------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase < 0) {
      this.blinkPhase = 0;
      this.blinkTimer = 2.2 + Math.random() * 4.0;
    }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.13;
      const closed = Math.sin(Math.min(1, this.blinkPhase) * Math.PI);
      this.blinkAmount = closed;
      this.eyes.forEach((e) => { e.lid.rotation.x = -0.30 + closed * 1.35; });
      if (this.blinkPhase >= 1) this.blinkPhase = -1;
    } else {
      this.blinkAmount = 0;
    }
  }
}

/**
 * Move a character toward a mark over time, driving the walk cycle.
 * Returns true once it has arrived.
 */
export class Mover {
  constructor(character, animator) {
    this.character = character;
    this.animator = animator;
    this.destination = null;
    this.facing = null;
    this.speed = 1.15;
  }

  moveTo(position, facing = null, speed = 1.15) {
    this.destination = position.clone();
    this.facing = facing;
    this.speed = speed;
  }

  snapTo(position, facing = 0) {
    this.character.position.copy(position);
    this.character.rotation.y = facing;
    this.destination = null;
    this.animator.setWalking(0);
  }

  update(dt) {
    if (!this.destination) {
      if (this.facing !== null) {
        const cur = this.character.rotation.y;
        let diff = this.facing - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.character.rotation.y = cur + diff * Math.min(1, dt * 4);
      }
      this.animator.setWalking(0);
      return true;
    }

    const pos = this.character.position;
    const flat = this.destination.clone().setY(pos.y);
    const dist = pos.distanceTo(flat);
    if (dist < 0.06) {
      this.destination = null;
      this.animator.setWalking(0);
      return true;
    }

    const step = Math.min(dist, this.speed * dt);
    const dir = flat.clone().sub(pos).normalize();
    pos.addScaledVector(dir, step);

    // Face the direction of travel while moving.
    const wanted = Math.atan2(dir.x, dir.z);
    let diff = wanted - this.character.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.character.rotation.y += diff * Math.min(1, dt * 5);

    this.animator.setWalking(Math.min(1, this.speed));
    return false;
  }
}
