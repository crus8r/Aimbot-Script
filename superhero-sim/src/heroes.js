/* VANGUARD — heroes.js
 * The squad: Savior, Exodus, Paragon, Dominus, Vitality.
 * Each kit defines stats, four actions, an optional extra action and a
 * temporary Surge Form.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;
  var FX = SH.fx;
  var C = SH.combat;

  var GRAV = 1500;

  /* ---------------------------------------------------------------- utils */
  var lbuf = [];
  function lineEnemies(x, y, ang, len, width, cb) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var cands = SH.grid.query(x + dx * len * 0.5, y + dy * len * 0.5, len * 0.5 + width + 60, lbuf);
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e.dead || e.spawning > 0) continue;
      var t = (e.x - x) * dx + (e.y - y) * dy;
      if (t < -e.r || t > len + e.r) continue;
      t = U.clamp(t, 0, len);
      if (U.dist(x + dx * t, y + dy * t, e.x, e.y) <= width + e.r) cb(e, t);
    }
  }

  function isBehind(attacker, e) {
    var a = U.angTo(e.x, e.y, attacker.x, attacker.y);
    return Math.abs(U.angDiff(e.facing, a)) > 1.9;
  }

  /* ================================================================= HERO */
  function Hero(kit) {
    this.kit = kit;
    this.kitId = kit.id;
    this.name = kit.name;
    this.isHero = true;
    this.in = SH.input;          // swapped for a synthetic controller when AI-driven
    /* enemy-shaped fields so a hero can be a valid target in versus mode */
    this.r = kit.radius;
    this.h = 34;
    this.kvx = 0; this.kvy = 0;
    this.spawning = 0;
    this.stagger = 0;
    this.color = kit.colors.accent;
    this.body = kit.colors.base;
    this.level = 5;
    this.type = 'hero';
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.facing = 0;
    this.radius = kit.radius;
    this.maxHp = kit.maxHp;
    this.hp = kit.maxHp;
    this.speed = kit.speed;
    this.speedMul = 1;
    this.dmgMul = 1;
    this.dmgTakenMult = 1;
    this.surge = 0;
    this.maxSurge = 100;
    this.form = 0;
    this.formDur = kit.formDur;
    this.formInvuln = false;
    this.flying = false;
    this.flyZ = 0;
    this.invuln = 0;
    this.shieldHp = 0;
    this.absorbing = 0;
    this.charge = 0;
    this.maxCharge = kit.resource ? kit.resource.max : 0;
    this.cd = { primary: 0, a1: 0, a2: 0, dash: 0, extra: 0 };
    this.cdMax = { primary: 1, a1: 1, a2: 1, dash: 1, extra: 1 };
    this.ch = {};
    this.attackT = 0;
    this.attackMove = 1;
    this.combo = 0;
    this.comboT = 0;
    this.dashT = 0;
    this.dashDir = 0;
    this.dashSpeed = 0;
    this.hitFlash = 0;
    this.ko = false;
    this.koT = 0;
    this.dead = false;
    this.status = {};
    this.anim = { swing: 0, swingDir: 1, arm: 0, cape: 0, t: 0, wing: 0, hair: 0 };
    this.trailT = 0;
    this.state = {};
    this.grounded = true;
    this.lastHitAt = -99;
    if (kit.init) kit.init(this);
  }
  SH.Hero = Hero;

  Hero.prototype.setCd = function (k, t) { this.cd[k] = t; this.cdMax[k] = t; };

  Hero.prototype.getAim = function (btnName, range) {
    // side view: everything is thrown straight down the lane
    if (SH.plane === 'side') {
      var foe = SH.versus && SH.versus.foeOf(this);
      if (foe && !foe.dead) return foe.x >= this.x ? 0 : Math.PI;
      return Math.abs(U.angDiff(0, this.facing)) < Math.PI / 2 ? 0 : Math.PI;
    }
    var b = this.in.btns[btnName];
    if (b && b.aimActive) return Math.atan2(b.aimY, b.aimX);
    var t = U.nearestEnemy(this.x, this.y, range || 400);
    if (t) return U.angTo(this.x, this.y, t.x, t.y);
    if (this.in.move.len > 0.12) return Math.atan2(this.in.move.y, this.in.move.x);
    return this.facing;
  };

  Hero.prototype.mkCharges = function (key, n, rt) {
    this.ch[key] = { n: n, max: n, rt: 0, rtMax: rt };
  };
  Hero.prototype.useCharge = function (key) {
    var c = this.ch[key];
    if (!c || c.n <= 0) return false;
    c.n--;
    if (c.rt <= 0) c.rt = c.rtMax;
    return true;
  };

  Hero.prototype.startDash = function (aim, speed, dur, iframes) {
    this.dashDir = aim;
    this.dashSpeed = speed;
    this.dashT = dur;
    this.invuln = Math.max(this.invuln, iframes || 0);
    this.facing = aim;
    SH.audio.play('dash');
  };

  Hero.prototype.reset = function () {
    this.hp = this.maxHp;
    this.surge = 0;
    this.form = 0;
    this.ko = false;
    this.koT = 0;
    this.charge = 0;
    this.invuln = 1;
    this.vx = this.vy = this.vz = 0;
    this.z = 0;
    this.attackT = 0;
    this.dashT = 0;
    this.absorbing = 0;
    this.shieldHp = 0;
    this.flying = false;
    this.status = {};
    for (var k in this.cd) this.cd[k] = 0;
    for (var c in this.ch) { this.ch[c].n = this.ch[c].max; this.ch[c].rt = 0; }
    if (this.kit.onFormEnd) this.kit.onFormEnd(this);
    if (this.kit.init) this.kit.init(this);
  };

  Hero.prototype.startForm = function () {
    if (this.form > 0 || this.ko) return false;
    this.surge = 0;
    this.form = this.formDur;
    this.invuln = Math.max(this.invuln, 0.7);
    FX.ring(this.x, this.y, this.z + 10, 8, 30, this.kit.colors.formGlow, 0.7, 8);
    FX.ring(this.x, this.y, this.z + 10, 8, 260, this.kit.colors.formGlow, 0.9, 5);
    FX.flash(this.x, this.y, this.z + 20, 180, this.kit.colors.formGlow, 0.4);
    FX.burst(this.x, this.y, this.z + 16, { n: 34, color: this.kit.colors.formGlow, speed: 420, size: 6, life: 0.9, grav: -120 });
    FX.shake(14);
    SH.audio.play('form');
    C.aoe(this.x, this.y, 190, 40, { knock: 420, owner: this });
    if (this.kit.onForm) this.kit.onForm(this);
    SH.hud.banner(this.kit.formName, this.kit.colors.formGlow);
    if (navigator.vibrate) { try { navigator.vibrate([30, 40, 60]); } catch (e) {} }
    return true;
  };

  Hero.prototype.endForm = function () {
    this.form = 0;
    this.formInvuln = false;
    this.flying = false;
    FX.ring(this.x, this.y, this.z + 10, 60, 6, this.kit.colors.formGlow, 0.5, 4);
    SH.audio.play('formend');
    if (this.kit.onFormEnd) this.kit.onFormEnd(this);
  };

  Hero.prototype.update = function (dt) {
    var IN = this.in;
    var kit = this.kit;
    this.anim.t += dt;

    for (var k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    for (var c in this.ch) {
      var ch = this.ch[c];
      if (ch.n < ch.max) {
        ch.rt -= dt;
        if (ch.rt <= 0) { ch.n++; if (ch.n < ch.max) ch.rt = ch.rtMax; }
      }
    }
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.attackT > 0) this.attackT -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.anim.swing > 0) this.anim.swing -= dt;

    // statuses
    var slow = 1;
    this.rooted = false;
    if (this.status.slow && this.status.slow.t > 0) {
      this.status.slow.t -= dt;
      slow *= 1 - (this.status.slow.amt || 0.3);
    }
    if (this.status.wither && this.status.wither.t > 0) {
      var w = this.status.wither;
      w.t -= dt;
      w.acc = (w.acc || 0) + dt;
      if (w.acc >= 0.5) {
        w.acc = 0;
        C.hitPlayer(this, (w.dps || 8) * 0.5, { dot: true, fromX: this.x, fromY: this.y });
      }
      slow *= 0.88;
      if (Math.random() < 0.4) {
        FX.particle({
          x: this.x + U.rand(-14, 14), y: this.y + U.rand(-8, 8), z: U.rand(6, 40),
          vz: U.rand(14, 46), life: 0.6, size: U.rand(2.5, 5), color: '#7a4bb0',
          mode: 'smoke', alpha: 0.75, drag: 1.2
        });
      }
    }
    if (this.status.root && this.status.root.t > 0) {
      this.status.root.t -= dt;
      this.rooted = true;
    }

    if (kit.resource && kit.resource.regen) {
      this.charge = Math.min(this.maxCharge, this.charge + kit.resource.regen * dt);
    }

    if (this.form > 0) {
      this.form -= dt;
      if (this.form <= 0) this.endForm();
    }

    if (this.ko) {
      this.koT += dt;
      this.vx *= 1 - 6 * dt; this.vy *= 1 - 6 * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      SH.world.collide(this, this.radius);
      return;
    }

    /* ---- actions ---- */
    if (this.hitstun > 0) this.hitstun -= dt;
    var canAct = this.dashT <= 0 && !this.locked && this.hitstun <= 0;
    if (canAct) {
      if (IN.btns.primary.down && this.cd.primary <= 0 && kit.primary) {
        kit.primary(this, this.getAim('primary', kit.aimRange || 360));
      }
      if (kit.a1) {
        if (IN.btns.a1.pressed && this.cd.a1 <= 0) kit.a1(this, this.getAim('a1', 420));
      }
      if (kit.a1Hold && IN.btns.a1.down) kit.a1Hold(this, dt);
      if (kit.a1End && IN.btns.a1.released) kit.a1End(this);
      if (kit.a2 && IN.btns.a2.pressed && this.cd.a2 <= 0) kit.a2(this, this.getAim('a2', 460));
      if (IN.btns.dash.pressed && this.cd.dash <= 0) {
        if (kit.dash) kit.dash(this, this.getAim('dash', 200));
        else {
          this.startDash(IN.move.len > 0.12 ? Math.atan2(IN.move.y, IN.move.x) : this.facing, 560, 0.26, 0.2);
          this.setCd('dash', 1.1);
        }
      }
      if (kit.extra && IN.btns.extra.pressed && this.cd.extra <= 0) kit.extra(this);
    }

    /* ---- movement ---- */
    var mv = IN.move;
    var maxSp = this.speed * this.speedMul * slow;
    if (this.attackT > 0) maxSp *= this.attackMove;
    var tvx = mv.x * maxSp, tvy = mv.y * maxSp;

    /* side-view fighting plane: one lane, plus jump and guard */
    if (SH.plane === 'side') {
      tvy = 0;
      this.vy = 0;
      this.guard = 0;
      if (this.grounded && this.attackT <= 0 && this.dashT <= 0) {
        if (mv.y < -0.45 || IN.btns.jump.pressed) {
          this.vz = this.jumpPower || 640;
          this.grounded = false;
          SH.audio.play('leap');
          FX.ring(this.x, this.y, 2, 4, 34, this.kit.colors.accent, 0.25, 2);
        } else if (mv.y > 0.5 || IN.btns.guard.down) {
          this.guard = 1;
          tvx *= 0.3;
        }
      }
      if (!this.grounded) tvx *= 0.85;
    }
    if (this.rooted) { tvx = 0; tvy = 0; }

    if (this.dashT > 0) {
      this.dashT -= dt;
      var f = U.clamp(this.dashT / 0.1, 0, 1);
      var ds = this.dashSpeed * (0.55 + 0.45 * f);
      this.vx = Math.cos(this.dashDir) * ds;
      this.vy = Math.sin(this.dashDir) * ds;
      if (this.onDashTick) this.onDashTick(this, dt);
    } else {
      var accel = (this.grounded ? 3200 : 1700) * dt;
      this.vx = U.approach(this.vx, tvx, accel);
      this.vy = U.approach(this.vy, tvy, accel);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    /* ---- vertical ---- */
    if (this.flying) {
      var target = this.flyZ + SH.world.groundHeightAt(this.x, this.y);
      this.z = U.lerp(this.z, target, Math.min(1, dt * 5));
      this.vz = 0;
      this.grounded = false;
    } else {
      this.vz -= GRAV * dt;
      this.z += this.vz * dt;
      var gh = SH.world.groundHeightAt(this.x, this.y);
      if (this.z <= gh) {
        if (!this.grounded) {
          this.grounded = true;
          if (kit.onLand) kit.onLand(this, gh);
          if (this.vz < -420) {
            FX.ring(this.x, this.y, gh + 2, 6, 70, '#ffffff', 0.3, 3);
            SH.audio.play('land');
          }
        }
        this.z = gh;
        this.vz = 0;
      } else {
        this.grounded = false;
      }
    }

    SH.world.collide(this, this.radius);

    /* ---- facing ---- */
    if (SH.plane === 'side') {
      // fighters always square up to their opponent
      this.facing = (this.attackT > 0 && this.attackAim !== undefined) ? this.attackAim : this.getAim('primary', 900);
    } else {
      var want = this.facing;
      if (this.attackT > 0 && this.attackAim !== undefined) want = this.attackAim;
      else if (Math.hypot(this.vx, this.vy) > 25) want = Math.atan2(this.vy, this.vx);
      else if (IN.btns.primary.down) want = this.getAim('primary', 360);
      this.facing = U.angApproach(this.facing, want, dt * 16);
    }

    if (kit.update) kit.update(this, dt);
  };

  /* ================================================================ KITS */
  var KITS = (SH.KITS = []);

  /* ------------------------------------------------------------- SAVIOR */
  var ELEMENTS = ['fire', 'ice', 'lightning'];
  var ELEM_ICON = { fire: '🔥', ice: '❄', lightning: '⚡' };
  KITS.push({
    id: 'savior',
    name: 'SAVIOR',
    title: 'The Crystal Blade',
    role: 'BALANCED / ABSORBER',
    desc: 'Armoured white-and-grey knight with green accents and a crystal sigil. Draws in hostile energy with his field, then converts it into elemental force through a sleek shortsword.',
    tips: 'Hold ABSORB to nullify incoming attacks and bank energy, then spend it with RELEASE. Tap the element chip to cycle fire / ice / lightning.',
    colors: {
      base: '#eef2f7', mid: '#a9b4c2', dark: '#39404d', trim: '#7c8797',
      accent: '#3ef08a', glow: '#7dffb5', formGlow: '#a6ffd0', hair: '#dfe6ef'
    },
    maxHp: 340, speed: 234, radius: 15,
    formName: 'RADIANT ASCENSION', formDur: 15,
    formDesc: 'Ignites, becomes invulnerable — every hit taken is devoured as energy — floats above the battlefield and fires sustained radiant beams.',
    resource: { name: 'ENERGY', color: '#3ef08a', max: 100, regen: 4 },
    abil: {
      primary: { name: 'Crystal Edge', icon: '🗡' },
      a1: { name: 'Absorb', icon: '🛡', hold: true },
      a2: { name: 'Release', icon: '✷' },
      dash: { name: 'Sidestep', icon: '»' },
      extra: { name: 'Element', icon: '🔥' }
    },
    init: function (h) { h.elem = h.elem || 'fire'; },

    primary: function (h, aim) {
      if (h.form > 0) { // beam mode
        h.setCd('primary', 0.09);
        h.attackT = 0.12; h.attackAim = aim; h.attackMove = 0.7;
        h.facing = aim;
        var len = 460, w = 24;
        var ex = h.x + Math.cos(aim) * len, ey = h.y + Math.sin(aim) * len;
        FX.particle({
          x: h.x, y: h.y, z: h.z + 22, life: 0.1, size: len, size1: w, rot: aim,
          color: '#c9ffe6', color2: h.kit.colors.accent, mode: 'beam', drag: 0, glow: true
        });
        lineEnemies(h.x, h.y, aim, len, w, function (e) {
          C.hitEnemy(e, 24 * h.dmgMul, { dir: aim, fromX: h.x, fromY: h.y, elem: 'energy', owner: h, silent: Math.random() > 0.4, knock: 40 });
        });
        if (Math.random() < 0.5) FX.burst(ex, ey, 20, { n: 3, color: '#c9ffe6', speed: 180, size: 3, life: 0.25 });
        SH.audio.voices < 4 && Math.random() < 0.3 && SH.audio.play('zap');
        return;
      }
      var third = h.combo >= 2;
      h.setCd('primary', third ? 0.52 : 0.28);
      h.attackT = third ? 0.34 : 0.2;
      h.attackAim = aim; h.attackMove = 0.4;
      h.facing = aim;
      h.anim.swing = 0.22; h.anim.swingDir = (h.combo % 2) ? -1 : 1;
      var dmg = (third ? 46 : 26) * h.dmgMul;
      var range = third ? 96 : 82;
      var arc = third ? 2.7 : 1.6;
      FX.slash(h.x + Math.cos(aim) * 18, h.y + Math.sin(aim) * 18, h.z + 20, aim, arc, range, third ? h.kit.colors.glow : '#e9fff5', third ? 0.28 : 0.18);
      C.melee(h, { angle: aim, range: range, arc: arc, dmg: dmg, knock: third ? 300 : 90, owner: h });
      SH.audio.play(third ? 'heavy' : 'swing');
      if (third) {
        FX.shake(4);
        // crystal crescent
        SH.spawnProjectile({
          x: h.x + Math.cos(aim) * 24, y: h.y + Math.sin(aim) * 24, z: h.z + 20,
          vx: Math.cos(aim) * 640, vy: Math.sin(aim) * 640, r: 22, dmg: 34 * h.dmgMul,
          team: 'hero', life: 0.7, type: 'crescent', color: h.kit.colors.accent,
          pierce: 4, rot: aim, owner: h, knock: 120, size: 24
        });
      }
      h.combo = third ? 0 : h.combo + 1;
      h.comboT = 0.9;
    },

    a1: function (h) {
      if (h.form > 0) return;
      h.absorbing = 1;
      SH.audio.play('absorb');
      FX.ring(h.x, h.y, h.z + 16, 60, 26, h.kit.colors.accent, 0.35, 3);
    },
    a1Hold: function (h, dt) {
      if (h.form > 0) return;
      h.absorbing = 1;
      h.attackMove = 1;
      h.speedMul = 0.5;
      // swallow enemy projectiles
      var list = SH.ents.projectiles;
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        if (p.team !== 'enemy') continue;
        if (!U.within(p.x, p.y, h.x, h.y, 78)) continue;
        h.charge = Math.min(h.maxCharge, h.charge + p.dmg * 1.4);
        SH.game.addSurge(p.dmg * 0.6);
        FX.burst(p.x, p.y, p.z, { n: 5, color: h.kit.colors.accent, speed: 120, size: 3, life: 0.3 });
        FX.text(h.x, h.y, h.z + 34, '+' + Math.round(p.dmg * 1.4), h.kit.colors.accent, 14);
        list.splice(i, 1);
        SH.audio.play('absorb');
      }
      if (Math.random() < 0.55) {
        var a = Math.random() * U.TAU;
        FX.particle({
          x: h.x + Math.cos(a) * 74, y: h.y + Math.sin(a) * 74, z: h.z + U.rand(4, 34),
          vx: -Math.cos(a) * 150, vy: -Math.sin(a) * 150, life: 0.5, size: 3,
          color: h.kit.colors.accent, glow: true, drag: 0.6
        });
      }
    },
    a1End: function (h) {
      if (h.absorbing) {
        h.absorbing = 0;
        h.speedMul = 1;
        h.setCd('a1', 0.35);
      }
    },

    a2: function (h, aim) {
      var full = h.charge >= 25;
      var mul = (full ? 1 : 0.7) * h.dmgMul;
      if (full) h.charge -= 25;
      h.setCd('a2', 1.3);
      h.attackT = 0.3; h.attackAim = aim; h.attackMove = 0.3;
      h.facing = aim;
      var col = C.elemColor(h.elem);

      if (h.form > 0) { // nova
        FX.ring(h.x, h.y, h.z + 12, 10, 300, h.kit.colors.formGlow, 0.5, 7);
        FX.flash(h.x, h.y, h.z + 20, 220, h.kit.colors.formGlow, 0.35);
        C.aoe(h.x, h.y, 300, 130 * h.dmgMul, { knock: 520, elem: 'energy', owner: h, falloff: true });
        FX.shake(12);
        SH.audio.play('boom');
        h.setCd('a2', 2.2);
        return;
      }

      if (h.elem === 'fire') {
        SH.audio.play('boom');
        for (var i = 0; i < 22; i++) {
          var a = aim + U.rand(-0.5, 0.5);
          var sp = U.rand(220, 460);
          FX.particle({
            x: h.x + Math.cos(aim) * 20, y: h.y + Math.sin(aim) * 20, z: h.z + 18,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(-10, 60),
            life: U.rand(0.3, 0.6), size: U.rand(5, 12), color: '#ff7a2e', color2: '#ffd76a',
            mode: 'flame', drag: 1.6, glow: true
          });
        }
        var hits = 0;
        lineEnemies(h.x, h.y, aim, 200, 54, function (e) {
          if (Math.abs(U.angDiff(aim, U.angTo(h.x, h.y, e.x, e.y))) > 0.75 && U.dist(h.x, h.y, e.x, e.y) > 50) return;
          C.hitEnemy(e, 52 * mul, { dir: aim, fromX: h.x, fromY: h.y, elem: 'fire', owner: h, knock: 130 });
          hits++;
        });
        FX.shake(5);
      } else if (h.elem === 'ice') {
        SH.audio.play('freeze');
        for (var s = 0; s < 5; s++) {
          var sa = aim + (s - 2) * 0.16;
          SH.spawnProjectile({
            x: h.x + Math.cos(sa) * 20, y: h.y + Math.sin(sa) * 20, z: h.z + 20,
            vx: Math.cos(sa) * 700, vy: Math.sin(sa) * 700, r: 11, dmg: 26 * mul,
            team: 'hero', life: 0.8, type: 'shard', color: '#7fe6ff', elem: 'ice',
            pierce: 1, rot: sa, owner: h, knock: 80, size: 15
          });
        }
      } else {
        SH.audio.play('zap');
        var tgt = U.nearestEnemy(h.x, h.y, 380);
        var sx = h.x + Math.cos(aim) * 30, sy = h.y + Math.sin(aim) * 30;
        if (!tgt) {
          var ex = h.x + Math.cos(aim) * 300, ey = h.y + Math.sin(aim) * 300;
          FX.bolt(sx, sy - h.z - 18, ex, ey - 20, '#c9f24a', 0.2, 26);
          lineEnemies(h.x, h.y, aim, 300, 26, function (e) {
            C.hitEnemy(e, 44 * mul, { dir: aim, fromX: h.x, fromY: h.y, elem: 'lightning', owner: h });
          });
        } else {
          FX.bolt(sx, sy - h.z - 18, tgt.x, tgt.y - tgt.h * 0.5, '#c9f24a', 0.2, 24);
          C.hitEnemy(tgt, 46 * mul, { fromX: h.x, fromY: h.y, elem: 'lightning', owner: h });
          C.chain(tgt.x, tgt.y, 40 * mul, { jumps: 4, range: 220, owner: h, z: tgt.h * 0.5 });
        }
      }
      FX.ring(h.x + Math.cos(aim) * 20, h.y + Math.sin(aim) * 20, h.z + 16, 8, 46, col, 0.3, 3);
    },

    dash: function (h, aim) {
      var d = h.in.move.len > 0.12 ? Math.atan2(h.in.move.y, h.in.move.x) : aim;
      h.startDash(d, 620, 0.24, 0.2);
      h.setCd('dash', 1.05);
      for (var i = 0; i < 5; i++) {
        FX.particle({ x: h.x, y: h.y, z: h.z + U.rand(4, 28), life: 0.3, size: 4, color: h.kit.colors.accent, glow: true, drag: 3 });
      }
    },

    extra: function (h) {
      h.elem = ELEMENTS[(ELEMENTS.indexOf(h.elem) + 1) % ELEMENTS.length];
      h.setCd('extra', 0.18);
      SH.audio.play('ui');
      FX.text(h.x, h.y, h.z + 40, h.elem.toUpperCase(), C.elemColor(h.elem), 15);
      SH.hud.refreshButtons();
    },

    update: function (h, dt) {
      if (!h.in.btns.a1.down && h.absorbing) { h.absorbing = 0; h.speedMul = 1; }
      if (h.form > 0) {
        h.charge = Math.min(h.maxCharge, h.charge + 14 * dt);
        if (Math.random() < 0.6) {
          var a = Math.random() * U.TAU;
          FX.particle({
            x: h.x + Math.cos(a) * U.rand(10, 40), y: h.y + Math.sin(a) * U.rand(10, 40), z: h.z + U.rand(0, 40),
            vz: U.rand(30, 90), life: 0.6, size: U.rand(2, 4.5), color: h.kit.colors.formGlow, glow: true, drag: 1
          });
        }
      }
    },

    onForm: function (h) {
      h.formInvuln = true;
      h.flying = true;
      h.flyZ = 62;
      h.speedMul = 1.15;
      h.dmgMul = 1.25;
      h.charge = h.maxCharge;
    },
    onFormEnd: function (h) {
      h.formInvuln = false;
      h.flying = false;
      h.speedMul = 1;
      h.dmgMul = 1;
    }
  });

  /* ------------------------------------------------------------- EXODUS */
  KITS.push({
    id: 'exodus',
    name: 'EXODUS',
    title: 'The Green Streak',
    role: 'SPEEDSTER / SKIRMISHER',
    desc: 'Roguish black tech-weave, sleek goggles and a lower mask, long black hair loose. Fights with twin electric whips and lobs sticking motes of green energy that detonate a beat later.',
    tips: 'Hold BLITZ to phase through crowds at absurd speed, tagging everything you touch. Stick charges onto tough targets, then keep moving.',
    colors: {
      base: '#1a1e27', mid: '#2c3242', dark: '#0b0d12', trim: '#3d4557',
      accent: '#39e05c', glow: '#7cff9e', formGlow: '#8fd8ff', hair: '#0d0d10'
    },
    maxHp: 255, speed: 300, radius: 14,
    formName: 'CRYO OVERDRIVE', formDur: 15,
    formDesc: 'The green burns out to blue — frost trails freeze the ground behind him and every charge detonates into a flash-freeze.',
    resource: { name: 'BOOST', color: '#39e05c', max: 100, regen: 20 },
    abil: {
      primary: { name: 'Whip Lash', icon: '⟿' },
      a1: { name: 'Blitz', icon: '💨', hold: true },
      a2: { name: 'Charge', icon: '●' },
      dash: { name: 'Blink Step', icon: '»' },
      extra: null
    },
    init: function (h) {
      h.mkCharges('a2', 3, 2.3);
      h.charge = 100;
      h.whipSide = 1;
      h.blitz = 0;
      h.hitCds = h.hitCds || [];
    },

    primary: function (h, aim) {
      h.setCd('primary', 0.19);
      h.attackT = 0.16; h.attackAim = aim; h.attackMove = 0.72;
      h.facing = aim;
      h.whipSide *= -1;
      h.anim.swing = 0.16; h.anim.swingDir = h.whipSide;
      var frost = h.form > 0;
      var col = frost ? '#8fd8ff' : h.kit.colors.accent;
      var range = 124, arc = 1.75;
      var off = aim + h.whipSide * 0.32;
      FX.slash(h.x, h.y, h.z + 20, off, arc, range, col, 0.15);
      FX.bolt(
        h.x + Math.cos(off) * 18, h.y + Math.sin(off) * 18 - h.z - 18,
        h.x + Math.cos(off) * range, h.y + Math.sin(off) * range - 18,
        col, 0.12, 10
      );
      var hit = C.melee(h, {
        angle: off, range: range, arc: arc, dmg: 17 * h.dmgMul, knock: 70,
        elem: frost ? 'ice' : 'lightning', maxTargets: 3, owner: h
      });
      if (hit) {
        var t = U.nearestEnemy(h.x, h.y, 200, function (e) { return e !== h; });
        if (t) C.chain(t.x, t.y, 8 * h.dmgMul, { jumps: 1, range: 170, owner: h, color: col, elem: frost ? 'ice' : 'lightning' });
      }
      SH.audio.play('swing');
    },

    a1: function (h) {
      if (h.charge < 12) return;
      h.blitz = 1;
      SH.audio.play('dash');
      FX.ring(h.x, h.y, h.z + 12, 6, 60, h.form > 0 ? '#8fd8ff' : h.kit.colors.accent, 0.3, 3);
    },
    a1Hold: function (h, dt) {
      var cost = (h.form > 0 ? 20 : 32) * dt;
      if (h.charge <= 0) { h.blitz = 0; h.speedMul = 1; return; }
      h.charge = Math.max(0, h.charge - cost);
      h.blitz = 1;
      h.speedMul = h.form > 0 ? 2.75 : 2.35;
      h.invuln = Math.max(h.invuln, 0.05);

      var col = h.form > 0 ? '#8fd8ff' : h.kit.colors.accent;
      h.trailT -= dt;
      if (h.trailT <= 0) {
        h.trailT = 0.035;
        FX.after(h, 0.3, col);
        FX.particle({
          x: h.x + U.rand(-8, 8), y: h.y + U.rand(-8, 8), z: h.z + U.rand(4, 30),
          vz: U.rand(6, 30), life: U.rand(0.35, 0.7), size: U.rand(5, 11),
          color: col, mode: 'smoke', drag: 1.1, alpha: 0.5, glow: true
        });
        if (h.form > 0) {
          SH.spawnHazard({
            x: h.x, y: h.y, r: 46, life: 2.6, team: 'hero', kind: 'frost',
            color: '#8fd8ff', slow: 0.5, dps: 12, elem: 'ice', tick: 0.35, owner: h
          });
        }
      }
      // phase damage
      var cands = SH.grid.query(h.x, h.y, 46, lbuf);
      for (var i = 0; i < cands.length; i++) {
        var e = cands[i];
        if (e.dead) continue;
        if (!U.within(h.x, h.y, e.x, e.y, e.r + 24)) continue;
        if (e._blitzT > 0) continue;
        e._blitzT = 0.4;
        C.hitEnemy(e, 20 * h.dmgMul, {
          dir: Math.atan2(h.vy, h.vx), knock: 200, elem: h.form > 0 ? 'ice' : 'lightning',
          fromX: h.x, fromY: h.y, owner: h
        });
        FX.shake(2);
      }
    },
    a1End: function (h) { h.blitz = 0; h.speedMul = 1; },

    a2: function (h, aim) {
      if (!h.useCharge('a2')) { h.setCd('a2', 0.5); FX.text(h.x, h.y, h.z + 36, 'NO CHARGE', '#888', 12); return; }
      h.setCd('a2', 0.28);
      h.attackT = 0.16; h.attackAim = aim; h.attackMove = 0.85;
      var frost = h.form > 0;
      var col = frost ? '#8fd8ff' : h.kit.colors.accent;
      SH.audio.play('shoot');
      SH.spawnProjectile({
        x: h.x + Math.cos(aim) * 18, y: h.y + Math.sin(aim) * 18, z: h.z + 26,
        vx: Math.cos(aim) * 620, vy: Math.sin(aim) * 620, vz: 130, grav: 620,
        r: 12, dmg: 0, team: 'hero', life: 3, type: 'mote', color: col,
        sticky: true, fuse: frost ? 0.9 : 1.15, size: 11, owner: h, spin: 6,
        onExpire: function (p) {
          var dmg = (frost ? 62 : 74) * h.dmgMul;
          FX.flash(p.x, p.y, p.z, 110, col, 0.3);
          FX.ring(p.x, p.y, p.z, 8, 100, col, 0.4, 4);
          FX.burst(p.x, p.y, p.z, { n: 18, color: col, speed: 340, size: 5, life: 0.5, mode: frost ? 'shard' : 'dot' });
          C.aoe(p.x, p.y, 100, dmg, { knock: 260, elem: frost ? 'frost' : 'lightning', owner: h, falloff: true });
          if (!frost) C.chain(p.x, p.y, 24 * h.dmgMul, { jumps: 3, range: 190, owner: h });
          SH.audio.play(frost ? 'freeze' : 'boom');
          FX.shake(6);
        }
      });
    },

    dash: function (h, aim) {
      var d = h.in.move.len > 0.12 ? Math.atan2(h.in.move.y, h.in.move.x) : aim;
      h.startDash(d, 980, 0.17, 0.17);
      h.setCd('dash', 0.7);
      FX.after(h, 0.3, h.form > 0 ? '#8fd8ff' : h.kit.colors.accent);
    },

    update: function (h, dt) {
      if (h._t === undefined) h._t = 0;
      h._t += dt;
      if (!h.in.btns.a1.down && h.blitz) { h.blitz = 0; h.speedMul = 1; }
      var moving = Math.hypot(h.vx, h.vy) > 120;
      if (moving && !h.blitz) {
        h.trailT -= dt;
        if (h.trailT <= 0) {
          h.trailT = 0.07;
          var col = h.form > 0 ? '#8fd8ff' : h.kit.colors.accent;
          FX.particle({
            x: h.x + U.rand(-6, 6), y: h.y + U.rand(-6, 6), z: h.z + U.rand(2, 26),
            vz: U.rand(4, 22), life: U.rand(0.3, 0.55), size: U.rand(4, 8),
            color: col, mode: 'smoke', drag: 1.3, alpha: 0.35, glow: true
          });
        }
      }
    },

    onForm: function (h) {
      h.dmgMul = 1.3;
      h.ch.a2.max = 4; h.ch.a2.n = 4; h.ch.a2.rtMax = 1.5;
      h.charge = h.maxCharge;
      h.kit.resource.regen = 34;
    },
    onFormEnd: function (h) {
      h.dmgMul = 1;
      h.ch.a2.max = 3; h.ch.a2.n = Math.min(h.ch.a2.n, 3); h.ch.a2.rtMax = 2.3;
      h.kit.resource.regen = 20;
      h.speedMul = 1;
    }
  });

  /* ------------------------------------------------------------ PARAGON */
  KITS.push({
    id: 'paragon',
    name: 'PARAGON',
    title: 'The Gilded Fist',
    role: 'BRUISER / AERIAL',
    desc: 'Blue-and-gold plate over an open face, short blond hair, a simple domino mask. Swings a war hammer that lands like a dropped building; something older and brighter answers when he hits hard enough.',
    tips: 'LEAP high, hold it to glide, and land on a crowd — the slam scales with how far you fell. You can perch on rooftops.',
    colors: {
      base: '#2f6fe0', mid: '#1d4a9e', dark: '#12305f', trim: '#7fb0ff',
      accent: '#ffd76a', glow: '#ffe9a8', formGlow: '#fff0bd', hair: '#f2d98b'
    },
    maxHp: 420, speed: 212, radius: 17,
    formName: 'ASCENDED HOST', formDur: 16,
    formDesc: 'Wings of gold light unfurl — true flight, and the war hammer reforms into a radiant spear.',
    resource: null,
    abil: {
      primary: { name: 'Hammer', icon: '🔨' },
      a1: { name: 'Leap / Glide', icon: '⤒', hold: true },
      a2: { name: 'Judgment', icon: '✦' },
      dash: { name: 'Shoulder', icon: '»' },
      extra: null
    },
    init: function (h) { h.gliding = 0; h.leapT = 0; },

    primary: function (h, aim) {
      if (h.form > 0) { // spear thrusts
        h.setCd('primary', 0.24);
        h.attackT = 0.18; h.attackAim = aim; h.attackMove = 0.7;
        h.facing = aim;
        h.anim.swing = 0.16; h.anim.swingDir = 0;
        FX.slash(h.x + Math.cos(aim) * 30, h.y + Math.sin(aim) * 30, h.z + 20, aim, 0.7, 140, h.kit.colors.formGlow, 0.16);
        C.melee(h, { angle: aim, range: 140, arc: 0.8, dmg: 52 * h.dmgMul, knock: 200, elem: 'gold', owner: h });
        SH.audio.play('swing');
        return;
      }
      var third = h.combo >= 2;
      h.setCd('primary', third ? 0.62 : 0.4);
      h.attackT = third ? 0.42 : 0.28;
      h.attackAim = aim; h.attackMove = 0.24;
      h.facing = aim;
      h.anim.swing = third ? 0.3 : 0.24; h.anim.swingDir = (h.combo % 2) ? -1 : 1;
      var dmg = (third ? 78 : 42) * h.dmgMul;
      var range = third ? 118 : 96;
      var arc = third ? 2.9 : 1.9;
      FX.slash(h.x + Math.cos(aim) * 16, h.y + Math.sin(aim) * 16, h.z + 18, aim, arc, range, third ? h.kit.colors.accent : '#cfe4ff', third ? 0.3 : 0.2);
      C.melee(h, { angle: aim, range: range, arc: arc, dmg: dmg, knock: third ? 460 : 210, elem: third ? 'gold' : null, owner: h });
      SH.audio.play('heavy');
      if (third) {
        FX.shake(7);
        FX.ring(h.x + Math.cos(aim) * 40, h.y + Math.sin(aim) * 40, h.z + 4, 8, 150, h.kit.colors.accent, 0.4, 5);
        C.aoe(h.x + Math.cos(aim) * 40, h.y + Math.sin(aim) * 40, 140, 34 * h.dmgMul, { knock: 320, elem: 'gold', owner: h, silent: true });
        for (var i = 0; i < 12; i++) {
          var a = aim + U.rand(-1.2, 1.2);
          FX.particle({
            x: h.x + Math.cos(aim) * 34, y: h.y + Math.sin(aim) * 34, z: h.z + 8,
            vx: Math.cos(a) * U.rand(120, 340), vy: Math.sin(a) * U.rand(120, 340), vz: U.rand(40, 160),
            life: U.rand(0.4, 0.8), size: U.rand(5, 11), color: h.kit.colors.accent, color2: '#fff',
            mode: 'feather', drag: 1.4, glow: true, spin: U.rand(-5, 5)
          });
        }
      }
      h.combo = third ? 0 : h.combo + 1;
      h.comboT = 1.1;
    },

    a1: function (h, aim) {
      if (h.form > 0) { // dive bomb
        if (h.z > 40) {
          h.flying = false;
          h.vz = -1500;
          h.diving = true;
          h.setCd('a1', 1.4);
          SH.audio.play('leap');
          return;
        }
        h.flyZ = 150;
        h.flying = true;
        h.setCd('a1', 0.6);
        return;
      }
      if (!h.grounded) return;
      var d = h.in.move.len > 0.12 ? Math.atan2(h.in.move.y, h.in.move.x) : aim;
      h.vz = 700;
      h.grounded = false;
      h.leapT = 1;
      var boost = 330;
      h.vx += Math.cos(d) * boost;
      h.vy += Math.sin(d) * boost;
      h.setCd('a1', 2.6);
      SH.audio.play('leap');
      FX.ring(h.x, h.y, 4, 8, 90, h.kit.colors.accent, 0.4, 4);
      FX.burst(h.x, h.y, 6, { n: 12, color: h.kit.colors.accent, speed: 240, size: 4, life: 0.45 });
      FX.shake(3);
    },
    a1Hold: function (h, dt) {
      if (h.form > 0) return;
      if (!h.grounded && h.vz < 0) {
        h.gliding = 1;
        h.vz = Math.max(h.vz, -62);
        // air control
        var mv = h.in.move;
        if (mv.len > 0.1) {
          h.vx = U.approach(h.vx, mv.x * h.speed * 1.5, 900 * dt);
          h.vy = U.approach(h.vy, mv.y * h.speed * 1.5, 900 * dt);
        }
        if (Math.random() < 0.5) {
          FX.particle({
            x: h.x + U.rand(-16, 16), y: h.y + U.rand(-16, 16), z: h.z,
            vz: -30, life: 0.4, size: U.rand(3, 6), color: h.kit.colors.accent,
            mode: 'feather', glow: true, drag: 1.6, spin: U.rand(-4, 4)
          });
        }
      }
    },
    a1End: function (h) { h.gliding = 0; },

    onLand: function (h, gh) {
      var power = h.gliding ? 0.5 : 1;
      if (h.leapT > 0 || h.diving) {
        var dmg = (h.diving ? 190 : 95) * power * h.dmgMul;
        var r = h.diving ? 210 : 155;
        FX.ring(h.x, h.y, gh + 3, 10, r, h.kit.colors.accent, 0.5, 6);
        FX.flash(h.x, h.y, gh + 8, r * 0.7, h.kit.colors.glow, 0.3);
        FX.burst(h.x, h.y, gh + 6, { n: 22, color: h.kit.colors.accent, speed: 400, size: 6, life: 0.6, mode: 'feather' });
        C.aoe(h.x, h.y, r, dmg, { knock: 520, elem: 'gold', owner: h, falloff: true });
        FX.shake(h.diving ? 16 : 9);
        SH.audio.play('land');
        h.leapT = 0;
        if (h.diving) { h.diving = false; h.flying = h.form > 0; h.flyZ = 95; }
      }
      h.gliding = 0;
    },

    a2: function (h, aim) {
      h.setCd('a2', h.form > 0 ? 2.6 : 4.2);
      h.attackT = 0.4; h.attackAim = aim; h.attackMove = 0.2;
      h.facing = aim;
      h.anim.swing = 0.34; h.anim.swingDir = 1;
      SH.audio.play('heavy');
      FX.shake(9);

      if (h.form > 0) { // thrown spear of light
        SH.spawnProjectile({
          x: h.x + Math.cos(aim) * 26, y: h.y + Math.sin(aim) * 26, z: h.z + 22,
          vx: Math.cos(aim) * 940, vy: Math.sin(aim) * 940, r: 16, dmg: 150 * h.dmgMul,
          team: 'hero', life: 1.1, type: 'spear', color: h.kit.colors.formGlow,
          pierce: 99, rot: aim, owner: h, knock: 300, elem: 'gold', size: 34, trailEvery: 0.02
        });
        return;
      }
      // radiant shockwave cone
      var cx = h.x + Math.cos(aim) * 30, cy = h.y + Math.sin(aim) * 30;
      FX.slash(cx, cy, h.z + 14, aim, 1.4, 250, h.kit.colors.accent, 0.4);
      for (var i = 0; i < 26; i++) {
        var a = aim + U.rand(-0.7, 0.7);
        var sp = U.rand(260, 620);
        FX.particle({
          x: cx, y: cy, z: h.z + U.rand(2, 26), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(10, 90),
          life: U.rand(0.35, 0.7), size: U.rand(5, 13), color: h.kit.colors.accent, color2: '#ffffff',
          mode: 'feather', drag: 1.5, glow: true, spin: U.rand(-6, 6), rot: a
        });
      }
      var hitAny = 0;
      lineEnemies(h.x, h.y, aim, 250, 70, function (e) {
        var da = Math.abs(U.angDiff(aim, U.angTo(h.x, h.y, e.x, e.y)));
        if (da > 0.85 && U.dist(h.x, h.y, e.x, e.y) > 60) return;
        C.hitEnemy(e, 120 * h.dmgMul, { dir: aim, fromX: h.x, fromY: h.y, knock: 480, elem: 'gold', owner: h });
        hitAny++;
      });
      FX.ring(cx, cy, h.z + 6, 12, 210, h.kit.colors.glow, 0.45, 5);
    },

    dash: function (h, aim) {
      var d = h.in.move.len > 0.12 ? Math.atan2(h.in.move.y, h.in.move.x) : aim;
      h.startDash(d, 620, 0.3, 0.24);
      h.setCd('dash', 1.6);
      h.onDashTick = function (hh, dt) {
        var cands = SH.grid.query(hh.x, hh.y, 44, lbuf);
        for (var i = 0; i < cands.length; i++) {
          var e = cands[i];
          if (e.dead || e._blitzT > 0) continue;
          if (!U.within(hh.x, hh.y, e.x, e.y, e.r + 24)) continue;
          e._blitzT = 0.5;
          C.hitEnemy(e, 40 * hh.dmgMul, { dir: d, knock: 420, fromX: hh.x, fromY: hh.y, owner: hh });
          FX.shake(3);
        }
      };
    },

    update: function (h, dt) {
      if (h.form > 0) {
        h.anim.wing = Math.min(1, h.anim.wing + dt * 3);
        if (Math.random() < 0.4) {
          FX.particle({
            x: h.x + U.rand(-22, 22), y: h.y + U.rand(-16, 16), z: h.z + U.rand(6, 40),
            vz: U.rand(-30, -6), life: 0.6, size: U.rand(3, 7), color: h.kit.colors.formGlow,
            mode: 'feather', glow: true, drag: 1.4, spin: U.rand(-3, 3)
          });
        }
      } else if (h.anim.wing > 0) {
        h.anim.wing = Math.max(0, h.anim.wing - dt * 3);
      }
      if (h.leapT > 0 && !h.grounded) {
        if (Math.random() < 0.35) {
          FX.particle({ x: h.x, y: h.y, z: h.z, life: 0.35, size: 4, color: h.kit.colors.accent, glow: true, drag: 2 });
        }
      }
    },

    onForm: function (h) {
      h.flying = true;
      h.flyZ = 95;
      h.dmgMul = 1.35;
      h.speedMul = 1.2;
      h.dmgTakenMult = 0.75;
      h.anim.wing = 0;
    },
    onFormEnd: function (h) {
      h.flying = false;
      h.diving = false;
      h.dmgMul = 1;
      h.speedMul = 1;
      h.dmgTakenMult = 1;
    }
  });

  /* ------------------------------------------------------------ DOMINUS */
  KITS.push({
    id: 'dominus',
    name: 'DOMINUS',
    title: 'The Hollow Hood',
    role: 'ASSASSIN / CONTROL',
    desc: 'Tight black weave, a long cape and a hood that swallows his face entirely — no eyes, no chin, nothing. Steps through shadow and pulls weapons out of it. People mistake him for the villain.',
    tips: 'UMBRAL STEP has two charges and leaves a decoy that detonates. Strike enemies from behind for heavy bonus damage.',
    colors: {
      base: '#221c36', mid: '#342a4e', dark: '#13101d', trim: '#4a3d6e',
      accent: '#8b5cf6', glow: '#b794ff', formGlow: '#4d84ff', hair: '#000000'
    },
    maxHp: 275, speed: 248, radius: 14,
    formName: 'TEMPEST OF THE VOID', formDur: 15,
    formDesc: 'The violet burns to deep blue. A storm answers to him — lightning follows every step and every strike.',
    resource: null,
    abil: {
      primary: { name: 'Shadow Blades', icon: '🗡' },
      a1: { name: 'Umbral Step', icon: '◈' },
      a2: { name: 'Shadow Armory', icon: '⚔' },
      dash: { name: 'Slip', icon: '»' },
      extra: null
    },
    init: function (h) {
      h.mkCharges('a1', 2, 2.8);
      h.orbiters = [];
      h.storm = null;
    },

    primary: function (h, aim) {
      h.setCd('primary', 0.21);
      h.attackT = 0.16; h.attackAim = aim; h.attackMove = 0.65;
      h.facing = aim;
      h.anim.swing = 0.15; h.anim.swingDir = (h.combo % 2) ? -1 : 1;
      h.combo++;
      var storm = h.form > 0;
      var col = storm ? h.kit.colors.formGlow : h.kit.colors.accent;
      FX.slash(h.x + Math.cos(aim) * 12, h.y + Math.sin(aim) * 12, h.z + 20, aim, 1.7, 86, col, 0.16);
      var self = h;
      C.melee(h, {
        angle: aim, range: 86, arc: 1.7, dmg: 24 * h.dmgMul, knock: 90,
        elem: storm ? 'lightning' : 'shadow', maxTargets: 3, owner: h,
        onHit: function (e) {
          if (isBehind(self, e)) {
            C.hitEnemy(e, 26 * self.dmgMul, { fromX: self.x, fromY: self.y, dir: aim, owner: self, crit: true });
            FX.text(e.x, e.y, e.h + 14, 'BACKSTAB', '#b794ff', 14);
          }
          if (storm && Math.random() < 0.45) C.chain(e.x, e.y, 18 * self.dmgMul, { jumps: 2, range: 190, owner: self, color: self.kit.colors.formGlow });
        }
      });
      SH.audio.play('swing');
    },

    a1: function (h, aim) {
      if (!h.useCharge('a1')) { h.setCd('a1', 0.5); FX.text(h.x, h.y, h.z + 36, 'NO CHARGE', '#888', 12); return; }
      h.setCd('a1', 0.28);
      var dist = 270;
      var sx = h.x, sy = h.y;
      var tx = h.x + Math.cos(aim) * dist, ty = h.y + Math.sin(aim) * dist;
      // step back out of walls
      var probe = { x: tx, y: ty, z: h.z };
      SH.world.collide(probe, h.radius + 2);
      h.x = probe.x; h.y = probe.y;
      h.invuln = Math.max(h.invuln, 0.3);
      h.facing = aim;
      SH.audio.play('blink');

      var col = h.form > 0 ? h.kit.colors.formGlow : h.kit.colors.accent;
      FX.ring(sx, sy, h.z + 12, 4, 54, col, 0.4, 3);
      FX.ring(h.x, h.y, h.z + 12, 54, 4, col, 0.4, 3);
      FX.burst(sx, sy, h.z + 16, { n: 14, color: col, speed: 220, size: 5, life: 0.45, mode: 'smoke' });
      for (var i = 0; i < 6; i++) {
        var t = i / 5;
        FX.particle({
          x: U.lerp(sx, h.x, t), y: U.lerp(sy, h.y, t), z: h.z + 18, life: 0.3,
          size: 12, color: col, mode: 'smoke', alpha: 0.5, glow: true, drag: 2
        });
      }
      // decoy
      var decoyX = sx, decoyY = sy;
      var self = h;
      SH.spawnHazard({
        x: decoyX, y: decoyY, r: 110, life: 0.9, delay: 0.9, team: 'hero', kind: 'decoy',
        color: col, dmg: 60 * h.dmgMul, knock: 300, elem: h.form > 0 ? 'lightning' : 'shadow', owner: h,
        onResolve: function (hz) {
          FX.burst(hz.x, hz.y, 14, { n: 18, color: col, speed: 300, size: 6, life: 0.5, mode: 'smoke' });
          SH.audio.play('boom');
          if (self.form > 0) {
            FX.bolt(hz.x, hz.y - 420, hz.x, hz.y, self.kit.colors.formGlow, 0.22, 12);
            C.aoe(hz.x, hz.y, 130, 60 * self.dmgMul, { elem: 'lightning', owner: self, knock: 200 });
          }
        }
      });
      if (h.form > 0) {
        FX.bolt(h.x, h.y - 400, h.x, h.y - h.z, h.kit.colors.formGlow, 0.2, 14);
        C.aoe(h.x, h.y, 120, 50 * h.dmgMul, { elem: 'lightning', owner: h, knock: 200 });
      }
    },

    a2: function (h, aim) {
      if (h.orbiters.length > 0) {
        // fire everything at once
        var n = h.orbiters.length;
        for (var i = 0; i < n; i++) fireBlade(h, h.orbiters[i], aim);
        h.orbiters.length = 0;
        h.setCd('a2', 6.5);
        return;
      }
      h.setCd('a2', 8);
      var count = h.form > 0 ? 8 : 5;
      for (var j = 0; j < count; j++) {
        h.orbiters.push({ a: (j / count) * U.TAU, t: 0, fireT: 0.5 + j * 0.5, r: 46 });
      }
      SH.audio.play('blink');
      FX.ring(h.x, h.y, h.z + 20, 10, 70, h.form > 0 ? h.kit.colors.formGlow : h.kit.colors.accent, 0.4, 3);
    },

    dash: function (h, aim) {
      var d = h.in.move.len > 0.12 ? Math.atan2(h.in.move.y, h.in.move.x) : aim;
      h.startDash(d, 660, 0.22, 0.22);
      h.setCd('dash', 1.15);
      FX.after(h, 0.3, h.kit.colors.accent);
    },

    update: function (h, dt) {
      var col = h.form > 0 ? h.kit.colors.formGlow : h.kit.colors.accent;
      // orbiting blades
      for (var i = h.orbiters.length - 1; i >= 0; i--) {
        var o = h.orbiters[i];
        o.a += dt * 2.6;
        o.t += dt;
        o.fireT -= dt;
        if (o.fireT <= 0) {
          var t = U.nearestEnemy(h.x, h.y, 460);
          if (t) {
            fireBlade(h, o, U.angTo(h.x, h.y, t.x, t.y));
            h.orbiters.splice(i, 1);
            continue;
          } else {
            o.fireT = 0.4;
          }
        }
        if (o.t > 9) h.orbiters.splice(i, 1);
      }
      if (h.form > 0) {
        if (Math.random() < 0.5) {
          var a = Math.random() * U.TAU;
          FX.particle({
            x: h.x + Math.cos(a) * U.rand(14, 40), y: h.y + Math.sin(a) * U.rand(14, 40), z: h.z + U.rand(0, 34),
            vz: U.rand(20, 60), life: 0.5, size: U.rand(3, 6), color: col, mode: 'smoke', glow: true, drag: 1.2, alpha: 0.6
          });
        }
      }
    },

    onForm: function (h) {
      h.dmgMul = 1.3;
      h.speedMul = 1.12;
      h.ch.a1.max = 3; h.ch.a1.n = 3; h.ch.a1.rtMax = 1.9;
      // personal storm
      var self = h;
      h.storm = SH.spawnHazard({
        x: h.x, y: h.y, r: 260, life: h.formDur, team: 'hero', kind: 'storm',
        color: h.kit.colors.formGlow, follow: h, tick: 0.55, owner: h,
        onTick: function (hz) {
          var t = U.nearestEnemy(hz.x, hz.y, hz.r, function (e) { return e !== self && Math.random() < 0.85; });
          if (!t) return;
          FX.bolt(t.x + U.rand(-40, 40), t.y - 520, t.x, t.y - t.h * 0.5, self.kit.colors.formGlow, 0.22, 20);
          FX.flash(t.x, t.y, t.h * 0.5, 60, self.kit.colors.formGlow, 0.2);
          C.hitEnemy(t, 58 * self.dmgMul, { fromX: t.x, fromY: t.y - 100, elem: 'lightning', owner: self, knock: 120 });
          C.chain(t.x, t.y, 26 * self.dmgMul, { jumps: 2, range: 170, owner: self, color: self.kit.colors.formGlow });
          SH.audio.play('zap');
        }
      });
    },
    onFormEnd: function (h) {
      h.dmgMul = 1;
      h.speedMul = 1;
      h.ch.a1.max = 2; h.ch.a1.n = Math.min(h.ch.a1.n, 2); h.ch.a1.rtMax = 2.8;
      if (h.storm) { h.storm.life = 0; h.storm = null; }
    }
  });

  function fireBlade(h, o, aim) {
    var col = h.form > 0 ? h.kit.colors.formGlow : h.kit.colors.accent;
    var bx = h.x + Math.cos(o.a) * o.r, by = h.y + Math.sin(o.a) * o.r;
    SH.spawnProjectile({
      x: bx, y: by, z: h.z + 28,
      vx: Math.cos(aim) * 780, vy: Math.sin(aim) * 780,
      r: 12, dmg: 46 * h.dmgMul, team: 'hero', life: 1.2, type: 'blade',
      color: col, pierce: 1, rot: aim, owner: h, knock: 120,
      elem: h.form > 0 ? 'lightning' : 'shadow', homing: 3.2, size: 24, trailEvery: 0.02
    });
    SH.audio.play('shoot');
  }

  /* ----------------------------------------------------------- VITALITY */
  KITS.push({
    id: 'vitality',
    name: 'VITALITY',
    title: 'The Amber Warden',
    role: 'SUPPORT / SUSTAIN',
    desc: 'Face-plate mask, long brown hair, and amber that answers her like living glass — she freezes it into spires, blades and walls, and knits herself back together while she does it.',
    tips: 'Her strikes leech life. Drop MEND fields to hold ground and wall enemies off with SPIRES. Her form outlasts everyone else’s.',
    colors: {
      base: '#2a2430', mid: '#4a3a2a', dark: '#14101a', trim: '#6b5540',
      accent: '#ffb43a', glow: '#ffd899', formGlow: '#ffe6b0', hair: '#6b4326'
    },
    maxHp: 305, speed: 230, radius: 15,
    formName: 'AMBER ETERNAL', formDur: 26,
    formDesc: 'Amber floods her — enormous regeneration, hardened skin and constructs that will not break. Lasts far longer than any other form.',
    resource: null,
    abil: {
      primary: { name: 'Amber Shards', icon: '❖' },
      a1: { name: 'Spires', icon: '⛰' },
      a2: { name: 'Mend', icon: '✚' },
      dash: { name: 'Glide Step', icon: '»' },
      extra: null
    },
    init: function (h) {},

    primary: function (h, aim) {
      h.setCd('primary', 0.26);
      h.attackT = 0.18; h.attackAim = aim; h.attackMove = 0.6;
      h.facing = aim;
      h.anim.swing = 0.14;
      var shards = h.form > 0 ? 3 : 1;
      for (var i = 0; i < shards; i++) {
        var a = aim + (shards > 1 ? (i - 1) * 0.13 : 0);
        SH.spawnProjectile({
          x: h.x + Math.cos(a) * 20, y: h.y + Math.sin(a) * 20, z: h.z + 24,
          vx: Math.cos(a) * 760, vy: Math.sin(a) * 760, r: 11,
          dmg: (h.form > 0 ? 26 : 30) * h.dmgMul, team: 'hero', life: 0.75,
          type: 'shard', color: h.kit.colors.accent, elem: 'amber', rot: a,
          owner: h, knock: 70, size: 16, pierce: h.form > 0 ? 1 : 0
        });
      }
      SH.audio.play('shoot');
      FX.burst(h.x + Math.cos(aim) * 22, h.y + Math.sin(aim) * 22, h.z + 22,
        { n: 3, color: h.kit.colors.accent, speed: 120, size: 3, life: 0.25, dir: aim, spread: 0.9 });
    },

    a1: function (h, aim) {
      h.setCd('a1', h.form > 0 ? 4.2 : 6);
      h.attackT = 0.28; h.attackAim = aim; h.attackMove = 0.3;
      h.facing = aim;
      var n = h.form > 0 ? 6 : 4;
      var big = h.form > 0;
      SH.audio.play('freeze');
      FX.shake(4);
      for (var i = 0; i < n; i++) {
        var t = (i - (n - 1) / 2) * 0.34;
        var a = aim + t;
        var d = 86 + Math.abs(t) * 26;
        var sx = h.x + Math.cos(a) * d, sy = h.y + Math.sin(a) * d;
        (function (sx, sy) {
          SH.spawnStructure({
            x: sx, y: sy, r: big ? 30 : 24, ht: big ? 74 : 58, hp: big ? 160 : 90,
            life: big ? 12 : 8, color: '#ffb43a', touchDmg: big ? 26 : 18, owner: h
          });
          FX.ring(sx, sy, 4, 4, big ? 60 : 46, '#ffb43a', 0.35, 4);
          FX.burst(sx, sy, 8, { n: 8, color: '#ffb43a', speed: 200, size: 5, life: 0.45, mode: 'shard', grav: 260 });
          C.aoe(sx, sy, big ? 62 : 50, (big ? 70 : 50) * h.dmgMul, { knock: 300, elem: 'amber', owner: h });
        })(sx, sy);
      }
    },

    a2: function (h) {
      h.setCd('a2', h.form > 0 ? 5 : 9);
      C.healHero(h, h.maxHp * (h.form > 0 ? 0.34 : 0.22));
      h.shieldHp = Math.max(h.shieldHp, h.maxHp * (h.form > 0 ? 0.3 : 0.16));
      SH.audio.play('heal');
      FX.ring(h.x, h.y, h.z + 10, 10, 150, '#ffd899', 0.5, 5);
      FX.burst(h.x, h.y, h.z + 12, { n: 20, color: '#ffd899', speed: 220, size: 5, life: 0.8, grav: -140 });
      SH.spawnHazard({
        x: h.x, y: h.y, r: 150, life: h.form > 0 ? 14 : 9, team: 'hero', kind: 'heal',
        color: '#ffd899', heal: h.maxHp * 0.055, tick: 0.4, owner: h,
        data: { benchBoost: true }
      });
      SH.game.healBench(h.maxHp * 0.12);
    },

    dash: function (h, aim) {
      var d = h.in.move.len > 0.12 ? Math.atan2(h.in.move.y, h.in.move.x) : aim;
      h.startDash(d, 600, 0.26, 0.22);
      h.setCd('dash', 1.05);
      for (var i = 0; i < 6; i++) {
        FX.particle({
          x: h.x, y: h.y, z: h.z + U.rand(4, 30), vx: -Math.cos(d) * U.rand(40, 130), vy: -Math.sin(d) * U.rand(40, 130),
          life: 0.4, size: U.rand(3, 6), color: '#ffb43a', glow: true, drag: 2, mode: 'shard'
        });
      }
    },

    update: function (h, dt) {
      if (h.form > 0) {
        C.healHero(h, h.maxHp * 0.042 * dt, true);
        if (Math.random() < 0.5) {
          var a = Math.random() * U.TAU;
          FX.particle({
            x: h.x + Math.cos(a) * U.rand(16, 42), y: h.y + Math.sin(a) * U.rand(16, 42), z: h.z + U.rand(2, 42),
            vz: U.rand(10, 40), life: 0.6, size: U.rand(3, 6), color: '#ffd899',
            mode: 'shard', glow: true, drag: 1.2, spin: U.rand(-4, 4)
          });
        }
      } else {
        // gentle out-of-combat regeneration
        if (SH.game.time - h.lastHitAt > 5) C.healHero(h, h.maxHp * 0.02 * dt, true);
      }
      if (h.shieldHp > 0) h.shieldHp = Math.max(0, h.shieldHp - dt * (h.form > 0 ? 0 : 3));
    },

    onForm: function (h) {
      h.dmgMul = 1.25;
      h.dmgTakenMult = 0.55;
      h.speedMul = 1.1;
      h.shieldHp = h.maxHp * 0.3;
      var self = h;
      h.formField = SH.spawnHazard({
        x: h.x, y: h.y, r: 190, life: h.formDur, team: 'hero', kind: 'heal',
        color: '#ffd899', heal: h.maxHp * 0.03, tick: 0.5, follow: h, owner: h
      });
    },
    onFormEnd: function (h) {
      h.dmgMul = 1;
      h.dmgTakenMult = 1;
      h.speedMul = 1;
      if (h.formField) { h.formField.life = 0; h.formField = null; }
    }
  });

  SH.kitById = function (id) {
    for (var i = 0; i < KITS.length; i++) if (KITS[i].id === id) return KITS[i];
    return null;
  };
})();
