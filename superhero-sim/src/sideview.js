/* VANGUARD — sideview.js
 * Side-on "fighting game" presentation.
 *
 * The engine stores x / y / z and draws entities at (x, y - z). Versus mode
 * pins every fighter to one y lane, so that convention becomes a true side
 * view and every existing VFX renders unchanged.
 *
 * Characters are built from a per-fighter "build" (proportions) plus tapered
 * anatomy segments, armour plates, cloth and a custom head — so each of the
 * five reads from silhouette alone.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var TAU = U.TAU;

  var S = (SH.side = {
    GROUND: 2000,
    STAGE_W: 1560,
    H: 118,
    cam: { x: 0, y: 0, s: 1.4, sx: 0, sy: 0 },
    theme: 'blight'
  });

  /* =====================================================================
   * SMALL HELPERS
   * =================================================================== */
  function shade(hex, amt) {
    var c = U.rgba(hex, 1).match(/\d+/g);
    var f = function (v) { return U.clamp(Math.round(+v + amt * 255), 0, 255); };
    return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
  }
  S.shade = shade;

  /* Local-space gradients are stable across frames, so they can be cached. */
  function lgrad(ctx, key, x0, y0, x1, y1, stops) {
    var cache = ctx.__lg || (ctx.__lg = {});
    var g = cache[key];
    if (!g) {
      g = ctx.createLinearGradient(x0, y0, x1, y1);
      for (var i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
      cache[key] = g;
    }
    return g;
  }

  /* Tapered capsule between two joints — the basis of every limb. */
  function segPath(ctx, x0, y0, x1, y1, r0, r1) {
    var a = Math.atan2(y1 - y0, x1 - x0);
    var p = a + Math.PI / 2;
    var i, t;
    ctx.beginPath();
    ctx.moveTo(x0 + Math.cos(p) * r0, y0 + Math.sin(p) * r0);
    ctx.lineTo(x1 + Math.cos(p) * r1, y1 + Math.sin(p) * r1);
    for (i = 1; i <= 7; i++) {                       // cap over the far joint
      t = p - (i / 7) * Math.PI;
      ctx.lineTo(x1 + Math.cos(t) * r1, y1 + Math.sin(t) * r1);
    }
    ctx.lineTo(x0 - Math.cos(p) * r0, y0 - Math.sin(p) * r0);
    for (i = 1; i <= 7; i++) {                       // cap behind the near joint
      t = p + Math.PI - (i / 7) * Math.PI;
      ctx.lineTo(x0 + Math.cos(t) * r0, y0 + Math.sin(t) * r0);
    }
    ctx.closePath();
  }

  var INK = 'rgba(0,0,0,0.55)';

  function limbSeg(ctx, x0, y0, x1, y1, r0, r1, fill, rim) {
    segPath(ctx, x0, y0, x1, y1, r0, r1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
    if (rim) {                                       // light catching the leading edge
      var a = Math.atan2(y1 - y0, x1 - x0), p = a + Math.PI / 2;
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0 + Math.cos(p) * r0 * 0.92, y0 + Math.sin(p) * r0 * 0.92);
      ctx.lineTo(x1 + Math.cos(p) * r1 * 0.92, y1 + Math.sin(p) * r1 * 0.92);
      ctx.stroke();
    }
  }

  /* A two-bone limb. Returns elbow/knee and hand/foot positions. */
  function limb(ctx, x, y, a1, l1, a2, l2, w, o) {
    var ex = x + Math.cos(a1) * l1, ey = y + Math.sin(a1) * l1;
    var fa = a1 + a2;
    var fx = ex + Math.cos(fa) * l2, fy = ey + Math.sin(fa) * l2;
    limbSeg(ctx, x, y, ex, ey, w.r0, w.r1, w.upper, w.rim);
    limbSeg(ctx, ex, ey, fx, fy, w.r1 * 0.94, w.r2, w.lower, w.rim);
    if (w.joint) {                                   // elbow / knee plate
      ctx.fillStyle = w.joint;
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(ex, ey, w.r1 * 1.16, 0, TAU); ctx.fill(); ctx.stroke();
    }
    return { x: fx, y: fy, ex: ex, ey: ey, a: fa };
  }

  function plate(ctx, x, y, r, fill, rim, squash) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, squash || 1);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke();
    if (rim) {
      ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.86, -2.5, -0.5); ctx.stroke();
    }
    ctx.restore();
  }

  function boot(ctx, hand, ang, B, dir) {
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(Math.max(-0.5, Math.min(0.5, ang - Math.PI / 2)) * 0.35);
    ctx.fillStyle = B.bootCol;
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-B.shinW * 1.05, -B.bootH);
    ctx.lineTo(B.shinW * 0.9, -B.bootH);
    ctx.quadraticCurveTo(B.footL, -B.bootH * 0.55, B.footL, 2);
    ctx.quadraticCurveTo(B.footL * 0.5, 5, -B.shinW * 1.15, 4);
    ctx.quadraticCurveTo(-B.shinW * 1.5, 0, -B.shinW * 1.05, -B.bootH);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (B.bootTrim) {
      ctx.fillStyle = B.bootTrim;
      ctx.fillRect(-B.shinW * 1.05, -B.bootH, B.shinW * 1.95, 3.2);
    }
    ctx.restore();
  }

  function glove(ctx, hand, B, front) {
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(hand.a);
    ctx.fillStyle = front ? B.gloveCol : shade(B.gloveCol, -0.1);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.ellipse(1, 0, B.handR * 1.15, B.handR, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    if (B.gloveTrim) {
      ctx.fillStyle = B.gloveTrim;
      ctx.fillRect(-B.handR * 1.1, -B.handR * 0.85, 3, B.handR * 1.7);
    }
    ctx.restore();
  }

  /* =====================================================================
   * CAMERA
   * =================================================================== */
  function fighterTop(f) { return f.deathbringer ? 300 : 138; }

  S.follow = function (a, b, dt, snap) {
    var R = SH.render;
    var mid = (a.x + b.x) / 2;
    var spread = Math.abs(a.x - b.x);
    var topZ = Math.max(a.z, b.z);
    var tall = Math.max(fighterTop(a), fighterTop(b));
    /* frame them like a fighting game: close in until the pair nearly fills
       the screen, then pull back only as far as the spread demands */
    var want = U.clamp(Math.min(R.vw / (spread + 260), R.vh / (tall + 72 + topZ * 1.05)), 0.5, 2.1);
    var cy = S.GROUND - (tall + topZ) * 0.44;
    if (snap) { S.cam.x = mid; S.cam.y = cy; S.cam.s = want; }
    else {
      var k = Math.min(1, dt * 6);
      S.cam.x = U.lerp(S.cam.x, mid, k);
      S.cam.y = U.lerp(S.cam.y, cy, k);
      S.cam.s = U.lerp(S.cam.s, want, Math.min(1, dt * 3));
    }
    var halfW = R.vw / S.cam.s / 2;
    S.cam.x = U.clamp(S.cam.x, halfW - 60, S.STAGE_W - halfW + 60);
    if (S.STAGE_W < halfW * 2) S.cam.x = S.STAGE_W / 2;

    if (R.shakeAmt > 0) {
      R.shakeAmt = Math.max(0, R.shakeAmt - dt * 42);
      S.cam.sx = U.rand(-R.shakeAmt, R.shakeAmt);
      S.cam.sy = U.rand(-R.shakeAmt, R.shakeAmt);
    } else { S.cam.sx = S.cam.sy = 0; }
  };

  /* =====================================================================
   * FRAME
   * =================================================================== */
  function worldXf(ctx) {
    var R = SH.render, cam = S.cam;
    ctx.translate(R.vw / 2, R.vh / 2);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x - cam.sx, -cam.y - cam.sy);
  }

  S.draw = function (vs) {
    var R = SH.render, ctx = R.ctx, cam = S.cam;
    var i;
    var webgl = use3D();
    var fx = webgl ? fxCtx() : ctx;          // effects go on their own layer
    setLayers(webgl);
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    drawSky(ctx, R);

    var hw = R.vw / cam.s / 2 + 140, hh = R.vh / cam.s / 2 + 260;
    var v = R.view;
    v.x0 = cam.x - hw; v.x1 = cam.x + hw;
    v.y0 = cam.y - hh; v.y1 = cam.y + hh;

    var list = vs.fighters;

    /* ---- painted stage, behind everything ---- */
    ctx.save();
    worldXf(ctx);
    drawBackdrop(ctx, v);
    drawGround(ctx, v);
    drawGroundMist(ctx, v);
    drawHazards(ctx, v);
    drawTelegraphs(ctx, v);
    /* WebGL casts real shadows on the ground; only airborne fighters still
       need a painted blob, because the shadow camera can't reach them. */
    if (!webgl) for (i = 0; i < list.length; i++) shadow(ctx, list[i]);
    else for (i = 0; i < list.length; i++) if (list[i].z > 24) shadow(ctx, list[i]);
    ctx.restore();

    /* ---- the fighters ---- */
    if (webgl) {
      SH.f3.resize(R.vw, R.vh, R.dpr);
      SH.f3.setTheme(S.theme);
      SH.f3.render(vs);
      adapt3D();
      fx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
      fx.clearRect(0, 0, R.vw, R.vh);
    } else {
      camFor3D();
      SH.g3.begin();
      for (i = 0; i < list.length; i++) SH.g3.push(), S.buildFighter(list[i]), SH.g3.pop();
      if (SH.game.fps > 45) SH.g3.render(ctx, { mirror: true, alpha: 0.17, dim: 0.55 });
      SH.g3.render(ctx);
      SH.g3.renderGlows(ctx);
    }

    /* ---- effects on top ---- */
    fx.save();
    worldXf(fx);
    var pr = SH.ents.projectiles;
    for (i = 0; i < pr.length; i++) SH.render.proj(fx, pr[i]);
    SH.render.parts(fx, v);
    SH.render.overheads(fx, v);
    drawForeground(fx, v);
    fx.restore();

    drawVignette(fx, R);

    var dark = SH.darknessLevel();
    if (dark > 0) {
      var g = fx.createRadialGradient(R.vw / 2, R.vh * 0.55, R.vh * 0.14, R.vw / 2, R.vh * 0.55, R.vh * 0.95);
      g.addColorStop(0, 'rgba(4,2,8,' + (dark * 0.45).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(2,1,5,' + (dark * 0.97).toFixed(3) + ')');
      fx.fillStyle = g;
      fx.fillRect(0, 0, R.vw, R.vh);
    }
  };

  /* The 3D fighters render straight into their own stacked canvas, so the
     browser composites the layers instead of us blitting a WebGL surface
     through the 2D context every frame. */
  var fxC = null, l3d = null;
  function fxCtx() {
    if (!fxC) {
      fxC = SH.render.addLayer(document.getElementById('gamefx'));
      fxC._ctx = fxC.getContext('2d');
    }
    return fxC._ctx;
  }
  function setLayers(on) {
    if (!l3d) l3d = document.getElementById('game3d');
    if (l3d) l3d.classList.toggle('on', !!on);
    if (fxC) fxC.classList.toggle('on', !!on);
  }
  S.hideLayers = function () { setLayers(false); };

  /* ------------------------------------------------------------- stage */
  function layer(key, R, drawFn) {
    var c = S['_' + key];
    var w = Math.max(2, Math.round(R.vw * R.dpr)), h = Math.max(2, Math.round(R.vh * R.dpr));
    if (!c || c.width !== w || c.height !== h || S['_' + key + 'T'] !== S.theme) {
      c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g2 = c.getContext('2d');
      g2.scale(R.dpr, R.dpr);
      drawFn(g2, R.vw, R.vh);
      S['_' + key] = c;
      S['_' + key + 'T'] = S.theme;
    }
    return c;
  }

  function drawSky(ctx, R) {
    ctx.drawImage(layer('sky', R, paintSky), 0, 0, R.vw, R.vh);
  }

  function paintSky(ctx, vw, vh) {
    var R = { vw: vw, vh: vh };
    var g = ctx.createLinearGradient(0, 0, 0, R.vh);
    if (S.theme === 'blight') {
      g.addColorStop(0, '#07040c');
      g.addColorStop(0.42, '#130a14');
      g.addColorStop(0.8, '#28110d');
      g.addColorStop(1, '#3d1a09');
    } else {
      g.addColorStop(0, '#04060e');
      g.addColorStop(0.45, '#0a1122');
      g.addColorStop(0.85, '#15243f');
      g.addColorStop(1, '#1d3355');
    }
    // moon / blight sun
    var cx = R.vw * 0.7, cy = R.vh * 0.24, rr = R.vh * 0.1;
    var mg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 4);
    if (S.theme === 'blight') {
      mg.addColorStop(0, 'rgba(255,140,40,0.5)');
      mg.addColorStop(0.16, 'rgba(255,110,30,0.18)');
      mg.addColorStop(1, 'rgba(255,90,20,0)');
    } else {
      mg.addColorStop(0, 'rgba(190,220,255,0.42)');
      mg.addColorStop(0.16, 'rgba(150,190,255,0.15)');
      mg.addColorStop(1, 'rgba(120,170,255,0)');
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, R.vw, R.vh);
    ctx.fillStyle = mg; ctx.fillRect(0, 0, R.vw, R.vh);
  }

  function drawBackdrop(ctx, v) {
    var cam = S.cam;
    var horizon = S.GROUND;
    var blight = S.theme === 'blight';
    var layers = [
      { d: 0.14, h: 400, col: blight ? '#0d0710' : '#070b14', step: 210, win: 0 },
      { d: 0.32, h: 300, col: blight ? '#120913' : '#0a0f1b', step: 150, win: 0.1 },
      { d: 0.56, h: 205, col: blight ? '#170d17' : '#0e1626', step: 112, win: 0.2 }
    ];
    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      var ox = cam.x * (1 - L.d);
      var x0 = Math.floor((v.x0 + ox) / L.step) * L.step - ox;
      for (var x = x0; x < v.x1 + L.step; x += L.step) {
        var key = Math.round((x + ox) / L.step);
        var seed = U.hash(key * 13.7, l * 7.1);
        var seed2 = U.hash(l * 3.3, key * 5.9);
        var w = L.step * (0.5 + seed * 0.44);
        var hgt = L.h * (0.4 + seed * 0.72);
        ctx.fillStyle = L.col;
        ctx.fillRect(x, horizon - hgt, w, hgt);
        // roof furniture so the skyline is not a plain bar chart
        if (seed2 > 0.62) ctx.fillRect(x + w * 0.6, horizon - hgt - 16 - seed * 14, 5, 16 + seed * 14);
        if (seed2 < 0.2) ctx.fillRect(x + w * 0.12, horizon - hgt - 9, w * 0.32, 9);
        if (L.win) {
          ctx.fillStyle = blight ? 'rgba(255,122,18,0.13)' : 'rgba(120,175,255,0.12)';
          for (var wy = 0; wy < 4; wy++) {
            for (var wx = 0; wx < 2; wx++) {
              var s2 = U.hash(key * 2.1 + wx, l * 4.7 + wy);
              if (s2 < 0.62) continue;
              ctx.fillRect(x + w * (0.22 + wx * 0.38), horizon - hgt + 18 + wy * 34, 6, 10);
            }
          }
        }
      }
    }

    if (blight) {
      ctx.save();
      var ox2 = cam.x * 0.26;
      for (var t = 0; t < 11; t++) {
        var tx = t * 240 - 420 - ox2 * 0.4;
        var sd = U.hash(t * 5.3, 2.2);
        ctx.globalAlpha = 0.8;
        drawDeadTree(ctx, tx, horizon + 6, 160 + sd * 150, sd, '#0a0610');
      }
      ctx.restore();
      var gg = ctx.createLinearGradient(0, horizon - 260, 0, horizon);
      gg.addColorStop(0, 'rgba(255,110,20,0)');
      gg.addColorStop(1, 'rgba(255,110,20,0.16)');
      ctx.fillStyle = gg;
      ctx.fillRect(v.x0, horizon - 260, v.x1 - v.x0, 260);
    } else {
      // neon signage for the plaza
      ctx.save();
      var ox3 = cam.x * 0.44;
      var cols = ['#3ef08a', '#ff5b6e', '#5ad1ff', '#ffd76a'];
      for (var n = 0; n < 7; n++) {
        var nx = n * 360 - 420 - ox3 * 0.5;
        if (nx < v.x0 - 160 || nx > v.x1 + 160) continue;
        var ns = U.hash(n * 9.1, 4.4);
        var col = cols[n % 4];
        var ny = horizon - 150 - ns * 120;
        var flick = 0.72 + Math.sin(SH.game.time * (2 + ns * 3) + n) * 0.16;
        ctx.globalAlpha = flick;
        SH.render.glowAt(ctx, nx, ny + 16, 30, col, 0.32);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(nx - 6, ny - 4, 13, 44);
        ctx.fillStyle = col;
        for (var q = 0; q < 4; q++) ctx.fillRect(nx - 3.5, ny + q * 11, 8, 5);
      }
      ctx.restore();
    }
  }

  function drawDeadTree(ctx, x, groundY, h, seed, col) {
    ctx.strokeStyle = col;
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.quadraticCurveTo(x + (seed - 0.5) * 10, groundY - h * 0.6, x + (seed - 0.5) * 20, groundY - h);
    ctx.stroke();
    for (var i = 0; i < 6; i++) {
      var f = 0.38 + i * 0.115;
      var by = groundY - h * f;
      var dir = i % 2 ? 1 : -1;
      ctx.lineWidth = 5.5 - i * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + (seed - 0.5) * 20 * f, by);
      ctx.quadraticCurveTo(x + dir * h * 0.2, by - h * 0.09, x + dir * h * (0.24 + seed * 0.13), by - h * 0.26);
      ctx.stroke();
    }
  }

  function drawGround(ctx, v) {
    var y = S.GROUND;
    var blight = S.theme === 'blight';
    var g = ctx.createLinearGradient(0, y, 0, y + 320);
    if (blight) { g.addColorStop(0, '#241318'); g.addColorStop(0.35, '#150a0f'); g.addColorStop(1, '#050308'); }
    else { g.addColorStop(0, '#1b2637'); g.addColorStop(0.35, '#0e1725'); g.addColorStop(1, '#04070d'); }
    ctx.fillStyle = g;
    ctx.fillRect(v.x0, y, v.x1 - v.x0, 420);

    ctx.strokeStyle = blight ? 'rgba(255,122,18,0.4)' : 'rgba(150,200,255,0.34)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); ctx.stroke();

    ctx.strokeStyle = blight ? 'rgba(255,122,18,0.06)' : 'rgba(150,190,255,0.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var step = 130;
    var x0 = Math.floor(v.x0 / step) * step;
    for (var x = x0; x < v.x1; x += step) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + (x - S.cam.x) * 0.6, y + 300);
    }
    ctx.stroke();
    for (var d = 1; d <= 5; d++) {
      var yy = y + d * d * 13;
      ctx.beginPath(); ctx.moveTo(v.x0, yy); ctx.lineTo(v.x1, yy); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    if (v.x0 < 0) ctx.fillRect(v.x0, y - 900, -v.x0, 1400);
    if (v.x1 > S.STAGE_W) ctx.fillRect(S.STAGE_W, y - 900, v.x1 - S.STAGE_W, 1400);
  }

  function drawGroundMist(ctx, v) {
    var y = S.GROUND;
    var blight = S.theme === 'blight';
    var t = SH.game.time;
    ctx.save();
    for (var i = 0; i < 3; i++) {
      var off = ((t * (7 + i * 4) + i * 520) % (v.x1 - v.x0 + 700)) + v.x0 - 350;
      ctx.globalAlpha = 0.05;
      SH.render.glowAt(ctx, off, y - 4, 105 + i * 26, blight ? '#ff7a2a' : '#5f8fd0', 1);
    }
    ctx.restore();
  }

  function drawForeground(ctx, v) {
    var y = S.GROUND;
    var cam = S.cam;
    var blight = S.theme === 'blight';
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = blight ? '#050206' : '#04060c';
    var ox = cam.x * 0.35;
    for (var i = 0; i < 14; i++) {
      var x = i * 200 - 700 - ox * 0.6;
      if (x < v.x0 - 250 || x > v.x1 + 250) continue;
      var sd = U.hash(i * 3.9, 8.2);
      ctx.beginPath();
      ctx.moveTo(x - 90, y + 300);
      ctx.quadraticCurveTo(x - 40, y + 190 - sd * 60, x + 10, y + 205 - sd * 40);
      ctx.quadraticCurveTo(x + 70, y + 220, x + 120, y + 300);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette(ctx, R) {
    ctx.drawImage(layer('vig', R, paintVignette), 0, 0, R.vw, R.vh);
  }

  function paintVignette(ctx, vw, vh) {
    var g = ctx.createRadialGradient(vw / 2, vh * 0.5, vh * 0.4, vw / 2, vh * 0.5, vh * 1.02);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }

  function shadow(ctx, f) {
    var r = (f.deathbringer ? 78 : 32) * U.clamp(1 - f.z / 420, 0.3, 1);
    ctx.globalAlpha = 0.5 * U.clamp(1 - f.z / 500, 0.22, 1);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(f.x, S.GROUND + 3, r, r * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------- hazards on stage */
  function drawHazards(ctx, v) {
    var list = SH.ents.hazards;
    var y = S.GROUND;
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.x + h.r < v.x0 || h.x - h.r > v.x1) continue;
      ctx.save();
      if (h.delay > 0) {
        var fill = 1 - U.clamp(h.delay / (h.data.delayMax || h.maxLife || 1), 0, 1);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = h.color;
        ctx.fillRect(h.x - h.r, y - 3, h.r * 2, 6);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(h.x - h.r * fill, y - 5, h.r * 2 * fill, 10);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = h.color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(h.x - h.r, y - 18); ctx.lineTo(h.x - h.r, y); ctx.lineTo(h.x - h.r + 13, y);
        ctx.moveTo(h.x + h.r, y - 18); ctx.lineTo(h.x + h.r, y); ctx.lineTo(h.x + h.r - 13, y);
        ctx.stroke();
      } else {
        var frac = U.clamp(h.life / h.maxLife, 0, 1);
        ctx.globalAlpha = 0.2 * U.clamp(frac * 3, 0, 1);
        ctx.fillStyle = h.color;
        ctx.beginPath();
        ctx.ellipse(h.x, y, h.r, Math.max(7, h.r * 0.18), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.45 * U.clamp(frac * 3, 0, 1);
        ctx.strokeStyle = h.color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(h.x, y, h.r, Math.max(7, h.r * 0.18), 0, 0, TAU);
        ctx.stroke();
        if (h.kind === 'storm' || h.kind === 'heal') {
          var gg = ctx.createLinearGradient(0, y - 240, 0, y);
          gg.addColorStop(0, U.rgba(h.color, 0));
          gg.addColorStop(1, U.rgba(h.color, 0.16 * frac));
          ctx.globalAlpha = 1;
          ctx.fillStyle = gg;
          ctx.fillRect(h.x - h.r, y - 240, h.r * 2, 240);
        }
      }
      ctx.restore();
    }
  }

  function drawTelegraphs(ctx, v) {
    var list = SH.ents.enemies;
    var y = S.GROUND;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.isHero || e.dead || !e.tele) continue;
      var t = U.clamp(e.tele.t / e.tele.max, 0, 1);
      var dir = Math.cos(e.facing) >= 0 ? 1 : -1;
      ctx.save();
      ctx.globalAlpha = 0.25 + t * 0.45;
      ctx.fillStyle = e.tele.color;
      ctx.strokeStyle = e.tele.color;
      if (e.tele.kind === 'charge') {
        var lg = ctx.createLinearGradient(e.x, 0, e.x + dir * 400, 0);
        lg.addColorStop(0, U.rgba(e.tele.color, 0.5));
        lg.addColorStop(1, U.rgba(e.tele.color, 0));
        ctx.fillStyle = lg;
        ctx.fillRect(e.x, y - 104, dir * 400 * (0.35 + t * 0.65), 104);
      } else if (e.tele.kind === 'aim') {
        var p = SH.game.player();
        if (p) {
          ctx.lineWidth = 2;
          ctx.setLineDash([12, 10]);
          ctx.beginPath();
          ctx.moveTo(e.x, y - e.h * 0.6);
          ctx.quadraticCurveTo((e.x + p.x) / 2, y - 260, p.x, y - p.z);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        var r = e.tele.r * t;
        ctx.fillRect(e.x - r, y - 10, r * 2, 14);
        var gg2 = ctx.createLinearGradient(0, y - 180, 0, y);
        gg2.addColorStop(0, U.rgba(e.tele.color, 0));
        gg2.addColorStop(1, U.rgba(e.tele.color, 0.3));
        ctx.globalAlpha = 0.5 + t * 0.4;
        ctx.fillStyle = gg2;
        ctx.fillRect(e.x - r, y - 180, r * 2, 180);
      }
      ctx.restore();
    }
  }

  /* =====================================================================
   * POSE
   * =================================================================== */
  /* Joint angles are measured from "straight forward" (+X), turning clockwise
   * in the side view: PI/2 is straight down, less than that is forward-down,
   * more is backward-down, negative is raised. Forearm and shin values are
   * relative to their parent. Both renderers apply them the same way. */
  function poseOf(f) {
    var t = (f.anim && f.anim.t) || 0;
    var speed = Math.abs(f.vx || 0);
    var walking = f.grounded !== false && speed > 30;
    var air = f.grounded === false;
    var swing = (f.anim && f.anim.swing > 0) ? U.clamp(1 - f.anim.swing / 0.3, 0, 1) : -1;
    var hurt = (f.hitFlash || 0) > 0.02;

    var p = {
      bob: 0, lean: 0, crouch: 0, breathe: Math.sin(t * 2.4) * 0.5,
      armF: [1.44, -1.02], armB: [1.66, -0.6],
      legF: [1.3, 0.32], legB: [1.86, -0.3],
      head: 0, swing: swing, air: air, walking: walking, t: t
    };

    if (f.ko) {
      p.fall = -1.34; p.crouch = 42;
      p.armF = [2.42, 0.34]; p.armB = [2.16, 0.22];
      p.legF = [2.85, 0.5]; p.legB = [3.05, 0.35];
      return p;
    }

    if (f.guard) {
      p.crouch = 11; p.lean = -0.1;
      p.armF = [1.02, -1.98]; p.armB = [1.2, -1.86];
      p.legF = [1.24, 0.42]; p.legB = [1.96, -0.4];
      p.bob = Math.sin(t * 5) * 0.5;
      return p;
    }

    if (air) {
      var rise = U.clamp((f.vz || 0) / 640, -1, 1);
      p.crouch = 6;
      p.lean = 0.12 + rise * 0.12;
      p.legF = [1.02 - rise * 0.4, 1.0];
      p.legB = [1.74 + rise * 0.12, 0.62];
      p.armF = [0.98 - rise * 0.92, -1.24];
      p.armB = [2.16 + rise * 0.34, 0.2];
    } else if (walking) {
      var ph = t * (8 + Math.min(speed, 620) * 0.017);
      var amp = U.clamp(speed / 260, 0.35, 1.25);
      p.legF = [1.52 + Math.sin(ph) * 0.6 * amp, 0.16 + Math.max(0, Math.cos(ph)) * 0.55];
      p.legB = [1.52 + Math.sin(ph + Math.PI) * 0.6 * amp, 0.16 + Math.max(0, Math.cos(ph + Math.PI)) * 0.55];
      p.armF = [1.44 + Math.sin(ph + Math.PI) * 0.42 * amp, -0.9];
      p.armB = [1.66 + Math.sin(ph) * 0.42 * amp, -0.66];
      p.bob = Math.abs(Math.sin(ph)) * 2.8 * amp;
      p.lean = 0.13 * amp;
    } else {
      // fighting stance: weight back, lead hand up, subtle breathing
      p.bob = Math.sin(t * 2.4) * 1.2;
      p.armF = [1.44 + Math.sin(t * 2.4) * 0.055, -1.02 - Math.sin(t * 2.4) * 0.04];
      p.armB = [1.66 + Math.sin(t * 2.4 + 0.8) * 0.05, -0.6];
      p.legF = [1.3, 0.32];
      p.legB = [1.86, -0.3];
      p.lean = 0.06;
    }

    if (swing >= 0) {
      var e = U.ease(swing);
      p.armF = [U.lerp(-1.55, 0.9, e), U.lerp(-0.65, -0.05, e)];
      p.armB = [U.lerp(2.05, 2.5, e), -0.45];
      p.lean = U.lerp(-0.26, 0.36, e);
      p.crouch = 6 * Math.sin(e * Math.PI);
      p.legF = [U.lerp(1.4, 1.18, e), 0.36];
      p.legB = [U.lerp(1.8, 1.95, e), -0.3];
    } else if (f.attackT > 0) {
      p.armF = [0.34, -0.12];
      p.armB = [1.9, -0.4];
      p.lean = 0.2;
    }

    if (hurt) { p.lean -= 0.24; p.head = -0.22; }
    return p;
  }
  S.poseOf = poseOf;

  /* =====================================================================
   * 3D FIGHTERS
   *
   * Preferred path is three.js (fighters3d.js) — real meshes, PBR materials
   * and shadow maps, rendered to its own WebGL canvas and blitted in between
   * the painted stage and the 2D effects layer. If WebGL or the library is
   * unavailable we fall back to the hand-rolled canvas renderer in gfx3d.js,
   * which draws the same characters with the same joint angles.
   * =================================================================== */
  var TURN = 0.42;              // how far the fighters square up to camera
  var tried3D = false, has3D = false;

  /* Shed quality rather than frames: drop shadow maps first, and if the
     device still can't hold a playable rate, fall back to the canvas
     renderer for the rest of the session. Both need to be sustained, so a
     one-off hitch never triggers them. */
  var q3d = 2, lowT = 0;
  function adapt3D() {
    var fps = SH.game.fps;
    if (!fps) return;
    if (fps > 46) { lowT = Math.max(0, lowT - 0.05); return; }
    lowT += 1 / 60;
    if (q3d === 2 && lowT > 2) { q3d = 1; lowT = 0; SH.f3.shadows(false); }
    else if (q3d === 1 && fps < 30 && lowT > 4) {
      q3d = 0;
      has3D = false;
      setLayers(false);
      SH.f3.clear();
    }
  }

  function use3D() {
    if (!tried3D) {
      /* three.js may still be in flight — draw with the canvas renderer this
         frame and try again on the next. Latching here would strand the whole
         session on the fallback just for arriving early. */
      if (!SH.f3 || !SH.f3.available()) return false;
      tried3D = true;
      var c = document.getElementById('game3d');
      has3D = !!(c && SH.f3.init(c));
    }
    return has3D;
  }
  S.use3D = use3D;

  function camFor3D() {
    var R = SH.render;
    SH.g3.setCam({
      vw: R.vw, vh: R.vh,
      camX: S.cam.x, camY: S.cam.y, scale: S.cam.s,
      dist: 760, groundY: S.GROUND,
      shakeX: S.cam.sx, shakeY: S.cam.sy
    });
    if (S.theme === 'blight') { SH.g3.light(-0.34, 0.72, 0.6); SH.g3.setRim('#ff9a4a', 0.34); }
    else { SH.g3.light(-0.36, 0.78, 0.52); SH.g3.setRim('#9ec8ff', 0.4); }
  }

  /* Build one fighter into the current 3D batch. */
  S.buildFighter = function (f) {
    var G = SH.g3;
    var dir = Math.cos(f.facing) >= 0 ? 1 : -1;
    G.push();
    G.tx(f.x, f.z, 0);
    G.ry(dir > 0 ? -TURN : Math.PI + TURN);
    if (f.deathbringer) {
      SH.models3.deathbringer(f);
    } else {
      var p = poseOf(f);
      var B = SH.models3.buildOf(f.kitId);
      G.sc(B.scale, B.scale, B.scale);
      G.tx(0, -(p.crouch + p.bob) - (f.hitFlash > 0 ? 1 : 0), 0);
      SH.models3.humanoid(f, p, f.kit.colors, f.form > 0);
      if (f.form > 0) G.glow(0, 60, 0, 130, f.kit.colors.formGlow, 0.3);
      if (f.guard) G.glow(14, 58, 0, 60, '#9fd8ff', 0.34);
    }
    G.pop();
  };

  /* Kept for compatibility with the old call sites. */
  S.drawFighter = function (ctx, f) { S.buildFighter(f); };

  /* =====================================================================
   * PREVIEW (character select) — a slow turntable of the real model
   * =================================================================== */
  S.drawPreview = function (ctx, id, w, h, t, yaw) {
    if (use3D()) {
      var acc = id === 'deathbringer' ? '#ff7a12' : SH.kitById(id).colors.accent;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var gr = ctx.createRadialGradient(w * 0.5, h * 0.94, 2, w * 0.5, h * 0.94, w * 0.6);
      gr.addColorStop(0, U.rgba(acc, 0.26));
      gr.addColorStop(1, U.rgba(acc, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, h * 0.45, w, h * 0.55);
      var ok = SH.f3.preview(ctx, id, w, h, t, yaw);
      ctx.restore();
      if (ok) return;
    }
    var G = SH.g3;
    var isDB = id === 'deathbringer';
    var accent = isDB ? '#ff7a12' : SH.kitById(id).colors.accent;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var g = ctx.createRadialGradient(w * 0.5, h * 0.94, 2, w * 0.5, h * 0.94, w * 0.6);
    g.addColorStop(0, U.rgba(accent, 0.26));
    g.addColorStop(1, U.rgba(accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.45, w, h * 0.55);

    var tall = isDB ? 300 : 128;
    var scale = (h * 0.80) / tall;
    G.begin();
    G.setCam({
      vw: w, vh: h,
      camX: 0, camY: -tall * 0.46, scale: scale,
      dist: 1400, groundY: 0, shakeX: 0, shakeY: 0
    });
    G.light(-0.3, 0.74, 0.6);
    G.setRim(accent, 0.42);

    var fake;
    if (isDB) {
      fake = { deathbringer: true, x: 0, y: 0, z: 0, facing: 0, anim: t, state: 'idle', enraged: false };
    } else {
      var kit = SH.kitById(id);
      fake = {
        kitId: id, kit: kit, x: 0, y: 0, z: 0, facing: 0, form: 0, grounded: true,
        vx: 0, vz: 0, hitFlash: 0, attackT: 0, guard: 0,
        anim: { t: t, swing: -1, swingDir: 1, wing: 0 }
      };
    }
    G.push();
    G.ry(Math.sin(t * 0.55) * 0.55 - 0.15);
    var save = TURN;
    TURN = 0;
    S.buildFighter(fake);
    TURN = save;
    G.pop();
    G.render(ctx);
    G.renderGlows(ctx);
    ctx.restore();
  };
})();
