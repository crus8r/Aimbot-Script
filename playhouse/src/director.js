/**
 * The procedural director.
 *
 * Two jobs. First, *blocking*: decide where bodies stand and which way they
 * cheat toward the lens. Second, *coverage*: turn a list of beats into a shot
 * list — sizes, angles, lenses, moves and cut points.
 *
 * The rules encoded here are the ordinary grammar of narrative coverage:
 * establish before you punch in, hold the line of action, favour the listener
 * on a reaction, and cut on the beat rather than on the sentence. None of it
 * is clever; all of it is what separates footage from a scene.
 */

import * as THREE from 'three';

/** Shot sizes: distance from subject, field of view, and what we frame on. */
export const SHOT_SIZES = {
  ECU: { dist: 0.62, fov: 44, aim: 'head', headroom: 0.02 },
  CU: { dist: 1.05, fov: 40, aim: 'head', headroom: 0.05 },
  MCU: { dist: 1.65, fov: 38, aim: 'head', headroom: 0.10 },
  MS: { dist: 2.70, fov: 36, aim: 'chest', headroom: 0.16 },
  MWS: { dist: 3.80, fov: 34, aim: 'chest', headroom: 0.22 },
  WS: { dist: 5.40, fov: 31, aim: 'body', headroom: 0.30 },
  EWS: { dist: 9.00, fov: 27, aim: 'stage', headroom: 0.50 },
};

const MOVES = ['static', 'push', 'pull', 'dolly', 'crane', 'handheld', 'orbit'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

/**
 * Assign characters to stage marks and compute cheated facings.
 *
 * The cheat is the whole trick of stage blocking: a character angled fully at
 * their scene partner shows the camera an ear. Blending the partner-facing
 * with the camera-facing keeps the relationship legible *and* the face visible.
 */
export function blockScene(scene, stage, castOrder) {
  const marks = stage.userData.marks;
  const present = scene.characters.length ? scene.characters : castOrder.slice(0, 1);
  const n = present.length;

  // Central marks for principals, spreading outward.
  const order = [3, 2, 4, 1, 5, 0, 6];
  const assignment = new Map();
  present.forEach((name, i) => {
    const markIndex = order[i % order.length] % marks.length;
    assignment.set(name, {
      mark: markIndex,
      position: marks[markIndex].position.clone(),
      facing: marks[markIndex].facing,
    });
  });

  // Cheat each character partly toward the person they're most likely
  // addressing (the next principal), and partly toward the audience.
  const entries = [...assignment.entries()];
  entries.forEach(([name, block], i) => {
    if (n < 2) { block.facing = 0; return; }
    const partner = entries[(i + 1) % n][1];
    const toPartner = Math.atan2(
      partner.position.x - block.position.x,
      partner.position.z - block.position.z,
    );
    // 0 is "square to camera"; blend 55% of the way toward the partner.
    let diff = toPartner;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    block.facing = diff * 0.55;
    block.partner = entries[(i + 1) % n][0];
  });

  return assignment;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Turn parsed scenes into a timed shot list.
 * @param {object} script from parseScript
 * @param {object} [opts] `{ pace: number }` — >1 cuts faster
 */
export function direct(script, opts = {}) {
  const pace = opts.pace ?? 1;
  const shots = [];
  const sceneTimes = [];
  let clock = 0;

  for (const scene of script.scenes) {
    const sceneStart = clock;
    const seed = hash(scene.heading || scene.location);
    // Which side of the line of action this scene lives on. Chosen once.
    const side = seed % 2 === 0 ? 1 : -1;

    const principals = scene.characters.slice(0, 4);
    let lastSubject = null;
    let sinceWide = 99;
    let lastSize = null;
    let beatIndex = 0;

    // Every scene opens by establishing geography.
    if (scene.beats.length) {
      shots.push({
        id: `${scene.index}.est`,
        scene: scene.index,
        beat: null,
        start: clock,
        duration: 2.6 / pace,
        size: principals.length > 2 ? 'EWS' : 'WS',
        subject: principals[0] || null,
        secondary: principals[1] || null,
        move: 'crane',
        side,
        height: 'high',
        establishing: true,
      });
      clock += 2.6 / pace;
      sinceWide = 0;
    }

    for (const beat of scene.beats) {
      const dur = Math.max(0.8, (beat.duration || 1.5) / pace);

      // --- Non-dialogue beats --------------------------------------------
      if (beat.type === 'transition') {
        shots.push({
          id: beat.id, scene: scene.index, beat, start: clock, duration: dur,
          size: 'WS', subject: lastSubject, secondary: null,
          move: 'pull', side, height: 'eye', transition: true,
        });
        clock += dur;
        sinceWide = 0;
        beatIndex++;
        continue;
      }

      if (beat.type === 'action' || beat.type === 'cue') {
        const hasMagic = (beat.cues || []).length > 0 || beat.kind === 'ability';
        const actor = beat.actor || (beat.cues && beat.cues[0]?.actor) || lastSubject || principals[0];
        shots.push({
          id: beat.id, scene: scene.index, beat, start: clock, duration: dur,
          // Magic wants room to be seen; ordinary action can sit in a medium.
          size: hasMagic ? 'MWS' : (sinceWide > 4 ? 'WS' : 'MS'),
          subject: actor,
          secondary: principals.find((c) => c !== actor) || null,
          move: hasMagic ? 'push' : 'static',
          side,
          height: hasMagic ? 'low' : 'eye',
          action: true,
        });
        clock += dur;
        sinceWide = hasMagic ? 0 : sinceWide + 1;
        lastSize = 'MS';
        beatIndex++;
        continue;
      }

      // --- Dialogue and lyrics -------------------------------------------
      const speaker = beat.character || lastSubject || principals[0];
      const other = principals.find((c) => c !== speaker) || null;
      const singing = beat.type === 'lyric' || beat.singing;
      const intensity = beat.intensity ?? 0.35;
      const changedSpeaker = speaker !== lastSubject;

      // Long lines get subdivided so no shot outstays its welcome.
      const maxHold = singing ? 5.0 : 4.2;
      const pieces = Math.max(1, Math.min(3, Math.ceil(dur / maxHold)));
      const pieceDur = dur / pieces;

      for (let p = 0; p < pieces; p++) {
        let size;
        let move = 'static';
        let height = 'eye';
        let ots = false;

        if (singing) {
          // Songs breathe: wider, moving, and they open out as they build.
          if (p === 0 && intensity > 0.6) size = 'MS';
          else if (intensity > 0.72) size = p === pieces - 1 ? 'MWS' : 'MCU';
          else size = ['MS', 'MCU', 'MWS'][(beatIndex + p) % 3];
          move = ['crane', 'push', 'dolly', 'orbit'][(beatIndex + p) % 4];
          if (sinceWide > 3) { size = 'WS'; move = 'crane'; sinceWide = -1; }
        } else if (sinceWide > 6) {
          // Re-establish before the audience loses the room.
          size = principals.length > 1 ? 'MWS' : 'WS';
          move = 'dolly';
          sinceWide = -1;
        } else if (intensity > 0.62 && p === pieces - 1) {
          // Land the emotional peak close.
          size = intensity > 0.82 ? 'ECU' : 'CU';
          move = 'push';
        } else if (other && changedSpeaker && (beatIndex % 2 === 0)) {
          size = 'MCU';
          ots = true;
        } else {
          size = ['MCU', 'MS', 'CU'][(beatIndex + p) % 3];
          move = p > 0 ? 'push' : (beatIndex % 5 === 0 ? 'handheld' : 'static');
        }

        // Never cut from a size to itself on the same subject — that's a jump cut.
        if (size === lastSize && speaker === lastSubject && !ots) {
          const ladder = ['ECU', 'CU', 'MCU', 'MS', 'MWS', 'WS'];
          const i = ladder.indexOf(size);
          size = ladder[Math.min(ladder.length - 1, i + 1)];
        }

        if (beat.emotion === 'afraid' || beat.emotion === 'sad') height = 'high';
        if (beat.emotion === 'angry' || beat.emotion === 'resolute') height = 'low';

        shots.push({
          id: `${beat.id}.${p}`,
          scene: scene.index,
          beat,
          start: clock,
          duration: pieceDur,
          size,
          subject: speaker,
          secondary: other,
          ots: ots && !!other,
          move,
          side,
          height,
          singing,
          speaking: true,
          piece: p,
          pieces,
        });

        clock += pieceDur;
        lastSize = size;
        sinceWide = ['WS', 'EWS', 'MWS'].includes(size) ? 0 : sinceWide + 1;
      }

      lastSubject = speaker;
      beatIndex++;
    }

    sceneTimes.push({ index: scene.index, start: sceneStart, duration: clock - sceneStart, scene });
    clock += 0.5; // a breath between scenes
  }

  return { shots, scenes: sceneTimes, duration: clock };
}

// ---------------------------------------------------------------------------
// Camera solving
// ---------------------------------------------------------------------------

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tmp = new THREE.Vector3();

function forwardOf(object) {
  return _fwd.set(Math.sin(object.rotation.y), 0, Math.cos(object.rotation.y));
}

function aimPoint(character, aim) {
  const ud = character.userData;
  const base = character.position;
  switch (aim) {
    case 'head': return _tmp.set(base.x, base.y + ud.eyeHeight, base.z).clone();
    case 'chest': return _tmp.set(base.x, base.y + ud.chestHeight, base.z).clone();
    case 'body': return _tmp.set(base.x, base.y + ud.height * 0.55, base.z).clone();
    default: return _tmp.set(base.x, base.y + ud.height * 0.6, base.z).clone();
  }
}

/**
 * Resolve a shot into a concrete camera placement.
 *
 * @param {object} shot from `direct`
 * @param {Map<string, THREE.Object3D>} cast
 * @param {THREE.Group} stage
 * @param {number} t 0..1 progress through the shot, for moves
 * @returns {{position: THREE.Vector3, lookAt: THREE.Vector3, fov: number}}
 */
export function solveShot(shot, cast, stage, t = 0, elapsed = 0) {
  const spec = SHOT_SIZES[shot.size] || SHOT_SIZES.MS;
  const subject = shot.subject ? cast.get(shot.subject) : null;
  const secondary = shot.secondary ? cast.get(shot.secondary) : null;
  const bounds = stage.userData.bounds;

  // Fall back to a general stage view when there's nobody to point at.
  if (!subject) {
    const pos = new THREE.Vector3(2.2, 2.4, bounds.depth * 0.42);
    return { position: pos, lookAt: new THREE.Vector3(0, 1.2, -0.4), fov: 34 };
  }

  const target = aimPoint(subject, spec.aim);
  const facing = forwardOf(subject).clone();
  _right.set(facing.z, 0, -facing.x); // camera-right relative to the subject

  let dist = spec.dist;
  let fov = spec.fov;
  let position;

  if (shot.ots && secondary) {
    // Over-the-shoulder: sit just behind and outside the listener's head,
    // looking past them at the speaker.
    const sHead = aimPoint(secondary, 'head');
    const toSubject = target.clone().sub(sHead).setY(0).normalize();
    const sRight = new THREE.Vector3(toSubject.z, 0, -toSubject.x);
    position = sHead.clone()
      .addScaledVector(toSubject, -0.42)
      .addScaledVector(sRight, 0.34 * shot.side)
      .setY(sHead.y + 0.10);
    // Keep enough distance that the shoulder frames rather than fills.
    const flat = position.clone().setY(target.y);
    const have = flat.distanceTo(target);
    if (have < 1.15) {
      position.addScaledVector(toSubject, -(1.15 - have));
    }
    fov = 40;
  } else if (shot.size === 'EWS' || !shot.subject) {
    const centre = secondary
      ? target.clone().add(aimPoint(secondary, 'body')).multiplyScalar(0.5)
      : target.clone();
    const height = bounds.exterior ? 3.4 : Math.min(bounds.height - 0.5, 2.9);
    position = centre.clone().add(new THREE.Vector3(1.6 * shot.side, height, dist * 0.62));
    return {
      position,
      lookAt: centre.clone().setY(centre.y * 0.7 + 0.5),
      fov,
    };
  } else {
    // Standard single: swing off the subject's facing axis to the chosen side.
    // ~30 degrees reads as a natural three-quarter view.
    const swing = shot.ots ? 0.20 : 0.52 * shot.side;
    const dir = facing.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), swing);
    position = target.clone().addScaledVector(dir, dist);
  }

  // --- Height ---------------------------------------------------------------
  const eye = subject.position.y + subject.userData.eyeHeight;
  if (shot.height === 'low') position.y = Math.max(0.5, eye - 0.55 - dist * 0.08);
  else if (shot.height === 'high') position.y = eye + 0.45 + dist * 0.10;
  else position.y = eye - 0.03;

  // --- Moves ----------------------------------------------------------------
  const toTarget = target.clone().sub(position).setY(0);
  const len = toTarget.length() || 1;
  toTarget.divideScalar(len);
  const camRight = new THREE.Vector3(toTarget.z, 0, -toTarget.x);

  switch (shot.move) {
    case 'push':
      position.addScaledVector(toTarget, t * Math.min(0.65, dist * 0.20));
      break;
    case 'pull':
      position.addScaledVector(toTarget, -t * Math.min(0.9, dist * 0.26));
      break;
    case 'dolly':
      position.addScaledVector(camRight, (t - 0.5) * Math.min(1.5, dist * 0.34) * shot.side);
      break;
    case 'crane':
      position.y += (0.5 - t) * Math.min(1.3, dist * 0.24);
      position.addScaledVector(toTarget, t * dist * 0.10);
      break;
    case 'orbit': {
      const a = (t - 0.5) * 0.34 * shot.side;
      const rel = position.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      position.copy(target.clone().add(rel));
      break;
    }
    case 'handheld':
      position.x += Math.sin(elapsed * 2.3) * 0.016 + Math.sin(elapsed * 5.7) * 0.007;
      position.y += Math.cos(elapsed * 1.9) * 0.013 + Math.sin(elapsed * 6.3) * 0.005;
      break;
    default:
      break;
  }

  // --- Keep the lens inside the room ---------------------------------------
  if (!bounds.exterior) {
    const hw = bounds.width / 2 - 0.35;
    const hd = bounds.depth / 2 - 0.35;
    position.x = THREE.MathUtils.clamp(position.x, -hw, hw);
    position.z = THREE.MathUtils.clamp(position.z, -hd, hd);
    position.y = THREE.MathUtils.clamp(position.y, 0.45, bounds.height - 0.25);
  }

  // Headroom: aim slightly above the subject point so they don't sit centred,
  // which is the flattest possible framing.
  const lookAt = target.clone();
  lookAt.y += spec.headroom * 0.35;

  return { position, lookAt, fov };
}

/** Find the shot live at a given time. */
export function shotAt(shots, time) {
  if (!shots.length) return null;
  let lo = 0;
  let hi = shots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (shots[mid].start <= time) lo = mid; else hi = mid - 1;
  }
  return shots[lo];
}

/** Human-readable slate, shown in the UI. */
export function describeShot(shot) {
  if (!shot) return '';
  const bits = [shot.size];
  if (shot.ots) bits.push('OTS');
  if (shot.height !== 'eye') bits.push(shot.height);
  if (shot.move !== 'static') bits.push(shot.move);
  if (shot.subject) bits.push(`— ${shot.subject}`);
  return bits.join(' · ');
}
