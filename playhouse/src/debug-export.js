/**
 * Development only: exports a procedural character as a .glb so the import and
 * retargeting path can be tested end-to-end without a third-party avatar.
 */
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { castCharacter, createCharacter } from './human.js';

window.exportTestAvatar = (name = 'TESTER') => new Promise((resolve, reject) => {
  const character = createCharacter(castCharacter(name, {}, 0));
  new GLTFExporter().parse(
    character,
    (glb) => resolve(Array.from(new Uint8Array(glb))),
    (err) => reject(err),
    { binary: true, onlyVisible: false },
  );
});
