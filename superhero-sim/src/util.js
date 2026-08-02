/* VANGUARD — util.js
 * Math helpers, RNG, spatial hash grid, geometry resolution.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = (SH.util = {});

  var TAU = Math.PI * 2;
  U.TAU = TAU;
  U.PI = Math.PI;

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.rand = function (a, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); };
  U.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
  U.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
  U.chance = function (p) { return Math.random() < p; };
  U.sign = function (v) { return v < 0 ? -1 : v > 0 ? 1 : 0; };

  U.dist = function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); };
  U.dist2 = function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.within = function (ax, ay, bx, by, r) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy <= r * r; };
  U.angTo = function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); };

  U.angNorm = function (a) {
    a = a % TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  };
  U.angDiff = function (a, b) { return U.angNorm(b - a); };
  U.angApproach = function (a, b, step) {
    var d = U.angDiff(a, b);
    if (Math.abs(d) <= step) return b;
    return U.angNorm(a + (d > 0 ? step : -step));
  };
  U.approach = function (a, b, step) { return a < b ? Math.min(a + step, b) : Math.max(a - step, b); };

  U.ease = function (t) { return t * t * (3 - 2 * t); };
  U.easeOut = function (t) { return 1 - (1 - t) * (1 - t); };
  U.easeIn = function (t) { return t * t; };

  /* Deterministic-ish hash noise for map decoration */
  U.hash = function (x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };

  /* Colour helpers -------------------------------------------------------- */
  var hexCache = {};
  U.rgba = function (hex, a) {
    var c = hexCache[hex];
    if (!c) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      c = hexCache[hex] = [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16)
      ];
    }
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  };
  U.mixHex = function (a, b, t) {
    var ca = U.rgba(a, 1).match(/\d+/g), cb = U.rgba(b, 1).match(/\d+/g);
    var r = Math.round(U.lerp(+ca[0], +cb[0], t));
    var g = Math.round(U.lerp(+ca[1], +cb[1], t));
    var bl = Math.round(U.lerp(+ca[2], +cb[2], t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  };

  /* Vector ---------------------------------------------------------------- */
  U.norm = function (x, y) {
    var l = Math.hypot(x, y);
    if (l < 1e-6) return { x: 0, y: 0, l: 0 };
    return { x: x / l, y: y / l, l: l };
  };

  /* Circle vs axis-aligned rect resolution (moves the circle out) ---------- */
  U.resolveCircleRect = function (e, r, rect) {
    var cx = U.clamp(e.x, rect.x, rect.x + rect.w);
    var cy = U.clamp(e.y, rect.y, rect.y + rect.h);
    var dx = e.x - cx, dy = e.y - cy;
    var d2 = dx * dx + dy * dy;
    if (d2 > r * r) return false;
    if (d2 < 1e-8) {
      // centre inside the rect: eject along the shallowest axis
      var left = e.x - rect.x, right = rect.x + rect.w - e.x;
      var top = e.y - rect.y, bot = rect.y + rect.h - e.y;
      var m = Math.min(left, right, top, bot);
      if (m === left) e.x = rect.x - r;
      else if (m === right) e.x = rect.x + rect.w + r;
      else if (m === top) e.y = rect.y - r;
      else e.y = rect.y + rect.h + r;
      return true;
    }
    var d = Math.sqrt(d2);
    var push = r - d;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
    return true;
  };

  U.circleRectHit = function (x, y, r, rect) {
    var cx = U.clamp(x, rect.x, rect.x + rect.w);
    var cy = U.clamp(y, rect.y, rect.y + rect.h);
    var dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  /* Uniform spatial hash grid --------------------------------------------- */
  function Grid(cell) {
    this.cell = cell || 128;
    this.map = new Map();
    this.stamp = 0;
  }
  Grid.prototype.key = function (cx, cy) { return cx * 73856093 ^ cy * 19349663; };
  Grid.prototype.clear = function () { this.map.clear(); };
  Grid.prototype.insert = function (e) {
    var cx = Math.floor(e.x / this.cell), cy = Math.floor(e.y / this.cell);
    var k = this.key(cx, cy);
    var b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(e);
  };
  Grid.prototype.query = function (x, y, r, out) {
    out = out || [];
    out.length = 0;
    var c = this.cell;
    var x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    var y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (var cy = y0; cy <= y1; cy++) {
      for (var cx = x0; cx <= x1; cx++) {
        var b = this.map.get(this.key(cx, cy));
        if (!b) continue;
        for (var i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  };
  SH.Grid = Grid;

  /* Small helper: pick the nearest live enemy to a point ------------------- */
  U.nearestEnemy = function (x, y, maxR, filter) {
    var list = SH.ents.enemies, best = null, bd = maxR * maxR;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.spawning > 0) continue;
      if (filter && !filter(e)) continue;
      var d = U.dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  /* three.js is 608KB and is only ever touched by the Versus fighters, so it
     is fetched the moment the player heads that way rather than on boot.
     A script TAG, not fetch: tags work from file://, fetch does not. Failure
     needs no handler — sideview falls back to the canvas renderer. */
  SH.loadThree = function () {
    if (SH.loadThree.started || window.THREE) return;
    SH.loadThree.started = true;
    var s = document.createElement('script');
    s.src = 'vendor/three.min.js';
    s.async = true;
    document.head.appendChild(s);
  };

  U.formatNum = function (n) {
    n = Math.round(n);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return '' + n;
  };
})();
