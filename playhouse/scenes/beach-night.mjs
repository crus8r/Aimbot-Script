/**
 * "Low Tide" — the second scene asked for in conversation, and a deliberate
 * test of two claims rather than a story:
 *
 *   1. that a described location can be built out of the same catalogue with
 *      no code change — sand instead of dirt, parasols and buckets and a ball
 *      instead of trees;
 *   2. that the time of day is a property of the scene file and not a thing
 *      baked into a renderer, so the same blocking plays at dusk or at night
 *      by changing one word.
 *
 * The shot list is short on purpose. Ten shots is what the forest scene needs
 * to tell its beat; four is what this one needs to prove its point, and every
 * shot that exists only to pad a demo costs a hundred seconds of Cycles.
 *
 * Change `mood` to 'DAY' or 'DUSK' and re-render to see the second claim.
 */

import { scatter } from '../src/scenefile.js';

export default {
  version: 1,
  title: 'Low Tide',

  environment: {
    preset: 'beach',
    ground: 'sand',
    size: [40, 40],
    mood: 'NIGHT',
    // Sea air, and at night the haze is what the moon is visible *in*. Lower
    // than the forest's 0.030: fog is the single most expensive thing in the
    // recipe and a beach has no canopy to hide the volume's edges behind.
    fog: 0.018,
    props: [
      // Abandoned toys, thinning out with distance from the towel line, which
      // is how a real beach at closing time is arranged: dense where people
      // sat, empty toward the water.
      ...scatter({ type: 'bucket', count: 7, inner: 2.2, outer: 11, id: 'pail', seed: 23, scaleMin: 0.85, scaleMax: 1.25 }),
      ...scatter({ type: 'ball', count: 4, inner: 3.0, outer: 13, id: 'ball', seed: 61, scaleMin: 0.9, scaleMax: 1.4 }),
      ...scatter({ type: 'parasol', count: 5, inner: 6.0, outer: 16, id: 'shade', seed: 5, scaleMin: 0.95, scaleMax: 1.15 }),

      // Three placed by hand rather than scattered, because these are the ones
      // that have to be in specific frames: a parasol to shoot past, and a
      // bucket and ball at the feet of the walk so the wide has foreground.
      { id: 'nearShade', type: 'parasol', at: [-3.4, 0, -3.2], scale: 1.1 },
      { id: 'nearPail', type: 'bucket', at: [1.5, 0, -1.1], scale: 1.15 },
      { id: 'lostBall', type: 'ball', at: [-1.2, 0, 1.8], scale: 1.2 },
    ],
  },

  cast: [
    { id: 'WALKER', spec: { build: 'slim', outfitType: 'coat', primary: '#2b3038', secondary: '#1b1f25' },
      at: [0, 0, -9], facing: 0 },
  ],

  shots: [
    // 1 — The beach before the figure is anywhere near it. Establishing a
    //     location means letting the audience look at it with nothing to do.
    { id: 'shore', duration: 3.4, fade: 'in',
      camera: { size: 'EWS', subject: 'WALKER', move: 'crane', height: 'high', side: 1 },
      actions: [{ actor: 'WALKER', do: 'move', to: [0, -5.5], speed: 1.1 }] },

    // 2 — Walking, with the dressing passing through foreground. A dolly is
    //     what makes scattered props read as a *place* rather than a backdrop:
    //     they have to move against each other.
    { id: 'walk', duration: 3.0,
      camera: { size: 'MWS', subject: 'WALKER', move: 'dolly', height: 'low', side: -1 },
      actions: [{ actor: 'WALKER', do: 'move', to: [0.4, -0.6], speed: 1.0 }] },

    // 3 — The insert the whole scene exists for. Naming a prop as the subject
    //     is what makes a shot an insert; nothing else has to be said.
    { id: 'pail', duration: 2.2,
      camera: { size: 'CU', subject: 'nearPail', move: 'push', height: 'low' } },

    // 4 — Pull out and leave. `secondary` names the parasol, so the framing is
    //     solved to hold the figure and the parasol together rather than
    //     centring the figure and hoping.
    { id: 'leave', duration: 3.6, fade: 'out',
      camera: { size: 'WS', subject: 'WALKER', secondary: 'nearShade', move: 'pull', height: 'eye', side: 1 },
      actions: [
        { actor: 'WALKER', do: 'look', target: 'nearPail' },
        { actor: 'WALKER', do: 'face', to: 2.4 },
      ] },
  ],
};
