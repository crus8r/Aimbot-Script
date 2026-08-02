/* VANGUARD — specs3d.js
 * Per-character geometry for the three.js Versus fighters.
 *
 * Coordinates are the same everywhere: +X is the way the character faces,
 * +Y is up, +Z is their own left-right axis. Head art is authored around the
 * head centre, torso art around the hip, limb art in the bone's own frame
 * (+X runs down the bone, +Y is the front of the limb).
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var S3 = (SH.SPECS3 = {});
  var PI = Math.PI;

  /* Shared helpers ---------------------------------------------------- */

  /* A cape / hair / tabard chain: n tapering slabs, each hinged on the last. */
  function chain(api, root, n, opt) {
    var segs = [];
    var parent = root;
    for (var i = 0; i < n; i++) {
      var seg = api.grp(parent);
      var k = 1 - i / n;
      var len = opt.len * (0.62 + k * 0.38);
      var wide = opt.wide * (opt.taper === undefined ? 1 : U.lerp(opt.taper, 1, k));
      var mesh = api.mesh(api.box(len, opt.thick * (0.6 + k * 0.4), wide),
        opt.mat, -len / 2, 0, 0, seg);
      mesh.castShadow = opt.shadow !== false;
      if (opt.hem) {
        api.mesh(api.box(len * 0.94, opt.thick * 0.42, wide * 1.04), opt.hem, -len / 2, -opt.thick * 0.5, 0, seg)
          .castShadow = false;
      }
      segs.push(seg);
      parent = api.grp(seg, -len, 0, 0);
    }
    segs.tip = parent;
    return segs;
  }

  /* Drives a chain built above. `set` is the hinge angle of the first link. */
  function swayChain(segs, base, t, f, opt) {
    if (!segs) return;
    opt = opt || {};
    var speed = Math.abs(f.vx || 0);
    var lift = U.clamp(speed / (opt.liftAt || 340), 0, 1) * (opt.lift || 0.55);
    var air = f.grounded === false ? (opt.air || 0.35) : 0;
    var w = Math.sin(t * (opt.rate || 3.4));
    for (var i = 0; i < segs.length; i++) {
      segs[i].rotation.z = (i === 0 ? base - lift - air : (opt.follow || 0.12))
        + w * (opt.amp || 0.09) * (i === 0 ? 1 : 0.55 / i);
      segs[i].rotation.y = Math.sin(t * (opt.rate || 3.4) * 0.63 + i) * (opt.yaw || 0.05);
    }
  }

  /* A faceted crystal: octahedron squashed into a shard. */
  function shard(api, mat, len, wide, parent, x, y, z) {
    var s = api.mesh(new api.THREE.OctahedronGeometry(1, 0), mat, x, y, z, parent);
    s.scale.set(wide, len, wide * 0.72);
    return s;
  }

  /* =====================================================================
   * SAVIOR — white plate knight, green crystal, shortsword
   * =================================================================== */
  S3.savior = {
    build: {
      scale: 1.03, hip: 54, sho: 88, head: 101,
      chest: 22, shoW: 34, hipZ: 7.5, shoZ: 13.5,
      thigh: 27, shin: 26, upper: 22, fore: 20,
      legR0: 7.8, legR1: 6.2, legR2: 5.4,
      armR0: 6.8, armR1: 5.4, armR2: 4.7,
      handR: 5, footL: 16, bootH: 10
    },
    mats: function (K, inForm, mat) {
      var plate = { rough: 0.3, metal: 0.66 };
      var under = { rough: 0.82, metal: 0.08 };
      return {
        acColor: inForm ? K.formGlow : K.accent,
        torso: mat('#f2f5fa', plate), pelvis: mat('#2b313c', under),
        neck: mat('#3a4250', under),
        leg: mat('#3b424f', under), legFar: mat('#2b313c', under),
        knee: mat('#e6ebf2', plate),
        arm: mat('#3b424f', under), armFar: mat('#2b313c', under),
        fore: mat('#eef2f8', plate), foreFar: mat('#b9c2cf', plate),
        glove: mat('#4d5666', { rough: 0.55, metal: 0.35 }), gloveFar: mat('#3a414e', { rough: 0.55, metal: 0.3 }),
        boot: mat('#eef2f8', plate), bootFar: mat('#b9c2cf', plate),
        white: mat('#f4f7fb', plate), grey: mat('#c3ccd8', plate), grey2: mat('#98a3b2', plate),
        trim: mat(K.accent, { rough: 0.34, metal: 0.6 }),
        acc: mat(K.accent, { em: true, emI: inForm ? 1.5 : 0.85, rough: 0.24, metal: 0.1 }),
        crystal: mat(K.accent, { em: true, emI: inForm ? 1.7 : 1.0, rough: 0.12, metal: 0.1 }),
        dark: mat('#141a24', { rough: 0.92 }),
        steel: mat('#dee6f2', { rough: 0.16, metal: 0.92 }),
        cape: mat('#eaeff6', { rough: 0.86 }), capeIn: mat('#2f6b4a', { rough: 0.88 })
      };
    },
    shoulder: function (g, M, B, near, api) {
      var z = near ? 3.2 : -3.2;
      /* main pauldron, tilted outboard so it clears the neck */
      var p = api.mesh(new api.THREE.SphereGeometry(8.6, 16, 10, 0, PI * 2, 0, PI * 0.6), M.white, -0.5, 0.5, z, g);
      p.scale.set(1.1, 1.0, 1.24);
      p.rotation.x = near ? -0.2 : 0.2;
      /* lower lame */
      var l = api.mesh(new api.THREE.SphereGeometry(7.4, 14, 8, 0, PI * 2, 0, PI * 0.46), M.grey, -1.2, -4.2, z * 1.1, g);
      l.scale.set(1.08, 0.9, 1.2);
      l.rotation.x = near ? -0.24 : 0.24;
      api.mesh(api.box(4.2, 1.4, 9), M.trim, 1.4, 2.6, z, g);
    },
    leg: function (parts, M, B, near, api) {
      var pm = near ? M.white : M.grey;
      /* cuisse over the thigh */
      api.mesh(api.prism(20, 8.6, 7.2, 8, 0.4).scale(1, 1, 1.02), pm, 3, 0.8, 0, parts.thigh);
      /* knee poleyn + greave down the shin */
      api.mesh(api.sphere(6.5, 12), M.knee, 0, 0.6, 0, parts.shin).scale.set(1.05, 1, 1.1);
      api.mesh(api.prism(17, 6.6, 5.6, 8, 0.4), pm, 5, 1.1, 0, parts.shin);
      api.mesh(api.box(5, 2, 8.4), M.trim, 8, 4.2, 0, parts.shin);
    },
    head: function (g, M, B, api, inForm) {
      /* great-helm: rounded skull, brow band, slit visor, jaw guard */
      api.mesh(new api.THREE.CapsuleGeometry(7.1, 5.6, 5, 16), M.white, 0.4, 0.8, 0, g).scale.set(1.02, 1, 0.97);
      api.mesh(new api.THREE.SphereGeometry(7.5, 16, 9, 0, PI * 2, 0, PI * 0.52), M.white, 0.2, 4.4, 0, g)
        .scale.set(1.03, 0.9, 1.0);
      api.mesh(api.prism(9.4, 6.8, 5.4, 7, 0.45).scale(1, 0.62, 1.5), M.grey, 1.4, 2.9, 0, g)
        .rotation.z = -0.12;                                             // brow
      api.mesh(api.box(3.2, 4.4, 12.6), M.dark, 5.6, -0.6, 0, g);        // visor recess
      api.mesh(api.box(1.5, 1.9, 10.4), M.acc, 6.9, -0.4, 0, g);         // lit slit
      api.glow(M.acColor, 13, g, 7.6, -0.4, 0);
      var jaw = api.mesh(api.prism(8.2, 5.4, 3.8, 6, 0.4).scale(1, 1.15, 1.5), M.grey2, 1.6, -5.4, 0, g);
      jaw.rotation.z = -0.45;                                            // jaw guard
      api.mesh(api.box(2.6, 6.4, 11.6), M.grey, 4.6, -5.6, 0, g);
      /* crest */
      api.mesh(api.prism(15, 3.6, 1.4, 4, 0).scale(1, 1, 0.55), M.grey, -4.4, 6.6, 0, g).rotation.z = -0.5;
      api.mesh(api.box(11, 1.8, 1.9), M.trim, 0.4, 9.6, 0, g).rotation.z = -0.22;
      /* cheek vents */
      for (var i = 0; i < 3; i++) {
        api.mesh(api.box(0.9, 1.5, 2.2), M.trim, 5.9, -2.6 - i * 1.8, 5.2, g);
        api.mesh(api.box(0.9, 1.5, 2.2), M.trim, 5.9, -2.6 - i * 1.8, -5.2, g);
      }
    },
    torsoArt: function (g, M, B, api, inForm, th) {
      var cy = th * 0.66;
      /* layered breastplate over the barrel */
      var bp = api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.5, B.chest * 0.6, th * 0.46, 16, 1, false, -PI * 0.12, PI * 1.24),
        M.white, 0, cy - 1, 0, g);
      bp.scale.set(1.06, 1, B.shoW / B.chest * 0.96);
      var ab = api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.58, B.chest * 0.46, th * 0.34, 16, 1, false, -PI * 0.1, PI * 1.2),
        M.grey, 0, th * 0.3, 0, g);
      ab.scale.set(1.04, 1, B.shoW / B.chest * 0.92);
      /* collar */
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.42, B.chest * 0.52, 7, 14).scale(1, 1, B.shoW / B.chest * 0.8),
        M.grey2, 0, th - 1, 0, g);
      /* the crystal sigil, set in a silver mount */
      api.mesh(new api.THREE.OctahedronGeometry(6.4, 0), M.grey2, B.chest * 0.5, cy, 0, g).scale.set(0.34, 1, 0.86);
      shard(api, M.crystal, 5.4, 2.9, g, B.chest * 0.58, cy, 0);
      api.glow(M.acColor, inForm ? 30 : 19, g, B.chest * 0.62, cy, 0);
      /* belt + tassets */
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.54, B.chest * 0.54, 6.5, 16).scale(1, 1, B.shoW / B.chest * 0.86),
        M.grey2, 0, 5, 0, g);
      api.mesh(api.box(4.5, 4.5, 4.5), M.trim, B.chest * 0.5, 5, 0, g).rotation.z = PI / 4;
      for (var s = -1; s <= 1; s += 2) {
        var tas = api.mesh(api.box(3, 15, 9), M.white, B.chest * 0.26, -5, s * 7.5, g);
        tas.rotation.z = s * 0.06 - 0.2;
      }
    },
    back: function (g, M, B, api) {
      var root = api.grp(g, -B.chest * 0.46, B.sho - B.hip - 2, 0);
      g.userData.segs = chain(api, root, 6, { len: 12, thick: 1.5, wide: B.shoW * 0.88, taper: 0.7, mat: M.cape, hem: M.capeIn });
      api.mesh(api.prism(5, 3.6, 2.4, 6, 0.4).scale(1, 1, 2.6), M.grey2, -1, 2.6, 0, root);
    },
    weapon: function (g, M, B, api, inForm) {
      g.position.x = B.handR * 0.7;
      g.rotation.z = -0.9;
      api.mesh(api.sphere(2.8, 8), M.grey2, -8, 0, 0, g);                       // pommel
      api.mesh(api.cyl(2.0, 2.2, 11, 8), M.dark, -2.5, 0, 0, g).rotation.z = PI / 2;
      api.mesh(api.box(3.6, 12.5, 4.4), M.grey2, 4.5, 0, 0, g);                 // crossguard
      shard(api, M.crystal, 2.6, 1.5, g, 4.5, 0, 0);
      var blade = api.mesh(api.prism(40, 3.2, 2.4, 4, PI / 4).scale(1, 1.5, 0.42), M.steel, 8, 0, 0, g);
      blade.castShadow = true;
      api.mesh(api.prism(9, 2.4, 0.4, 4, PI / 4).scale(1, 1.5, 0.42), M.steel, 48, 0, 0, g);
      api.mesh(api.box(44, 0.7, 0.9), M.acc, 27, 1.4, 0, g);                    // lit fuller
      api.glow(M.acColor, inForm ? 26 : 15, g, 28, 0, 0);
    },
    animate: function (m, f, p) {
      swayChain(m.backGrp && m.backGrp.userData.segs, 1.34, p.t, f, { rate: 2.9, amp: 0.07, lift: 0.85, yaw: 0.05, follow: 0.05 });
    }
  };

  /* =====================================================================
   * EXODUS — lean speedster, goggles, loose hair, energy whips
   * =================================================================== */
  S3.exodus = {
    build: {
      scale: 1.0, hip: 55, sho: 88, head: 101,
      chest: 18, shoW: 28, hipZ: 6.6, shoZ: 11,
      thigh: 27, shin: 26, upper: 22, fore: 20,
      legR0: 6.6, legR1: 5.2, legR2: 4.5,
      armR0: 5.6, armR1: 4.5, armR2: 3.9,
      handR: 4.5, footL: 15, bootH: 9
    },
    mats: function (K, inForm, mat) {
      var ac = inForm ? K.formGlow : K.accent;
      var weave = { rough: 0.86, metal: 0.06 };
      var tech = { rough: 0.42, metal: 0.55 };
      return {
        acColor: ac,
        torso: mat('#15181f', weave), pelvis: mat('#0d1015', weave), neck: mat('#101319', weave),
        leg: mat('#191d26', weave), legFar: mat('#101319', weave),
        arm: mat('#1e232e', weave), armFar: mat('#14171e', weave),
        fore: mat('#12151b', weave), foreFar: mat('#0c0e13', weave),
        glove: mat('#0d1016', { rough: 0.5, metal: 0.3 }), gloveFar: mat('#080a0e', { rough: 0.5 }),
        boot: mat('#0c0f14', { rough: 0.44, metal: 0.3 }), bootFar: mat('#080a0e', { rough: 0.44 }),
        plate: mat('#2a3140', tech), plate2: mat('#39424f', tech),
        acc: mat(ac, { em: true, emI: inForm ? 1.5 : 1.05, rough: 0.28 }),
        accDim: mat(ac, { em: true, emI: 0.5, rough: 0.4 }),
        hair: mat('#14151f', { rough: 0.62, metal: 0.1 }), hair2: mat('#1c1d29', { rough: 0.6, metal: 0.1 }),
        mask: mat('#0a0c11', { rough: 0.4, metal: 0.35 }),
        lens: mat(ac, { em: true, emI: inForm ? 1.6 : 1.15, rough: 0.1, metal: 0.2 })
      };
    },
    shoulder: function (g, M, B, near, api) {
      var z = near ? 2.2 : -2.2;
      var c = api.mesh(new api.THREE.SphereGeometry(6.6, 14, 9, 0, PI * 2, 0, PI * 0.56), M.plate, -0.5, 0.4, z, g);
      c.scale.set(1, 0.94, 1.16);
      api.mesh(api.box(2.4, 0.9, 7), M.acc, 2.4, 1.6, z, g);
    },
    leg: function (parts, M, B, near, api) {
      api.mesh(api.prism(15, 6.4, 5.6, 7, 0.4), M.plate, 6, 0.8, 0, parts.thigh);
      api.mesh(api.box(1.1, 13, 1.1), M.accDim, 6.6, 6.6, 0, parts.thigh);
      api.mesh(api.prism(13, 5.2, 4.6, 7, 0.4), M.plate2, 3, 0.6, 0, parts.shin);
      api.mesh(api.box(1.1, 11, 1.1), M.acc, 5, 8, 0, parts.shin);
    },
    head: function (g, M, B, api, inForm) {
      api.mesh(new api.THREE.CapsuleGeometry(6.4, 5.2, 5, 16), M.mask, 1.2, 0.6, 0, g).scale.set(1, 1, 0.96);
      /* swept-back hair cap */
      var cap = api.mesh(new api.THREE.SphereGeometry(7.1, 16, 10, 0, PI * 2, 0, PI * 0.66), M.hair, -1.2, 2.2, 0, g);
      cap.scale.set(1.14, 1.02, 1.06);
      /* wraparound goggles */
      var band = api.mesh(api.prism(3.8, 3.2, 2.9, 8, 0).scale(1, 1, 2.35), M.mask, 3.6, 1.6, 0, g);
      band.rotation.z = -0.06;
      for (var s = -1; s <= 1; s += 2) {
        var lens = api.mesh(new api.THREE.SphereGeometry(2.3, 12, 8, 0, PI * 2, 0, PI * 0.5), M.lens, 6.6, 1.7, s * 3.3, g);
        lens.rotation.z = -PI / 2;
        lens.scale.set(1.05, 0.6, 1.3);
        api.glow(M.acColor, inForm ? 11 : 8, g, 7.2, 1.7, s * 3.3);
      }
      api.mesh(api.box(1.1, 1.4, 3.0), M.plate2, 6.6, 1.7, 0, g);                 // bridge
      /* lower face mask */
      var lower = api.mesh(api.prism(7.4, 5.0, 3.6, 7, 0.42).scale(1, 1.16, 1.5), M.mask, 1.4, -5.2, 0, g);
      lower.rotation.z = -0.44;
      api.mesh(api.box(1.0, 4.6, 6.2), M.plate, 6.1, -5.4, 0, g);
      api.mesh(api.box(0.9, 0.9, 5), M.acc, 6.8, -4.2, 0, g);
    },
    torsoArt: function (g, M, B, api, inForm, th) {
      /* segmented chest plate so the silhouette isn't one black tube */
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.5, B.chest * 0.58, th * 0.42, 14, 1, false, -PI * 0.1, PI * 1.2),
        M.plate, 0, th * 0.66, 0, g).scale.set(1.05, 1, B.shoW / B.chest * 0.92);
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.56, B.chest * 0.48, th * 0.26, 14, 1, false, -PI * 0.08, PI * 1.16),
        M.plate2, 0, th * 0.32, 0, g).scale.set(1.03, 1, B.shoW / B.chest * 0.88);
      /* chevrons running up the chest */
      api.mesh(api.box(1.1, th * 0.46, 1.4), M.accDim, B.chest * 0.52, th * 0.6, 0, g);
      for (var i = 0; i < 3; i++) {
        for (var sg = -1; sg <= 1; sg += 2) {
          var ch = api.mesh(api.box(1.1, 1.4, 8 - i * 1.4), M.acc, B.chest * 0.52, th * 0.48 + i * 7, sg * (4 - i * 0.7), g);
          ch.rotation.x = sg * 0.5;
        }
      }
      api.glow(M.acColor, 15, g, B.chest * 0.58, th * 0.62, 0);
      /* harness + collar */
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.44, B.chest * 0.5, 8.5, 14).scale(1, 1, B.shoW / B.chest * 0.8),
        M.plate, 0, th - 1.5, 0, g);
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.52, B.chest * 0.52, 5.5, 14).scale(1, 1, B.shoW / B.chest * 0.9),
        M.plate, 0, 5, 0, g);
      /* the energy charges he throws, clipped to the belt */
      for (var c = 0; c < 3; c++) {
        shard(api, M.acc, 2.0, 1.4, g, B.chest * 0.34, 5.5, -8 + c * 8);
      }
      api.glow(M.acColor, 15, g, B.chest * 0.34, 5.5, 0);
    },
    back: function (g, M, B, api) {
      /* four loose strands so the hair reads as hair, not a plank */
      g.userData.strands = [];
      var zs = [0, 4.2, -4.2, 1.8];
      for (var i = 0; i < 4; i++) {
        var root = api.grp(g, -3.4, B.head - B.hip - 3 - (i === 3 ? 2 : 0), zs[i]);
        g.userData.strands.push(chain(api, root, 3, {
          len: 19 - i * 1.6, thick: 5.4 - i * 0.7, wide: 7.4 - i * 1.1,
          mat: i % 2 ? M.hair2 : M.hair, taper: true
        }));
      }
    },
    weapon: function (g, M, B, api, inForm) { whip(g, M, B, api, true); },
    weaponOff: function (g, M, B, api, inForm) { whip(g, M, B, api, false); },
    animate: function (m, f, p) {
      var t = p.t, st = m.backGrp && m.backGrp.userData.strands;
      if (st) {
        var run = U.clamp(Math.abs(f.vx || 0) / 380, 0, 1);
        for (var i = 0; i < st.length; i++) {
          swayChain(st[i], 1.22 - run * 0.34, t + i * 0.7, f, { rate: 5.2, amp: 0.14, lift: 0.42, yaw: 0.1 });
        }
      }
      animWhip(m.weaponGrp, p, true);
      animWhip(m.weaponGrpB, p, false);
    }
  };

  function whip(g, M, B, api, near) {
    g.position.x = B.handR * 0.9;
    api.mesh(api.prism(9, 2.4, 1.9, 6, 0.4), M.plate, -1, 0, 0, g);          // handle
    api.mesh(api.box(1.2, 1.2, 4), M.acc, 3, 1.6, 0, g);
    var links = [];
    var parent = api.grp(g, 8, 0, 0);
    for (var i = 0; i < 7; i++) {
      var seg = api.grp(parent);
      var m = api.mesh(api.cyl(1.35 - i * 0.14, 1.7 - i * 0.14, 12, 6).rotateZ(-PI / 2).translate(6, 0, 0),
        M.acc, 0, 0, 0, seg);
      m.castShadow = false;
      links.push(seg);
      parent = api.grp(seg, 12, 0, 0);
    }
    api.glow(M.acColor, 18, g, 10, 0, 0);
    g.userData.links = links;
  }
  function animWhip(g, p, near) {
    if (!g || !g.userData.links) return;
    var links = g.userData.links;
    var lash = (p.swing >= 0 && near) ? p.swing : -1;
    var base = lash >= 0 ? U.lerp(1.55, -0.3, U.ease(lash)) : (near ? 1.62 : 1.78);
    for (var i = 0; i < links.length; i++) {
      /* idle: the lash coils under the hand. striking: it snaps straight. */
      links[i].rotation.z = i === 0 ? base
        : (lash >= 0 ? 0.03 + Math.sin(p.t * 13 + i * 1.1) * 0.12 : 0.66 + Math.sin(p.t * 2.6 + i) * 0.05);
      links[i].rotation.y = Math.sin(p.t * 9 + i) * (lash >= 0 ? 0.05 : 0.1);
      links[i].scale.setScalar(lash >= 0 ? 1 : 0.87);
    }
  }

  /* =====================================================================
   * PARAGON — heavy blue-and-gold plate, war hammer, wings in form
   * =================================================================== */
  S3.paragon = {
    build: {
      scale: 1.1, hip: 54, sho: 88, head: 102,
      chest: 25, shoW: 40, hipZ: 8.5, shoZ: 16,
      thigh: 27, shin: 26, upper: 22, fore: 20,
      legR0: 9, legR1: 7.1, legR2: 6.1,
      armR0: 8, armR1: 6.2, armR2: 5.4,
      handR: 5.8, footL: 18, bootH: 12
    },
    mats: function (K, inForm, mat) {
      var plate = { rough: 0.28, metal: 0.72 };
      var gold = { rough: 0.2, metal: 0.94 };
      return {
        acColor: K.accent,
        torso: mat(K.base, plate), pelvis: mat(K.dark, plate), neck: mat('#e0ab7c', { rough: 0.86 }),
        leg: mat(K.mid, plate), legFar: mat('#153a7c', plate),
        knee: mat(K.accent, gold),
        arm: mat(K.base, plate), armFar: mat('#245bbb', plate),
        fore: mat(K.accent, gold), foreFar: mat('#b9913f', gold),
        glove: mat(K.accent, gold), gloveFar: mat('#b9913f', gold),
        boot: mat(K.accent, gold), bootFar: mat('#b9913f', gold),
        blue: mat(K.base, plate), blueD: mat(K.mid, plate), navy: mat('#123064', plate),
        gold: mat(K.accent, gold), goldDim: mat('#b9913f', gold),
        acc: mat(K.accent, { em: true, emI: inForm ? 1.4 : 0.7, rough: 0.24, metal: 0.5 }),
        skin: mat('#efc59c', { rough: 0.84 }), hair: mat(K.hair || '#e8cf85', { rough: 0.82 }),
        lens: mat('#eef4ff', { em: '#cfe0ff', emI: 0.55, rough: 0.25 }),
        wood: mat('#4d3222', { rough: 0.92 }), steel: mat('#3b465e', { rough: 0.3, metal: 0.85 }),
        wing: mat(K.formGlow, { em: true, emI: 0.95, alpha: 0.42, two: true, rough: 0.4 }),
        spear: mat('#fff6dd', { em: true, emI: 1.5, rough: 0.2 })
      };
    },
    shoulder: function (g, M, B, near, api) {
      var z = near ? 3.4 : -3.4;
      var p = api.mesh(new api.THREE.SphereGeometry(10.4, 18, 11, 0, PI * 2, 0, PI * 0.58), M.gold, -1, -0.4, z, g);
      p.scale.set(1.1, 1.02, 1.26);
      p.rotation.x = near ? -0.22 : 0.22;
      var l = api.mesh(new api.THREE.SphereGeometry(9.4, 16, 9, 0, PI * 2, 0, PI * 0.44), M.goldDim, -1.6, -6, z * 1.08, g);
      l.scale.set(1.08, 0.86, 1.24);
      l.rotation.x = near ? -0.26 : 0.26;
      api.mesh(api.box(4.6, 1.6, 11), M.blueD, 1.6, 1.4, z, g);
      shard(api, M.acc, 3.4, 1.6, g, -1, 7.4, z);
    },
    leg: function (parts, M, B, near, api) {
      api.mesh(api.prism(21, 9.8, 8.2, 8, 0.4), M.blue, 3, 0.8, 0, parts.thigh);
      api.mesh(api.sphere(7.5, 12), M.gold, 0, 0.4, 0, parts.shin).scale.set(1.05, 1, 1.1);
      api.mesh(api.prism(16, 7.4, 6.4, 8, 0.4), M.blue, 5, 1, 0, parts.shin);
      api.mesh(api.box(5, 2.2, 9.6), M.gold, 8, 4.6, 0, parts.shin);
    },
    head: function (g, M, B, api, inForm) {
      api.mesh(new api.THREE.CapsuleGeometry(6.8, 5.6, 5, 16), M.skin, 0.8, 0.2, 0, g).scale.set(1, 1, 0.95);
      api.mesh(api.prism(5.4, 4.4, 3.4, 7, 0.42).scale(1, 1.02, 1.3), M.skin, 1.8, -5.0, 0, g).rotation.z = -0.62;
      /* short blond hair, swept */
      var cap = api.mesh(new api.THREE.SphereGeometry(7.4, 16, 10, 0, PI * 2, 0, PI * 0.54), M.hair, -0.5, 3.0, 0, g);
      cap.scale.set(1.06, 0.98, 1.03);
      for (var i = 0; i < 3; i++) {
        var tuft = api.mesh(api.prism(7 - i, 2.6, 0.9, 5, 0.4).scale(1, 0.62, 1.7), M.hair, 3.4, 5.2 - i * 2.2, (i - 1) * 3.6, g);
        tuft.rotation.z = 0.35 + i * 0.12;
      }
      /* domino mask, blank lenses */
      var mask = api.mesh(api.prism(3.2, 4.8, 4.3, 8, 0.4).scale(1, 1.02, 1.85), M.blue, 4.0, 1.3, 0, g);
      mask.rotation.z = -0.08;
      api.mesh(api.box(1.1, 1.2, 13.4), M.gold, 6.6, 3.4, 0, g);
      for (var s = -1; s <= 1; s += 2) {
        var eye = api.mesh(new api.THREE.SphereGeometry(2.3, 12, 8, 0, PI * 2, 0, PI * 0.5), M.lens, 6.4, 1.3, s * 3.5, g);
        eye.rotation.z = -PI / 2;
        eye.scale.set(1.1, 0.62, 1.3);
      }
      if (inForm) {
        for (var h = 0; h < 7; h++) {
          var a = -0.9 + h * 0.3;
          api.mesh(api.box(2.6, 0.8, 0.8), M.acc, Math.cos(a) * 12 - 1, 9.4 + Math.sin(a) * 3, Math.sin(a) * 12, g);
        }
        api.glow(SH.kitById('paragon').colors.formGlow, 40, g, -1, 11, 0);
      }
    },
    torsoArt: function (g, M, B, api, inForm, th) {
      var cy = th * 0.66;
      var bp = api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.52, B.chest * 0.62, th * 0.48, 16, 1, false, -PI * 0.1, PI * 1.2),
        M.blue, 0, cy - 1, 0, g);
      bp.scale.set(1.06, 1, B.shoW / B.chest * 0.94);
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.6, B.chest * 0.48, th * 0.34, 16, 1, false, -PI * 0.08, PI * 1.16),
        M.blueD, 0, th * 0.3, 0, g).scale.set(1.04, 1, B.shoW / B.chest * 0.9);
      api.mesh(new api.THREE.TorusGeometry(B.chest * 0.5, 1.9, 6, 18), M.gold, 0, cy + 6, 0, g).rotation.x = PI / 2;
      /* winged sigil */
      api.mesh(new api.THREE.OctahedronGeometry(8.5, 0), M.gold, B.chest * 0.54, cy, 0, g).scale.set(0.3, 1, 0.72);
      for (var s = -1; s <= 1; s += 2) {
        for (var q = 0; q < 3; q++) {
          var w = api.mesh(api.box(1.5, 3.2 - q * 0.6, 11 - q * 2.6), M.gold,
            B.chest * 0.5, cy + 2.6 + q * 3.2, s * (6.5 - q * 1.1), g);
          w.rotation.x = s * (0.36 + q * 0.1);
        }
      }
      api.glow(SH.kitById('paragon').colors.accent, inForm ? 30 : 17, g, B.chest * 0.58, cy, 0);
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.56, B.chest * 0.56, 9, 16).scale(1, 1, B.shoW / B.chest * 0.88),
        M.navy, 0, 5, 0, g);
      api.mesh(new api.THREE.OctahedronGeometry(5.4, 0), M.gold, B.chest * 0.52, 5, 0, g).scale.set(0.4, 1, 0.9);
      for (var t2 = -1; t2 <= 1; t2 += 2) {
        api.mesh(api.box(3, 16, 10), M.blue, B.chest * 0.28, -5, t2 * 8.5, g).rotation.z = -0.18;
      }
    },
    back: function (g, M, B, api, inForm) {
      if (!inForm) return;
      var wings = [];
      for (var s = -1; s <= 1; s += 2) {
        var w = api.grp(g, -8, B.sho - B.hip - 4, s * 7);
        w.rotation.y = s * 0.6;
        for (var q = 0; q < 4; q++) {
          var f = api.mesh(api.box(100 - q * 20, 17 - q * 3, 1.4), M.wing, -(48 - q * 9), q * 5.5, 0, w);
          f.rotation.z = 0.5 - q * 0.17;
          f.castShadow = false;
        }
        wings.push(w);
      }
      api.glow(SH.kitById('paragon').colors.formGlow, 130, g, -34, B.sho - B.hip, 0);
      g.userData.wings = wings;
    },
    weapon: function (g, M, B, api, inForm) {
      g.position.x = B.handR;
      g.rotation.z = -0.78;
      if (inForm) {
        api.mesh(api.cyl(1.9, 2.2, 104, 8).rotateZ(-PI / 2).translate(52, 0, 0), M.spear, -22, 0, 0, g);
        api.mesh(new api.THREE.ConeGeometry(4.6, 26, 4), M.spear, 82, 0, 0, g).rotation.z = -PI / 2;
        api.mesh(api.box(3, 9, 1.6), M.spear, 68, 0, 0, g);
        api.glow(SH.kitById('paragon').colors.formGlow, 100, g, 46, 0, 0);
      } else {
        api.mesh(api.cyl(2.3, 2.6, 60, 10).rotateZ(-PI / 2).translate(30, 0, 0), M.wood, -18, 0, 0, g);
        api.mesh(api.box(6, 5.2, 5.2), M.gold, -18, 0, 0, g);                       // butt cap
        for (var i = 0; i < 3; i++) api.mesh(api.box(1.2, 5, 5), M.goldDim, -6 + i * 13, 0, 0, g);
        /* head: a squared striking face one side, a tapered claw the other */
        api.mesh(api.prism(16, 8.2, 7.4, 4, PI / 4).scale(1, 1.4, 1.22), M.gold, 34, 0, 0, g);
        api.mesh(api.box(2.6, 17.5, 15), M.steel, 34, 0, 0, g);
        api.mesh(api.box(3.2, 18.5, 16), M.steel, 50, 0, 0, g);
        api.mesh(new api.THREE.ConeGeometry(4.4, 9, 4), M.gold, 55.5, 0, 0, g).rotation.z = -PI / 2;
        api.mesh(api.box(1.6, 3.2, 9), M.acc, 42, 8.4, 0, g);
        api.glow(SH.kitById('paragon').colors.accent, 20, g, 43, 0, 0);
      }
    },
    animate: function (m, f, p) {
      if (m.backGrp && m.backGrp.userData.wings) {
        var w = m.backGrp.userData.wings;
        var flap = Math.sin(p.t * 5) * 0.2;
        var op = U.ease(U.clamp((f.anim && f.anim.wing) || 0, 0, 1));
        for (var i = 0; i < w.length; i++) {
          w[i].rotation.z = 0.5 + flap;
          w[i].scale.setScalar(0.2 + op * 0.8);
        }
      }
    }
  };

  /* =====================================================================
   * DOMINUS — cowl with no face, ragged cape, twin shadow blades
   * =================================================================== */
  S3.dominus = {
    build: {
      scale: 1.04, hip: 55, sho: 89, head: 102,
      chest: 18.5, shoW: 29, hipZ: 6.8, shoZ: 11.5,
      thigh: 27, shin: 26, upper: 22, fore: 20,
      legR0: 6.9, legR1: 5.5, legR2: 4.7,
      armR0: 5.8, armR1: 4.6, armR2: 4,
      handR: 4.6, footL: 15, bootH: 11
    },
    mats: function (K, inForm, mat) {
      var ac = inForm ? K.formGlow : K.accent;
      var weave = { rough: 0.9, metal: 0.06 };
      return {
        acColor: ac,
        torso: mat('#1d1830', weave), pelvis: mat('#0d0b16', weave), neck: mat('#08060e', weave),
        leg: mat('#241d3a', weave), legFar: mat('#191428', weave),
        arm: mat('#2c2548', weave), armFar: mat('#1f1a33', weave),
        fore: mat('#1b1630', weave), foreFar: mat('#131020', weave),
        glove: mat('#100d1c', { rough: 0.72 }), gloveFar: mat('#0a0812', { rough: 0.72 }),
        boot: mat('#100d1c', { rough: 0.6 }), bootFar: mat('#0a0812', { rough: 0.6 }),
        plate: mat('#302747', { rough: 0.46, metal: 0.42 }),
        strap: mat('#171226', { rough: 0.8 }),
        acc: mat(ac, { em: true, emI: inForm ? 1.5 : 1.0, rough: 0.28 }),
        blade: mat(ac, { em: true, emI: inForm ? 1.3 : 0.85, rough: 0.2, alpha: 0.86 }),
        cape: mat('#1c1630', { rough: 0.94 }), capeIn: mat('#0e0b18', { rough: 0.94 }),
        hood: mat('#241d38', { rough: 0.84 }), hood2: mat('#1a1429', { rough: 0.86 }),
        voidM: mat('#000000', { rough: 1, metal: 0 })
      };
    },
    shoulder: function (g, M, B, near, api) {
      var z = near ? 2.4 : -2.4;
      api.mesh(new api.THREE.SphereGeometry(6.8, 14, 9, 0, PI * 2, 0, PI * 0.56), M.plate, -0.8, 0.4, z, g)
        .scale.set(1, 0.96, 1.18);
      api.mesh(api.box(2, 1.2, 8), M.strap, 1.8, 1.4, z, g);
    },
    leg: function (parts, M, B, near, api) {
      api.mesh(api.box(2, 3.2, 11), M.strap, 12, 1.4, 0, parts.thigh);
      api.mesh(api.prism(14, 5.4, 4.8, 7, 0.4), M.plate, 4, 0.8, 0, parts.shin);
      api.mesh(api.box(1.4, 1.4, 6), M.acc, 6, 5.4, 0, parts.shin);
    },
    head: function (g, M, B, api, inForm) {
      /* a deep cowl: peaked crown, brim thrown forward, nothing but void inside */
      var hood = api.mesh(new api.THREE.SphereGeometry(8.8, 16, 12), M.hood, -1, 0.4, 0, g);
      hood.scale.set(1.04, 1.16, 1.02);
      var peak = api.mesh(new api.THREE.ConeGeometry(5.0, 11, 8), M.hood, -2.6, 3.4, 0, g);
      peak.rotation.z = 2.95;
      peak.scale.set(1, 1, 0.8);
      var brim = api.mesh(new api.THREE.ConeGeometry(9.2, 13.5, 14, 1, true), M.hood2, 2.6, 1.2, 0, g);
      brim.rotation.z = -1.98;
      brim.material.side = api.THREE.DoubleSide;
      api.mesh(api.box(5, 14.5, 12), M.voidM, 6, -1.2, 0, g);                     // the void
      for (var s = -1; s <= 1; s += 2) {
        api.mesh(api.box(1.1, 1.7, 2.4), M.acc, 8.2, 1.2, s * 2.8, g);
        api.glow(M.acColor, 9, g, 8.8, 1.2, s * 2.8);
      }
      /* shoulder-mantle folds hanging off the cowl */
      for (var i = 0; i < 3; i++) {
        var f = api.mesh(api.box(9, 2.2, 5.4), M.hood2, -3 - i * 0.6, -7.5, (i - 1) * 5.2, g);
        f.rotation.z = -1.15 - i * 0.06;
      }
    },
    torsoArt: function (g, M, B, api, inForm, th) {
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.5, B.chest * 0.6, th * 0.44, 14, 1, false, -PI * 0.1, PI * 1.2),
        M.plate, 0, th * 0.64, 0, g).scale.set(1.04, 1, B.shoW / B.chest * 0.92);
      /* crossed harness straps */
      for (var s = -1; s <= 1; s += 2) {
        var st = api.mesh(api.box(1.8, 30, 4.4), M.strap, B.chest * 0.48, th * 0.52, 0, g);
        st.rotation.z = s * 0.62;
      }
      api.mesh(api.box(1.6, 12, 2.6), M.acc, B.chest * 0.52, th * 0.56, 0, g).rotation.z = 0.5;
      api.glow(M.acColor, 15, g, B.chest * 0.56, th * 0.56, 0);
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.46, B.chest * 0.52, 11, 14).scale(1, 1, B.shoW / B.chest * 0.86),
        M.hood, -1, th - 2, 0, g);                                                // collar
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.52, B.chest * 0.52, 6, 14).scale(1, 1, B.shoW / B.chest * 0.9),
        M.strap, 0, 5, 0, g);
    },
    back: function (g, M, B, api) {
      var root = api.grp(g, -B.chest * 0.44, B.sho - B.hip + 1, 0);
      var segs = chain(api, root, 5, { len: 17, thick: 1.9, wide: B.shoW * 0.82, taper: 0.76, mat: M.cape, hem: M.capeIn, shadow: false });
      g.userData.segs = segs;
      api.mesh(api.prism(6, 4, 2.6, 6, 0.4).scale(1, 1, 2.8), M.plate, -1, 2, 0, root);
      /* torn hem */
      g.userData.tail = [];
      for (var i = 0; i < 5; i++) {
        var t = api.grp(segs.tip, 0, 0, (i - 2) * (B.shoW * 0.17));
        var m = api.mesh(api.box(15 - Math.abs(i - 2) * 4.5, 1.8, B.shoW * 0.16), M.cape, -7, 0, 0, t);
        m.castShadow = false;
        g.userData.tail.push(t);
      }
    },
    weapon: function (g, M, B, api) { dagger(g, M, B, api, true); },
    weaponOff: function (g, M, B, api) { dagger(g, M, B, api, false); },
    animate: function (m, f, p) {
      var ud = m.backGrp && m.backGrp.userData;
      if (!ud) return;
      swayChain(ud.segs, 1.34, p.t, f, { rate: 2.6, amp: 0.11, lift: 1.05, yaw: 0.09, follow: 0.1 });
      if (ud.tail) {
        for (var i = 0; i < ud.tail.length; i++) {
          ud.tail[i].rotation.z = 0.12 + Math.sin(p.t * 3.6 + i * 1.2) * 0.2;
          ud.tail[i].rotation.y = Math.sin(p.t * 2.7 + i) * 0.13;
        }
      }
    }
  };
  function dagger(g, M, B, api, near) {
    g.position.x = B.handR * 0.9;
    g.rotation.z = near ? -0.5 : -0.42;
    api.mesh(api.prism(11, 2.2, 1.8, 6, 0.4), M.plate, -3, 0, 0, g);
    api.mesh(api.box(1.8, 7, 3), M.strap, 6, 0, 0, g);
    var blade = api.mesh(api.prism(28, 3.2, 0.5, 4, PI / 4).scale(1, 1.35, 0.34), M.blade, 7, 0, 0, g);
    blade.castShadow = false;
    api.glow(M.acColor, 17, g, 18, 0, 0);
  }

  /* =====================================================================
   * VITALITY — amber constructs, face plate, long hair
   * =================================================================== */
  S3.vitality = {
    build: {
      scale: 0.99, hip: 54, sho: 86, head: 100,
      chest: 17.5, shoW: 27, hipZ: 6.6, shoZ: 10.6,
      thigh: 27, shin: 26, upper: 22, fore: 20,
      legR0: 6.9, legR1: 5.3, legR2: 4.6,
      armR0: 5.5, armR1: 4.4, armR2: 3.8,
      handR: 4.5, footL: 15, bootH: 10
    },
    mats: function (K, inForm, mat) {
      var suit = { rough: 0.84, metal: 0.08 };
      var amber = { rough: 0.14, metal: 0.28 };
      return {
        acColor: K.accent,
        torso: mat('#2b2431', suit), pelvis: mat('#1b1722', suit), neck: mat('#221d29', suit),
        leg: mat('#352d3d', suit), legFar: mat('#251f2c', suit),
        knee: mat(K.accent, amber),
        arm: mat('#443a4d', suit), armFar: mat('#312a38', suit),
        fore: mat('#2b2433', suit), foreFar: mat('#1f1a26', suit),
        glove: mat('#1b1722', { rough: 0.72 }), gloveFar: mat('#141018', { rough: 0.72 }),
        boot: mat('#1b1722', { rough: 0.6 }), bootFar: mat('#141018', { rough: 0.6 }),
        suit: mat('#332b3b', suit), plate: mat('#4a3826', { rough: 0.5, metal: 0.34 }),
        amber: mat(K.accent, amber),
        amberD: mat('#b47a1c', amber),
        amberLit: mat(K.accent, { em: true, emI: inForm ? 1.5 : 0.95, rough: 0.1, metal: 0.15, alpha: 0.94 }),
        hair: mat('#4e3117', { rough: 0.9 }), hair2: mat('#3e2612', { rough: 0.9 }),
        sash: mat('#7d4f1c', { rough: 0.92 })
      };
    },
    shoulder: function (g, M, B, near, api) {
      var z = near ? 2.2 : -2.2;
      api.mesh(new api.THREE.SphereGeometry(6.6, 14, 9, 0, PI * 2, 0, PI * 0.54), M.suit, -0.8, 0.4, z, g)
        .scale.set(1, 0.94, 1.16);
      /* amber crystals growing out of the pauldron */
      for (var i = 0; i < 3; i++) {
        var a = -0.55 + i * 0.62;
        var c = shard(api, M.amber, 4.6 - i * 0.7, 1.9 - i * 0.24, g,
          -1 + Math.cos(a) * 4.4, 2.4 + Math.sin(a) * 4.4, z * 1.15);
        c.rotation.z = a - PI / 2;
      }
      api.glow(M.acColor, 12, g, -1, 5, z);
    },
    leg: function (parts, M, B, near, api) {
      api.mesh(api.box(1.6, 12, 8.4), M.amberD, 12, 1.4, 0, parts.thigh);
      api.mesh(api.sphere(5.7, 12), M.amber, 0, 0.4, 0, parts.shin);
      api.mesh(api.prism(14, 5.2, 4.4, 7, 0.4), M.suit, 4, 0.8, 0, parts.shin);
      shard(api, M.amber, 5.4, 1.5, parts.shin, 9, 4.4, 0).rotation.z = -0.4;
    },
    head: function (g, M, B, api, inForm) {
      api.mesh(new api.THREE.CapsuleGeometry(6.2, 5, 5, 16), M.suit, 0.8, 0.4, 0, g).scale.set(1, 1, 0.95);
      /* hair frames the face */
      var cap = api.mesh(new api.THREE.SphereGeometry(7.3, 16, 11, 0, PI * 2, 0, PI * 0.7), M.hair, -1.2, 1.8, 0, g);
      cap.scale.set(1.14, 1.06, 1.08);
      for (var s = -1; s <= 1; s += 2) {
        var fr = api.mesh(api.prism(15, 2.5, 1.5, 5, 0.4).scale(1, 1, 1.45), M.hair2, 0.6, 4.2, s * 5.8, g);
        fr.rotation.z = -1.42;
        fr.rotation.x = -s * 0.14;
      }
      /* the mask: a smooth amber plate covering just the face */
      var plate = api.mesh(new api.THREE.SphereGeometry(6.2, 18, 14, PI * 0.7, PI * 0.6, PI * 0.32, PI * 0.44),
        M.amber, 1.5, 0.4, 0, g);
      plate.scale.set(1.14, 1.2, 0.96);
      api.mesh(api.box(1.2, 1.5, 7.6), M.amberLit, 6.9, 2.2, 0, g);              // brow line
      for (var e = -1; e <= 1; e += 2) {
        api.mesh(api.box(0.9, 1.5, 2.7), M.amberLit, 6.8, 0.3, e * 2.6, g);
      }
      api.glow(M.acColor, inForm ? 20 : 13, g, 7.4, 1, 0);
    },
    torsoArt: function (g, M, B, api, inForm, th) {
      var cy = th * 0.66;
      /* shaped breastplate rather than a slab */
      var bp = api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.5, B.chest * 0.58, th * 0.3, 16, 1, false, PI * 0.06, PI * 0.88),
        M.amberD, 0, cy + 2, 0, g);
      bp.scale.set(1.08, 1, B.shoW / B.chest * 0.94);
      /* segmented amber abdomen below it */
      for (var q = 0; q < 3; q++) {
        api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.56, B.chest * 0.5, 4.4, 14, 1, false, PI * 0.12, PI * 0.76),
          q % 2 ? M.amber : M.amberD, 0, th * 0.34 - q * 5.4, 0, g).scale.set(1.05, 1, B.shoW / B.chest * 0.9);
      }
      /* focus crystal in a raised mount */
      api.mesh(new api.THREE.OctahedronGeometry(5.6, 0), M.plate, B.chest * 0.5, cy + 1, 0, g).scale.set(0.34, 1, 0.86);
      shard(api, M.amberLit, 4.6, 2.5, g, B.chest * 0.58, cy + 1, 0);
      api.glow(M.acColor, inForm ? 26 : 16, g, B.chest * 0.62, cy + 1, 0);
      /* crystal growth spreading over the collar */
      for (var i = 0; i < 4; i++) {
        var a2 = -1.1 + i * 0.72;
        shard(api, M.amber, 3.4, 1.3, g, B.chest * 0.42 * Math.cos(a2 * 0.5), th - 2, Math.sin(a2) * B.shoW * 0.42)
          .rotation.z = -0.5;
      }
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.44, B.chest * 0.5, 9, 14).scale(1, 1, B.shoW / B.chest * 0.82),
        M.suit, 0, th - 1, 0, g);
      api.mesh(new api.THREE.CylinderGeometry(B.chest * 0.52, B.chest * 0.52, 6, 14).scale(1, 1, B.shoW / B.chest * 0.9),
        M.plate, 0, 5, 0, g);
    },
    back: function (g, M, B, api) {
      g.userData.strands = [];
      var zs = [0, 4.6, -4.6, 2.2, -2.2];
      for (var i = 0; i < 5; i++) {
        var root = api.grp(g, -3.6, B.head - B.hip - 2 - (i > 2 ? 2 : 0), zs[i]);
        g.userData.strands.push(chain(api, root, 4, {
          len: 15 - i * 0.9, thick: 4.6 - i * 0.5, wide: 6.4 - i * 0.8,
          mat: i % 2 ? M.hair2 : M.hair, taper: true
        }));
      }
      var sash = api.grp(g, -B.chest * 0.3, -2, 6.5);
      var sm = api.mesh(api.box(1.8, 30, 5.5), M.sash, 0, -15, 0, sash);
      sm.castShadow = false;
      g.userData.sash = sash;
    },
    extras: function (m, M, B, api, inForm) {
      m.shards = [];
      var n = inForm ? 6 : 4;
      for (var i = 0; i < n; i++) {
        var s = shard(api, M.amberLit, 3.6, 1.5, m.torso, 0, 0, 0);
        s.castShadow = false;
        m.shards.push(s);
      }
    },
    weapon: function (g, M, B, api) {
      g.position.x = B.handR;
      g.rotation.z = -0.15;
      var blade = shard(api, M.amberLit, 21, 3.4, g, 20, 0, 0);
      blade.rotation.z = PI / 2;
      g.userData.blade = blade;
      api.glow(SH.kitById('vitality').colors.accent, 30, g, 22, 0, 0);
    },
    animate: function (m, f, p) {
      var ud = m.backGrp && m.backGrp.userData;
      if (ud && ud.strands) {
        for (var i = 0; i < ud.strands.length; i++) {
          swayChain(ud.strands[i], 1.18, p.t + i * 0.55, f, { rate: 3.8, amp: 0.1, lift: 0.5, yaw: 0.07 });
        }
        ud.sash.rotation.z = -0.08 + Math.sin(p.t * 2.6) * 0.16 - U.clamp(Math.abs(f.vx || 0) / 400, 0, 1) * 0.5;
      }
      if (m.shards) {
        var th = m.B.sho - m.B.hip;
        for (var j = 0; j < m.shards.length; j++) {
          var a = p.t * 1.6 + (j / m.shards.length) * U.TAU;
          m.shards[j].position.set(m.B.chest * 0.5 + Math.cos(a) * 8, th * 0.6 + Math.sin(a * 0.7) * 6, Math.sin(a) * 11);
          m.shards[j].rotation.set(a * 0.8, a, a * 1.3);
        }
      }
      if (m.weaponGrp && m.weaponGrp.userData.blade) m.weaponGrp.visible = p.swing >= 0;
    }
  };
  /* =====================================================================
   * DEATHBRINGER — pitch-black ent, burning eyes, dripping mucus
   * =================================================================== */
  S3.deathbringer = {
    build: function (mat, api) {
      var T = api.THREE;
      var bark = mat('#1b1726', { rough: 0.95, metal: 0.04, flat: true });
      var bark2 = mat('#120f1b', { rough: 0.96, flat: true });
      var bark3 = mat('#0a0812', { rough: 1, flat: true });
      var barkLit = mat('#2e2036', { rough: 0.88, flat: true });
      var eye = mat('#ff8a22', { em: true, emI: 2.6, rough: 0.3 });
      var ember = mat('#d2450a', { em: '#ff7010', emI: 1.5, rough: 0.6 });
      var maw = mat('#221008', { rough: 0.85 });
      /* wet and glossy: near-black, but it catches the light like tar */
      var mucus = mat('#0b0f0d', { rough: 0.05, metal: 0.3 });
      var mucusD = mat('#070a09', { rough: 0.07, metal: 0.26 });

      var root = new T.Group();
      var m = { root: root, mats: { bark: bark, eye: eye, mucus: mucus } };
      var body = api.grp(root);
      m.body = body;
      var i, a;

      /* --- root ball + splayed roots he walks on --- */
      for (i = 0; i < 9; i++) {
        var ra = (i / 9) * U.TAU + 0.2;
        var rg = api.grp(body, 0, 76, 0);
        rg.rotation.y = ra;
        rg.rotation.z = -1.1 - (i % 3) * 0.09;
        var rl = 74 + (i % 3) * 10;
        api.mesh(api.cyl(5, 12, rl, 6).rotateZ(-PI / 2).translate(rl / 2, 0, 0), i % 2 ? bark2 : bark, 0, 0, 0, rg);
        var tip = api.grp(rg, rl, 0, 0);
        tip.rotation.z = 0.98;
        api.mesh(api.cyl(2.2, 5, 28, 5).rotateZ(-PI / 2).translate(14, 0, 0), bark2, 0, 0, 0, tip);
      }
      api.mesh(new T.SphereGeometry(30, 12, 8), bark2, 0, 78, 0, body).scale.set(1.2, 0.8, 1.2);

      /* --- trunk: stacked, slightly offset sections so it isn't a cone --- */
      api.mesh(new T.CylinderGeometry(38, 33, 62, 9), bark, 0, 104, 0, body);
      api.mesh(new T.CylinderGeometry(41, 37, 46, 9), bark, 1, 156, 0, body);
      api.mesh(new T.CylinderGeometry(27, 40, 44, 9), bark2, 0, 194, 0, body);
      /* bark ridges running up the trunk */
      for (i = 0; i < 11; i++) {
        a = (i / 11) * U.TAU;
        var rd = api.grp(body, 0, 96, 0);
        rd.rotation.y = a;
        var rh = 80 + (i % 4) * 22;
        var rib = api.mesh(api.box(7, rh, 5 + (i % 3) * 2), i % 3 ? bark2 : barkLit, 36, rh / 2 - 8, 0, rd);
        rib.rotation.z = ((i % 5) - 2) * 0.03;
      }
      /* embers glowing in the cracks */
      for (i = 0; i < 12; i++) {
        a = -1.5 + i * 0.28;
        var er = 37 + (i % 3);
        api.mesh(api.box(2.6, 8 + (i % 4) * 6, 2.6), ember, Math.cos(a) * er, 100 + (i % 5) * 17, Math.sin(a) * er, body);
      }
      api.glow('#ff6a10', 90, body, 26, 120, 0);

      /* --- crown of dead branches --- */
      for (i = 0; i < 11; i++) {
        a = (i / 11) * U.TAU;
        var bg = api.grp(body, 0, 214, 0);
        bg.rotation.y = a;
        bg.rotation.z = 0.5 + (i % 3) * 0.16;
        var L = 50 + (i % 4) * 14;
        api.mesh(api.cyl(3.2, 7, L, 5).rotateZ(-PI / 2).translate(L / 2, 0, 0), bark3, 0, 0, 0, bg);
        var t2 = api.grp(bg, L, 0, 0);
        t2.rotation.z = 0.44;
        t2.rotation.y = ((i % 3) - 1) * 0.3;
        var L2 = 26 + (i % 3) * 9;
        api.mesh(api.cyl(1.2, 3.2, L2, 4).rotateZ(-PI / 2).translate(L2 / 2, 0, 0), bark3, 0, 0, 0, t2);
        var t3 = api.grp(t2, L2, 0, 0);
        t3.rotation.z = -0.7;
        api.mesh(api.cyl(0.6, 1.6, 18, 4).rotateZ(-PI / 2).translate(9, 0, 0), bark3, 0, 0, 0, t3);
      }

      /* --- shoulder mass + arms --- */
      m.arms = [];
      for (i = 0; i < 2; i++) {
        var near = i === 1;
        api.mesh(new T.SphereGeometry(20, 10, 7), near ? bark : bark2, 4, 168, near ? 28 : -28, body).scale.set(1, 0.85, 1);
        var sh = api.grp(body, 6, 166, near ? 30 : -30);
        var up = api.grp(sh);
        api.mesh(api.cyl(10, 14, 62, 6).rotateZ(-PI / 2).translate(31, 0, 0), near ? bark : bark2, 0, 0, 0, up);
        api.mesh(api.box(6, 26, 7), near ? barkLit : bark3, 28, 11, 0, up);
        var fo = api.grp(up, 62, 0, 0);
        api.mesh(api.cyl(6, 10, 56, 6).rotateZ(-PI / 2).translate(28, 0, 0), near ? bark2 : bark3, 0, 0, 0, fo);
        var hand = api.grp(fo, 56, 0, 0);
        for (var c = 0; c < 5; c++) {
          var cl = api.mesh(api.cyl(0.7, 3.2, 24 + (c % 2) * 6, 4).rotateZ(-PI / 2).translate(13, 0, 0), bark3, 0, 0, 0, hand);
          cl.rotation.z = -(c - 2) * 0.28;
          cl.rotation.y = (c - 2) * 0.24;
        }
        m.arms.push({ sho: sh, upper: up, fore: fo, hand: hand });
      }

      /* --- face: a hollow cut into the trunk, two coals burning in it --- */
      var face = api.grp(body, 30, 168, 0);
      m.face = face;
      api.mesh(api.box(9, 44, 40), maw, 1, 0, 0, face);                         // the hollow
      api.mesh(api.prism(11, 22, 15, 5, 0.4).scale(1, 1, 1.5), bark2, -2, 14, 0, face)
        .rotation.z = -0.42;                                                    // heavy brow ledge
      api.mesh(api.prism(9, 18, 13, 5, 0.4).scale(1, 1, 1.4), bark2, -1, -15, 0, face)
        .rotation.z = 0.5;                                                      // jaw ledge
      for (var s = -1; s <= 1; s += 2) {
        var socket = api.mesh(api.box(4, 12, 15), bark3, 5.4, 6, s * 9, face);
        socket.rotation.z = s * 0;
        api.mesh(api.box(3.4, 7.5, 11), eye, 6.6, 6, s * 9, face);
        api.mesh(api.box(7, 4.4, 17), bark3, 4.6, 13.5, s * 4, face).rotation.z = s * 0.22;
      }
      m.eyeGlowA = api.glow('#ff8a22', 40, face, 9, 6, 9);
      m.eyeGlowB = api.glow('#ff8a22', 40, face, 9, 6, -9);
      for (var mm2 = 0; mm2 < 9; mm2++) {
        var up2 = mm2 % 2 === 0;
        var tooth = api.mesh(new T.ConeGeometry(2.6, 12, 3), maw, 5.2, up2 ? -6 : -17, -20 + mm2 * 5, face);
        tooth.rotation.z = up2 ? 1.3 : -1.3;
      }

      /* --- mucus: glossy sheets clinging to him, with falling drops --- */
      m.drips = [];
      for (i = 0; i < 14; i++) {
        var ma = (i / 14) * U.TAU;
        var mg = api.grp(body, 0, 176 - (i % 4) * 22, 0);
        mg.rotation.y = ma;
        var ml = 30 + ((i * 53) % 46);
        var rad = 30 + (i % 3) * 6;
        var sheet = api.mesh(api.cyl(2.6, 6.5, ml, 6).translate(0, -ml / 2, 0), i % 2 ? mucus : mucusD, rad, 0, 0, mg);
        sheet.castShadow = false;
        var drop = api.mesh(new T.SphereGeometry(3.4, 10, 8), mucus, rad, -ml, 0, mg);
        drop.castShadow = false;
        m.drips.push({ g: mg, drop: drop, len: ml });
      }
      /* the sheet running over the shoulders */
      api.mesh(new T.SphereGeometry(44, 16, 9, 0, U.TAU, 0, PI * 0.28), mucus, 1, 150, 0, body).scale.set(1, 1.15, 1);
      /* pool at his feet */
      api.mesh(new T.CylinderGeometry(56, 60, 5, 20), mucusD, 0, 3, 0, body).receiveShadow = true;

      m.pose = function (mo, f) {
        var t = (typeof f.anim === 'number') ? f.anim : ((f.anim && f.anim.t) || 0);
        var dir = Math.cos(f.facing) >= 0 ? 1 : -1;
        var rage = f.enraged ? 1 : 0;
        var lunging = f.state === 'lunge', winding = f.state === 'wind';
        mo.root.position.set(f.x, f.z, 0);
        mo.root.rotation.y = dir > 0 ? -0.44 : PI + 0.44;
        if (f.ko) {
          f.koT = (f.koT || 0) + 0.016;
          mo.body.rotation.z = U.ease(U.clamp(f.koT, 0, 1)) * 0.55;
        } else {
          mo.body.rotation.z = Math.sin(t * 0.9) * 0.03;
          mo.body.rotation.y = Math.sin(t * 0.6) * 0.04;
        }
        var reach = lunging ? 1 : (winding ? 0.55 : 0);
        for (var i = 0; i < 2; i++) {
          var arm = mo.arms[i];
          arm.upper.rotation.z = -(U.lerp(i ? 0.5 : 0.64, -0.32, reach) + Math.sin(t * 1.05 + i) * 0.05);
          arm.fore.rotation.z = -U.lerp(0.88, 0.1, reach);
          arm.hand.rotation.z = Math.sin(t * 1.7 + i * 2) * 0.12;
        }
        var pulse = 0.42 + Math.sin(t * 3) * 0.1 + rage * 0.2;
        var gs = (28 + rage * 12) * (lunging || winding ? 1.35 : 1);
        mo.eyeGlowA.scale.set(gs, gs, 1);
        mo.eyeGlowB.scale.set(gs, gs, 1);
        mo.eyeGlowA.material.opacity = pulse;
        mo.eyeGlowB.material.opacity = pulse;
        mo.mats.eye.emissiveIntensity = 1.9 + rage * 1.1 + Math.sin(t * 3) * 0.25;
        for (var d = 0; d < mo.drips.length; d++) {
          var dr = mo.drips[d];
          var ph = (t * 0.55 + d * 0.31) % 1;
          dr.drop.position.y = -dr.len - ph * 40;
          dr.drop.scale.setScalar(1 - ph * 0.55);
        }
      };
      return m;
    }
  };
})();
