/* VANGUARD — render.js
 * Camera, 2.5D city rendering, procedural hero/enemy art, VFX.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var R = (SH.render = {
    canvas: null, ctx: null,
    vw: 0, vh: 0, dpr: 1,
    cam: { x: 0, y: 0, s: 1, sx: 0, sy: 0 },
    shakeAmt: 0,
    quality: 1,
    view: { x0: 0, y0: 0, x1: 0, y1: 0 }
  });

  var glowCache = {};
  function glowSprite(color) {
    var c = glowCache[color];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, U.rgba(color, 1));
    grad.addColorStop(0.4, U.rgba(color, 0.45));
    grad.addColorStop(1, U.rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache[color] = c;
    return c;
  }
  R.glowSprite = glowSprite;

  function glow(ctx, x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  R.init = function (canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d', { alpha: false });
    R.resize();
    window.addEventListener('resize', R.resize);
    window.addEventListener('orientationchange', function () { setTimeout(R.resize, 250); });
  };

  R.resize = function () {
    var c = R.canvas;
    if (!c) return;
    R.vw = window.innerWidth;
    R.vh = window.innerHeight;
    R.dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.floor(R.vw * R.dpr);
    c.height = Math.floor(R.vh * R.dpr);
    c.style.width = R.vw + 'px';
    c.style.height = R.vh + 'px';
    R.cam.s = U.clamp(Math.min(R.vw, R.vh) / 400, 0.8, 1.7);
  };

  R.shake = function (amt) {
    if (SH.game && SH.game.opts && !SH.game.opts.shake) return;
    R.shakeAmt = Math.min(30, R.shakeAmt + amt);
  };

  R.follow = function (t, dt, snap) {
    if (!t) return;
    var lead = 0.16;
    var tx = t.x + t.vx * lead;
    var ty = t.y - t.z * 0.55 + t.vy * lead;
    if (snap) { R.cam.x = tx; R.cam.y = ty; }
    else {
      var k = Math.min(1, dt * 7.5);
      R.cam.x = U.lerp(R.cam.x, tx, k);
      R.cam.y = U.lerp(R.cam.y, ty, k);
    }
    var halfW = R.vw / R.cam.s / 2, halfH = R.vh / R.cam.s / 2;
    R.cam.x = U.clamp(R.cam.x, halfW, SH.world.w - halfW);
    R.cam.y = U.clamp(R.cam.y, halfH, SH.world.h - halfH);
    if (SH.world.w < halfW * 2) R.cam.x = SH.world.w / 2;
    if (SH.world.h < halfH * 2) R.cam.y = SH.world.h / 2;

    if (R.shakeAmt > 0) {
      R.shakeAmt = Math.max(0, R.shakeAmt - dt * 42);
      R.cam.sx = U.rand(-R.shakeAmt, R.shakeAmt);
      R.cam.sy = U.rand(-R.shakeAmt, R.shakeAmt);
    } else { R.cam.sx = R.cam.sy = 0; }
  };

  R.worldToScreen = function (x, y) {
    return {
      x: (x - R.cam.x - R.cam.sx) * R.cam.s + R.vw / 2,
      y: (y - R.cam.y - R.cam.sy) * R.cam.s + R.vh / 2
    };
  };

  /* ==================================================================== */
  R.draw = function (game) {
    var ctx = R.ctx;
    var cam = R.cam;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, R.vw, R.vh);

    ctx.save();
    ctx.translate(R.vw / 2, R.vh / 2);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x - cam.sx, -cam.y - cam.sy);

    var hw = R.vw / cam.s / 2 + 90, hh = R.vh / cam.s / 2 + 160;
    var v = R.view;
    v.x0 = cam.x - hw; v.x1 = cam.x + hw;
    v.y0 = cam.y - hh; v.y1 = cam.y + hh;

    drawGround(ctx, v);
    drawHazards(ctx, v);
    drawShadows(ctx, v, game);
    drawSorted(ctx, v, game);
    drawParticles(ctx, v);
    drawOverheads(ctx, v, game);

    ctx.restore();
  };

  /* ------------------------------------------------------------- ground */
  function drawGround(ctx, v) {
    var W = SH.world;
    // base
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);

    // threat tint rings
    var d0 = U.dist(SH.render.cam.x, SH.render.cam.y, W.cx, W.cy) / W.maxDist;
    var lvl = U.clamp(1 + Math.floor(d0 * 4.6), 1, 4);
    var tint = W.THREAT_COLORS[lvl - 1];
    ctx.fillStyle = U.rgba(tint, 0.035);
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);

    // street grid
    var STEP = 620;
    ctx.strokeStyle = 'rgba(120,150,190,0.07)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var gx0 = Math.floor(v.x0 / STEP) * STEP, gy0 = Math.floor(v.y0 / STEP) * STEP;
    for (var x = gx0; x < v.x1; x += STEP) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
    for (var y = gy0; y < v.y1; y += STEP) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
    ctx.stroke();

    // road centre dashes
    ctx.strokeStyle = 'rgba(180,200,230,0.05)';
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 34]);
    ctx.beginPath();
    for (var x2 = gx0; x2 < v.x1; x2 += STEP) { ctx.moveTo(x2 + 3, v.y0); ctx.lineTo(x2 + 3, v.y1); }
    ctx.stroke();
    ctx.setLineDash([]);

    // arenas
    for (var i = 0; i < W.arenas.length; i++) {
      var ar = W.arenas[i];
      if (ar.x + ar.r < v.x0 || ar.x - ar.r > v.x1 || ar.y + ar.r < v.y0 || ar.y - ar.r > v.y1) continue;
      var alive = ar.boss && !ar.boss.dead;
      var col = alive ? '#ff2b2b' : (ar.cleared ? '#5affa8' : '#ff9a3c');
      ctx.save();
      ctx.globalAlpha = 0.045;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(ar.x, ar.y, ar.r, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(ar.x, ar.y, ar.r, 0, U.TAU); ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 2;
      var t = SH.game.time * 0.4;
      for (var s = 0; s < 3; s++) {
        ctx.beginPath();
        ctx.arc(ar.x, ar.y, ar.r * (0.35 + s * 0.2), t + s, t + s + 2.2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // spawn plaza
    if (U.dist(W.cx, W.cy, SH.render.cam.x, SH.render.cam.y) < 1400) {
      ctx.save();
      ctx.globalAlpha = 0.055;
      ctx.fillStyle = '#5ad1ff';
      ctx.beginPath(); ctx.arc(W.cx, W.cy, 560, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W.cx, W.cy, 560, 0, U.TAU); ctx.stroke();
      ctx.restore();
    }

    // decals
    var dec = W.decals;
    for (var d = 0; d < dec.length; d++) {
      var o = dec[d];
      if (o.x < v.x0 || o.x > v.x1 || o.y < v.y0 || o.y > v.y1) continue;
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot);
      if (o.type === 'crack') {
        ctx.strokeStyle = 'rgba(160,180,210,0.09)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-o.r, 0); ctx.lineTo(-o.r * 0.3, o.r * 0.25);
        ctx.lineTo(o.r * 0.2, -o.r * 0.2); ctx.lineTo(o.r, o.r * 0.1);
        ctx.stroke();
      } else if (o.type === 'rubble') {
        ctx.fillStyle = 'rgba(90,105,130,0.22)';
        for (var k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(U.hash(o.x + k, o.y) * o.r - o.r / 2, U.hash(o.y, o.x + k) * o.r - o.r / 2, 3 + (k % 3) * 2, 0, U.TAU);
          ctx.fill();
        }
      } else {
        var cc = SH.world.THREAT_COLORS[o.threat - 1];
        glow(ctx, 0, 0, o.r * 0.6, cc, 0.16);
        ctx.fillStyle = U.rgba(cc, 0.5);
        ctx.beginPath();
        ctx.moveTo(0, -o.r * 0.35); ctx.lineTo(o.r * 0.16, 0);
        ctx.lineTo(0, o.r * 0.35); ctx.lineTo(-o.r * 0.16, 0);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    // lamps
    var lm = W.lamps;
    for (var l = 0; l < lm.length; l++) {
      var la = lm[l];
      if (la.x < v.x0 || la.x > v.x1 || la.y < v.y0 || la.y > v.y1) continue;
      var f = 0.55 + Math.sin(SH.game.time * 2 + la.t) * 0.08;
      glow(ctx, la.x, la.y, 60, W.THREAT_COLORS[la.threat - 1], 0.1 * f);
    }
  }

  /* ------------------------------------------------------------ hazards */
  function drawHazards(ctx, v) {
    var list = SH.ents.hazards;
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.x + h.r < v.x0 || h.x - h.r > v.x1 || h.y + h.r < v.y0 || h.y - h.r > v.y1) continue;
      var frac = h.delay > 0 ? 1 - h.delay / Math.max(0.001, h.maxLife) : h.life / h.maxLife;
      ctx.save();
      if (h.delay > 0) {
        // telegraph: filling circle
        var fill = 1 - U.clamp(h.delay / (h.data.delayMax || h.maxLife || 1), 0, 1);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = h.color;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = h.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.arc(h.x, h.y, h.r, -Math.PI / 2, -Math.PI / 2 + U.TAU * fill);
        ctx.closePath(); ctx.fill();
      } else if (h.kind === 'wave') {
        ctx.globalAlpha = 0.7 * U.clamp(frac * 2, 0, 1);
        ctx.strokeStyle = h.color; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.stroke();
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 26;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.stroke();
      } else if (h.kind === 'storm') {
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = h.color;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = h.color; ctx.lineWidth = 2.5;
        ctx.setLineDash([16, 22]);
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, SH.game.time * 0.6, SH.game.time * 0.6 + U.TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        var a = h.kind === 'heal' ? 0.16 : 0.2;
        ctx.globalAlpha = a * U.clamp(frac * 3, 0, 1);
        ctx.fillStyle = h.color;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 0.45 * U.clamp(frac * 3, 0, 1);
        ctx.strokeStyle = h.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.stroke();
      }
      ctx.restore();
    }

    // enemy telegraphs
    var en = SH.ents.enemies;
    for (var j = 0; j < en.length; j++) {
      var e = en[j];
      if (!e.tele || e.dead) continue;
      if (e.x < v.x0 - 200 || e.x > v.x1 + 200 || e.y < v.y0 - 200 || e.y > v.y1 + 200) continue;
      var t = U.clamp(e.tele.t / e.tele.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.28 + t * 0.4;
      ctx.fillStyle = e.tele.color;
      ctx.strokeStyle = e.tele.color;
      if (e.tele.kind === 'melee') {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, e.tele.r * (0.4 + t * 0.6), e.facing - 0.8, e.facing + 0.8);
        ctx.closePath(); ctx.fill();
      } else if (e.tele.kind === 'charge') {
        ctx.save();
        ctx.translate(e.x, e.y); ctx.rotate(e.facing);
        ctx.fillRect(0, -22, 380 * (0.3 + t * 0.7), 44);
        ctx.restore();
      } else if (e.tele.kind === 'aim') {
        var p = SH.game.player();
        if (p) {
          ctx.lineWidth = 1.6;
          ctx.setLineDash([10, 10]);
          ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (e.tele.kind === 'slam') {
        var sx = e.slamX, sy = e.slamY;
        ctx.globalAlpha = 0.2;
        ctx.beginPath(); ctx.arc(sx, sy, e.tele.r, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(sx, sy, e.tele.r * t, 0, U.TAU); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, e.tele.r, 0, U.TAU); ctx.stroke();
      } else if (e.tele.kind === 'wave' || e.tele.kind === 'summon') {
        ctx.globalAlpha = 0.16 + t * 0.2;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.tele.r * t, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.tele.r * t, 0, U.TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------ shadows */
  function shadow(ctx, x, y, r, z) {
    var f = U.clamp(1 - z / 340, 0.22, 1);
    ctx.globalAlpha = 0.36 * f;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y, r * f, r * 0.52 * f, 0, 0, U.TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawShadows(ctx, v, game) {
    var en = SH.ents.enemies;
    for (var i = 0; i < en.length; i++) {
      var e = en[i];
      if (e.dead || e.x < v.x0 || e.x > v.x1 || e.y < v.y0 || e.y > v.y1) continue;
      shadow(ctx, e.x, e.y, e.r * 1.05, 0);
    }
    var st = SH.ents.structures;
    for (var j = 0; j < st.length; j++) shadow(ctx, st[j].x, st[j].y, st[j].r, 0);
    var p = game.player();
    if (p) shadow(ctx, p.x, p.y, p.radius * 1.15, p.z);
  }

  /* --------------------------------------------------------- main layer */
  var sortBuf = [];
  function drawSorted(ctx, v, game) {
    sortBuf.length = 0;
    var obs = SH.world.obstacles;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (o.x + o.w < v.x0 || o.x > v.x1 || o.y + o.h < v.y0 - 200 || o.y > v.y1) continue;
      sortBuf.push({ k: 'b', y: o.y + o.h, o: o });
    }
    var en = SH.ents.enemies;
    for (var j = 0; j < en.length; j++) {
      var e = en[j];
      if (e.dead || e.x < v.x0 - 60 || e.x > v.x1 + 60 || e.y < v.y0 - 60 || e.y > v.y1 + 60) continue;
      sortBuf.push({ k: 'e', y: e.y, o: e });
    }
    var st = SH.ents.structures;
    for (var k = 0; k < st.length; k++) sortBuf.push({ k: 's', y: st[k].y, o: st[k] });
    var af = SH.ents.after;
    for (var m = 0; m < af.length; m++) sortBuf.push({ k: 'a', y: af[m].y - 1, o: af[m] });
    var pk = SH.ents.pickups;
    for (var q = 0; q < pk.length; q++) sortBuf.push({ k: 'k', y: pk[q].y, o: pk[q] });
    var pr = SH.ents.projectiles;
    for (var n = 0; n < pr.length; n++) {
      var p = pr[n];
      if (p.x < v.x0 - 40 || p.x > v.x1 + 40 || p.y < v.y0 - 40 || p.y > v.y1 + 40) continue;
      sortBuf.push({ k: 'p', y: p.y + 400, o: p });
    }
    var hero = game.player();
    if (hero) sortBuf.push({ k: 'h', y: hero.y, o: hero });
    var dom = game.squad;
    sortBuf.sort(function (a, b) { return a.y - b.y; });

    for (var s = 0; s < sortBuf.length; s++) {
      var it = sortBuf[s];
      switch (it.k) {
        case 'b': drawBuilding(ctx, it.o); break;
        case 'e': drawEnemy(ctx, it.o); break;
        case 's': drawStructure(ctx, it.o); break;
        case 'a': drawAfter(ctx, it.o); break;
        case 'k': drawPickup(ctx, it.o); break;
        case 'p': drawProjectile(ctx, it.o); break;
        case 'h': drawHero(ctx, it.o, game); break;
      }
    }
  }

  function drawBuilding(ctx, o) {
    var cam = R.cam;
    var K = 0.00085;
    var ox = (o.x + o.w / 2 - cam.x) * o.ht * K;
    var oy = (o.y + o.h / 2 - cam.y) * o.ht * K - o.ht * 0.16;
    var wall = o.pillar ? '#151b29' : '#0f141f';
    var wall2 = o.pillar ? '#202839' : '#19202f';
    var roof = o.pillar ? '#303b56' : '#28324a';

    ctx.fillStyle = wall;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = 'rgba(120,160,210,0.13)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(o.x, o.y, o.w, o.h);

    ctx.fillStyle = wall2;
    if (ox > 0) { quad(ctx, o.x + o.w, o.y, o.x + o.w, o.y + o.h, o.x + o.w + ox, o.y + o.h + oy, o.x + o.w + ox, o.y + oy); }
    else if (ox < 0) { quad(ctx, o.x, o.y, o.x, o.y + o.h, o.x + ox, o.y + o.h + oy, o.x + ox, o.y + oy); }
    if (oy > 0) { quad(ctx, o.x, o.y + o.h, o.x + o.w, o.y + o.h, o.x + o.w + ox, o.y + o.h + oy, o.x + ox, o.y + o.h + oy); }
    else if (oy < 0) { quad(ctx, o.x, o.y, o.x + o.w, o.y, o.x + o.w + ox, o.y + oy, o.x + ox, o.y + oy); }

    ctx.fillStyle = roof;
    ctx.fillRect(o.x + ox, o.y + oy, o.w, o.h);
    ctx.strokeStyle = 'rgba(150,180,220,0.16)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(o.x + ox, o.y + oy, o.w, o.h);

    // rooftop lights
    var tc = SH.world.THREAT_COLORS[(o.threat || 1) - 1];
    var n = 2 + ((o.seed * 4) | 0);
    for (var i = 0; i < n; i++) {
      var hx = U.hash(o.x + i * 7.3, o.y + i * 3.1);
      var hy = U.hash(o.y + i * 5.7, o.x + i * 2.9);
      var lx = o.x + ox + 8 + hx * (o.w - 16);
      var ly = o.y + oy + 8 + hy * (o.h - 16);
      glow(ctx, lx, ly, 16, tc, 0.32);
    }
  }
  function quad(ctx, x1, y1, x2, y2, x3, y3, x4, y4) {
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath(); ctx.fill();
  }

  /* -------------------------------------------------------- structures */
  function drawStructure(ctx, s) {
    var g = U.ease(s.grow);
    var fade = U.clamp(s.life / 1.2, 0, 1);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.globalAlpha = fade;
    glow(ctx, 0, -s.ht * 0.4 * g, s.r * 1.6, s.color, 0.3);
    var n = 5;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * U.TAU + s.x * 0.01;
      var rr = s.r * (0.42 + (i % 2) * 0.3);
      var hh = s.ht * g * (0.6 + (i % 3) * 0.2);
      ctx.fillStyle = i % 2 ? U.rgba(s.color, 0.85) : U.rgba('#ffd899', 0.75);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rr - 5, Math.sin(a) * rr * 0.55);
      ctx.lineTo(Math.cos(a) * rr * 0.4, Math.sin(a) * rr * 0.3 - hh);
      ctx.lineTo(Math.cos(a) * rr + 5, Math.sin(a) * rr * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPickup(ctx, p) {
    var col = p.kind === 'hp' ? '#68ffb0' : '#8fd8ff';
    var y = p.y - p.z;
    var pulse = 1 + Math.sin(p.t * 8) * 0.16;
    glow(ctx, p.x, y, 16 * pulse, col, 0.55);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(p.x, y - 6 * pulse); ctx.lineTo(p.x + 4.5 * pulse, y);
    ctx.lineTo(p.x, y + 6 * pulse); ctx.lineTo(p.x - 4.5 * pulse, y);
    ctx.closePath(); ctx.fill();
  }

  /* ------------------------------------------------------- projectiles */
  function drawProjectile(ctx, p) {
    var y = p.y - p.z;
    ctx.save();
    ctx.translate(p.x, y);
    var ang = p.rot || Math.atan2(p.vy, p.vx);
    ctx.rotate(ang);
    var s = p.size || 10;
    switch (p.type) {
      case 'crescent':
        glow(ctx, 0, 0, s * 1.6, p.color, 0.5);
        ctx.strokeStyle = p.color; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(-s * 0.4, 0, s, -1.1, 1.1); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(-s * 0.4, 0, s, -0.9, 0.9); ctx.stroke();
        break;
      case 'shard':
        glow(ctx, 0, 0, s * 1.3, p.color, 0.45);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(s * 0.9, 0); ctx.lineTo(-s * 0.4, s * 0.36);
        ctx.lineTo(-s * 0.2, 0); ctx.lineTo(-s * 0.4, -s * 0.36);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.moveTo(s * 0.6, 0); ctx.lineTo(-s * 0.1, s * 0.12);
        ctx.lineTo(-s * 0.1, -s * 0.12); ctx.closePath(); ctx.fill();
        break;
      case 'spear':
        glow(ctx, 0, 0, s * 1.4, p.color, 0.6);
        ctx.fillStyle = '#fff8dc';
        ctx.beginPath();
        ctx.moveTo(s, 0); ctx.lineTo(s * 0.2, s * 0.24);
        ctx.lineTo(-s, s * 0.09); ctx.lineTo(-s, -s * 0.09);
        ctx.lineTo(s * 0.2, -s * 0.24);
        ctx.closePath(); ctx.fill();
        break;
      case 'blade':
        glow(ctx, 0, 0, s * 1.2, p.color, 0.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(s * 0.8, 0); ctx.lineTo(-s * 0.3, s * 0.22);
        ctx.lineTo(-s * 0.6, 0); ctx.lineTo(-s * 0.3, -s * 0.22);
        ctx.closePath(); ctx.fill();
        break;
      case 'mote':
        var pulse = p.state === 'stuck' ? 1 + Math.sin(p.stuckT * 40) * 0.35 : 1;
        glow(ctx, 0, 0, s * 2.2 * pulse, p.color, 0.6);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.45 * pulse, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.85 * pulse, 0, U.TAU); ctx.stroke();
        break;
      case 'rock':
        ctx.fillStyle = '#6b4a3d';
        ctx.beginPath();
        ctx.moveTo(-s * 0.7, -s * 0.4); ctx.lineTo(s * 0.6, -s * 0.6);
        ctx.lineTo(s * 0.8, s * 0.5); ctx.lineTo(-s * 0.5, s * 0.7);
        ctx.closePath(); ctx.fill();
        break;
      default:
        glow(ctx, 0, 0, s * 1.8, p.color, 0.5);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.24, 0, U.TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ enemies */
  function drawEnemy(ctx, e) {
    var y = e.y - e.z;
    ctx.save();
    ctx.translate(e.x, y);
    var frozen = e.status.freeze && e.status.freeze.t > 0;

    // aura
    glow(ctx, 0, 0, e.r * 2.1, e.color, e.boss ? 0.35 : 0.2);

    ctx.rotate(e.facing);
    ctx.scale(1.16, 1.16);
    var flash = e.hitFlash > 0 ? U.clamp(e.hitFlash / 0.13, 0, 1) : 0;
    var body = flash > 0.1 ? '#ffffff' : e.body;
    var wob = Math.sin(e.anim * 9) * (e.boss ? 1.4 : 1);

    switch (e.type) {
      case 'husk': drawHusk(ctx, e, body, wob); break;
      case 'lancer': drawLancer(ctx, e, body, wob); break;
      case 'bulwark': drawBulwark(ctx, e, body, wob); break;
      case 'stalker': drawStalker(ctx, e, body, wob); break;
      case 'colossus': drawColossus(ctx, e, body, wob); break;
    }

    ctx.restore();

    if (frozen) {
      ctx.save();
      ctx.translate(e.x, y);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#8fd8ff';
      ctx.beginPath();
      ctx.moveTo(0, -e.h * 0.9); ctx.lineTo(e.r * 0.9, -e.h * 0.2);
      ctx.lineTo(e.r * 0.6, e.r * 0.6); ctx.lineTo(-e.r * 0.6, e.r * 0.6);
      ctx.lineTo(-e.r * 0.9, -e.h * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // health bar
    if (!e.boss && e.hp < e.maxHp) {
      var w = e.r * 1.9;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(e.x - w / 2, y - e.h - 11, w, 3.4);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - w / 2, y - e.h - 11, w * U.clamp(e.hp / e.maxHp, 0, 1), 3.4);
    }
    // elite marker
    if (e.level >= 4 && !e.boss) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = e.color;
      ctx.font = 'bold 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ELITE', e.x, y - e.h - 15);
      ctx.globalAlpha = 1;
    }
  }

  function drawHusk(ctx, e, body, wob) {
    var r = e.r;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(r * 0.95, 0); ctx.lineTo(r * 0.2, r * 0.95);
    ctx.lineTo(-r * 0.85, r * 0.6); ctx.lineTo(-r * 0.6, 0);
    ctx.lineTo(-r * 0.85, -r * 0.6); ctx.lineTo(r * 0.2, -r * 0.95);
    ctx.closePath(); ctx.fill();
    // arms
    ctx.strokeStyle = body; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.1, r * 0.7); ctx.lineTo(r * 0.9 + wob, r * 1.15);
    ctx.moveTo(r * 0.1, -r * 0.7); ctx.lineTo(r * 0.9 - wob, -r * 1.15);
    ctx.stroke();
    // core
    glow(ctx, r * 0.15, 0, r * 0.9, e.color, 0.75);
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.3, 0, U.TAU); ctx.fill();
  }

  function drawLancer(ctx, e, body, wob) {
    var r = e.r;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.8, r * 0.66, 0, 0, U.TAU);
    ctx.fill();
    // hood spikes
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, 0); ctx.lineTo(-r * 1.5, -r * 0.5);
    ctx.lineTo(-r * 0.9, r * 0.1); ctx.lineTo(-r * 1.4, r * 0.6);
    ctx.closePath(); ctx.fill();
    // lance
    ctx.strokeStyle = body; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, r * 0.5); ctx.lineTo(r * 1.7, r * 0.2);
    ctx.stroke();
    var charging = e.state === 'wind';
    glow(ctx, r * 1.8, r * 0.15, r * (charging ? 1.4 : 0.7), e.color, charging ? 0.9 : 0.5);
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(r * 1.8, r * 0.15, r * 0.24, 0, U.TAU); ctx.fill();
    // eye
    glow(ctx, r * 0.3, 0, r * 0.6, e.color, 0.6);
    ctx.fillStyle = e.color;
    ctx.fillRect(r * 0.1, -r * 0.16, r * 0.5, r * 0.32);
  }

  function drawBulwark(ctx, e, body, wob) {
    var r = e.r;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, 0, r * 0.85, r * 0.95, 0, 0, U.TAU);
    ctx.fill();
    glow(ctx, -r * 0.2, 0, r * 1.1, e.color, 0.45);
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(-r * 0.2, 0, r * 0.3, 0, U.TAU); ctx.fill();
    // shield arc in front
    var charging = e.state === 'charge' || (e.state === 'wind' && e.windKind === 'charge');
    ctx.save();
    ctx.globalAlpha = charging ? 0.95 : 0.8;
    ctx.strokeStyle = '#9fd8ff';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.25, -1.15, 1.15);
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#e6f6ff';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.25, -1.15, 1.15);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = body;
    ctx.fillRect(-r * 0.2, -r * 1.1, r * 0.5, r * 0.35);
    ctx.fillRect(-r * 0.2, r * 0.75, r * 0.5, r * 0.35);
  }

  function drawStalker(ctx, e, body, wob) {
    var r = e.r;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-r * 1.2, 0, r * 1.1, r * 0.5, 0, 0, U.TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(r * 1.05, 0); ctx.lineTo(-r * 0.2, r * 0.75);
    ctx.lineTo(-r * 1.1, 0); ctx.lineTo(-r * 0.2, -r * 0.75);
    ctx.closePath(); ctx.fill();
    // claws
    ctx.strokeStyle = e.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.3, r * 0.6); ctx.lineTo(r * 1.2, r * 0.95 + wob * 0.5);
    ctx.moveTo(r * 0.3, -r * 0.6); ctx.lineTo(r * 1.2, -r * 0.95 - wob * 0.5);
    ctx.stroke();
    glow(ctx, r * 0.2, 0, r * 1.1, e.color, 0.6);
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(r * 0.55, 0); ctx.lineTo(r * 0.1, r * 0.22);
    ctx.lineTo(r * 0.1, -r * 0.22); ctx.closePath(); ctx.fill();
  }

  function drawColossus(ctx, e, body, wob) {
    var r = e.r;
    var breathe = 1 + Math.sin(e.anim * 2.4) * 0.03;
    ctx.save();
    ctx.scale(breathe, breathe);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.92, r * 1.0, 0, 0, U.TAU);
    ctx.fill();
    // pauldrons
    ctx.beginPath(); ctx.arc(-r * 0.1, -r * 0.95, r * 0.42, 0, U.TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-r * 0.1, r * 0.95, r * 0.42, 0, U.TAU); ctx.fill();
    // arms
    ctx.strokeStyle = body; ctx.lineWidth = r * 0.36; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.1, r * 0.95); ctx.lineTo(r * 1.15, r * 0.75 + wob);
    ctx.moveTo(r * 0.1, -r * 0.95); ctx.lineTo(r * 1.15, -r * 0.75 - wob);
    ctx.stroke();
    // fists
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(r * 1.2, r * 0.75 + wob, r * 0.3, 0, U.TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 1.2, -r * 0.75 - wob, r * 0.3, 0, U.TAU); ctx.fill();
    // cracks / core
    glow(ctx, 0, 0, r * 1.5, e.color, e.enraged ? 0.85 : 0.5);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.3); ctx.lineTo(-r * 0.1, 0); ctx.lineTo(-r * 0.55, r * 0.35);
    ctx.moveTo(r * 0.1, -r * 0.5); ctx.lineTo(r * 0.45, 0); ctx.lineTo(r * 0.1, r * 0.5);
    ctx.stroke();
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.26, 0, U.TAU); ctx.fill();
    // head
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.32, 0, U.TAU); ctx.fill();
    glow(ctx, r * 0.62, 0, r * 0.5, e.color, 0.8);
    ctx.restore();
  }

  /* -------------------------------------------------------------- heroes */
  function drawAfter(ctx, a) {
    var h = a.ent;
    if (!h) return;
    var alpha = (a.life / a.maxLife) * 0.4;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawHeroBody(ctx, h, a.x, a.y - a.z, a.facing, a.color || h.kit.colors.accent, true);
    ctx.restore();
  }

  function drawHero(ctx, h, game) {
    if (h.ko) {
      ctx.save();
      ctx.translate(h.x, h.y - h.z);
      ctx.globalAlpha = 0.6;
      ctx.rotate(h.facing);
      ctx.fillStyle = h.kit.colors.dark;
      ctx.beginPath(); ctx.ellipse(0, 0, h.radius * 1.3, h.radius * 0.7, 0, 0, U.TAU); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ff5b6e';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('DOWN', h.x, h.y - h.z - 26);
      ctx.restore();
      return;
    }

    var y = h.y - h.z;

    // active marker
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = h.kit.colors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, h.radius * 2.2, h.radius * 1.1, 0, 0, U.TAU);
    ctx.stroke();
    ctx.restore();

    if (h.form > 0) glow(ctx, h.x, y, h.radius * 5, h.kit.colors.formGlow, 0.4);
    else glow(ctx, h.x, y, h.radius * 3, h.kit.colors.accent, 0.16);

    if (h.absorbing) {
      ctx.save();
      ctx.globalAlpha = 0.28 + Math.sin(SH.game.time * 12) * 0.08;
      ctx.fillStyle = h.kit.colors.accent;
      ctx.beginPath(); ctx.arc(h.x, y, 74, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = h.kit.colors.glow; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, y, 74, 0, U.TAU); ctx.stroke();
      ctx.restore();
    }
    if (h.shieldHp > 0) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#ffd899'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, y, h.radius * 2.2, 0, U.TAU); ctx.stroke();
      ctx.restore();
    }

    drawHeroBody(ctx, h, h.x, y, h.facing, null, false);

    // orbiting shadow blades (Dominus)
    if (h.orbiters && h.orbiters.length) {
      var col = h.form > 0 ? h.kit.colors.formGlow : h.kit.colors.accent;
      for (var i = 0; i < h.orbiters.length; i++) {
        var o = h.orbiters[i];
        var bx = h.x + Math.cos(o.a) * o.r, by = y + Math.sin(o.a) * o.r * 0.6 - 26;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(o.a + Math.PI / 2);
        glow(ctx, 0, 0, 14, col, 0.5);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, -11); ctx.lineTo(3.5, 4); ctx.lineTo(0, 8); ctx.lineTo(-3.5, 4);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  /* The body itself, rotated to `facing`. If `flat` is a colour string the
     whole figure is drawn as a silhouette (used for after-images). */
  function drawHeroBody(ctx, h, x, y, facing, flat, isAfter) {
    var K = h.kit.colors;
    var inForm = h.form > 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(facing);

    var swing = h.anim.swing > 0 ? U.clamp(1 - h.anim.swing / 0.3, 0, 1) : -1;
    var arm = swing >= 0 ? U.lerp(-1.15, 0.85, U.ease(swing)) * (h.anim.swingDir || 1) : 0.3;
    var bob = Math.sin(h.anim.t * 11) * (Math.hypot(h.vx, h.vy) > 40 ? 1.2 : 0.35);

    var C1 = flat || K.base, C2 = flat || K.mid, C3 = flat || K.dark, CA = flat || K.accent;
    var r = h.radius * 1.42;

    switch (h.kitId) {
      case 'savior': drawSavior(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat); break;
      case 'exodus': drawExodus(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat); break;
      case 'paragon': drawParagon(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat); break;
      case 'dominus': drawDominus(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat); break;
      case 'vitality': drawVitality(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat); break;
    }

    if (h.hitFlash > 0 && !flat) {
      ctx.globalAlpha = U.clamp(h.hitFlash / 0.16, 0, 1) * 0.7;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, r * 1.35, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function torso(ctx, r, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(-1, 0, r * 0.78, r * 0.92, 0, 0, U.TAU);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke; ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  /* ---- SAVIOR: white/grey armour, green crystal, shortsword ---- */
  function drawSavior(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat) {
    // legs
    ctx.fillStyle = C3;
    ctx.beginPath(); ctx.ellipse(-r * 0.5, bob * 0.5, r * 0.5, r * 0.75, 0, 0, U.TAU); ctx.fill();
    // cape-less armoured torso
    torso(ctx, r, C1, flat ? null : C3);
    // pauldrons
    ctx.fillStyle = C2;
    ctx.beginPath(); ctx.arc(-r * 0.1, -r * 0.85 - bob * 0.2, r * 0.42, 0, U.TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-r * 0.1, r * 0.85 + bob * 0.2, r * 0.42, 0, U.TAU); ctx.fill();
    if (!flat) {
      ctx.strokeStyle = CA; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(-r * 0.1, -r * 0.85 - bob * 0.2, r * 0.42, 0, U.TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 0.1, r * 0.85 + bob * 0.2, r * 0.42, 0, U.TAU); ctx.stroke();
    }
    // chest crystal sigil
    if (!flat) {
      glow(ctx, r * 0.12, 0, r * 0.85, CA, inForm ? 0.9 : 0.55);
      ctx.fillStyle = CA;
      ctx.beginPath();
      ctx.moveTo(r * 0.12, -r * 0.42); ctx.lineTo(r * 0.42, 0);
      ctx.lineTo(r * 0.12, r * 0.42); ctx.lineTo(-r * 0.18, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(r * 0.12, -r * 0.2); ctx.lineTo(r * 0.24, 0);
      ctx.lineTo(r * 0.12, r * 0.2); ctx.lineTo(0, 0);
      ctx.closePath(); ctx.fill();
    }
    // helmet
    ctx.fillStyle = C1;
    ctx.beginPath(); ctx.arc(r * 0.42, 0, r * 0.45, 0, U.TAU); ctx.fill();
    if (!flat) {
      ctx.fillStyle = C3;
      ctx.beginPath();
      ctx.moveTo(r * 0.86, 0); ctx.lineTo(r * 0.5, r * 0.3);
      ctx.lineTo(r * 0.5, -r * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = CA;
      ctx.fillRect(r * 0.52, -r * 0.09, r * 0.3, r * 0.18);
    }
    // shortsword
    ctx.save();
    ctx.translate(r * 0.35, r * 0.75);
    ctx.rotate(arm);
    if (!flat) glow(ctx, r * 1.1, 0, r * 1.1, CA, inForm ? 0.6 : 0.3);
    ctx.fillStyle = flat || '#dfe7f2';
    ctx.beginPath();
    ctx.moveTo(r * 1.85, 0); ctx.lineTo(r * 0.35, r * 0.2);
    ctx.lineTo(r * 0.35, -r * 0.2); ctx.closePath(); ctx.fill();
    if (!flat) {
      ctx.strokeStyle = CA; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(r * 1.8, 0); ctx.lineTo(r * 0.4, 0); ctx.stroke();
      ctx.fillStyle = C2;
      ctx.fillRect(r * 0.1, -r * 0.28, r * 0.22, r * 0.56);
    }
    ctx.restore();
  }

  /* ---- EXODUS: black tech-weave, goggles, long hair, twin whips ---- */
  function drawExodus(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat) {
    var col = flat || (inForm ? '#8fd8ff' : CA);
    // long hair trailing back
    if (!flat) {
      ctx.fillStyle = h.kit.colors.hair;
      ctx.beginPath();
      var sway = Math.sin(h.anim.t * 8) * r * 0.18;
      ctx.moveTo(r * 0.1, -r * 0.5);
      ctx.quadraticCurveTo(-r * 1.5, -r * 0.7 + sway, -r * 1.9, sway * 0.4);
      ctx.quadraticCurveTo(-r * 1.5, r * 0.7 + sway, r * 0.1, r * 0.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = C3;
    ctx.beginPath(); ctx.ellipse(-r * 0.45, bob * 0.5, r * 0.45, r * 0.7, 0, 0, U.TAU); ctx.fill();
    torso(ctx, r * 0.92, C1, flat ? null : col);
    // tech lines
    if (!flat) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.5); ctx.lineTo(r * 0.2, -r * 0.2);
      ctx.lineTo(-r * 0.1, r * 0.15); ctx.lineTo(r * 0.3, r * 0.5);
      ctx.stroke();
      glow(ctx, 0, 0, r * 1.1, col, 0.28);
    }
    // head: goggles + mask
    ctx.fillStyle = C2;
    ctx.beginPath(); ctx.arc(r * 0.4, 0, r * 0.42, 0, U.TAU); ctx.fill();
    if (!flat) {
      ctx.fillStyle = '#0a0c10';
      ctx.fillRect(r * 0.45, -r * 0.42, r * 0.3, r * 0.84);
      glow(ctx, r * 0.66, -r * 0.24, r * 0.4, col, 0.8);
      glow(ctx, r * 0.66, r * 0.24, r * 0.4, col, 0.8);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(r * 0.66, -r * 0.24, r * 0.13, r * 0.1, 0, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 0.66, r * 0.24, r * 0.13, r * 0.1, 0, 0, U.TAU); ctx.fill();
    }
    // twin whips
    if (!flat) {
      var t = h.anim.t;
      for (var s = -1; s <= 1; s += 2) {
        var lash = (h.anim.swing > 0 && h.anim.swingDir === s) ? U.clamp(1 - h.anim.swing / 0.16, 0, 1) : -1;
        ctx.save();
        ctx.translate(r * 0.2, s * r * 0.78);
        var base = lash >= 0 ? U.lerp(-1.1 * s, 0.9 * s, U.ease(lash)) : s * 0.35 + Math.sin(t * 3 + s) * 0.12;
        ctx.rotate(base);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        var len = lash >= 0 ? r * 5.4 : r * 2.4;
        for (var i = 1; i <= 5; i++) {
          var f = i / 5;
          ctx.lineTo(len * f, Math.sin(t * 14 + i * 1.3) * r * 0.28 * f * (lash >= 0 ? 1.6 : 1));
        }
        ctx.stroke();
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
  }

  /* ---- PARAGON: blue/gold plate, domino mask, war hammer / spear ---- */
  function drawParagon(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat) {
    // wings
    if (inForm && !flat) {
      var w = U.ease(U.clamp(h.anim.wing, 0, 1));
      var flap = Math.sin(h.anim.t * 6) * 0.22;
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (var s = -1; s <= 1; s += 2) {
        ctx.save();
        ctx.translate(-r * 0.3, s * r * 0.5);
        ctx.rotate(s * (0.7 + flap));
        glow(ctx, -r * 1.6, 0, r * 3.2, h.kit.colors.formGlow, 0.5);
        ctx.fillStyle = U.rgba(h.kit.colors.formGlow, 0.75);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-r * 2.4 * w, -r * 1.2 * w, -r * 4.2 * w, -r * 0.2 * w);
        ctx.quadraticCurveTo(-r * 2.6 * w, r * 0.5 * w, 0, r * 0.5);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.fillStyle = C3;
    ctx.beginPath(); ctx.ellipse(-r * 0.5, bob * 0.4, r * 0.52, r * 0.8, 0, 0, U.TAU); ctx.fill();
    torso(ctx, r, C1, flat ? null : C3);
    // gold chest bands
    if (!flat) {
      ctx.strokeStyle = CA; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.52, -1.2, 1.2); ctx.stroke();
      ctx.fillStyle = CA;
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.3); ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(r * 0.2, r * 0.3); ctx.lineTo(r * 0.05, 0);
      ctx.closePath(); ctx.fill();
    }
    // pauldrons (gold)
    ctx.fillStyle = flat || CA;
    ctx.beginPath(); ctx.arc(-r * 0.15, -r * 0.9 - bob * 0.2, r * 0.46, 0, U.TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-r * 0.15, r * 0.9 + bob * 0.2, r * 0.46, 0, U.TAU); ctx.fill();
    // head: blond hair, domino mask, open face
    ctx.fillStyle = flat || h.kit.colors.hair;
    ctx.beginPath(); ctx.arc(r * 0.36, 0, r * 0.46, 0, U.TAU); ctx.fill();
    if (!flat) {
      ctx.fillStyle = '#f0c9a0'; // face
      ctx.beginPath(); ctx.arc(r * 0.52, 0, r * 0.34, -1.5, 1.5); ctx.fill();
      ctx.fillStyle = C1; // mask band
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 0.42); ctx.lineTo(r * 0.86, -r * 0.24);
      ctx.lineTo(r * 0.86, r * 0.24); ctx.lineTo(r * 0.5, r * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = CA; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#12305f';
      ctx.beginPath(); ctx.ellipse(r * 0.72, -r * 0.22, r * 0.08, r * 0.06, 0, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 0.72, r * 0.22, r * 0.08, r * 0.06, 0, 0, U.TAU); ctx.fill();
    }
    // weapon
    ctx.save();
    ctx.translate(r * 0.3, r * 0.8);
    ctx.rotate(arm);
    if (inForm) { // radiant spear
      if (!flat) glow(ctx, r * 1.6, 0, r * 1.8, h.kit.colors.formGlow, 0.6);
      ctx.fillStyle = flat || '#fff6d8';
      ctx.fillRect(r * 0.1, -r * 0.09, r * 2.1, r * 0.18);
      ctx.beginPath();
      ctx.moveTo(r * 2.9, 0); ctx.lineTo(r * 2.0, r * 0.3);
      ctx.lineTo(r * 2.1, 0); ctx.lineTo(r * 2.0, -r * 0.3);
      ctx.closePath(); ctx.fill();
    } else { // war hammer
      ctx.strokeStyle = flat || '#6b4a33';
      ctx.lineWidth = r * 0.22;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(r * 0.1, 0); ctx.lineTo(r * 1.7, 0); ctx.stroke();
      if (!flat) glow(ctx, r * 2.0, 0, r * 1.3, CA, 0.35);
      ctx.fillStyle = flat || C2;
      ctx.fillRect(r * 1.62, -r * 0.62, r * 0.72, r * 1.24);
      if (!flat) {
        ctx.fillStyle = CA;
        ctx.fillRect(r * 1.62, -r * 0.62, r * 0.16, r * 1.24);
        ctx.fillRect(r * 2.18, -r * 0.62, r * 0.16, r * 1.24);
      }
    }
    ctx.restore();
  }

  /* ---- DOMINUS: hood with no face, cape, twin shadow blades ---- */
  function drawDominus(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat) {
    var col = flat || (inForm ? h.kit.colors.formGlow : CA);
    // cape
    if (!flat) {
      var sway = Math.sin(h.anim.t * 5) * r * 0.35 - Math.hypot(h.vx, h.vy) * 0.02;
      ctx.fillStyle = C3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.9);
      ctx.quadraticCurveTo(-r * 2.3 + sway * 0.4, -r * 1.5, -r * 2.9 + sway, -r * 0.2);
      ctx.quadraticCurveTo(-r * 2.4 + sway, r * 1.4, -r * 0.2, r * 0.9);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    torso(ctx, r * 0.92, C1, flat ? null : col);
    if (!flat) {
      glow(ctx, 0, 0, r * 1.4, col, 0.22);
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.55); ctx.lineTo(r * 0.25, 0); ctx.lineTo(-r * 0.3, r * 0.55);
      ctx.stroke();
    }
    // hood
    ctx.fillStyle = C2;
    ctx.beginPath();
    ctx.moveTo(r * 0.9, 0);
    ctx.quadraticCurveTo(r * 0.55, -r * 0.75, -r * 0.1, -r * 0.55);
    ctx.quadraticCurveTo(-r * 0.35, 0, -r * 0.1, r * 0.55);
    ctx.quadraticCurveTo(r * 0.55, r * 0.75, r * 0.9, 0);
    ctx.closePath(); ctx.fill();
    if (!flat) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // the void where a face should be
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(r * 0.55, 0, r * 0.26, r * 0.34, 0, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.55;
      glow(ctx, r * 0.55, 0, r * 0.5, col, 0.5);
      ctx.globalAlpha = 1;
    }
    // twin blades
    if (!flat) {
      for (var s = -1; s <= 1; s += 2) {
        ctx.save();
        ctx.translate(r * 0.2, s * r * 0.8);
        var a = (h.anim.swing > 0 && (h.anim.swingDir || 1) === s) ? arm : s * 0.3;
        ctx.rotate(a);
        glow(ctx, r * 0.9, 0, r * 0.9, col, 0.4);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(r * 1.5, 0); ctx.lineTo(r * 0.3, r * 0.16);
        ctx.lineTo(r * 0.15, 0); ctx.lineTo(r * 0.3, -r * 0.16);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  /* ---- VITALITY: face-plate mask, long brown hair, amber constructs ---- */
  function drawVitality(ctx, h, r, C1, C2, C3, CA, arm, bob, inForm, flat) {
    // long brown hair
    if (!flat) {
      ctx.fillStyle = h.kit.colors.hair;
      var sway = Math.sin(h.anim.t * 6) * r * 0.16;
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.62);
      ctx.quadraticCurveTo(-r * 1.6, -r * 0.95 + sway, -r * 2.0, sway * 0.5);
      ctx.quadraticCurveTo(-r * 1.6, r * 0.95 + sway, r * 0.2, r * 0.62);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = C3;
    ctx.beginPath(); ctx.ellipse(-r * 0.45, bob * 0.5, r * 0.46, r * 0.72, 0, 0, U.TAU); ctx.fill();
    torso(ctx, r * 0.9, C1, flat ? null : C2);
    if (!flat) {
      // amber chest plate
      glow(ctx, r * 0.1, 0, r * 0.9, CA, inForm ? 0.75 : 0.4);
      ctx.fillStyle = CA;
      ctx.beginPath();
      ctx.moveTo(r * 0.1, -r * 0.46); ctx.lineTo(r * 0.4, -r * 0.1);
      ctx.lineTo(r * 0.3, r * 0.3); ctx.lineTo(-r * 0.1, r * 0.36);
      ctx.lineTo(-r * 0.2, -r * 0.1);
      ctx.closePath(); ctx.fill();
    }
    // head + face plate
    ctx.fillStyle = flat || h.kit.colors.hair;
    ctx.beginPath(); ctx.arc(r * 0.34, 0, r * 0.44, 0, U.TAU); ctx.fill();
    if (!flat) {
      ctx.fillStyle = CA;
      ctx.beginPath();
      ctx.moveTo(r * 0.9, 0);
      ctx.quadraticCurveTo(r * 0.78, -r * 0.36, r * 0.42, -r * 0.34);
      ctx.lineTo(r * 0.42, r * 0.34);
      ctx.quadraticCurveTo(r * 0.78, r * 0.36, r * 0.9, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(r * 0.62, -r * 0.2, r * 0.16, r * 0.09);
      ctx.fillRect(r * 0.62, r * 0.11, r * 0.16, r * 0.09);
    }
    // amber shard constructs orbiting the free hand
    if (!flat) {
      var n = inForm ? 5 : 3;
      for (var i = 0; i < n; i++) {
        var a = h.anim.t * 2.2 + (i / n) * U.TAU;
        var rr = r * (1.25 + Math.sin(h.anim.t * 3 + i) * 0.1);
        var px = Math.cos(a) * rr * 0.7 + r * 0.3;
        var py = Math.sin(a) * rr;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a * 1.6);
        glow(ctx, 0, 0, r * 0.5, CA, 0.5);
        ctx.fillStyle = CA;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.24); ctx.lineTo(r * 0.11, 0);
        ctx.lineTo(0, r * 0.24); ctx.lineTo(-r * 0.11, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // staff-less: amber blade in hand when swinging
    if (!flat && h.anim.swing > 0) {
      ctx.save();
      ctx.translate(r * 0.3, r * 0.7);
      ctx.rotate(arm);
      glow(ctx, r * 1.0, 0, r * 1.2, CA, 0.5);
      ctx.fillStyle = CA;
      ctx.beginPath();
      ctx.moveTo(r * 1.7, 0); ctx.lineTo(r * 0.3, r * 0.22);
      ctx.lineTo(r * 0.3, -r * 0.22); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------- particles */
  function drawParticles(ctx, v) {
    var list = SH.ents.particles;
    ctx.save();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.x < v.x0 - 200 || p.x > v.x1 + 200 || p.y < v.y0 - 300 || p.y > v.y1 + 200) continue;
      var t = p.life / p.maxLife;
      var y = p.y - p.z;
      switch (p.mode) {
        case 'ring': {
          var rr = U.lerp(p.size, p.size1, 1 - t);
          ctx.globalAlpha = U.clamp(t, 0, 1) * 0.85;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = (p.rot || 3) * t;
          ctx.beginPath(); ctx.arc(p.x, y, Math.max(1, rr), 0, U.TAU); ctx.stroke();
          break;
        }
        case 'glow':
          glow(ctx, p.x, y, U.lerp(p.size1, p.size, t), p.color, t * 0.85);
          break;
        case 'slash': {
          var prog = 1 - t;
          ctx.globalAlpha = t * 0.9;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 7 * t;
          ctx.lineCap = 'round';
          var a0 = p.rot - p.size1 / 2, a1 = p.rot + p.size1 / 2;
          ctx.beginPath();
          ctx.arc(p.x, y, p.size * 0.8, U.lerp(a0, a1, Math.max(0, prog - 0.45)), U.lerp(a0, a1, Math.min(1, prog + 0.3)));
          ctx.stroke();
          ctx.globalAlpha = t * 0.4;
          ctx.lineWidth = 16 * t;
          ctx.stroke();
          break;
        }
        case 'beam': {
          ctx.save();
          ctx.translate(p.x, y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = t * 0.8;
          ctx.fillStyle = p.color2 || p.color;
          ctx.fillRect(0, -p.size1 / 2, p.size, p.size1);
          ctx.globalAlpha = t;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, -p.size1 / 6, p.size, p.size1 / 3);
          ctx.restore();
          break;
        }
        case 'bolt': {
          ctx.globalAlpha = U.clamp(t * 1.4, 0, 1);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(p.pts[0], p.pts[1]);
          for (var k = 2; k < p.pts.length; k += 2) ctx.lineTo(p.pts[k], p.pts[k + 1]);
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.8;
          ctx.stroke();
          break;
        }
        case 'smoke':
          ctx.globalAlpha = t * (p.alpha || 0.5);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, y, p.size * (1.6 - t * 0.6), 0, U.TAU); ctx.fill();
          break;
        case 'flame':
          glow(ctx, p.x, y, p.size * (0.6 + t), t > 0.55 ? (p.color2 || p.color) : p.color, t * 0.8);
          break;
        case 'shard':
        case 'feather': {
          ctx.save();
          ctx.translate(p.x, y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = U.clamp(t * 1.3, 0, 1);
          ctx.fillStyle = p.color;
          var s = p.size;
          ctx.beginPath();
          if (p.mode === 'feather') {
            ctx.moveTo(s, 0); ctx.quadraticCurveTo(0, s * 0.5, -s, 0);
            ctx.quadraticCurveTo(0, -s * 0.5, s, 0);
          } else {
            ctx.moveTo(s, 0); ctx.lineTo(0, s * 0.45); ctx.lineTo(-s, 0); ctx.lineTo(0, -s * 0.45);
          }
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        default:
          if (p.glow) glow(ctx, p.x, y, p.size * 2.2, p.color, U.clamp(t, 0, 1) * 0.8);
          ctx.globalAlpha = U.clamp(t * 1.4, 0, 1);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, y, p.size * U.clamp(t + 0.25, 0, 1), 0, U.TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* --------------------------------------------------------- overheads */
  function drawOverheads(ctx, v, game) {
    var t = SH.ents.texts;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    for (var i = 0; i < t.length; i++) {
      var x = t[i];
      if (x.x < v.x0 || x.x > v.x1 || x.y < v.y0 - 200 || x.y > v.y1) continue;
      var f = x.life / x.maxLife;
      ctx.globalAlpha = U.clamp(f * 1.6, 0, 1);
      ctx.font = 'bold ' + Math.round(x.size * (0.7 + f * 0.45)) + 'px system-ui, -apple-system, sans-serif';
      ctx.strokeText(x.str, x.x, x.y - x.z);
      ctx.fillStyle = x.color;
      ctx.fillText(x.str, x.x, x.y - x.z);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ------------------------------------------------------- portraits */
  R.drawPortrait = function (ctx, kitId, size) {
    var kit = SH.kitById(kitId);
    var K = kit.colors;
    var s = size / 64;
    ctx.save();
    ctx.scale(s, s);
    // backdrop
    var g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, U.rgba(K.accent, 0.28));
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);

    ctx.translate(32, 38);
    // shoulders
    ctx.fillStyle = K.base;
    ctx.beginPath();
    ctx.moveTo(-24, 30); ctx.quadraticCurveTo(-20, 8, 0, 6);
    ctx.quadraticCurveTo(20, 8, 24, 30);
    ctx.closePath(); ctx.fill();

    if (kitId === 'savior') {
      ctx.fillStyle = K.mid;
      ctx.beginPath(); ctx.arc(-19, 14, 8, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(19, 14, 8, 0, U.TAU); ctx.fill();
      ctx.fillStyle = K.accent;
      ctx.beginPath();
      ctx.moveTo(0, 12); ctx.lineTo(6, 20); ctx.lineTo(0, 28); ctx.lineTo(-6, 20);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = K.base;
      ctx.beginPath(); ctx.ellipse(0, -8, 13, 15, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = K.dark;
      ctx.beginPath();
      ctx.moveTo(-9, -12); ctx.lineTo(9, -12); ctx.lineTo(6, -2); ctx.lineTo(-6, -2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = K.accent;
      ctx.fillRect(-7, -10, 5, 4); ctx.fillRect(2, -10, 5, 4);
    } else if (kitId === 'exodus') {
      ctx.fillStyle = K.hair;
      ctx.beginPath(); ctx.ellipse(0, -6, 18, 20, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = K.mid;
      ctx.beginPath(); ctx.ellipse(0, -8, 12.5, 14, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#0a0c10';
      ctx.fillRect(-13, -12, 26, 7);
      ctx.fillStyle = K.accent;
      ctx.beginPath(); ctx.ellipse(-6, -8.5, 4, 2.6, 0, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(6, -8.5, 4, 2.6, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#171a22';
      ctx.beginPath(); ctx.ellipse(0, 1, 9, 6, 0, 0, U.TAU); ctx.fill();
    } else if (kitId === 'paragon') {
      ctx.fillStyle = K.accent;
      ctx.beginPath(); ctx.arc(-19, 14, 8.5, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(19, 14, 8.5, 0, U.TAU); ctx.fill();
      ctx.fillStyle = K.hair;
      ctx.beginPath(); ctx.ellipse(0, -9, 14, 15, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#f0c9a0';
      ctx.beginPath(); ctx.ellipse(0, -5, 11, 12, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = K.base;
      ctx.beginPath();
      ctx.moveTo(-12, -12); ctx.lineTo(12, -12); ctx.lineTo(10, -4);
      ctx.lineTo(2, -6); ctx.lineTo(-2, -6); ctx.lineTo(-10, -4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = K.accent; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#123063';
      ctx.beginPath(); ctx.ellipse(-5.5, -9, 2.6, 1.8, 0, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5.5, -9, 2.6, 1.8, 0, 0, U.TAU); ctx.fill();
    } else if (kitId === 'dominus') {
      ctx.fillStyle = K.mid;
      ctx.beginPath();
      ctx.moveTo(-17, 16); ctx.quadraticCurveTo(-16, -24, 0, -24);
      ctx.quadraticCurveTo(16, -24, 17, 16);
      ctx.quadraticCurveTo(0, 8, -17, 16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, -6, 9.5, 12, 0, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.drawImage(glowSprite(K.accent), -14, -20, 28, 28);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = K.hair;
      ctx.beginPath(); ctx.ellipse(0, -4, 19, 22, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#2a2430';
      ctx.beginPath(); ctx.ellipse(0, -8, 12.5, 14, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = K.accent;
      ctx.beginPath();
      ctx.moveTo(0, 5); ctx.quadraticCurveTo(11, 2, 11, -10);
      ctx.quadraticCurveTo(0, -18, -11, -10);
      ctx.quadraticCurveTo(-11, 2, 0, 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(-7, -11, 5, 3); ctx.fillRect(2, -11, 5, 3);
    }
    ctx.restore();
  };
})();
