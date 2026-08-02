/* VANGUARD — game.js
 * Boot, main loop, squad management, spawn director, boss arenas.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var FX = SH.fx;
  var C = SH.combat;

  var G = (SH.game = {
    state: 'menu',           // menu | play | pause | downed
    time: 0,
    squad: [],
    activeIndex: 0,
    switchCd: 0,
    trackedBoss: null,
    fps: 60,
    stats: { kills: 0, score: 0, damage: 0, taken: 0, bosses: 0, best: 0 },
    opts: { shake: true, showFps: false, maxEnemies: 56 }
  });

  var spawnT = 0;
  var last = 0;
  var fpsAcc = 0, fpsN = 0, lowT = 0;

  G.player = function () { return G.squad[G.activeIndex]; };
  G.difficultyMul = function () {
    return 1 + Math.min(0.9, G.time / 540) + G.stats.bosses * 0.08;
  };

  /* --------------------------------------------------------------- boot */
  G.init = function () {
    SH.grid = new SH.Grid(96);
    SH.world.generate();
    SH.render.init(document.getElementById('game'));
    SH.input.init();
    SH.hud.init();

    G.squad = SH.KITS.map(function (kit) { return new SH.Hero(kit); });
    placeSquad();
    G.activeIndex = 0;
    SH.hud.refreshButtons();
    SH.hud.showMenu(false);
    SH.render.follow(G.player(), 0, true);

    last = performance.now();
    requestAnimationFrame(frame);
  };

  function placeSquad() {
    var W = SH.world;
    var p = W.findSpawn(W.cx, W.cy, 0, 200, 30) || { x: W.cx, y: W.cy };
    G.squad.forEach(function (h) {
      h.x = p.x; h.y = p.y;
      h.reset();
    });
  }

  G.start = function () {
    if (G.state === 'menu') {
      if (document.getElementById('menu').classList.contains('inpause')) {
        // opened from the pause screen — go back to pause
        SH.hud.hideMenu();
        SH.hud.showPause(true);
        G.state = 'pause';
        return;
      }
      G.state = 'play';
      SH.hud.hideMenu();
      SH.audio.resume();
      SH.hud.banner('DEPLOYED', G.player().kit.colors.accent);
      SH.hud.toast('Tap a portrait to swap · FORCE fills your Surge instantly');
    }
  };

  G.restart = function () {
    SH.ents.clearAll();
    SH.world.arenas.forEach(function (a) { a.boss = null; a.respawn = 0; a.cleared = false; });
    G.stats.best = Math.max(G.stats.best, G.stats.score);
    G.stats = { kills: 0, score: 0, damage: 0, taken: 0, bosses: 0, best: G.stats.best };
    G.time = 0;
    G.trackedBoss = null;
    placeSquad();
    G.activeIndex = 0;
    G.state = 'play';
    SH.hud.showPause(false);
    SH.hud.hideMenu();
    SH.hud.showDowned(false, G);
    SH.hud.refreshButtons();
    SH.render.follow(G.player(), 0, true);
    SH.hud.banner('REDEPLOYED', '#5affa8');
  };

  G.togglePause = function () {
    if (G.state === 'play') {
      G.state = 'pause';
      SH.hud.showPause(true);
      SH.input.clearAll();
    } else if (G.state === 'pause') {
      G.state = 'play';
      SH.hud.showPause(false);
      SH.hud.hideMenu();
    }
  };

  /* ------------------------------------------------------------- squad */
  G.requestSwitch = function (i) {
    if (i === G.activeIndex && G.state !== 'downed') return;
    if (G.state === 'downed') { G.tagIn(i); return; }
    if (G.state !== 'play') return;
    var next = G.squad[i];
    if (!next || next.ko) { SH.hud.toast(next ? next.kit.name + ' IS DOWN' : '', '#ff5b6e'); return; }
    if (G.switchCd > 0) return;
    doSwap(i, 0.4);
  };

  G.cycleHero = function (dir) {
    for (var k = 1; k <= 5; k++) {
      var i = (G.activeIndex + dir * k + 5) % 5;
      if (!G.squad[i].ko) { G.requestSwitch(i); return; }
    }
  };

  G.tagIn = function (i) {
    var next = G.squad[i];
    if (!next || next.ko) return;
    doSwap(i, 1.6);
    G.state = 'play';
    SH.hud.showDowned(false, G);
  };

  function doSwap(i, invuln) {
    var cur = G.player();
    var next = G.squad[i];
    next.x = cur.x; next.y = cur.y;
    next.z = cur.grounded ? cur.z : Math.max(cur.z, 0);
    next.vx = cur.vx * 0.4; next.vy = cur.vy * 0.4; next.vz = 0;
    next.facing = cur.facing;
    next.invuln = Math.max(next.invuln, invuln);
    next.grounded = cur.grounded;
    if (next.flying) next.z = cur.z;
    next.attackT = 0; next.dashT = 0;
    G.activeIndex = i;
    G.switchCd = 0.45;

    var col = next.kit.colors.accent;
    FX.ring(next.x, next.y, next.z + 12, 6, 90, col, 0.45, 5);
    FX.burst(next.x, next.y, next.z + 16, { n: 16, color: col, speed: 300, size: 5, life: 0.5 });
    FX.flash(next.x, next.y, next.z + 16, 90, col, 0.25);
    C.aoe(next.x, next.y, 110, 18, { knock: 300, owner: next, silent: true });
    SH.audio.play('swap');
    SH.hud.refreshButtons();
    SH.hud.banner(next.kit.name, col);
    SH.input.clearAll();
  }

  G.addSurge = function (amt, force) {
    var h = G.player();
    if (!h || h.ko) return;
    if (h.form > 0 && !force) return;
    h.surge = U.clamp(h.surge + amt, 0, h.maxSurge);
    if (h.surge >= h.maxSurge && !h.surgeAnnounced) {
      h.surgeAnnounced = true;
      SH.hud.banner('SURGE READY', h.kit.colors.glow);
      SH.audio.play('revive');
    }
    if (h.surge < h.maxSurge) h.surgeAnnounced = false;
  };

  G.healBench = function (amt) {
    G.squad.forEach(function (h, i) {
      if (i === G.activeIndex || h.ko) return;
      h.hp = Math.min(h.maxHp, h.hp + amt);
    });
  };

  G.knockOut = function (h) {
    if (h.ko) return;
    h.ko = true;
    h.koT = 0;
    h.form = 0;
    h.absorbing = 0;
    h.flying = false;
    if (h.kit.onFormEnd) h.kit.onFormEnd(h);
    FX.burst(h.x, h.y, h.z + 16, { n: 24, color: '#ff5b6e', speed: 320, size: 6, life: 0.8 });
    FX.ring(h.x, h.y, h.z + 8, 6, 130, '#ff5b6e', 0.6, 5);
    FX.shake(14);
    SH.audio.play('ko');
    if (h === G.player()) {
      G.state = 'downed';
      SH.input.clearAll();
      SH.hud.showDowned(true, G);
    }
  };

  G.reviveSquad = function () {
    var p = G.player();
    G.squad.forEach(function (h) {
      h.ko = false;
      h.koT = 0;
      h.hp = Math.max(h.hp, h.maxHp * 0.55);
      h.invuln = 2.2;
      h.x = p.x; h.y = p.y;
    });
    C.aoe(p.x, p.y, 320, 90, { knock: 900, owner: p, falloff: true });
    FX.ring(p.x, p.y, 10, 10, 340, '#68ffb0', 0.8, 8);
    FX.flash(p.x, p.y, 20, 220, '#68ffb0', 0.4);
    FX.shake(12);
    SH.audio.play('revive');
    G.state = 'play';
    SH.hud.showDowned(false, G);
    SH.hud.banner('SQUAD REVIVED', '#68ffb0');
  };

  G.notifyKill = function (e) {
    var h = G.player();
    if (!h) return;
    h.killStreak = (h.killStreak || 0) + 1;
  };

  G.onBossKilled = function (e) {
    G.stats.bosses++;
    G.stats.score += 800;
    var ar = e.arena;
    if (ar) { ar.cleared = true; ar.boss = null; ar.respawn = 95; }
    SH.hud.banner('ARENA CLEARED', '#5affa8');
    SH.hud.toast('+800 · squad restored', '#5affa8');
    G.squad.forEach(function (h) {
      if (!h.ko) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.4);
    });
    G.addSurge(60, true);
  };

  /* ----------------------------------------------------------- spawning */
  function pickType(lvl) {
    var r = Math.random();
    switch (lvl) {
      case 1: return r < 0.85 ? 'husk' : 'lancer';
      case 2: return r < 0.6 ? 'husk' : 'lancer';
      case 3: return r < 0.4 ? 'husk' : r < 0.66 ? 'lancer' : 'bulwark';
      case 4: return r < 0.3 ? 'husk' : r < 0.5 ? 'lancer' : r < 0.74 ? 'bulwark' : 'stalker';
      default: return r < 0.25 ? 'husk' : r < 0.45 ? 'lancer' : r < 0.72 ? 'bulwark' : 'stalker';
    }
  }

  function updateSpawner(dt) {
    var h = G.player();
    var list = SH.ents.enemies;
    var alive = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      if (!e.boss) alive++;
      // cull the far away
      if (!e.boss && !e.summonedBy && U.dist(e.x, e.y, h.x, h.y) > 2500) e.dead = true;
    }
    var th = SH.world.threatAt(h.x, h.y);
    var target = Math.min(G.opts.maxEnemies, 9 + th * 5);
    spawnT -= dt;
    if (spawnT > 0 || alive >= target) return;
    spawnT = U.rand(0.3, 0.75);
    var n = Math.min(3, target - alive);
    for (var k = 0; k < n; k++) {
      var pos = SH.world.findSpawn(h.x, h.y, 520, 880, 26);
      if (!pos) continue;
      SH.spawnEnemy(pickType(SH.world.threatAt(pos.x, pos.y)), pos.x, pos.y);
    }
  }

  function updateArenas(dt) {
    var h = G.player();
    var W = SH.world;
    var track = null, bestD = 1e9;
    for (var i = 0; i < W.arenas.length; i++) {
      var ar = W.arenas[i];
      if (ar.respawn > 0) ar.respawn -= dt;
      if (ar.boss && ar.boss.dead) ar.boss = null;
      var d = U.dist(h.x, h.y, ar.x, ar.y);
      if (d < ar.r + 40 && !ar.boss && ar.respawn <= 0) {
        var b = SH.spawnEnemy('colossus', ar.x, ar.y);
        if (b) {
          ar.boss = b;
          b.arena = ar;
          SH.hud.banner('COLOSSUS AWAKENS', '#ff2b2b');
        }
      }
      if (ar.boss && !ar.boss.dead && d < 1100 && d < bestD) { bestD = d; track = ar.boss; }
    }
    G.trackedBoss = track;
  }

  function updateBench(dt) {
    for (var i = 0; i < G.squad.length; i++) {
      if (i === G.activeIndex) continue;
      var h = G.squad[i];
      if (h.ko) {
        h.koT += dt;
        if (h.koT >= 12) {
          h.ko = false;
          h.koT = 0;
          h.hp = h.maxHp * 0.4;
          SH.hud.toast(h.kit.name + ' IS BACK UP', h.kit.colors.accent);
          SH.audio.play('revive');
        }
      } else {
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.032 * dt);
        if (h.form > 0) { h.form = 0; if (h.kit.onFormEnd) h.kit.onFormEnd(h); }
      }
      if (h.shieldHp > 0) h.shieldHp = Math.max(0, h.shieldHp - dt * 4);
    }
  }

  /* --------------------------------------------------------- form input */
  function handleFormInput() {
    var h = G.player();
    var IN = SH.input;
    if (IN.btns.force.pressed) {
      if (h.form > 0) {
        SH.hud.toast('ALREADY IN FORM', h.kit.colors.glow);
      } else {
        h.surge = h.maxSurge;
        h.startForm();
      }
    } else if (IN.btns.form.pressed) {
      if (h.form > 0) SH.hud.toast(Math.ceil(h.form) + 's REMAINING', h.kit.colors.glow);
      else if (h.surge >= h.maxSurge) h.startForm();
      else {
        SH.hud.toast('SURGE ' + Math.floor(h.surge) + '% — USE FORCE TO OVERRIDE', '#8aa');
        SH.audio.play('ui');
      }
    }
  }

  /* -------------------------------------------------------------- loop */
  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.0001;

    fpsAcc += 1 / dt; fpsN++;
    if (fpsN >= 20) { G.fps = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0; adapt(dt); }

    SH.audio.frame();
    SH.input.update(dt);

    if (G.state === 'play') {
      G.time += dt;
      if (G.switchCd > 0) G.switchCd -= dt;

      // spatial grid
      SH.grid.clear();
      var en = SH.ents.enemies;
      for (var i = 0; i < en.length; i++) if (!en[i].dead) SH.grid.insert(en[i]);

      handleFormInput();
      var h = G.player();
      h.update(dt);
      SH.updateEnemies(dt);
      SH.updateEntities(dt);
      updateSpawner(dt);
      updateArenas(dt);
      updateBench(dt);
      SH.render.follow(h, dt);
    } else if (G.state === 'downed') {
      SH.updateEntities(dt * 0.25);
      SH.render.follow(G.player(), dt);
    } else if (G.state === 'menu') {
      // slow orbit of the plaza behind the title screen
      G.menuT = (G.menuT || 0) + dt * 0.12;
      var W = SH.world;
      SH.render.cam.x = W.cx + Math.cos(G.menuT) * 620;
      SH.render.cam.y = W.cy + Math.sin(G.menuT * 0.8) * 420;
      SH.updateEntities(dt);
    }

    SH.render.draw(G);
    SH.hud.update(dt, G);
    SH.input.endFrame();
  }

  function adapt() {
    if (G.fps < 42) {
      lowT += 0.35;
      if (lowT > 2 && G.opts.maxEnemies > 22) {
        G.opts.maxEnemies -= 6;
        lowT = 0;
      }
    } else if (G.fps > 55) {
      lowT = Math.max(0, lowT - 0.2);
      if (G.opts.maxEnemies < 56 && G.fps > 58) G.opts.maxEnemies = Math.min(56, G.opts.maxEnemies + 1);
    }
  }

  window.addEventListener('load', function () {
    try {
      G.init();
    } catch (err) {
      var d = document.getElementById('boot');
      if (d) {
        d.classList.remove('hidden');
        d.textContent = 'Boot error: ' + (err && err.message ? err.message : err);
      }
      throw err;
    }
  });
})();
