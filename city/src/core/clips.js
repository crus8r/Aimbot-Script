// The authored motion library. Every clip here is a function of time that
// returns a pose description (see pose.js); nothing is keyframed by hand in a
// tool. Clips take options (seat height, which hand) so one definition covers
// a bar stool and a sofa.
//
// Conventions: +Z forward, +X the character's left, meters, degrees. The actor
// root sits on the floor directly under the pelvis for seated/lying clips, and
// under the feet for standing ones.
import { blend, seg, ease } from './pose.js';

const S = Math.sin, C = Math.cos, TAU = Math.PI * 2;
const lerp = (a, b, w) => a + (b - a) * w;
const v3 = (a, b, w) => [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];

// Relaxed arms, used as the upper body of anything that doesn't say otherwise.
export function armsDown(extra = {}) {
  return {
    aim: {
      LeftArm: [0.2, -1, 0.02], LeftForeArm: [0.1, -1, 0.2],
      RightArm: [-0.2, -1, 0.02], RightForeArm: [-0.1, -1, 0.2],
      ...(extra.aim || {}),
    },
    twist: { LeftForeArm: 10, RightForeArm: -10, ...(extra.twist || {}) },
    hand: { left: { curl: 0.3, thumb: 0.3 }, right: { curl: 0.3, thumb: 0.3 }, ...(extra.hand || {}) },
  };
}

function breathe(t, amp = 1) {
  const b = S(t * TAU / 4.2) * amp;
  return { Spine1: [b * 1.2, 0, 0], Spine2: [-b * 1.5, 0, 0] };
}

// Standing, feet planted, with an optional pelvis offset (used by transitions
// that begin standing in front of a seat).
function standSpec(M, t = 0, { z = 0, look = 0 } = {}) {
  const base = armsDown();
  return {
    ...base,
    hips: { at: [0, M.hipH - 0.005, z] },
    ik: {
      LeftLeg: { target: [M.legX + 0.02, M.ankle, z + 0.01], pole: [0, 0, 1] },
      RightLeg: { target: [-M.legX - 0.02, M.ankle, z - 0.01], pole: [0, 0, 1] },
    },
    abs: { LeftFoot: [0, 4, 0], RightFoot: [0, -4, 0] },
    rot: { ...breathe(t), Neck: [2, look * 0.4, 0], Head: [0, look * 0.6, 0] },
  };
}

// Seated on a surface `h` meters high. The pelvis joint sits ~10cm above the
// surface; feet go one thigh-length forward so the shins hang near vertical,
// clamped for tall seats where the feet can't reach the floor.
function sitSpec(M, t, { h = 0.46, lean = -4, hands = 'thighs', look = 0, feet = null } = {}) {
  const pelvisY = h + 0.1;
  const reach = pelvisY - M.ankle;
  const legLen = M.thigh + M.shin;
  let footY = M.ankle, footZ = M.thigh * 0.92;
  if (feet) { footY = feet[1]; footZ = feet[0]; }
  else if (reach > legLen * 0.95) { footY = pelvisY - M.shin * 0.95; footZ = M.thigh * 0.95; }
  const kneeZ = M.thigh * 0.95;
  const handY = pelvisY + 0.07;
  const b = breathe(t, 0.8);
  const spec = {
    hips: { at: [0, pelvisY, 0], rot: [lean, 0, 0] },
    ik: {
      LeftLeg: { target: [M.legX + 0.04, footY, footZ], pole: [0, 1, 1] },
      RightLeg: { target: [-M.legX - 0.04, footY, footZ], pole: [0, 1, 1] },
    },
    abs: { LeftFoot: [0, 6, 0], RightFoot: [0, -6, 0] },
    rot: { Spine: [-lean * 0.5, 0, 0], Spine1: [b.Spine1[0] - lean * 0.3, 0, 0], Spine2: b.Spine2, Neck: [4, look * 0.4, 0], Head: [-2, look * 0.6, 0] },
    aim: {},
    hand: { left: { curl: 0.35, thumb: 0.3 }, right: { curl: 0.35, thumb: 0.3 } },
  };
  if (hands === 'thighs') {
    spec.ik.LeftArm = { target: [M.legX + 0.05, handY, kneeZ * 0.72], pole: [1, -0.3, -1] };
    spec.ik.RightArm = { target: [-M.legX - 0.05, handY, kneeZ * 0.72], pole: [-1, -0.3, -1] };
  } else if (hands === 'table') {
    const ty = h + 0.3;
    spec.ik.LeftArm = { target: [0.14, ty + 0.03, 0.36], pole: [1, -0.5, -0.6] };
    spec.ik.RightArm = { target: [-0.14, ty + 0.03, 0.36], pole: [-1, -0.5, -0.6] };
  } else if (hands === 'back') {
    spec.aim.LeftArm = [0.45, -1, -0.35]; spec.aim.LeftForeArm = [0.3, -1, -0.1];
    spec.aim.RightArm = [-0.45, -1, -0.35]; spec.aim.RightForeArm = [-0.3, -1, -0.1];
  }
  return spec;
}

function lieSpec(M, t, { h = 0.55, hands = 'side' } = {}) {
  const b = S(t * TAU / 4.5);
  const spec = {
    hips: { at: [0, h + 0.1, 0], rot: [-90, 0, 0] },
    aim: {
      LeftUpLeg: [0.06, 0, 1], LeftLeg: [0.05, 0.02, 1],
      RightUpLeg: [-0.06, 0, 1], RightLeg: [-0.04, 0.05, 1],
    },
    abs: { LeftFoot: [-80, 5, 0], RightFoot: [-75, -8, 0] },
    rot: { Spine1: [b * 1.5, 0, 0], Spine2: [-b * 1.5, 0, 0], Neck: [12, 0, 0], Head: [8, 10 * S(t * 0.3), 0] },
    hand: { left: { curl: 0.4 }, right: { curl: 0.4 } },
  };
  if (hands === 'head') {
    spec.aim.LeftArm = [0.8, 0.4, -0.5]; spec.aim.LeftForeArm = [-0.8, 0.3, -0.2];
    spec.aim.RightArm = [-0.8, 0.4, -0.5]; spec.aim.RightForeArm = [0.8, 0.3, -0.2];
  } else {
    spec.aim.LeftArm = [0.3, -0.1, 1]; spec.aim.LeftForeArm = [0.15, 0.25, 1];
    spec.aim.RightArm = [-0.3, -0.1, 1]; spec.aim.RightForeArm = [-0.15, 0.25, 1];
  }
  return spec;
}

// Arm raised and waving; used standing and seated via `base`.
function waveArm(spec, t, side = 'Right') {
  const x = side === 'Right' ? -1 : 1;
  const w = S(t * TAU * 1.6);
  spec.aim = { ...spec.aim, [`${side}Arm`]: [x * 0.75, 0.6, 0.25], [`${side}ForeArm`]: [x * (0.1 + 0.35 * w), 1, 0.15] };
  if (spec.ik) delete spec.ik[`${side}Arm`];
  spec.twist = { ...(spec.twist || {}), [`${side}ForeArm`]: x * -70, [`${side}Arm`]: 0 };
  spec.hand = { ...(spec.hand || {}), [side.toLowerCase()]: { curl: 0.05, thumb: 0, spread: 1 } };
  return spec;
}

const STAND_AT_SEAT = 0.34;  // how far in front of the pelvis-on-seat the feet stand
// Lying: the pelvis ends BED_IN behind the edge-sitting pelvis, rotated -90.
export const BED_IN = 0.32;
export { STAND_AT_SEAT };

// Turns a spec authored facing +Z so that it faces `yawDeg` (default +90, the
// character's left, i.e. +X) and moves the pelvis to (px, pz).
function sideways(spec, px, pz, yawDeg = 90) {
  const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = (v) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const hp = spec.hips.at;
  const r = (v) => { const q = rot([v[0] - hp[0], v[1], v[2] - hp[2]]); return [q[0] + px, q[1], q[2] + pz]; };
  const out = { ...spec, hips: { ...spec.hips, at: [px, hp[1], pz], rot: [spec.hips.rot?.[0] || 0, (spec.hips.rot?.[1] || 0) + yawDeg, spec.hips.rot?.[2] || 0] } };
  out.ik = {};
  for (const [k, v] of Object.entries(spec.ik || {})) out.ik[k] = { target: r(v.target), pole: rot(v.pole || [0, 0, 1]) };
  out.aim = {};
  for (const [k, v] of Object.entries(spec.aim || {})) out.aim[k] = rot(v);
  out.abs = {};
  for (const [k, v] of Object.entries(spec.abs || {})) out.abs[k] = [v[0], v[1] + yawDeg, v[2]];
  return out;
}

export const CLIPS = {
  stand: { duration: 8.4, loop: true, fn: (t, u, M) => standSpec(M, t, { look: 8 * S(t * TAU / 8.4) }) },

  sit: {
    duration: 8, loop: true,
    fn: (t, u, M, o = {}) => sitSpec(M, t, { ...o, look: 12 * S(t * TAU / 8) }),
  },

  // Transitions are authored with the root where the feet stand, in front
  // of the seat; the seated loops put the root under the pelvis. The actor
  // switches root at the instant the transition ends, when the two poses
  // coincide exactly, so there is no crossfade to hide a jump.
  sit_down: {
    duration: 1.1, loop: false,
    fn: (t, u, M, o = {}) => {
      const stand = standSpec(M, 0);
      const sit = sideways(sitSpec(M, 0, o), 0, -STAND_AT_SEAT, 0);
      // Bend forward over the knees on the way down, as people do.
      const w = ease.inOut(u);
      const mid = sitSpec(M, 0, { ...o, lean: 28 });
      mid.hips.at = [0, lerp(M.hipH, (o.h ?? 0.46) + 0.1, 0.55), -STAND_AT_SEAT * 0.55];
      mid.ik.LeftLeg.target = [M.legX + 0.04, M.ankle, 0.02];
      mid.ik.RightLeg.target = [-M.legX - 0.04, M.ankle, 0.02];
      return w < 0.5 ? blend(stand, mid, w * 2) : blend(mid, sit, (w - 0.5) * 2);
    },
  },

  stand_up: {
    duration: 1.0, loop: false,
    fn: (t, u, M, o = {}) => CLIPS.sit_down.fn(0, 1 - u, M, o),
  },

  lie: { duration: 9, loop: true, fn: (t, u, M, o = {}) => lieSpec(M, t, o) },

  // Root: the seated-on-edge point, facing out from the bed. Ends lying in
  // the bed frame (see BED_* below), head toward the character's left.
  lie_down: {
    duration: 1.8, loop: false,
    fn: (t, u, M, o = {}) => {
      const h = o.h ?? 0.55;
      const edge = sitSpec(M, 0, { h, hands: 'thighs' });
      const lie = sideways(lieSpec(M, 0, { h }), 0, -BED_IN, -90);
      const mid = sideways(sitSpec(M, 0, { h, hands: 'thighs', lean: -30, feet: [M.thigh * 0.9, h + 0.12] }), 0, -BED_IN * 0.4, -45);
      const w = ease.inOut(u);
      return w < 0.5 ? blend(edge, mid, w * 2) : blend(mid, lie, (w - 0.5) * 2);
    },
  },

  get_up: {
    duration: 1.4, loop: false,
    fn: (t, u, M, o = {}) => CLIPS.lie_down.fn(0, 1 - u, M, o),
  },

  wave: {
    duration: 1.8, loop: true,
    fn: (t, u, M) => waveArm(standSpec(M, t), t),
  },

  sit_wave: {
    duration: 1.8, loop: true,
    fn: (t, u, M, o = {}) => waveArm(sitSpec(M, t, o), t),
  },

  point: {
    duration: 2.4, loop: false,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const w = seg(t, 0, 0.35) * (1 - seg(t, 1.9, 2.4));
      s.aim.RightArm = v3([-0.2, -1, 0.02], [-0.25, 0.12, 1], w);
      s.aim.RightForeArm = v3([-0.1, -1, 0.2], [-0.12, 0.1, 1], w);
      s.twist.RightForeArm = lerp(-10, -80, w);
      s.hand.right = { curl: [0, 0.95, 1, 1].map((c) => lerp(0.3, c, w)), thumb: lerp(0.3, 0.9, w) };
      s.rot.Spine2 = [0, -8 * w, 0];
      s.rot.Head = [0, -10 * w, 0];
      return s;
    },
  },

  cheer: {
    duration: 1.2, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const b = Math.abs(S(t * TAU / 1.2 * 2));
      s.aim.LeftArm = [0.55, 1, 0.15]; s.aim.LeftForeArm = [0.2, 1, 0.1 + 0.2 * b];
      s.aim.RightArm = [-0.55, 1, 0.15]; s.aim.RightForeArm = [-0.2, 1, 0.1 + 0.2 * b];
      s.hand = { left: { curl: 1, thumb: 0.9 }, right: { curl: 1, thumb: 0.9 } };
      s.hips.at[1] += 0.02 * b;
      s.rot.Head = [-10, 0, 0];
      return s;
    },
  },

  clap: {
    duration: 0.9, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const c = 0.5 + 0.5 * C(t * TAU / 0.45);
      const y = M.chestH - 0.05, z = 0.3;
      const gap = 0.02 + 0.13 * c;
      s.ik.LeftArm = { target: [gap, y, z], pole: [1, -0.6, -0.4] };
      s.ik.RightArm = { target: [-gap, y, z], pole: [-1, -0.6, -0.4] };
      s.abs.LeftHand = [0, 0, 90]; s.abs.RightHand = [0, 0, -90];
      s.hand = { left: { curl: 0.1, thumb: 0.1 }, right: { curl: 0.1, thumb: 0.1 } };
      return s;
    },
  },

  phone: {
    duration: 6, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t, { look: 10 * S(t * 0.9) });
      s.ik.RightArm = { target: [-0.1, M.headH + 0.02, 0.03], pole: [-0.6, -1, -0.2] };
      s.hand.right = { curl: 0.55, thumb: 0.5 };
      s.aim.LeftArm = [0.35, -1, 0.35]; s.aim.LeftForeArm = [-0.4, 0.2, 1];
      s.rot.Head[2] = -6;
      return s;
    },
  },

  arms_crossed: {
    duration: 7, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t, { look: 14 * S(t * TAU / 7) });
      const y = M.chestH - 0.08;
      s.ik.LeftArm = { target: [-0.12, y + 0.01, 0.17], pole: [0.4, -1, -0.3] };
      s.ik.RightArm = { target: [0.13, y - 0.03, 0.19], pole: [-0.4, -1, -0.3] };
      s.hand = { left: { curl: 0.2 }, right: { curl: 0.5 } };
      return s;
    },
  },

  hands_hips: {
    duration: 6, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t, { look: 12 * S(t * TAU / 6) });
      s.ik.LeftArm = { target: [M.legX + 0.1, M.hipH + 0.07, 0.0], pole: [1, 0, -1] };
      s.ik.RightArm = { target: [-M.legX - 0.1, M.hipH + 0.07, 0.0], pole: [-1, 0, -1] };
      s.hand = { left: { curl: 0.15 }, right: { curl: 0.15 } };
      return s;
    },
  },

  think: {
    duration: 5, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      s.ik.RightArm = { target: [-0.02, M.headH - 0.08, 0.13], pole: [-0.5, -1, 0] };
      s.hand.right = { curl: [0.2, 0.7, 0.8, 0.9], thumb: 0.2 };
      s.ik.LeftArm = { target: [-0.06, M.chestH - 0.14, 0.17], pole: [0.5, -1, -0.3] };
      s.rot.Head = [6 + 3 * S(t * 1.3), -8, 5];
      return s;
    },
  },

  shrug: {
    duration: 1.4, loop: false,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const w = seg(t, 0, 0.35) * (1 - seg(t, 1.0, 1.4));
      s.aim.LeftForeArm = v3([0.1, -1, 0.2], [0.8, 0.1, 0.6], w);
      s.aim.RightForeArm = v3([-0.1, -1, 0.2], [-0.8, 0.1, 0.6], w);
      s.aim.LeftArm = v3([0.2, -1, 0.02], [0.25, -1, -0.05], w);
      s.aim.RightArm = v3([-0.2, -1, 0.02], [-0.25, -1, -0.05], w);
      s.twist.LeftForeArm = lerp(10, 80, w); s.twist.RightForeArm = lerp(-10, -80, w);
      s.rot.LeftShoulder = [0, 0, -14 * w]; s.rot.RightShoulder = [0, 0, 14 * w];
      s.rot.Head = [4 * w, 0, 10 * w];
      s.hand = { left: { curl: 0.1 }, right: { curl: 0.1 } };
      return s;
    },
  },

  facepalm: {
    duration: 2.2, loop: false,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const w = seg(t, 0, 0.4) * (1 - seg(t, 1.8, 2.2));
      const idle = standSpec(M, t);
      s.ik.RightArm = { target: [-0.02, M.headH + 0.03, 0.12], pole: [-0.4, -1, 0] };
      s.hand.right = { curl: 0.15, thumb: 0.2 };
      s.rot.Head = [22, 0, 0]; s.rot.Neck = [10, 0, 0];
      return blend(idle, s, w);
    },
  },

  bow: {
    duration: 2, loop: false,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const w = seg(t, 0.1, 0.6) * (1 - seg(t, 1.3, 1.9));
      s.hips.rot = [38 * w, 0, 0];
      s.hips.at[2] = -0.08 * w;
      s.rot.Neck = [10 * w, 0, 0];
      s.aim.LeftArm = [0.12, -1, 0.35 * w]; s.aim.RightArm = [-0.12, -1, 0.35 * w];
      return s;
    },
  },

  talk: {
    duration: 6, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t, { look: 6 * S(t * 1.1) });
      // Beat gestures: forearms come up and open on stresses, then settle.
      const beat = (ph) => Math.max(0, S(t * TAU / 1.5 + ph)) ** 2;
      const l = beat(0), r = beat(1.9);
      s.aim.LeftForeArm = v3([0.1, -1, 0.2], [0.45, -0.1, 1], 0.35 + 0.5 * l);
      s.aim.RightForeArm = v3([-0.1, -1, 0.2], [-0.45, -0.1, 1], 0.35 + 0.5 * r);
      s.twist.LeftForeArm = 10 + 50 * l; s.twist.RightForeArm = -10 - 50 * r;
      s.hand = { left: { curl: 0.2 - 0.15 * l, spread: l }, right: { curl: 0.2 - 0.15 * r, spread: r } };
      s.rot.Head = [3 * S(t * TAU / 0.75), 6 * S(t * 0.8), 3 * S(t * 0.6)];
      return s;
    },
  },

  sit_talk: {
    duration: 6, loop: true,
    fn: (t, u, M, o = {}) => {
      const s = sitSpec(M, t, { ...o, look: 6 * S(t * 1.1) });
      const beat = (ph) => Math.max(0, S(t * TAU / 1.5 + ph)) ** 2;
      const r = beat(1.9);
      delete s.ik.RightArm;
      s.aim.RightArm = [-0.25, -1, 0.3];
      s.aim.RightForeArm = v3([-0.1, -0.4, 1], [-0.5, 0.1, 1], r);
      s.twist.RightForeArm = -20 - 40 * r;
      s.hand.right = { curl: 0.2 - 0.15 * r, spread: r };
      s.rot.Head = [3 * S(t * TAU / 0.75), 6 * S(t * 0.8), 3 * S(t * 0.6)];
      return s;
    },
  },

  drive: {
    duration: 6, loop: true,
    fn: (t, u, M, o = {}) => {
      const h = o.h ?? 0.32;
      const s = sitSpec(M, t, { h, lean: -14, feet: [M.thigh + M.shin * 0.8, 0.1] });
      const steer = o.steer ?? 0;
      const sh = h + 0.1 + (M.shoulderH - M.hipH);
      const wy = sh - 0.22, wz = 0.44, r = 0.17;
      const a = steer * 0.9;
      s.ik.LeftArm = { target: [r * C(a), wy + r * S(a), wz], pole: [1, -1, -0.4] };
      s.ik.RightArm = { target: [-r * C(a), wy - r * S(a), wz], pole: [-1, -1, -0.4] };
      s.hand = { left: { curl: 0.8, thumb: 0.6 }, right: { curl: 0.8, thumb: 0.6 } };
      s.rot.Head = [-6, 6 * S(t * 0.7), 0];
      return s;
    },
  },

  type: {
    duration: 4, loop: true,
    fn: (t, u, M, o = {}) => {
      const s = sitSpec(M, t, { ...o, hands: 'table', lean: 4 });
      const ty = (o.h ?? 0.46) + (o.desk ?? 0.29);
      const jig = (ph) => 0.012 * Math.max(0, S(t * 17 + ph));
      s.ik.LeftArm = { target: [0.13, ty + 0.035 + jig(0), 0.38], pole: [1, -0.6, -0.4] };
      s.ik.RightArm = { target: [-0.13, ty + 0.035 + jig(2), 0.38], pole: [-1, -0.6, -0.4] };
      s.abs.LeftHand = [20, 0, 0]; s.abs.RightHand = [20, 0, 0];
      s.hand = { left: { curl: 0.35 + 0.2 * S(t * 13) }, right: { curl: 0.35 + 0.2 * S(t * 11 + 1) } };
      s.rot.Head = [14, 0, 0];
      return s;
    },
  },

  sit_ground: {
    duration: 8, loop: true,
    fn: (t, u, M) => {
      const b = breathe(t);
      return {
        hips: { at: [0, 0.12, 0], rot: [-22, 0, 0] },
        ik: {
          LeftLeg: { target: [M.legX + 0.1, M.ankle - 0.02, M.thigh * 0.85], pole: [0.3, 1, 0.2] },
          RightLeg: { target: [-M.legX - 0.1, M.ankle - 0.02, M.thigh * 0.85], pole: [-0.3, 1, 0.2] },
        },
        abs: { LeftFoot: [0, 8, 0], RightFoot: [0, -8, 0] },
        aim: { LeftArm: [0.35, -1, -0.45], LeftForeArm: [0.15, -1, -0.3], RightArm: [-0.35, -1, -0.45], RightForeArm: [-0.15, -1, -0.3] },
        twist: { LeftArm: -30, RightArm: 30 },
        rot: { Spine: [12, 0, 0], Spine1: [4 + b.Spine1[0], 0, 0], Spine2: b.Spine2, Neck: [4, 14 * S(t * 0.5), 0], Head: [-4, 10 * S(t * 0.5), 0] },
        hand: { left: { curl: 0.2 }, right: { curl: 0.2 } },
      };
    },
  },

  sunbathe: { duration: 10, loop: true, fn: (t, u, M) => lieSpec(M, t, { h: -0.08, hands: 'head' }) },

  crouch: {
    duration: 4, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      s.hips.at = [0, M.hipH * 0.5, -0.06];
      s.hips.rot = [30, 0, 0];
      s.rot.Spine = [8, 0, 0]; s.rot.Neck = [-20, 0, 0]; s.rot.Head = [-12, 8 * S(t), 0];
      s.ik.LeftLeg.target = [M.legX + 0.05, M.ankle, 0.14];
      s.ik.RightLeg.target = [-M.legX - 0.05, M.ankle, -0.1];
      s.aim.LeftArm = [0.2, -0.6, 1]; s.aim.RightArm = [-0.2, -0.6, 1];
      s.aim.LeftForeArm = [0.05, -0.8, 1]; s.aim.RightForeArm = [-0.05, -0.8, 1];
      return s;
    },
  },

  pickup: {
    duration: 1.3, loop: false,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const w = seg(t, 0, 0.55) * (1 - seg(t, 0.75, 1.3));
      s.hips.at = [0, lerp(M.hipH, M.hipH * 0.62, w), lerp(0, -0.12, w)];
      s.hips.rot = [lerp(0, 45, w), 0, 0];
      s.rot.Neck = [-18 * w, 0, 0];
      s.ik.RightArm = { target: [-0.08, lerp(M.hipH - 0.25, 0.12, w), lerp(0.08, 0.42, w)], pole: [-1, 0, -0.5] };
      s.ik.LeftLeg.target[2] = 0.12;
      return s;
    },
  },

  use: {
    duration: 1.0, loop: false,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const w = seg(t, 0, 0.35) * (1 - seg(t, 0.6, 1.0));
      s.ik.RightArm = { target: [-0.12, lerp(M.hipH - 0.2, M.chestH - 0.05, w), lerp(0.1, 0.5, w)], pole: [-1, -0.5, -0.5] };
      s.hand.right = { curl: [0.1, 0.8, 0.9, 0.9].map((c) => lerp(0.3, c, w)), thumb: 0.5 };
      return s;
    },
  },

  carry: {
    duration: 4, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const y = M.hipH + 0.18;
      s.ik.LeftArm = { target: [0.14, y, 0.32], pole: [1, -1, -0.2] };
      s.ik.RightArm = { target: [-0.14, y, 0.32], pole: [-1, -1, -0.2] };
      s.abs.LeftHand = [0, 0, 90]; s.abs.RightHand = [0, 0, -90];
      return s;
    },
  },

  jump: {
    duration: 0.9, loop: false,
    fn: (t, u, M) => {
      // Crouch, extend, tuck. The vertical travel is the controller's job;
      // this is only the body shape.
      const s = standSpec(M, t);
      const crouch = seg(t, 0, 0.12) * (1 - seg(t, 0.12, 0.22));
      const tuck = seg(t, 0.25, 0.5);
      s.hips.at = [0, M.hipH - 0.18 * crouch - 0.05 * tuck, 0];
      s.hips.rot = [14 * crouch, 0, 0];
      const ky = M.ankle + 0.22 * tuck;
      s.ik.LeftLeg.target = [M.legX + 0.02, ky, 0.1 * tuck];
      s.ik.RightLeg.target = [-M.legX - 0.02, ky + 0.08 * tuck, -0.05 * tuck];
      s.aim.LeftArm = v3([0.2, -1, 0.02], [0.6, 0.2, 0.3], tuck);
      s.aim.RightArm = v3([-0.2, -1, 0.02], [-0.6, 0.2, 0.3], tuck);
      return s;
    },
  },

  fall: {
    duration: 1.2, loop: true,
    fn: (t, u, M) => {
      const s = standSpec(M, t);
      const f = S(t * TAU / 1.2);
      s.ik.LeftLeg.target = [M.legX + 0.05, M.ankle + 0.18, 0.12 + 0.05 * f];
      s.ik.RightLeg.target = [-M.legX - 0.05, M.ankle + 0.1, -0.05 - 0.05 * f];
      s.aim.LeftArm = [0.9, 0.35 + 0.1 * f, 0.1]; s.aim.RightArm = [-0.9, 0.35 - 0.1 * f, 0.1];
      s.aim.LeftForeArm = [0.6, 0.6, 0.3]; s.aim.RightForeArm = [-0.6, 0.6, 0.3];
      s.hand = { left: { curl: 0.1, spread: 1 }, right: { curl: 0.1, spread: 1 } };
      return s;
    },
  },

  dance: {
    duration: 2, loop: true,
    fn: (t, u, M) => {
      // A two-step with shoulder rolls, on a 120bpm pulse.
      const s = standSpec(M, t);
      const ph = t * TAU / 1.0;
      const bounce = Math.abs(S(ph));
      const side = S(ph / 2);
      s.hips.at = [0.08 * side, M.hipH - 0.06 * bounce, 0];
      s.hips.rot = [4, 10 * side, 6 * side];
      s.ik.LeftLeg.target = [M.legX + 0.1 + 0.06 * Math.max(0, side), M.ankle + 0.06 * Math.max(0, -S(ph)), 0.05];
      s.ik.RightLeg.target = [-M.legX - 0.1 + 0.06 * Math.min(0, side), M.ankle + 0.06 * Math.max(0, S(ph)), 0.05];
      s.aim.LeftArm = [0.6, -0.5 + 0.3 * S(ph), 0.35]; s.aim.RightArm = [-0.6, -0.5 - 0.3 * S(ph), 0.35];
      s.aim.LeftForeArm = [-0.1, 0.7, 0.7]; s.aim.RightForeArm = [0.1, 0.7, 0.7];
      s.hand = { left: { curl: 0.7 }, right: { curl: 0.7 } };
      s.rot.Spine2 = [0, -12 * side, -4 * side];
      s.rot.Head = [-4 + 6 * bounce, 8 * side, 0];
      return s;
    },
  },

  piano: {
    duration: 4, loop: true,
    fn: (t, u, M, o = {}) => {
      const s = sitSpec(M, t, { h: o.h ?? 0.5, lean: 6 });
      const ky = (o.h ?? 0.5) + 0.24;
      const lx = 0.18 + 0.1 * S(t * 1.7), rx = -0.18 + 0.1 * S(t * 2.3 + 1);
      s.ik.LeftArm = { target: [lx, ky + 0.02 * Math.max(0, S(t * 9)), 0.4], pole: [1, -0.6, -0.4] };
      s.ik.RightArm = { target: [rx, ky + 0.02 * Math.max(0, S(t * 11)), 0.4], pole: [-1, -0.6, -0.4] };
      s.abs.LeftHand = [15, 0, 0]; s.abs.RightHand = [15, 0, 0];
      s.hand = { left: { curl: 0.45 + 0.25 * S(t * 12) }, right: { curl: 0.45 + 0.25 * S(t * 14 + 2) } };
      s.rot.Head = [12, 6 * S(t * 0.8), 4 * S(t * 1.3)];
      s.rot.Spine2 = [0, 5 * S(t * 0.9), 0];
      return s;
    },
  },

  drink: {
    duration: 5, loop: true,
    fn: (t, u, M, o = {}) => {
      const s = o.seated ? sitSpec(M, t, o) : standSpec(M, t);
      const w = seg(t, 2.6, 3.1) * (1 - seg(t, 3.9, 4.4));
      delete s.ik?.RightArm;
      s.ik = s.ik || {};
      const rest = [-0.16, (o.seated ? (o.h ?? 0.46) + 0.25 : M.hipH + 0.05), 0.25];
      const mouth = [-0.03, M.headH - 0.06 - (o.seated ? M.hipH - (o.h ?? 0.46) - 0.1 : 0), 0.12];
      s.ik.RightArm = { target: v3(rest, mouth, w), pole: [-1, -1, -0.2] };
      s.hand.right = { curl: 0.6, thumb: 0.5 };
      s.rot.Head = [-14 * w, 0, 0];
      return s;
    },
  },
};

// Clips that come from motion capture files rather than code, by source.
export const MOCAP = {
  idle: ['HVGirl', 'Idle'],
  walk: ['Xbot', 'walk'],
  run: ['Xbot', 'run'],
  walk_f: ['HVGirl', 'Walking'],
  samba: ['Michelle', 'SambaDance'],
  agree: ['Xbot', 'agree'],
  headshake: ['Xbot', 'headShake'],
};
