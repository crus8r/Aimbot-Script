# vendor

Third-party code, checked in so the game still runs from `file://` with no
install step and no network.

## three.min.js — three.js r149

The UMD build, taken verbatim from the `three@0.149.0` npm package
(`build/three.min.js`). It defines the global `THREE`; nothing else in the
project depends on a module loader.

MIT licensed — Copyright 2010-2023 Three.js Authors. The license header is
preserved at the top of the file.

Only `src/fighters3d.js` and `src/specs3d.js` use it, and only in Versus mode.
If it fails to load, or the device has no WebGL, `src/sideview.js` falls back
to the hand-rolled canvas renderer in `src/gfx3d.js` and the game runs
exactly as before.
