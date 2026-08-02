/**
 * App shell: boots the engine, owns the frame loop, and wires the UI.
 */

import * as THREE from 'three';
import { Engine } from './engine.js';
import { Production } from './production.js';
import { AudioTrack, distributeLyrics, applyLyricTimings } from './audio.js';
import {
  SKIN_TONES, HAIR_COLOURS, EYE_COLOURS, HAIR_STYLES, OUTFITS, BUILDS, MAGIC_COLOURS,
} from './human.js';
import { direct } from './director.js';
import { ABILITIES } from './parser.js';

const SAMPLE = `Title: The Lamplighter's Hour
Author: a Playhouse demo

INT. THE CLOCKMAKER'S PARLOUR - NIGHT

The grandfather clock keeps its patient time. On the table, an oil lamp burns low.

MIREN
(quietly)
You said the light would hold until midnight.

CORVAL
I said it would hold. I never said for whom.

Miren lifts her hand and the lamp flares, throwing gold across the walls.

MIREN
(singing)
~ Every hour I have counted here
~ Every hour I have kept
~ And the glass has held the flame so near
~ While the whole great house slept

CORVAL
(hard)
Then stop counting.

The clock begins to strike. Shadow gathers at Corval's shoulders.

MIREN
~ I will not be the one who lets it go
~ I will not be the dark!

[[shield: MIREN]]

CORVAL
You were always going to be.

CUT TO:

INT. THE STAIRWELL - NIGHT

MIREN
(afraid)
Corval? The lamp is still burning.
`;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const canvas = document.getElementById('view');
const engine = new Engine(canvas);
const production = new Production(engine);
const audio = new AudioTrack();

const ui = {
  boot: document.getElementById('boot'),
  bootMsg: document.getElementById('bootMsg'),
  chrome: document.getElementById('chrome'),
  slate: document.getElementById('slate'),
  prodTitle: document.getElementById('prodTitle'),
  speaker: document.getElementById('speaker'),
  caption: document.getElementById('caption'),
  played: document.getElementById('played'),
  knob: document.getElementById('knob'),
  marks: document.getElementById('marks'),
  scrub: document.getElementById('scrub'),
  time: document.getElementById('time'),
  btnPlay: document.getElementById('btnPlay'),
  btnFull: document.getElementById('btnFull'),
  btnLetterbox: document.getElementById('btnLetterbox'),
  sheet: document.getElementById('sheet'),
  sheetTitle: document.getElementById('sheetTitle'),
  sheetBody: document.getElementById('sheetBody'),
  btnCloseSheet: document.getElementById('btnCloseSheet'),
  toast: document.getElementById('toast'),
  tabs: [...document.querySelectorAll('.tab')],
};

const state = {
  scriptText: SAMPLE,
  overrides: {},
  panel: null,
  audioMaster: false,
  lyricTimings: [],
  chromeHidden: false,
  chromeTimer: 0,
};

function toast(message, ms = 2100) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => ui.toast.classList.remove('show'), ms);
}

function fitCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  engine.setSize(w, h);
}

window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 220));
fitCanvas();

// ---------------------------------------------------------------------------
// Loading a script
// ---------------------------------------------------------------------------

function stageScript(text) {
  state.scriptText = text;
  const script = production.load(text, state.overrides);
  ui.prodTitle.textContent = script.meta.title || 'Playhouse';
  document.title = `${script.meta.title || 'Playhouse'} — Playhouse`;
  state.lyricTimings = [];
  drawSceneMarks();
  if (state.panel === 'cast') renderPanel('cast');
  if (state.panel === 'audio') renderPanel('audio');
  return script;
}

function drawSceneMarks() {
  const plan = production.plan;
  if (!plan || !plan.duration) { ui.marks.innerHTML = ''; return; }
  ui.marks.innerHTML = plan.scenes
    .map((s) => `<i style="left:${(s.start / plan.duration) * 100}%"></i>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let elapsed = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  // When a recording is loaded it is the master clock — the performance
  // follows the music, never the other way round.
  let external = null;
  if (state.audioMaster && audio.loaded) {
    if (production.playing && !audio.playing) audio.play(production.time);
    if (!production.playing && audio.playing) audio.pause();
    if (audio.playing) external = audio.currentTime;
  }

  production.update(dt, elapsed, external);

  // Live lip sync from the recording's amplitude.
  if (audio.playing && production.currentBeat?.character) {
    const animator = production.animators.get(production.currentBeat.character);
    if (animator) animator.setMouthOpen(audio.level() * 0.9);
  }

  engine.render(elapsed);
  updateTransport();
}

function updateTransport() {
  const d = production.duration || 1;
  const pct = (production.time / d) * 100;
  ui.played.style.width = `${pct}%`;
  ui.knob.style.left = `${pct}%`;
  ui.time.textContent = `${fmt(production.time)} / ${fmt(d)}`;
  ui.btnPlay.textContent = production.playing ? '❚❚' : '▶';

  if (ui.slate.textContent !== production.slate) ui.slate.textContent = production.slate || '—';

  const cap = production.caption;
  const speaker = cap?.speaker || '';
  const text = cap?.text || '';
  if (ui.speaker.textContent !== speaker) ui.speaker.textContent = speaker;
  if (ui.caption.textContent !== text) {
    ui.caption.textContent = text;
    ui.caption.className = cap?.kind === 'lyric' || cap?.kind === 'sung'
      ? 'lyric' : cap?.kind === 'action' ? 'action' : '';
  }
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Transport interaction
// ---------------------------------------------------------------------------

ui.btnPlay.addEventListener('click', async () => {
  if (!production.playing) {
    await audio.resume();
    production.play();
    if (state.audioMaster && audio.loaded) audio.play(production.time);
  } else {
    production.pause();
    if (audio.playing) audio.pause();
  }
});

let scrubbing = false;
function scrubTo(clientX) {
  const rect = ui.scrub.getBoundingClientRect();
  const t = THREE.MathUtils.clamp((clientX - rect.left) / rect.width, 0, 1);
  production.seek(t * production.duration);
  if (audio.loaded && state.audioMaster) audio.seek(production.time);
}
ui.scrub.addEventListener('pointerdown', (e) => {
  scrubbing = true;
  ui.scrub.setPointerCapture(e.pointerId);
  scrubTo(e.clientX);
});
ui.scrub.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e.clientX); });
ui.scrub.addEventListener('pointerup', () => { scrubbing = false; });
ui.scrub.addEventListener('pointercancel', () => { scrubbing = false; });

ui.btnFull.addEventListener('click', () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }
});

const LETTERBOXES = [0, 0.075, 0.115];
let letterboxIndex = 0;
ui.btnLetterbox.addEventListener('click', () => {
  letterboxIndex = (letterboxIndex + 1) % LETTERBOXES.length;
  engine.letterbox = LETTERBOXES[letterboxIndex];
  ui.btnLetterbox.classList.toggle('on', letterboxIndex > 0);
  toast(['Full frame', '1.85:1', '2.39:1'][letterboxIndex]);
});

// Tap the picture to hide the interface.
canvas.addEventListener('click', () => {
  state.chromeHidden = !state.chromeHidden;
  ui.chrome.classList.toggle('hidden', state.chromeHidden);
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); ui.btnPlay.click(); }
  if (e.code === 'ArrowRight') production.seek(production.time + 5);
  if (e.code === 'ArrowLeft') production.seek(production.time - 5);
});

// ---------------------------------------------------------------------------
// Sheet & panels
// ---------------------------------------------------------------------------

function openPanel(name) {
  if (state.panel === name) { closeSheet(); return; }
  state.panel = name;
  ui.sheet.classList.add('open');
  ui.sheetTitle.textContent = name;
  ui.tabs.forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
  renderPanel(name);
}
function closeSheet() {
  state.panel = null;
  ui.sheet.classList.remove('open');
  ui.tabs.forEach((t) => t.classList.remove('active'));
}
ui.tabs.forEach((t) => t.addEventListener('click', () => openPanel(t.dataset.panel)));
ui.btnCloseSheet.addEventListener('click', closeSheet);

function renderPanel(name) {
  const body = ui.sheetBody;
  body.innerHTML = '';
  if (name === 'script') renderScriptPanel(body);
  else if (name === 'cast') renderCastPanel(body);
  else if (name === 'audio') renderAudioPanel(body);
  else if (name === 'look') renderLookPanel(body);
}

// --- Script -----------------------------------------------------------------

function renderScriptPanel(body) {
  const ta = document.createElement('textarea');
  ta.value = state.scriptText;
  ta.spellcheck = false;
  body.appendChild(ta);

  const row = document.createElement('div');
  row.className = 'row';
  const stage = document.createElement('button');
  stage.className = 'btn primary';
  stage.textContent = 'Stage it';
  stage.onclick = () => {
    try {
      const s = stageScript(ta.value);
      production.seek(0);
      production.play();
      closeSheet();
      toast(`${s.scenes.length} scene${s.scenes.length === 1 ? '' : 's'}, ${s.characters.length} in the cast`);
    } catch (err) {
      toast(`Could not stage: ${err.message}`, 3600);
    }
  };
  const reset = document.createElement('button');
  reset.className = 'btn';
  reset.textContent = 'Load sample';
  reset.onclick = () => { ta.value = SAMPLE; };
  row.append(stage, reset);
  body.appendChild(row);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.innerHTML = `
    <p><strong>Fountain formatting.</strong> Scene headings start <code>INT.</code> or <code>EXT.</code>;
    a line in CAPS is a character cue; <code>(parentheticals)</code> set the emotion, which drives both
    the performance and the shot size.</p>
    <p><strong>Songs.</strong> Prefix lyric lines with <code>~</code>. Consecutive lyric lines group into a
    number, and are staged wider with more camera movement than dialogue.</p>
    <p><strong>Magic.</strong> Write <code>[[fire: MIREN -&gt; DOOR]]</code> for an explicit cue, or just
    describe it — "the lamp flares", "shadow gathers" — and it will be inferred.
    Abilities: ${ABILITIES.join(', ')}.</p>
    <p><strong>Props</strong> named in action lines get built into the set automatically.</p>`;
  body.appendChild(hint);
}

// --- Cast -------------------------------------------------------------------

function renderCastPanel(body) {
  const script = production.script;
  if (!script?.characters.length) {
    body.innerHTML = '<div class="hint">No speaking parts found yet. Stage a script first.</div>';
    return;
  }

  for (const record of script.characters) {
    const spec = production.specs.get(record.name);
    if (!spec) continue;
    const card = document.createElement('div');
    card.className = 'card';

    const head = document.createElement('h4');
    head.innerHTML = `<span class="swatch" style="background:${spec.skin}"></span>
      ${record.name}
      <span style="margin-left:auto;font-weight:400;color:var(--ink-dim);font-size:11px">
        ${record.lines} line${record.lines === 1 ? '' : 's'}</span>`;
    card.appendChild(head);

    const set = (key, value) => {
      state.overrides[record.name] = { ...(state.overrides[record.name] || {}), [key]: value };
      const next = production.recast(record.name, state.overrides[record.name]);
      head.querySelector('.swatch').style.background = next.skin;
    };

    card.appendChild(selectField('Build', Object.keys(BUILDS), spec.build, (v) => set('build', v)));
    card.appendChild(selectField('Hair', HAIR_STYLES, spec.hairStyle, (v) => set('hairStyle', v)));
    card.appendChild(colourField('Hair tone', HAIR_COLOURS, spec.hairColour, (v) => set('hairColour', v)));
    card.appendChild(colourField('Skin', SKIN_TONES, spec.skin, (v) => set('skin', v)));
    card.appendChild(colourField('Eyes', EYE_COLOURS, spec.eyeColour, (v) => set('eyeColour', v)));
    card.appendChild(selectField('Costume', OUTFITS, spec.outfit.type, (v) => set('outfitType', v)));
    card.appendChild(pickerField('Cloth', spec.outfit.primary, (v) => set('primary', v)));
    card.appendChild(pickerField('Trim', spec.outfit.secondary, (v) => set('secondary', v)));
    card.appendChild(rangeField('Height', 0.88, 1.12, 0.01, spec.height, (v) => set('height', v)));
    card.appendChild(colourField('Magic', Object.values(MAGIC_COLOURS), spec.magic?.colour || '#ffe9a8',
      (v) => set('magic', { colour: v })));

    body.appendChild(card);
  }
}

function field(label, control) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  wrap.append(l, control);
  return wrap;
}

function selectField(label, options, value, onChange) {
  const sel = document.createElement('select');
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => onChange(sel.value);
  return field(label, sel);
}

function colourField(label, palette, value, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:5px;flex:1;flex-wrap:wrap';
  palette.forEach((c) => {
    const dot = document.createElement('div');
    dot.style.cssText = `width:24px;height:24px;border-radius:6px;background:${c};cursor:pointer;
      border:2px solid ${c.toLowerCase() === String(value).toLowerCase() ? 'var(--accent)' : 'transparent'}`;
    dot.onclick = () => {
      [...wrap.children].forEach((d) => { d.style.borderColor = 'transparent'; });
      dot.style.borderColor = 'var(--accent)';
      onChange(c);
    };
    wrap.appendChild(dot);
  });
  return field(label, wrap);
}

function pickerField(label, value, onChange) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  input.oninput = () => onChange(input.value);
  return field(label, input);
}

function rangeField(label, min, max, step, value, onChange) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.oninput = () => onChange(parseFloat(input.value));
  return field(label, input);
}

// --- Audio ------------------------------------------------------------------

function renderAudioPanel(body) {
  const info = document.createElement('div');
  info.className = 'hint';
  info.innerHTML = audio.loaded
    ? `<strong>${audio.name}</strong> · ${fmt(audio.duration)}
       · ${audio.bpm ? `${audio.bpm} BPM` : 'tempo unclear'}
       · ${audio.onsets.length} onsets detected`
    : 'Load a recording — a demo, a cast album, a piano track — and the performance will follow it.';
  body.appendChild(info);

  const canvasEl = document.createElement('canvas');
  canvasEl.id = 'waveform';
  body.appendChild(canvasEl);
  if (audio.loaded) requestAnimationFrame(() => drawWaveform(canvasEl));

  const row = document.createElement('div');
  row.className = 'row';

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'audio/*';
  file.style.display = 'none';
  file.onchange = async () => {
    if (!file.files?.[0]) return;
    toast('Decoding and analysing…', 6000);
    try {
      await audio.resume();
      const res = await audio.load(file.files[0]);
      state.audioMaster = true;
      toast(`Loaded ${fmt(res.duration)}${res.bpm ? ` · ${res.bpm} BPM` : ''}`);
      renderPanel('audio');
    } catch (err) {
      toast(`Could not decode that file: ${err.message}`, 4000);
    }
  };
  body.appendChild(file);

  const pick = document.createElement('button');
  pick.className = 'btn primary';
  pick.textContent = audio.loaded ? 'Replace recording' : 'Load recording';
  pick.onclick = () => file.click();
  row.appendChild(pick);

  if (audio.loaded) {
    const retime = document.createElement('button');
    retime.className = 'btn';
    retime.textContent = 'Fit lyrics to audio';
    retime.onclick = () => retimeToAudio();
    row.appendChild(retime);

    const toggle = document.createElement('button');
    toggle.className = 'btn';
    toggle.textContent = state.audioMaster ? 'Audio drives timing ✓' : 'Audio drives timing';
    toggle.onclick = () => {
      state.audioMaster = !state.audioMaster;
      if (!state.audioMaster) audio.pause();
      renderPanel('audio');
    };
    row.appendChild(toggle);
  }
  body.appendChild(row);

  if (audio.loaded) {
    body.appendChild(rangeField('Volume', 0, 1, 0.01, 1, (v) => audio.setVolume(v)));
  }

  // Lyric timing list with tap-to-set.
  const lyrics = collectLyricBeats();
  if (lyrics.length) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h4>Lyric timing</h4><div class="hint" style="margin-bottom:8px">'
      + 'Play the recording and tap <em>Set</em> on the line as it is sung. '
      + 'Word-level alignment needs an acoustic model on a server; this converges fast without one.</div>';

    lyrics.forEach((beat) => {
      const row2 = document.createElement('div');
      row2.className = 'lyricrow';
      const timing = state.lyricTimings.find((t) => t.id === beat.id);
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = timing ? fmt(timing.time) : '—';
      const x = document.createElement('div');
      x.className = 'x';
      x.textContent = beat.text;
      const set = document.createElement('button');
      set.className = 'btn small';
      set.textContent = 'Set';
      set.onclick = () => {
        const now = audio.loaded && audio.playing ? audio.currentTime : production.time;
        const existing = state.lyricTimings.find((e) => e.id === beat.id);
        if (existing) existing.time = now;
        else state.lyricTimings.push({ id: beat.id, time: now });
        state.lyricTimings.sort((a, b) => a.time - b.time);
        t.textContent = fmt(now);
        applyTimings();
      };
      row2.append(t, x, set);
      card.appendChild(row2);
    });
    body.appendChild(card);
  }
}

function collectLyricBeats() {
  const out = [];
  for (const scene of production.script?.scenes || []) {
    for (const beat of scene.beats) if (beat.type === 'lyric') out.push(beat);
  }
  return out;
}

function retimeToAudio() {
  const lyrics = collectLyricBeats();
  if (!lyrics.length) { toast('No lyric lines (prefix them with ~)'); return; }
  if (!audio.loaded) { toast('Load a recording first'); return; }
  state.lyricTimings = distributeLyrics(lyrics, 0.6, audio.duration - 0.4, audio.onsets);
  applyTimings();
  toast(`Timed ${lyrics.length} lines across ${fmt(audio.duration)}`);
  renderPanel('audio');
}

function applyTimings() {
  if (!state.lyricTimings.length) return;
  applyLyricTimings(production.script, state.lyricTimings, audio.loaded ? audio.duration : production.duration);
  production.plan = direct(production.script, { pace: production.pace ?? 1 });
  drawSceneMarks();
}

function drawWaveform(canvasEl) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvasEl.clientWidth;
  const h = 64;
  canvasEl.width = w * dpr;
  canvasEl.height = h * dpr;
  const x = canvasEl.getContext('2d');
  x.scale(dpr, dpr);
  x.clearRect(0, 0, w, h);

  const peaks = audio.peaks;
  x.fillStyle = '#7fa8d8';
  const step = w / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const ph = Math.max(1, peaks[i] * h * 0.86);
    x.fillRect(i * step, (h - ph) / 2, Math.max(1, step - 0.5), ph);
  }
  x.fillStyle = 'rgba(224,168,80,.55)';
  for (const o of audio.onsets) {
    x.fillRect((o / audio.duration) * w, 0, 1, h);
  }
}

// --- Look -------------------------------------------------------------------

function renderLookPanel(body) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h4>Camera &amp; grade</h4>';
  card.appendChild(rangeField('Bloom', 0, 1.4, 0.01, engine.bloomStrength, (v) => { engine.bloomStrength = v; }));
  card.appendChild(rangeField('Grain', 0, 0.12, 0.002, engine.compositeMaterial.uniforms.uGrain.value,
    (v) => { engine.compositeMaterial.uniforms.uGrain.value = v; }));
  card.appendChild(rangeField('Vignette', 0, 0.9, 0.01, engine.compositeMaterial.uniforms.uVignette.value,
    (v) => { engine.compositeMaterial.uniforms.uVignette.value = v; }));
  card.appendChild(rangeField('Aberration', 0, 0.02, 0.0005, engine.compositeMaterial.uniforms.uChroma.value,
    (v) => { engine.compositeMaterial.uniforms.uChroma.value = v; }));
  card.appendChild(rangeField('Exposure', 0.5, 1.8, 0.01, engine.renderer.toneMappingExposure,
    (v) => { engine.renderer.toneMappingExposure = v; }));
  body.appendChild(card);

  const pacing = document.createElement('div');
  pacing.className = 'card';
  pacing.innerHTML = '<h4>Cutting</h4><div class="hint" style="margin-bottom:8px">'
    + 'Higher values cut faster and hold shots for less time.</div>';
  pacing.appendChild(rangeField('Pace', 0.6, 1.8, 0.05, production.pace ?? 1, (v) => {
    production.pace = v;
    production.plan = direct(production.script, { pace: v });
    applyTimings();
    drawSceneMarks();
  }));
  body.appendChild(pacing);

  const perf = document.createElement('div');
  perf.className = 'card';
  perf.innerHTML = '<h4>Performance</h4>';
  const row = document.createElement('div');
  row.className = 'row';
  const post = document.createElement('button');
  post.className = 'btn';
  post.textContent = engine.postEnabled ? 'Post-processing ✓' : 'Post-processing';
  post.onclick = () => {
    engine.postEnabled = !engine.postEnabled;
    post.textContent = engine.postEnabled ? 'Post-processing ✓' : 'Post-processing';
  };
  const shadows = document.createElement('button');
  shadows.className = 'btn';
  shadows.textContent = engine.renderer.shadowMap.enabled ? 'Shadows ✓' : 'Shadows';
  shadows.onclick = () => {
    engine.renderer.shadowMap.enabled = !engine.renderer.shadowMap.enabled;
    engine.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    shadows.textContent = engine.renderer.shadowMap.enabled ? 'Shadows ✓' : 'Shadows';
  };
  const half = document.createElement('button');
  half.className = 'btn';
  half.textContent = 'Halve resolution';
  half.onclick = () => {
    const cur = engine.renderer.getPixelRatio();
    const next = cur > 1 ? 1 : Math.min(2, window.devicePixelRatio || 1);
    engine.renderer.setPixelRatio(next);
    fitCanvas();
    half.textContent = next > 1 ? 'Halve resolution' : 'Restore resolution';
  };
  row.append(post, shadows, half);
  perf.appendChild(row);
  body.appendChild(perf);
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

try {
  stageScript(SAMPLE);
  ui.bootMsg.textContent = 'Ready';
  setTimeout(() => ui.boot.classList.add('gone'), 260);
  production.seek(0);
  production.play();
  frame();
} catch (err) {
  ui.bootMsg.innerHTML = `Failed to start.<br><span style="font-size:11px;color:#c88">${err.message}</span>`;
  console.error(err);
}

// Expose for debugging from a device console.
window.playhouse = { engine, production, audio, stageScript, THREE };
