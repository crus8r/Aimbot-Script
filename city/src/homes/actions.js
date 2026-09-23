// What you can do with things, and with each other. Every action is a menu
// label plus a Task (steps from sims.js). Actions that satisfy a need carry
// an advertisement (`ad`): how much of which need they give. Autonomy is
// nothing more than a sim reading the adverts and weighing them against how
// badly it needs each thing, a little less for things far away.
import * as THREE from 'three';
import { Task, go, sit, lie, stand, anim, wait, say, face, call, forceFree } from './sims.js';
import { giveDrink } from '../game/hooks.js';
import { replyTo, WAVE_BACK, pick } from '../game/lines.js';
import { randomLook } from '../core/cast.js';
import { rng } from '../world/textures.js';

const COMFY = ['sofa', 'chair', 'bench'];

export const HOME_CHATTER = [
  ['Did you finish the leftovers?', 'Maybe. Define finish.'],
  ['We should repaint the kitchen.', 'Again? We just did it.'],
  ['Who left the TV on?', 'The TV left itself on.'],
  ['I had the weirdest dream last night.', 'Was I in it? I feel like I was in it.'],
  ['Want to have people over this weekend?', 'Only if you are cooking.'],
  ['I think the plant is judging me.', 'It judges everyone. Water it.'],
  ['Have you seen my phone?', 'You are holding it.'],
  ['We need more furniture.', 'We need more money.'],
  ['What should we have for dinner?', 'Something that is not cereal.'],
  ['The neighbours waved at me today.', 'Which ones? The nice ones or the loud ones?'],
  ['I am going to learn the piano.', 'You said that last year.'],
  ['This house is starting to feel like home.', 'It is the rug. The rug ties the room together.'],
];
const FOLLOW_UPS = [
  ['Anyway, how was your day?', 'Long. Good, but long.'],
  ['We should do something fun later.', 'Pool? Pool. Definitely pool.'],
  ['I am glad we moved here.', 'Me too. Mostly for the kitchen.'],
  ['Remind me to call my mom.', 'I will not, but I will think about it.'],
];
const JOKES = [
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'I would tell you a construction joke, but I am still working on it.',
  'I told my wife she draws her eyebrows too high. She looked surprised.',
  'Why do not skeletons fight each other? They do not have the guts.',
  'I only know twenty-five letters of the alphabet. I do not know y.',
];
const MAIL = ['Bills. Always bills.', 'A postcard from Aunt Rosa!', 'Pizza coupons. Keeping these.', 'Nothing. Not even junk mail.'];
const SHOWER = ['La la laaa!', 'Doo doo doo...', 'Mmm, hot water.'];

// Where to stand to use a hook: `d` metres in front of it, on its floor.
function frontOf(h, d) {
  return new THREE.Vector3(h.pos.x + Math.sin(h.yaw) * d, h.item.y, h.pos.z + Math.cos(h.yaw) * d);
}
const facing = (h) => h.yaw + Math.PI;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function freeSeats(item, sim) {
  return item.seats.filter((s) => !s.removed && (!s.occupant || s.occupant === sim.actor))
    .sort((a, b) => dist(a.pos, sim.pos) - dist(b.pos, sim.pos));
}

// Walk to a seat, claim it, sit. Claimed before walking, so two sims don't
// race for one chair.
function seatSteps(seat) {
  return [
    call((sim, task) => {
      if (seat.removed || (seat.occupant && seat.occupant !== sim.actor)) { task.why = 'Someone is sitting there'; return false; }
      seat.occupant = sim.actor;
      task.claimed = seat;
      return true;
    }),
    go(seat.standPoint, { near: 0.6 }),
    sit(seat),
  ];
}

// A seat in sight of a point (for TV): faces it, within range, free.
function seatFacing(game, sim, target, range = 7) {
  let best = null, bd = Infinity;
  for (const s of game.home.items.seats()) {
    if (s.removed || !COMFY.includes(s.kind) || (s.occupant && s.occupant !== sim.actor)) continue;
    const dx = target.x - s.pos.x, dz = target.z - s.pos.z, d = Math.hypot(dx, dz);
    if (d > range || d < 1) continue;
    const dot = (Math.sin(s.heading) * dx + Math.cos(s.heading) * dz) / d;
    if (dot < 0.75) continue;
    const score = d + dist(s.pos, sim.pos) * 0.3;
    if (score < bd) { bd = score; best = s; }
  }
  return best;
}

function comfySeatNear(game, sim, p, range = 8) {
  let best = null, bd = Infinity;
  for (const s of game.home.items.seats()) {
    if (s.removed || !COMFY.includes(s.kind) || (s.occupant && s.occupant !== sim.actor)) continue;
    const d = dist(s.pos, p);
    if (d < range && d < bd) { bd = d; best = s; }
  }
  return best;
}

const T = (label, steps, extra = {}) => new Task({ label, steps, ...extra });

// ---------------------------------------------------------------- items

export function itemActions(game, sim, item) {
  const out = [];
  const add = (label, make, o = {}) => out.push({ label, make, pos: item.group.position, item, ...o });
  const byKind = {};
  for (const s of freeSeats(item, sim)) (byKind[s.kind] = byKind[s.kind] || []).push(s);
  const seated = sim.actor.seat && item.seats.includes(sim.actor.seat);
  if (seated) add(sim.actor.state === 'lying' ? 'Get up' : 'Stand up', () => T('Standing up', [stand()], { item }));

  // Seats.
  const seat = (k) => byKind[k]?.[0];
  if (seat('bed')) {
    const s = seat('bed');
    if (sim.actor.seat !== s) {
      add('Sleep', () => T('Sleeping', [...seatSteps(s), lie(), wait({ until: 'energy', gains: { energy: 0.9 } }), stand()], { item }), { ad: { energy: 85 }, when: () => sim.needs.energy < 45 });
      add('Nap', () => T('Napping', [...seatSteps(s), lie(), wait({ time: 20, gains: { energy: 0.9 } }), stand()], { item }));
      add('Sit on bed', () => T('Sitting', seatSteps(s), { item }));
    } else if (sim.actor.state === 'seated') add('Lie down', () => T('Lying down', [lie(), wait({ time: 30, gains: { energy: 0.6 } })], { item }));
  }
  if (seat('lounger')) {
    const s = seat('lounger');
    add('Sunbathe', () => T('Sunbathing', [...seatSteps(s), lie(), wait({ time: 30, gains: { fun: 0.6, energy: 0.3 } }), stand()], { item }), { ad: { fun: 25 } });
  }
  if (seat('piano')) {
    const s = seat('piano');
    add('Play piano', () => T('Playing piano', [...seatSteps(s),
      call(() => { item.piano = item.piano || game.audio?.piano(s.pos); item.piano?.start(); }),
      wait({ until: 'fun', time: 45, gains: { fun: 1.5 } }),
      call(() => item.piano?.stop(), { always: true }), stand()], { item }), { ad: { fun: 55 } });
  }
  if (seat('desk')) {
    const s = seat('desk');
    add('Use the computer', () => T('On the computer', [...seatSteps(s), wait({ until: 'fun', time: 45, gains: { fun: 1.3 } })], { item }), { ad: { fun: 45 } });
  }
  if (seat('toilet')) {
    const s = seat('toilet');
    add('Use the toilet', () => T('Using the toilet', [...seatSteps(s), wait({ time: 5, gains: { bladder: 25 } }), call((sm) => { sm.needs.bladder = 100; game.audio?.fizz(); }), stand()], { item }), { ad: { bladder: 100 }, when: () => sim.needs.bladder < 60 });
  }
  for (const k of ['chair', 'sofa', 'bench', 'stool']) {
    if (!seat(k) || seated) continue;
    add('Sit', () => T('Sitting', seatSteps(seat(k)), { item }));
    break;
  }

  // Working parts.
  for (const h of item.hooks) {
    if (h.kind === 'tv') {
      const tv = item.tv;
      add('Watch TV', () => {
        const s = seatFacing(game, sim, h.pos);
        const on = call(() => { tv.on = true; });
        const watch = wait({ until: 'fun', time: 60, gains: { fun: 1.2 } });
        return T('Watching TV', s ? [...seatSteps(s), on, watch] : [go(frontOf(h, 2.2), { lookAt: h.pos }), on, anim('arms_crossed', { time: 0.5 }), watch, call((sm) => sm.actor.cancel(), { always: true })], { item });
      }, { ad: { fun: 60 } });
      add(tv.on ? 'Turn TV off' : 'Turn TV on', () => T('TV', [go(frontOf(h, 0.9), { exact: true, face: facing(h) }), anim('use', { mask: 'armR', time: 0.9 }), call(() => { tv.on = !tv.on; game.audio?.blip(tv.on ? 660 : 330); })], { item }));
      if (tv.on) add('Change channel', () => T('TV', [go(frontOf(h, 1.6), { lookAt: h.pos }), anim('point', { time: 1.2 }), call(() => { tv.channel = (tv.channel + 1) % 3; game.audio?.blip(520); })], { item }));
    }
    if (h.kind === 'lamp' && item.lamp) {
      const L = item.lamp;
      add(L.on ? 'Turn light off' : 'Turn light on', () => T('Light switch', [go(frontOf(h, 0.7), { near: 0.9, lookAt: h.pos }), anim('use', { mask: 'armR', time: 0.8 }), call(() => { L.on = !L.on; game.lights._t = 0; game.audio?.blip(L.on ? 1200 : 900, 0.04, 0.1); })], { item }));
    }
    if (h.kind === 'jukebox') {
      const m = item.music;
      add(m?.wantOn ? 'Stop the music' : 'Play music', () => T('Music', [go(frontOf(h, 0.8), { near: 1.0, lookAt: h.pos }), anim('use', { mask: 'armR', time: 0.9 }), call(() => { game.audio?.unlock(); m?.toggle(); })], { item }));
      add('Dance', () => T('Dancing', [go(frontOf(h, 1.8), { near: 1.2 }), call(() => { game.audio?.unlock(); if (m && !m.wantOn) m.start(); }), anim('dance', { time: 14, gains: { fun: 2.0 } })], { item }), { ad: { fun: 50 } });
    }
    if (h.kind === 'fridge') {
      add('Have a snack', () => T('Snacking', [go(frontOf(h, 0.75), { exact: true, face: facing(h) }), anim('use', { mask: 'armR', time: 1.2 }), anim('drink', { mask: 'armR', time: 1.8 }), call((sm) => sm.gain({ hunger: 28 }))], { item }), { ad: { hunger: 30 }, when: () => sim.needs.hunger < 75 });
      if (!sim.actor.held) add('Grab a drink', () => T('Getting a drink', [go(frontOf(h, 0.75), { exact: true, face: facing(h) }), anim('use', { mask: 'armR', time: 1 }), call((sm) => { giveDrink(game, sm.actor); game.audio?.fizz(); sm.gain({ hunger: 6 }); })], { item }));
    }
    if (h.kind === 'drink') {
      if (!sim.actor.held) add('Get some water', () => T('Getting water', [go(frontOf(h, 0.7), { exact: true, face: facing(h) }), anim('use', { mask: 'armR', time: 1 }), call((sm) => { giveDrink(game, sm.actor, 'cup'); sm.gain({ hunger: 4 }); })], { item }));
    }
    if (h.kind === 'stove') {
      add('Cook a meal', () => T('Cooking', [go(frontOf(h, 0.5), { exact: true, face: facing(h) }), anim('use', { mask: 'arms', loop: true, time: 7 }), say(() => pick(['Dinner is ready!', 'Smells good, if I say so myself.', 'Who wants pasta?'])), call((sm) => sm.gain({ hunger: 60 }))], { item }), { ad: { hunger: 65 }, when: () => sim.needs.hunger < 55 });
    }
    if (h.kind === 'sink') {
      add('Wash hands', () => T('Washing up', [go(frontOf(h, 0.4), { exact: true, face: facing(h) }), anim('use', { mask: 'arms', time: 2.5 }), call((sm) => sm.gain({ hygiene: 10 }))], { item }), { ad: { hygiene: 10 } });
    }
    if (h.kind === 'shower') {
      add('Take a shower', () => T('Showering', [go(new THREE.Vector3(h.pos.x, item.y, h.pos.z), { exact: true, face: item.rot }), say(() => pick(SHOWER), { wait: false }), anim('use', { mask: 'arms', loop: true, time: 8, gains: { hygiene: 9 } }), call((sm) => sm.gain({ hygiene: 40 })), go(frontOf({ ...h, pos: new THREE.Vector3(h.pos.x, item.y, h.pos.z) }, 0.9), { near: 0.3 })], { item }), { ad: { hygiene: 75 }, when: () => sim.needs.hygiene < 55 });
    }
    if (h.kind === 'wardrobe') {
      add('Change outfit', () => T('Changing', [go(frontOf(h, 0.8), { exact: true, face: facing(h) }), anim('use', { mask: 'armR', time: 1.2 }), call((sm) => { sm.restyle(randomLook(sm.model, rng(Math.floor(Math.random() * 1e9)))); game.onRestyle?.(sm); })], { item }));
    }
    if (h.kind === 'grill') {
      add('Grill burgers', () => T('Grilling', [go(frontOf(h, 0.6), { exact: true, face: facing(h) }), anim('use', { mask: 'arms', loop: true, time: 8 }), say(() => pick(['Burgers are up!', 'Who wants cheese on theirs?'])), call((sm) => sm.gain({ hunger: 55, fun: 10 }))], { item }), { ad: { hunger: 55, fun: 10 }, when: () => sim.needs.hunger < 60 });
    }
    if (h.kind === 'mail') {
      add('Check the mail', () => T('Checking mail', [go(frontOf(h, 0.5), { exact: true, face: facing(h) }), anim('use', { mask: 'armR', time: 1.2 }), say(() => pick(MAIL))], { item }));
    }
  }

  // Things known by what they are rather than a hook.
  const use = item.entry.use || item.prep.def.use;
  const c = item.group.position;
  const fwd = new THREE.Vector3(Math.sin(item.rot), 0, Math.cos(item.rot));
  const before = (d) => new THREE.Vector3(c.x + fwd.x * d, item.y, c.z + fwd.z * d);
  if (use === 'bath') add('Take a bath', () => T('Bathing', [go(before(0.7), { lookAt: c }), anim('use', { mask: 'arms', loop: true, time: 8, gains: { hygiene: 7 } }), call((sm) => sm.gain({ hygiene: 30 }))], { item }), { ad: { hygiene: 60 }, when: () => sim.needs.hygiene < 55 });
  if (use === 'books') add('Read a book', () => {
    const s = comfySeatNear(game, sim, c);
    return T('Reading', [go(before(0.7), { lookAt: c }), anim('use', { mask: 'armR', time: 1 }), ...(s ? seatSteps(s) : []), anim('think', { loop: true, time: 25, gains: { fun: 0.9 } })], { item });
  }, { ad: { fun: 35 } });
  if (use === 'pool') add('Play pool', () => T('Playing pool', [go(before(1.2), { lookAt: c }), anim('point', { time: 1.5 }), anim('use', { mask: 'arms', loop: true, time: 16, gains: { fun: 1.4 } }), anim('cheer', { time: 2 })], { item }), { ad: { fun: 40 } });
  if (use === 'water') add('Water the flowers', () => T('Gardening', [go(before(0.8), { lookAt: c }), anim('use', { mask: 'arms', time: 3 }), call((sm) => sm.gain({ fun: 6 }))], { item }), { ad: { fun: 8 } });
  if (use === 'computer') {
    const chair = game.home.items.seats().find((s) => s.kind === 'desk' && !s.removed && dist(s.pos, c) < 1.4 && (!s.occupant || s.occupant === sim.actor));
    if (chair) add('Use the computer', () => T('On the computer', [...seatSteps(chair), wait({ until: 'fun', time: 45, gains: { fun: 1.3 } })], { item: chair.item }), { ad: { fun: 45 } });
  }
  if (item.wall && item.entry.cat === 'decor') {
    add('Admire', () => T('Admiring', [go(before(1.6), { lookAt: c }), anim('think', { time: 3 }), call((sm) => sm.gain({ fun: 4 }))], { item }));
  }
  // `when` gates free will only: you can always tell a sim to do anything.
  return out;
}

// ---------------------------------------------------------------- people

export function simActions(game, sim, other, { voiced = true } = {}) {
  const out = [];
  const add = (label, make, o = {}) => out.push({ label, make, pos: other.pos, other, ...o });
  const near = () => {
    const p = other.pos, q = sim.pos;
    const d = Math.max(0.01, dist(p, q));
    return new THREE.Vector3(p.x + (q.x - p.x) / d * 1.05, p.y, p.z + (q.z - p.z) / d * 1.05);
  };
  const busy = (o) => o.task && !['Chatting', 'Listening'].includes(o.task.label);
  const engage = (label, time) => call((sm, task) => {
    other.actor.lookAt(sm.actor); sm.actor.lookAt(other.actor);
    if (!busy(other) && other.actor.state === 'free') {
      other.queue = [];
      other.task?.cancel();
      other.push(T(label, [face(() => sm.pos), wait({ time, gains: { social: 1.2 } })], { other: sim }));
    }
  });
  const release = call((sm) => {
    other.actor.lookAt(null); sm.actor.lookAt(null);
    if (other.task?.label === 'Chatting' || other.task?.label === 'Listening') other.task.cancel();
  }, { always: true });
  const approachSteps = () => [go(near, { near: 1.25, lookAt: () => other.pos })];

  add('Chat', () => {
    const [a1, b1] = pick(HOME_CHATTER), [a2, b2] = pick(FOLLOW_UPS);
    return T(`Chatting with ${other.name}`, [...approachSteps(), engage('Chatting', 14),
      say(a1), say(b1, { who: other }), say(a2), say(b2, { who: other }),
      call((sm) => { sm.gain({ social: 30, fun: 5 }); other.gain({ social: 30, fun: 5 }); }), release], { other, voiced });
  }, { ad: { social: 45 } });
  add('Tell a joke', () => T('Telling a joke', [...approachSteps(), engage('Listening', 8), say(pick(JOKES)),
    call(() => { other.actor.emote(Math.random() < 0.5 ? 'clap' : 'cheer'); }),
    say(() => pick(['Ha! Good one.', 'Oh no. Oh no, that is terrible.', 'Ha ha ha!']), { who: other }),
    call((sm) => { sm.gain({ social: 15, fun: 12 }); other.gain({ social: 15, fun: 15 }); }), release], { other, voiced }), { ad: { social: 25, fun: 15 } });
  add('Wave', () => T('Waving', [face(() => other.pos), anim('wave'),
    call(() => { if (other.actor.state === 'free' || other.actor.state === 'seated') other.actor.emote('wave'); other.actor.lookAt(sim.actor); }),
    say(() => pick(WAVE_BACK), { who: other }), call((sm) => { sm.gain({ social: 5 }); other.gain({ social: 5 }); other.actor.lookAt(null); })], { other, voiced }));
  add('Dance together', () => T('Dancing', [...approachSteps(),
    call(() => { if (!busy(other) && other.actor.state === 'free') { other.queue = []; other.task?.cancel(); other.push(T('Dancing', [face(() => sim.pos), anim('dance', { time: 12, gains: { fun: 2, social: 1 } })], { other: sim })); } }),
    anim('samba', { time: 12, gains: { fun: 2, social: 1.2 } })], { other, voiced }), { ad: { fun: 35, social: 30 } });
  add('Say something…', null, { chat: true });
  return out;
}

export function selfActions(game, sim) {
  const a = sim.actor;
  const out = [];
  const add = (label, make, o = {}) => out.push({ label, make, pos: sim.pos, ...o });
  if (a.state === 'seated' || a.state === 'lying') add(a.state === 'lying' ? 'Get up' : 'Stand up', () => T('Standing up', [stand()]));
  else {
    add('Dance', () => T('Dancing', [anim('dance', { time: 12, gains: { fun: 1.6 } })]));
    add('Wave', () => T('Waving', [anim('wave')]));
    add('Think', () => T('Thinking', [anim('think', { loop: true, time: 5 })]));
    add('Talk on the phone', () => T('On the phone', [anim('phone', { time: 12, gains: { social: 1.2 } })]));
  }
  if (a.held) add('Take a sip', () => T('Drinking', [anim('drink', { mask: ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'Head', 'Neck'], time: 2.4 }), call((sm) => sm.gain({ hunger: 4 }))]));
  add('Say something…', null, { chat: true });
  return out;
}

export function floorActions(game, sim, point) {
  return [{ label: 'Go here', make: () => T('Going', [go(point.clone(), { near: 0.1 })]), pos: point }];
}

// ---------------------------------------------------------------- free will

const urgency = (v) => (v > 96 ? 0 : ((100 - v) / 100) ** 2);

export function chooseAutonomous(game, sim) {
  const opts = [];
  for (const it of game.home.items.list) {
    if (sim.avoid?.get(it.uid) > game.time) continue;
    for (const a of itemActions(game, sim, it)) if (a.ad && (!a.when || a.when())) opts.push(a);
  }
  for (const o of game.sims) if (o !== sim) for (const a of simActions(game, sim, o, { voiced: game.settings.voiceAll })) if (a.ad) opts.push(a);
  let best = null;
  const scored = [];
  for (const a of opts) {
    let s = 0;
    for (const [need, v] of Object.entries(a.ad)) s += v * urgency(sim.needs[need]);
    s /= 1 + dist(a.pos, sim.pos) / 12;
    if (s > 0.8) scored.push([s, a]);
  }
  scored.sort((p, q) => q[0] - p[0]);
  const top = scored.slice(0, 3);
  if (top.length) best = top[Math.floor(Math.random() * top.length)][1];
  return best;
}

// Things to do with nothing to do.
export function idleTask(game, sim) {
  const r = Math.random();
  if (r < 0.35) {
    const h = game.home.house;
    const room = pick(h.rooms);
    const [x, z] = h.toWorld(room.x0 + 0.8 + Math.random() * (room.x1 - room.x0 - 1.6), room.z0 + 0.8 + Math.random() * (room.z1 - room.z0 - 1.6));
    return T('Wandering', [go(new THREE.Vector3(x, 0, z), { near: 0.3 })]);
  }
  if (r < 0.6) return T('Thinking', [anim('think', { loop: true, time: 4 })]);
  if (r < 0.8) return T('On the phone', [anim('phone', { time: 8, gains: { social: 0.8 } })]);
  return T('Stretching', [anim('arms_crossed', { time: 3 })]);
}

// Someone typed a line for the selected sim: say it, and let the nearest
// housemate answer.
// Answers that belong in a house, tried before the street-talk ones.
const HOME_REPLIES = [
  [/watch|tv|show|channel/i, ['Some cooking show. Sit down, it is good.', 'The news. Nothing new, as usual.', 'A cartoon. Do not judge me.']],
  [/hungry|dinner|lunch|breakfast|eat|food|cook|snack/i, ['I could eat. There is stuff in the fridge.', 'Your turn to cook, I think.', 'Grill something? It is nice out.']],
  [/tired|sleep|bed|nap/i, ['Go lie down, you look wiped.', 'Same. Early night?']],
  [/bored|fun|play|game/i, ['Pool table? Loser does the dishes.', 'Put some music on.', 'We could swim.']],
  [/swim|pool/i, ['Last one in does the dishes!', 'Give me a minute to find my towel.']],
  [/clean|mess|dishes|shower|bath|smell/i, ['Hey, I showered yesterday. Probably.', 'The dishes are not going to do themselves.']],
  [/paint|colou?r|wall|furniture|sofa|couch|redecorat|room/i, ['I like the new look.', 'Honestly? It needs more plants.', 'Can we keep the sofa where it is this time?']],
  [/love you|miss you/i, ['Aw. Love you too.', 'Stop, you will make me blush.']],
  [/music|song|dance/i, ['Turn it up!', 'Only if you dance too.']],
];

function homeReply(text, listener, rand = Math.random) {
  for (const [re, lines] of HOME_REPLIES) if (re.test(text)) return lines[Math.floor(rand() * lines.length)];
  return replyTo(text, { name: listener.name }, rand);
}

export function typedLine(game, sim, text, to = null) {
  const others = game.sims.filter((o) => o !== sim);
  // Say a housemate's name and they are the one who answers.
  const named = others.find((o) => new RegExp(`\\b${o.name}\\b`, 'i').test(text));
  const listener = to || named || others.sort((a, b) => dist(a.pos, sim.pos) - dist(b.pos, sim.pos))[0];
  const words = text.split(/\s+/).length;
  game.speech.say(sim.actor, text, { voice: sim.voice, voiced: true, priority: 2 });
  sim.gain({ social: 4 });
  if (!listener || dist(listener.pos, sim.pos) > 12) return;
  listener.actor.lookAt(sim.actor);
  sim.actor.lookAt(listener.actor);
  const line = homeReply(text, listener);
  game.later(Math.max(1.4, words / 2.6 + 0.6), () => {
    game.speech.say(listener.actor, line, { voice: listener.voice, voiced: true, priority: 2 });
    listener.gain({ social: 6 });
    game.later(4, () => { listener.actor.lookAt(null); sim.actor.lookAt(null); });
  });
}

export { forceFree };
