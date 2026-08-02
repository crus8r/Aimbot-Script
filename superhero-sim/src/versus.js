/* VANGUARD — versus.js
 * Side-on 1v1 mode. Best of three rounds against Deathbringer (default)
 * or against one of your own squad.
 *
 * Everything here rides on the existing systems: the same hero kits, the
 * same damage/status/FX pipeline, the same enemy AI for the boss. The AI
 * opponent is driven by a synthetic controller so a Hero can be played by
 * the computer without any special-case ability code.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var FX = SH.fx;
  var C = SH.combat;

  var DIFF = {
    easy: { label: 'EASY', hp: 0.65, dmg: 0.5, react: 0.6, cd: 1.55, aggro: 0.5, tag: 'A warm-up. He telegraphs everything and waits.' },
    normal: { label: 'NORMAL', hp: 1, dmg: 0.85, react: 0.34, cd: 1.15, aggro: 0.75, tag: 'The intended fight.' },
    hard: { label: 'HARD', hp: 1.25, dmg: 1.2, react: 0.18, cd: 0.88, aggro: 0.92, tag: 'He punishes every whiff.' },
    nightmare: { label: 'NIGHTMARE', hp: 1.5, dmg: 1.65, react: 0.08, cd: 0.7, aggro: 1, tag: 'The death touch two-shots you. Good luck.' }
  };

  var V = (SH.versus = {
    active: false,
    you: null, foe: null, fighters: [],
    round: 1, wins: [0, 0], timer: 99,
    phase: 'intro', phaseT: 0,
    difficulty: 'normal',
    youId: 'savior', foeId: 'deathbringer',
    result: null,
    DIFF: DIFF
  });

  var BTN_NAMES = ['primary', 'a1', 'a2', 'dash', 'form', 'force', 'extra', 'jump', 'guard'];
  function mkInput() {
    var b = {};
    for (var i = 0; i < BTN_NAMES.length; i++) {
      b[BTN_NAMES[i]] = { down: false, pressed: false, released: false, heldFor: 0, aimActive: false, aimX: 0, aimY: 0 };
    }
    return { move: { x: 0, y: 0, len: 0 }, btns: b, keys: {}, ai: true };
  }
  function clearPressed(inp) {
    for (var i = 0; i < BTN_NAMES.length; i++) {
      inp.btns[BTN_NAMES[i]].pressed = false;
      inp.btns[BTN_NAMES[i]].released = false;
    }
  }
  function tap(inp, name) {
    var b = inp.btns[name];
    if (!b.down) { b.pressed = true; b.heldFor = 0; }
    b.down = true;
  }

  V.foeOf = function (f) { return f === V.you ? V.foe : V.you; };
  V.diff = function () { return DIFF[V.difficulty] || DIFF.normal; };

  /* =====================================================================
   * START
   * =================================================================== */
  V.start = function (youId, foeId, difficulty) {
    var S = SH.side;
    V.youId = youId || V.youId;
    V.foeId = foeId || V.foeId;
    V.difficulty = difficulty || V.difficulty;
    V.round = 1;
    V.wins = [0, 0];
    V.result = null;
    V.active = true;

    SH.plane = 'side';
    S.theme = V.foeId === 'deathbringer' ? 'blight' : 'plaza';
    SH.world.enterStage(S.STAGE_W, S.GROUND + 400);
    SH.ents.clearAll();
    SH.darkness.t = 0; SH.darkness.amount = 0;

    // you — reuse the squad member so the campaign HUD/kit code all applies
    var idx = 0;
    for (var i = 0; i < SH.game.squad.length; i++) if (SH.game.squad[i].kitId === V.youId) idx = i;
    SH.game.activeIndex = idx;
    var you = SH.game.squad[idx];
    you.in = SH.input;
    you.vsTeam = 0;
    you.versus = true;
    V.you = you;

    // opponent
    if (V.foeId === 'deathbringer') {
      V.foe = makeBoss();
    } else {
      V.foe = makeAiHero(V.foeId);
    }
    if (SH.ents.enemies.indexOf(you) < 0) SH.ents.enemies.push(you);
    V.fighters = [V.you, V.foe];

    SH.hud.hideMenu();
    SH.hud.showVersusSetup(false);
    SH.hud.showVersusResult(false, V);
    SH.hud.showPause(false);
    SH.hud.showDowned(false, SH.game);
    SH.hud.setVersus(true);
    SH.hud.refreshButtons();
    resetRound(true);
    SH.game.state = 'versus';
  };

  function makeBoss() {
    var d = V.diff();
    var b = SH.spawnEnemy('deathbringer', SH.side.STAGE_W * 0.72, SH.side.GROUND, {
      instant: true, rawStats: true, hpScale: d.hp, dmgScale: d.dmg
    });
    b.vsTeam = 1;
    b.deathbringer = true;
    b.cdScale = d.cd;
    b.h = 215;                 // tall on stage, so effects line up with the body
    b.displayName = 'DEATHBRINGER';
    b.accent = '#ff7a12';
    return b;
  }

  function makeAiHero(id) {
    var kit = SH.kitById(id);
    var f = new SH.Hero(kit);
    f.in = mkInput();
    f.vsTeam = 1;
    f.versus = true;
    f.isAi = true;
    f.ai = { t: 0, plan: 'approach', planT: 0, react: 0 };
    f.displayName = kit.name;
    f.accent = kit.colors.accent;
    var d = V.diff();
    f.dmgTakenMult = 1 / d.hp;
    f.aiDmg = d.dmg;
    SH.ents.enemies.push(f);   // so your attacks can find and hit it
    return f;
  }

  function resetRound(snap) {
    var S = SH.side;
    SH.ents.projectiles.length = 0;
    SH.ents.hazards.length = 0;
    SH.ents.structures.length = 0;
    SH.ents.pickups.length = 0;
    SH.ents.particles.length = 0;
    SH.ents.texts.length = 0;
    SH.ents.after.length = 0;
    SH.darkness.t = 0; SH.darkness.amount = 0;

    var you = V.you, foe = V.foe;
    you.reset();
    you.in = SH.input;
    you.vsTeam = 0; you.versus = true;
    you.x = S.STAGE_W * 0.3; you.y = S.GROUND; you.z = 0;
    you.facing = 0; you.ko = false; you.hitstun = 0; you.guard = 0;
    you.status = {};
    if (SH.ents.enemies.indexOf(you) < 0) SH.ents.enemies.push(you);

    if (foe.isHero) {
      foe.reset();
      foe.in = mkInput();
      foe.vsTeam = 1; foe.versus = true;
      foe.ko = false; foe.hitstun = 0; foe.guard = 0;
      foe.status = {};
      if (SH.ents.enemies.indexOf(foe) < 0) SH.ents.enemies.push(foe);
    } else {
      foe.hp = foe.maxHp;
      foe.ko = false; foe.koT = 0; foe.dead = false;
      foe.enraged = false;
      foe.state = 'idle'; foe.stateT = 0; foe.tele = null;
      foe.atkCd = 1.4;
      foe.speed = foe.def.speed;
      foe.status = {};
      foe.vx = 0; foe.vy = 0; foe.kvx = 0; foe.kvy = 0;
      if (SH.ents.enemies.indexOf(foe) < 0) SH.ents.enemies.push(foe);
    }
    foe.x = S.STAGE_W * 0.7; foe.y = S.GROUND; foe.z = 0;
    foe.facing = Math.PI;

    V.timer = 99;
    V.phase = 'intro';
    V.phaseT = 0;
    SH.side.follow(you, foe, 0, true);
    SH.hud.banner('ROUND ' + V.round, '#ffd76a');
  }

  V.exit = function () {
    V.active = false;
    SH.plane = 'top';
    SH.world.exitStage();
    SH.ents.clearAll();
    SH.darkness.t = 0; SH.darkness.amount = 0;
    if (V.you) { V.you.in = SH.input; V.you.vsTeam = undefined; V.you.versus = false; V.you.status = {}; }
    if (V.foe && V.foe.isHero) V.foe.vsTeam = undefined;
    V.you = V.foe = null;
    V.fighters = [];
    SH.hud.setVersus(false);
  };

  /* =====================================================================
   * KO / ROUND FLOW
   * =================================================================== */
  V.onKO = function (f) {
    if (V.phase === 'ko' || V.phase === 'over') return;
    f.ko = true;
    f.koT = 0;
    f.hp = 0;
    if (f.form > 0 && f.endForm) f.endForm();
    var winner = f === V.you ? 1 : 0;
    V.wins[winner]++;
    V.phase = 'ko';
    V.phaseT = 0;
    SH.input.clearAll();
    FX.shake(20);
    SH.audio.play('ko');
    SH.hud.banner(winner === 0 ? 'K.O.' : 'YOU ARE DOWN', winner === 0 ? '#ffd76a' : '#ff5b6e');
    if (V.wins[winner] >= 2) {
      V.result = winner === 0 ? 'win' : 'lose';
    }
  };

  function updatePhase(dt) {
    V.phaseT += dt;
    if (V.phase === 'intro') {
      if (V.phaseT > 1.15 && !V.saidFight) {
        V.saidFight = true;
        SH.hud.banner('FIGHT', '#ff5b6e');
        SH.audio.play('form');
      }
      if (V.phaseT > 1.8) { V.phase = 'fight'; V.saidFight = false; }
      return false;
    }
    if (V.phase === 'ko') {
      if (V.phaseT > 2.6) {
        if (V.result) {
          V.phase = 'over';
          V.phaseT = 0;
          SH.hud.showVersusResult(true, V);
          SH.hud.banner(V.result === 'win' ? 'VICTORY' : 'DEFEAT', V.result === 'win' ? '#5affa8' : '#ff5b6e');
        } else {
          V.round++;
          V.saidFight = false;
          resetRound();
        }
      }
      return false;
    }
    if (V.phase === 'over') return false;

    V.timer -= dt;
    if (V.timer <= 0) {
      V.timer = 0;
      var youF = V.you.hp / V.you.maxHp, foeF = V.foe.hp / V.foe.maxHp;
      SH.hud.banner('TIME', '#ffd76a');
      V.onKO(youF >= foeF ? V.foe : V.you);
      return false;
    }
    return true;
  }

  /* =====================================================================
   * AI
   * =================================================================== */
  function aiHero(f, foe, dt) {
    var d = V.diff();
    var inp = f.in;
    var a = f.ai;
    inp.move.x = 0; inp.move.y = 0; inp.move.len = 0;
    for (var i = 0; i < BTN_NAMES.length; i++) inp.btns[BTN_NAMES[i]].down = false;

    if (f.ko || V.phase !== 'fight') { clearPressed(inp); return; }

    var dx = foe.x - f.x;
    var dist = Math.abs(dx);
    var dir = dx >= 0 ? 1 : -1;
    a.t -= dt;
    a.planT -= dt;
    a.react -= dt;

    // preferred range per kit
    var pref = 78;
    if (f.kitId === 'vitality') pref = 210;
    else if (f.kitId === 'paragon') pref = 92;
    else if (f.kitId === 'exodus') pref = 96;

    // pick a plan on a timer so it doesn't jitter
    if (a.planT <= 0) {
      a.planT = U.rand(0.5, 1.2);
      var roll = Math.random();
      if (f.hp < f.maxHp * 0.3 && roll < 0.35) a.plan = 'retreat';
      else if (roll < d.aggro) a.plan = 'approach';
      else if (roll < d.aggro + 0.15) a.plan = 'space';
      else a.plan = 'wait';
    }

    // dodge telegraphed danger and incoming shots
    var threat = incomingThreat(f);
    if (threat && a.react <= 0) {
      a.react = d.react + 0.1;
      if (threat.air && f.grounded) { tap(inp, 'jump'); }
      else if (f.cd.dash <= 0 && Math.random() < 0.55 + d.aggro * 0.3) {
        inp.move.x = -dir;
        inp.move.len = 1;
        tap(inp, 'dash');
      } else if (Math.random() < d.aggro) {
        inp.move.y = 1; // guard
      }
    }

    // movement
    if (a.plan === 'retreat') { inp.move.x = -dir; inp.move.len = 1; }
    else if (a.plan === 'space') { inp.move.x = dist < pref * 1.9 ? -dir : dir; inp.move.len = 1; }
    else if (a.plan === 'approach') {
      if (dist > pref * 0.85) { inp.move.x = dir; inp.move.len = 1; }
      else if (dist < pref * 0.5) { inp.move.x = -dir; inp.move.len = 0.6; }
    }

    // surge form
    if (f.surge >= f.maxSurge && f.form <= 0 && Math.random() < 0.02 + d.aggro * 0.03) {
      f.startForm();
    }

    // attacks
    if (a.t <= 0) {
      var reach = f.kitId === 'vitality' ? 420 : (f.kitId === 'exodus' ? 128 : 104);
      if (dist < reach * 1.05) {
        tap(inp, 'primary');
        a.t = U.rand(0.05, 0.2) * (2 - d.aggro);
      }
      // abilities
      if (f.cd.a2 <= 0 && dist < 380 && Math.random() < 0.35 * d.aggro + 0.1) {
        tap(inp, 'a2');
        a.t = U.rand(0.3, 0.7);
      } else if (f.cd.a1 <= 0 && Math.random() < 0.3 * d.aggro + 0.08) {
        if (f.kitId === 'savior') { if (threat) inp.btns.a1.down = true; }
        else if (f.kitId === 'exodus') { if (dist > 130) inp.btns.a1.down = true; }
        else if (f.kitId === 'paragon') { if (dist > 150 || Math.random() < 0.3) tap(inp, 'a1'); }
        else { tap(inp, 'a1'); }
        a.t = U.rand(0.25, 0.6);
      }
      if (dist > 300 && f.cd.dash <= 0 && Math.random() < 0.25) {
        inp.move.x = dir; inp.move.len = 1;
        tap(inp, 'dash');
        a.t = U.rand(0.2, 0.5);
      }
    }

    // hold-style abilities need the button held down, not tapped
    if (f.kitId === 'savior' && threat && f.cd.a1 <= 0 && Math.random() < d.aggro) inp.btns.a1.down = true;
    if (f.kitId === 'paragon' && !f.grounded && f.vz < 0 && dist > 140) inp.btns.a1.down = true;

    if (inp.move.x) inp.move.len = Math.max(inp.move.len, Math.abs(inp.move.x));
  }

  /* Is something dangerous heading at this fighter right now? */
  function incomingThreat(f) {
    var list = SH.ents.projectiles;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.owner === f) continue;
      if (p.owner && p.owner.vsTeam === f.vsTeam) continue;
      if (p.team === 'hero' && f.vsTeam === 0) continue;
      var dx = p.x - f.x;
      if (Math.abs(dx) > 300) continue;
      if (dx * p.vx > 0) continue;         // moving away
      return { air: p.z < 60, d: Math.abs(dx) };
    }
    var hz = SH.ents.hazards;
    for (var j = 0; j < hz.length; j++) {
      var h = hz[j];
      if (h.delay > 0 && h.team === 'enemy' && Math.abs(h.x - f.x) < h.r + 40) return { air: true, d: 0 };
    }
    var en = SH.ents.enemies;
    for (var k = 0; k < en.length; k++) {
      var e = en[k];
      if (e.isHero || !e.tele) continue;
      if (Math.abs(e.x - f.x) < (e.tele.r || 300) + 60) return { air: e.tele.kind !== 'charge', d: 0 };
    }
    return null;
  }

  /* =====================================================================
   * UPDATE
   * =================================================================== */
  V.update = function (dt) {
    var live = updatePhase(dt);
    var you = V.you, foe = V.foe;
    if (!you || !foe) return;

    var slow = (V.phase === 'ko' || V.phase === 'over') ? 0.35 : 1;
    var sdt = dt * slow;

    // spatial grid
    SH.grid.clear();
    for (var i = 0; i < SH.ents.enemies.length; i++) {
      var e = SH.ents.enemies[i];
      if (!e.dead) SH.grid.insert(e);
    }

    // player input only during the fight
    if (!live) SH.input.clearAll();
    else SH.game.handleFormInput();

    if (you.hitstun > 0) you.hitstun -= sdt;
    you.update(sdt);
    lockToLane(you);

    if (foe.isHero) {
      aiHero(foe, you, sdt);
      if (foe.hitstun > 0) foe.hitstun -= sdt;
      foe.update(sdt);
      clearPressed(foe.in);
      lockToLane(foe);
    }

    SH.updateEnemies(sdt);       // drives Deathbringer; skips heroes
    SH.updateEntities(sdt);
    SH.updateDarkness(sdt);
    if (!foe.isHero) lockToLane(foe);

    SH.side.follow(you, foe, dt, false);
  };

  /* keep the fight on one plane and inside the stage */
  function lockToLane(f) {
    f.y = SH.side.GROUND;
    f.vy = 0;
    if (f.kvy) f.kvy = 0;
    var pad = (f.deathbringer ? 70 : 30);
    f.x = U.clamp(f.x, pad, SH.side.STAGE_W - pad);
  }

  V.draw = function () { SH.side.draw(V); };

  /* =====================================================================
   * MENU HELPERS
   * =================================================================== */
  V.rematch = function () {
    SH.hud.showVersusResult(false, V);
    V.round = 1;
    V.wins = [0, 0];
    V.result = null;
    if (!V.foe.isHero) {
      var d = V.diff();
      V.foe.maxHp = SH.ENEMY_TYPES.deathbringer.hp * d.hp;
      V.foe.dmgScale = d.dmg;
      V.foe.cdScale = d.cd;
    }
    resetRound(true);
  };

  V.quitToMenu = function () {
    SH.hud.showVersusResult(false, V);
    V.exit();
    SH.game.state = 'menu';
    SH.hud.showMenu(false);
    SH.hud.showVersusSetup(true);
  };
})();
