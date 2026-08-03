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
import { direct, solveShot, shotAt, describeShot, findStageProp } from './director.js';
import { disposeObject } from './engine.js';
import { MAGIC_COLOURS } from './human.js';
import { loadAvatar, Retargeter, measureRestPose } from './avatar.js';
import { normaliseScene, validateScene } from './scenefile.js';
import { buildExplicitStage } from './stage.js';
import { NoteStack, applyNotes } from './notes.js';
import { createProp, attachToHand, detachFromHand, propsMentioned, PROP_NAMES } from './props.js';

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
    this.sceneMode = false;
    this.sceneFile = null;

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

    // Director notes: the UI owns the stack's contents; playback overlays it.
    this.notes = new NoteStack();
    this.notesRev = 0;        // bumped via noteStackChanged() on every edit
    this._noteCache = null;   // { src: shot, rev, out } — one overlay per shot
    this._propRev = -1;       // last rev the hands sync ran against
    this._propT = null;       // last time the hands sync ran at
    this._wildcardId = 0;     // "empty hands" note already applied

    this._held = new Set();   // prop groups currently riding a hand
  }

  /**
   * Tell playback the note stack changed (add/remove/toggle/undo/redo/replace)
   * so the per-shot overlay cache and the prop-hands sync recompute.
   */
  noteStackChanged() {
    this.notesRev++;
    this._noteCache = null;
    this._propT = null;
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

    // Props go home before their stages are disposed of.
    this.#dropAllHeld();

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
    // A held prop is parented under the hand bone — rescue it before the
    // whole group is disposed, or the prop's geometry dies with the body.
    for (const prop of [...this._held]) {
      if (prop.userData.heldBy === c) this.#releaseHome(prop);
    }
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

    // Hands empty at the door: the cast persists across scenes, so a prop
    // still parented to a hand would ride into a set it doesn't belong to.
    this.#dropAllHeld();

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
  // Scene files
  // -------------------------------------------------------------------------

  /**
   * Play an explicit scene file instead of an inferred script.
   *
   * Everything downstream — camera solving, notes, speech, held props — is
   * unchanged; only the source of truth moves from "guessed from prose" to
   * "stated outright".
   *
   * @param {object} sceneFile
   * @returns {object} the normalised scene
   */
  loadScene(sceneFile) {
    const check = validateScene(sceneFile);
    if (!check.ok) {
      throw new Error(`scene file invalid:\n  ${check.errors.join('\n  ')}`);
    }
    const scene = normaliseScene(sceneFile);

    for (const name of [...this.cast.keys()]) this.#destroyCharacter(name);
    if (this.stage) {
      this.engine.scene.remove(this.stage);
      disposeObject(this.stage);
      this.stage = null;
    }
    for (const cached of this.stageCache.values()) disposeObject(cached);
    this.stageCache.clear();
    this.vfx.clear();

    this.sceneMode = true;
    this.sceneFile = scene;
    this.currentBeat = null;
    this.firedCues.clear();
    this.script = {
      meta: { title: scene.title, author: '' },
      scenes: [],
      characters: scene.cast.map((c) => ({ name: c.id, lines: 0, songLines: 0 })),
    };

    this.stage = buildExplicitStage(scene.environment);
    this.engine.scene.add(this.stage);
    this.engine.applyMood(this.stage.userData.mood);
    this.sceneIndex = 0;

    scene.cast.forEach((c, i) => {
      const spec = castCharacter(c.id, c.spec || {}, i);
      const character = createCharacter(spec);
      const animator = new Animator(character, i);
      const mover = new Mover(character, animator);
      this.cast.set(c.id, character);
      this.specs.set(c.id, spec);
      this.animators.set(c.id, animator);
      this.movers.set(c.id, mover);
      this.engine.scene.add(character);
      mover.snapTo(new THREE.Vector3(c.at[0], c.at[1], c.at[2]), c.facing);
    });

    const shots = scene.shots.map((s) => {
      const subjectIsCast = !!s.camera.subject && this.cast.has(s.camera.subject);
      return {
        id: s.id,
        scene: 0,
        beat: null,
        start: s.start,
        duration: s.duration,
        size: s.camera.size,
        subject: subjectIsCast ? s.camera.subject : null,
        subjectProp: !subjectIsCast && s.camera.subject ? s.camera.subject : null,
        insert: !subjectIsCast && !!s.camera.subject,
        secondary: s.camera.secondary && this.cast.has(s.camera.secondary) ? s.camera.secondary : null,
        // `track` is a dolly that holds the subject; the solver already does
        // that, so it only needs the lateral move.
        move: s.camera.move === 'track' ? 'dolly' : s.camera.move,
        side: s.camera.side,
        height: s.camera.height,
        worldTarget: s.camera.lookAt ? new THREE.Vector3(...s.camera.lookAt) : null,
        explicitAt: s.camera.at ? new THREE.Vector3(...s.camera.at) : null,
        sceneShot: s,
      };
    });

    this.plan = {
      shots,
      scenes: [{ index: 0, start: 0, duration: scene.duration, scene: null }],
      duration: scene.duration,
    };
    this.notes = this.notes || null;
    this.seek(0);
    return scene;
  }

  /** World position of a cast member or a placed prop, by scene id. */
  #worldOf(id) {
    const character = this.cast.get(id);
    if (character) return headPosition(character);
    const prop = this.stage?.userData.byId?.get(id);
    if (prop) return prop.getWorldPosition(new THREE.Vector3());
    return null;
  }

  /** Run one scene shot's action list. */
  #applySceneShot(shot) {
    const s = shot.sceneShot;
    if (!s) return;
    this.caption = s.caption || null;

    for (const a of s.actions || []) {
      const animator = this.animators.get(a.actor);
      const mover = this.movers.get(a.actor);
      const character = this.cast.get(a.actor);
      const prop = this.stage?.userData.byId?.get(a.actor);

      switch (a.do) {
        case 'move': {
          if (!mover) break;
          const to = a.to.length === 2
            ? new THREE.Vector3(a.to[0], 0, a.to[1])
            : new THREE.Vector3(a.to[0], a.to[1], a.to[2]);
          const speed = a.speed ?? 1.2;
          mover.moveTo(to, a.facing ?? null, speed);
          // A run is a pose as much as a rate; without the forward lean a fast
          // walk cycle just reads as a hurried walk.
          if (a.pose) animator?.setPose(a.pose);
          else if (speed > 2.2) animator?.setPose('run');
          break;
        }
        case 'pose':
          animator?.setPose(a.pose);
          if (a.pose === 'handsUp' || a.pose === 'flinch') animator?.clearLook();
          break;
        case 'face': {
          if (!mover) break;
          if (a.target) {
            const t = this.#worldOf(a.target);
            if (t && character) {
              mover.facing = Math.atan2(t.x - character.position.x, t.z - character.position.z);
            }
          } else if (a.to !== undefined) {
            mover.facing = a.to;
          }
          break;
        }
        case 'look': {
          const t = a.target ? this.#worldOf(a.target) : (a.at ? new THREE.Vector3(...a.at) : null);
          if (t) animator?.lookAt(t, a.weight ?? 0.95);
          break;
        }
        case 'hold': {
          const held = this.#propForHand(a.prop, true);
          if (held) this.#holdProp(held, a.actor, a.hand || 'R');
          break;
        }
        case 'release': {
          const held = this.#heldPropNamed(a.prop);
          if (held) this.#releaseProp(held);
          break;
        }
        case 'vfx': {
          const origin = character ? character.position.clone() : (prop ? prop.position.clone() : new THREE.Vector3());
          const target = a.target ? this.#worldOf(a.target) : null;
          this.vfx.spawn(a.ability || 'light', { origin, target, colour: a.colour, character });
          break;
        }
        case 'prop': {
          if (!prop) break;
          if (a.to) {
            prop.position.set(
              a.to[0],
              a.to.length === 2 ? prop.position.y : a.to[1],
              a.to.length === 2 ? a.to[1] : a.to[2],
            );
            prop.userData.setHoverHeight?.(prop.position.y);
          }
          if (a.rot !== undefined) prop.rotation.y = a.rot;
          if (a.hover !== undefined) prop.userData.setHoverHeight?.(a.hover);
          break;
        }
        default:
          break;
      }
    }
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
    // Crossing into another beat resets hands (the staging that filled them
    // will re-fire); scrubbing within the current beat keeps the prop held.
    if (shot && shot.beat !== this.currentBeat) this.#dropAllHeld();
    if (shot) this.#ensureScene(shot.scene);
    this.currentShot = null; // force a fresh camera snap
    this._noteCache = null;
    this._propT = null;
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

    if (!this.sceneMode && shot.scene !== this.sceneIndex) this.#ensureScene(shot.scene);

    // Director notes season the pristine shot; cut detection stays on the raw
    // shot object so toggling a note mid-shot never re-triggers a cut.
    const staged = this.#notedShot(shot);

    const isCut = shot !== this.currentShot;
    if (isCut) {
      this.currentShot = shot;
      this.cutFlash = 1;
      if (this.sceneMode) this.#applySceneShot(staged);
      else this.#onShotStart(staged);
    }
    this.slate = describeShot(staged);

    const t = THREE.MathUtils.clamp((this.time - staged.start) / Math.max(0.001, staged.duration), 0, 1);

    // --- Beat state -------------------------------------------------------
    if (!this.sceneMode && shot.beat !== this.currentBeat) {
      this.currentBeat = shot.beat;
      this.#onBeatStart(shot.beat, shot);
    }
    this.caption = this.#captionFor(shot);
    this.#syncNoteProps();

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
    const solved = solveShot(staged, this.cast, this.stage, t, elapsed);
    // A scene file may pin the camera outright; the solver still supplies the
    // aim, headroom and lens so an explicit position is a nudge, not an escape.
    if (staged.explicitAt) solved.position.copy(staged.explicitAt);
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

    // Staging directions lifted from the prose: arcs, grips, releases.
    for (const entry of beat.staging || []) {
      if (entry.kind === 'orbit') this.#stageOrbit(entry);
      else if (entry.kind === 'hold') this.#stageHold(entry);
      else if (entry.kind === 'release') this.#stageRelease(entry);
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
        const prop = findStageProp(this.stage, cue.target);
        if (prop) {
          // World position, not local — the prop may be riding in a hand.
          target = prop.getWorldPosition(new THREE.Vector3());
          target.y += 0.4;
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

  // -------------------------------------------------------------------------
  // Staging: arcs and hands
  // -------------------------------------------------------------------------

  /** "MARA walks around JON" — a slow multi-waypoint arc, not a beeline. */
  #stageOrbit(entry) {
    const mover = this.movers.get(entry.actor);
    const actor = this.cast.get(entry.actor);
    if (!mover || !actor?.parent) return;

    let centre = null;
    if (entry.targetKind === 'prop') {
      const prop = findStageProp(this.stage, entry.target);
      if (prop) centre = prop.getWorldPosition(new THREE.Vector3()).setY(0);
    } else {
      const other = this.cast.get(entry.target);
      if (other?.parent) centre = other.position.clone().setY(0);
    }
    if (!centre) return;

    const dx = actor.position.x - centre.x;
    const dz = actor.position.z - centre.z;
    const r = THREE.MathUtils.clamp(Math.hypot(dx, dz) || 1.2, 1.0, 2.2);
    const a0 = Math.atan2(dx, dz);
    // Sweep toward downstage first so the mover crosses in front of the lens.
    const sign = dx >= 0 ? -1 : 1;
    const points = [];
    for (let k = 1; k <= 4; k++) {
      const a = a0 + sign * Math.PI * 0.9 * (k / 4);
      points.push(new THREE.Vector3(centre.x + Math.sin(a) * r, 0, centre.z + Math.cos(a) * r));
    }
    mover.followPath(points, null, 0.8);
  }

  /** "picks up the apple" — parent the named prop to the actor's hand. */
  #stageHold(entry) {
    if (!entry.prop) return; // objectWord-only: honest "no model", nothing to lift
    const prop = this.#propForHand(entry.prop, true);
    if (!prop) return;
    if (this.#holdProp(prop, entry.actor, entry.hand || 'R')) {
      const animator = this.animators.get(entry.actor);
      animator?.setPose('reach');
      animator?.gesture(0.5);
    }
  }

  /** "sets it down" — back out of the hand, settled at the actor's feet. */
  #stageRelease(entry) {
    const prop = this.#heldPropNamed(entry.prop);
    if (prop) this.#releaseProp(prop);
  }

  /**
   * A prop instance to put in a hand: an unheld one from the set, the held
   * one as a fallback, or — when the script/notes call for something the set
   * doesn't have — a freshly built one.
   */
  #propForHand(name, create = false) {
    const key = String(name).toLowerCase();
    const all = (this.stage?.userData.props || [])
      .filter((p) => p.userData.propName?.toLowerCase() === key);
    let prop = all.find((p) => !p.userData.heldBy) || all[0] || null;
    if (!prop && create && this.stage) {
      prop = createProp(name);
      if (prop) {
        this.stage.add(prop);
        this.stage.userData.props.push(prop);
        if (prop.userData.update) this.stage.userData.animated.push(prop);
      }
    }
    return prop;
  }

  #heldPropNamed(name) {
    if (!name) return null;
    const key = String(name).toLowerCase();
    for (const p of this._held) {
      if (p.userData.propName?.toLowerCase() === key) return p;
    }
    return null;
  }

  #holdProp(prop, actorName, hand = 'R') {
    const character = this.cast.get(actorName);
    if (!character || !prop) return false;
    if (prop.userData.heldBy === character) return true; // idempotent re-fire
    if (prop.userData.heldBy) detachFromHand(prop);
    if (!prop.userData.home) {
      // First lift: remember where it lives so seeks can put it back.
      prop.userData.home = {
        parent: prop.parent,
        pos: prop.position.clone(),
        rot: prop.rotation.clone(),
        scale: prop.scale.clone(),
      };
    }
    if (!attachToHand(character, prop, hand)) return false;
    this._held.add(prop);
    return true;
  }

  /** Let go and settle the prop on the floor at the holder's feet. */
  #releaseProp(prop) {
    if (!prop?.userData?.heldBy) return;
    const holder = prop.userData.heldBy;
    detachFromHand(prop);
    this._held.delete(prop);
    prop.userData.noteHeld = false;
    const yaw = holder.rotation?.y || 0;
    prop.position.set(
      holder.position.x + Math.sin(yaw) * 0.45,
      0,
      holder.position.z + Math.cos(yaw) * 0.45,
    );
    prop.rotation.set(0, prop.rotation.y, 0);
    if (prop.userData.home) prop.scale.copy(prop.userData.home.scale);
  }

  /** Put a held prop back exactly where the set dresser left it. */
  #releaseHome(prop) {
    if (!prop) return;
    if (prop.userData.heldBy) detachFromHand(prop);
    this._held.delete(prop);
    prop.userData.noteHeld = false;
    const home = prop.userData.home;
    if (home?.parent) {
      home.parent.add(prop);
      prop.position.copy(home.pos);
      prop.rotation.copy(home.rot);
      prop.scale.copy(home.scale);
    }
  }

  #dropAllHeld() {
    for (const prop of [...this._held]) this.#releaseHome(prop);
    this._held.clear();
  }

  // -------------------------------------------------------------------------
  // Director notes
  // -------------------------------------------------------------------------

  /** Camera-note overlay for a shot, cached until the shot or the stack changes. */
  #notedShot(shot) {
    const stack = this.notes;
    if (!stack || !stack.notes.length) return shot;
    const c = this._noteCache;
    if (c && c.src === shot && c.rev === this.notesRev) return c.out;
    const active = stack.notesAt(this.time, this.plan.shots);
    const out = applyNotes(shot, active);
    this._noteCache = { src: shot, rev: this.notesRev, out };
    return out;
  }

  /** Free note text -> a PROPS registry name, or null when we have no model. */
  #resolveNoteProp(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return null;
    if (PROP_NAMES.includes(t)) return t;
    return propsMentioned(t)[0] || null;
  }

  /**
   * Make hands match the prop notes in force at the current time. Notes
   * persist "until changed", so this runs as reconciliation — cheap (throttled
   * to ~4Hz and on stack edits), and reality-based rather than bookkept, so a
   * recast or scene swap self-heals on the next pass.
   */
  #syncNoteProps() {
    if (!this.stage || !this.plan) return;
    const t = this.time;
    const stale = this._propT === null || this.notesRev !== this._propRev
      || t < this._propT || t - this._propT >= 0.25;
    if (!stale) return;
    this._propRev = this.notesRev;
    this._propT = t;

    const stack = this.notes;
    const active = stack && stack.notes.length
      ? stack.notesAt(t, this.plan.shots).filter((n) => n.directive.kind === 'prop')
      : [];

    let wildcard = null;
    const wantHeld = new Map(); // prop name -> actor name
    const wantFree = new Set(); // prop names that must leave hands
    for (const n of active) {
      const d = n.directive;
      if (d.action === 'release' && !d.prop) { wildcard = n; continue; }
      const name = this.#resolveNoteProp(d.prop);
      if (!name) continue; // honest miss — the notes panel already said so
      if (d.action === 'hold') {
        const actor = (d.character && this.cast.has(d.character) ? d.character : null)
          || this.currentShot?.subject
          || this.currentBeat?.character
          || [...this.cast.keys()][0];
        if (actor && this.cast.get(actor)?.parent) {
          wantHeld.set(name, actor);
          wantFree.delete(name);
        }
      } else {
        wantHeld.delete(name);
        wantFree.add(name);
      }
    }

    // "Drop everything" empties every hand once, staged holds included.
    if (wildcard) {
      if (this._wildcardId !== wildcard.id) {
        this.#dropAllHeld();
        this._wildcardId = wildcard.id;
      }
    } else {
      this._wildcardId = 0;
    }

    // Note-held props the notes no longer command: let go.
    for (const prop of [...this._held]) {
      if (!prop.userData.noteHeld) continue;
      const name = prop.userData.propName?.toLowerCase();
      const wanted = name ? wantHeld.get(name) : null;
      if (!wanted || this.cast.get(wanted) !== prop.userData.heldBy) {
        this.#releaseProp(prop);
      }
    }
    // Explicit releases countermand staged holds too ("put down the lamp").
    for (const name of wantFree) {
      const prop = this.#heldPropNamed(name);
      if (prop) this.#releaseProp(prop);
    }
    for (const [name, actor] of wantHeld) {
      const character = this.cast.get(actor);
      const current = this.#heldPropNamed(name);
      if (current && current.userData.heldBy === character) {
        current.userData.noteHeld = true; // adopt a staged hold as noted
        continue;
      }
      const prop = this.#propForHand(name, true);
      if (prop && this.#holdProp(prop, actor, 'R')) prop.userData.noteHeld = true;
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
