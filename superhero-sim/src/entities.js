/* VANGUARD — entities.js
 * Particles, projectiles, hazards, structures, pickups, floating text,
 * and the shared combat resolution helpers.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var ents = (SH.ents = {
    enemies: [],
    projectiles: [],
    particles: [],
    hazards: [],
    structures: [],
    pickups: [],
    texts: [],
    after: [] // after-images
  });

  SH.ents.clearAll = function () {
    ents.enemies.length = 0;
    ents.projectiles.length = 0;
    ents.particles.length = 0;
    ents.hazards.length = 0;
    ents.structures.length = 0;
    ents.pickups.length = 0;
    ents.texts.length = 0;
    ents.after.length = 0;
  };

  var MAX_PARTICLES = 780;
  var pPool = [];

  /* ======================================================================
   * FX
   * ==================================================================== */
  var FX = (SH.fx = {});

  function alloc() { return pPool.pop() || {}; }
  function release(p) { if (pPool.length < 1000) pPool.push(p); }

  FX.particle = function (o) {
    if (ents.particles.length >= MAX_PARTICLES) return null;
    var p = alloc();
    p.x = o.x; p.y = o.y; p.z = o.z || 0;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.maxLife = o.life || 0.5;
    p.size = o.size || 3;
    p.size1 = o.size1 === undefined ? 0 : o.size1;
    p.color = o.color || '#fff';
    p.color2 = o.color2 || null;
    p.mode = o.mode || 'dot';
    p.drag = o.drag === undefined ? 2.2 : o.drag;
    p.grav = o.grav || 0;
    p.rot = o.rot || 0;
    p.spin = o.spin || 0;
    p.alpha = o.alpha === undefined ? 1 : o.alpha;
    p.glow = !!o.glow;
    p.pts = o.pts || null;
    p.follow = o.follow || null;
    p.fx = o.fx || 0; p.fy = o.fy || 0;
    ents.particles.push(p);
    return p;
  };

  FX.burst = function (x, y, z, o) {
    o = o || {};
    var n = o.n || 8;
    var dir = o.dir === undefined ? null : o.dir;
    var spread = o.spread === undefined ? U.TAU : o.spread;
    for (var i = 0; i < n; i++) {
      var a = dir === null ? Math.random() * U.TAU : dir + U.rand(-spread / 2, spread / 2);
      var sp = U.rand((o.speed || 160) * 0.35, o.speed || 160);
      FX.particle({
        x: x, y: y, z: z || 0,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        vz: o.vz === undefined ? U.rand(-20, 90) : U.rand(0, o.vz),
        life: U.rand((o.life || 0.5) * 0.6, o.life || 0.5),
        size: U.rand((o.size || 3) * 0.6, o.size || 3),
        color: o.color || '#fff', color2: o.color2 || null,
        mode: o.mode || 'dot', grav: o.grav === undefined ? 190 : o.grav,
        drag: o.drag === undefined ? 2.4 : o.drag,
        glow: o.glow !== false, rot: a, spin: U.rand(-6, 6)
      });
    }
  };

  FX.ring = function (x, y, z, r0, r1, color, life, width) {
    FX.particle({
      x: x, y: y, z: z || 0, life: life || 0.4, size: r0, size1: r1,
      color: color, mode: 'ring', drag: 0, alpha: 1, glow: true, rot: width || 3
    });
  };

  FX.flash = function (x, y, z, r, color, life) {
    FX.particle({ x: x, y: y, z: z || 0, life: life || 0.22, size: r, size1: r * 0.2, color: color, mode: 'glow', drag: 0, glow: true });
  };

  FX.slash = function (x, y, z, ang, arc, range, color, life) {
    FX.particle({
      x: x, y: y, z: z || 0, life: life || 0.2, size: range, size1: arc,
      color: color, mode: 'slash', rot: ang, drag: 0, glow: true
    });
  };

  FX.bolt = function (x1, y1, x2, y2, color, life, jag, z) {
    var pts = [], n = Math.max(3, Math.min(14, Math.round(U.dist(x1, y1, x2, y2) / 26)));
    var nx = -(y2 - y1), ny = (x2 - x1);
    var l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    jag = jag === undefined ? 16 : jag;
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var off = (i === 0 || i === n) ? 0 : U.rand(-jag, jag);
      pts.push(U.lerp(x1, x2, t) + nx * off, U.lerp(y1, y2, t) + ny * off);
    }
    FX.particle({ x: 0, y: 0, z: z || 0, life: life || 0.14, color: color, mode: 'bolt', pts: pts, drag: 0, glow: true, size: 3 });
  };

  FX.text = function (x, y, z, str, color, size, vy) {
    if (ents.texts.length > 44) ents.texts.shift();
    ents.texts.push({
      x: x + U.rand(-8, 8), y: y, z: (z || 0) + 8, str: str, color: color || '#fff',
      size: size || 15, life: 0.85, maxLife: 0.85, vy: vy === undefined ? -46 : vy, vx: U.rand(-14, 14)
    });
  };

  FX.after = function (h, life, color) {
    if (ents.after.length > 26) ents.after.shift();
    ents.after.push({ hero: h.kitId || null, kit: h.kit || null, ent: h, x: h.x, y: h.y, z: h.z, facing: h.facing, life: life || 0.28, maxLife: life || 0.28, color: color });
  };

  FX.shake = function (amt) { if (SH.render) SH.render.shake(amt); };

  /* ======================================================================
   * Projectiles
   * ==================================================================== */
  SH.spawnProjectile = function (o) {
    var p = {
      x: o.x, y: o.y, z: o.z || 22,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      r: o.r || 8, dmg: o.dmg || 10, team: o.team || 'hero',
      life: o.life || 2, maxLife: o.life || 2,
      type: o.type || 'orb', color: o.color || '#fff', color2: o.color2 || null,
      pierce: o.pierce || 0, hits: null, grav: o.grav || 0,
      homing: o.homing || 0, target: o.target || null,
      knock: o.knock || 0, elem: o.elem || null,
      sticky: !!o.sticky, stuckTo: null, stuckT: 0, fuse: o.fuse || 1.2, state: 'fly',
      onHit: o.onHit || null, onExpire: o.onExpire || null, onUpdate: o.onUpdate || null,
      size: o.size || 8, spin: o.spin || 0, rot: o.rot || 0,
      owner: o.owner || null, hitWalls: o.hitWalls !== false, dead: false,
      trailT: 0, trailEvery: o.trailEvery || 0,
      data: o.data || {}
    };
    if (p.pierce > 0 || p.sticky) p.hits = [];
    ents.projectiles.push(p);
    return p;
  };

  function projHitWall(p) {
    if (!p.hitWalls) return false;
    var obs = SH.world.obstacles;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (p.z > o.ht) continue;
      if (p.x + p.r < o.x || p.x - p.r > o.x + o.w || p.y + p.r < o.y || p.y - p.r > o.y + o.h) continue;
      if (U.circleRectHit(p.x, p.y, p.r, o)) return true;
    }
    return false;
  }

  var qbuf = [];
  function updateProjectiles(dt) {
    var list = ents.projectiles;
    var player = SH.game.player();
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];

      if (p.state === 'stuck') {
        p.stuckT -= dt;
        if (p.stuckTo) {
          if (p.stuckTo.dead) { p.stuckTo = null; }
          else { p.x = p.stuckTo.x; p.y = p.stuckTo.y; p.z = p.stuckTo.z + 16; }
        }
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = 0.08;
          FX.particle({ x: p.x + U.rand(-6, 6), y: p.y + U.rand(-6, 6), z: p.z, vz: 26, life: 0.28, size: 2.6, color: p.color, glow: true, drag: 1 });
        }
        if (p.stuckT <= 0) {
          if (p.onExpire) p.onExpire(p);
          list.splice(i, 1);
        }
        continue;
      }

      p.life -= dt;
      if (p.life <= 0) {
        if (p.onExpire) p.onExpire(p);
        list.splice(i, 1);
        continue;
      }

      if (p.homing > 0) {
        if (!p.target || p.target.dead) {
          p.target = p.team === 'hero' ? U.nearestEnemy(p.x, p.y, 420) : player;
        }
        if (p.target && !p.target.dead) {
          var want = U.angTo(p.x, p.y, p.target.x, p.target.y);
          var cur = Math.atan2(p.vy, p.vx);
          var sp = Math.hypot(p.vx, p.vy);
          cur = U.angApproach(cur, want, p.homing * dt);
          p.vx = Math.cos(cur) * sp; p.vy = Math.sin(cur) * sp;
        }
      }

      p.vz -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      if (p.onUpdate) p.onUpdate(p, dt);

      if (p.trailEvery > 0) {
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = p.trailEvery;
          FX.particle({
            x: p.x, y: p.y, z: p.z, life: 0.2, size: p.size * 0.3, color: p.color,
            glow: true, drag: 3, vx: U.rand(-14, 14), vy: U.rand(-14, 14)
          });
        }
      }

      // world bounds / walls
      if (p.x < 0 || p.y < 0 || p.x > SH.world.w || p.y > SH.world.h || (p.z <= 0 && p.grav > 0) || projHitWall(p)) {
        if (p.sticky && p.z <= 40) {
          p.state = 'stuck'; p.stuckT = p.fuse; p.z = Math.max(p.z, 6);
          p.vx = p.vy = p.vz = 0;
          continue;
        }
        if (p.onExpire) p.onExpire(p);
        list.splice(i, 1);
        continue;
      }

      // collisions
      if (p.team === 'hero') {
        var cands = SH.grid.query(p.x, p.y, p.r + 44, qbuf);
        for (var j = 0; j < cands.length; j++) {
          var e = cands[j];
          if (e.dead || e.spawning > 0) continue;
          if (p.hits && p.hits.indexOf(e) >= 0) continue;
          // heroes shoot down from the air, so allow generous overhead reach
          if (p.z < e.z - 40 || p.z > e.z + e.h + 150) continue;
          if (!U.within(p.x, p.y, e.x, e.y, p.r + e.r)) continue;

          if (p.sticky) {
            p.state = 'stuck'; p.stuckTo = e; p.stuckT = p.fuse;
            p.vx = p.vy = p.vz = 0;
            SH.audio.play('zap');
            break;
          }
          var dir = Math.atan2(p.vy, p.vx);
          SH.combat.hitEnemy(e, p.dmg, { dir: dir, knock: p.knock, elem: p.elem, fromX: p.x, fromY: p.y, owner: p.owner });
          if (p.onHit) p.onHit(p, e);
          if (p.hits) p.hits.push(e);
          if (p.pierce > 0) { p.pierce--; }
          else { p.dead = true; break; }
        }
        if (p.dead) { list.splice(i, 1); continue; }
      } else {
        if (player && !player.ko) {
          var reach = p.r + player.radius;
          if (U.within(p.x, p.y, player.x, player.y, reach) && Math.abs(p.z - (player.z + 20)) < 46) {
            var absorbed = SH.combat.hitPlayer(player, p.dmg, { fromX: p.x, fromY: p.y, elem: p.elem, projectile: p });
            if (p.onHit) p.onHit(p, player);
            if (!absorbed || absorbed !== 'reflect') {
              list.splice(i, 1);
              continue;
            }
          }
        }
      }
    }
  }

  /* ======================================================================
   * Hazards — lingering ground effects & delayed telegraphs
   * ==================================================================== */
  SH.spawnHazard = function (o) {
    var h = {
      x: o.x, y: o.y, r: o.r || 60, r1: o.r1 || null,
      life: o.life || 2, maxLife: o.life || 2,
      team: o.team || 'enemy', kind: o.kind || 'field',
      dps: o.dps || 0, color: o.color || '#fff', color2: o.color2 || null,
      slow: o.slow || 0, heal: o.heal || 0, elem: o.elem || null,
      delay: o.delay || 0, resolved: false, dmg: o.dmg || 0, knock: o.knock || 0,
      tickAcc: 0, tick: o.tick || 0.25, onResolve: o.onResolve || null,
      onTick: o.onTick || null, owner: o.owner || null, follow: o.follow || null,
      data: o.data || {}, ringOnly: !!o.ringOnly, dead: false
    };
    ents.hazards.push(h);
    return h;
  };

  function updateHazards(dt) {
    var list = ents.hazards;
    var player = SH.game.player();
    for (var i = list.length - 1; i >= 0; i--) {
      var h = list[i];
      if (h.follow && !h.follow.dead) { h.x = h.follow.x; h.y = h.follow.y; }

      if (h.delay > 0) {
        h.delay -= dt;
        if (h.delay <= 0) {
          h.resolved = true;
          if (h.onResolve) h.onResolve(h);
          if (h.dmg > 0) {
            if (h.team === 'enemy') {
              if (player && !player.ko && U.within(h.x, h.y, player.x, player.y, h.r + player.radius) && player.z < 90) {
                SH.combat.hitPlayer(player, h.dmg, { fromX: h.x, fromY: h.y, elem: h.elem });
              }
            } else {
              SH.combat.aoe(h.x, h.y, h.r, h.dmg, { knock: h.knock, elem: h.elem, owner: h.owner });
            }
          }
          FX.ring(h.x, h.y, 4, h.r * 0.6, h.r, h.color, 0.35, 5);
          FX.burst(h.x, h.y, 6, { n: 14, color: h.color, speed: 260, size: 5, life: 0.5 });
        }
        continue;
      }

      h.life -= dt;
      if (h.life <= 0) { list.splice(i, 1); continue; }

      h.tickAcc += dt;
      if (h.tickAcc >= h.tick) {
        h.tickAcc -= h.tick;
        if (h.onTick) h.onTick(h);
        if (h.team === 'enemy' && h.dps > 0 && player && !player.ko && player.z < 80) {
          if (U.within(h.x, h.y, player.x, player.y, h.r + player.radius)) {
            SH.combat.hitPlayer(player, h.dps * h.tick, { fromX: h.x, fromY: h.y, elem: h.elem, dot: true });
          }
        }
        if (h.team === 'hero') {
          if (h.dps > 0) SH.combat.aoe(h.x, h.y, h.r, h.dps * h.tick, { elem: h.elem, silent: true, owner: h.owner, dot: true });
          if (h.slow > 0) {
            var cs = SH.grid.query(h.x, h.y, h.r + 40, qbuf);
            for (var k = 0; k < cs.length; k++) {
              var e = cs[k];
              if (e.dead) continue;
              if (U.within(h.x, h.y, e.x, e.y, h.r + e.r)) SH.combat.status(e, 'chill', 0.6, { slow: h.slow });
            }
          }
          if (h.heal > 0 && player && !player.ko && U.within(h.x, h.y, player.x, player.y, h.r)) {
            SH.combat.healHero(player, h.heal * h.tick, true);
          }
        }
      }

      // ambient particles
      if (Math.random() < (h.kind === 'storm' ? 0.7 : 0.35)) {
        FX.particle({
          x: h.x + U.rand(-h.r, h.r), y: h.y + U.rand(-h.r, h.r), z: 2,
          vz: U.rand(10, 50), life: U.rand(0.3, 0.7), size: U.rand(1.5, 3.5),
          color: h.color, glow: true, drag: 1.4
        });
      }
    }
  }

  /* ======================================================================
   * Structures — solid summoned constructs (Vitality's amber spires)
   * ==================================================================== */
  SH.spawnStructure = function (o) {
    var s = {
      x: o.x, y: o.y, r: o.r || 22, ht: o.ht || 48,
      hp: o.hp || 60, maxHp: o.hp || 60, life: o.life || 10, maxLife: o.life || 10,
      color: o.color || '#ffb43a', type: o.type || 'spire', touchDmg: o.touchDmg || 0,
      grow: 0, dead: false, owner: o.owner || null, data: o.data || {}
    };
    ents.structures.push(s);
    return s;
  };

  function updateStructures(dt) {
    var list = ents.structures;
    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i];
      s.life -= dt;
      s.grow = Math.min(1, s.grow + dt * 6);
      if (s.life <= 0 || s.hp <= 0) {
        FX.burst(s.x, s.y, 10, { n: 12, color: s.color, speed: 190, size: 5, life: 0.5, mode: 'shard' });
        list.splice(i, 1);
        continue;
      }
      if (s.touchDmg > 0) {
        var cs = SH.grid.query(s.x, s.y, s.r + 46, qbuf);
        for (var j = 0; j < cs.length; j++) {
          var e = cs[j];
          if (e.dead) continue;
          if (U.within(s.x, s.y, e.x, e.y, s.r + e.r)) {
            if (!e._spireT || e._spireT <= 0) {
              e._spireT = 0.5;
              SH.combat.hitEnemy(e, s.touchDmg, { fromX: s.x, fromY: s.y, knock: 130, dir: U.angTo(s.x, s.y, e.x, e.y), owner: s.owner });
            }
          }
        }
      }
    }
  }

  /* ======================================================================
   * Pickups
   * ==================================================================== */
  SH.spawnPickup = function (x, y, kind) {
    if (ents.pickups.length > 90) return;
    var a = Math.random() * U.TAU, sp = U.rand(40, 140);
    ents.pickups.push({
      x: x, y: y, z: 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(60, 140),
      kind: kind, life: 16, t: 0, magnet: false
    });
  };

  function updatePickups(dt) {
    var list = ents.pickups;
    var player = SH.game.player();
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt; p.t += dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      if (player && !player.ko) {
        var d = U.dist(p.x, p.y, player.x, player.y);
        if (d < 190) p.magnet = true;
        if (p.magnet) {
          var a = U.angTo(p.x, p.y, player.x, player.y);
          var pull = 380 + (190 - Math.min(d, 190)) * 4;
          p.vx = U.lerp(p.vx, Math.cos(a) * pull, 0.18);
          p.vy = U.lerp(p.vy, Math.sin(a) * pull, 0.18);
        }
        if (d < 30) {
          if (p.kind === 'hp') {
            SH.combat.healHero(player, player.maxHp * 0.06);
            SH.audio.play('heal');
          } else {
            SH.game.addSurge(14, true);
            FX.particle({ x: p.x, y: p.y, z: p.z, life: 0.3, size: 22, size1: 2, color: '#8ef', mode: 'glow', glow: true });
          }
          list.splice(i, 1);
          continue;
        }
      }
      p.vz -= 520 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 10) { p.z = 10; p.vz = Math.abs(p.vz) * 0.35; }
      if (!p.magnet) { p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt; }
    }
  }

  /* ======================================================================
   * Particles / text update
   * ==================================================================== */
  function updateParticles(dt) {
    var list = ents.particles;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) { release(p); list.splice(i, 1); continue; }
      if (p.follow && !p.follow.dead) { p.x = p.follow.x + p.fx; p.y = p.follow.y + p.fy; }
      if (p.mode === 'ring' || p.mode === 'glow' || p.mode === 'slash' || p.mode === 'bolt') continue;
      p.vz -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.28; p.vx *= 0.6; p.vy *= 0.6; }
      var d = 1 - p.drag * dt;
      if (d < 0) d = 0;
      p.vx *= d; p.vy *= d;
      p.rot += p.spin * dt;
    }
    var t = ents.texts;
    for (var j = t.length - 1; j >= 0; j--) {
      var x = t[j];
      x.life -= dt;
      if (x.life <= 0) { t.splice(j, 1); continue; }
      x.z += -x.vy * dt * 0.55;
      x.x += x.vx * dt;
      x.vy *= 1 - 1.6 * dt;
    }
    var a = ents.after;
    for (var k = a.length - 1; k >= 0; k--) {
      a[k].life -= dt;
      if (a[k].life <= 0) a.splice(k, 1);
    }
  }

  SH.updateEntities = function (dt) {
    updateProjectiles(dt);
    updateHazards(dt);
    updateStructures(dt);
    updatePickups(dt);
    updateParticles(dt);
  };

  /* ======================================================================
   * COMBAT
   * ==================================================================== */
  var C = (SH.combat = {});

  var ELEM_COLOR = {
    fire: '#ff7a2e', ice: '#7fe6ff', lightning: '#c9f24a', shadow: '#a06cff',
    amber: '#ffb43a', gold: '#ffd76a', energy: '#5affa8', frost: '#8fd8ff', storm: '#4d7cff'
  };
  C.elemColor = function (e) { return ELEM_COLOR[e] || '#ffffff'; };

  C.status = function (e, key, dur, data) {
    if (!e || e.dead) return;
    if (e.boss) {
      // bosses resist hard crowd control
      if (key === 'freeze') { key = 'chill'; dur *= 0.5; data = { slow: 0.3 }; }
      dur *= 0.5;
    }
    var cur = e.status[key];
    if (!cur || cur.t < dur) {
      e.status[key] = Object.assign({ t: dur }, data || {});
    } else if (data) {
      Object.assign(cur, data, { t: cur.t });
    }
  };

  /* Damage an enemy. opt: {dir, fromX, fromY, knock, elem, crit, owner, silent, dot} */
  C.hitEnemy = function (e, dmg, opt) {
    opt = opt || {};
    if (!e || e.dead || e.spawning > 0 || dmg <= 0) return 0;
    var blocked = false;

    // Bulwark's directional shield
    if (e.shield && opt.fromX !== undefined) {
      var toSrc = U.angTo(e.x, e.y, opt.fromX, opt.fromY);
      if (Math.abs(U.angDiff(e.facing, toSrc)) < 1.15) {
        dmg *= 0.12;
        blocked = true;
        FX.burst(e.x + Math.cos(e.facing) * e.r, e.y + Math.sin(e.facing) * e.r, e.h * 0.5,
          { n: 5, color: '#9fd8ff', speed: 150, size: 3, life: 0.28, dir: toSrc, spread: 1.4 });
      }
    }

    if (e.status.freeze && e.status.freeze.t > 0) dmg *= 1.4;
    if (e.status.mark && e.status.mark.t > 0) dmg *= 1.25;
    dmg *= e.dmgTakenMult || 1;

    var crit = opt.crit || (!opt.dot && Math.random() < 0.08);
    if (crit) dmg *= 1.7;

    e.hp -= dmg;
    e.hitFlash = Math.max(e.hitFlash, blocked ? 0.06 : 0.13);
    e.aggro = 6;

    if (opt.knock && !e.boss) {
      var kd = opt.dir === undefined ? U.angTo(opt.fromX || e.x, opt.fromY || e.y, e.x, e.y) : opt.dir;
      var kmul = e.knockResist === undefined ? 1 : e.knockResist;
      e.kvx += Math.cos(kd) * opt.knock * kmul;
      e.kvy += Math.sin(kd) * opt.knock * kmul;
      if (opt.knock > 260) e.stagger = Math.max(e.stagger, 0.35);
    }

    if (opt.elem) {
      switch (opt.elem) {
        case 'fire': C.status(e, 'burn', 3, { dps: dmg * 0.16 }); break;
        case 'ice': C.status(e, 'chill', 2.4, { slow: 0.45 }); break;
        case 'frost': C.status(e, 'freeze', 1.9); break;
        case 'lightning': C.status(e, 'shock', 2, {}); break;
        case 'shadow': C.status(e, 'mark', 3, {}); break;
        case 'amber': C.status(e, 'chill', 1.6, { slow: 0.3 }); break;
      }
    }

    if (!opt.silent) {
      var col = opt.elem ? C.elemColor(opt.elem) : (crit ? '#ffd76a' : '#ffffff');
      if (blocked) FX.text(e.x, e.y, e.h, 'BLOCK', '#9fd8ff', 12);
      else FX.text(e.x, e.y, e.h, (crit ? '' : '') + Math.round(dmg), col, crit ? 21 : 15);
      FX.burst(e.x, e.y, e.h * 0.55, {
        n: crit ? 8 : 4, color: col, speed: crit ? 250 : 150, size: crit ? 4 : 3,
        life: 0.3, dir: opt.dir, spread: 2.2
      });
      SH.audio.play(crit ? 'crit' : 'hit');
    }

    // surge for the active hero
    var hero = SH.game.player();
    if (hero && !opt.noSurge) {
      SH.game.addSurge(dmg * (opt.dot ? 0.05 : 0.09) * (e.boss ? 1.6 : 1));
      if (hero.kitId === 'vitality' && !opt.dot) C.healHero(hero, dmg * 0.035, true);
    }
    SH.game.stats.damage += dmg;

    if (e.hp <= 0) C.killEnemy(e, opt);
    else if (e.type === 'stalker') SH.enemyReactToHit(e);
    return dmg;
  };

  C.killEnemy = function (e, opt) {
    if (e.dead) return;
    e.dead = true;
    var col = e.color || '#fff';
    FX.burst(e.x, e.y, e.h * 0.5, { n: e.boss ? 44 : 12, color: col, speed: e.boss ? 460 : 240, size: e.boss ? 7 : 4, life: 0.7, mode: 'shard' });
    FX.ring(e.x, e.y, 4, e.r * 0.5, e.r * (e.boss ? 7 : 3), col, e.boss ? 0.8 : 0.4, e.boss ? 8 : 3);
    FX.flash(e.x, e.y, e.h * 0.5, e.r * (e.boss ? 5 : 2), col, 0.25);
    SH.audio.play(e.boss ? 'boom' : 'kill');
    if (e.boss) { FX.shake(16); SH.game.onBossKilled(e); }
    else FX.shake(2);

    SH.game.stats.kills++;
    SH.game.stats.score += e.score || 10;
    SH.game.notifyKill(e);

    var orbs = e.boss ? 12 : (e.level >= 3 ? 2 : 1);
    for (var i = 0; i < orbs; i++) SH.spawnPickup(e.x, e.y, Math.random() < (e.boss ? 0.5 : 0.28) ? 'hp' : 'surge');
    if (e.onDeath) e.onDeath(e);
  };

  /* Cone melee. o: {angle, range, arc, dmg, knock, elem, maxTargets, onHit} */
  C.melee = function (owner, o) {
    var hits = 0;
    var cands = SH.grid.query(owner.x, owner.y, o.range + 60, qbuf);
    var result = [];
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e.dead || e.spawning > 0) continue;
      var d = U.dist(owner.x, owner.y, e.x, e.y);
      if (d > o.range + e.r) continue;
      if (Math.abs(owner.z - e.z) > 90 + e.h) continue;
      var a = U.angTo(owner.x, owner.y, e.x, e.y);
      if (Math.abs(U.angDiff(o.angle, a)) > o.arc / 2 + (e.r / Math.max(d, 24))) continue;
      result.push({ e: e, d: d });
    }
    result.sort(function (a, b) { return a.d - b.d; });
    var max = o.maxTargets || 99;
    for (var j = 0; j < result.length && hits < max; j++) {
      var en = result[j].e;
      C.hitEnemy(en, o.dmg, {
        dir: U.angTo(owner.x, owner.y, en.x, en.y), knock: o.knock, elem: o.elem,
        fromX: owner.x, fromY: owner.y, owner: owner, crit: o.crit
      });
      if (o.onHit) o.onHit(en);
      hits++;
    }
    return hits;
  };

  C.aoe = function (x, y, r, dmg, o) {
    o = o || {};
    var hits = 0;
    var cands = SH.grid.query(x, y, r + 60, qbuf);
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e.dead || e.spawning > 0) continue;
      if (!U.within(x, y, e.x, e.y, r + e.r)) continue;
      var falloff = o.falloff ? U.lerp(1, 0.55, U.clamp(U.dist(x, y, e.x, e.y) / r, 0, 1)) : 1;
      C.hitEnemy(e, dmg * falloff, {
        dir: U.angTo(x, y, e.x, e.y), knock: o.knock, elem: o.elem,
        fromX: x, fromY: y, owner: o.owner, silent: o.silent, dot: o.dot
      });
      if (o.onHit) o.onHit(e);
      hits++;
    }
    return hits;
  };

  /* Chain lightning between enemies */
  C.chain = function (x, y, dmg, opt) {
    opt = opt || {};
    var jumps = opt.jumps || 3, range = opt.range || 200;
    var color = opt.color || '#c9f24a';
    var used = [], cx = x, cy = y, cz = opt.z || 20;
    for (var i = 0; i < jumps; i++) {
      var best = null, bd = range * range;
      var cands = SH.grid.query(cx, cy, range, qbuf);
      for (var j = 0; j < cands.length; j++) {
        var e = cands[j];
        if (e.dead || e.spawning > 0 || used.indexOf(e) >= 0) continue;
        var d = U.dist2(cx, cy, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      FX.bolt(cx, cy - cz, best.x, best.y - best.h * 0.5, color, 0.16, 18);
      C.hitEnemy(best, dmg * Math.pow(0.82, i), {
        fromX: cx, fromY: cy, elem: opt.elem || 'lightning', owner: opt.owner, knock: opt.knock || 0,
        dir: U.angTo(cx, cy, best.x, best.y)
      });
      used.push(best);
      cx = best.x; cy = best.y; cz = best.h * 0.5;
    }
    if (used.length) SH.audio.play('zap');
    return used.length;
  };

  /* Damage the active hero. Returns 'absorbed' | 'blocked' | 'reflect' | true */
  C.hitPlayer = function (h, dmg, opt) {
    opt = opt || {};
    if (!h || h.ko || h.dead) return false;
    if (h.invuln > 0) {
      FX.text(h.x, h.y, h.z + 26, 'MISS', '#bbb', 12);
      return 'blocked';
    }

    // Savior: absorption field converts incoming damage into charge
    if (h.absorbing && h.absorbing > 0) {
      h.charge = Math.min(h.maxCharge, h.charge + dmg * 1.35);
      SH.game.addSurge(dmg * 0.55);
      FX.text(h.x, h.y, h.z + 32, '+' + Math.round(dmg * 1.35), '#5affa8', 15);
      FX.burst(h.x, h.y, h.z + 18, { n: 6, color: '#5affa8', speed: 170, size: 3.4, life: 0.35 });
      FX.ring(h.x, h.y, h.z + 16, 10, 40, '#5affa8', 0.3, 3);
      SH.audio.play('absorb');
      return 'absorbed';
    }

    // Form invulnerability (Savior's Radiant Ascension)
    if (h.formInvuln && h.form > 0) {
      h.charge = Math.min(h.maxCharge, h.charge + dmg);
      FX.text(h.x, h.y, h.z + 32, 'ABSORB', '#7dffb5', 13);
      FX.ring(h.x, h.y, h.z + 16, 10, 44, '#7dffb5', 0.28, 3);
      return 'absorbed';
    }

    if (h.shieldHp > 0) {
      var used = Math.min(h.shieldHp, dmg);
      h.shieldHp -= used;
      dmg -= used;
      FX.ring(h.x, h.y, h.z + 16, 18, 40, '#ffb43a', 0.25, 3);
      if (dmg <= 0) return 'blocked';
    }

    dmg *= h.dmgTakenMult || 1;
    h.hp -= dmg;
    h.hitFlash = 0.16;
    h.lastHitAt = SH.game.time;
    h.combo = 0;
    if (!opt.dot) {
      FX.text(h.x, h.y, h.z + 30, '-' + Math.round(dmg), '#ff5b6e', 16);
      FX.burst(h.x, h.y, h.z + 16, { n: 6, color: '#ff5b6e', speed: 170, size: 3.4, life: 0.32 });
      FX.shake(Math.min(9, 2 + dmg * 0.14));
      SH.audio.play('hurt');
      if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) {} }
    }
    SH.game.stats.taken += dmg;
    if (h.hp <= 0) { h.hp = 0; SH.game.knockOut(h); }
    return true;
  };

  C.healHero = function (h, amt, silent) {
    if (!h || h.ko) return;
    var before = h.hp;
    h.hp = Math.min(h.maxHp, h.hp + amt);
    var gained = h.hp - before;
    if (gained > 0.5 && !silent) {
      FX.text(h.x, h.y, h.z + 30, '+' + Math.round(gained), '#68ffb0', 15);
      FX.burst(h.x, h.y, h.z + 14, { n: 6, color: '#68ffb0', speed: 120, size: 3, life: 0.5, grav: -60 });
    }
  };
})();
