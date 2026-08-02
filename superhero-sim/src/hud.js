/* VANGUARD — hud.js
 * DOM heads-up display: roster chips, bars, action buttons, minimap,
 * menus, boss bar, banners.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var H = (SH.hud = {});
  var el = {};
  var chips = [];
  var lastCd = {};
  var mmCtx = null;
  var mmT = 0;
  var bannerT = 0;

  function $(id) { return document.getElementById(id); }

  H.init = function () {
    el.hud = $('hud');
    el.roster = $('roster');
    el.hpFill = $('hpfill');
    el.hpText = $('hptext');
    el.surgeFill = $('surgefill');
    el.resWrap = $('reswrap');
    el.resFill = $('resfill');
    el.resName = $('resname');
    el.heroName = $('heroname');
    el.zone = $('zone');
    el.kills = $('kills');
    el.score = $('score');
    el.combo = $('combo');
    el.banner = $('banner');
    el.bossbar = $('bossbar');
    el.bossFill = $('bossfill');
    el.bossName = $('bossname');
    el.minimap = $('minimap');
    el.menu = $('menu');
    el.cards = $('cards');
    el.downed = $('downed');
    el.downedRoster = $('downedroster');
    el.pause = $('pause');
    el.toast = $('toast');
    el.fps = $('fps');
    el.formBtn = document.querySelector('[data-btn="form"]');
    el.extraBtn = document.querySelector('[data-btn="extra"]');

    el.vhud = $('vhud');
    el.vsetup = $('vsetup');
    el.vresult = $('vresult');
    el.vtimer = $('vtimer');
    el.vround = $('vround');
    el.vL = { name: $('vnameL'), hp: $('vhpL'), sg: $('vsgL'), pips: $('vpipsL') };
    el.vR = { name: $('vnameR'), hp: $('vhpR'), sg: $('vsgR'), pips: $('vpipsR') };
    el.faceL = $('vfaceL');
    el.faceR = $('vfaceR');
    el.prevYou = $('prevyou');
    el.prevFoe = $('prevfoe');

    mmCtx = el.minimap.getContext('2d');
    sizeMinimap();

    buildRoster();
    buildCards();
    bindMenu();
    buildVersusSetup();
  };

  /* ------------------------------------------------------------ roster */
  var chipCanvases = [];

  /* Chip portraits are vector (drawPortrait scales by size/64), so allocate
     the canvas at real device pixels and draw at that same size — sizing the
     store alone would leave a small portrait in the corner of a big canvas. */
  function sizeChips() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (var i = 0; i < chipCanvases.length; i++) {
      var c = chipCanvases[i];
      var css = c.el.getBoundingClientRect().width || 50;
      var px = Math.max(48, Math.round(css * dpr));
      if (c.cv.width === px) continue;
      c.cv.width = c.cv.height = px;
      SH.render.drawPortrait(c.cv.getContext('2d'), c.id, px);
    }
  }

  /* Versus busts: follow the box up on dense screens, never below the
     authored 72 (which would make them worse on desktop). */
  function facePx(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var px = Math.max(72, Math.round((cv.getBoundingClientRect().width || 72) * dpr));
    if (cv.width !== px) cv.width = cv.height = px;
  }

  function buildRoster() {
    el.roster.innerHTML = '';
    chips = [];
    chipCanvases = [];
    SH.KITS.forEach(function (kit, i) {
      var d = document.createElement('div');
      d.className = 'chip';
      d.style.setProperty('--accent', kit.colors.accent);
      var cv = document.createElement('canvas');
      d.appendChild(cv);
      chipCanvases.push({ el: d, cv: cv, id: kit.id });
      var bars = document.createElement('div');
      bars.className = 'chipbars';
      bars.innerHTML = '<div class="chiphp"><i></i></div><div class="chipsg"><i></i></div>';
      d.appendChild(bars);
      var num = document.createElement('span');
      num.className = 'chipnum';
      num.textContent = (i + 1);
      d.appendChild(num);
      var st = document.createElement('span');
      st.className = 'chipstate';
      d.appendChild(st);
      d.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        SH.audio.resume();
        SH.game.requestSwitch(i);
      });
      el.roster.appendChild(d);
      chips.push({ el: d, hp: bars.children[0].firstChild, sg: bars.children[1].firstChild, state: st });
    });
    sizeChips();
  }

  /* -------------------------------------------------------- title cards */
  function buildCards() {
    el.cards.innerHTML = '';
    SH.KITS.forEach(function (kit) {
      var c = document.createElement('div');
      c.className = 'card';
      c.style.setProperty('--accent', kit.colors.accent);
      var cv = document.createElement('canvas');
      cv.width = 88; cv.height = 88;
      cv.className = 'cardart';
      SH.render.drawPortrait(cv.getContext('2d'), kit.id, 88);
      c.appendChild(cv);
      var info = document.createElement('div');
      info.className = 'cardinfo';
      info.innerHTML =
        '<h3>' + kit.name + '<em>' + kit.role + '</em></h3>' +
        '<p class="ctitle">' + kit.title + '</p>' +
        '<p class="cdesc">' + kit.desc + '</p>' +
        '<p class="cform"><b>' + kit.formName + '</b> — ' + kit.formDesc + '</p>' +
        '<p class="ctip">' + kit.tips + '</p>';
      c.appendChild(info);
      el.cards.appendChild(c);
    });

    // the arch nemesis
    var db = document.createElement('div');
    db.className = 'card';
    db.style.setProperty('--accent', '#ff7a12');
    var dcv = document.createElement('canvas');
    dcv.width = 88; dcv.height = 88;
    dcv.className = 'cardart';
    SH.render.drawPortrait(dcv.getContext('2d'), 'deathbringer', 88);
    db.appendChild(dcv);
    var dinfo = document.createElement('div');
    dinfo.className = 'cardinfo';
    dinfo.innerHTML =
      '<h3>DEATHBRINGER<em>TIER 6 · ARCH NEMESIS</em></h3>' +
      '<p class="ctitle">The Rot That Walks</p>' +
      '<p class="cdesc">A pitch-black ent the size of a house, sheeted in viscous living mucus, with two burning orange eyes set in a hollow face. It manipulates darkness and kills with a touch.</p>' +
      '<p class="cform"><b>DEATH TOUCH</b> — a lunge that withers you: heavy damage, a rotting DoT, and healing cut to a third while it lasts.</p>' +
      '<p class="ctip">Also: black roots erupting from the ground, a rooting grasp, mucus that pools and slows, and a veil of darkness that blinds the arena and sends shadow orbs hunting. Fight it in the east grove, or in VERSUS.</p>';
    db.appendChild(dinfo);
    el.cards.appendChild(db);
  }

  function bindMenu() {
    $('playbtn').addEventListener('click', function () {
      SH.audio.resume();
      SH.audio.play('ui');
      SH.game.start();
    });
    $('resumebtn').addEventListener('click', function () { SH.game.togglePause(); });
    $('restartbtn').addEventListener('click', function () { SH.game.restart(); });
    $('rosterbtn').addEventListener('click', function () {
      el.menu.classList.remove('hidden');
      el.menu.classList.add('inpause');
      el.pause.classList.add('hidden');
    });
    /* click, not pointerdown: it requires press and release on the same
       element, so a finger sliding across the corner mid-fight can't pause,
       and sliding off cancels */
    $('btnpause').addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      SH.game.togglePause();
    });
    $('reviveall').addEventListener('click', function () { SH.game.reviveSquad(); });
    $('sndbtn').addEventListener('click', function () {
      var on = !SH.audio.enabled;
      SH.audio.setEnabled(on);
      this.textContent = 'SOUND: ' + (on ? 'ON' : 'OFF');
    });
    $('shakebtn').addEventListener('click', function () {
      SH.game.opts.shake = !SH.game.opts.shake;
      this.textContent = 'SHAKE: ' + (SH.game.opts.shake ? 'ON' : 'OFF');
    });
    $('fpsbtn').addEventListener('click', function () {
      SH.game.opts.showFps = !SH.game.opts.showFps;
      el.fps.classList.toggle('hidden', !SH.game.opts.showFps);
      this.textContent = 'FPS: ' + (SH.game.opts.showFps ? 'ON' : 'OFF');
    });
  }

  /* ------------------------------------------------------------ update */
  H.refreshButtons = function () {
    var h = SH.game.player();
    if (!h) return;
    var kit = h.kit;
    setBtn('primary', kit.abil.primary);
    setBtn('a1', kit.abil.a1);
    setBtn('a2', kit.abil.a2);
    setBtn('dash', kit.abil.dash);
    var ex = kit.abil.extra;
    if (ex) {
      el.extraBtn.classList.remove('hidden');
      var icon = kit.id === 'savior' ? ({ fire: '🔥', ice: '❄', lightning: '⚡' }[h.elem] || '✦') : ex.icon;
      setBtnRaw('extra', icon, kit.id === 'savior' ? h.elem.toUpperCase() : ex.name);
    } else {
      el.extraBtn.classList.add('hidden');
    }
    el.heroName.textContent = h.kit.name;
    el.heroName.style.color = h.kit.colors.accent;
    document.documentElement.style.setProperty('--hero', h.kit.colors.accent);
    document.documentElement.style.setProperty('--heroglow', h.kit.colors.glow);
    if (kit.resource) {
      el.resWrap.classList.remove('hidden');
      el.resName.textContent = kit.resource.name;
      el.resFill.style.background = kit.resource.color;
    } else {
      el.resWrap.classList.add('hidden');
    }
    el.formBtn.querySelector('.blabel').textContent = kit.formName.split(' ')[0];
  };

  function setBtn(name, ab) {
    if (!ab) return;
    setBtnRaw(name, ab.icon, ab.name);
  }
  function setBtnRaw(name, icon, label) {
    var b = document.querySelector('[data-btn="' + name + '"]');
    if (!b) return;
    b.querySelector('.bicon').textContent = icon;
    var l = b.querySelector('.blabel');
    if (l) l.textContent = label;
  }

  function tickBanner(dt) {
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) el.banner.classList.remove('show');
    }
  }

  H.update = function (dt, game) {
    var h = game.player();
    if (!h) return;
    tickPreviews(dt);
    if (game.state === 'versus') return;

    // bars
    var hpF = U.clamp(h.hp / h.maxHp, 0, 1);
    el.hpFill.style.width = (hpF * 100).toFixed(1) + '%';
    el.hpFill.style.background = hpF > 0.5 ? '#4be08a' : hpF > 0.25 ? '#ffd76a' : '#ff5b6e';
    el.hpText.textContent = Math.ceil(h.hp) + ' / ' + h.maxHp;
    var sgF = h.form > 0 ? h.form / h.formDur : U.clamp(h.surge / h.maxSurge, 0, 1);
    el.surgeFill.style.width = (sgF * 100).toFixed(1) + '%';
    el.surgeFill.className = h.form > 0 ? 'active' : (h.surge >= h.maxSurge ? 'ready' : '');
    if (h.kit.resource) {
      el.resFill.style.width = (U.clamp(h.charge / h.maxCharge, 0, 1) * 100).toFixed(1) + '%';
    }

    // cooldown rings
    ['primary', 'a1', 'a2', 'dash'].forEach(function (k) {
      var b = document.querySelector('[data-btn="' + k + '"]');
      if (!b) return;
      var v = h.cd[k] > 0 ? h.cd[k] / Math.max(0.01, h.cdMax[k]) : 0;
      if (Math.abs((lastCd[k] || 0) - v) > 0.02 || v === 0) {
        b.style.setProperty('--cd', v.toFixed(2));
        lastCd[k] = v;
      }
      var ch = h.ch[k];
      var cnt = b.querySelector('.bcount');
      if (ch) {
        cnt.classList.remove('hidden');
        cnt.textContent = ch.n;
        b.classList.toggle('empty', ch.n <= 0);
      } else {
        cnt.classList.add('hidden');
        b.classList.toggle('empty', h.cd[k] > 0);
      }
    });

    el.formBtn.classList.toggle('ready', h.surge >= h.maxSurge && h.form <= 0);
    el.formBtn.classList.toggle('active', h.form > 0);

    // roster chips
    for (var i = 0; i < chips.length; i++) {
      var m = game.squad[i], c = chips[i];
      c.el.classList.toggle('sel', i === game.activeIndex);
      c.el.classList.toggle('ko', m.ko);
      c.hp.style.width = (U.clamp(m.hp / m.maxHp, 0, 1) * 100) + '%';
      c.sg.style.width = (U.clamp(m.surge / m.maxSurge, 0, 1) * 100) + '%';
      c.sg.className = m.form > 0 ? 'inform' : (m.surge >= m.maxSurge ? 'full' : '');
      c.state.textContent = m.ko ? Math.max(0, Math.ceil(12 - m.koT)) : (m.form > 0 ? '★' : '');
    }

    // stats
    var th = SH.world.threatAt(h.x, h.y);
    el.zone.textContent = 'LV' + th + ' · ' + SH.world.THREAT_NAMES[th - 1];
    el.zone.style.color = SH.world.THREAT_COLORS[th - 1];
    el.kills.textContent = game.stats.kills;
    el.score.textContent = U.formatNum(game.stats.score);

    tickBanner(dt);

    // boss bar
    var boss = game.trackedBoss;
    if (boss && !boss.dead) {
      el.bossbar.classList.remove('hidden');
      el.bossFill.style.width = (U.clamp(boss.hp / boss.maxHp, 0, 1) * 100).toFixed(1) + '%';
      el.bossName.textContent = (boss.name || 'BOSS') + (boss.enraged ? ' — ENRAGED' : '');
      el.bossFill.style.background = boss.type === 'deathbringer' ? '#ff7a12' : (boss.enraged ? '#ff2b2b' : '#ff6b4a');
    } else {
      el.bossbar.classList.add('hidden');
    }

    // minimap
    mmT -= dt;
    if (mmT <= 0) { mmT = 0.1; drawMinimap(game, h); }

    if (game.opts.showFps) el.fps.textContent = Math.round(game.fps) + ' FPS · ' + SH.ents.enemies.length + 'E ' + SH.ents.particles.length + 'P';
  };

  /* The minimap is 132x99 CSS px on desktop but 86x64 on a phone, and was
     drawn at a fixed 132x99 backing store — upscaled then squashed. Size it
     from what CSS actually gives us, times the device pixel ratio. */
  function sizeMinimap() {
    var r = el.minimap.getBoundingClientRect();
    /* 0x0 while hidden — in Versus (#hud.versus #minimap is display:none) or
       before the HUD is shown. A zero-wide store would silently kill the map,
       so leave it alone and let drawMinimap retry. */
    if (!r.width || !r.height) return;
    mmScale = Math.min(window.devicePixelRatio || 1, 2);
    el.minimap.width = Math.round(r.width * mmScale);
    el.minimap.height = Math.round(r.height * mmScale);
    mmSized = true;
  }

  var mmScale = 1, mmSized = false;

  function drawMinimap(game, h) {
    var W = SH.world, g = mmCtx;
    if (!mmSized) { sizeMinimap(); if (!mmSized) return; }
    /* draw in CSS pixels so every marker radius below keeps its on-screen
       size regardless of the backing store */
    g.setTransform(mmScale, 0, 0, mmScale, 0, 0);
    var w = el.minimap.width / mmScale, hh = el.minimap.height / mmScale;
    var sx = w / W.w, sy = hh / W.h;
    g.clearRect(0, 0, w, hh);
    g.fillStyle = 'rgba(6,10,18,0.72)';
    g.fillRect(0, 0, w, hh);
    // threat rings
    for (var i = 4; i >= 1; i--) {
      g.globalAlpha = 0.1;
      g.fillStyle = W.THREAT_COLORS[i - 1];
      g.beginPath();
      g.ellipse(W.cx * sx, W.cy * sy, (W.maxDist * (i / 4.6)) * sx, (W.maxDist * (i / 4.6)) * sy, 0, 0, U.TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    // arenas
    for (var a = 0; a < W.arenas.length; a++) {
      var ar = W.arenas[a];
      g.fillStyle = ar.boss && !ar.boss.dead ? '#ff2b2b' : (ar.cleared ? '#5affa8' : '#ff9a3c');
      g.beginPath();
      g.arc(ar.x * sx, ar.y * sy, 3.5, 0, U.TAU);
      g.fill();
    }
    // enemies
    var en = SH.ents.enemies;
    for (var e = 0; e < en.length; e++) {
      var o = en[e];
      if (o.dead) continue;
      g.fillStyle = o.color;
      g.fillRect(o.x * sx - 1, o.y * sy - 1, o.boss ? 4 : 2, o.boss ? 4 : 2);
    }
    // player
    g.fillStyle = h.kit.colors.accent;
    g.beginPath();
    g.arc(h.x * sx, h.y * sy, 3, 0, U.TAU);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    g.stroke();
    // view box
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    var vw = (SH.render.vw / SH.render.cam.s) * sx, vh2 = (SH.render.vh / SH.render.cam.s) * sy;
    g.strokeRect(SH.render.cam.x * sx - vw / 2, SH.render.cam.y * sy - vh2 / 2, vw, vh2);
  }

  /* ------------------------------------------------------------ banners */
  H.banner = function (text, color) {
    el.banner.textContent = text;
    el.banner.style.color = color || '#fff';
    el.banner.classList.add('show');
    el.banner.classList.remove('pop');
    void el.banner.offsetWidth;
    el.banner.classList.add('pop');
    bannerT = 1.9;
  };

  var toastT = null;
  H.toast = function (text, color) {
    el.toast.textContent = text;
    el.toast.style.color = color || '#cfe';
    el.toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove('show'); }, 1600);
  };

  /* ------------------------------------------------------------- screens */
  H.showMenu = function (inPause) {
    el.menu.classList.remove('hidden');
    el.menu.classList.toggle('inpause', !!inPause);
    $('playbtn').textContent = inPause ? 'BACK' : 'DEPLOY SQUAD';
  };
  H.hideMenu = function () { el.menu.classList.add('hidden'); };
  H.showPause = function (on) { el.pause.classList.toggle('hidden', !on); };

  /* =====================================================================
   * VERSUS
   * =================================================================== */
  var vsel = { you: 'savior', foe: 'deathbringer', diff: 'normal' };
  var setupT = 0;

  function fighterList() {
    return SH.KITS.map(function (k) {
      return { id: k.id, name: k.name, accent: k.colors.accent, sub: k.role };
    });
  }

  function buildVersusSetup() {
    var youWrap = $('pickyou'), foeWrap = $('pickfoe'), diffWrap = $('pickdiff');
    if (!youWrap) return;

    function mkPick(wrap, entry, onPick) {
      var b = document.createElement('button');
      b.className = 'pick';
      b.style.setProperty('--accent', entry.accent);
      b.dataset.id = entry.id;
      var cv = document.createElement('canvas');
      cv.width = 44; cv.height = 44;
      SH.render.drawPortrait(cv.getContext('2d'), entry.id, 44);
      b.appendChild(cv);
      var s = document.createElement('span');
      s.innerHTML = '<b>' + entry.name + '</b><em>' + (entry.sub || '') + '</em>';
      b.appendChild(s);
      b.addEventListener('click', function () { SH.audio.play('ui'); onPick(entry.id); });
      wrap.appendChild(b);
      return b;
    }

    youWrap.innerHTML = '';
    fighterList().forEach(function (e) {
      mkPick(youWrap, e, function (id) { vsel.you = id; syncPicks(); });
    });

    foeWrap.innerHTML = '';
    mkPick(foeWrap, {
      id: 'deathbringer', name: 'DEATHBRINGER', accent: '#ff7a12', sub: 'TIER 6 · ARCH NEMESIS'
    }, function (id) { vsel.foe = id; syncPicks(); });
    fighterList().forEach(function (e) {
      mkPick(foeWrap, e, function (id) { vsel.foe = id; syncPicks(); });
    });

    diffWrap.innerHTML = '';
    ['easy', 'normal', 'hard', 'nightmare'].forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'pick diffpick';
      b.dataset.id = d;
      b.textContent = SH.versus.DIFF[d].label;
      b.addEventListener('click', function () { SH.audio.play('ui'); vsel.diff = d; syncPicks(); });
      diffWrap.appendChild(b);
    });

    $('fightbtn').addEventListener('click', function () {
      SH.audio.resume();
      SH.audio.play('form');
      H.showVersusSetup(false);
      H.hideMenu();
      SH.versus.start(vsel.you, vsel.foe, vsel.diff);
    });
    $('vsbackbtn').addEventListener('click', function () {
      H.showVersusSetup(false);
      H.showMenu(false);
    });
    $('versusbtn').addEventListener('click', function () {
      SH.audio.resume();
      SH.audio.play('ui');
      H.hideMenu();
      H.showVersusSetup(true);
    });
    $('rematchbtn').addEventListener('click', function () { SH.versus.rematch(); });
    $('vschangebtn').addEventListener('click', function () { SH.versus.quitToMenu(); });
    $('vsexitbtn').addEventListener('click', function () {
      H.showVersusResult(false, SH.versus);
      SH.versus.exit();
      SH.game.state = 'menu';
      H.showMenu(false);
    });
    syncPicks();
  }

  function syncPicks() {
    ['pickyou', 'pickfoe', 'pickdiff'].forEach(function (wid) {
      var w = $(wid);
      if (!w) return;
      var key = wid === 'pickyou' ? 'you' : wid === 'pickfoe' ? 'foe' : 'diff';
      Array.prototype.forEach.call(w.children, function (c) {
        c.classList.toggle('on', c.dataset.id === vsel[key]);
      });
    });
    var d = SH.versus.DIFF[vsel.diff];
    $('difftag').textContent = d.tag;
    $('prevyouname').textContent = SH.kitById(vsel.you).name;
    $('prevfoename').textContent = vsel.foe === 'deathbringer' ? 'DEATHBRINGER' : SH.kitById(vsel.foe).name;
    $('prevfoename').style.color = vsel.foe === 'deathbringer' ? '#ff7a12' : SH.kitById(vsel.foe).colors.accent;
    $('prevyouname').style.color = SH.kitById(vsel.you).colors.accent;
  }

  H.showVersusSetup = function (on) {
    /* the one choke point every route into Versus passes through: the menu
       button, the ?mode=versus deep link, and CHANGE FIGHTER */
    if (on) SH.loadThree();
    el.vsetup.classList.toggle('hidden', !on);
    if (on) {
      sizePreview(el.prevYou);
      sizePreview(el.prevFoe);
      syncPicks();
    }
  };

  function sizePreview(cv) {
    if (!cv) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    var w = Math.max(60, Math.round(r.width * dpr));
    var h = Math.max(80, Math.round(r.height * dpr));
    /* assigning .width clears the backing store, and mobile fires resize on
       every URL-bar nudge — so only touch it when it actually changed */
    if (cv.width === w && cv.height === h) return;
    cv.width = w;
    cv.height = h;
  }

  /* The fighter-select slots are fluid (one column below 780px, three above),
     but were only ever measured once on open — so rotating the phone here,
     the most likely moment to rotate, left both previews stretched. */
  H.resizePreviews = function () {
    if (!el.vsetup || el.vsetup.classList.contains('hidden')) return;
    sizePreview(el.prevYou);
    sizePreview(el.prevFoe);
  };

  /* Called from R.resize, which also runs on the delayed orientationchange
     pass. Setting canvas.width clears the bitmap, so anything that isn't
     redrawn every frame has to be repainted here. */
  H.resizeCanvases = function () {
    if (!el.minimap) return;
    H.resizePreviews();
    sizeMinimap();
    sizeChips();
  };

  function tickPreviews(dt) {
    if (!el.vsetup || el.vsetup.classList.contains('hidden')) return;
    setupT += dt;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    [[el.prevYou, vsel.you, 1], [el.prevFoe, vsel.foe, -1]].forEach(function (pair) {
      var cv = pair[0];
      if (!cv || !cv.width) return;
      var c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      c.save();
      if (pair[2] < 0) { c.translate(cv.width, 0); c.scale(-1, 1); }
      SH.side.drawPreview(c, pair[1], cv.width, cv.height, setupT);
      c.restore();
    });
  }

  H.setVersus = function (on) {
    el.hud.classList.toggle('versus', !!on);
    el.vhud.classList.toggle('hidden', !on);
    if (on) {
      var vs = SH.versus;
      if (vs.you) {
        facePx(el.faceL);
        SH.render.drawPortrait(el.faceL.getContext('2d'), vs.you.kitId, el.faceL.width);
        el.faceL.style.borderColor = vs.you.kit.colors.accent;
      }
      if (vs.foe) {
        var fid = vs.foe.isHero ? vs.foe.kitId : 'deathbringer';
        facePx(el.faceR);
        SH.render.drawPortrait(el.faceR.getContext('2d'), fid, el.faceR.width);
        el.faceR.style.borderColor = vs.foe.accent || '#fff';
      }
      el.vL.name.textContent = SH.versus.you ? SH.versus.you.kit.name : '';
      el.vR.name.textContent = SH.versus.foe ? (SH.versus.foe.displayName || '') : '';
      el.vL.name.style.color = SH.versus.you ? SH.versus.you.kit.colors.accent : '#fff';
      el.vR.name.style.color = SH.versus.foe ? (SH.versus.foe.accent || '#fff') : '#fff';
    }
  };

  H.updateVersus = function (dt, vs) {
    var you = vs.you, foe = vs.foe;
    if (!you || !foe) return;
    tickBanner(dt);

    el.vL.hp.style.width = (U.clamp(you.hp / you.maxHp, 0, 1) * 100).toFixed(1) + '%';
    el.vR.hp.style.width = (U.clamp(foe.hp / foe.maxHp, 0, 1) * 100).toFixed(1) + '%';
    el.vL.sg.style.width = (U.clamp(you.form > 0 ? you.form / you.formDur : you.surge / you.maxSurge, 0, 1) * 100).toFixed(1) + '%';
    el.vL.sg.className = you.form > 0 ? 'inform' : (you.surge >= you.maxSurge ? 'full' : '');
    if (foe.isHero) {
      el.vR.sg.parentNode.classList.remove('hidden');
      el.vR.sg.style.width = (U.clamp(foe.form > 0 ? foe.form / foe.formDur : foe.surge / foe.maxSurge, 0, 1) * 100).toFixed(1) + '%';
      el.vR.sg.className = foe.form > 0 ? 'inform' : (foe.surge >= foe.maxSurge ? 'full' : '');
    } else {
      el.vR.sg.parentNode.classList.add('hidden');
    }
    el.vR.hp.style.background = foe.isHero ? '#ff5b6e' : (foe.enraged ? '#ff3b12' : '#ff7a12');

    el.vtimer.textContent = Math.ceil(vs.timer);
    el.vtimer.classList.toggle('low', vs.timer < 11);
    el.vround.textContent = 'ROUND ' + vs.round;
    pips(el.vL.pips, vs.wins[0]);
    pips(el.vR.pips, vs.wins[1]);

    // the action buttons still belong to you
    ['primary', 'a1', 'a2', 'dash'].forEach(function (k) {
      var b = document.querySelector('[data-btn="' + k + '"]');
      if (!b) return;
      var v = you.cd[k] > 0 ? you.cd[k] / Math.max(0.01, you.cdMax[k]) : 0;
      b.style.setProperty('--cd', v.toFixed(2));
      var ch = you.ch[k];
      var cnt = b.querySelector('.bcount');
      if (ch) { cnt.classList.remove('hidden'); cnt.textContent = ch.n; }
      else cnt.classList.add('hidden');
      b.classList.toggle('empty', ch ? ch.n <= 0 : you.cd[k] > 0);
    });
    el.formBtn.classList.toggle('ready', you.surge >= you.maxSurge && you.form <= 0);
    el.formBtn.classList.toggle('active', you.form > 0);
    if (you.kit.resource) el.resFill.style.width = (U.clamp(you.charge / you.maxCharge, 0, 1) * 100).toFixed(1) + '%';
    if (SH.game.opts.showFps) el.fps.textContent = Math.round(SH.game.fps) + ' FPS';
  };

  function pips(wrap, n) {
    if (wrap.childElementCount !== 2) {
      wrap.innerHTML = '<i></i><i></i>';
    }
    wrap.children[0].classList.toggle('on', n >= 1);
    wrap.children[1].classList.toggle('on', n >= 2);
  }

  H.showVersusResult = function (on, vs) {
    el.vresult.classList.toggle('hidden', !on);
    if (!on) return;
    var win = vs.result === 'win';
    $('vresulttitle').textContent = win ? 'VICTORY' : 'DEFEAT';
    $('vresulttitle').className = win ? 'good' : 'danger';
    $('vresultsub').textContent =
      (win ? 'You took ' : 'You lost ') + vs.wins[0] + ' — ' + vs.wins[1] +
      ' against ' + (vs.foe.displayName || '') + ' on ' + SH.versus.DIFF[vs.difficulty].label + '.';
  };

  H.showDowned = function (on, game) {
    el.downed.classList.toggle('hidden', !on);
    if (!on) return;
    el.downedRoster.innerHTML = '';
    var any = false;
    game.squad.forEach(function (m, i) {
      if (m.ko) return;
      any = true;
      var b = document.createElement('button');
      b.className = 'swapbtn';
      b.style.setProperty('--accent', m.kit.colors.accent);
      var cv = document.createElement('canvas');
      cv.width = 48; cv.height = 48;
      SH.render.drawPortrait(cv.getContext('2d'), m.kit.id, 48);
      b.appendChild(cv);
      var s = document.createElement('span');
      s.textContent = m.kit.name;
      b.appendChild(s);
      b.addEventListener('click', function () { game.tagIn(i); });
      el.downedRoster.appendChild(b);
    });
    $('nolives').classList.toggle('hidden', any);
  };
})();
