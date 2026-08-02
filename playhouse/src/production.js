/**
 * The production: script in, performance out.
 *
 * Holds the cast (built once and reused across every scene — that reuse is
 * what makes an evening-length piece affordable), swaps stages on scene
 * boundaries, drives the camera from the shot list, and fires cues.
 */

import * as THREE from 'three';
import { parseScript } from './parser.js';
import { castCharacter, createCharacter, headPosition } from './human.js';
import { buildStage, propsForScene } from './stage.js';
import { Animator, Mover, poseForBeat } from './anim.js';
import { VFXSystem, ABILITY_DEFAULTS } from './vfx.js';
import { direct, solveShot, shotAt, describeShot } from './director.js';
import { disposeObject } from './engine.js';
import { MAGIC_COLOURS } from './human.js';
import { loadAvatar, Retargeter, measureRestPose } from './avatar.js';

const _v = new THREE.Vector3();


/** Angle of a control-rig arm from hanging straight down, at bind. */
function controlArmAngle(bones, side) {
  const a = bones[`upperArm${side}`];
  const b = bones[`foreArm${side}`];
  if (!a || !b) return 0;
  a.updateWorldMatrix(true, false);
  b.updateWorldMatrix(true, false);
  const pa = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
  const pb = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  const d = pb.sub(pa).normalize();
  return Math.atan2((side === 'L' ? 1 : -1) * d.x, -d.y);
}

/** Rotate the control rig's arms to sit where the imported rig's arms sit. */
function matchRestPose(bones, target) {
  for (const side of ['L', 'R']) {
    const wanted = side === 'L' ? target.armL : target.armR;
    if (wanted === null || wanted === undefined) continue;
    const own = controlArmAngle(bones, side);
    const delta = wanted - own;
    const bone = bones[`upperArm${side}`];
    if (bone) bone.rotation.z = (side === 'L' ? 1 : -1) * delta;
  }
}

export class Production {
  constructor(engine) {
    this.engine = engine;
    this.vfx = new VFXSystem(engine.scene);

    this.script = null;
    this.plan = null;
    this.cast = new Map();      // name -> THREE.Group
    this.animators = new Map(); // name -> Animator
    this.movers = new Map();    // name -> Mover
    this.specs = new Map();     // name -> appearance spec
    this.avatars = new Map();   // name -> { retargeter, expressions, root, report }
    this.avatarFiles = new Map(); // name -> { buffer, filename } for rebuilds

    this.stageCache = new Map();
    this.stage = null;
    this.sceneIndex = -1;

    this.time = 0;
    this.playing = false;
    this.rate = 1;
    this.currentShot = null;
    this.currentBeat = null;
    this.caption = null;
    this.slate = '';
    this.firedCues = new Set();

    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camFov = 36;
    this.cutFlash = 0;

    this.onSceneChange = null;
    this.onBeatChange = null;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Parse a script and build everything it needs.
   * @param {string} text
   * @param {Object<string, object>} [overrides] per-character appearance overrides
   */
  load(text, overrides = {}) {
    this.overrides = overrides;
    this.script = parseScript(text);
    this.plan = direct(this.script, { pace: this.pace ?? 1 });

    // Rebuild only the characters whose spec actually changed.
    const wanted = new Set(this.script.characters.map((c) => c.name));
    for (const name of [...this.cast.keys()]) {
      if (!wanted.has(name)) this.#destroyCharacter(name);
    }

    const reapply = [];
    this.script.characters.forEach((record, i) => {
      // Imported bodies survive a re-stage; only their rig is rebuilt.
      if (this.avatars.has(record.name)) {
        const stored = this.avatarFiles.get(record.name);
        if (stored) reapply.push([record.name, stored]);
        return;
      }
      const spec = castCharacter(record.name, overrides[record.name] || {}, i);
      const prev = this.specs.get(record.name);
      if (prev && JSON.stringify(prev) === JSON.stringify(spec)) return;
      this.#destroyCharacter(record.name);
      const character = createCharacter(spec);
      this.cast.set(record.name, character);
      this.specs.set(record.name, spec);
      this.animators.set(record.name, new Animator(character, i));
      this.movers.set(record.name, new Mover(character, this.animators.get(record.name)));
    });

    // Stage geometry depends on the script, so invalidate the cache.
    for (const stage of this.stageCache.values()) {
      if (stage !== this.stage) disposeObject(stage);
    }
    this.stageCache.clear();
    if (this.stage) {
      this.engine.scene.remove(this.stage);
      disposeObject(this.stage);
      this.stage = null;
    }
    this.sceneIndex = -1;
    this.firedCues.clear();

    this.seek(0);
    for (const [name, stored] of reapply) {
      this.setAvatar(name, stored.buffer, stored.filename).catch(() => {});
    }
    return this.script;
  }

  #destroyCharacter(name) {
    const c = this.cast.get(name);
    if (!c) return;
    this.engine.scene.remove(c);
    disposeObject(c);
    this.cast.delete(name);
    this.animators.delete(name);
    this.movers.delete(name);
    this.specs.delete(name);
    this.avatars.delete(name);
  }

  // -------------------------------------------------------------------------
  // Imported avatars
  // -------------------------------------------------------------------------

  /**
   * Replace a character's body with an imported .glb / .vrm, driven by the
   * same control rig. Everything else — blocking, poses, camera, cues — is
   * untouched, because none of it ever talked to the mesh.
   *
   * @param {string} name character name
   * @param {ArrayBuffer} buffer file contents
   * @param {string} [filename]
   * @returns {Promise<object>} an import report for the UI
   */
  async setAvatar(name, buffer, filename = '') {
    const index = Math.max(0, this.script.characters.findIndex((c) => c.name === name));
    const spec = this.specs.get(name) || castCharacter(name, this.overrides?.[name] || {}, index);

    // Load first: if it fails we have not touched the existing character.
    const avatar = await loadAvatar(buffer.slice(0), { targetHeight: 1.75 });

    const wasVisible = !!this.cast.get(name)?.parent;
    this.#destroyCharacter(name);

    // Control rig: skeleton only, no procedural body.
    const rig = createCharacter(spec, { bonesOnly: true });
    rig.add(avatar.root);

    // Put the control rig into whatever rest posture the import was authored
    // in before capturing the reference. Without this, an A-pose control rig
    // driving a T-pose import leaves every character standing arms-out.
    matchRestPose(rig.userData.bones, measureRestPose(avatar.mapping));
    rig.updateMatrixWorld(true);
    const retargeter = new Retargeter(rig.userData.bones, avatar.mapping, { scale: 1 });

    const animator = new Animator(rig, index);
    this.cast.set(name, rig);
    this.specs.set(name, spec);
    this.animators.set(name, animator);
    this.movers.set(name, new Mover(rig, animator));
    this.avatars.set(name, {
      root: avatar.root,
      retargeter,
      expressions: avatar.expressions,
      vrm: avatar.vrm,
      report: { ...avatar.report, retargeted: retargeter.matched.length, unmapped: retargeter.missing },
    });
    this.avatarFiles.set(name, { buffer, filename });

    if (wasVisible && this.stage) {
      this.engine.scene.add(rig);
      this.#placeCast(this.script.scenes[this.sceneIndex]);
    }
    return this.avatars.get(name).report;
  }

  /** Drop an imported avatar and go back to the procedural body. */
  clearAvatar(name) {
    if (!this.avatars.has(name)) return;
    this.avatars.delete(name);
    this.avatarFiles.delete(name);
    this.recast(name, this.overrides?.[name] || {});
  }

  hasAvatar(name) { return this.avatars.has(name); }

  /** Re-dress one character without rebuilding the rest of the production. */
  recast(name, overrides) {
    // An imported body owns its own look; rebuild it rather than replacing it
    // with a procedural one.
    if (this.avatars.has(name)) {
      const stored = this.avatarFiles.get(name);
      if (stored) {
        this.setAvatar(name, stored.buffer, stored.filename).catch(() => {});
        return this.specs.get(name);
      }
    }
    const index = this.script.characters.findIndex((c) => c.name === name);
    const spec = castCharacter(name, overrides, Math.max(0, index));
    const wasInScene = this.stage && this.cast.get(name)?.parent;
    this.#destroyCharacter(name);
    const character = createCharacter(spec);
    this.cast.set(name, character);
    this.specs.set(name, spec);
    const animator = new Animator(character, Math.max(0, index));
    this.animators.set(name, animator);
    this.movers.set(name, new Mover(character, animator));
    if (wasInScene) {
      this.engine.scene.add(character);
      this.#placeCast(this.script.scenes[this.sceneIndex]);
    }
    return spec;
  }

  // -------------------------------------------------------------------------
  // Scenes
  // -------------------------------------------------------------------------

  #ensureScene(index) {
    if (index === this.sceneIndex) return;
    const scene = this.script.scenes[index];
    if (!scene) return;

    if (this.stage) this.engine.scene.remove(this.stage);

    let stage = this.stageCache.get(index);
    if (!stage) {
      stage = buildStage(scene, { extraProps: propsForScene(scene) });
      this.stageCache.set(index, stage);
      // Keep memory bounded on long scripts.
      if (this.stageCache.size > 4) {
        const oldest = [...this.stageCache.keys()].find((k) => k !== index);
        if (oldest !== undefined) {
          const s = this.stageCache.get(oldest);
          if (s !== this.stage) disposeObject(s);
          this.stageCache.delete(oldest);
        }
      }
    }

    this.stage = stage;
    this.engine.scene.add(stage);
    this.engine.applyMood(stage.userData.mood);
    this.sceneIndex = index;
    this.vfx.clear();

    this.#placeCast(scene);
    this.onSceneChange?.(scene, stage);
  }

  #placeCast(scene) {
    const present = new Set(scene.characters);
    for (const [name, character] of this.cast) {
      if (present.has(name)) {
        if (!character.parent) this.engine.scene.add(character);
      } else if (character.parent) {
        this.engine.scene.remove(character);
      }
    }

    const blocking = this.#blockingFor(scene);
    for (const [name, block] of blocking) {
      const mover = this.movers.get(name);
      if (mover) mover.snapTo(block.position, block.facing);
    }
    this.blocking = blocking;
  }

  #blockingFor(scene) {
    // Imported lazily to keep the module graph acyclic at load time.
    const marks = this.stage.userData.marks;
    const present = scene.characters.length
      ? scene.characters
      : [...this.cast.keys()].slice(0, 1);
    const order = [3, 2, 4, 1, 5, 0, 6];
    const map = new Map();
    present.forEach((name, i) => {
      const mark = marks[order[i % order.length] % marks.length];
      map.set(name, { position: mark.position.clone(), facing: mark.facing });
    });
    const entries = [...map.entries()];
    entries.forEach(([, block], i) => {
      if (entries.length < 2) { block.facing = 0; return; }
      const partner = entries[(i + 1) % entries.length][1];
      let diff = Math.atan2(
        partner.position.x - block.position.x,
        partner.position.z - block.position.z,
      );
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      block.facing = diff * 0.55;
      block.partner = entries[(i + 1) % entries.length][0];
    });
    return map;
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  get duration() { return this.plan?.duration ?? 0; }

  play() { this.playing = true; }
  pause() { this.playing = false; }
  toggle() { this.playing = !this.playing; }

  seek(time) {
    this.time = THREE.MathUtils.clamp(time, 0, Math.max(0.001, this.duration));
    const shot = shotAt(this.plan.shots, this.time);
    if (shot) this.#ensureScene(shot.scene);
    this.currentShot = null; // force a fresh camera snap
    this.firedCues.clear();
    this.vfx.clear();
  }

  /**
   * Advance one frame.
   * @param {number} dt seconds
   * @param {number} elapsed total wall time, for continuous effects
   * @param {number} [externalTime] when audio is master, the audio clock
   */
  update(dt, elapsed, externalTime = null) {
    if (!this.plan) return;

    if (externalTime !== null) {
      this.time = THREE.MathUtils.clamp(externalTime, 0, this.duration);
    } else if (this.playing) {
      this.time += dt * this.rate;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.playing = false;
      }
    }

    const shot = shotAt(this.plan.shots, this.time);
    if (!shot) return;

    if (shot.scene !== this.sceneIndex) this.#ensureScene(shot.scene);

    const isCut = shot !== this.currentShot;
    if (isCut) {
      this.currentShot = shot;
      this.slate = describeShot(shot);
      this.cutFlash = 1;
      this.#onShotStart(shot);
    }

    const t = THREE.MathUtils.clamp((this.time - shot.start) / Math.max(0.001, shot.duration), 0, 1);

    // --- Beat state -------------------------------------------------------
    if (shot.beat !== this.currentBeat) {
      this.currentBeat = shot.beat;
      this.#onBeatStart(shot.beat, shot);
    }
    this.caption = this.#captionFor(shot);

    // --- Performers -------------------------------------------------------
    for (const [name, animator] of this.animators) {
      const character = this.cast.get(name);
      if (!character?.parent) continue;
      this.movers.get(name)?.update(dt);
      animator.update(dt, elapsed);

      // Imported bodies take the control rig's motion and their own faces.
      const avatar = this.avatars.get(name);
      if (avatar) {
        character.updateMatrixWorld(true);
        avatar.retargeter.apply(character.userData.bones.root);
        const ex = avatar.expressions;
        ex.speak(animator.mouthOpen, elapsed);
        ex.blink(animator.blinkAmount);
        ex.emotion(animator.emotion, 0.75);
        ex.update(dt);
      }
    }

    // --- Camera -----------------------------------------------------------
    const solved = solveShot(shot, this.cast, this.stage, t, elapsed);
    if (isCut) {
      this.camPos.copy(solved.position);
      this.camLook.copy(solved.lookAt);
      this.camFov = solved.fov;
    } else {
      // Light smoothing only: heavy damping makes deliberate moves feel soggy.
      const k = 1 - Math.exp(-14 * dt);
      this.camPos.lerp(solved.position, k);
      this.camLook.lerp(solved.lookAt, k);
      this.camFov += (solved.fov - this.camFov) * k;
    }

    const camera = this.engine.camera;
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    if (Math.abs(camera.fov - this.camFov) > 0.01) {
      camera.fov = this.camFov;
      camera.updateProjectionMatrix();
    }

    // --- Props and effects ------------------------------------------------
    const animated = this.stage?.userData.animated || [];
    for (const prop of animated) prop.userData.update?.(dt, elapsed);
    this.vfx.update(dt, elapsed);

    // --- Fades ------------------------------------------------------------
    let fade = 1;
    const sceneInfo = this.plan.scenes[this.sceneIndex];
    if (sceneInfo) {
      const into = (this.time - sceneInfo.start) / 0.7;
      const outOf = (sceneInfo.start + sceneInfo.duration - this.time) / 0.7;
      fade = Math.min(1, Math.max(0, Math.min(into, outOf)));
    }
    if (shot.transition) fade = Math.min(fade, 1 - t * 0.85);
    this.engine.fade += (fade - this.engine.fade) * Math.min(1, dt * 8);

    this.cutFlash = Math.max(0, this.cutFlash - dt * 4);
  }

  // -------------------------------------------------------------------------
  // Beat handling
  // -------------------------------------------------------------------------

  #onShotStart(shot) {
    // Subtle: on an over-the-shoulder, the listener turns in a little more.
    if (!shot.ots || !shot.secondary) return;
    const listener = this.cast.get(shot.secondary);
    const speaker = this.cast.get(shot.subject);
    if (!listener || !speaker) return;
    const toSpeaker = Math.atan2(
      speaker.position.x - listener.position.x,
      speaker.position.z - listener.position.z,
    );
    this.movers.get(shot.secondary).facing = toSpeaker * 0.75;
  }

  #onBeatStart(beat, shot) {
    if (!beat) return;

    const speakerName = beat.character || shot.subject;
    const speaker = speakerName ? this.cast.get(speakerName) : null;

    // Pose everyone: speaker performs, everyone else listens and watches.
    for (const [name, animator] of this.animators) {
      const character = this.cast.get(name);
      if (!character?.parent) continue;
      animator.emotion = beat.emotion || 'neutral';
      if (name === speakerName && (beat.type === 'dialogue' || beat.type === 'lyric')) {
        animator.setPose(poseForBeat(beat));
        animator.setTalking(true, beat.intensity ?? 0.5);
        animator.gesture(0.5);
        const partner = this.blocking?.get(name)?.partner;
        const other = partner ? this.cast.get(partner) : null;
        if (other) animator.lookAt(headPosition(other), 0.85);
        else animator.clearLook();
      } else {
        animator.setTalking(false);
        if (beat.type === 'action' && shot.subject === name) {
          animator.setPose(beat.cues?.length ? 'castOne' : 'idleAlt');
        } else {
          animator.setPose(name === shot.secondary ? 'listen' : 'idle');
        }
        if (speaker && speaker !== character) {
          animator.lookAt(headPosition(speaker), 0.95);
        }
      }
    }

    // Fire any magic cues attached to this beat.
    const cues = beat.cues || (beat.kind === 'ability' ? [beat] : []);
    for (const cue of cues) {
      const key = `${beat.id}:${cue.ability}`;
      if (this.firedCues.has(key)) continue;
      this.firedCues.add(key);
      this.#fireCue(cue, speakerName || shot.subject);
    }

    this.onBeatChange?.(beat, shot);
  }

  #fireCue(cue, fallbackActor) {
    const ability = cue.ability;
    if (!ability || !ABILITY_DEFAULTS[ability]) return;

    const actorName = cue.actor || fallbackActor;
    const actor = actorName ? this.cast.get(actorName) : null;
    const spec = actorName ? this.specs.get(actorName) : null;
    const colour = spec?.magic?.colour || MAGIC_COLOURS[ability] || ABILITY_DEFAULTS[ability].colour;

    let origin;
    if (actor) {
      // Cast from the raised hand — the pose has already put it out front.
      const hand = actor.userData.bones.handL;
      hand.updateWorldMatrix(true, false);
      origin = _v.setFromMatrixPosition(hand.matrixWorld).clone();
      this.animators.get(actorName)?.setPose(ability === 'shield' ? 'cast' : 'castOne');
    } else {
      origin = new THREE.Vector3(0, 1.2, 0);
    }

    // Resolve a target: another character, or the prop the cue names.
    let target = null;
    let targetObject = null;
    if (cue.target) {
      const targetChar = this.cast.get(cue.target);
      if (targetChar) {
        target = headPosition(targetChar);
      } else {
        const prop = (this.stage?.userData.props || [])
          .find((p) => p.userData.propName?.toLowerCase() === cue.target.toLowerCase());
        if (prop) {
          target = prop.position.clone().setY(prop.position.y + 0.4);
          targetObject = prop;
        }
      }
    }

    const opts = { origin, target, colour, character: actor };
    if (ability === 'telekinesis' && targetObject) opts.targetObject = targetObject;
    if (ability === 'shield' || ability === 'heal' || ability === 'illusion') {
      // These read as enveloping the caster, so drop to their feet.
      opts.origin = actor ? actor.position.clone() : origin;
    }
    this.vfx.spawn(ability, opts);

    // A clock in the room should answer a spell — small, but it sells a world.
    if (this.stage?.userData.clock && (ability === 'teleport' || ability === 'shadow')) {
      this.stage.userData.clock.userData.chime?.();
    }
  }

  #captionFor(shot) {
    const beat = shot.beat;
    if (!beat) return null;
    if (beat.type === 'dialogue') {
      return { speaker: beat.character, text: beat.text, kind: beat.singing ? 'sung' : 'spoken' };
    }
    if (beat.type === 'lyric') {
      return { speaker: beat.character, text: beat.text, kind: 'lyric' };
    }
    if (beat.type === 'action' && beat.text) {
      return { speaker: null, text: beat.text, kind: 'action' };
    }
    return null;
  }
}
