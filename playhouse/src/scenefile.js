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

export const SCENE_VERSION = 1;

/** Camera sizes, mirroring director.js SHOT_SIZES. */
const SIZES = ['ECU', 'CU', 'MCU', 'MS', 'MWS', 'WS', 'EWS'];
const MOVES = ['static', 'push', 'pull', 'dolly', 'crane', 'handheld', 'orbit', 'track'];
const HEIGHTS = ['low', 'eye', 'high'];
const MOODS = ['NIGHT', 'DAY', 'DUSK', 'DAWN', 'STORM'];
const GROUNDS = ['grass', 'dirt', 'cobble', 'stone', 'plank'];

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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isVec2 = (v) => Array.isArray(v) && v.length === 2 && v.every(isNum);

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

  // --- environment ---------------------------------------------------------
  const env = scene.environment;
  if (!env || typeof env !== 'object') E('environment is required');
  else {
    if (env.mood && !MOODS.includes(env.mood)) E(`environment.mood "${env.mood}" not in ${MOODS.join('|')}`);
    if (env.ground && !GROUNDS.includes(env.ground)) E(`environment.ground "${env.ground}" not in ${GROUNDS.join('|')}`);
    if (env.size && !isVec2(env.size)) E('environment.size must be [width, depth]');
    if (env.fog !== undefined && !isNum(env.fog)) E('environment.fog must be a number');
    if (env.props !== undefined && !Array.isArray(env.props)) E('environment.props must be an array');
    for (const [i, p] of (env.props || []).entries()) {
      const at = `environment.props[${i}]`;
      if (!p.type) E(`${at}.type is required`);
      if (!p.id) E(`${at}.id is required (actions reference props by id)`);
      if (!isVec3(p.at)) E(`${at}.at must be [x, y, z]`);
      if (p.rot !== undefined && !isNum(p.rot)) E(`${at}.rot must be a number (radians)`);
      if (p.scale !== undefined && !isNum(p.scale)) E(`${at}.scale must be a number`);
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
    }
  }

  const propIds = new Set((env?.props || []).map((p) => p.id));
  const known = (id) => castIds.has(id) || propIds.has(id);

  // --- shots ---------------------------------------------------------------
  if (!Array.isArray(scene.shots) || !scene.shots.length) E('shots must be a non-empty array');
  else {
    for (const [i, s] of scene.shots.entries()) {
      const at = `shots[${i}]`;
      if (!isNum(s.duration) || s.duration <= 0) E(`${at}.duration must be a positive number`);
      const cam = s.camera || {};
      if (cam.size && !SIZES.includes(cam.size)) E(`${at}.camera.size "${cam.size}" not in ${SIZES.join('|')}`);
      if (cam.move && !MOVES.includes(cam.move)) E(`${at}.camera.move "${cam.move}" not in ${MOVES.join('|')}`);
      if (cam.height && !HEIGHTS.includes(cam.height)) E(`${at}.camera.height "${cam.height}" not in ${HEIGHTS.join('|')}`);
      if (cam.subject && !known(cam.subject)) E(`${at}.camera.subject "${cam.subject}" is not a cast or prop id`);
      if (cam.secondary && !known(cam.secondary)) E(`${at}.camera.secondary "${cam.secondary}" is not a cast or prop id`);
      if (cam.ots && !cam.secondary) E(`${at}.camera.ots needs a secondary to shoot over`);
      if (cam.at !== undefined && !isVec3(cam.at)) E(`${at}.camera.at must be [x, y, z]`);
      if (cam.lookAt !== undefined && !isVec3(cam.lookAt)) E(`${at}.camera.lookAt must be [x, y, z]`);
      if (!cam.subject && !cam.at && !cam.lookAt) {
        W(`${at}.camera has no subject and no explicit placement; it will fall back to a stage view`);
      }

      for (const [j, a] of (s.actions || []).entries()) {
        const aat = `${at}.actions[${j}]`;
        if (!VERBS.includes(a.do)) { E(`${aat}.do "${a.do}" not in ${VERBS.join('|')}`); continue; }
        if (!a.actor) E(`${aat}.actor is required`);
        else if (!known(a.actor)) E(`${aat}.actor "${a.actor}" is not a cast or prop id`);
        if (a.do === 'move' && !isVec2(a.to) && !isVec3(a.to)) E(`${aat}.to must be [x, z] or [x, y, z]`);
        if (a.do === 'pose' && !a.pose) E(`${aat}.pose is required`);
        if (a.do === 'hold' && !a.prop) E(`${aat}.prop is required`);
        if (a.do === 'look' && !a.at && !a.target) E(`${aat} needs .target (an id) or .at (a point)`);
        if (a.do === 'face' && a.to === undefined && !a.target) E(`${aat} needs .to (radians) or .target (an id)`);
      }

      if (s.caption && typeof s.caption.text !== 'string') E(`${at}.caption.text must be a string`);
      if (s.fade && !['in', 'out'].includes(s.fade)) E(`${at}.fade must be "in" or "out"`);
    }
  }

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

export { SIZES, MOVES, HEIGHTS, MOODS, GROUNDS, VERBS };
