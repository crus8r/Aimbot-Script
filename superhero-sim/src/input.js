/* VANGUARD — input.js
 * Touch (virtual stick + action buttons with drag-to-aim) and keyboard.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var IN = (SH.input = {
    move: { x: 0, y: 0, len: 0 },
    btns: {},
    keys: {},
    anyTouch: false,
    lastInputWasTouch: false
  });

  var BTN_NAMES = ['primary', 'a1', 'a2', 'dash', 'form', 'force', 'extra'];

  function mkBtn() {
    return { down: false, pressed: false, released: false, heldFor: 0, aimActive: false, aimX: 0, aimY: 0 };
  }
  BTN_NAMES.forEach(function (n) { IN.btns[n] = mkBtn(); });

  var stickEl, knobEl, stickZone;
  var stickPointer = null;
  var stickOrigin = { x: 0, y: 0 };
  var STICK_MAX = 58;

  IN.init = function () {
    stickZone = document.getElementById('stickzone');
    stickEl = document.getElementById('stick');
    knobEl = document.getElementById('knob');

    /* ---- virtual stick ---- */
    stickZone.addEventListener('pointerdown', function (ev) {
      if (stickPointer !== null) return;
      stickPointer = ev.pointerId;
      IN.anyTouch = true;
      stickOrigin.x = ev.clientX; stickOrigin.y = ev.clientY;
      stickEl.style.left = ev.clientX + 'px';
      stickEl.style.top = ev.clientY + 'px';
      stickEl.classList.add('on');
      moveKnob(0, 0);
      try { stickZone.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }, { passive: false });

    stickZone.addEventListener('pointermove', function (ev) {
      if (ev.pointerId !== stickPointer) return;
      var dx = ev.clientX - stickOrigin.x, dy = ev.clientY - stickOrigin.y;
      var l = Math.hypot(dx, dy);
      if (l > STICK_MAX) { dx = dx / l * STICK_MAX; dy = dy / l * STICK_MAX; l = STICK_MAX; }
      moveKnob(dx, dy);
      var n = l / STICK_MAX;
      if (n < 0.14) { IN.move.x = 0; IN.move.y = 0; IN.move.len = 0; }
      else {
        var f = U.clamp((n - 0.14) / 0.72, 0, 1);
        var d = U.norm(dx, dy);
        IN.move.x = d.x * f; IN.move.y = d.y * f; IN.move.len = f;
      }
      ev.preventDefault();
    }, { passive: false });

    function endStick(ev) {
      if (ev.pointerId !== stickPointer) return;
      stickPointer = null;
      stickEl.classList.remove('on');
      IN.move.x = 0; IN.move.y = 0; IN.move.len = 0;
      moveKnob(0, 0);
    }
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);
    stickZone.addEventListener('pointerleave', endStick);

    /* ---- action buttons (tap, hold, drag-to-aim) ---- */
    var btnEls = document.querySelectorAll('[data-btn]');
    Array.prototype.forEach.call(btnEls, function (el) {
      var name = el.getAttribute('data-btn');
      var b = IN.btns[name];
      if (!b) return;
      var pid = null, sx = 0, sy = 0;

      el.addEventListener('pointerdown', function (ev) {
        if (pid !== null) return;
        pid = ev.pointerId;
        sx = ev.clientX; sy = ev.clientY;
        IN.anyTouch = true;
        b.down = true; b.pressed = true; b.heldFor = 0;
        b.aimActive = false; b.aimX = 0; b.aimY = 0;
        el.classList.add('press');
        SH.audio.resume();
        try { el.setPointerCapture(ev.pointerId); } catch (e) {}
        ev.preventDefault(); ev.stopPropagation();
      }, { passive: false });

      el.addEventListener('pointermove', function (ev) {
        if (ev.pointerId !== pid) return;
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        var l = Math.hypot(dx, dy);
        if (l > 20) {
          b.aimActive = true;
          b.aimX = dx / l; b.aimY = dy / l;
        } else {
          b.aimActive = false;
        }
        ev.preventDefault();
      }, { passive: false });

      function up(ev) {
        if (ev.pointerId !== pid) return;
        pid = null;
        b.down = false; b.released = true; b.aimActive = false;
        el.classList.remove('press');
      }
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    });

    /* ---- keyboard ---- */
    window.addEventListener('keydown', function (ev) {
      if (ev.repeat) return;
      var k = ev.key.toLowerCase();
      IN.keys[k] = true;
      var b = keyBtn(k);
      if (b) { b.down = true; b.pressed = true; b.heldFor = 0; }
      if (k >= '1' && k <= '5') SH.game && SH.game.requestSwitch(+k - 1);
      if (k === 'tab') { ev.preventDefault(); SH.game && SH.game.cycleHero(1); }
      if (k === 'escape' || k === 'p') SH.game && SH.game.togglePause();
      if (' wasdjkl'.indexOf(k) >= 0 || k === 'arrowup' || k === 'arrowdown') ev.preventDefault();
    });
    window.addEventListener('keyup', function (ev) {
      var k = ev.key.toLowerCase();
      IN.keys[k] = false;
      var b = keyBtn(k);
      if (b) { b.down = false; b.released = true; }
    });
    window.addEventListener('blur', function () {
      IN.keys = {};
      BTN_NAMES.forEach(function (n) { IN.btns[n].down = false; });
    });
  };

  function keyBtn(k) {
    switch (k) {
      case 'j': case ' ': return IN.btns.primary;
      case 'k': return IN.btns.a1;
      case 'l': return IN.btns.a2;
      case 'shift': return IN.btns.dash;
      case 'q': case 'e': return IN.btns.form;
      case 'f': return IN.btns.force;
      case 'c': return IN.btns.extra;
      default: return null;
    }
  }

  function moveKnob(dx, dy) {
    if (knobEl) knobEl.style.transform = 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px)';
  }

  /* Merge keyboard movement into the stick vector each frame */
  IN.update = function (dt) {
    if (stickPointer === null) {
      var kx = 0, ky = 0;
      if (IN.keys['a'] || IN.keys['arrowleft']) kx -= 1;
      if (IN.keys['d'] || IN.keys['arrowright']) kx += 1;
      if (IN.keys['w'] || IN.keys['arrowup']) ky -= 1;
      if (IN.keys['s'] || IN.keys['arrowdown']) ky += 1;
      if (kx || ky) {
        var n = U.norm(kx, ky);
        IN.move.x = n.x; IN.move.y = n.y; IN.move.len = 1;
      } else if (!IN.move.fromStick) {
        IN.move.x = 0; IN.move.y = 0; IN.move.len = 0;
      }
    }
    BTN_NAMES.forEach(function (nm) {
      var b = IN.btns[nm];
      if (b.down) b.heldFor += dt;
    });
  };

  IN.endFrame = function () {
    BTN_NAMES.forEach(function (nm) {
      var b = IN.btns[nm];
      b.pressed = false; b.released = false;
    });
  };

  IN.clearAll = function () {
    BTN_NAMES.forEach(function (nm) {
      var b = IN.btns[nm];
      b.down = false; b.pressed = false; b.released = false; b.heldFor = 0; b.aimActive = false;
    });
    IN.move.x = 0; IN.move.y = 0; IN.move.len = 0;
  };
})();
