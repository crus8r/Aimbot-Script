/* VANGUARD — sideview.js
 * Side-on "fighting game" presentation: stage backdrops, a full-body
 * character rig for every hero, and Deathbringer.
 *
 * The engine already stores x / y / z and draws entities at (x, y - z).
 * Versus mode pins every fighter to one y lane, so that same convention
 * becomes a true side view and all existing VFX render unchanged.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var S = (SH.side = {
    GROUND: 2000,        // the y lane every fighter stands on
    STAGE_W: 1560,
    H: 110,              // body height in world units
    cam: { x: 0, y: 0, s: 1.4, sx: 0, sy: 0 },
    theme: 'blight'
  });

  var TAU = U.TAU;

  /* =====================================================================
   * CAMERA
   * =================================================================== */
  S.follow = function (a, b, dt, snap) {
    var R = SH.render;
    var mid = (a.x + b.x) / 2;
    var spread = Math.abs(a.x - b.x);
    var topZ = Math.max(a.z, b.z);
    var tall = Math.max(fighterTop(a), fighterTop(b));
    // zoom out as they separate, leap, or when something huge is on stage
    var want = U.clamp(Math.min(R.vw / (spread + 420), R.vh / (tall + 96 + topZ * 1.05)), 0.5, 1.55);
    var cy = S.GROUND - (tall + topZ) * 0.42;
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

  function fighterTop(f) { return f.deathbringer ? 300 : 132; }

  /* =====================================================================
   * FRAME
   * =================================================================== */
  S.draw = function (vs) {
    var R = SH.render, ctx = R.ctx, cam = S.cam;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    drawSky(ctx, R);

    ctx.save();
    ctx.translate(R.vw / 2, R.vh / 2);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x - cam.sx, -cam.y - cam.sy);

    var hw = R.vw / cam.s / 2 + 120, hh = R.vh / cam.s / 2 + 200;
    var v = R.view;
    v.x0 = cam.x - hw; v.x1 = cam.x + hw;
    v.y0 = cam.y - hh; v.y1 = cam.y + hh;

    drawBackdrop(ctx, v);
    drawGround(ctx, v);
    drawHazards(ctx, v);
    drawTelegraphs(ctx, v);

    // shadows
    var list = vs.fighters;
    for (var i = 0; i < list.length; i++) shadow(ctx, list[i]);

    // projectiles + fighters, back to front by z so leaps read clearly
    var pr = SH.ents.projectiles;
    for (var j = 0; j < pr.length; j++) SH.render.proj(ctx, pr[j]);

    for (var k = 0; k < list.length; k++) {
      var f = list[k];
      if (f === vs.you) continue;
      S.drawFighter(ctx, f);
    }
    if (vs.you) S.drawFighter(ctx, vs.you);

    SH.render.parts(ctx, v);
    SH.render.overheads(ctx, v);

    ctx.restore();

    var dark = SH.darknessLevel();
    if (dark > 0) {
      var g = ctx.createRadialGradient(R.vw / 2, R.vh * 0.55, R.vh * 0.14, R.vw / 2, R.vh * 0.55, R.vh * 0.95);
      g.addColorStop(0, 'rgba(4,2,8,' + (dark * 0.45).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(2,1,5,' + (dark * 0.97).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, R.vw, R.vh);
    }
  };

  function drawSky(ctx, R) {
    var g = ctx.createLinearGradient(0, 0, 0, R.vh);
    if (S.theme === 'blight') {
      g.addColorStop(0, '#0a0610');
      g.addColorStop(0.55, '#150a12');
      g.addColorStop(1, '#2a1408');
    } else {
      g.addColorStop(0, '#05070f');
      g.addColorStop(0.6, '#0b1020');
      g.addColorStop(1, '#16223a');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, R.vw, R.vh);
  }

  /* ---------------------------------------------------------- backdrop */
  function drawBackdrop(ctx, v) {
    var cam = S.cam;
    var horizon = S.GROUND;
    var layers = [
      { d: 0.18, h: 340, col: S.theme === 'blight' ? '#150c18' : '#0d1424', step: 190 },
      { d: 0.36, h: 250, col: S.theme === 'blight' ? '#1c1020' : '#111a2e', step: 140 },
      { d: 0.62, h: 170, col: S.theme === 'blight' ? '#241528' : '#16223a', step: 105 }
    ];
    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      var ox = cam.x * (1 - L.d);
      var x0 = Math.floor((v.x0 + ox) / L.step) * L.step - ox;
      ctx.fillStyle = L.col;
      for (var x = x0; x < v.x1 + L.step; x += L.step) {
        var seed = U.hash(Math.round((x + ox) / L.step) * 13.7, l * 7.1);
        var w = L.step * (0.55 + seed * 0.4);
        var hgt = L.h * (0.42 + seed * 0.72);
        ctx.fillRect(x, horizon - hgt, w, hgt);
        // a few lit windows
        if (l === 2 && seed > 0.4) {
          ctx.fillStyle = S.theme === 'blight' ? 'rgba(255,122,18,0.20)' : 'rgba(120,180,255,0.16)';
          for (var wy = 0; wy < 4; wy++) {
            var s2 = U.hash(x * 0.7 + wy, l + 3);
            if (s2 < 0.45) continue;
            ctx.fillRect(x + w * 0.22 + (s2 * w * 0.5), horizon - hgt + 16 + wy * 26, 7, 11);
          }
          ctx.fillStyle = L.col;
        }
      }
    }

    if (S.theme === 'blight') {
      // dead grove — bare black trees behind the fighting plane
      ctx.save();
      var ox2 = cam.x * 0.22;
      for (var t = 0; t < 9; t++) {
        var tx = t * 260 - 300 - ox2 * 0.4;
        var sd = U.hash(t * 5.3, 2.2);
        ctx.globalAlpha = 0.75;
        drawDeadTree(ctx, tx, horizon + 6, 150 + sd * 130, sd);
      }
      ctx.restore();
      // orange haze at the horizon
      var gg = ctx.createLinearGradient(0, horizon - 200, 0, horizon);
      gg.addColorStop(0, 'rgba(255,122,18,0)');
      gg.addColorStop(1, 'rgba(255,122,18,0.13)');
      ctx.fillStyle = gg;
      ctx.fillRect(v.x0, horizon - 200, v.x1 - v.x0, 200);
    }
  }

  function drawDeadTree(ctx, x, groundY, h, seed) {
    ctx.strokeStyle = '#0a0610';
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x + (seed - 0.5) * 14, groundY - h);
    ctx.stroke();
    ctx.lineWidth = 4.5;
    for (var i = 0; i < 5; i++) {
      var f = 0.42 + i * 0.13;
      var by = groundY - h * f;
      var dir = i % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x, by);
      ctx.quadraticCurveTo(x + dir * h * 0.2, by - h * 0.1, x + dir * h * (0.26 + seed * 0.12), by - h * 0.24);
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------ ground */
  function drawGround(ctx, v) {
    var y = S.GROUND;
    var g = ctx.createLinearGradient(0, y, 0, y + 300);
    if (S.theme === 'blight') {
      g.addColorStop(0, '#1a0f14'); g.addColorStop(1, '#080409');
    } else {
      g.addColorStop(0, '#141c2c'); g.addColorStop(1, '#070a12');
    }
    ctx.fillStyle = g;
    ctx.fillRect(v.x0, y, v.x1 - v.x0, 400);

    // lip
    ctx.strokeStyle = S.theme === 'blight' ? 'rgba(255,122,18,0.32)' : 'rgba(140,190,255,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); ctx.stroke();

    // receding floor stripes
    ctx.strokeStyle = S.theme === 'blight' ? 'rgba(255,122,18,0.07)' : 'rgba(150,190,255,0.07)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var step = 120;
    var x0 = Math.floor(v.x0 / step) * step;
    for (var x = x0; x < v.x1; x += step) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + (x - S.cam.x) * 0.55, y + 260);
    }
    ctx.stroke();
    for (var d = 1; d <= 4; d++) {
      var yy = y + d * d * 15;
      ctx.beginPath(); ctx.moveTo(v.x0, yy); ctx.lineTo(v.x1, yy); ctx.stroke();
    }

    // stage edges
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (v.x0 < 0) ctx.fillRect(v.x0, y - 600, -v.x0, 1000);
    if (v.x1 > S.STAGE_W) ctx.fillRect(S.STAGE_W, y - 600, v.x1 - S.STAGE_W, 1000);
  }

  function shadow(ctx, f) {
    var r = (f.deathbringer ? 74 : 34) * U.clamp(1 - f.z / 420, 0.3, 1);
    ctx.globalAlpha = 0.42 * U.clamp(1 - f.z / 500, 0.25, 1);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(f.x, S.GROUND + 3, r, r * 0.24, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------- hazards on stage */
  function drawHazards(ctx, v) {
    var list = SH.ents.hazards;
    var y = S.GROUND;
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.x + h.r < v.x0 || h.x - h.r > v.x1) continue;
      ctx.save();
      if (h.delay > 0) {
        var fill = 1 - U.clamp(h.delay / (h.data.delayMax || h.maxLife || 1), 0, 1);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = h.color;
        ctx.fillRect(h.x - h.r, y - 3, h.r * 2, 6);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(h.x - h.r * fill, y - 5, h.r * 2 * fill, 10);
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = h.color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(h.x - h.r, y - 16); ctx.lineTo(h.x - h.r, y); ctx.lineTo(h.x - h.r + 12, y);
        ctx.moveTo(h.x + h.r, y - 16); ctx.lineTo(h.x + h.r, y); ctx.lineTo(h.x + h.r - 12, y);
        ctx.stroke();
      } else {
        var frac = U.clamp(h.life / h.maxLife, 0, 1);
        ctx.globalAlpha = 0.22 * U.clamp(frac * 3, 0, 1);
        ctx.fillStyle = h.color;
        ctx.beginPath();
        ctx.ellipse(h.x, y, h.r, Math.max(7, h.r * 0.2), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.5 * U.clamp(frac * 3, 0, 1);
        ctx.strokeStyle = h.color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(h.x, y, h.r, Math.max(7, h.r * 0.2), 0, 0, TAU);
        ctx.stroke();
        if (h.kind === 'storm' || h.kind === 'heal') {
          ctx.globalAlpha = 0.1 * frac;
          ctx.fillRect(h.x - h.r, y - 260, h.r * 2, 260);
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
        ctx.fillRect(e.x, y - 96, dir * 400 * (0.35 + t * 0.65), 96);
      } else if (e.tele.kind === 'aim') {
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 10]);
        var p = SH.game.player();
        if (p) {
          ctx.beginPath();
          ctx.moveTo(e.x, y - e.h * 0.6);
          ctx.quadraticCurveTo((e.x + p.x) / 2, y - 240, p.x, y - p.z);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      } else {
        var r = e.tele.r * t;
        ctx.fillRect(e.x - r, y - 10, r * 2, 14);
        var gg = ctx.createLinearGradient(0, y - 170, 0, y);
        gg.addColorStop(0, U.rgba(e.tele.color, 0));
        gg.addColorStop(1, U.rgba(e.tele.color, 0.3));
        ctx.globalAlpha = 0.5 + t * 0.4;
        ctx.fillStyle = gg;
        ctx.fillRect(e.x - r, y - 170, r * 2, 170);
      }
      ctx.restore();
    }
  }

  /* =====================================================================
   * THE RIG
   * =================================================================== */
  function limb(ctx, x, y, a1, l1, a2, l2, w, col, outline, handCol) {
    var ex = x + Math.cos(a1) * l1, ey = y + Math.sin(a1) * l1;
    var fx = ex + Math.cos(a1 + a2) * l2, fy = ey + Math.sin(a1 + a2) * l2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = w + 3.4;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.lineTo(fx, fy);
      ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.lineTo(fx, fy);
    ctx.stroke();
    if (handCol) {
      ctx.fillStyle = handCol;
      ctx.beginPath(); ctx.arc(fx, fy, w * 0.62, 0, TAU); ctx.fill();
    }
    return { x: fx, y: fy, ex: ex, ey: ey };
  }
  var INK = 'rgba(0,0,0,0.5)';

  /* Build the pose for this frame. Local space: feet at 0,0 — up is -y,
     forward is +x. */
  function poseOf(f) {
    var t = (f.anim && f.anim.t) || 0;
    var speed = Math.abs(f.vx || 0);
    var walking = f.grounded !== false && speed > 30;
    var air = f.grounded === false;
    var swing = (f.anim && f.anim.swing > 0) ? U.clamp(1 - f.anim.swing / 0.3, 0, 1) : -1;
    var hurt = (f.hitFlash || 0) > 0.02;

    var p = {
      bob: 0, lean: 0, crouch: 0,
      armF: [1.15, -0.5], armB: [1.32, -0.42],
      legF: [1.44, 0.18], legB: [1.74, -0.18],
      head: 0, swing: swing, air: air, walking: walking, t: t
    };

    if (f.ko) {
      p.fall = -1.32; p.crouch = 40;
      p.armF = [2.5, 0.3]; p.armB = [2.2, 0.2];
      p.legF = [2.9, 0.5]; p.legB = [3.1, 0.4];
      return p;
    }

    if (f.guard) {
      p.crouch = 10; p.lean = -0.14;
      p.armF = [0.75, -1.7]; p.armB = [1.0, -1.6];
      p.legF = [1.3, 0.34]; p.legB = [1.92, -0.34];
      p.bob = Math.sin(t * 5) * 0.6;
      return p;
    }

    if (air) {
      var rise = U.clamp((f.vz || 0) / 640, -1, 1);
      p.crouch = 6;
      p.lean = 0.1 + rise * 0.12;
      p.legF = [1.05 - rise * 0.4, 0.95];
      p.legB = [1.72 + rise * 0.12, 0.6];
      p.armF = [0.55 - rise * 0.75, -0.7];
      p.armB = [1.9 + rise * 0.35, 0.5];
    } else if (walking) {
      var ph = t * (8 + Math.min(speed, 620) * 0.017);
      var amp = U.clamp(speed / 260, 0.35, 1.25);
      p.legF = [1.55 + Math.sin(ph) * 0.6 * amp, 0.14 + Math.max(0, Math.cos(ph)) * 0.5];
      p.legB = [1.55 + Math.sin(ph + Math.PI) * 0.6 * amp, 0.14 + Math.max(0, Math.cos(ph + Math.PI)) * 0.5];
      p.armF = [1.15 + Math.sin(ph + Math.PI) * 0.42 * amp, -0.5];
      p.armB = [1.3 + Math.sin(ph) * 0.42 * amp, -0.45];
      p.bob = Math.abs(Math.sin(ph)) * 2.6 * amp;
      p.lean = 0.1 * amp;
    } else {
      p.bob = Math.sin(t * 2.6) * 1.5;
      p.armF = [1.12 + Math.sin(t * 2.6) * 0.05, -0.52];
      p.armB = [1.34 + Math.sin(t * 2.6 + 1) * 0.05, -0.44];
      p.legF = [1.44, 0.18];
      p.legB = [1.74, -0.18];
    }

    if (swing >= 0) {
      // wind up overhead and behind, then drive forward and down
      var e = U.ease(swing);
      p.armF = [U.lerp(-1.55, 0.62, e), U.lerp(-0.45, 0.18, e)];
      p.armB = [U.lerp(1.9, 2.5, e), -0.4];
      p.lean = U.lerp(-0.22, 0.32, e);
      p.crouch = 5 * Math.sin(e * Math.PI);
    } else if (f.attackT > 0) {
      p.armF = [0.35, 0.05];
      p.lean = 0.18;
    }

    if (hurt) { p.lean -= 0.22; p.head = -0.2; }
    return p;
  }

  /* =====================================================================
   * FIGHTERS
   * =================================================================== */
  S.drawFighter = function (ctx, f, previewScale) {
    if (f.deathbringer) return drawDeathbringer(ctx, f, previewScale);
    var K = f.kit.colors;
    var p = poseOf(f);
    var dir = Math.cos(f.facing) >= 0 ? 1 : -1;
    var gx = f.x, gy = S.GROUND - f.z;

    ctx.save();
    ctx.translate(gx, gy);
    if (previewScale) ctx.scale(previewScale, previewScale);
    ctx.scale(dir, 1);
    ctx.translate(0, p.crouch + p.bob);

    var inForm = f.form > 0;
    if (inForm) {
      ctx.globalAlpha = 0.85;
      SH.render.glowAt(ctx, 0, -58, 130, K.formGlow, 0.32);
      ctx.globalAlpha = 1;
    }

    // anchor points
    var hipY = -52, shoY = -82, headY = -99;
    var lean = p.lean;

    ctx.save();
    ctx.translate(0, hipY);
    ctx.rotate(p.fall !== undefined ? p.fall : -lean * 0.22);
    ctx.translate(0, -hipY);

    var back = HERO_SIDE[f.kitId];
    if (back.back) back.back(ctx, f, K, p, inForm);

    // back leg + arm first
    limb(ctx, -3, hipY, p.legB[0], 26, p.legB[1], 25, 10.5, shade(K.dark, -0.12), INK);
    var handB = limb(ctx, -3, shoY + 3, p.armB[0], 21, p.armB[1], 19, 8.5,
      shade(K.mid, -0.16), INK, shade(K.mid, -0.1));

    // neck
    ctx.fillStyle = K.dark;
    ctx.fillRect(-1, shoY - 8, 7, 10);
    // torso
    ctx.fillStyle = K.base;
    ctx.beginPath();
    ctx.moveTo(-10, hipY + 4);
    ctx.quadraticCurveTo(-13, shoY + 8, -10, shoY - 2);
    ctx.lineTo(11, shoY - 2);
    ctx.quadraticCurveTo(13, shoY + 10, 9, hipY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(K.dark, 0.05);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // hips
    ctx.fillStyle = K.dark;
    ctx.beginPath();
    ctx.ellipse(-1, hipY + 2, 11, 8, 0, 0, TAU);
    ctx.fill();

    if (back.chest) back.chest(ctx, f, K, p, inForm);

    // front leg
    limb(ctx, 3, hipY, p.legF[0], 26, p.legF[1], 25, 11, K.dark, INK);

    // pauldrons, then the near arm on top of them
    if (back.shoulders) back.shoulders(ctx, f, K, p, inForm);
    var handF = limb(ctx, 4, shoY + 3, p.armF[0], 21, p.armF[1], 19, 9.5,
      shade(K.mid, 0.05), INK, shade(K.mid, 0.1));

    // head
    ctx.save();
    ctx.translate(1, headY);
    ctx.rotate(p.head + lean * 0.12);
    ctx.scale(0.72, 0.72);          // heroic proportions, not bobbleheads
    back.head(ctx, f, K, p, inForm);
    ctx.restore();

    // weapon in the front hand
    if (back.weapon) back.weapon(ctx, f, K, p, inForm, handF, handB);

    ctx.restore(); // lean

    if (f.hitFlash > 0) {
      ctx.globalAlpha = U.clamp(f.hitFlash / 0.16, 0, 1) * 0.55;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(0, -55, 26, 58, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (f.guard) {
      ctx.globalAlpha = 0.3 + Math.sin((f.anim.t || 0) * 14) * 0.08;
      ctx.strokeStyle = '#9fd8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(6, -55, 30, 62, 0, -1.4, 1.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  function shade(hex, amt) {
    var c = U.rgba(hex, 1).match(/\d+/g);
    var f = function (v) { return U.clamp(Math.round(+v + amt * 255), 0, 255); };
    return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
  }

  /* ------------------------------------------------------- hero details */
  var HERO_SIDE = {

    /* ---- SAVIOR: white knight plate, green crystal, shortsword ---- */
    savior: {
      shoulders: function (ctx, f, K) {
        ctx.fillStyle = K.mid;
        ctx.beginPath(); ctx.arc(-2, -79, 7.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = K.accent; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.fillStyle = K.base;
        ctx.beginPath(); ctx.arc(4, -78, 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = K.accent; ctx.stroke();
      },
      chest: function (ctx, f, K, p, inForm) {
        SH.render.glowAt(ctx, 2, -66, 22, K.accent, inForm ? 0.85 : 0.5);
        ctx.fillStyle = K.accent;
        ctx.beginPath();
        ctx.moveTo(2, -74); ctx.lineTo(9, -66); ctx.lineTo(2, -57); ctx.lineTo(-5, -66);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(2, -70); ctx.lineTo(5.5, -66); ctx.lineTo(2, -61); ctx.lineTo(-1.5, -66);
        ctx.closePath(); ctx.fill();
      },
      head: function (ctx, f, K, p, inForm) {
        ctx.fillStyle = K.base;
        ctx.beginPath(); ctx.ellipse(0, 0, 13, 15, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = K.mid;   // brow ridge / crest
        ctx.beginPath();
        ctx.moveTo(-12, -6); ctx.quadraticCurveTo(0, -20, 12, -7);
        ctx.lineTo(11, -2); ctx.quadraticCurveTo(0, -13, -11, -1);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = K.dark;  // visor slot
        ctx.beginPath();
        ctx.moveTo(2, -5); ctx.lineTo(14, -2); ctx.lineTo(13, 4); ctx.lineTo(2, 3);
        ctx.closePath(); ctx.fill();
        SH.render.glowAt(ctx, 9, 0, 12, K.accent, inForm ? 0.95 : 0.7);
        ctx.fillStyle = K.accent;
        ctx.fillRect(5, -2.5, 8, 3.6);
        ctx.fillStyle = K.mid;   // jaw guard
        ctx.beginPath();
        ctx.moveTo(3, 6); ctx.lineTo(12, 5); ctx.lineTo(10, 12); ctx.lineTo(2, 12);
        ctx.closePath(); ctx.fill();
      },
      weapon: function (ctx, f, K, p, inForm, hand) {
        ctx.save();
        ctx.translate(hand.x, hand.y);
        ctx.rotate(p.armF[0] + p.armF[1] + (p.swing >= 0 ? 0.3 : 0.5));
        SH.render.glowAt(ctx, 26, 0, 26, K.accent, inForm ? 0.7 : 0.32);
        ctx.fillStyle = K.mid;
        ctx.fillRect(-5, -2.6, 9, 5.2);            // grip
        ctx.fillStyle = K.trim;
        ctx.fillRect(3, -6, 3.4, 12);              // guard
        ctx.fillStyle = '#e8eef8';                 // blade
        ctx.beginPath();
        ctx.moveTo(6, -3.4); ctx.lineTo(46, -1.6); ctx.lineTo(50, 0);
        ctx.lineTo(46, 1.6); ctx.lineTo(6, 3.4);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = K.accent; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(45, 0); ctx.stroke();
        ctx.restore();
      }
    },

    /* ---- EXODUS: black tech weave, goggles, long hair, twin whips ---- */
    exodus: {
      back: function (ctx, f, K, p) {
        var t = p.t, sway = Math.sin(t * 7) * 6 - Math.abs(f.vx || 0) * 0.035;
        ctx.fillStyle = K.hair;                    // long black hair
        ctx.beginPath();
        ctx.moveTo(2, -104);
        ctx.quadraticCurveTo(-26 + sway * 0.4, -96, -30 + sway, -66);
        ctx.quadraticCurveTo(-26 + sway, -46, -12, -52);
        ctx.quadraticCurveTo(-16, -74, -4, -92);
        ctx.closePath(); ctx.fill();
      },
      shoulders: function (ctx, f, K) {
        ctx.fillStyle = K.mid;
        ctx.beginPath(); ctx.arc(-2, -79, 6.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(4, -78, 6, 0, TAU); ctx.fill();
      },
      chest: function (ctx, f, K, p, inForm) {
        var col = inForm ? K.formGlow : K.accent;
        ctx.strokeStyle = col; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-8, -72); ctx.lineTo(5, -66); ctx.lineTo(-6, -60); ctx.lineTo(6, -55);
        ctx.stroke();
        SH.render.glowAt(ctx, 0, -66, 20, col, 0.3);
      },
      head: function (ctx, f, K, p, inForm) {
        var col = inForm ? K.formGlow : K.accent;
        ctx.fillStyle = K.hair;                    // hair mass
        ctx.beginPath(); ctx.ellipse(-2, -2, 14, 15, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = K.mid;                     // face wrap
        ctx.beginPath(); ctx.ellipse(2, 1, 11.5, 13, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#0a0c10';                 // lower mask
        ctx.beginPath();
        ctx.moveTo(1, 2); ctx.quadraticCurveTo(14, 3, 12, 12);
        ctx.quadraticCurveTo(2, 15, -2, 9);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0d1016';                 // goggle strap
        ctx.fillRect(-12, -6, 26, 7);
        SH.render.glowAt(ctx, 9, -2.5, 13, col, 0.9);
        ctx.fillStyle = col;                       // lens
        ctx.beginPath(); ctx.ellipse(9, -2.5, 5, 3.4, -0.15, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.ellipse(10.5, -3.4, 1.7, 1.1, 0, 0, TAU); ctx.fill();
      },
      weapon: function (ctx, f, K, p, inForm, hand, handB) {
        var col = inForm ? K.formGlow : K.accent;
        var t = p.t;
        for (var s = 0; s < 2; s++) {
          var hd = s ? handB : hand;
          var lash = p.swing >= 0 && s === 0 ? p.swing : -1;
          ctx.save();
          ctx.translate(hd.x, hd.y);
          var base = lash >= 0 ? U.lerp(-2.2, 0.5, U.ease(lash)) : (s ? -0.5 : 0.35) + Math.sin(t * 2.5 + s) * 0.15;
          ctx.rotate(base);
          var len = lash >= 0 ? 96 : 44;
          ctx.strokeStyle = col;
          ctx.lineCap = 'round';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          for (var i = 1; i <= 6; i++) {
            var fr = i / 6;
            ctx.lineTo(len * fr, Math.sin(t * 15 + i * 1.2 + s * 2) * 7 * fr * (lash >= 0 ? 1.7 : 1));
          }
          ctx.stroke();
          ctx.globalAlpha = 0.35; ctx.lineWidth = 8; ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }
    },

    /* ---- PARAGON: blue/gold plate, domino mask, hammer or spear ---- */
    paragon: {
      back: function (ctx, f, K, p, inForm) {
        if (!inForm) return;
        var w = U.ease(U.clamp(f.anim.wing, 0, 1));
        var flap = Math.sin(p.t * 5) * 0.2;
        ctx.save();
        ctx.globalAlpha = 0.55;
        for (var s = -1; s <= 1; s += 2) {
          ctx.save();
          ctx.translate(-6, -72);
          ctx.rotate(-0.5 + s * 0.42 + flap * s);
          SH.render.glowAt(ctx, -40, -10, 90, K.formGlow, 0.4);
          ctx.fillStyle = U.rgba(K.formGlow, 0.7);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(-46 * w, -40 * w, -96 * w, -18 * w);
          ctx.quadraticCurveTo(-54 * w, 6 * w, 0, 14);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      },
      shoulders: function (ctx, f, K) {
        ctx.fillStyle = K.accent;
        ctx.beginPath(); ctx.arc(-3, -80, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = shade(K.accent, -0.08);
        ctx.beginPath(); ctx.arc(5, -79, 7.5, 0, TAU); ctx.fill();
      },
      chest: function (ctx, f, K, p, inForm) {
        ctx.strokeStyle = K.accent; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(0, -64, 9, -1.1, 1.1); ctx.stroke();
        SH.render.glowAt(ctx, 2, -66, 18, K.accent, inForm ? 0.7 : 0.32);
        ctx.fillStyle = K.accent;
        ctx.beginPath();
        ctx.moveTo(2, -72); ctx.lineTo(8, -65); ctx.lineTo(2, -58); ctx.lineTo(-3, -65);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = K.dark;   // belt
        ctx.fillRect(-10, -50, 20, 5);
      },
      head: function (ctx, f, K, p, inForm) {
        ctx.fillStyle = '#f0c9a0';                 // face — open lower half
        ctx.beginPath(); ctx.ellipse(1, 1, 12, 14, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = K.hair;                    // short blond hair
        ctx.beginPath();
        ctx.moveTo(-13, -2);
        ctx.quadraticCurveTo(-12, -18, 3, -16);
        ctx.quadraticCurveTo(14, -14, 12, -4);
        ctx.quadraticCurveTo(4, -11, -5, -8);
        ctx.quadraticCurveTo(-10, -6, -13, -2);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = K.base;                    // domino mask
        ctx.beginPath();
        ctx.moveTo(-11, -5); ctx.lineTo(13, -4);
        ctx.quadraticCurveTo(15, 3, 12, 4);
        ctx.lineTo(-10, 2);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = K.accent; ctx.lineWidth = 1.1; ctx.stroke();
        ctx.fillStyle = '#12305f';                 // open eye lens
        ctx.beginPath(); ctx.ellipse(7, -0.5, 3.4, 2.2, 0, 0, TAU); ctx.fill();
        if (inForm) SH.render.glowAt(ctx, 7, -0.5, 14, K.formGlow, 0.8);
      },
      weapon: function (ctx, f, K, p, inForm, hand) {
        ctx.save();
        ctx.translate(hand.x, hand.y);
        ctx.rotate(p.armF[0] + p.armF[1] + (p.swing >= 0 ? 0.15 : 0.8));
        if (inForm) {                              // radiant spear
          SH.render.glowAt(ctx, 40, 0, 60, K.formGlow, 0.55);
          ctx.fillStyle = '#fff6d8';
          ctx.fillRect(-30, -2.2, 88, 4.4);
          ctx.beginPath();
          ctx.moveTo(80, 0); ctx.lineTo(58, 7); ctx.lineTo(62, 0); ctx.lineTo(58, -7);
          ctx.closePath(); ctx.fill();
        } else {                                   // war hammer
          ctx.strokeStyle = '#6b4a33'; ctx.lineWidth = 7; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(44, 0); ctx.stroke();
          SH.render.glowAt(ctx, 54, 0, 40, K.accent, 0.32);
          ctx.fillStyle = '#0d1a2e';
          ctx.fillRect(41, -21, 28, 42);
          ctx.fillStyle = K.mid;
          ctx.fillRect(43, -19, 24, 38);
          ctx.fillStyle = K.accent;
          ctx.fillRect(43, -19, 6, 38);
          ctx.fillRect(61, -19, 6, 38);
        }
        ctx.restore();
      }
    },

    /* ---- DOMINUS: cape, hood with no face, twin blades ---- */
    dominus: {
      back: function (ctx, f, K, p, inForm) {
        var col = inForm ? K.formGlow : K.accent;
        var sway = Math.sin(p.t * 4) * 7 - (f.vx || 0) * 0.05;
        ctx.fillStyle = K.dark;
        ctx.beginPath();
        ctx.moveTo(4, -84);
        ctx.quadraticCurveTo(-34 + sway * 0.5, -78, -40 + sway, -26);
        ctx.quadraticCurveTo(-34 + sway, -2, -8, -6);
        ctx.quadraticCurveTo(-14, -46, -2, -78);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.globalAlpha = 1;
      },
      shoulders: function (ctx, f, K, p, inForm) {
        ctx.fillStyle = K.mid;
        ctx.beginPath(); ctx.arc(-2, -80, 6.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(4, -79, 5.8, 0, TAU); ctx.fill();
      },
      chest: function (ctx, f, K, p, inForm) {
        var col = inForm ? K.formGlow : K.accent;
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-7, -73); ctx.lineTo(4, -64); ctx.lineTo(-7, -55);
        ctx.stroke();
        SH.render.glowAt(ctx, 0, -64, 22, col, 0.22);
      },
      head: function (ctx, f, K, p, inForm) {
        var col = inForm ? K.formGlow : K.accent;
        ctx.fillStyle = K.mid;                     // hood
        ctx.beginPath();
        ctx.moveTo(-13, 12);
        ctx.quadraticCurveTo(-17, -14, 0, -17);
        ctx.quadraticCurveTo(15, -15, 15, 3);
        ctx.quadraticCurveTo(14, 12, 8, 14);
        ctx.quadraticCurveTo(-4, 17, -13, 12);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#000';                    // the void under the hood
        ctx.beginPath(); ctx.ellipse(6, 1, 8, 10, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.5;
        SH.render.glowAt(ctx, 6, 1, 15, col, 0.5);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = shade(K.mid, 0.08); ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-13, 12); ctx.quadraticCurveTo(-17, -14, 0, -17);
        ctx.quadraticCurveTo(15, -15, 15, 3);
        ctx.stroke();
      },
      weapon: function (ctx, f, K, p, inForm, hand, handB) {
        var col = inForm ? K.formGlow : K.accent;
        for (var s = 0; s < 2; s++) {
          var hd = s ? handB : hand;
          ctx.save();
          ctx.translate(hd.x, hd.y);
          ctx.rotate(s ? p.armB[0] + p.armB[1] + 0.4 : p.armF[0] + p.armF[1] + (p.swing >= 0 ? 0.1 : 0.7));
          SH.render.glowAt(ctx, 16, 0, 24, col, 0.42);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(34, 0); ctx.lineTo(6, 4.4); ctx.lineTo(1, 0); ctx.lineTo(6, -4.4);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = K.dark;
          ctx.fillRect(-6, -2.2, 8, 4.4);
          ctx.restore();
        }
      }
    },

    /* ---- VITALITY: amber face plate, long brown hair, constructs ---- */
    vitality: {
      back: function (ctx, f, K, p) {
        var sway = Math.sin(p.t * 5) * 5 - (f.vx || 0) * 0.03;
        ctx.fillStyle = K.hair;
        ctx.beginPath();
        ctx.moveTo(3, -102);
        ctx.quadraticCurveTo(-24 + sway * 0.4, -92, -27 + sway, -58);
        ctx.quadraticCurveTo(-23 + sway, -38, -10, -44);
        ctx.quadraticCurveTo(-15, -70, -3, -90);
        ctx.closePath(); ctx.fill();
      },
      shoulders: function (ctx, f, K) {
        ctx.fillStyle = K.mid;
        ctx.beginPath(); ctx.arc(-2, -79, 6.4, 0, TAU); ctx.fill();
        ctx.fillStyle = K.accent;
        ctx.beginPath(); ctx.arc(4, -78, 6, 0, TAU); ctx.fill();
      },
      chest: function (ctx, f, K, p, inForm) {
        SH.render.glowAt(ctx, 1, -65, 15, K.accent, inForm ? 0.6 : 0.32);
        ctx.fillStyle = K.accent;
        ctx.beginPath();
        ctx.moveTo(1, -74); ctx.lineTo(8, -66); ctx.lineTo(5, -57);
        ctx.lineTo(-4, -55); ctx.lineTo(-6, -66);
        ctx.closePath(); ctx.fill();
        // orbiting amber shards
        var n = inForm ? 5 : 3;
        for (var i = 0; i < n; i++) {
          var a = p.t * 2 + (i / n) * TAU;
          var px = Math.cos(a) * 15 + 5, py = -64 + Math.sin(a) * 12;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(a * 1.4);
          SH.render.glowAt(ctx, 0, 0, 8, K.accent, 0.45);
          ctx.fillStyle = K.accent;
          ctx.beginPath();
          ctx.moveTo(0, -3.6); ctx.lineTo(1.8, 0); ctx.lineTo(0, 3.6); ctx.lineTo(-1.8, 0);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      },
      head: function (ctx, f, K, p, inForm) {
        ctx.fillStyle = K.hair;
        ctx.beginPath(); ctx.ellipse(-2, -1, 13.5, 15, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a2430';
        ctx.beginPath(); ctx.ellipse(2, 1, 11, 13, 0, 0, TAU); ctx.fill();
        SH.render.glowAt(ctx, 7, 1, 18, K.accent, inForm ? 0.7 : 0.4);
        ctx.fillStyle = K.accent;                  // face plate
        ctx.beginPath();
        ctx.moveTo(-2, -11);
        ctx.quadraticCurveTo(13, -9, 13, 1);
        ctx.quadraticCurveTo(12, 11, 1, 12);
        ctx.quadraticCurveTo(-3, 4, -2, -11);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(6, -3, 6, 2.6);
      },
      weapon: function (ctx, f, K, p, inForm, hand) {
        if (p.swing < 0) return;
        ctx.save();
        ctx.translate(hand.x, hand.y);
        ctx.rotate(p.armF[0] + p.armF[1] + 0.2);
        SH.render.glowAt(ctx, 22, 0, 30, K.accent, 0.55);
        ctx.fillStyle = K.accent;
        ctx.beginPath();
        ctx.moveTo(44, 0); ctx.lineTo(4, 5); ctx.lineTo(4, -5);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  };

  /* =====================================================================
   * DEATHBRINGER — pitch-black ent, orange eyes, dripping mucus
   * =================================================================== */
  function drawDeathbringer(ctx, f, previewScale) {
    var t = (f.anim || 0);
    if (typeof t !== 'number') t = 0;
    var dir = Math.cos(f.facing) >= 0 ? 1 : -1;
    var gx = f.x, gy = S.GROUND - f.z;
    var rage = f.enraged ? 1 : 0;
    var eye = '#ff7a12';
    var BLACK = '#06050a';
    var BLACK2 = '#0d0b14';
    var scale = (previewScale || 1) * (f.sideScale || 1);
    var sway = Math.sin(t * 0.9) * 0.035;
    var lunging = f.state === 'lunge';

    ctx.save();
    ctx.translate(gx, gy);
    ctx.scale(scale, scale);
    ctx.scale(dir, 1);

    // an aura of pure dark
    ctx.globalAlpha = 0.55;
    SH.render.glowAt(ctx, 0, -110, 210, '#140a1c', 0.9);
    ctx.globalAlpha = 1;

    if (f.ko) {
      var fall = U.clamp((f.koT = (f.koT || 0) + 0.02), 0, 1);
      ctx.translate(0, U.ease(fall) * 26);
      ctx.rotate(-U.ease(fall) * 0.5);
      ctx.globalAlpha = 1 - fall * 0.25;
    } else {
      ctx.rotate(sway + (lunging ? 0.12 : 0));
    }

    /* --- roots / legs --- */
    ctx.strokeStyle = BLACK;
    ctx.lineCap = 'round';
    for (var r = 0; r < 5; r++) {
      var rx = (r - 2) * 21;
      var curl = Math.sin(t * 1.2 + r) * 4;
      ctx.lineWidth = 13 - Math.abs(r - 2) * 2;
      ctx.beginPath();
      ctx.moveTo(rx * 0.4, -74);
      ctx.quadraticCurveTo(rx * 0.8, -40, rx + curl, -2);
      ctx.stroke();
      // root tip splayed on the floor
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(rx + curl, -3);
      ctx.lineTo(rx + curl + (r < 2 ? -16 : 16), 1);
      ctx.stroke();
    }

    /* --- trunk --- */
    var grd = ctx.createLinearGradient(-46, -210, 46, -40);
    grd.addColorStop(0, '#171320');
    grd.addColorStop(0.5, BLACK2);
    grd.addColorStop(1, BLACK);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(-40, -58);
    ctx.quadraticCurveTo(-50, -130, -34, -182);
    ctx.quadraticCurveTo(-14, -212, 16, -206);
    ctx.quadraticCurveTo(46, -198, 44, -156);
    ctx.quadraticCurveTo(42, -110, 38, -60);
    ctx.quadraticCurveTo(0, -46, -40, -58);
    ctx.closePath();
    ctx.fill();

    // bark grooves
    ctx.strokeStyle = 'rgba(255,122,18,0.10)';
    ctx.lineWidth = 2;
    for (var b = 0; b < 6; b++) {
      ctx.beginPath();
      ctx.moveTo(-30 + b * 14, -64);
      ctx.quadraticCurveTo(-26 + b * 14, -132, -20 + b * 13, -194);
      ctx.stroke();
    }

    /* --- canopy of dead branches --- */
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 11;
    for (var c = 0; c < 7; c++) {
      var ang = -Math.PI / 2 + (c - 3) * 0.44 + Math.sin(t * 0.8 + c) * 0.05;
      var len = 48 + ((c * 37) % 34);
      var bx = -6 + (c - 3) * 9, by = -200;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + Math.cos(ang) * len * 0.5, by + Math.sin(ang) * len * 0.6,
        bx + Math.cos(ang) * len, by + Math.sin(ang) * len);
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len);
      ctx.lineTo(bx + Math.cos(ang - 0.55) * (len + 24), by + Math.sin(ang - 0.55) * (len + 24));
      ctx.stroke();
      ctx.lineWidth = 11;
    }

    /* --- arms: long gnarled branches with claws --- */
    var reach = lunging ? 1 : (f.state === 'wind' ? 0.55 : 0);
    for (var s = 0; s < 2; s++) {
      var back = s === 0;
      var sh = { x: back ? -22 : 26, y: back ? -152 : -160 };
      var a1 = U.lerp(back ? 0.55 : 0.42, -0.25, reach) + Math.sin(t * 1.1 + s) * 0.06;
      var a2 = U.lerp(0.85, 0.12, reach);
      ctx.strokeStyle = back ? BLACK : BLACK2;
      ctx.lineWidth = back ? 10 : 12;
      var hand = limb(ctx, sh.x, sh.y, a1, 56, a2, 52, ctx.lineWidth, ctx.strokeStyle);
      // claw fingers
      ctx.strokeStyle = BLACK;
      ctx.lineWidth = 3.4;
      for (var fg = 0; fg < 4; fg++) {
        var fa = a1 + a2 + (fg - 1.5) * 0.34;
        ctx.beginPath();
        ctx.moveTo(hand.x, hand.y);
        ctx.quadraticCurveTo(hand.x + Math.cos(fa) * 12, hand.y + Math.sin(fa) * 12,
          hand.x + Math.cos(fa + 0.5) * 24, hand.y + Math.sin(fa + 0.5) * 24);
        ctx.stroke();
      }
      if (lunging || f.state === 'wind') {
        SH.render.glowAt(ctx, hand.x, hand.y, 34, eye, 0.5 + rage * 0.3);
      }
      // mucus hanging off the arm
      dripAt(ctx, hand.x - 8, hand.y + 6, t + s * 2);
    }

    /* --- the face --- */
    var fy = -158;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(8, fy, 27, 31, 0, 0, TAU);
    ctx.fill();

    var pulse = 0.7 + Math.sin(t * 3) * 0.1 + rage * 0.2;
    var eyeGlow = 13 + rage * 5;   // tight — he stays pitch black
    SH.render.glowAt(ctx, 2, fy - 7, eyeGlow, eye, pulse);
    SH.render.glowAt(ctx, 21, fy - 7, eyeGlow, eye, pulse);
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.ellipse(2, fy - 7, 6.6, 5, 0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(21, fy - 7, 6.6, 5, 0.2, 0, TAU); ctx.fill();
    if (lunging || f.state === 'wind' || rage) {
      SH.render.glowAt(ctx, 11, fy - 7, 46 + rage * 16, eye, 0.16 + rage * 0.1);
    }
    ctx.fillStyle = '#fff3d8';
    ctx.beginPath(); ctx.ellipse(3, fy - 8.5, 2.3, 1.7, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(22, fy - 8.5, 2.3, 1.7, 0, 0, TAU); ctx.fill();

    // splintered maw
    ctx.strokeStyle = 'rgba(255,122,18,0.26)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, fy + 14);
    for (var m = 0; m < 7; m++) {
      ctx.lineTo(-8 + m * 6.4, fy + 14 + (m % 2 ? 8 : 0));
    }
    ctx.stroke();

    /* --- viscous mucus sheeting down the trunk --- */
    ctx.fillStyle = 'rgba(10,8,16,0.92)';
    for (var d = 0; d < 7; d++) {
      var dx = -30 + d * 11;
      var dl = 26 + ((d * 53) % 40) + Math.sin(t * 0.7 + d) * 8;
      ctx.beginPath();
      ctx.moveTo(dx - 5, -150 + d * 9);
      ctx.quadraticCurveTo(dx, -150 + d * 9 + dl * 0.6, dx, -150 + d * 9 + dl);
      ctx.quadraticCurveTo(dx + 3, -150 + d * 9 + dl * 0.6, dx + 5, -150 + d * 9);
      ctx.closePath();
      ctx.fill();
      dripAt(ctx, dx, -150 + d * 9 + dl, t + d);
    }

    ctx.restore();
  }

  function dripAt(ctx, x, y, t) {
    var ph = (t * 0.6 + x * 0.07) % 1;
    ctx.fillStyle = 'rgba(12,10,20,0.95)';
    ctx.beginPath();
    ctx.ellipse(x, y + ph * 46, 2.6 - ph, 4.2 - ph * 1.6, 0, 0, TAU);
    ctx.fill();
  }

  /* =====================================================================
   * PREVIEW (character select)
   * =================================================================== */
  S.drawPreview = function (ctx, id, w, h, t) {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    var saveGround = S.GROUND;
    S.GROUND = 0;
    var fake;
    if (id === 'deathbringer') {
      fake = {
        deathbringer: true, x: 0, y: 0, z: 0, facing: 0, anim: t,
        state: 'idle', enraged: false, sideScale: 1
      };
      ctx.translate(w * 0.5, h * 0.97);
      var sc = h / 330;
      ctx.scale(sc, sc);
      drawDeathbringer(ctx, fake, 1);
    } else {
      var kit = SH.kitById(id);
      fake = {
        kitId: id, kit: kit, x: 0, y: 0, z: 0, facing: 0, form: 0, grounded: true,
        vx: 0, vz: 0, hitFlash: 0, attackT: 0, guard: 0,
        anim: { t: t, swing: -1, swingDir: 1, wing: 0 }
      };
      ctx.translate(w * 0.5, h * 0.96);
      var sc2 = h / 128;
      ctx.scale(sc2, sc2);
      S.drawFighter(ctx, fake, 1);
    }
    S.GROUND = saveGround;
    ctx.restore();
  };
})();
