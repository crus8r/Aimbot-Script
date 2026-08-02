/* VANGUARD — fighters3d.js
 * three.js fighters for Versus mode.
 *
 * Same character designs and the same joint angles the rest of the game
 * already computes — but built as real meshes with PBR materials, a key
 * light with shadow maps, and a perspective camera anchored so depth 0
 * lines up exactly with the painted 2D stage behind it.
 *
 * Only Versus uses this. The top-down campaign is untouched.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var F3 = (SH.f3 = {});

  var THREE = null;
  var renderer = null, scene = null, camera = null;
  var keyLight = null, rimLight = null, fillLight = null, hemi = null, shadowPlane = null;
  var EXPOSURE = 1.06;
  var models = [];            // parallel to vs.fighters
  var ready = false, failed = false;
  var glowTex = null;
  var theme = null, shadowsOn = true;
  var cw = 0, ch = 0, cdpr = 0;

  F3.available = function () { return typeof window.THREE !== 'undefined'; };
  F3.ready = function () { return ready; };
  F3.canvas = function () { return renderer && renderer.domElement; };

  /* =====================================================================
   * SETUP
   * =================================================================== */
  F3.init = function (canvas) {
    if (ready || failed) return ready;
    if (!F3.available()) { failed = true; return false; }
    THREE = window.THREE;
    /* r149 ships colour management off: hex literals would be read as linear
       and then encoded to sRGB again, washing every dark value out. */
    if (THREE.ColorManagement) {
      if ('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
      else THREE.ColorManagement.enabled = true;
    }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas || document.createElement('canvas'),
        alpha: true, antialias: true, powerPreference: 'high-performance'
      });
    } catch (err) { failed = true; return false; }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 20, 4000);

    keyLight = new THREE.DirectionalLight(0xfff4e6, 1.55);
    keyLight.position.set(-180, 320, 300);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(768, 768);
    var d = 240;
    keyLight.shadow.camera.left = -d; keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d; keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.camera.near = 40; keyLight.shadow.camera.far = 1200;
    keyLight.shadow.bias = -0.002;
    scene.add(keyLight);
    scene.add(keyLight.target);

    rimLight = new THREE.DirectionalLight(0x9ec8ff, 0.95);
    rimLight.position.set(240, 150, -300);
    scene.add(rimLight);

    fillLight = new THREE.DirectionalLight(0xbfd4ff, 0.3);
    fillLight.position.set(160, 60, 340);
    scene.add(fillLight);

    hemi = new THREE.HemisphereLight(0x7d92c4, 0x241a14, 0.42);
    scene.add(hemi);

    shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.ShadowMaterial({ opacity: 0.42 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    glowTex = makeGlowTexture();
    ready = true;
    return true;
  };

  function makeGlowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(c);
    return t;
  }

  F3.shadows = function (on) {
    if (!ready || on === shadowsOn) return;
    shadowsOn = on;
    renderer.shadowMap.enabled = on;
    keyLight.castShadow = on;
    shadowPlane.visible = on;
    scene.traverse(function (o) { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  };

  F3.resize = function (vw, vh, dpr) {
    if (!ready) return;
    if (vw === cw && vh === ch && dpr === cdpr) return;
    cw = vw; ch = vh; cdpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(vw, vh, true);
  };

  F3.setTheme = function (t) {
    if (!ready || t === theme) return;
    theme = t;
    if (t === 'blight') {
      /* warm, but not so warm the heroes lose their own colours */
      keyLight.color.setHex(0xffe6cc);
      keyLight.intensity = 1.45;
      rimLight.color.setHex(0xff9a4a);
      rimLight.intensity = 0.9;
      fillLight.color.setHex(0xd8c2b0);
      fillLight.intensity = 0.3;
      hemi.color.setHex(0x8f7f78);
      hemi.groundColor.setHex(0x3a2010);
      hemi.intensity = 0.44;
    } else {
      keyLight.color.setHex(0xfff4e6);
      keyLight.intensity = 1.55;
      rimLight.color.setHex(0x9ec8ff);
      rimLight.intensity = 0.95;
      fillLight.color.setHex(0xbfd4ff);
      fillLight.intensity = 0.3;
      hemi.color.setHex(0x7d92c4);
      hemi.groundColor.setHex(0x141a28);
      hemi.intensity = 0.42;
    }
  };

  /* =====================================================================
   * MATERIALS + GEOMETRY HELPERS
   * =================================================================== */
  function mat(color, o) {
    o = o || {};
    var m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: o.rough === undefined ? 0.62 : o.rough,
      metalness: o.metal === undefined ? 0.08 : o.metal,
      flatShading: !!o.flat,
      side: o.two ? THREE.DoubleSide : THREE.FrontSide,
      transparent: !!o.alpha,
      opacity: o.alpha === undefined ? 1 : o.alpha
    });
    if (o.em) {
      m.emissive = new THREE.Color(o.em === true ? color : o.em);
      m.emissiveIntensity = o.emI === undefined ? 1.0 : o.emI;
    }
    return m;
  }

  /* Tapered limb along +X, near end at the origin. */
  function limbGeo(len, r0, r1, seg) {
    var g = new THREE.CylinderGeometry(r1, r0, len, seg || 10, 1, false);
    g.rotateZ(-Math.PI / 2);
    g.translate(len / 2, 0, 0);
    return g;
  }
  function capsuleGeo(len, r, seg) {
    var g = new THREE.CapsuleGeometry(r, len, 4, seg || 10);
    g.rotateZ(-Math.PI / 2);
    g.translate(len / 2, 0, 0);
    return g;
  }
  function boxGeo(w, h, d) {
    return new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  }
  /* Tapered n-gon prism along +X, near end at the origin. `roll` spins the
     cross-section so a 4-gon reads as a wedge rather than a diamond. */
  function prismGeo(len, r0, r1, seg, roll) {
    var g = new THREE.CylinderGeometry(r1, r0, len, seg || 6, 1, false);
    if (roll) g.rotateY(roll);
    g.rotateZ(-Math.PI / 2);
    g.translate(len / 2, 0, 0);
    return g;
  }
  function sphereGeo(r, seg) { return new THREE.SphereGeometry(r, seg || 12, (seg || 12) * 0.6); }

  function meshAt(geo, m, x, y, z, parent) {
    var mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    if (parent) parent.add(mesh);
    return mesh;
  }

  function glowSprite(color, size, parent, x, y, z) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(color),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5
    }));
    s.castShadow = false;
    s.receiveShadow = false;
    s.scale.set(size, size, 1);
    s.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(s);
    return s;
  }

  function grp(parent, x, y, z) {
    var g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  }

  /* Everything a character spec is allowed to build with. */
  function mkApi(m) {
    return {
      mesh: meshAt, grp: grp, glow: glowSprite, mat: mat,
      box: boxGeo, sphere: sphereGeo, limb: limbGeo, capsule: capsuleGeo,
      prism: prismGeo,
      cyl: function (rt, rb, h, s) { return new THREE.CylinderGeometry(rt, rb, h, s || 12); },
      cone: function (r, h, s) { return new THREE.ConeGeometry(r, h, s || 8); },
      torus: function (r, t, s) { return new THREE.TorusGeometry(r, t, 6, s || 14); },
      THREE: THREE, model: m
    };
  }

  /* =====================================================================
   * HUMANOID FACTORY
   * =================================================================== */
  function buildHumanoid(spec, K, inForm) {
    var B = spec.build;
    var M = spec.mats(K, inForm, mat);
    var root = new THREE.Group();
    var body = grp(root);
    var m = { root: root, body: body, spec: spec, B: B, M: M, accents: [], glows: [] };
    var api = mkApi(m);
    m.api = api;

    /* --- pelvis + legs --- */
    var pelvis = grp(body, 0, B.hip, 0);
    m.pelvis = pelvis;
    meshAt(new THREE.CylinderGeometry(B.chest * 0.44, B.chest * 0.48, 15, 12)
      .scale(1, 1, B.shoW / B.chest * 0.86), M.pelvis, 0, -4, 0, pelvis);

    m.legs = [];
    for (var s = 0; s < 2; s++) {
      var near = s === 1;
      var hipG = grp(pelvis, 0, 0, near ? B.hipZ : -B.hipZ);
      var thigh = grp(hipG);
      meshAt(limbGeo(B.thigh, B.legR0, B.legR1), near ? M.leg : M.legFar, 0, 0, 0, thigh);
      meshAt(sphereGeo(B.legR0 * 0.98, 10), near ? M.leg : M.legFar, 0, 0, 0, thigh);
      var shin = grp(thigh, B.thigh, 0, 0);
      meshAt(limbGeo(B.shin, B.legR1 * 0.95, B.legR2), near ? M.leg : M.legFar, 0, 0, 0, shin);
      meshAt(sphereGeo(B.legR1, 10), near ? M.knee || M.leg : M.legFar, 0, 0, 0, shin);
      var foot = grp(shin, B.shin, 0, 0);
      var fm = near ? M.boot : M.bootFar;
      meshAt(limbGeo(B.shin * 0.3, B.legR2 * 1.34, B.legR2 * 1.24, 9), fm, B.shin * 0.7, 0, 0, shin);
      meshAt(sphereGeo(B.legR2 * 1.08, 10), fm, 0, 0, 0, foot);                       // ankle
      meshAt(prismGeo(B.footL * 1.06, B.legR2 * 1.34, B.legR2 * 0.8, 6, 0.52)
        .scale(1, 0.74, 1.02), fm, -B.footL * 0.26, -B.bootH * 0.4, 0, foot);         // boot
      meshAt(prismGeo(B.footL * 1.16, B.legR2 * 1.12, B.legR2 * 0.86, 4, Math.PI / 4)
        .scale(1, 0.2, 1.0), M.sole || fm, -B.footL * 0.3, -B.bootH * 0.78, 0, foot); // sole
      if (spec.leg) spec.leg({ thigh: thigh, shin: shin, foot: foot }, M, B, near, api);
      m.legs.push({ hip: hipG, thigh: thigh, shin: shin, foot: foot });
    }

    /* --- torso --- */
    var torso = grp(body, 0, B.hip, 0);
    m.torso = torso;
    var th = B.sho - B.hip;
    var oval = B.shoW / B.chest;
    var abdo = new THREE.CylinderGeometry(B.chest * 0.54, B.chest * 0.42, th * 0.58, 14);
    abdo.scale(1, 1, oval);
    meshAt(abdo, M.torso, 0, th * 0.29 - 2, 0, torso);
    var chest = new THREE.CylinderGeometry(B.chest * 0.46, B.chest * 0.56, th * 0.5, 14);
    chest.scale(1, 1, oval * 0.95);
    meshAt(chest, M.torso, 0, th * 0.58 + th * 0.25 - 2, 0, torso);
    meshAt(new THREE.SphereGeometry(B.chest * 0.5, 14, 10).scale(1, 0.7, oval * 0.95),
      M.torso, 0, th * 0.62, 0, torso);

    /* --- head --- */
    var head = grp(torso, 0, B.head - B.hip, 0);
    m.head = head;
    meshAt(new THREE.CylinderGeometry(4.2, 5.2, 12, 10), M.neck, 1, -(B.head - B.sho) - 1, 0, head);

    /* --- arms --- */
    m.arms = [];
    for (var a = 0; a < 2; a++) {
      var nearA = a === 1;
      var shoG = grp(torso, 1, B.sho - B.hip - 3, nearA ? B.shoZ : -B.shoZ);
      var upper = grp(shoG);
      meshAt(limbGeo(B.upper, B.armR0, B.armR1), nearA ? M.arm : M.armFar, 0, 0, 0, upper);
      meshAt(sphereGeo(B.armR0 * 1.02, 10), nearA ? M.arm : M.armFar, 0, 0, 0, upper);
      var fore = grp(upper, B.upper, 0, 0);
      meshAt(limbGeo(B.fore, B.armR1 * 0.95, B.armR2), nearA ? M.fore : M.foreFar, 0, 0, 0, fore);
      meshAt(sphereGeo(B.armR1 * 0.98, 10), nearA ? M.arm : M.armFar, 0, 0, 0, fore);
      var hand = grp(fore, B.fore, 0, 0);
      var gm = nearA ? M.glove : M.gloveFar;
      meshAt(prismGeo(B.handR * 2.1, B.handR * 1.16, B.handR * 1.0, 6, 0.4)
        .scale(1, 1, 0.82), gm, -B.handR * 0.35, 0, 0, hand);
      meshAt(sphereGeo(B.handR * 0.72, 8), gm, B.handR * 1.5, B.handR * 0.42, 0, hand);
      var shoulder = grp(shoG);
      if (spec.shoulder) spec.shoulder(shoulder, M, B, nearA, api);
      m.arms.push({ sho: shoG, upper: upper, fore: fore, hand: hand });
    }

    if (spec.head) spec.head(head, M, B, api, inForm);
    if (spec.torsoArt) spec.torsoArt(torso, M, B, api, inForm, th);
    if (spec.back) { m.backGrp = grp(torso); spec.back(m.backGrp, M, B, api, inForm); }
    if (spec.weapon) { m.weaponGrp = grp(m.arms[1].hand); spec.weapon(m.weaponGrp, M, B, api, inForm); }
    if (spec.weaponOff) { m.weaponGrpB = grp(m.arms[0].hand); spec.weaponOff(m.weaponGrpB, M, B, api, inForm); }
    if (spec.extras) spec.extras(m, M, B, api, inForm);

    return m;
  }

  /* =====================================================================
   * POSE
   * =================================================================== */
  var TURN = 0.44;
  function poseHumanoid(m, f, p) {
    var B = m.B;
    var dir = Math.cos(f.facing) >= 0 ? 1 : -1;
    m.root.position.set(f.x, f.z, 0);
    m.root.rotation.y = dir > 0 ? -TURN : Math.PI + TURN;
    m.root.scale.setScalar(B.scale);
    m.body.position.y = -(p.crouch + p.bob);
    m.body.rotation.z = p.fall !== undefined ? -p.fall : 0;

    m.torso.rotation.z = p.lean * 0.24;
    m.head.rotation.z = -p.head - p.lean * 0.12;

    var lf = m.legs[1], lb = m.legs[0];
    lf.thigh.rotation.z = -p.legF[0]; lf.shin.rotation.z = -p.legF[1];
    lb.thigh.rotation.z = -p.legB[0]; lb.shin.rotation.z = -p.legB[1];
    lf.foot.rotation.z = p.legF[0] + p.legF[1];
    lb.foot.rotation.z = p.legB[0] + p.legB[1];

    var af = m.arms[1], ab = m.arms[0];
    af.upper.rotation.z = -p.armF[0]; af.fore.rotation.z = -p.armF[1];
    ab.upper.rotation.z = -p.armB[0]; ab.fore.rotation.z = -p.armB[1];

    if (m.spec.animate) m.spec.animate(m, f, p);
  }

  /* =====================================================================
   * SCENE MANAGEMENT
   * =================================================================== */
  F3.setFighters = function (list) {
    if (!ready) return;
    F3.clear();
    models = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var m;
      if (f.deathbringer) m = SH.SPECS3.deathbringer.build(mat, mkApi(null));
      else m = buildHumanoid(SH.SPECS3[f.kitId], f.kit.colors, f.form > 0);
      m.fighter = f;
      m.formState = f.form > 0;
      scene.add(m.root);
      models.push(m);
    }
  };

  F3.clear = function () {
    if (!ready) return;
    for (var k = 0; k < models.length; k++) {
      if (models[k] && models[k].root) scene.remove(models[k].root);
    }
    models = [];
  };

  F3.render = function (vs) {
    if (!ready) return false;
    var R = SH.render, S = SH.side, i;
    var fl = vs.fighters;

    /* rebuild whenever the roster changes — versus.js needs no hook */
    var stale = models.length !== fl.length;
    if (!stale) for (i = 0; i < fl.length; i++) if (!models[i] || models[i].fighter !== fl[i]) { stale = true; break; }
    if (stale) F3.setFighters(fl);

    // camera anchored to the 2D stage camera: depth 0 matches exactly
    var camX = S.cam.x + S.cam.sx;
    var camH = S.GROUND - (S.cam.y + S.cam.sy);
    var D = 900;
    camera.fov = 2 * Math.atan(R.vh / (2 * D * S.cam.s)) * 180 / Math.PI;
    camera.aspect = R.vw / R.vh;
    camera.position.set(camX, camH, D);
    camera.lookAt(camX, camH, 0);
    camera.updateProjectionMatrix();

    keyLight.position.set(camX - 200, 340, 320);
    keyLight.target.position.set(camX, 60, 0);
    keyLight.target.updateMatrixWorld();

    var list = fl;
    for (i = 0; i < list.length; i++) {
      var m = models[i];
      if (!m || m.fighter !== list[i]) continue;
      var f = list[i];
      if (f.deathbringer) {
        if (m.pose) m.pose(m, f);
      } else {
        var inF = f.form > 0;
        if (inF !== m.formState) {           // rebuild on form change for new palette
          scene.remove(m.root);
          m = models[i] = buildHumanoid(SH.SPECS3[f.kitId], f.kit.colors, inF);
          m.fighter = f; m.formState = inF;
          scene.add(m.root);
        }
        poseHumanoid(m, f, SH.side.poseOf(f));
      }
      m.root.visible = true;
    }

    var dark = SH.darknessLevel ? SH.darknessLevel() : 0;
    renderer.toneMappingExposure = EXPOSURE * (1 - dark * 0.7);
    renderer.render(scene, camera);
    return true;
  };

  /* =====================================================================
   * PREVIEW (character select)
   * =================================================================== */
  var pRenderer = null, pScene = null, pCam = null, pModel = null, pId = null, pForm = false;
  F3.preview = function (ctx, id, w, h, t, yaw) {
    if (!ready) return false;
    if (!pRenderer) {
      var c = document.createElement('canvas');
      pRenderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true });
      pRenderer.outputEncoding = THREE.sRGBEncoding;
      pRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      pRenderer.toneMappingExposure = 1.12;
      pRenderer.shadowMap.enabled = true;
      pRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      pScene = new THREE.Scene();
      pCam = new THREE.PerspectiveCamera(32, 1, 10, 3000);
      var k = new THREE.DirectionalLight(0xfff4e6, 1.7); k.position.set(-150, 230, 300); pScene.add(k);
      var r2 = new THREE.DirectionalLight(0x9ec8ff, 1.05); r2.position.set(220, 120, -260); pScene.add(r2);
      var f2 = new THREE.DirectionalLight(0xc4d8ff, 0.34); f2.position.set(120, 40, 320); pScene.add(f2);
      pScene.add(new THREE.HemisphereLight(0x8298c8, 0x241a12, 0.44));
      k.castShadow = true;
      k.shadow.mapSize.set(1024, 1024);
      k.shadow.camera.left = -200; k.shadow.camera.right = 200;
      k.shadow.camera.top = 260; k.shadow.camera.bottom = -60;
      k.shadow.camera.near = 40; k.shadow.camera.far = 900;
      k.shadow.bias = -0.0018;
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShadowMaterial({ opacity: 0.4 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      pScene.add(floor);
    }
    if (id !== pId) {
      if (pModel) pScene.remove(pModel.root);
      pModel = id === 'deathbringer'
        ? SH.SPECS3.deathbringer.build(mat, mkApi(null))
        : buildHumanoid(SH.SPECS3[id], SH.kitById(id).colors, false);
      pScene.add(pModel.root);
      pId = id;
    }
    var tall = id === 'deathbringer' ? 300 : 118;
    var fake = fakeFighter(id, t);
    if (id === 'deathbringer') { if (pModel.pose) pModel.pose(pModel, fake); }
    else poseHumanoid(pModel, fake, SH.side.poseOf(fake));
    pModel.root.position.set(0, 0, 0);
    /* three-quarter hero angle, swaying just enough to read the silhouette */
    pModel.root.rotation.y = yaw === undefined ? -1.0 - Math.sin(t * 0.45) * 0.52 : yaw;

    pRenderer.setPixelRatio(1);
    pRenderer.setSize(w, h, false);
    var dist = tall * 2.6;
    pCam.aspect = w / h;
    pCam.fov = 2 * Math.atan((tall * 0.62) / dist) * 180 / Math.PI;
    pCam.position.set(0, tall * 0.5, dist);
    pCam.lookAt(0, tall * 0.46, 0);
    pCam.updateProjectionMatrix();
    pRenderer.render(pScene, pCam);
    ctx.drawImage(pRenderer.domElement, 0, 0, w, h);
    return true;
  };

  function fakeFighter(id, t) {
    if (id === 'deathbringer') {
      return { deathbringer: true, x: 0, y: 0, z: 0, facing: 0, anim: t, state: 'idle', enraged: false, form: 0 };
    }
    var kit = SH.kitById(id);
    return {
      kitId: id, kit: kit, x: 0, y: 0, z: 0, facing: 0, form: 0, grounded: true,
      vx: 0, vz: 0, hitFlash: 0, attackT: 0, guard: 0,
      anim: { t: t, swing: -1, swingDir: 1, wing: 0 }
    };
  }

  F3.poseHumanoid = poseHumanoid;
  F3.buildHumanoid = buildHumanoid;
  F3.helpers = function () { return mkApi(null); };
})();
