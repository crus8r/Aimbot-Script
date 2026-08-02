/* VANGUARD — enemies.js
 * Five enemy tiers, each with a distinct gimmick:
 *  1 HUSK      — swarms, pure melee pressure
 *  2 LANCER    — ranged, kites, fires absorbable bolts
 *  3 BULWARK   — frontal shield, must be flanked; shield-charges
 *  4 STALKER   — blinks behind you, dodges hits, leaves slowing pools
 *  5 COLOSSUS  — boss: telegraphed slams, shockwaves, summons, enrage
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var FX = SH.fx;
  var C = SH.combat;

  var TYPES = (SH.ENEMY_TYPES = {});

  TYPES.husk = {
    id: 'husk', level: 1, name: 'HUSK',
    hp: 48, speed: 104, r: 15, h: 30, score: 10,
    color: '#ff5b6e', body: '#2a1a22',
    desc: 'Weak alone. Never alone.'
  };
  TYPES.lancer = {
    id: 'lancer', level: 2, name: 'LANCER',
    hp: 66, speed: 84, r: 15, h: 33, score: 22,
    color: '#ff2fa0', body: '#2b1626',
    desc: 'Keeps its distance and throws bolts you can absorb.'
  };
  TYPES.bulwark = {
    id: 'bulwark', level: 3, name: 'BULWARK',
    hp: 190, speed: 64, r: 21, h: 42, score: 48,
    color: '#ff7b2f', body: '#2c1d16', knockResist: 0.3,
    desc: 'Shield eats damage from the front. Hit it from behind.'
  };
  TYPES.stalker = {
    id: 'stalker', level: 4, name: 'STALKER',
    hp: 135, speed: 158, r: 15, h: 35, score: 80,
    color: '#e02fff', body: '#1e1226', knockResist: 0.6,
    desc: 'Blinks behind you, dodges, leaves clinging shadow.'
  };
  TYPES.deathbringer = {
    id: 'deathbringer', level: 6, name: 'DEATHBRINGER',
    hp: 3400, speed: 74, r: 42, h: 112, score: 3000,
    color: '#ff7a12', body: '#06050a', boss: true, knockResist: 0,
    desc: 'A pitch-black ent slick with living mucus. Darkness and a death touch. Kills fast — dies faster than it should.'
  };
  TYPES.colossus = {
    id: 'colossus', level: 5, name: 'COLOSSUS',
    hp: 3200, speed: 68, r: 44, h: 92, score: 900,
    color: '#ff2b2b', body: '#2e1214', boss: true, knockResist: 0,
    desc: 'Telegraphed slams, expanding shockwaves, endless summons.'
  };

  var nbuf = [];

  SH.spawnEnemy = function (typeId, x, y, opts) {
    var t = TYPES[typeId];
    if (!t) return null;
    opts = opts || {};
    var mul = (opts.hpScale || 1) * (opts.rawStats ? 1 : SH.game.difficultyMul());
    var e = {
      dmgScale: opts.dmgScale || 1,
      type: typeId, def: t, level: t.level, name: t.name,
      x: x, y: y, z: 0, vx: 0, vy: 0, kvx: 0, kvy: 0,
      facing: U.rand(0, U.TAU),
      r: t.r, h: t.h,
      maxHp: t.hp * mul, hp: t.hp * mul,
      speed: t.speed, color: t.color, body: t.body,
      score: t.score, boss: !!t.boss,
      knockResist: t.knockResist === undefined ? 1 : t.knockResist,
      dmgTakenMult: 1,
      dead: false, hitFlash: 0, stagger: 0, aggro: 0,
      status: {}, state: 'idle', stateT: 0, atkCd: U.rand(0.4, 1.6),
      spawning: opts.instant ? 0 : 0.55, anim: U.rand(0, 10),
      tele: null, shield: typeId === 'bulwark', enraged: false,
      _blitzT: 0, _spireT: 0, home: { x: x, y: y },
      leash: opts.leash || 0
    };
    if (e.boss) {
      e.phase = 1;
      e.arena = SH.world.arenaAt(x, y);
      if (e.arena) e.arena.boss = e;
    }
    SH.ents.enemies.push(e);
    FX.ring(x, y, 2, 4, e.r * 2.4, e.color, 0.45, 3);
    FX.burst(x, y, 6, { n: e.boss ? 26 : 8, color: e.color, speed: e.boss ? 320 : 180, size: e.boss ? 6 : 3.5, life: 0.5 });
    if (e.boss) { SH.audio.play('boss'); FX.shake(10); }
    return e;
  };

  function moveToward(e, tx, ty, sp, dt, accel) {
    var a = U.angTo(e.x, e.y, tx, ty);
    e.vx = U.approach(e.vx, Math.cos(a) * sp, (accel || 1200) * dt);
    e.vy = U.approach(e.vy, Math.sin(a) * sp, (accel || 1200) * dt);
  }
  function moveAway(e, tx, ty, sp, dt) {
    var a = U.angTo(tx, ty, e.x, e.y);
    e.vx = U.approach(e.vx, Math.cos(a) * sp, 1000 * dt);
    e.vy = U.approach(e.vy, Math.sin(a) * sp, 1000 * dt);
  }
  function brake(e, dt, rate) {
    var k = 1 - (rate || 7) * dt;
    if (k < 0) k = 0;
    e.vx *= k; e.vy *= k;
  }

  function telegraph(e, kind, dur, r, color) {
    e.tele = { kind: kind, t: 0, max: dur, r: r, color: color || e.color };
  }

  /* ------------------------------------------------------------ per-type */
  function aiHusk(e, p, dt, dist) {
    if (e.state === 'wind') {
      e.stateT -= dt;
      brake(e, dt, 5);
      if (e.stateT <= 0) {
        e.state = 'idle';
        e.atkCd = U.rand(0.9, 1.5);
        var a = e.facing;
        FX.slash(e.x + Math.cos(a) * 16, e.y + Math.sin(a) * 16, e.h * 0.5, a, 1.6, 48, e.color, 0.18);
        if (p && !p.ko && U.within(e.x, e.y, p.x, p.y, 52 + p.radius) && p.z < 46) {
          C.hitPlayer(p, 13 * SH.game.difficultyMul(), { fromX: e.x, fromY: e.y });
        }
        SH.audio.play('swing');
      }
      return;
    }
    if (dist < 44 + p.radius && e.atkCd <= 0 && p.z < 50) {
      e.state = 'wind'; e.stateT = 0.34;
      telegraph(e, 'melee', 0.34, 52);
      brake(e, dt, 9);
      return;
    }
    moveToward(e, p.x, p.y, e.speed, dt);
  }

  function aiLancer(e, p, dt, dist) {
    if (e.state === 'wind') {
      e.stateT -= dt;
      brake(e, dt, 6);
      e.facing = U.angApproach(e.facing, U.angTo(e.x, e.y, p.x, p.y), dt * 4);
      if (e.stateT <= 0) {
        e.state = 'idle';
        e.atkCd = U.rand(1.8, 2.6);
        var a = U.angTo(e.x, e.y, p.x, p.y);
        // lead the shot vertically so airborne heroes are not untouchable
        var z0 = e.h * 0.6;
        var flight = Math.max(0.25, U.dist(e.x, e.y, p.x, p.y) / 330);
        var vz = ((p.z + 20) - z0) / flight;
        SH.spawnProjectile({
          x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20, z: z0, vz: vz,
          vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, r: 11,
          dmg: 15 * SH.game.difficultyMul(), team: 'enemy', life: 3.2,
          type: 'bolt', color: e.color, size: 12, rot: a, trailEvery: 0.05
        });
        SH.audio.play('shoot');
        FX.burst(e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, e.h * 0.6,
          { n: 4, color: e.color, speed: 130, size: 3, life: 0.3, dir: a, spread: 1 });
      }
      return;
    }
    if (dist < 190) { moveAway(e, p.x, p.y, e.speed * 1.15, dt); }
    else if (dist > 340) { moveToward(e, p.x, p.y, e.speed, dt); }
    else { brake(e, dt, 4); }
    if (e.atkCd <= 0 && dist < 480) {
      e.state = 'wind'; e.stateT = 0.55;
      telegraph(e, 'aim', 0.55, 0);
    }
  }

  function aiBulwark(e, p, dt, dist) {
    if (e.state === 'charge') {
      e.stateT -= dt;
      var ca = e.chargeDir;
      e.vx = Math.cos(ca) * 520;
      e.vy = Math.sin(ca) * 520;
      e.facing = ca;
      if (Math.random() < 0.6) {
        FX.particle({ x: e.x, y: e.y, z: 6, life: 0.3, size: 6, color: e.color, mode: 'smoke', alpha: 0.4, drag: 2 });
      }
      if (p && !p.ko && U.within(e.x, e.y, p.x, p.y, e.r + p.radius + 10) && p.z < 50) {
        C.hitPlayer(p, 26 * SH.game.difficultyMul(), { fromX: e.x, fromY: e.y });
        p.vx += Math.cos(ca) * 420; p.vy += Math.sin(ca) * 420;
        e.stateT = 0;
      }
      if (e.stateT <= 0) { e.state = 'idle'; e.atkCd = U.rand(2.6, 4); brake(e, dt, 20); }
      return;
    }
    if (e.state === 'wind') {
      e.stateT -= dt;
      brake(e, dt, 8);
      e.facing = U.angApproach(e.facing, U.angTo(e.x, e.y, p.x, p.y), dt * 3);
      if (e.stateT <= 0) {
        if (e.windKind === 'charge') {
          e.state = 'charge'; e.stateT = 0.75; e.chargeDir = e.facing;
          SH.audio.play('heavy');
        } else {
          e.state = 'idle'; e.atkCd = U.rand(1.4, 2.2);
          FX.slash(e.x + Math.cos(e.facing) * 20, e.y + Math.sin(e.facing) * 20, e.h * 0.5, e.facing, 1.5, 64, e.color, 0.2);
          if (p && !p.ko && U.within(e.x, e.y, p.x, p.y, 66 + p.radius) && p.z < 54) {
            C.hitPlayer(p, 22 * SH.game.difficultyMul(), { fromX: e.x, fromY: e.y });
          }
          SH.audio.play('heavy');
        }
      }
      return;
    }
    if (e.atkCd <= 0) {
      if (dist > 190 && dist < 620) {
        e.state = 'wind'; e.windKind = 'charge'; e.stateT = 0.7;
        telegraph(e, 'charge', 0.7, 0);
        return;
      }
      if (dist < 74 + p.radius) {
        e.state = 'wind'; e.windKind = 'bash'; e.stateT = 0.5;
        telegraph(e, 'melee', 0.5, 66);
        return;
      }
    }
    moveToward(e, p.x, p.y, e.speed, dt, 600);
  }

  function aiStalker(e, p, dt, dist) {
    if (e.state === 'combo') {
      e.stateT -= dt;
      brake(e, dt, 8);
      e.comboT -= dt;
      if (e.comboT <= 0 && e.comboN > 0) {
        e.comboN--;
        e.comboT = 0.22;
        var a = U.angTo(e.x, e.y, p.x, p.y);
        e.facing = a;
        FX.slash(e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, e.h * 0.5, a, 1.4, 52, e.color, 0.14);
        if (p && !p.ko && U.within(e.x, e.y, p.x, p.y, 56 + p.radius) && p.z < 50) {
          C.hitPlayer(p, 11 * SH.game.difficultyMul(), { fromX: e.x, fromY: e.y });
        }
        SH.audio.play('swing');
      }
      if (e.stateT <= 0) { e.state = 'idle'; e.atkCd = U.rand(1.6, 2.6); }
      return;
    }
    if (e.blinkCd === undefined) e.blinkCd = U.rand(1, 2.4);
    e.blinkCd -= dt;
    if (e.blinkCd <= 0 && dist > 90 && dist < 700) {
      blinkStalker(e, p);
      e.blinkCd = U.rand(2.6, 4.2);
      e.state = 'combo'; e.stateT = 0.95; e.comboN = 3; e.comboT = 0.16;
      return;
    }
    if (dist < 60) { moveAway(e, p.x, p.y, e.speed * 0.7, dt); }
    else { moveToward(e, p.x, p.y, e.speed, dt); }
  }

  function blinkStalker(e, p) {
    var a = U.angTo(p.x, p.y, e.x, e.y) + U.rand(2.2, 4.1);
    var d = U.rand(56, 78);
    var nx = p.x + Math.cos(a) * d, ny = p.y + Math.sin(a) * d;
    FX.burst(e.x, e.y, e.h * 0.5, { n: 12, color: e.color, speed: 200, size: 5, life: 0.4, mode: 'smoke' });
    SH.spawnHazard({
      x: e.x, y: e.y, r: 62, life: 3.4, team: 'enemy', kind: 'pool',
      color: e.color, dps: 6 * SH.game.difficultyMul(), tick: 0.4,
      onTick: function (hz) {
        var pl = SH.game.player();
        if (pl && !pl.ko && pl.z < 40 && U.within(hz.x, hz.y, pl.x, pl.y, hz.r)) {
          pl.status.slow = { t: 0.5, amt: 0.4 };
        }
      }
    });
    var probe = { x: nx, y: ny, z: 0 };
    SH.world.collide(probe, e.r + 2);
    e.x = probe.x; e.y = probe.y;
    e.facing = U.angTo(e.x, e.y, p.x, p.y);
    FX.burst(e.x, e.y, e.h * 0.5, { n: 12, color: e.color, speed: 220, size: 5, life: 0.4, mode: 'smoke' });
    SH.audio.play('blink');
  }

  function aiColossus(e, p, dt, dist) {
    if (!e.enraged && e.hp < e.maxHp * 0.5) {
      e.enraged = true;
      e.speed *= 1.45;
      e.dmgTakenMult = 0.85;
      FX.ring(e.x, e.y, 10, 10, 420, '#ff2b2b', 0.9, 8);
      FX.burst(e.x, e.y, e.h * 0.5, { n: 40, color: '#ff2b2b', speed: 460, size: 8, life: 0.9 });
      FX.shake(20);
      SH.audio.play('boss');
      SH.hud.banner('COLOSSUS ENRAGED', '#ff2b2b');
    }

    if (e.state === 'wind') {
      e.stateT -= dt;
      brake(e, dt, 5);
      if (e.windKind !== 'summon') e.facing = U.angApproach(e.facing, U.angTo(e.x, e.y, p.x, p.y), dt * 2.2);
      if (e.stateT <= 0) {
        e.state = 'idle';
        e.atkCd = e.enraged ? U.rand(1.3, 2.1) : U.rand(2.2, 3.2);
        resolveBossAttack(e, p);
      }
      return;
    }
    if (e.state === 'rush') {
      e.stateT -= dt;
      e.vx = Math.cos(e.chargeDir) * 620;
      e.vy = Math.sin(e.chargeDir) * 620;
      FX.particle({ x: e.x + U.rand(-20, 20), y: e.y + U.rand(-20, 20), z: 6, life: 0.35, size: 10, color: e.color, mode: 'smoke', alpha: 0.5, drag: 2 });
      if (p && !p.ko && U.within(e.x, e.y, p.x, p.y, e.r + p.radius + 14) && p.z < 70) {
        C.hitPlayer(p, 40 * SH.game.difficultyMul(), { fromX: e.x, fromY: e.y });
        p.vx += Math.cos(e.chargeDir) * 620; p.vy += Math.sin(e.chargeDir) * 620;
        e.stateT = 0;
      }
      if (e.stateT <= 0) { e.state = 'idle'; e.atkCd = U.rand(1.8, 2.6); FX.shake(6); }
      return;
    }

    if (e.atkCd <= 0) {
      var roll = Math.random();
      var adds = countAdds(e);
      if (adds < (e.enraged ? 8 : 5) && roll < 0.3) {
        e.state = 'wind'; e.windKind = 'summon'; e.stateT = 1;
        telegraph(e, 'summon', 1, 200);
      } else if (dist > 260 && e.enraged && roll < 0.62) {
        e.state = 'wind'; e.windKind = 'rush'; e.stateT = 0.8;
        telegraph(e, 'charge', 0.8, 0);
      } else if (dist < 220 && roll < 0.75) {
        e.state = 'wind'; e.windKind = 'slam'; e.stateT = 0.95;
        e.slamX = p.x; e.slamY = p.y;
        telegraph(e, 'slam', 0.95, 175);
      } else {
        e.state = 'wind'; e.windKind = 'wave'; e.stateT = 1.15;
        telegraph(e, 'wave', 1.15, 300);
      }
      return;
    }

    if (dist > 170) moveToward(e, p.x, p.y, e.speed, dt, 500);
    else brake(e, dt, 3);
    e.facing = U.angApproach(e.facing, U.angTo(e.x, e.y, p.x, p.y), dt * 1.8);
  }

  /* ------------------------------------------------- DEATHBRINGER (lv 6)
   * Pitch-black ent, orange eyes, dripping black mucus.
   * Darkness manipulation + death touch. Every attack is telegraphed, but
   * each one hurts badly — a challenge boss, not a health sponge.
   */
  function dbDmg(e, base) { return base * (e.dmgScale || 1) * (e.enraged ? 1.25 : 1); }

  function aiDeathbringer(e, p, dt, dist) {
    if (!e.enraged && e.hp < e.maxHp * 0.5) {
      e.enraged = true;
      e.speed *= 1.3;
      FX.ring(e.x, e.y, 10, 10, 520, '#ff7a12', 1, 9);
      FX.burst(e.x, e.y, e.h * 0.5, { n: 46, color: '#ff7a12', speed: 460, size: 8, life: 1 });
      FX.shake(20);
      SH.audio.play('boss');
      SH.hud.banner('THE GROVE WAKES', '#ff7a12');
      SH.setDarkness(0.5, 6);
    }

    if (e.state === 'lunge') {
      e.stateT -= dt;
      e.vx = Math.cos(e.chargeDir) * 720;
      e.vy = Math.sin(e.chargeDir) * 720;
      if (Math.random() < 0.8) {
        FX.particle({
          x: e.x + U.rand(-16, 16), y: e.y + U.rand(-10, 10), z: U.rand(4, e.h * 0.7),
          life: 0.4, size: U.rand(5, 11), color: '#0b0910', mode: 'smoke', alpha: 0.7, drag: 2
        });
      }
      if (!e.touched && p && !p.ko && U.within(e.x, e.y, p.x, p.y, e.r + p.radius + 34) && p.z < 96) {
        e.touched = true;
        C.hitPlayer(p, dbDmg(e, 44), { fromX: e.x, fromY: e.y });
        C.status(p, 'wither', 6, { dps: dbDmg(e, 9) });
        FX.text(p.x, p.y, p.z + 46, 'DEATH TOUCH', '#ff7a12', 17);
        FX.burst(p.x, p.y, p.z + 20, { n: 20, color: '#1a0f22', speed: 260, size: 6, life: 0.7 });
        FX.ring(p.x, p.y, p.z + 10, 8, 90, '#ff7a12', 0.5, 4);
        FX.shake(12);
        SH.audio.play('ko');
      }
      if (e.stateT <= 0) { e.state = 'idle'; e.atkCd = (e.enraged ? U.rand(1.1, 1.8) : U.rand(1.7, 2.6)) * (e.cdScale || 1); }
      return;
    }

    if (e.state === 'wind') {
      e.stateT -= dt;
      brake(e, dt, 6);
      e.facing = U.angApproach(e.facing, U.angTo(e.x, e.y, p.x, p.y), dt * 2.6);
      if (e.stateT <= 0) {
        e.state = 'idle';
        e.atkCd = (e.enraged ? U.rand(1.0, 1.7) : U.rand(1.6, 2.4)) * (e.cdScale || 1);
        resolveDeathbringer(e, p);
      }
      return;
    }

    if (e.atkCd <= 0) {
      var roll = Math.random();
      if (dist < 210 && roll < 0.42) {
        e.state = 'wind'; e.windKind = 'touch'; e.stateT = 0.62;
        telegraph(e, 'charge', 0.62, 0, '#ff7a12');
      } else if (dist < 330 && roll < 0.6) {
        e.state = 'wind'; e.windKind = 'grasp'; e.stateT = 0.85;
        telegraph(e, 'wave', 0.85, 300, '#ff7a12');
      } else if (roll < 0.8) {
        e.state = 'wind'; e.windKind = 'roots'; e.stateT = 0.5;
        telegraph(e, 'summon', 0.5, 130, '#ff7a12');
      } else if (SH.darkness.t <= 0 && roll < 0.9) {
        e.state = 'wind'; e.windKind = 'veil'; e.stateT = 0.8;
        telegraph(e, 'summon', 0.8, 200, '#2a1030');
      } else {
        e.state = 'wind'; e.windKind = 'spit'; e.stateT = 0.55;
        telegraph(e, 'aim', 0.55, 0, '#6b8f2a');
      }
      return;
    }

    if (dist > 150) moveToward(e, p.x, p.y, e.speed, dt, 420);
    else brake(e, dt, 4);
    e.facing = U.angApproach(e.facing, U.angTo(e.x, e.y, p.x, p.y), dt * 2);

    // constant mucus drip
    if (Math.random() < 0.5) {
      FX.particle({
        x: e.x + U.rand(-e.r * 0.8, e.r * 0.8), y: e.y + U.rand(-6, 10), z: U.rand(e.h * 0.3, e.h),
        vz: -30, grav: 260, life: U.rand(0.5, 1), size: U.rand(2.5, 5),
        color: '#0d0b14', mode: 'smoke', alpha: 0.85, drag: 0.4
      });
    }
  }

  function resolveDeathbringer(e, p) {
    var d = SH.plane === 'side' ? 1 : 1;
    switch (e.windKind) {
      case 'touch': {
        e.state = 'lunge'; e.stateT = 0.42; e.touched = false;
        e.chargeDir = U.angTo(e.x, e.y, p.x, p.y);
        FX.ring(e.x, e.y, e.h * 0.4, 10, 120, '#ff7a12', 0.4, 4);
        SH.audio.play('heavy');
        break;
      }
      case 'grasp': {
        // tendrils erupt in a ring and root whatever they catch
        SH.audio.play('boom');
        FX.shake(11);
        FX.ring(e.x, e.y, 6, 20, 300, '#2a1030', 0.5, 8);
        for (var i = 0; i < 26; i++) {
          var a = (i / 26) * U.TAU;
          var rr = U.rand(80, 290);
          FX.particle({
            x: e.x + Math.cos(a) * rr, y: e.y + Math.sin(a) * rr, z: 0,
            vz: U.rand(160, 300), life: U.rand(0.4, 0.75), size: U.rand(4, 9),
            color: '#0b0910', mode: 'smoke', alpha: 0.9, drag: 1.4
          });
        }
        if (p && !p.ko && U.within(e.x, e.y, p.x, p.y, 300 + p.radius) && p.z < 110) {
          C.hitPlayer(p, dbDmg(e, 30), { fromX: e.x, fromY: e.y });
          C.status(p, 'root', 0.9, {});
          FX.text(p.x, p.y, p.z + 44, 'ROOTED', '#ff7a12', 15);
        }
        break;
      }
      case 'roots': {
        // delayed black spears erupting from the ground, tracking where you stand
        SH.audio.play('freeze');
        var n = e.enraged ? 5 : 3;
        for (var k = 0; k < n; k++) {
          var tx = p.x + U.rand(-70, 70) + (k - n / 2) * 96;
          var ty = SH.plane === 'side' ? p.y : p.y + U.rand(-70, 70);
          (function (tx, ty, delay) {
            SH.spawnHazard({
              x: tx, y: ty, r: 74, life: 0.35, delay: delay, team: 'enemy', kind: 'root',
              color: '#ff7a12', dmg: dbDmg(e, 34), owner: e,
              data: { delayMax: delay },
              onResolve: function (hz) {
                FX.burst(hz.x, hz.y, 0, { n: 14, color: '#0b0910', speed: 200, size: 7, life: 0.6, vz: 320, grav: 420 });
                FX.ring(hz.x, hz.y, 2, 8, 74, '#ff7a12', 0.35, 4);
                SH.audio.play('heavy');
              }
            });
          })(tx, ty, 0.75 + k * 0.16);
        }
        break;
      }
      case 'veil': {
        SH.setDarkness(0.72, e.enraged ? 8 : 6);
        SH.hud.banner('DARKNESS', '#b07cff');
        SH.audio.play('form');
        FX.ring(e.x, e.y, e.h * 0.4, 10, 460, '#2a1030', 0.9, 10);
        var orbs = e.enraged ? 4 : 3;
        for (var o = 0; o < orbs; o++) {
          var oa = U.angTo(e.x, e.y, p.x, p.y) + U.rand(-0.8, 0.8);
          SH.spawnProjectile({
            x: e.x + Math.cos(oa) * 30, y: e.y + Math.sin(oa) * 30, z: e.h * 0.55,
            vx: Math.cos(oa) * 210, vy: SH.plane === 'side' ? 0 : Math.sin(oa) * 210,
            r: 15, dmg: dbDmg(e, 22), team: 'enemy', life: 5.5, type: 'shadeorb',
            color: '#b07cff', size: 15, homing: 1.5, target: p, trailEvery: 0.04
          });
        }
        break;
      }
      default: { // spit
        SH.audio.play('shoot');
        var sa = U.angTo(e.x, e.y, p.x, p.y);
        var self = e;
        SH.spawnProjectile({
          x: e.x + Math.cos(sa) * 34, y: e.y + Math.sin(sa) * 34, z: e.h * 0.6,
          vx: Math.cos(sa) * 380, vy: SH.plane === 'side' ? 0 : Math.sin(sa) * 380,
          vz: 210, grav: 620, r: 16, dmg: dbDmg(e, 26), team: 'enemy', life: 4,
          type: 'mucus', color: '#0d0b14', size: 16, spin: 4,
          onExpire: function (pr) {
            FX.burst(pr.x, pr.y, 4, { n: 14, color: '#0d0b14', speed: 190, size: 7, life: 0.6 });
            SH.spawnHazard({
              x: pr.x, y: pr.y, r: 92, life: 7, team: 'enemy', kind: 'mucus',
              color: '#141021', dps: dbDmg(self, 10), tick: 0.4,
              onTick: function (hz) {
                var pl = SH.game.player();
                if (pl && !pl.ko && pl.z < 40 && U.within(hz.x, hz.y, pl.x, pl.y, hz.r)) {
                  pl.status.slow = { t: 0.5, amt: 0.5 };
                }
              }
            });
          }
        });
      }
    }
  }

  function countAdds(boss) {
    var n = 0, list = SH.ents.enemies;
    for (var i = 0; i < list.length; i++) if (!list[i].dead && list[i].summonedBy === boss) n++;
    return n;
  }

  function resolveBossAttack(e, p) {
    var mul = SH.game.difficultyMul();
    if (e.windKind === 'slam') {
      var sx = e.slamX, sy = e.slamY;
      FX.ring(sx, sy, 4, 20, 190, '#ff2b2b', 0.5, 8);
      FX.flash(sx, sy, 10, 150, '#ff8a8a', 0.35);
      FX.burst(sx, sy, 8, { n: 26, color: '#ff5b6e', speed: 420, size: 7, life: 0.7 });
      FX.shake(15);
      SH.audio.play('boom');
      if (p && !p.ko && U.within(sx, sy, p.x, p.y, 175 + p.radius) && p.z < 90) {
        C.hitPlayer(p, 56 * mul, { fromX: sx, fromY: sy });
        var a = U.angTo(sx, sy, p.x, p.y);
        p.vx += Math.cos(a) * 400; p.vy += Math.sin(a) * 400;
      }
      // debris
      for (var i = 0; i < 5; i++) {
        var ang = Math.random() * U.TAU;
        SH.spawnProjectile({
          x: sx, y: sy, z: 20, vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260, vz: 260, grav: 620,
          r: 14, dmg: 18 * mul, team: 'enemy', life: 2.4, type: 'rock', color: '#8a5a4a', size: 14, spin: 5
        });
      }
    } else if (e.windKind === 'wave') {
      SH.audio.play('boom');
      FX.shake(12);
      var self = e;
      var wave = { r: 30, max: 460 };
      SH.spawnHazard({
        x: e.x, y: e.y, r: 40, life: 1.1, team: 'enemy', kind: 'wave', color: '#ff2b2b',
        tick: 0.05, data: wave,
        onTick: function (hz) {
          wave.r += 44;
          hz.r = wave.r;
          var pl = SH.game.player();
          if (pl && !pl.ko && !hz.data.hitPlayer && pl.z < 80) {
            var d = U.dist(hz.x, hz.y, pl.x, pl.y);
            if (Math.abs(d - wave.r) < 46 + pl.radius) {
              hz.data.hitPlayer = true;
              C.hitPlayer(pl, 42 * mul, { fromX: hz.x, fromY: hz.y });
              var aa = U.angTo(hz.x, hz.y, pl.x, pl.y);
              pl.vx += Math.cos(aa) * 520; pl.vy += Math.sin(aa) * 520;
            }
          }
          FX.ring(hz.x, hz.y, 4, wave.r - 20, wave.r, '#ff2b2b', 0.22, 6);
        }
      });
    } else if (e.windKind === 'summon') {
      SH.audio.play('boss');
      var n = e.enraged ? 5 : 3;
      for (var j = 0; j < n; j++) {
        var a2 = (j / n) * U.TAU + Math.random();
        var d2 = U.rand(110, 190);
        var pos = SH.world.findSpawn(e.x + Math.cos(a2) * d2, e.y + Math.sin(a2) * d2, 0, 90, 20);
        if (!pos) continue;
        var add = SH.spawnEnemy(e.enraged && Math.random() < 0.35 ? 'lancer' : 'husk', pos.x, pos.y);
        if (add) add.summonedBy = e;
      }
      FX.ring(e.x, e.y, 8, 20, 220, e.color, 0.6, 6);
    } else if (e.windKind === 'rush') {
      e.state = 'rush'; e.stateT = 0.9; e.chargeDir = U.angTo(e.x, e.y, p.x, p.y);
      SH.audio.play('heavy');
    }
  }

  /* ------------------------------------------------------------- update */
  function updateStatuses(e, dt) {
    var s = e.status;
    var slow = 1;
    if (s.burn && s.burn.t > 0) {
      s.burn.t -= dt;
      s.burn.acc = (s.burn.acc || 0) + dt;
      if (s.burn.acc > 0.3) {
        s.burn.acc = 0;
        C.hitEnemy(e, s.burn.dps * 0.3, { dot: true, silent: Math.random() > 0.35, elem: null });
      }
      if (Math.random() < 0.4) {
        FX.particle({
          x: e.x + U.rand(-e.r, e.r), y: e.y + U.rand(-e.r, e.r), z: U.rand(4, e.h),
          vz: U.rand(30, 70), life: 0.4, size: U.rand(3, 6), color: '#ff7a2e', color2: '#ffd76a',
          mode: 'flame', glow: true, drag: 1.5
        });
      }
    }
    if (s.chill && s.chill.t > 0) { s.chill.t -= dt; slow *= 1 - (s.chill.slow || 0.4); }
    if (s.freeze && s.freeze.t > 0) {
      s.freeze.t -= dt;
      slow = 0;
      if (Math.random() < 0.16) {
        FX.particle({ x: e.x + U.rand(-e.r, e.r), y: e.y + U.rand(-e.r, e.r), z: U.rand(2, e.h), life: 0.5, size: 3, color: '#8fd8ff', glow: true, mode: 'shard', drag: 1 });
      }
    }
    if (s.shock && s.shock.t > 0) {
      s.shock.t -= dt;
      if (Math.random() < 0.1) {
        FX.bolt(e.x + U.rand(-14, 14), e.y - e.h, e.x + U.rand(-14, 14), e.y, '#c9f24a', 0.08, 6);
      }
    }
    if (s.mark && s.mark.t > 0) s.mark.t -= dt;
    return slow;
  }

  SH.updateEnemies = function (dt) {
    var list = SH.ents.enemies;
    var p = SH.game.player();
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.isHero) continue;   // versus opponents drive themselves
      if (e.dead) { list.splice(i, 1); continue; }

      e.anim += dt;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.stagger > 0) e.stagger -= dt;
      if (e._blitzT > 0) e._blitzT -= dt;
      if (e._spireT > 0) e._spireT -= dt;
      if (e.atkCd > 0) e.atkCd -= dt;
      if (e.aggro > 0) e.aggro -= dt;
      if (e.dodgeCd > 0) e.dodgeCd -= dt;

      if (e.spawning > 0) {
        e.spawning -= dt;
        e.z = -e.h * U.clamp(e.spawning / 0.55, 0, 1) * 0.9;
        continue;
      }
      e.z = 0;

      if (e.tele) {
        e.tele.t += dt;
        if (e.tele.t >= e.tele.max) e.tele = null;
      }

      var slow = updateStatuses(e, dt);
      var frozen = e.status.freeze && e.status.freeze.t > 0;
      var staggered = e.stagger > 0;

      var dist = p ? U.dist(e.x, e.y, p.x, p.y) : 9999;

      if (!frozen && !staggered && !e.ko && p && !p.ko) {
        switch (e.type) {
          case 'husk': aiHusk(e, p, dt, dist); break;
          case 'lancer': aiLancer(e, p, dt, dist); break;
          case 'bulwark': aiBulwark(e, p, dt, dist); break;
          case 'stalker': aiStalker(e, p, dt, dist); break;
          case 'colossus': aiColossus(e, p, dt, dist); break;
          case 'deathbringer': aiDeathbringer(e, p, dt, dist); break;
        }
      } else {
        brake(e, dt, 6);
      }

      // boss leash — stay in the arena
      if (e.boss && e.arena) {
        var ad = U.dist(e.x, e.y, e.arena.x, e.arena.y);
        if (ad > e.arena.r + 120) {
          moveToward(e, e.arena.x, e.arena.y, e.speed * 1.2, dt);
          if (ad > e.arena.r + 900) {
            e.x = e.arena.x; e.y = e.arena.y;
            e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.25);
          }
        }
      }

      // apply velocity + knockback
      var vmul = slow;
      e.x += (e.vx * vmul + e.kvx) * dt;
      e.y += (e.vy * vmul + e.kvy) * dt;
      var kd = 1 - 7 * dt;
      if (kd < 0) kd = 0;
      e.kvx *= kd; e.kvy *= kd;

      // separation
      var nb = SH.grid.query(e.x, e.y, e.r * 2.4, nbuf);
      for (var j = 0; j < nb.length; j++) {
        var o = nb[j];
        if (o === e || o.dead) continue;
        var dx = o.x - e.x, dy = o.y - e.y;
        var d2 = dx * dx + dy * dy;
        var rr = e.r + o.r;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        var d = Math.sqrt(d2);
        var push = (rr - d) * 0.5;
        var w = e.boss ? 0.15 : (o.boss ? 1.4 : 1);
        e.x -= (dx / d) * push * w;
        e.y -= (dy / d) * push * w;
      }

      // structures block enemies
      var st = SH.ents.structures;
      for (var k = 0; k < st.length; k++) {
        var s = st[k];
        var sdx = e.x - s.x, sdy = e.y - s.y;
        var sd2 = sdx * sdx + sdy * sdy;
        var srr = s.r + e.r;
        if (sd2 < srr * srr && sd2 > 1e-6) {
          var sd = Math.sqrt(sd2);
          e.x = s.x + (sdx / sd) * srr;
          e.y = s.y + (sdy / sd) * srr;
        }
      }

      SH.world.collide(e, e.r);

      if (Math.hypot(e.vx, e.vy) > 20 && e.state !== 'charge' && e.state !== 'rush') {
        e.facing = U.angApproach(e.facing, Math.atan2(e.vy, e.vx), dt * 7);
      }

      // contact damage for chargers already handled; husks do touch chip damage
      if (p && !p.ko && e.type !== 'lancer' && !frozen) {
        if (U.within(e.x, e.y, p.x, p.y, e.r + p.radius - 4) && p.z < 40) {
          e.touchT = (e.touchT || 0) - dt;
          if (e.touchT <= 0) {
            e.touchT = 0.8;
            C.hitPlayer(p, (e.boss ? 16 : 5) * SH.game.difficultyMul(), { fromX: e.x, fromY: e.y });
          }
        }
      }
    }
  };

  /* Dodge reaction — called from combat when a stalker is struck */
  SH.enemyReactToHit = function (e) {
    if (e.type !== 'stalker' || e.dead) return;
    if (e.dodgeCd > 0 || e.spawning > 0) return;
    if (Math.random() > 0.3) return;
    var p = SH.game.player();
    if (!p) return;
    e.dodgeCd = 2.2;
    var a = U.angTo(p.x, p.y, e.x, e.y) + U.rand(-0.8, 0.8);
    var probe = { x: p.x + Math.cos(a) * 220, y: p.y + Math.sin(a) * 220, z: 0 };
    SH.world.collide(probe, e.r + 2);
    FX.burst(e.x, e.y, e.h * 0.5, { n: 10, color: e.color, speed: 200, size: 4, life: 0.35, mode: 'smoke' });
    e.x = probe.x; e.y = probe.y;
    FX.text(e.x, e.y, e.h, 'DODGE', e.color, 12);
  };
})();
