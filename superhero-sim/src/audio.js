/* VANGUARD — audio.js
 * Tiny procedural WebAudio SFX engine. No asset files, no network.
 */
(function () {
  'use strict';
  var SH = (window.SH = window.SH || {});
  var U = SH.util;

  var A = (SH.audio = {
    ctx: null,
    master: null,
    enabled: true,
    ready: false,
    voices: 0,
    maxVoices: 14
  });

  A.init = function () {
    if (A.ready) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { A.enabled = false; return; }
    try {
      A.ctx = new Ctx();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.5;
      A.master.connect(A.ctx.destination);
      A.noise = makeNoise(A.ctx);
      A.ready = true;
    } catch (err) {
      A.enabled = false;
    }
  };

  A.resume = function () {
    if (!A.ready) A.init();
    rearm();
  };

  /* Nudges an existing context; never creates one, so A.init stays
     gesture-driven. WebKit has a fourth state nothing else has —
     'interrupted', entered on a call, Siri, or the screen locking. Without
     this the game goes permanently mute after the first interruption,
     because a suspended-only check never fires again. 'closed' is
     unrecoverable, so don't churn on it. */
  function rearm() {
    var c = A.ctx;
    if (!c || typeof c.resume !== 'function') return;
    if (c.state === 'running' || c.state === 'closed') return;
    try {
      var p = c.resume();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (err) {}
  }

  A.setEnabled = function (on) {
    A.enabled = on;
    if (A.master) A.master.gain.value = on ? 0.5 : 0;
  };

  A.frame = function () { A.voices = 0; };

  function makeNoise(ctx) {
    var len = ctx.sampleRate * 0.6;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(node, t, a, d, peak) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(o) {
    if (!A.enabled || !A.ready || A.voices >= A.maxVoices) return;
    A.voices++;
    var ctx = A.ctx, t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t + (o.dur || 0.2));
    env(g, t, o.attack || 0.005, o.dur || 0.2, (o.vol === undefined ? 0.3 : o.vol));
    osc.connect(g);
    if (o.filter) {
      var f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.value = o.filterF || 900;
      g.connect(f); f.connect(A.master);
    } else {
      g.connect(A.master);
    }
    osc.start(t);
    osc.stop(t + (o.dur || 0.2) + (o.attack || 0.005) + 0.03);
  }

  function noise(o) {
    if (!A.enabled || !A.ready || A.voices >= A.maxVoices) return;
    A.voices++;
    var ctx = A.ctx, t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = A.noise;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 1200, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 40), t + (o.dur || 0.2));
    var g = ctx.createGain();
    env(g, t, o.attack || 0.004, o.dur || 0.2, o.vol === undefined ? 0.25 : o.vol);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t);
    src.stop(t + (o.dur || 0.2) + 0.05);
  }

  var LIB = {
    swing:  function () { noise({ f0: 2400, f1: 700, dur: 0.13, vol: 0.13, filter: 'bandpass' }); },
    heavy:  function () { noise({ f0: 900, f1: 160, dur: 0.26, vol: 0.24, filter: 'lowpass' }); tone({ type: 'triangle', f0: 150, f1: 55, dur: 0.22, vol: 0.22 }); },
    hit:    function () { noise({ f0: 1800, f1: 400, dur: 0.09, vol: 0.16, filter: 'bandpass' }); },
    crit:   function () { tone({ type: 'square', f0: 780, f1: 1400, dur: 0.1, vol: 0.13 }); noise({ f0: 2600, f1: 600, dur: 0.12, vol: 0.16, filter: 'bandpass' }); },
    shoot:  function () { tone({ type: 'sawtooth', f0: 620, f1: 220, dur: 0.11, vol: 0.12, filter: 'lowpass', filterF: 2200 }); },
    zap:    function () { tone({ type: 'square', f0: 1500, f1: 420, dur: 0.1, vol: 0.1 }); noise({ f0: 4200, f1: 1200, dur: 0.09, vol: 0.1, filter: 'highpass' }); },
    boom:   function () { noise({ f0: 700, f1: 60, dur: 0.5, vol: 0.32, filter: 'lowpass' }); tone({ type: 'sine', f0: 120, f1: 38, dur: 0.42, vol: 0.26 }); },
    dash:   function () { noise({ f0: 3000, f1: 900, dur: 0.16, vol: 0.1, filter: 'bandpass' }); },
    blink:  function () { tone({ type: 'sine', f0: 900, f1: 180, dur: 0.16, vol: 0.14 }); },
    leap:   function () { tone({ type: 'triangle', f0: 260, f1: 700, dur: 0.2, vol: 0.14 }); },
    land:   function () { noise({ f0: 800, f1: 90, dur: 0.3, vol: 0.26, filter: 'lowpass' }); },
    heal:   function () { tone({ type: 'sine', f0: 520, f1: 900, dur: 0.3, vol: 0.14 }); tone({ type: 'sine', f0: 780, f1: 1300, dur: 0.28, vol: 0.08 }); },
    freeze: function () { tone({ type: 'triangle', f0: 1600, f1: 340, dur: 0.32, vol: 0.13 }); noise({ f0: 5200, f1: 1600, dur: 0.3, vol: 0.09, filter: 'highpass' }); },
    absorb: function () { tone({ type: 'sine', f0: 180, f1: 640, dur: 0.34, vol: 0.13 }); },
    form:   function () {
      tone({ type: 'sawtooth', f0: 180, f1: 900, dur: 0.7, vol: 0.2, filter: 'lowpass', filterF: 2600 });
      tone({ type: 'sine', f0: 400, f1: 1600, dur: 0.8, vol: 0.14 });
      noise({ f0: 400, f1: 5000, dur: 0.75, vol: 0.13, filter: 'bandpass' });
    },
    formend: function () { tone({ type: 'sine', f0: 700, f1: 160, dur: 0.5, vol: 0.14 }); },
    ko:     function () { tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.6, vol: 0.22, filter: 'lowpass', filterF: 900 }); },
    revive: function () { tone({ type: 'triangle', f0: 300, f1: 1000, dur: 0.4, vol: 0.16 }); },
    swap:   function () { tone({ type: 'square', f0: 660, f1: 1180, dur: 0.09, vol: 0.08 }); },
    ui:     function () { tone({ type: 'square', f0: 900, f1: 900, dur: 0.05, vol: 0.06 }); },
    hurt:   function () { tone({ type: 'sawtooth', f0: 340, f1: 120, dur: 0.18, vol: 0.14, filter: 'lowpass', filterF: 1100 }); },
    kill:   function () { noise({ f0: 1500, f1: 200, dur: 0.22, vol: 0.16, filter: 'bandpass' }); tone({ type: 'triangle', f0: 300, f1: 90, dur: 0.2, vol: 0.1 }); },
    boss:   function () { tone({ type: 'sawtooth', f0: 90, f1: 42, dur: 1.2, vol: 0.24, filter: 'lowpass', filterF: 500 }); }
  };

  A.play = function (name) {
    if (!A.enabled || !A.ready) return;
    var fn = LIB[name];
    if (fn) fn();
  };

  /* Bound once at load, outside A.init, so the retry paths in init can't
     stack duplicates. rearm() only ever nudges a context that already
     exists, so none of these can start audio outside a user gesture. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) rearm();
  });
  window.addEventListener('pageshow', rearm);
  window.addEventListener('focus', rearm);
})();
