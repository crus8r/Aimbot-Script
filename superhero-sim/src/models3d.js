/* VANGUARD — models3d.js
 * Low-poly 3D fighters for Versus mode, assembled from primitives and posed
 * with the same joint angles the 2D rig used.
 *
 * Axes per fighter: +X is forward (facing), +Y up, +Z is the character's
 * left-right axis (so shoulders span Z, chest depth spans X).
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var G = SH.g3;
  var M3 = (SH.models3 = {});

  function lighten(hex, amt) {
    var c = G.rgb(hex);
    var f = function (v) { return U.clamp(Math.round(v + amt * 255), 0, 255); };
    return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
  }

  /* Materials are rebuilt only when the hero or form state changes. */
  var matCache = {};
  function mats(id, K, inForm) {
    var key = id + (inForm ? '#f' : '');
    var m = matCache[key];
    if (m) return m;
    m = matCache[key] = SPEC[id].mats(K, inForm);
    return m;
  }

  /* =====================================================================
   * SHARED HUMANOID
   * =================================================================== */
  function humanoid(f, p, K, inForm) {
    var spec = SPEC[f.kitId];
    var B = spec.build;
    var Mt = mats(f.kitId, K, inForm);

    var fall = p.fall !== undefined ? -p.fall : 0;
    if (fall) { G.tx(0, B.hip, 0); G.rz(fall); G.tx(0, -B.hip, 0); }

    /* ---------------- legs ---------------- */
    for (var s = 0; s < 2; s++) {
      var near = s === 1;
      var z = near ? B.hipZ : -B.hipZ;
      var a = near ? p.legF : p.legB;
      var lm = near ? Mt.leg : Mt.legFar;
      var bm = near ? Mt.boot : Mt.bootFar;
      G.push();
      G.tx(0, B.hip, z);
      G.bone(a[0], B.thigh, B.legR0, B.legR1, 7, lm);
      if (spec.knee) spec.knee(G, Mt, B, near);
      G.bone(a[1], B.shin, B.legR1 * 0.94, B.legR2, 7, lm);
      if (spec.shin) spec.shin(G, Mt, B, near);
      G.rz(a[0] + a[1]);                     // realign with the world
      G.push();
      G.tx(B.footL * 0.16, -B.bootH * 0.42, 0);
      G.box(B.footL, B.bootH, B.legR2 * 2.25, bm);
      if (spec.foot) spec.foot(G, Mt, B, near);
      G.pop();
      G.pop();
    }

    /* ---------------- upper body ---------------- */
    G.push();
    G.tx(0, B.hip, 0);
    G.rz(p.lean * 0.24);
    G.tx(0, -B.hip, 0);

    if (spec.back) spec.back(G, Mt, B, p, f, inForm);

    // far arm behind the torso
    arm(spec, Mt, B, p.armB, -B.shoZ, false, f, p, inForm);

    // torso — waist tapering out to the chest, then in to the shoulders
    var th = B.sho - B.hip;
    var oval = B.shoW / B.chest;
    G.push();
    G.tx(0.5, B.hip - 2, 0);
    G.rz(Math.PI / 2);
    G.prism(th * 0.58, B.chest * 0.42, B.chest * 0.54, 8, Mt.torso, false, oval);
    G.pop();
    G.push();
    G.tx(0.5, B.hip - 2 + th * 0.58, 0);
    G.rz(Math.PI / 2);
    G.prism(th * 0.5, B.chest * 0.54, B.chest * 0.44, 8, Mt.torso, true, oval * 0.94);
    G.pop();
    G.push();                                  // pelvis
    G.tx(0, B.hip - 5, 0);
    G.rz(Math.PI / 2);
    G.prism(14, B.chest * 0.46, B.chest * 0.42, 8, Mt.pelvis, true, oval * 0.86);
    G.pop();
    if (spec.torso) spec.torso(G, Mt, B, p, f, inForm);

    // neck + head
    G.push();
    G.tx(1, B.sho + 3, 0);
    G.box(7, 9, 8.5, Mt.neck);
    G.pop();
    G.push();
    G.tx(0, B.head, 0);
    G.rz(-p.head - p.lean * 0.12);
    spec.head(G, Mt, B, p, f, inForm);
    G.pop();

    // near arm in front
    arm(spec, Mt, B, p.armF, B.shoZ, true, f, p, inForm);

    if (spec.front) spec.front(G, Mt, B, p, f, inForm);
    G.pop();
  }

  function arm(spec, Mt, B, a, z, near, f, p, inForm) {
    G.push();
    G.tx(1, B.sho - 3, z);
    if (spec.shoulder) spec.shoulder(G, Mt, B, near);
    G.bone(a[0], B.upper, B.armR0, B.armR1, 7, near ? Mt.arm : Mt.armFar);
    if (spec.elbow) spec.elbow(G, Mt, B, near);
    G.bone(a[1], B.fore, B.armR1 * 0.95, B.armR2, 7, near ? Mt.fore : Mt.foreFar);
    // hand
    G.push();
    G.tx(B.handR * 0.6, 0, 0);
    G.box(B.handR * 2.0, B.handR * 1.8, B.handR * 1.6, near ? Mt.glove : Mt.gloveFar);
    G.pop();
    if (spec.weapon) spec.weapon(G, Mt, B, p, f, inForm, near);
    G.pop();
  }

  /* =====================================================================
   * BUILD + ART PER FIGHTER
   * =================================================================== */
  var SPEC = {

    /* ------------------------------------------------------------ SAVIOR */
    savior: {
      build: {
        scale: 1.03, hip: 54, sho: 88, head: 100,
        chest: 21, shoW: 32, hipZ: 7.5, shoZ: 12.5,
        thigh: 27, shin: 26, upper: 22, fore: 20,
        legR0: 7.6, legR1: 6.2, legR2: 5.4,
        armR0: 6.4, armR1: 5.2, armR2: 4.5,
        handR: 5, footL: 17, bootH: 11
      },
      mats: function (K, inForm) {
        return {
          torso: G.mat(K.base), pelvis: G.mat(K.dark), neck: G.mat(K.dark),
          leg: G.mat('#39404d'), legFar: G.mat('#2b313c'),
          arm: G.mat('#39404d'), armFar: G.mat('#2b313c'),
          fore: G.mat(K.base), foreFar: G.mat('#aab4c2'),
          glove: G.mat('#4b5464'), gloveFar: G.mat('#39404d'),
          boot: G.mat(K.base), bootFar: G.mat('#aab4c2'),
          plate: G.mat(K.mid), trim: G.mat(K.accent),
          acc: G.mat(K.accent, { em: 1 }),
          helm: G.mat(K.base), visorDark: G.mat('#171d27'),
          steel: G.mat('#dfe7f2'), cloth: G.mat('#4a5364', { two: 1 })
        };
      },
      knee: function (g, Mt) { g.push(); g.box(10, 9, 12, Mt.helm); g.pop(); },
      shin: function (g, Mt) { g.push(); g.tx(-12, 2, 0); g.box(20, 5.5, 12, Mt.helm); g.pop(); },
      shoulder: function (g, Mt, B, near) {
        g.push();                                  // domed pauldron
        g.tx(-0.5, -3, near ? 2 : -2);
        g.rz(Math.PI / 2);
        g.prism(10, 8.2, 5.2, 7, Mt.helm, true, 1.05);
        g.pop();
        g.push();
        g.tx(2.5, 3.5, near ? 3 : -3);
        g.box(5, 1.8, 9, Mt.trim);
        g.pop();
      },
      elbow: function (g, Mt) { g.push(); g.box(8.5, 8, 10, Mt.plate); g.pop(); },
      back: function (g, Mt, B, p, f) {
        var sway = Math.sin(p.t * 3.2) * 0.1 - (f.vx || 0) * 0.0006;
        g.push();
        g.tx(-B.chest * 0.46, B.hip - 3, 0);
        g.rz(-0.12 + sway);
        g.tx(0, -15, 0);
        g.box(2.2, 30, B.shoW * 0.44, Mt.cloth);
        g.pop();
      },
      torso: function (g, Mt, B, p, f, inForm) {
        var cy = B.hip + (B.sho - B.hip) * 0.66;
        g.push();                                   // chest crystal
        g.tx(B.chest * 0.52, cy, 0);
        g.rz(0.78);
        g.box(9, 9, 5, Mt.acc);
        g.pop();
        g.glow(B.chest * 0.55, cy, 0, 15, K_ACCENT(f), inForm ? 0.7 : 0.4);
        g.push();                                   // belt
        g.tx(0, B.hip + 5, 0);
        g.box(B.chest * 1.02, 5.5, B.shoW * 0.9, Mt.plate);
        g.pop();
      },
      head: function (g, Mt, B, p, f, inForm) {
        g.push();                                   // one solid helm
        g.tx(0.5, -9, 0);
        g.rz(Math.PI / 2);
        g.prism(19, 8.4, 7.6, 8, Mt.helm, true, 0.98);
        g.pop();
        g.push();                                   // faceplate wedge
        g.tx(5.4, -2, 0);
        g.rz(Math.PI / 2);
        g.prism(13, 5.4, 3.4, 5, Mt.plate, true, 1.35);
        g.pop();
        g.push();                                   // visor band
        g.tx(7.4, 1.4, 0);
        g.box(2.4, 3.6, 12, Mt.acc);
        g.pop();
        g.glow(8.4, 1.4, 0, 13, K_ACCENT(f), inForm ? 0.85 : 0.55);
        g.push();                                   // crest
        g.tx(-1, 10.5, 0);
        g.box(15, 4.5, 2.4, Mt.plate);
        g.pop();
        g.push();
        g.tx(2, 12, 0);
        g.box(8, 2.2, 2.6, Mt.trim);
        g.pop();
      },
      weapon: function (g, Mt, B, p, f, inForm, near) {
        if (!near) return;
        g.push();
        g.tx(B.handR * 0.8, 0, 0);
        g.rz(p.swing >= 0 ? -0.15 : -0.72);
        g.box(4, 4, 4, Mt.plate);                   // pommel
        g.push(); g.tx(7, 0, 0); g.box(13, 3.4, 3.4, Mt.plate); g.pop();
        g.push(); g.tx(15, 0, 0); g.box(3.6, 13, 4.5, Mt.plate); g.pop();
        g.push();                                   // blade
        g.tx(16, 0, 0);
        var bm = Mt.steel; bm.flat = 0.26;
        g.prism(44, 4.6, 1.2, 4, bm);
        bm.flat = 1;
        g.pop();
        g.glow(36, 0, 0, 17, K_ACCENT(f), inForm ? 0.5 : 0.2);
        g.pop();
      }
    },

    /* ------------------------------------------------------------ EXODUS */
    exodus: {
      build: {
        scale: 1.0, hip: 55, sho: 88, head: 100,
        chest: 17.5, shoW: 27, hipZ: 6.6, shoZ: 10.5,
        thigh: 27, shin: 26, upper: 22, fore: 20,
        legR0: 6.6, legR1: 5.3, legR2: 4.6,
        armR0: 5.4, armR1: 4.4, armR2: 3.8,
        handR: 4.4, footL: 16, bootH: 10
      },
      mats: function (K, inForm) {
        var ac = inForm ? K.formGlow : K.accent;
        return {
          torso: G.mat(K.base), pelvis: G.mat('#0e1118'), neck: G.mat('#0e1118'),
          leg: G.mat('#1a1e27'), legFar: G.mat('#12151c'),
          arm: G.mat('#232936'), armFar: G.mat('#171c26'),
          fore: G.mat('#161a23'), foreFar: G.mat('#101319'),
          glove: G.mat('#0f131b'), gloveFar: G.mat('#0a0d13'),
          boot: G.mat('#0e1118'), bootFar: G.mat('#090b10'),
          plate: G.mat('#2c3242'), acc: G.mat(ac, { em: 1 }),
          hair: G.mat(K.hair), hair2: G.mat('#16161d'),
          mask: G.mat('#0a0c12'), ac: ac
        };
      },
      shoulder: function (g, Mt, B, near) {
        g.push(); g.tx(0, 1, near ? 2 : -2); g.sphere(7.6, 7, 4, Mt.plate); g.pop();
      },
      back: function (g, Mt, B, p, f, inForm) {
        var sway = Math.sin(p.t * 6) * 0.12 - (f.vx || 0) * 0.0009;
        g.push();
        g.tx(-5, B.head - 5, 0);
        g.rz(0.95 + sway);
        g.push(); g.tx(-9, 0, 0); g.box(20, 12, 13, Mt.hair); g.pop();
        g.rz(0.14);
        g.push(); g.tx(-27, 0, 0); g.box(17, 9, 10, Mt.hair2); g.pop();
        g.rz(0.12);
        g.push(); g.tx(-42, 0, 0); g.box(14, 7, 7, Mt.hair); g.pop();
        g.pop();
      },
      torso: function (g, Mt, B, p, f, inForm) {
        var mid = B.hip + (B.sho - B.hip) * 0.5;
        g.push(); g.tx(B.chest * 0.5, mid + 6, 0); g.box(1.6, 20, 3, Mt.acc); g.pop();
        g.push(); g.tx(B.chest * 0.5, mid - 8, 3); g.box(1.6, 3, 12, Mt.acc); g.pop();
        g.glow(B.chest * 0.5, mid, 0, 13, Mt.ac, 0.3);
        g.push();                                    // collar
        g.tx(0, B.sho + 1, 0);
        g.box(B.chest * 0.95, 9, B.shoW * 0.8, Mt.plate);
        g.pop();
        g.push(); g.tx(0, B.hip + 5, 0); g.box(B.chest * 1.05, 6, B.shoW * 0.9, Mt.mask); g.pop();
      },
      head: function (g, Mt, B, p, f, inForm) {
        g.push(); g.tx(-2, 1, 0); g.box(16, 17, 15, Mt.hair); g.pop();     // hair mass
        g.push(); g.tx(2, 0, 0); g.box(13, 15, 13, Mt.mask); g.pop();      // face wrap
        g.push(); g.tx(3, 8, 0); g.box(13, 5, 14, Mt.hair); g.pop();       // fringe
        g.push(); g.tx(6.6, 1.5, 0); g.box(4, 5, 14.5, Mt.mask); g.pop();  // goggle band
        g.push(); g.tx(8.4, 1.8, 3.4); g.box(1.8, 3.2, 5, Mt.acc); g.pop();
        g.push(); g.tx(8.4, 1.8, -3.4); g.box(1.8, 3.2, 5, Mt.acc); g.pop();
        g.glow(9.5, 1.8, 0, 8, Mt.ac, 0.7);
        g.push(); g.tx(6.2, -6, 0); g.box(6, 7, 11, Mt.mask); g.pop();     // lower mask
      },
      weapon: function (g, Mt, B, p, f, inForm, near) {
        var lash = (p.swing >= 0 && near) ? p.swing : -1;
        g.push();
        g.tx(B.handR * 0.9, 0, 0);
        g.box(9, 4, 4, Mt.plate);
        var len = lash >= 0 ? 15 : 5.5;
        var segs = lash >= 0 ? 7 : 4;
        g.rz(lash >= 0 ? U.lerp(1.5, -0.4, U.ease(lash)) : (near ? 0.5 : 0.8));
        for (var i = 0; i < segs; i++) {
          g.tx(len, 0, 0);
          g.rz(Math.sin(p.t * 14 + i * 1.1 + (near ? 0 : 2)) * (lash >= 0 ? 0.2 : 0.34));
          g.push();
          g.box(len, 2.6 - i * 0.2, 2.6 - i * 0.2, Mt.acc);
          g.pop();
        }
        if (lash >= 0) g.glow(len, 0, 0, 16, Mt.ac, 0.7);
        else g.glow(0, 0, 0, 9, Mt.ac, 0.35);
        g.pop();
      }
    },

    /* ----------------------------------------------------------- PARAGON */
    paragon: {
      build: {
        scale: 1.1, hip: 54, sho: 88, head: 100,
        chest: 24, shoW: 38, hipZ: 8.5, shoZ: 15,
        thigh: 27, shin: 26, upper: 22, fore: 20,
        legR0: 8.8, legR1: 7, legR2: 6,
        armR0: 7.6, armR1: 6, armR2: 5.2,
        handR: 5.8, footL: 19, bootH: 14
      },
      mats: function (K, inForm) {
        return {
          torso: G.mat(K.base), pelvis: G.mat(K.dark), neck: G.mat('#e8b98c'),
          leg: G.mat(K.mid), legFar: G.mat('#153a7c'),
          arm: G.mat(K.base), armFar: G.mat('#245bbb'),
          fore: G.mat(K.accent), foreFar: G.mat('#d9b558'),
          glove: G.mat(K.accent), gloveFar: G.mat('#d9b558'),
          boot: G.mat(K.accent), bootFar: G.mat('#d9b558'),
          plate: G.mat(K.mid), gold: G.mat(K.accent), goldDim: G.mat('#c99f4c'),
          acc: G.mat(K.accent, { em: 1 }),
          skin: G.mat('#f0c9a0'), hair: G.mat(K.hair),
          mask: G.mat(K.base), eye: G.mat('#12305f'),
          wood: G.mat('#5c3d29'), steel: G.mat('#28324a'),
          wing: G.mat(K.formGlow, { em: 1, two: 1, alpha: 0.34 }),
          spear: G.mat('#fff8e2', { em: 1 })
        };
      },
      knee: function (g, Mt) { g.push(); g.box(11, 10, 13, Mt.gold); g.pop(); },
      elbow: function (g, Mt) { g.push(); g.box(9, 9, 11, Mt.plate); g.pop(); },
      shoulder: function (g, Mt, B, near) {
        g.push();
        g.tx(-1, 3, near ? 4 : -4);
        g.sc(1, 0.8, 1);
        g.sphere(13, 8, 4, Mt.gold);
        g.pop();
        g.push(); g.tx(0, 10, near ? 5 : -5); g.box(18, 3.4, 14, Mt.goldDim); g.pop();
      },
      back: function (g, Mt, B, p, f, inForm) {
        if (!inForm) return;
        var w = U.ease(U.clamp(f.anim.wing, 0, 1));
        var flap = Math.sin(p.t * 5) * 0.2;
        for (var s = -1; s <= 1; s += 2) {
          g.push();
          g.tx(-8, B.sho - 4, s * 6);
          g.ry(s * 0.5);
          g.rz(0.5 + flap);
          for (var q = 0; q < 3; q++) {
            g.push();
            g.rz(-q * 0.22);
            g.tx(-(46 - q * 8) * w, q * 5, 0);
            g.box((92 - q * 16) * w, 22 - q * 4, 2, Mt.wing);
            g.pop();
          }
          g.pop();
        }
        g.glow(-30, B.sho, 0, 90, '#fff0bd', 0.4);
      },
      torso: function (g, Mt, B, p, f, inForm) {
        var mid = B.hip + (B.sho - B.hip) * 0.62;
        g.push(); g.tx(B.chest * 0.46, mid + 6, 0); g.box(2.6, 8, B.shoW * 0.62, Mt.gold); g.pop();
        g.push();                                    // winged emblem
        g.tx(B.chest * 0.52, mid, 0);
        g.rz(0.78); g.box(10, 10, 4, Mt.acc);
        g.pop();
        g.glow(B.chest * 0.55, mid, 0, 15, '#ffd76a', inForm ? 0.8 : 0.4);
        g.push(); g.tx(0, B.hip + 6, 0); g.box(B.chest * 1.06, 9, B.shoW * 0.94, Mt.plate); g.pop();
        g.push(); g.tx(B.chest * 0.5, B.hip + 6, 0); g.rz(0.78); g.box(7, 7, 4, Mt.gold); g.pop();
      },
      head: function (g, Mt, B, p, f, inForm) {
        g.push(); g.box(15, 17, 14, Mt.skin); g.pop();
        g.push(); g.tx(-1, 9, 0); g.box(16, 6, 15, Mt.hair); g.pop();       // hair
        g.push(); g.tx(-6, 3, 0); g.box(5, 10, 15, Mt.hair); g.pop();
        g.push(); g.tx(6.2, 2.6, 0); g.box(4.4, 7.5, 15.4, Mt.mask); g.pop(); // domino mask
        g.push(); g.tx(8.6, 2.6, 0); g.box(0.9, 1.6, 15, Mt.gold); g.pop();
        g.push(); g.tx(8.7, 2.4, 4.2); g.box(1, 3.4, 5, Mt.eye); g.pop();
        g.push(); g.tx(8.7, 2.4, -4.2); g.box(1, 3.4, 5, Mt.eye); g.pop();
        g.push(); g.tx(0, 9.5, 0); g.box(14, 2.6, 14.4, Mt.gold); g.pop();  // circlet
        if (inForm) g.glow(9, 2.6, 0, 14, '#fff0bd', 0.8);
      },
      weapon: function (g, Mt, B, p, f, inForm, near) {
        if (!near) return;
        g.push();
        g.tx(B.handR, 0, 0);
        g.rz(p.swing >= 0 ? -0.1 : -0.62);
        if (inForm) {
          g.push(); g.tx(-30, 0, 0); g.box(96, 3.6, 3.6, Mt.spear); g.pop();
          g.push(); g.tx(52, 0, 0); g.prism(24, 5.5, 0.6, 4, Mt.spear); g.pop();
          g.glow(40, 0, 0, 70, '#fff0bd', 0.55);
        } else {
          g.push(); g.tx(14, 0, 0); g.box(74, 4.4, 4.4, Mt.wood); g.pop();
          g.push(); g.tx(-20, 0, 0); g.box(7, 5.5, 5.5, Mt.gold); g.pop();
          g.push(); g.tx(56, 0, 0); g.box(22, 26, 20, Mt.steel); g.pop();
          g.push(); g.tx(46, 0, 0); g.box(3, 28, 22, Mt.gold); g.pop();
          g.push(); g.tx(66, 0, 0); g.box(3, 28, 22, Mt.gold); g.pop();
          g.push(); g.tx(70, 0, 0); g.prism(11, 6, 1.4, 4, Mt.goldDim); g.pop();
          g.glow(58, 0, 0, 24, '#ffd76a', 0.24);
        }
        g.pop();
      }
    },

    /* ----------------------------------------------------------- DOMINUS */
    dominus: {
      build: {
        scale: 1.04, hip: 55, sho: 89, head: 100,
        chest: 18, shoW: 28, hipZ: 6.8, shoZ: 11,
        thigh: 27, shin: 26, upper: 22, fore: 20,
        legR0: 6.8, legR1: 5.5, legR2: 4.7,
        armR0: 5.6, armR1: 4.5, armR2: 4,
        handR: 4.6, footL: 16, bootH: 12
      },
      mats: function (K, inForm) {
        var ac = inForm ? K.formGlow : K.accent;
        return {
          torso: G.mat(K.base), pelvis: G.mat('#100d1a'), neck: G.mat('#0c0916'),
          leg: G.mat('#2e2748'), legFar: G.mat('#221c36'),
          arm: G.mat('#39305a'), armFar: G.mat('#2a2242'),
          fore: G.mat('#241d3a'), foreFar: G.mat('#1a1529'),
          glove: G.mat('#120f1e'), gloveFar: G.mat('#0c0916'),
          boot: G.mat('#100d1a'), bootFar: G.mat('#0a0812'),
          plate: G.mat(K.mid), acc: G.mat(ac, { em: 1 }),
          cape: G.mat('#1b1530', { two: 1 }), capeIn: G.mat('#0a0812', { two: 1 }),
          hood: G.mat(K.mid), void: G.mat('#000000'), ac: ac
        };
      },
      shoulder: function (g, Mt, B, near) {
        g.push(); g.tx(0, 1, near ? 2 : -2); g.sphere(7.4, 7, 4, Mt.plate); g.pop();
      },
      back: function (g, Mt, B, p, f, inForm) {
        var sway = Math.sin(p.t * 3.4) * 0.13 - (f.vx || 0) * 0.0012;
        var lift = U.clamp(Math.abs(f.vx || 0) / 320, 0, 1);
        g.push();
        g.tx(-B.chest * 0.42, B.sho + 2, 0);
        // cape in three drooping panels
        g.rz(1.24 + sway - lift * 0.5);
        for (var i = 0; i < 3; i++) {
          g.push();
          g.tx(-17, 0, 0);
          g.box(34, 2.2, B.shoW * (1.02 - i * 0.1), i === 1 ? Mt.capeIn : Mt.cape);
          g.pop();
          g.tx(-33, 0, 0);
          g.rz(0.1);
        }
        g.pop();
        g.push();                                  // collar
        g.tx(-2, B.sho + 6, 0);
        g.box(B.chest * 0.9, 12, B.shoW * 0.86, Mt.hood);
        g.pop();
      },
      torso: function (g, Mt, B, p, f, inForm) {
        var mid = B.hip + (B.sho - B.hip) * 0.5;
        g.push(); g.tx(B.chest * 0.5, mid + 4, 0); g.rz(0.6); g.box(1.6, 16, 3, Mt.acc); g.pop();
        g.glow(B.chest * 0.5, mid, 0, 13, Mt.ac, 0.24);
        g.push(); g.tx(0, B.hip + 5, 0); g.box(B.chest * 1.04, 6, B.shoW * 0.9, Mt.pelvis); g.pop();
      },
      head: function (g, Mt, B, p, f, inForm) {
        g.push();                                  // cowl
        g.tx(-1, 1, 0);
        g.box(17, 19, 16, Mt.hood);
        g.pop();
        g.push(); g.tx(-2, 8, 0); g.rz(2.5); g.prism(14, 7, 1.5, 5, Mt.hood); g.pop();
        g.push();                                  // brim
        g.tx(8, 4, 0);
        g.rz(-0.5);
        g.box(11, 4, 15, Mt.hood);
        g.pop();
        g.push();                                  // the void
        g.tx(7.4, -1, 0);
        g.box(4, 13, 11, Mt.void);
        g.pop();
        g.push(); g.tx(9.2, 1.4, 2.6); g.box(1.2, 1.8, 2.6, Mt.acc); g.pop();
        g.push(); g.tx(9.2, 1.4, -2.6); g.box(1.2, 1.8, 2.6, Mt.acc); g.pop();
        g.glow(10, 1, 0, 8, Mt.ac, 0.55);
      },
      weapon: function (g, Mt, B, p, f, inForm, near) {
        g.push();
        g.tx(B.handR * 0.9, 0, 0);
        g.rz(near ? (p.swing >= 0 ? -0.05 : -0.4) : -0.35);
        g.box(10, 3.6, 3.6, Mt.plate);
        g.push();
        g.tx(20, 1.5, 0);
        g.rz(-0.12);
        var bm = Mt.acc;
        g.prism(26, 3.4, 0.8, 4, bm);
        g.pop();
        g.glow(24, 0, 0, 13, Mt.ac, 0.45);
        g.pop();
      }
    },

    /* ---------------------------------------------------------- VITALITY */
    vitality: {
      build: {
        scale: 0.99, hip: 54, sho: 86, head: 100,
        chest: 17, shoW: 26, hipZ: 6.6, shoZ: 10,
        thigh: 27, shin: 26, upper: 22, fore: 20,
        legR0: 6.9, legR1: 5.4, legR2: 4.7,
        armR0: 5.3, armR1: 4.3, armR2: 3.8,
        handR: 4.4, footL: 16, bootH: 12
      },
      mats: function (K, inForm) {
        return {
          torso: G.mat('#2a2430'), pelvis: G.mat('#1d1822'), neck: G.mat('#1d1822'),
          leg: G.mat('#2a2430'), legFar: G.mat('#1e1a24'),
          arm: G.mat('#3a3040'), armFar: G.mat('#2a2430'),
          fore: G.mat('#241e2b'), foreFar: G.mat('#1a1620'),
          glove: G.mat('#1d1822'), gloveFar: G.mat('#141119'),
          boot: G.mat('#1d1822'), bootFar: G.mat('#141119'),
          plate: G.mat('#4a3a2a'),
          amber: G.mat(K.accent), amberLit: G.mat(K.accent, { em: 1 }),
          hair: G.mat('#54351d'), hair2: G.mat('#432a17'),
          sash: G.mat('#8a5a20', { two: 1 })
        };
      },
      knee: function (g, Mt) { g.push(); g.box(8, 7, 10, Mt.amber); g.pop(); },
      shoulder: function (g, Mt, B, near) {
        g.push(); g.tx(0, 1, near ? 2 : -2); g.sphere(7.2, 7, 4, Mt.plate); g.pop();
        for (var i = 0; i < 3; i++) {
          g.push();
          g.tx(0, 3, near ? 3.5 : -3.5);
          g.rz(0.9 + i * 0.5);
          g.tx(5, 0, 0);
          g.prism(7, 2.4, 0.5, 4, Mt.amber);
          g.pop();
        }
      },
      back: function (g, Mt, B, p, f) {
        var sway = Math.sin(p.t * 4.4) * 0.1 - (f.vx || 0) * 0.0008;
        g.push();
        g.tx(-4, B.head - 2, 0);
        g.rz(1.0 + sway);
        g.push(); g.tx(-9, 0, 0); g.box(19, 11, 12, Mt.hair); g.pop();
        g.rz(0.12);
        g.push(); g.tx(-26, 0, 0); g.box(16, 8.5, 9, Mt.hair2); g.pop();
        g.rz(0.1);
        g.push(); g.tx(-40, 0, 0); g.box(13, 6, 6.5, Mt.hair); g.pop();
        g.pop();
        g.push();                                    // sash
        g.tx(-B.chest * 0.4, B.hip - 6, 3);
        g.rz(-0.16 + sway);
        g.tx(0, -18, 0);
        g.box(2, 38, 9, Mt.sash);
        g.pop();
      },
      torso: function (g, Mt, B, p, f, inForm) {
        var mid = B.hip + (B.sho - B.hip) * 0.58;
        g.push();                                    // amber breastplate
        g.tx(B.chest * 0.44, mid + 2, 0);
        g.box(4, 24, B.shoW * 0.66, Mt.amber);
        g.pop();
        g.push(); g.tx(B.chest * 0.5, mid + 8, 0); g.rz(0.78); g.box(7, 7, 4, Mt.amberLit); g.pop();
        g.glow(B.chest * 0.5, mid + 4, 0, 14, K_ACCENT(f), inForm ? 0.6 : 0.34);
        g.push(); g.tx(0, B.hip + 5, 0); g.box(B.chest * 1.04, 7, B.shoW * 0.92, Mt.plate); g.pop();
      },
      head: function (g, Mt, B, p, f, inForm) {
        g.push(); g.tx(-3, 1, 0); g.box(15, 17, 15, Mt.hair); g.pop();
        g.push(); g.tx(1, 0, 0); g.box(12, 15, 12.5, Mt.torso); g.pop();
        g.push(); g.tx(6.4, 0, 0); g.box(3.6, 15, 12, Mt.amber); g.pop();     // face plate
        g.push(); g.tx(8.3, 2.6, 0); g.box(0.9, 2.4, 8, Mt.amberLit); g.pop();
        g.push(); g.tx(0, 9, 0); g.box(14, 5, 14, Mt.hair); g.pop();
        g.glow(9, 1, 0, 11, K_ACCENT(f), inForm ? 0.7 : 0.42);
      },
      front: function (g, Mt, B, p, f, inForm) {
        var n = inForm ? 5 : 3;
        var mid = B.hip + (B.sho - B.hip) * 0.55;
        for (var i = 0; i < n; i++) {
          var a = p.t * 2 + (i / n) * U.TAU;
          g.push();
          g.tx(B.chest * 0.5 + Math.cos(a) * 14, mid + Math.sin(a) * 12, Math.sin(a * 1.3) * 12);
          g.rz(a * 1.4);
          g.box(3.4, 7, 3.4, Mt.amberLit);
          g.pop();
        }
      },
      weapon: function (g, Mt, B, p, f, inForm, near) {
        if (!near || p.swing < 0) return;
        g.push();
        g.tx(B.handR, 0, 0);
        g.rz(-0.15);
        var bm = Mt.amberLit;
        g.prism(40, 5, 1, 4, bm);
        g.glow(24, 0, 0, 20, K_ACCENT(f), 0.6);
        g.pop();
      }
    }
  };

  function K_ACCENT(f) { return f.form > 0 ? f.kit.colors.formGlow : f.kit.colors.accent; }

  M3.build = SPEC;
  M3.humanoid = humanoid;
  M3.buildOf = function (id) { return SPEC[id] ? SPEC[id].build : null; };

  /* =====================================================================
   * DEATHBRINGER
   * =================================================================== */
  var DB = null;
  function dbMats() {
    if (DB) return DB;
    DB = {
      bark: G.mat('#141020'), bark2: G.mat('#0b0812'), bark3: G.mat('#060409'),
      root: G.mat('#0d0a15'), branch: G.mat('#0a0712'),
      eye: G.mat('#ff7a12', { em: 1 }),
      maw: G.mat('#1a0d06'),
      mucus: G.mat('#0a0812'),
      mucusWet: G.mat('#241b33')
    };
    return DB;
  }

  M3.deathbringer = function (f) {
    var Mt = dbMats();
    var t = (typeof f.anim === 'number') ? f.anim : 0;
    var rage = f.enraged ? 1 : 0;
    var lunging = f.state === 'lunge';
    var winding = f.state === 'wind';
    var i;

    if (f.ko) {
      f.koT = (f.koT || 0) + 0.016;
      var fall = U.clamp(f.koT, 0, 1);
      G.tx(0, 20, 0); G.rz(U.ease(fall) * 0.5); G.tx(0, -20, 0);
    } else {
      G.rz(Math.sin(t * 0.9) * 0.03);
    }

    /* roots */
    for (i = 0; i < 7; i++) {
      var ra = (i / 7) * U.TAU;
      G.push();
      G.tx(0, 74, 0);
      G.ry(ra);
      G.rz(-1.16 - Math.sin(t * 1.1 + i) * 0.04);
      G.prism(80, 11, 5, 5, i % 2 ? Mt.root : Mt.bark2);
      G.tx(80, 0, 0);
      G.rz(0.95);
      G.prism(26, 5, 2.2, 4, Mt.root);
      G.pop();
    }

    /* trunk */
    G.push();
    G.tx(0, 58, 0);
    G.rz(Math.PI / 2);
    G.prism(96, 34, 40, 8, Mt.bark);
    G.pop();
    G.push();
    G.tx(0, 154, 0);
    G.rz(Math.PI / 2);
    G.prism(58, 40, 26, 8, Mt.bark2);
    G.pop();

    /* crown of dead branches */
    for (i = 0; i < 9; i++) {
      var a = (i / 9) * U.TAU;
      G.push();
      G.tx(0, 206, 0);
      G.ry(a);
      G.rz(0.62 + Math.sin(t * 0.8 + i) * 0.05);
      G.prism(52 + (i % 3) * 12, 7, 3.4, 4, Mt.branch);
      G.tx(52 + (i % 3) * 12, 0, 0);
      G.rz(0.5);
      G.prism(30, 3.4, 1.2, 4, Mt.branch);
      G.pop();
    }

    /* arms */
    var reach = lunging ? 1 : (winding ? 0.55 : 0);
    for (i = 0; i < 2; i++) {
      var near = i === 1;
      var z = near ? 26 : -26;
      G.push();
      G.tx(6, 152, z);
      G.bone(U.lerp(near ? 0.5 : 0.62, -0.3, reach) + Math.sin(t * 1.05 + i) * 0.05, 60, 13, 10, 5,
        near ? Mt.bark : Mt.bark2);
      G.bone(U.lerp(0.85, 0.12, reach), 54, 10, 6, 5, near ? Mt.bark2 : Mt.bark3);
      for (var c = 0; c < 4; c++) {
        G.push();
        G.rz(-(c - 1.5) * 0.3);
        G.prism(26, 3.4, 0.8, 4, Mt.branch);
        G.pop();
      }
      if (lunging || winding) G.glow(6, 0, 0, 34, '#ff7a12', 0.45 + rage * 0.3);
      G.pop();
    }

    /* head */
    G.push();
    G.tx(38, 166, 0);                                 // hollow face on the trunk front
    G.box(11, 46, 36, Mt.bark3);
    var pulse = 0.7 + Math.sin(t * 3) * 0.1 + rage * 0.2;
    G.push(); G.tx(6.4, 9, 8.5); G.box(3.4, 7, 9, Mt.eye); G.pop();
    G.push(); G.tx(6.4, 9, -8.5); G.box(3.4, 7, 9, Mt.eye); G.pop();
    G.glow(8.4, 9, 8.5, 10 + rage * 3, '#ff7a12', pulse);
    G.glow(8.4, 9, -8.5, 10 + rage * 3, '#ff7a12', pulse);
    if (lunging || winding || rage) G.glow(7, 4, 0, 42 + rage * 16, '#ff7a12', 0.14 + rage * 0.1);
    for (var m = 0; m < 5; m++) {                     // splintered maw
      G.push();
      G.tx(5.5, -10, -12 + m * 6);
      G.rz(-0.25);
      G.prism(8, 3, 0.6, 3, Mt.maw);
      G.pop();
    }
    G.pop();

    /* mucus sheets and drips */
    for (i = 0; i < 9; i++) {
      var ma = (i / 9) * U.TAU;
      var ml = 26 + ((i * 53) % 42) + Math.sin(t * 0.7 + i) * 8;
      G.push();
      G.tx(0, 150 - (i % 3) * 16, 0);
      G.ry(ma);
      G.tx(30, 0, 0);
      G.rz(-Math.PI / 2);
      G.prism(ml, 5.5, 2.2, 4, i % 3 === 0 ? Mt.mucusWet : Mt.mucus);
      G.tx(ml, 0, 0);
      var ph = (t * 0.55 + i) % 1;
      G.tx(ph * 34, 0, 0);
      G.sphere(3.2 - ph * 1.2, 5, 3, Mt.mucus);
      G.pop();
    }
    // pooled slime at the base
    G.push();
    G.tx(0, 2, 0);
    G.sc(1, 0.1, 1);
    G.sphere(48, 10, 3, Mt.mucus);
    G.pop();
  };
})();
