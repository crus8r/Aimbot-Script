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

    mmCtx = el.minimap.getContext('2d');
    el.minimap.width = 132; el.minimap.height = 99;

    buildRoster();
    buildCards();
    bindMenu();
  };

  /* ------------------------------------------------------------ roster */
  function buildRoster() {
    el.roster.innerHTML = '';
    chips = [];
    SH.KITS.forEach(function (kit, i) {
      var d = document.createElement('div');
      d.className = 'chip';
      d.style.setProperty('--accent', kit.colors.accent);
      var cv = document.createElement('canvas');
      cv.width = 56; cv.height = 56;
      SH.render.drawPortrait(cv.getContext('2d'), kit.id, 56);
      d.appendChild(cv);
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
    $('btnpause').addEventListener('pointerdown', function (ev) {
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

  H.update = function (dt, game) {
    var h = game.player();
    if (!h) return;

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

    // banner fade
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) el.banner.classList.remove('show');
    }

    // boss bar
    var boss = game.trackedBoss;
    if (boss && !boss.dead) {
      el.bossbar.classList.remove('hidden');
      el.bossFill.style.width = (U.clamp(boss.hp / boss.maxHp, 0, 1) * 100).toFixed(1) + '%';
      el.bossName.textContent = 'COLOSSUS' + (boss.enraged ? ' — ENRAGED' : '');
      el.bossFill.style.background = boss.enraged ? '#ff2b2b' : '#ff6b4a';
    } else {
      el.bossbar.classList.add('hidden');
    }

    // minimap
    mmT -= dt;
    if (mmT <= 0) { mmT = 0.1; drawMinimap(game, h); }

    if (game.opts.showFps) el.fps.textContent = Math.round(game.fps) + ' FPS · ' + SH.ents.enemies.length + 'E ' + SH.ents.particles.length + 'P';
  };

  function drawMinimap(game, h) {
    var W = SH.world, g = mmCtx;
    var w = el.minimap.width, hh = el.minimap.height;
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
