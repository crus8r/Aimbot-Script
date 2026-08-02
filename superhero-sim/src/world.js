/* VANGUARD — world.js
 * Procedural city map: streets, buildings (2.5D extruded), threat zones,
 * boss arenas, decals. No image assets.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var W = (SH.world = {
    w: 6400,
    h: 4800,
    cx: 3200,
    cy: 2400,
    obstacles: [],
    decals: [],
    lamps: [],
    arenas: [],
    maxDist: 1
  });

  W.THREAT_COLORS = ['#5ad1ff', '#5affa8', '#ffd76a', '#ff9a3c', '#ff4d5e', '#ff7a12'];
  W.THREAT_NAMES = ['QUIET DISTRICT', 'CONTESTED BLOCKS', 'BREACH ZONE', 'DEEP FRACTURE', 'BOSS ARENA', 'THE BLIGHT'];

  /* Versus mode borrows the world as a flat stage with no buildings */
  W.enterStage = function (w, h) {
    if (W._saved) return;
    W._saved = { obstacles: W.obstacles, w: W.w, h: W.h };
    W.obstacles = [];
    W.w = w; W.h = h;
  };
  W.exitStage = function () {
    if (!W._saved) return;
    W.obstacles = W._saved.obstacles;
    W.w = W._saved.w; W.h = W._saved.h;
    W._saved = null;
  };

  W.generate = function () {
    W.obstacles.length = 0;
    W.decals.length = 0;
    W.lamps.length = 0;
    W.arenas.length = 0;
    W.maxDist = U.dist(W.cx, W.cy, 0, 0);

    /* Boss arenas in the outer reaches */
    var arenaSpots = [
      { x: 900, y: 800 }, { x: W.w - 900, y: 800 },
      { x: 900, y: W.h - 800 }, { x: W.w - 900, y: W.h - 800 },
      { x: W.cx, y: 520 }, { x: W.cx, y: W.h - 520 }
    ];
    arenaSpots.forEach(function (s, i) {
      W.arenas.push({ x: s.x, y: s.y, r: 430, id: i, boss: null, respawn: 0, cleared: false, type: 'colossus', threat: 5 });
    });
    // the tier-6 site — Deathbringer's grove
    W.arenas.push({
      x: W.w - 760, y: W.cy, r: 480, id: 90, boss: null, respawn: 0,
      cleared: false, type: 'deathbringer', threat: 6
    });

    /* City blocks */
    var STEP = 620;
    for (var gy = 0; gy < Math.floor(W.h / STEP); gy++) {
      for (var gx = 0; gx < Math.floor(W.w / STEP); gx++) {
        var bx = gx * STEP + 90, by = gy * STEP + 90;
        var bw = STEP - 210, bh = STEP - 210;
        var count = 1 + ((U.hash(gx * 3.7, gy * 5.1) * 3) | 0);
        for (var k = 0; k < count; k++) {
          var w = U.rand(bw * 0.32, bw * (count > 1 ? 0.5 : 0.92));
          var h = U.rand(bh * 0.32, bh * (count > 1 ? 0.5 : 0.92));
          var x = bx + U.rand(0, Math.max(4, bw - w));
          var y = by + U.rand(0, Math.max(4, bh - h));
          var rect = { x: x, y: y, w: w, h: h, ht: U.rand(34, 165) };

          // keep the spawn plaza and boss arenas clear
          if (U.dist(x + w / 2, y + h / 2, W.cx, W.cy) < 620) continue;
          var skip = false;
          for (var a = 0; a < W.arenas.length; a++) {
            if (U.dist(x + w / 2, y + h / 2, W.arenas[a].x, W.arenas[a].y) < W.arenas[a].r + 130) { skip = true; break; }
          }
          if (skip) continue;
          if (x < 60 || y < 60 || x + w > W.w - 60 || y + h > W.h - 60) continue;

          rect.threat = W.threatAt(x + w / 2, y + h / 2);
          rect.seed = U.hash(x * 0.13, y * 0.17);
          W.obstacles.push(rect);
        }
      }
    }

    /* Arena pillars — cover inside boss fights */
    W.arenas.forEach(function (ar) {
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * U.TAU + 0.4;
        var d = ar.r * 0.66;
        var px = ar.x + Math.cos(a) * d - 26, py = ar.y + Math.sin(a) * d - 26;
        W.obstacles.push({ x: px, y: py, w: 52, h: 52, ht: 96, pillar: true, threat: 5, seed: i / 6 });
      }
    });

    /* Decals + lamps */
    for (var i = 0; i < 900; i++) {
      var dx = U.rand(60, W.w - 60), dy = U.rand(60, W.h - 60);
      if (!W.isClear(dx, dy, 22)) continue;
      var t = W.threatAt(dx, dy);
      W.decals.push({
        x: dx, y: dy, r: U.rand(10, 46), rot: U.rand(0, U.TAU),
        type: Math.random() < 0.62 ? 'crack' : (Math.random() < 0.6 ? 'rubble' : 'crystal'),
        threat: t
      });
    }
    for (var j = 0; j < 260; j++) {
      var lx = U.rand(80, W.w - 80), ly = U.rand(80, W.h - 80);
      if (!W.isClear(lx, ly, 26)) continue;
      W.lamps.push({ x: lx, y: ly, t: U.rand(0, 10), threat: W.threatAt(lx, ly) });
    }
  };

  W.threatAt = function (x, y) {
    for (var i = 0; i < W.arenas.length; i++) {
      if (U.within(x, y, W.arenas[i].x, W.arenas[i].y, W.arenas[i].r)) return W.arenas[i].threat || 5;
    }
    var d = U.dist(x, y, W.cx, W.cy) / W.maxDist;
    return U.clamp(1 + Math.floor(d * 4.6), 1, 4);
  };

  W.arenaAt = function (x, y) {
    for (var i = 0; i < W.arenas.length; i++) {
      if (U.within(x, y, W.arenas[i].x, W.arenas[i].y, W.arenas[i].r + 60)) return W.arenas[i];
    }
    return null;
  };

  W.isClear = function (x, y, r) {
    if (x < r || y < r || x > W.w - r || y > W.h - r) return false;
    for (var i = 0; i < W.obstacles.length; i++) {
      if (U.circleRectHit(x, y, r, W.obstacles[i])) return false;
    }
    return true;
  };

  /* Find a clear point in an annulus around (x,y) */
  W.findSpawn = function (x, y, minD, maxD, r) {
    r = r || 26;
    for (var i = 0; i < 40; i++) {
      var a = Math.random() * U.TAU;
      var d = U.rand(minD, maxD);
      var px = U.clamp(x + Math.cos(a) * d, 80, W.w - 80);
      var py = U.clamp(y + Math.sin(a) * d, 80, W.h - 80);
      if (W.isClear(px, py, r)) return { x: px, y: py };
    }
    return null;
  };

  /* Collide a circular body against buildings (ignored while airborne above them) */
  W.collide = function (e, r) {
    var obs = W.obstacles;
    var hit = false;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (e.z > o.ht) continue;
      if (e.x + r < o.x || e.x - r > o.x + o.w || e.y + r < o.y || e.y - r > o.y + o.h) continue;
      if (U.resolveCircleRect(e, r, o)) hit = true;
    }
    e.x = U.clamp(e.x, r + 16, W.w - r - 16);
    e.y = U.clamp(e.y, r + 16, W.h - r - 16);
    return hit;
  };

  /* Height of the tallest building under a point (for landing / flight) */
  W.groundHeightAt = function (x, y) {
    var best = 0;
    for (var i = 0; i < W.obstacles.length; i++) {
      var o = W.obstacles[i];
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) best = Math.max(best, o.ht);
    }
    return best;
  };
})();
