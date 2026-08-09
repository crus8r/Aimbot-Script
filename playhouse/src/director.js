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
        // The parser marked this line as camera language ("A shot of it
        // rolling to the ground") — cover it as an insert, not as blocking.
        // NOTE: `sinceWide` deliberately keeps climbing; an insert is not
        // coverage of the room, so the director re-establishes soon after.
        if (beat.shotHint === 'INSERT' && beat.insert?.subject) {
          const onProp = beat.insert.subjectKind === 'prop';
          shots.push({
            id: beat.id, scene: scene.index, beat, start: clock, duration: dur,
            // `size` stays on the ladder (ECU..EWS) so director notes can
            // still walk it; `insert` + `subjectProp` carry the real intent.
            size: 'CU',
            subject: onProp ? null : beat.insert.subject,
            secondary: null,
            subjectProp: onProp ? beat.insert.subject : null,
            move: beat.insert.motion ? 'push' : 'static',
            side,
            height: onProp ? 'low' : 'eye',
            insert: onProp,
            action: true,
          });
          clock += dur;
          sinceWide += 1;
          lastSize = 'CU';
          if (!onProp) lastSubject = beat.insert.subject;
          beatIndex++;
          continue;
        }

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
const _tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Scratch for the two-shot search, which tests a few hundred candidate cameras
// on a frame where two subjects have to be held together. Allocating a vector
// per trial is the difference between free and visible in a profile.
const _trial = new THREE.Vector3();
const _view = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _box = new THREE.Box3();
const _corner = new THREE.Vector3();

/**
 * Say something about a shot once, however many frames it is on screen.
 *
 * The Blender renderer gathers the same messages into its manifest, where each
 * shot is solved exactly once. Here the solver runs every frame, so an
 * unguarded warning would repeat sixty times a second and bury every other
 * thing the console had to say.
 */
const _said = new Set();

/**
 * @param {string} key  what is being reported, stable across frames — usually
 *   `${shot.id}:${kind}`. It must NOT contain a measurement: the two messages
 *   that fire on a moving camera carry the distance they measured, so keying
 *   on the finished text deduplicated nothing and every push-in produced a
 *   fresh line per frame. Six near-identical warnings from one shot is the
 *   flood this function exists to prevent, and it was printing them.
 * @param {string} message  the text, measurement and all.
 */
function note(key, message) {
  if (_said.has(key)) return;
  _said.add(key);
  console.warn(`director: ${message}`);
}

/** Forget what has been said, so a re-staged scene reports afresh. */
export function resetNotes() {
  _said.clear();
}

function forwardOf(object) {
  return _fwd.set(Math.sin(object.rotation.y), 0, Math.cos(object.rotation.y));
}

/**
 * Look a prop up on the built stage, by the scene file's own id or by registry
 * type. Shared by the insert solver here and production's cue targeting, so the
 * lookup rule lives in exactly one place.
 *
 * Both spellings are wanted and they mean different things. An id names one
 * specific object — "droneA" is that drone, not the other one — and it is what
 * a scene file's `camera.subject` and `camera.secondary` are written in. A type
 * names any of them, which is how a line of prose ("she picks up the bucket")
 * finds the bucket the set dresser put on the sand. Matching only the type, as
 * this did, meant every authored id fell through to the "prop absent" branch:
 * the forest scene's insert on the drone's sensor rendered as a shot of the
 * ground, and it did so silently.
 *
 * @param {THREE.Group|null} stage from buildStage
 * @param {string|null} name a scene-file prop id ('droneA') or a PROPS registry
 *   name ('drone')
 * @returns {THREE.Object3D|null}
 */
export function findStageProp(stage, name) {
  if (!stage || !name) return null;
  const key = String(name).toLowerCase();
  const props = stage.userData.props || [];
  return props.find((p) => p.userData.sceneId?.toLowerCase() === key)
    || props.find((p) => p.userData.propName?.toLowerCase() === key)
    || null;
}

/**
 * How tall a placed prop is, and how far it reaches from its own origin.
 *
 * Measured off the live scene graph rather than read from the PROPS registry,
 * because the registry size is the *unscaled* one: the forest's drones are
 * built at 1.15, and framing them at their catalogue size put the aim point
 * below the fuselage and the insert's lens inside it.
 */
function propExtent(prop, origin) {
  _box.setFromObject(prop);
  const span = _box.max.y - _box.min.y;
  let radius = 0;
  for (const x of [_box.min.x, _box.max.x]) {
    for (const y of [_box.min.y, _box.max.y]) {
      for (const z of [_box.min.z, _box.max.z]) {
        radius = Math.max(radius, _corner.set(x, y, z).distanceTo(origin));
      }
    }
  }
  // A prop that measures nothing is a group with no geometry in it. 0.3 m is
  // what the Blender side falls back to, and it keeps a mis-built prop framing
  // as a small object rather than as a point.
  return { height: span > 1e-6 ? span : 0.3, radius };
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
 * Where the second thing in a two-shot is: cast member or prop alike.
 *
 * A shot names a secondary to say "this frame is about both of these", and the
 * scene file has always been free to name a prop — the forest scene points
 * three shots at `droneA`/`droneB`. Resolving the name in the cast alone made
 * those three shots singles, so the drone that the shot exists to show was
 * outside the frame and nothing said so.
 *
 * A prop has no eyeline, so it is framed on the middle of its own height —
 * the same rule the insert path uses.
 */
function secondaryPoint(shot, cast, stage, aim = 'body') {
  if (!shot.secondary) return null;
  const character = cast.get(shot.secondary);
  if (character) return aimPoint(character, aim);
  const prop = findStageProp(stage, shot.secondary);
  if (!prop) {
    // Six of the catalogue's prop types build in Blender and not here, so a
    // beach scene's parasol is on the set in the film and absent from the
    // preview. Silently dropping to a single is how a director ends up
    // trusting a frame that the render will not reproduce.
    note(`${shot.id}:secondary`, `shot ${shot.id}: ${shot.secondary} is neither cast nor a prop on this `
      + 'stage; framed as a single');
    return null;
  }
  const centre = prop.getWorldPosition(new THREE.Vector3());
  centre.y += propExtent(prop, centre).height * 0.5;
  return centre;
}

/**
 * How far out the lens must sit to hold every point in frame.
 *
 * `place(distance, out)` writes the camera position that distance out — a
 * callable rather than a direction, because the camera's *height* is not a free
 * consequence of the distance: a low-angle shot pins the lens at a fixed height
 * whatever the distance. A version of this that solved along a straight ray and
 * let the caller drop the camera afterwards was fitting a framing that never
 * got rendered — on the surrender shot, where the second subject is a drone
 * 3.75 m up, the fit was computed at lens height 2.4 m and then shot from 0.5.
 *
 * Two-shot framing used to work by nudging an existing camera backwards along
 * its own view axis, which is subtly but fatally wrong: that axis runs from the
 * camera to the pair's midpoint, and when the second subject stands between the
 * camera and the first, the midpoint is behind the lens. Retreating then solved
 * a camera 0.20 m from what it was pointing at, and no amount of backing off
 * could fix it, because backing off was moving the camera the wrong way.
 *
 * Solving for a *distance from the pair* makes that unrepresentable. The camera
 * is always outside both subjects, always at least the distance the declared
 * shot size implies (so a CU can never solve tighter than a CU), and never
 * further than three times it (so a two-shot cannot quietly become a wide). The
 * half-angle a point subtends shrinks monotonically with distance, so bisection
 * is exact rather than iterative guesswork.
 *
 * @returns {{distance: number, fits: boolean}} `fits` is false when even
 *   `maxDist` will not hold both, which is a framing the director should hear
 *   about.
 */
function pairDistance(aim, place, points, fov, minDist, maxDist, margin = 0.12) {
  const half = THREE.MathUtils.degToRad(fov) * 0.5;

  const holds = (d) => {
    place(d, _trial);
    _view.copy(aim).sub(_trial);
    if (_view.length() < 1e-6) return false;
    _view.normalize();
    let worst = 0;
    for (const point of points) {
      _ray.copy(point).sub(_trial);
      if (_ray.length() < 1e-4) return false; // lens is on top of a subject
      const cos = THREE.MathUtils.clamp(_ray.normalize().dot(_view), -1, 1);
      worst = Math.max(worst, Math.acos(cos));
    }
    return worst * (1 + margin) <= half;
  };

  if (holds(minDist)) return { distance: minDist, fits: true };
  if (!holds(maxDist)) return { distance: maxDist, fits: false };

  let low = minDist;
  let high = maxDist;
  for (let i = 0; i < 28; i++) {
    const mid = (low + high) * 0.5;
    if (holds(mid)) high = mid; else low = mid;
  }
  return { distance: high, fits: true };
}

/**
 * Distance from the lens to the nearest corner of a body's posed bounding box.
 *
 * The coarse box — each mesh's own bounds carried by its bone — rather than the
 * per-vertex skinned one. Over all 25 poses in anim.js the two never disagree
 * by more than 56 mm, which moves a retreat by less than the retreat itself,
 * and the precise walk costs 0.74 ms against 0.026 ms: 4% of a frame, every
 * frame, for a number that decides whether to step back 30 cm.
 */
function nearestCornerDistance(object, point) {
  _box.setFromObject(object);
  if (_box.isEmpty()) return Infinity;
  let best = Infinity;
  for (const x of [_box.min.x, _box.max.x]) {
    for (const y of [_box.min.y, _box.max.y]) {
      for (const z of [_box.min.z, _box.max.z]) {
        best = Math.min(best, _corner.set(x, y, z).distanceTo(point));
      }
    }
  }
  return best;
}

/**
 * Retreat until no part of the subject is nearer than `want`.
 *
 * A shot size is a promise about how big a person is in frame, and measuring
 * one point — the head — does not keep it. A body is not a point. With both
 * hands up, the head solves to a correct 0.84 m for a close-up while the
 * forearm ends up 0.35 m from the lens, so the close-up delivered is a close-up
 * of a wrist.
 *
 * Backing off along the existing view axis is the only correction that keeps
 * the angle the director chose, and it is what an operator does when an actor's
 * gesture crowds the lens.
 */
function holdSubjectBack(position, lookAt, subject, want, shotId) {
  const have = nearestCornerDistance(subject, position);
  if (have >= want) return position;
  _view.copy(position).sub(lookAt);
  const span = _view.length();
  if (span < 1e-4) return position;
  // Capped so a close-up cannot silently become a medium.
  const push = Math.min(want - have, span * 1.6);
  note(`${shotId}:backoff`, `shot ${shotId}: subject's nearest point was ${have.toFixed(2)} m from a `
    + `lens framed for ${want.toFixed(2)} m; backed off ${push.toFixed(2)} m`);
  return position.addScaledVector(_view.divideScalar(span), push);
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
  const side = shot.side || 1;

  // --- Insert: a close-up on a thing, not a person -------------------------
  // Aims at an explicit world-space point (shot.worldTarget) or at the named
  // prop wherever it currently is — including riding in a character's hand.
  if (shot.insert) {
    const prop = shot.worldTarget ? null : findStageProp(stage, shot.subjectProp);
    let centre = shot.worldTarget ? shot.worldTarget.clone() : null;
    let extent = null;
    if (prop) {
      centre = prop.getWorldPosition(new THREE.Vector3());
      extent = propExtent(prop, centre);
      centre.y += extent.height * 0.55;
    }
    if (centre) {
      const fov = 46;
      // Framing an insert at a fixed fraction of the shot size's distance
      // silently assumes a prop you could hold. A 1.15-scale drone is over a
      // metre across, and that distance put the lens inside it: the sensor
      // insert came back an unreadable dark mass. Back off far enough that the
      // prop's bounding sphere fits the frame, and keep whichever is larger.
      const fit = extent
        ? (extent.radius / Math.max(0.2, Math.sin(THREE.MathUtils.degToRad(fov) * 0.5))) * 0.92
        : 0;
      const dist = Math.max(0.45, spec.dist * 0.55, fit);
      const off = new THREE.Vector3(0.7 * side, 0.55, 0.9).normalize();
      const position = centre.clone().addScaledVector(off, dist);
      if (shot.move === 'push') {
        position.addScaledVector(centre.clone().sub(position).normalize(), t * dist * 0.25);
      }
      return { position, lookAt: centre, fov };
    }
    // Named prop absent from the set: read as "looking at the ground" rather
    // than an unmotivated mid-room master.
    note(`${shot.id}:insert`, `shot ${shot.id}: nothing on this stage answers to ${shot.subjectProp}, `
      + 'so the insert has no subject; pointed at the ground');
    return {
      position: new THREE.Vector3(1.1 * side, 0.9, 1.5),
      lookAt: new THREE.Vector3(0, 0.15, -0.2),
      fov: 40,
    };
  }

  // Fall back to a general stage view when there's nobody to point at.
  if (!subject) {
    const pos = new THREE.Vector3(2.2, 2.4, bounds.depth * 0.42);
    return { position: pos, lookAt: new THREE.Vector3(0, 1.2, -0.4), fov: 34 };
  }

  const target = aimPoint(subject, spec.aim);
  const facing = forwardOf(subject).clone();

  const dist = spec.dist;
  let fov = spec.fov;
  let position;
  // Non-null once the frame is about a pair rather than about one person; the
  // aim it holds is what the lens ends up pointing at.
  let pairAim = null;

  // --- Height, decided before the framing rather than after ----------------
  // This used to be imposed once the fit was already solved, which meant a
  // low-angle two-shot was framed at one height and shot from another. The
  // two-shot search below places the lens itself, so it has to know.
  const eye = subject.position.y + subject.userData.eyeHeight;
  let camY;
  if (shot.height === 'low') camY = Math.max(0.5, eye - 0.55 - dist * 0.08);
  else if (shot.height === 'high') camY = eye + 0.45 + dist * 0.10;
  else camY = eye - 0.03;

  if (shot.ots && !secondary) {
    // An over-the-shoulder needs a shoulder. A prop has none, so rather than
    // shoot over a hovering drone's non-existent head, say so and let the shot
    // fall through to the pair framing below, which a prop can do.
    note(`${shot.id}:ots`, `shot ${shot.id}: ots needs a cast secondary to shoot over, and `
      + `${shot.secondary || 'nothing'} is not one; framed as a two-shot instead`);
  }

  if (shot.ots && secondary) {
    // Over-the-shoulder: sit just behind and outside the listener's head,
    // looking past them at the speaker. Asked for by camera.ots.
    const sHead = aimPoint(secondary, 'head');
    const toSubject = target.clone().sub(sHead).setY(0).normalize();
    const sRight = new THREE.Vector3(toSubject.z, 0, -toSubject.x);
    position = sHead.clone()
      .addScaledVector(toSubject, -0.42)
      .addScaledVector(sRight, 0.34 * side)
      .setY(sHead.y + 0.10);
    // Keep enough distance that the shoulder frames rather than fills.
    const flat = position.clone().setY(target.y);
    const have = flat.distanceTo(target);
    if (have < 1.15) {
      position.addScaledVector(toSubject, -(1.15 - have));
    }
    fov = 40;
  } else if (shot.size === 'EWS') {
    const other = secondaryPoint(shot, cast, stage, 'body');
    const centre = other ? target.clone().add(other).multiplyScalar(0.5) : target.clone();
    const height = bounds.exterior ? 3.4 : Math.min(bounds.height - 0.5, 2.9);
    position = centre.clone().add(new THREE.Vector3(1.6 * side, height, dist * 0.62));
    // An EWS returns before the moves: at this size a push is a few pixels.
    return {
      position,
      lookAt: centre.clone().setY(centre.y * 0.7 + 0.5),
      fov,
    };
  } else {
    // Standard single: swing off the subject's facing axis to the chosen side.
    // ~30 degrees reads as a natural three-quarter view.
    const swing = 0.52 * side;
    position = target.clone().addScaledVector(facing.clone().applyAxisAngle(UP, swing), dist);

    const other = secondaryPoint(shot, cast, stage, 'body');
    if (other) {
      // A shot that names a secondary is about the PAIR. Bias the aim toward
      // the subject so it still reads as their shot, then choose the distance —
      // outward along the same three-quarter axis the single would have used —
      // at which both points sit inside the frustum with a margin. Two
      // separated points also make bullseye framing impossible by
      // construction, which is the other thing wrong with single-subject
      // solves.
      const aim = target.clone().multiplyScalar(0.65).addScaledVector(other, 0.35);

      // Distance is the expensive way to hold two subjects and the only one a
      // fixed camera axis leaves you. Backing a WS off from 5.4 m to 14.3 m
      // does technically get a drone into frame, but what it delivers is an EWS
      // with a shot label that says WS, and every subsequent cut is scaled
      // against a lie.
      //
      // The cheap way is the one an operator reaches for first: walk round
      // until the two subjects line up in depth rather than across the frame.
      // Stacked, they subtend almost nothing and fit at the size that was
      // asked for. So search the azimuth too, ordered by how far it strays from
      // the angle the director specified, and take the first that holds the
      // pair without stretching the distance past a stop of the declared size.
      const swings = [swing];
      for (let delta = 6; delta <= 50; delta += 4) {
        swings.push(swing + THREE.MathUtils.degToRad(delta));
        swings.push(swing - THREE.MathUtils.degToRad(delta));
      }

      let best = null;
      for (const candidate of swings) {
        const dir = facing.clone().applyAxisAngle(UP, candidate);
        // Distance is horizontal; height is whatever the shot asked for. This
        // is the camera that will actually be rendered, so it is the camera the
        // fit must be tested against.
        const place = (d, out) => out.copy(aim).addScaledVector(dir, d).setY(camY);
        const { distance, fits } = pairDistance(aim, place, [target, other], fov, dist, dist * 3);
        if (!fits) continue;
        if (distance <= dist * 1.35) { best = { dir, distance, swing: candidate }; break; }
        if (!best || distance < best.distance) best = { dir, distance, swing: candidate };
      }

      if (best) {
        const swung = THREE.MathUtils.radToDeg(best.swing - swing);
        if (Math.abs(best.swing - swing) > 1e-6) {
          note(`${shot.id}:swing`, `shot ${shot.id}: swung ${swung > 0 ? '+' : ''}${swung.toFixed(0)} deg to `
            + `line ${shot.subject} up with ${shot.secondary} and hold the `
            + `${shot.size} at ${best.distance.toFixed(1)} m`);
        }
        position = aim.clone().addScaledVector(best.dir, best.distance).setY(camY);
        pairAim = aim;
      } else {
        // Two subjects too far apart to hold at this size. Retreating to the
        // cap satisfies neither promise — a CU solved 3.2 m out is not a
        // close-up and still crops the pair — so the declared shot size wins
        // and the secondary falls where it falls, usually in the background of
        // frame. That is what a DP does: they shoot the close-up and get the
        // other actor in the edge of it, they do not invent a wide.
        note(`${shot.id}:apart`, `shot ${shot.id}: ${shot.subject} and ${shot.secondary} are `
          + `${target.distanceTo(other).toFixed(1)} m apart, too far to hold together `
          + `in a ${shot.size}; framed as a single on ${shot.subject}`);
      }
    }
  }

  // A two-shot solve has already placed the lens at `camY` and framed against
  // it; re-imposing the height here would be a no-op at best and, if these two
  // ever drift apart, would silently invalidate the fit again.
  if (!pairAim) position.y = camY;

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
      position.addScaledVector(camRight, (t - 0.5) * Math.min(1.5, dist * 0.34) * side);
      break;
    case 'crane':
      position.y += (0.5 - t) * Math.min(1.3, dist * 0.24);
      position.addScaledVector(toTarget, t * dist * 0.10);
      break;
    case 'orbit': {
      const a = (t - 0.5) * 0.34 * side;
      const rel = position.clone().sub(target).applyAxisAngle(UP, a);
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

  const lookAt = (pairAim || target).clone();
  // Headroom: aim slightly above the subject point so they don't sit centred,
  // which is the flattest possible framing.
  lookAt.y += spec.headroom * 0.35;

  // Only shots framed on a head or a chest are protected from the subject's own
  // limbs. On a wide the whole body IS the subject, so a hand nearer the lens
  // than the torso is the shot working. 0.80 of nominal: a shoulder may still
  // lead the frame, which is good, but a forearm cannot become the subject.
  if (!shot.explicitAt && !shot.ots && (spec.aim === 'head' || spec.aim === 'chest')) {
    position = holdSubjectBack(position, lookAt, subject, spec.dist * 0.80, shot.id);
  }

  // --- Keep the lens inside the room ---------------------------------------
  // Last, and it overrides everything above it: a camera through a wall is not
  // a compromised shot, it is not a shot. Inert for scene files, which build
  // exterior stages; this is the inferred-room path's only guard.
  if (!bounds.exterior) {
    const hw = bounds.width / 2 - 0.35;
    const hd = bounds.depth / 2 - 0.35;
    position.x = THREE.MathUtils.clamp(position.x, -hw, hw);
    position.z = THREE.MathUtils.clamp(position.z, -hd, hd);
    position.y = THREE.MathUtils.clamp(position.y, 0.45, bounds.height - 0.25);
  }

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
  const bits = [shot.insert ? 'INSERT' : shot.size];
  if (shot.ots) bits.push('OTS');
  if (shot.height !== 'eye' && !shot.insert) bits.push(shot.height);
  if (shot.move !== 'static') bits.push(shot.move);
  if (shot.subject) bits.push(`— ${shot.subject}`);
  else if (shot.insert && shot.subjectProp) bits.push(`— ${shot.subjectProp}`);
  return bits.join(' · ');
}
