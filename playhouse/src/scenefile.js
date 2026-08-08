/**
 * The scene file — an explicit, editable description of a staged production.
 *
 * This is the seam the whole product turns on. Until now the app inferred
 * everything from prose: which room, where people stood, what the camera did.
 * Inference is fine for a first pass and hopeless as an authoring tool, because
 * there is no way to say "no, the drone is over *there*".
 *
 * A scene file says it outright. Every prop has a position. Every shot names
 * its size, move and subject. Every action names its actor. Nothing is guessed.
 *
 * That makes two things the same operation:
 *   - a director (human or model) writing a file, and
 *   - the app editing one.
 * Which is what lets an authoring UI and an AI director be one product rather
 * than two.
 *
 * The format is deliberately flat and boring: an LLM has to emit it reliably
 * on the first try, and a person has to be able to read a diff of it.
 */

import {
  BLENDER_PROPS, BROWSER_PROPS, BLENDER_POSES, BROWSER_POSES, ABILITIES, PROP_META,
} from './vocabulary.js';

export const SCENE_VERSION = 1;

/** Camera sizes, mirroring director.js SHOT_SIZES. */
const SIZES = ['ECU', 'CU', 'MCU', 'MS', 'MWS', 'WS', 'EWS'];
const MOVES = ['static', 'push', 'pull', 'dolly', 'crane', 'handheld', 'orbit', 'track'];
const HEIGHTS = ['low', 'eye', 'high'];
const MOODS = ['NIGHT', 'DAY', 'DUSK', 'DAWN', 'STORM'];
const GROUNDS = ['grass', 'dirt', 'cobble', 'stone', 'plank', 'sand'];

/** Action verbs a shot may contain. */
const VERBS = [
  'move',     // walk/run to a position
  'pose',     // adopt a named pose
  'look',     // aim head/eyes at an actor, prop or point
  'hold',     // attach a prop to a hand
  'release',  // let go of a held prop
  'face',     // turn to a heading, or toward a target
  'vfx',      // fire a magic ability
  'prop',     // move/animate a placed prop (drones hovering, doors opening)
];

/** Verbs that drive a person. `prop` drives a placed prop; `vfx` takes either. */
const CAST_VERBS = ['move', 'pose', 'look', 'hold', 'release', 'face'];

const HANDS = ['L', 'R'];

/**
 * CONTRACT 1's whole option vocabulary. build_prop forwards an option only to a
 * builder that declares a parameter of that name, and `colour`/`size` are the
 * only two any builder declares, so this list is the whole of it.
 */
const OPTION_KEYS = ['colour', 'size'];

/** Every type either renderer can build, and every pose either can strike. */
const PROP_TYPES = [...new Set([...BROWSER_PROPS, ...BLENDER_PROPS])];
const POSE_NAMES = [...new Set([...BROWSER_POSES, ...BLENDER_POSES])];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isVec2 = (v) => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

/** Levenshtein distance, one row at a time. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * The valid name a mistake most likely meant, or null.
 *
 * Plain edit distance is not enough for the mistakes that actually happen: a
 * model reaching for a pose writes the English word, and "sitting" is four
 * edits from "sit" — further than the threshold anything useful can carry.
 * So a candidate that starts the attempt, or is contained by it, is scored as
 * the near miss it plainly is.
 */
function nearest(name, candidates) {
  if (typeof name !== 'string' || !name) return null;
  const want = name.toLowerCase();
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const have = String(candidate).toLowerCase();
    let score = editDistance(want, have);
    if (have.startsWith(want) || want.startsWith(have)) score -= 2;
    else if (have.includes(want) || want.includes(have)) score -= 1;
    if (score < bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore <= 3 ? best : null;
}

/**
 * The tail of an error message: a single guess, or the whole vocabulary.
 *
 * These messages are read by a language model as repair instructions, and
 * "invalid pose" leaves it to guess twice. A near miss gets the one name it
 * meant; a name from nowhere gets the list, because the model has evidently
 * no idea what the vocabulary is and one more round trip is worse than one
 * more line of text.
 */
function didYouMean(name, candidates) {
  if (!candidates.length) return 'there are none to choose from';
  const near = nearest(name, candidates);
  return near ? `did you mean "${near}"?` : `valid: ${candidates.join(', ')}`;
}

/**
 * Check a scene file, collecting every problem rather than throwing on the
 * first. A director gets one report and fixes everything at once.
 *
 * @param {object} scene
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateScene(scene) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!scene || typeof scene !== 'object') {
    return { ok: false, errors: ['scene is not an object'], warnings };
  }
  if (scene.version !== SCENE_VERSION) {
    W(`version ${scene.version} != ${SCENE_VERSION}; loading anyway`);
  }

  /**
   * Findings about a *name* rather than a place, raised once each.
   *
   * scatter() turns one authoring decision into forty prop entries, so a beach
   * dressed with a Blender-only parasol reported nineteen identical lines and
   * buried everything else in the file. The name is the unit of repair here —
   * fixing one occurrence of a mis-spelt pose means fixing all of them — so
   * each is reported against the first place it appears, with a count.
   */
  const byName = new Map();
  const line = (f) => `${f.at} ${f.text}`
    + (f.count > 1 ? ` (and ${f.count - 1} more occurrence${f.count > 2 ? 's' : ''})` : '');
  const finding = (level, key, at, text) => {
    const list = level === 'error' ? errors : warnings;
    const seen = byName.get(key);
    // Rewritten in place rather than appended at the end, so the report still
    // reads top to bottom through the file.
    if (seen) { seen.count++; list[seen.index] = line(seen); return; }
    const found = { level, at, text, count: 1, index: list.length };
    byName.set(key, found);
    list.push(line(found));
  };

  /**
   * The browser and Blender asset libraries are written separately and will
   * never be identical, so refusing to preview a scene because Cycles lacks a
   * chandelier would make the preview useless. But a director who is never
   * told loses the prop from the finished film without ever seeing it go.
   */
  const checkPropCoverage = (type, at) => {
    const browser = BROWSER_PROPS.includes(type);
    const blender = BLENDER_PROPS.includes(type);
    if (!blender) finding('warning', `film:${type}`, at, `${show(type)} builds in the browser preview but ph_assets has no make_${type}, so it will be missing from the Blender render`);
    else if (!browser) finding('warning', `preview:${type}`, at, `${show(type)} builds in Blender but is not in the browser prop registry, so it will be missing from the preview`);
  };

  /** A type neither renderer can build is fatal; one only half of them has is a note. */
  const checkPropType = (type, at) => {
    if (typeof type !== 'string') { E(`${at} must be a string prop type`); return; }
    if (!PROP_TYPES.includes(type)) finding('error', `type:${type}`, at, `${show(type)} is not a prop type; ${didYouMean(type, PROP_TYPES)}`);
    else checkPropCoverage(type, at);
  };

  /**
   * The same split for poses, and the sharper of the two cases: a pose only
   * anim.js knows validates, previews correctly, and then stands the actor in
   * `idle` for the render — which is a person doing nothing in the frame the
   * scene was written around.
   */
  const checkPose = (pose, at) => {
    if (typeof pose !== 'string') { E(`${at} must be a pose name`); return; }
    const browser = BROWSER_POSES.includes(pose);
    const blender = BLENDER_POSES.includes(pose);
    if (!browser && !blender) finding('error', `pose:${pose}`, at, `${show(pose)} is not a pose; ${didYouMean(pose, POSE_NAMES)}`);
    else if (!blender) finding('warning', `pose-film:${pose}`, at, `${show(pose)} is in anim.js but not ph_assets.POSES, so the Blender render will stand this actor in "idle"`);
    else if (!browser) finding('warning', `pose-preview:${pose}`, at, `${show(pose)} is in ph_assets.POSES but not anim.js, so the browser preview will stand this actor in "idle"`);
  };

  /** CONTRACT: options carry a "#rrggbb" `colour` and a [w, h, d] `size` in metres. */
  const checkOptions = (options, at) => {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      E(`${at} must be an object of build options`);
      return;
    }
    // Silently dropped by build_prop, which forwards by parameter name and has
    // no builder spelling it this way.
    if (options.color !== undefined) E(`${at}.color is spelt "colour"`);
    if (options.colour !== undefined && !isHex(options.colour)) E(`${at}.colour must be a "#rrggbb" string, not ${show(options.colour)}`);
    if (options.size !== undefined && !isVec3(options.size)) E(`${at}.size must be [width, height, depth] in metres`);
    // Same reason as `color`: build_prop forwards by parameter name, so a key
    // no builder declares does nothing at all. Caught here rather than left to
    // the render, where it is one warning among the directorial ones and the
    // prop comes out the default colour with nobody the wiser.
    for (const key of Object.keys(options)) {
      if (key === 'colour' || key === 'size' || key === 'color') continue;
      const near = nearest(key, OPTION_KEYS);
      E(`${at}.${key} is not a build option${near ? `; did you mean "${near}"?` : `; options are ${OPTION_KEYS.join(', ')}`}`);
    }
  };

  // --- environment ---------------------------------------------------------
  const env = scene.environment;
  const propIds = new Set();
  const propTypes = new Map();
  if (!env || typeof env !== 'object') E('environment is required');
  else {
    if (env.mood && !MOODS.includes(env.mood)) E(`environment.mood "${env.mood}" not in ${MOODS.join('|')}`);
    if (env.ground && !GROUNDS.includes(env.ground)) E(`environment.ground "${env.ground}" not in ${GROUNDS.join('|')}`);
    if (env.size && !isVec2(env.size)) E('environment.size must be [width, depth]');
    if (env.fog !== undefined && !isNum(env.fog)) E('environment.fog must be a number');
    if (env.props !== undefined && !Array.isArray(env.props)) E('environment.props must be an array');
    for (const [i, p] of (Array.isArray(env.props) ? env.props : []).entries()) {
      const at = `environment.props[${i}]`;
      if (!p.type) E(`${at}.type is required`);
      else checkPropType(p.type, `${at}.type`);
      if (!p.id) E(`${at}.id is required (actions reference props by id)`);
      else if (propIds.has(p.id)) E(`${at}.id "${p.id}" is duplicated; a second prop under the same id is unreachable, and a hand-off would pick whichever one came first`);
      else { propIds.add(p.id); propTypes.set(p.id, p.type); }
      if (!isVec3(p.at)) E(`${at}.at must be [x, y, z]`);
      if (p.rot !== undefined && !isNum(p.rot)) E(`${at}.rot must be a number (radians)`);
      if (p.scale !== undefined && (!isNum(p.scale) || p.scale <= 0)) E(`${at}.scale must be a positive number`);
      if (p.options !== undefined) checkOptions(p.options, `${at}.options`);
    }
  }

  // --- cast ----------------------------------------------------------------
  const castIds = new Set();
  if (!Array.isArray(scene.cast)) E('cast must be an array');
  else {
    for (const [i, c] of scene.cast.entries()) {
      const at = `cast[${i}]`;
      if (!c.id) E(`${at}.id is required`);
      else if (castIds.has(c.id)) E(`${at}.id "${c.id}" is duplicated`);
      else castIds.add(c.id);
      if (c.at !== undefined && !isVec2(c.at) && !isVec3(c.at)) E(`${at}.at must be [x, z] or [x, y, z]`);
      if (c.facing !== undefined && !isNum(c.facing)) E(`${at}.facing must be a number (radians)`);
      if (c.spec !== undefined && (typeof c.spec !== 'object' || Array.isArray(c.spec))) E(`${at}.spec must be an object`);
    }
  }

  const known = (id) => castIds.has(id) || propIds.has(id);
  const ids = [...castIds, ...propIds];

  // Cast and props share one namespace — `subject`, `target` and `actor` all
  // resolve against both — so a shared id makes every reference ambiguous.
  for (const id of propIds) {
    if (castIds.has(id)) E(`"${id}" is both a cast id and a prop id; camera subjects and action targets resolve against one namespace, so the two cannot share a name`);
  }

  /**
   * A `hold` names either a placed prop by id or a bare type to conjure one,
   * which is deliberate — GUARD_L holds "rifle" without the scene file having
   * to place two rifles first — but it also means a typo has two ways to look
   * plausible and neither renderer will say a word about it.
   */
  const checkHeldProp = (name, at, holding) => {
    if (typeof name !== 'string') { E(`${at} must be a prop id or a prop type`); return; }
    if (!propIds.has(name) && !PROP_TYPES.includes(name)) {
      E(`${at} ${show(name)} is neither a prop id from environment.props nor a prop type; ${didYouMean(name, [...propIds, ...PROP_TYPES])}`);
      return;
    }
    // A bare type conjures a prop that environment.props never declared, so
    // this is the only place its renderer coverage gets looked at.
    if (!propIds.has(name)) checkPropCoverage(name, at);
    const type = propTypes.get(name) ?? name;
    const meta = PROP_META[type];
    // Only the 'held'/'handheld' types carry an authored grip; everything else
    // is parented to the hand at its own origin. For a cup that is fine — its
    // origin is its base and it is smaller than the hand closing round it, and
    // a cup passed between actors is the example this format was designed for.
    // For a wardrobe it is not. HAND_SPAN is what a hand can plausibly close
    // on rather than anything measured off a frame, so this stays a note.
    const HAND_SPAN = 0.5;
    if (holding && meta && !meta.tags.some((t) => t === 'held' || t === 'handheld')
        && Math.max(...meta.size) > HAND_SPAN) {
      finding('warning', `carry:${type}`, at,
        `${show(name)} is ${meta.category} (${meta.size.join(' x ')} m) with no grip authored for it, so it will hang off the hand at its own origin; something that size wants a 'handheld' entry in the prop registry before an actor can hold it`);
    }
  };

  // --- shots ---------------------------------------------------------------
  const shotIds = new Set();
  if (!Array.isArray(scene.shots) || !scene.shots.length) E('shots must be a non-empty array');
  else {
    for (const [i, s] of scene.shots.entries()) {
      const at = `shots[${i}]`;
      if (!isNum(s.duration) || s.duration <= 0) E(`${at}.duration must be a positive number`);
      // Not fatal — the renderer prefixes frames with the shot index — but a
      // repeated id makes "render just this shot" and every warning about it
      // ambiguous.
      if (s.id) {
        if (shotIds.has(s.id)) W(`${at}.id "${s.id}" is used by an earlier shot`);
        else shotIds.add(s.id);
      }
      const cam = s.camera || {};
      if (cam.size && !SIZES.includes(cam.size)) E(`${at}.camera.size "${cam.size}" not in ${SIZES.join('|')}`);
      if (cam.move && !MOVES.includes(cam.move)) E(`${at}.camera.move "${cam.move}" not in ${MOVES.join('|')}`);
      if (cam.height && !HEIGHTS.includes(cam.height)) E(`${at}.camera.height "${cam.height}" not in ${HEIGHTS.join('|')}`);
      if (cam.subject && !known(cam.subject)) E(`${at}.camera.subject "${cam.subject}" is not a cast or prop id; ${didYouMean(cam.subject, ids)}`);
      if (cam.secondary && !known(cam.secondary)) E(`${at}.camera.secondary "${cam.secondary}" is not a cast or prop id; ${didYouMean(cam.secondary, ids)}`);
      if (cam.ots && !cam.secondary) E(`${at}.camera.ots needs a secondary to shoot over`);
      if (cam.at !== undefined && !isVec3(cam.at)) E(`${at}.camera.at must be [x, y, z]`);
      if (cam.lookAt !== undefined && !isVec3(cam.lookAt)) E(`${at}.camera.lookAt must be [x, y, z]`);
      // ±1 picks which side of the line of action the camera lives on. 0 is the
      // plausible wrong answer and both renderers quietly read it as 1, which
      // crosses the line for anyone who meant "neither".
      if (cam.side !== undefined && cam.side !== 1 && cam.side !== -1) E(`${at}.camera.side must be 1 or -1 (which side of the line of action to shoot from), not ${show(cam.side)}`);
      if (cam.lens !== undefined && cam.lens !== null) {
        if (!isNum(cam.lens) || cam.lens <= 0) E(`${at}.camera.lens must be a positive number (vertical field of view in degrees)`);
        else finding('warning', 'lens', `${at}.camera.lens`, 'is read by the Blender render only; the browser preview solves its own field of view and ignores it');
      }
      if (!cam.subject && !cam.at && !cam.lookAt) {
        W(`${at}.camera has no subject and no explicit placement; it will fall back to a stage view`);
      }
      if (s.actions !== undefined && !Array.isArray(s.actions)) E(`${at}.actions must be an array`);
      for (const [j, a] of (Array.isArray(s.actions) ? s.actions : []).entries()) {
        const aat = `${at}.actions[${j}]`;
        if (!VERBS.includes(a.do)) { E(`${aat}.do "${a.do}" not in ${VERBS.join('|')}`); continue; }

        // Both renderers look an actor up in the cast table, then in the prop
        // table, and return silently when the verb does not match what they
        // found. A drone told to `pose` is not an error anywhere downstream —
        // it is simply a line of the scene file that never happens.
        if (!a.actor) E(`${aat}.actor is required`);
        else if (!known(a.actor)) E(`${aat}.actor "${a.actor}" is not a cast or prop id; ${didYouMean(a.actor, ids)}`);
        else if (a.do === 'prop' && !propIds.has(a.actor)) E(`${aat}.actor "${a.actor}" is a cast member, but do:"prop" moves a placed prop; name one from environment.props, or use do:"move" for a person`);
        else if (CAST_VERBS.includes(a.do) && !castIds.has(a.actor)) E(`${aat}.actor "${a.actor}" is a prop, but do:"${a.do}" acts on a cast member${a.do === 'move' ? '; use do:"prop" with .to to move a prop' : ''}`);

        // `target` is how look, face and vfx find what they are about, and a
        // target that resolves to nothing leaves the actor staring straight
        // ahead with no complaint from either renderer.
        if (a.target !== undefined && !known(a.target)) E(`${aat}.target "${a.target}" is not a cast or prop id; ${didYouMean(a.target, ids)}`);

        if (a.pose !== undefined) {
          checkPose(a.pose, `${aat}.pose`);
          if (a.do !== 'pose' && a.do !== 'move') W(`${aat}.pose is only read by do:"pose" and do:"move"; here it will be ignored`);
        }
        if (a.hand !== undefined && !HANDS.includes(a.hand)) E(`${aat}.hand must be "L" or "R", not ${show(a.hand)}`);
        if (a.colour !== undefined && !isHex(a.colour)) E(`${aat}.colour must be a "#rrggbb" string, not ${show(a.colour)}`);
        if (a.color !== undefined) E(`${aat}.color is spelt "colour"`);

        if (a.do === 'move') {
          if (!isVec2(a.to) && !isVec3(a.to)) E(`${aat}.to must be [x, z] or [x, y, z]`);
          if (a.speed !== undefined && (!isNum(a.speed) || a.speed <= 0)) E(`${aat}.speed must be a positive number (metres per second; above 2.2 becomes a run)`);
          if (a.facing !== undefined && !isNum(a.facing)) E(`${aat}.facing must be a number (radians)`);
        }
        if (a.do === 'pose' && !a.pose) E(`${aat}.pose is required`);
        if (a.do === 'hold') {
          if (!a.prop) E(`${aat}.prop is required`);
          else checkHeldProp(a.prop, `${aat}.prop`, true);
          if (a.options !== undefined) checkOptions(a.options, `${aat}.options`);
        }
        if (a.do === 'release' && a.prop !== undefined) checkHeldProp(a.prop, `${aat}.prop`, false);
        if (a.do === 'look') {
          if (!a.at && !a.target) E(`${aat} needs .target (an id) or .at (a point)`);
          if (a.at !== undefined && !isVec3(a.at)) E(`${aat}.at must be [x, y, z]`);
          if (a.weight !== undefined && (!isNum(a.weight) || a.weight < 0 || a.weight > 1)) E(`${aat}.weight must be a number from 0 to 1`);
        }
        if (a.do === 'face') {
          if (a.to === undefined && !a.target) E(`${aat} needs .to (radians) or .target (an id)`);
          else if (a.to !== undefined && !isNum(a.to)) E(`${aat}.to must be a heading in radians (face takes an angle, not a point)`);
        }
        if (a.do === 'vfx') {
          if (a.ability === undefined) W(`${aat}.ability is not set, so it will fire "light"`);
          else if (!ABILITIES.includes(a.ability)) E(`${aat}.ability ${show(a.ability)} is not an ability; ${didYouMean(a.ability, ABILITIES)}`);
          // render_scene.apply_action takes vfx and does nothing: a spell is a
          // thing that happens over time and a still has none.
          finding('warning', 'vfx', aat, 'plays in the browser preview only; the Blender render has no effect system, so the still will show the actors without it');
        }
        if (a.do === 'prop') {
          if (a.to !== undefined && !isVec2(a.to) && !isVec3(a.to)) E(`${aat}.to must be [x, z] or [x, y, z]`);
          if (a.hover !== undefined && !isNum(a.hover)) E(`${aat}.hover must be a number (height above the ground in metres)`);
          if (a.rot !== undefined && !isNum(a.rot)) E(`${aat}.rot must be a number (radians)`);
          if (a.to === undefined && a.hover === undefined && a.rot === undefined) W(`${aat} sets no to, hover or rot, so it does nothing`);
        }
      }

      if (s.caption && typeof s.caption.text !== 'string') E(`${at}.caption.text must be a string`);
      if (s.fade && !['in', 'out'].includes(s.fade)) E(`${at}.fade must be "in" or "out"`);
    }
  }

  // `ok` deliberately ignores warnings: everything in there renders somewhere,
  // and a note about the half of the pipeline that will miss it must never be
  // the reason a scene refuses to play.
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Fill in defaults and compute absolute shot start times.
 *
 * Durations are authored, starts are derived — a director should never have to
 * keep a running total in their head, and an edit to shot 2 must not silently
 * desynchronise shots 3 onward.
 *
 * @returns {object} a new scene; the input is not mutated
 */
export function normaliseScene(scene) {
  const env = scene.environment || {};
  const out = {
    version: SCENE_VERSION,
    title: scene.title || 'Untitled',
    environment: {
      preset: env.preset || 'custom',
      ground: env.ground || 'grass',
      size: env.size || [30, 30],
      mood: env.mood || 'DAY',
      fog: env.fog,
      sky: env.sky,
      props: (env.props || []).map((p) => ({
        id: p.id,
        type: p.type,
        at: p.at,
        rot: p.rot ?? 0,
        scale: p.scale ?? 1,
        options: p.options || {},
      })),
    },
    cast: (scene.cast || []).map((c) => ({
      id: c.id,
      name: c.name || c.id,
      spec: c.spec || {},
      at: c.at ? (c.at.length === 2 ? [c.at[0], 0, c.at[1]] : c.at) : [0, 0, 0],
      facing: c.facing ?? 0,
    })),
    shots: [],
  };

  let clock = 0;
  for (const s of scene.shots || []) {
    const cam = s.camera || {};
    const shot = {
      id: s.id || `shot${out.shots.length}`,
      start: clock,
      duration: s.duration,
      camera: {
        size: cam.size || 'MS',
        subject: cam.subject || null,
        secondary: cam.secondary || null,
        move: cam.move || 'static',
        height: cam.height || 'eye',
        side: cam.side ?? 1,
        ots: cam.ots || false,
        at: cam.at || null,
        lookAt: cam.lookAt || null,
        lens: cam.lens || null,
      },
      actions: (s.actions || []).map((a) => ({ ...a })),
      caption: s.caption || null,
      fade: s.fade || null,
      note: s.note || null,
    };
    out.shots.push(shot);
    clock += s.duration;
  }
  out.duration = clock;
  return out;
}

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

/**
 * Scatter props in a ring, avoiding a central acting area.
 *
 * A director writing a forest should not have to hand-place forty trees, but
 * should still be able to move any individual one afterwards — so this emits
 * ordinary prop entries with real ids rather than a special "scatter" node.
 *
 * @param {object} opts `{ type, count, inner, outer, id, seed, jitter, scale }`
 * @returns {object[]} prop entries for environment.props
 */
export function scatter({
  type, count, inner = 6, outer = 14, id = type,
  seed = 1, scaleMin = 0.8, scaleMax = 1.3, y = 0,
}) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const out = [];
  for (let i = 0; i < count; i++) {
    // Golden-angle spacing keeps a ring from clumping the way pure random does.
    const a = i * 2.399963 + rnd() * 0.5;
    const r = inner + Math.sqrt(rnd()) * (outer - inner);
    out.push({
      id: `${id}${i}`,
      type,
      at: [+(Math.cos(a) * r).toFixed(2), y, +(Math.sin(a) * r).toFixed(2)],
      rot: +(rnd() * Math.PI * 2).toFixed(3),
      scale: +(scaleMin + rnd() * (scaleMax - scaleMin)).toFixed(2),
    });
  }
  return out;
}

/** Render a scene file to pretty JSON, with arrays kept on one line. */
export function serialiseScene(scene) {
  const json = JSON.stringify(scene, null, 2);
  // Collapse short numeric arrays: [\n 1,\n 2\n ] reads terribly for positions.
  return json.replace(/\[\s+((?:-?[\d.]+,?\s+)+)\]/g, (m, body) => `[${body.trim().replace(/\s+/g, ' ')}]`);
}

/** Summarise a scene for a human: what's in it and how long it runs. */
export function describeScene(scene) {
  const n = normaliseScene(scene);
  const props = n.environment.props.length;
  const kinds = [...new Set(n.environment.props.map((p) => p.type))];
  return {
    title: n.title,
    duration: +n.duration.toFixed(1),
    shots: n.shots.length,
    cast: n.cast.map((c) => c.id),
    props,
    propKinds: kinds,
    mood: n.environment.mood,
    ground: n.environment.ground,
  };
}

/**
 * The complete authoring vocabulary, in one place.
 *
 * The LLM system prompt is written from exactly this export, and validateScene
 * checks against exactly these lists, so a director is never told about a prop
 * the validator will reject or refused a pose the prompt offered. The renderer
 * halves come from tools/vocabulary.mjs and cannot be edited into agreement by
 * hand.
 */
export {
  SIZES, MOVES, HEIGHTS, MOODS, GROUNDS, VERBS, HANDS,
  BLENDER_PROPS, BROWSER_PROPS, BLENDER_POSES, BROWSER_POSES, ABILITIES, PROP_META,
  PROP_TYPES, POSE_NAMES, OPTION_KEYS,
};
