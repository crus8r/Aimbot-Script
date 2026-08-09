/**
 * "Stopped" — the scene described in conversation:
 *   a man runs through the forest, drones halt him, he raises his hands,
 *   two guards emerge with weapons.
 *
 * Written the way a director would write it: every tree, drone and guard has a
 * position, and every shot names its size, move and subject. Nothing is
 * inferred. This is the file an LLM emits from a script, and the file the
 * editing UI mutates — they are the same artefact.
 */

import { scatter } from '../src/scenefile.js';

const PATH_Z = 0;

export default {
  version: 1,
  title: 'Stopped',

  environment: {
    preset: 'forest',
    ground: 'dirt',
    size: [44, 44],
    mood: 'DUSK',
    fog: 0.030,
    props: [
      // Dense canopy either side of the path, sparse down the middle so the
      // runner stays legible in a long lens.
      ...scatter({ type: 'tree', count: 13, inner: 5.0, outer: 15, id: 'treeL', seed: 7, scaleMin: 0.9, scaleMax: 1.6 }),
      ...scatter({ type: 'tree', count: 11, inner: 7.5, outer: 19, id: 'treeR', seed: 91, scaleMin: 1.0, scaleMax: 1.7 }),
      // Foreground trees for depth — something for the camera to pass behind.
      { id: 'fgTreeA', type: 'tree', at: [-4.6, 0, -6.5], rot: 1.1, scale: 1.35 },
      { id: 'fgTreeB', type: 'tree', at: [5.1, 0, -4.0], rot: 2.4, scale: 1.5 },
      { id: 'fgTreeC', type: 'tree', at: [-6.2, 0, 6.0], rot: 0.4, scale: 1.25 },

      // The blockade.
      { id: 'droneA', type: 'drone', at: [-2.1, 3.05, 3.4], rot: Math.PI, scale: 1.15 },
      { id: 'droneB', type: 'drone', at: [2.5, 3.75, 4.3], rot: Math.PI - 0.25, scale: 1.15 },
    ],
  },

  cast: [
    { id: 'RUNNER', spec: { build: 'slim', outfitType: 'workwear', primary: '#3c4a3a', secondary: '#2a2f28' },
      at: [0, 0, -15], facing: 0 },
    { id: 'GUARD_L', spec: { build: 'broad', outfitType: 'coat', primary: '#23282e', secondary: '#171a1e', accent: '#23282e' },
      at: [-5.2, 0, 5.2], facing: -0.9 },
    { id: 'GUARD_R', spec: { build: 'sturdy', outfitType: 'coat', primary: '#23282e', secondary: '#171a1e', accent: '#23282e' },
      at: [5.6, 0, 5.8], facing: 0.9 },
  ],

  shots: [
    // 1 — Establish the wood before anything happens in it.
    { id: 'establish', duration: 3.2, fade: 'in',
      camera: { size: 'EWS', subject: 'RUNNER', move: 'crane', height: 'high', side: 1 },
      actions: [{ actor: 'RUNNER', do: 'move', to: [0, PATH_Z - 8], speed: 3.4 }] },

    // 2 — Travel with him. Long lens, lateral dolly, trees strobing past.
    { id: 'travel', duration: 2.6,
      camera: { size: 'MS', subject: 'RUNNER', move: 'dolly', height: 'eye', side: -1 },
      actions: [{ actor: 'RUNNER', do: 'move', to: [0, PATH_Z - 2.5], speed: 3.6 }] },

    // 3 — Hard cut low and wide: the drones own the frame he is running into.
    { id: 'blockade', duration: 2.2,
      camera: { size: 'WS', subject: 'RUNNER', secondary: 'droneA', move: 'static', height: 'low', side: 1 },
      actions: [
        { actor: 'RUNNER', do: 'move', to: [0, PATH_Z - 1.2], speed: 1.1, pose: 'flinch' },
        { actor: 'RUNNER', do: 'look', target: 'droneA' },
      ] },

    // 4 — His reaction, close.
    { id: 'reaction', duration: 2.0,
      camera: { size: 'MCU', subject: 'RUNNER', secondary: 'droneA', move: 'push', height: 'eye', side: 1 },
      actions: [{ actor: 'RUNNER', do: 'look', target: 'droneB', weight: 1 }] },

    // 5 — Insert on the sensor. The machine looking back.
    { id: 'sensor', duration: 1.6,
      camera: { size: 'CU', subject: 'droneA', move: 'push', height: 'low' } },

    // 6 — Hands up, seen wide so the gesture reads as surrender to the space.
    { id: 'surrender', duration: 2.6,
      camera: { size: 'MWS', subject: 'RUNNER', secondary: 'droneB', move: 'static', height: 'low', side: 1 },
      actions: [
        { actor: 'RUNNER', do: 'pose', pose: 'handsUp' },
        { actor: 'RUNNER', do: 'face', to: 0.15 },
      ] },

    // 7 — The guards arrive from behind him, into the same frame.
    { id: 'arrival', duration: 3.0,
      camera: { size: 'WS', subject: 'RUNNER', secondary: 'GUARD_L', move: 'dolly', height: 'eye', side: 1 },
      actions: [
        { actor: 'GUARD_L', do: 'hold', prop: 'rifle', hand: 'R' },
        { actor: 'GUARD_R', do: 'hold', prop: 'rifle', hand: 'R' },
        { actor: 'GUARD_L', do: 'move', to: [-2.2, 1.8], speed: 2.0, facing: 0.45 },
        { actor: 'GUARD_R', do: 'move', to: [2.4, 2.2], speed: 2.0, facing: -0.45 },
        { actor: 'GUARD_L', do: 'look', target: 'RUNNER' },
        { actor: 'GUARD_R', do: 'look', target: 'RUNNER' },
      ] },

    // 8 — Over the guard's shoulder: weapon up, the man small beyond it.
    { id: 'ots', duration: 2.4,
      camera: { size: 'MS', subject: 'RUNNER', secondary: 'GUARD_L', ots: true, move: 'handheld', height: 'eye', side: -1 },
      actions: [
        { actor: 'GUARD_L', do: 'pose', pose: 'aim' },
        { actor: 'GUARD_R', do: 'pose', pose: 'aim' },
      ] },

    // 9 — Hold on him. Nothing moves. This is the beat the scene is about.
    { id: 'held', duration: 2.8,
      camera: { size: 'CU', subject: 'RUNNER', secondary: 'GUARD_R', move: 'push', height: 'eye', side: 1 } },

    // 10 — Pull all the way out and let the wood swallow it.
    { id: 'wide', duration: 3.4, fade: 'out',
      camera: { size: 'EWS', subject: 'RUNNER', secondary: 'GUARD_R', move: 'pull', height: 'high', side: 1 } },
  ],
};
