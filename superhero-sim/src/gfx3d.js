/* VANGUARD — gfx3d.js
 * A small immediate-mode 3D renderer, used only by the Versus stage.
 *
 * Quad-based low-poly: build parts with a matrix stack, batch the polygons,
 * light them per face, depth-sort and rasterise through canvas 2D. No
 * dependencies, no build step, no assets — same as the rest of the game.
 *
 * World axes:  +X along the stage,  +Y up from the floor,  +Z toward camera.
 * The projection is anchored so Z = 0 matches the existing 2D stage camera
 * exactly, which lets 3D fighters stand inside the painted backdrop.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var G = (SH.g3 = {});

  /* =====================================================================
   * MATRIX STACK (3x4 affine, row-major)
   * =================================================================== */
  function ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; }

  function mul(a, b) {
    var o = new Array(12);
    for (var r = 0; r < 3; r++) {
      var r4 = r * 4;
      var a0 = a[r4], a1 = a[r4 + 1], a2 = a[r4 + 2], a3 = a[r4 + 3];
      o[r4] = a0 * b[0] + a1 * b[4] + a2 * b[8];
      o[r4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
      o[r4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
      o[r4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3;
    }
    return o;
  }

  var M = ident();
  var stack = [];

  G.reset = function () { M = ident(); stack.length = 0; };
  G.push = function () { stack.push(M); M = M.slice(); };
  G.pop = function () { M = stack.pop() || ident(); };

  G.tx = function (x, y, z) { M = mul(M, [1, 0, 0, x || 0, 0, 1, 0, y || 0, 0, 0, 1, z || 0]); };
  G.sc = function (x, y, z) {
    if (y === undefined) { y = x; z = x; }
    M = mul(M, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0]);
  };
  G.rx = function (a) { var c = Math.cos(a), s = Math.sin(a); M = mul(M, [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]); };
  G.ry = function (a) { var c = Math.cos(a), s = Math.sin(a); M = mul(M, [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]); };
  G.rz = function (a) { var c = Math.cos(a), s = Math.sin(a); M = mul(M, [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]); };

  function tpx(x, y, z) { return M[0] * x + M[1] * y + M[2] * z + M[3]; }
  function tpy(x, y, z) { return M[4] * x + M[5] * y + M[6] * z + M[7]; }
  function tpz(x, y, z) { return M[8] * x + M[9] * y + M[10] * z + M[11]; }
  G.point = function (x, y, z) { return { x: tpx(x, y, z), y: tpy(x, y, z), z: tpz(x, y, z) }; };

  /* =====================================================================
   * COLOUR
   * =================================================================== */
  var rgbCache = {};
  function rgb(hex) {
    if (typeof hex !== 'string') return hex;
    var c = rgbCache[hex];
    if (!c) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      c = rgbCache[hex] = [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
    }
    return c;
  }
  G.rgb = rgb;

  /* Materials are plain objects; colours are resolved once and cached. */
  G.mat = function (col, o) {
    o = o || {};
    return {
      col: o.em ? col : rgb(col),
      emCol: col,
      em: o.em ? 1 : 0,
      alpha: o.alpha === undefined ? 1 : o.alpha,
      two: o.two ? 1 : 0,
      flat: o.flat || 1
    };
  };

  /* =====================================================================
   * POLYGON BATCH
   * =================================================================== */
  var pool = [];
  var count = 0;
  var MAXQ = 2400;

  function alloc() {
    var q = pool[count];
    if (!q) {
      q = pool[count] = {
        x: [0, 0, 0, 0], y: [0, 0, 0, 0], z: [0, 0, 0, 0],
        nx: 0, ny: 0, nz: 0, col: null, em: 0, alpha: 1, d: 0, two: 0, n: 4
      };
    }
    count++;
    return q;
  }

  G.begin = function () { count = 0; gcount = 0; G.reset(); };
  G.count = function () { return count; };

  /* Emissive glows, recorded in world space and drawn after the polygons. */
  var glows = [], gcount = 0;
  G.glow = function (x, y, z, r, col, a) {
    var g = glows[gcount] || (glows[gcount] = {});
    g.x = tpx(x, y, z); g.y = tpy(x, y, z); g.z = tpz(x, y, z);
    g.r = r; g.col = col; g.a = a === undefined ? 0.6 : a;
    gcount++;
  };
  G.renderGlows = function (ctx) {
    for (var i = 0; i < gcount; i++) {
      var g = glows[i];
      var p = G.project(g.x, g.y, g.z);
      SH.render.glowAt(ctx, p.x, p.y, g.r * p.s * camScale(), g.col, g.a);
    }
  };
  function camScale() { return cam.s; }

  var _vx = [0, 0, 0, 0], _vy = [0, 0, 0, 0], _vz = [0, 0, 0, 0];

  function poly(n, mat) {
    if (count >= MAXQ) return;
    var q = alloc();
    q.n = n;
    var i;
    for (i = 0; i < n; i++) {
      q.x[i] = tpx(_vx[i], _vy[i], _vz[i]);
      q.y[i] = tpy(_vx[i], _vy[i], _vz[i]);
      q.z[i] = tpz(_vx[i], _vy[i], _vz[i]);
    }
    // outward normal = (v2-v0) x (v1-v0)
    var ax = q.x[1] - q.x[0], ay = q.y[1] - q.y[0], az = q.z[1] - q.z[0];
    var bx = q.x[2] - q.x[0], by = q.y[2] - q.y[0], bz = q.z[2] - q.z[0];
    var nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    q.nx = nx / l; q.ny = ny / l; q.nz = nz / l;
    q.col = mat.em ? mat.emCol : mat.col;
    q.em = mat.em;
    q.alpha = mat.alpha;
    q.two = mat.two;
    var d = 0;
    for (i = 0; i < n; i++) d += q.z[i];
    q.d = d / n;
  }

  function quad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, mat) {
    _vx[0] = x0; _vy[0] = y0; _vz[0] = z0;
    _vx[1] = x1; _vy[1] = y1; _vz[1] = z1;
    _vx[2] = x2; _vy[2] = y2; _vz[2] = z2;
    _vx[3] = x3; _vy[3] = y3; _vz[3] = z3;
    poly(4, mat);
  }
  function tri(x0, y0, z0, x1, y1, z1, x2, y2, z2, mat) {
    _vx[0] = x0; _vy[0] = y0; _vz[0] = z0;
    _vx[1] = x1; _vy[1] = y1; _vz[1] = z1;
    _vx[2] = x2; _vy[2] = y2; _vz[2] = z2;
    poly(3, mat);
  }
  G.quad = quad;
  G.tri = tri;

  /* =====================================================================
   * PRIMITIVES
   * =================================================================== */
  G.box = function (w, h, d, mat) {
    var x = w / 2, y = h / 2, z = d / 2;
    quad(-x, y, z, x, y, z, x, -y, z, -x, -y, z, mat);       // +Z
    quad(x, y, -z, -x, y, -z, -x, -y, -z, x, -y, -z, mat);   // -Z
    quad(-x, y, -z, x, y, -z, x, y, z, -x, y, z, mat);       // +Y
    quad(-x, -y, z, x, -y, z, x, -y, -z, -x, -y, -z, mat);   // -Y
    quad(x, y, z, x, y, -z, x, -y, -z, x, -y, z, mat);       // +X
    quad(-x, y, -z, -x, y, z, -x, -y, z, -x, -y, -z, mat);   // -X
  };

  /* Tapered prism along +X, origin at the near cap centre. */
  G.prism = function (len, r0, r1, seg, mat, caps, flat) {
    seg = seg || 6;
    flat = flat || mat.flat || 1;
    var i, a0, a1, c0, s0, c1, s1;
    for (i = 0; i < seg; i++) {
      a0 = (i / seg) * U.TAU; a1 = ((i + 1) / seg) * U.TAU;
      c0 = Math.cos(a0); s0 = Math.sin(a0);
      c1 = Math.cos(a1); s1 = Math.sin(a1);
      quad(
        0, c0 * r0, s0 * r0 * flat,
        len, c0 * r1, s0 * r1 * flat,
        len, c1 * r1, s1 * r1 * flat,
        0, c1 * r0, s1 * r0 * flat,
        mat);
    }
    if (caps) {
      var cm = capMat(mat);
      for (i = 1; i < seg - 1; i++) {
        a0 = (i / seg) * U.TAU; a1 = ((i + 1) / seg) * U.TAU;
        tri(len, r1, 0,
          len, Math.cos(a0) * r1, Math.sin(a0) * r1 * flat,
          len, Math.cos(a1) * r1, Math.sin(a1) * r1 * flat, cm);
        tri(0, r0, 0,
          0, Math.cos(a0) * r0, Math.sin(a0) * r0 * flat,
          0, Math.cos(a1) * r0, Math.sin(a1) * r0 * flat, cm);
      }
    }
  };

  var capCache = null, capSrc = null;
  function capMat(mat) {
    if (capSrc === mat && capCache) return capCache;
    capSrc = mat;
    capCache = { col: mat.col, emCol: mat.emCol, em: mat.em, alpha: mat.alpha, two: 1, flat: mat.flat };
    return capCache;
  }

  G.sphere = function (r, seg, rings, mat) {
    seg = seg || 8; rings = rings || 5;
    var flat = mat.flat || 1;
    for (var j = 0; j < rings; j++) {
      var p0 = (j / rings) * Math.PI, p1 = ((j + 1) / rings) * Math.PI;
      var y0 = Math.cos(p0) * r, y1 = Math.cos(p1) * r;
      var r0 = Math.sin(p0) * r, r1 = Math.sin(p1) * r;
      for (var i = 0; i < seg; i++) {
        var a0 = (i / seg) * U.TAU, a1 = ((i + 1) / seg) * U.TAU;
        var c0 = Math.cos(a0), s0 = Math.sin(a0) * flat, c1 = Math.cos(a1), s1 = Math.sin(a1) * flat;
        if (j === 0) {
          tri(0, y0, 0, c0 * r1, y1, s0 * r1, c1 * r1, y1, s1 * r1, mat);
        } else if (j === rings - 1) {
          tri(c0 * r0, y0, s0 * r0, 0, y1, 0, c1 * r0, y0, s1 * r0, mat);
        } else {
          quad(c0 * r0, y0, s0 * r0, c0 * r1, y1, s0 * r1, c1 * r1, y1, s1 * r1, c1 * r0, y0, s1 * r0, mat);
        }
      }
    }
  };

  /* Flat quad in the local XY plane — capes, wings, blades. */
  G.plane = function (w, h, mat) {
    var x = w / 2, y = h / 2;
    quad(-x, y, 0, x, y, 0, x, -y, 0, -x, -y, 0, mat);
  };

  /* A bone: rotate to a 2D screen-space angle, draw a tapered limb, and
     leave the origin at the far end so bones chain. */
  G.bone = function (ang, len, r0, r1, seg, mat) {
    G.rz(-ang);
    G.prism(len, r0, r1, seg || 6, mat);
    G.tx(len, 0, 0);
  };

  /* =====================================================================
   * CAMERA + RASTERISER
   * =================================================================== */
  var cam = { vw: 0, vh: 0, cx: 0, cy: 0, s: 1, dist: 620, groundY: 0, sx: 0, sy: 0 };
  G.setCam = function (o) {
    cam.vw = o.vw; cam.vh = o.vh;
    cam.cx = o.camX; cam.cy = o.camY;
    cam.s = o.scale;
    cam.dist = o.dist || 620;
    cam.groundY = o.groundY;
    cam.sx = o.shakeX || 0; cam.sy = o.shakeY || 0;
  };

  var LX = -0.34, LY = 0.76, LZ = 0.55;
  (function () { var l = Math.hypot(LX, LY, LZ); LX /= l; LY /= l; LZ /= l; })();
  var AMB = 0.38;
  var RIMR = 150, RIMG = 190, RIMB = 255, RIMK = 0.22;

  G.light = function (x, y, z) {
    var l = Math.hypot(x, y, z) || 1;
    LX = x / l; LY = y / l; LZ = z / l;
  };
  G.setRim = function (hex, k) {
    var c = rgb(hex);
    RIMR = c[0]; RIMG = c[1]; RIMB = c[2];
    if (k !== undefined) RIMK = k;
  };
  G.setAmbient = function (a) { AMB = a; };

  var order = [];
  var PX = [0, 0, 0, 0], PY = [0, 0, 0, 0];

  G.render = function (ctx, opts) {
    opts = opts || {};
    var mirror = opts.mirror ? -0.55 : 1;
    var gAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    var dim = opts.dim || 0;
    var camH = cam.groundY - cam.cy;
    var focal = cam.s * cam.dist;
    var hw = cam.vw / 2 - cam.sx * cam.s, hh = cam.vh / 2 - cam.sy * cam.s;

    order.length = 0;
    for (var i = 0; i < count; i++) order.push(i);
    order.sort(cmp);

    ctx.lineJoin = 'round';
    for (var k = 0; k < order.length; k++) {
      var q = pool[order[k]];
      if (!q.two && q.nz < 0.015) continue;             // backface cull

      var n = q.n, ok = true;
      for (var v = 0; v < n; v++) {
        var rz = cam.dist - q.z[v];
        if (rz < 40) { ok = false; break; }
        var f = focal / rz;
        PX[v] = hw + (q.x[v] - cam.cx) * f;
        PY[v] = hh - (q.y[v] * mirror - camH) * f;
      }
      if (!ok) continue;

      var col;
      if (q.em) {
        col = q.col;
      } else {
        var lam = q.nx * LX + q.ny * LY + q.nz * LZ;
        if (lam < 0) lam = 0;
        var sh = (AMB + (1 - AMB) * lam) * (1 - dim);
        var rim = 1 - (q.nz < 0 ? -q.nz : q.nz);
        rim = rim * rim * rim * RIMK * (1 - dim);
        var c = q.col;
        var r = c[0] * sh + RIMR * rim;
        var g = c[1] * sh + RIMG * rim;
        var b = c[2] * sh + RIMB * rim;
        col = 'rgb(' + (r > 255 ? 255 : r | 0) + ',' + (g > 255 ? 255 : g | 0) + ',' + (b > 255 ? 255 : b | 0) + ')';
      }

      ctx.globalAlpha = q.alpha * gAlpha;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(PX[0], PY[0]);
      for (var m = 1; m < n; m++) ctx.lineTo(PX[m], PY[m]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = col;      // kills antialiased seams between quads
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  function cmp(a, b) { return pool[a].d - pool[b].d; }

  /* Project a 3D point to screen pixels — used for glows and FX anchors. */
  G.project = function (x, y, z) {
    var camH = cam.groundY - cam.cy;
    var focal = cam.s * cam.dist;
    var rz = cam.dist - z;
    if (rz < 40) rz = 40;
    var f = focal / rz;
    return {
      x: cam.vw / 2 - cam.sx * cam.s + (x - cam.cx) * f,
      y: cam.vh / 2 - cam.sy * cam.s - (y - camH) * f,
      s: f / cam.s
    };
  };
})();
