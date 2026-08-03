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
import { ABILITIES, parseScript } from './parser.js';
import { saveAvatarFile, loadStoredAvatars, clearStoredAvatar } from './avatar.js';
import { SpeechDirector } from './speech.js';
import { NoteStack, parseNote } from './notes.js';
import { propsMentioned } from './props.js';

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
// Speak dialogue by default — a silent play was the app's biggest reported
// surprise. Lyrics stay silent unless opted in (spoken TTS undercuts a song).
const speech = new SpeechDirector();

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
  // The last staging result, kept out of the DOM so it survives the panel
  // being torn down and rebuilt.
  scriptStatus: null,      // { text, tone: 'ok' | 'warn' | 'error' }
  noteStatus: null,        // { text, tone } — last notes-panel action result
  notesKey: null,          // localStorage key for the staged script's notes
  overrides: {},
  voices: {},              // character -> pinned voiceURI, persisted
  panel: null,
  importing: new Map(),    // character -> filename currently being loaded
  audioMaster: false,
  lyricTimings: [],
  chromeHidden: false,
  chromeTimer: 0,
};

/**
 * @param {string} message
 * @param {number} [ms] how long to hold it; 0 holds until something replaces it,
 *   which is what a multi-second import needs.
 */
function toast(message, ms = 2100) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toast._t);
  if (ms > 0) toast._t = setTimeout(() => ui.toast.classList.remove('show'), ms);
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
// Local persistence
// ---------------------------------------------------------------------------

const SCRIPT_KEY = 'playhouse.script';
const SPEECH_KEY = 'playhouse.speech';
const VOICE_KEY = 'playhouse.voices';
const HINT_KEY = 'playhouse.hint.notes';

/** localStorage is unavailable in some privacy modes; never fail over it. */
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode, quota */ }
}
function recall(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

/** FNV-1a — a private copy per module is the established pattern here. */
function fnv(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Speech preferences ------------------------------------------------------

function saveSpeechPrefs() {
  remember(SPEECH_KEY, JSON.stringify({ enabled: speech.enabled, speakLyrics: speech.speakLyrics }));
}
try {
  const prefs = JSON.parse(recall(SPEECH_KEY) || '{}');
  if (typeof prefs.enabled === 'boolean') speech.enabled = prefs.enabled;
  if (typeof prefs.speakLyrics === 'boolean') speech.speakLyrics = prefs.speakLyrics;
} catch { /* corrupt prefs: defaults stand */ }
try {
  state.voices = JSON.parse(recall(VOICE_KEY) || '{}') || {};
  // Unknown URIs (the voice list changed since) are ignored gracefully inside.
  for (const [name, uri] of Object.entries(state.voices)) speech.setVoiceOverride(name, uri);
} catch { state.voices = {}; }

// --- Director notes, kept per script -----------------------------------------

function saveNotes() {
  if (!state.notesKey) return;
  try { remember(state.notesKey, JSON.stringify(production.notes.toJSON())); } catch { /* fine */ }
}

/** Swap in the note stack saved for this script text (or a fresh one). */
function loadNotes(text) {
  state.notesKey = `playhouse.notes.${fnv(text)}`;
  let stack = null;
  try {
    const raw = recall(state.notesKey);
    if (raw) stack = NoteStack.fromJSON(JSON.parse(raw));
  } catch { /* corrupt snapshot: start clean */ }
  production.notes = stack || new NoteStack();
  production.noteStackChanged();
}

/** Every mutation funnels through here: playback overlay + persistence. */
function notesChanged() {
  production.noteStackChanged();
  saveNotes();
}

// ---------------------------------------------------------------------------
// Loading a script
// ---------------------------------------------------------------------------

/** Total beats across every scene — the honest measure of "did anything parse". */
function countBeats(script) {
  return script.scenes.reduce((n, s) => n + s.beats.length, 0);
}

function stageScript(text) {
  state.scriptText = text;
  // Kept so a reload comes back to the writer's script rather than the demo —
  // which is also what lets imported avatars find their character again.
  remember(SCRIPT_KEY, text);
  speech.cancel();
  const script = production.load(text, state.overrides);
  // Fire-and-forget: a provisional plan lands synchronously, the real voices
  // land when the list resolves. Pinned voices survive re-assignment.
  speech.assignVoices(script.characters, production.specs);
  loadNotes(text);
  ui.prodTitle.textContent = script.meta.title || 'Playhouse';
  document.title = `${script.meta.title || 'Playhouse'} — Playhouse`;
  state.lyricTimings = [];
  drawSceneMarks();
  if (state.panel === 'cast') renderPanel('cast');
  if (state.panel === 'audio') renderPanel('audio');
  if (state.panel === 'notes') renderPanel('notes');
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

  // A loaded recording silences TTS outright: the recording is the
  // performance, and two clocks fighting is worse than either alone.
  speech.suppressed = state.audioMaster && audio.loaded;
  // A line already sounding when the recording becomes master (mid-line upload
  // or "Audio drives timing" toggle) must stop too — suppressed only gates
  // NEW speaks, and a stale `holding` would otherwise freeze the plan clock.
  if (speech.suppressed && speech.speaking) speech.cancel();
  speech.update(dt);

  // When a recording is loaded it is the master clock — the performance
  // follows the music, never the other way round.
  let external = null;
  if (state.audioMaster && audio.loaded) {
    if (production.playing && !audio.playing) audio.play(production.time);
    if (!production.playing && audio.playing) audio.pause();
    if (audio.playing) external = audio.currentTime;
  }
  // An overrunning spoken line stalls the plan clock (bounded, inside speech):
  // passing production.time back as the external clock freezes it exactly.
  // The recording's clock outranks the stall — it was checked first.
  if (external === null && speech.holding) external = production.time;

  production.update(dt, elapsed, external);

  // Live lip sync — the recording's amplitude wins, then the TTS envelope.
  // Must run EVERY frame: mouthTarget decays per frame inside the Animator.
  const speakerName = production.currentBeat?.character;
  const animator = speakerName ? production.animators.get(speakerName) : null;
  if (animator) {
    const src = audio.playing
      ? audio.level() * 0.9
      : (speech.speaking && speech.character === speakerName ? speech.level() : null);
    // While an external source is live it owns the jaw; otherwise the
    // procedural talk layer takes back over (e.g. speech off or un-armed).
    animator.setExternalMouth(src !== null);
    if (src !== null) animator.setMouthOpen(src);
  }

  engine.render(elapsed);
  updateTransport();
}

// Speak once per BEAT — dialogue beats subdivide into up to three shots that
// share one beat object, and production fires this exactly once per beat.
let lastSpeaker = null;
production.onBeatChange = (beat) => {
  if (lastSpeaker && lastSpeaker !== beat?.character) {
    production.animators.get(lastSpeaker)?.setExternalMouth(false);
  }
  lastSpeaker = beat?.character || null;
  if (!beat) return;
  if (state.audioMaster && audio.loaded) return; // the recording is the voice
  // Mirrors director.js's slot maths exactly; speakBeat rate-fits into it.
  const slot = Math.max(0.8, (beat.duration || 1.5) / (production.pace ?? 1));
  speech.speakBeat(beat, production.specs.get(beat.character), { slotSeconds: slot });
};

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
  // MUST be the first statement: on Safari an `await` before this breaks the
  // gesture chain and every later speechSynthesis.speak() is silently dropped.
  speech.unlock();
  if (!production.playing) {
    await audio.resume();
    production.play();
    if (state.audioMaster && audio.loaded) audio.play(production.time);
  } else {
    production.pause();
    if (audio.playing) audio.pause();
    // cancel, never speechSynthesis.pause() — pause/resume is broken on iOS.
    speech.cancel();
  }
});

let scrubbing = false;
function scrubTo(clientX) {
  const rect = ui.scrub.getBoundingClientRect();
  const t = THREE.MathUtils.clamp((clientX - rect.left) / rect.width, 0, 1);
  speech.cancel(); // a scrubbed-into line restarts from its own top
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

// Tap the picture to hide the interface. Any first touch also arms speech.
canvas.addEventListener('click', () => {
  speech.unlock();
  state.chromeHidden = !state.chromeHidden;
  ui.chrome.classList.toggle('hidden', state.chromeHidden);
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); ui.btnPlay.click(); }
  if (e.code === 'ArrowRight') { speech.cancel(); production.seek(production.time + 5); }
  if (e.code === 'ArrowLeft') { speech.cancel(); production.seek(production.time - 5); }
});

// Mobile browsers cancel utterances unreliably on navigation — without these
// the voice keeps talking after the user has left the page.
window.addEventListener('pagehide', () => speech.cancel());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') speech.cancel();
});

// ---------------------------------------------------------------------------
// Sheet & panels
// ---------------------------------------------------------------------------

function openPanel(name) {
  if (state.panel === name) { closeSheet(); return; }
  // Giving a note means standing still on the moment being noted.
  if (name === 'notes' && production.playing) {
    production.pause();
    if (audio.playing) audio.pause();
    speech.cancel();
  }
  state.panel = name;
  ui.sheet.classList.add('open');
  ui.sheetTitle.textContent = name === 'notes' ? 'Director notes' : name;
  ui.tabs.forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
  renderPanel(name);
}
function closeSheet() {
  state.panel = null;
  ui.sheet.classList.remove('open');
  ui.tabs.forEach((t) => t.classList.remove('active'));
}
ui.tabs.forEach((t) => t.addEventListener('click', () => {
  speech.unlock(); // any first touch arms the speech engine
  openPanel(t.dataset.panel);
}));
ui.btnCloseSheet.addEventListener('click', closeSheet);

function renderPanel(name) {
  const body = ui.sheetBody;
  body.innerHTML = '';
  if (name === 'script') renderScriptPanel(body);
  else if (name === 'cast') renderCastPanel(body);
  else if (name === 'audio') renderAudioPanel(body);
  else if (name === 'look') renderLookPanel(body);
  else if (name === 'notes') renderNotesPanel(body);
}

// --- Script -----------------------------------------------------------------

const STATUS_COLOURS = { ok: 'var(--ink-dim)', warn: '#e0a850', error: '#e08a8a' };

function renderScriptPanel(body) {
  const ta = document.createElement('textarea');
  ta.value = state.scriptText;
  ta.spellcheck = false;
  // The panel is rebuilt from scratch on every open, so the textarea is not the
  // buffer — state is. Without this, typing lives only in a node that the next
  // render throws away, and "Stage it" re-stages whatever was last staged.
  // The draft also goes to localStorage (debounced — this fires per keystroke)
  // so a reload mid-writing does not cost the writer their unstaged work.
  ta.oninput = () => {
    state.scriptText = ta.value;
    clearTimeout(renderScriptPanel._save);
    renderScriptPanel._save = setTimeout(() => remember(SCRIPT_KEY, state.scriptText), 400);
  };
  body.appendChild(ta);

  const status = document.createElement('div');
  status.className = 'hint';
  status.style.margin = '0 0 10px';

  const setStatus = (text, tone = 'ok') => {
    state.scriptStatus = text ? { text, tone } : null;
    status.textContent = text || '';
    status.style.color = STATUS_COLOURS[tone] || STATUS_COLOURS.ok;
  };
  if (state.scriptStatus) setStatus(state.scriptStatus.text, state.scriptStatus.tone);

  const row = document.createElement('div');
  row.className = 'row';
  const stage = document.createElement('button');
  stage.className = 'btn primary';
  stage.textContent = 'Stage it';
  stage.onclick = () => {
    const text = ta.value;
    state.scriptText = text;

    // Parse before committing: a script that yields nothing would otherwise
    // tear down a working production and leave a bare stage with no
    // explanation. Parsing is pure and cheap, so this costs nothing real.
    let preview;
    try {
      preview = parseScript(text);
    } catch (err) {
      console.error(err);
      setStatus(`This script could not be parsed: ${err.message}`, 'error');
      toast('Could not parse that script — see the Script panel', 4000);
      return;
    }

    const beats = countBeats(preview);
    if (!beats) {
      // parseScript never reports zero scenes — it invents an empty stage — so
      // honesty about "you wrote headings but nothing under them" has to come
      // from counting heading lines in the text itself.
      const headings = (text.match(/^\s*(?:INT|EXT)[.\s]/gim) || []).length;
      const why = headings
        ? `Found ${headings} scene heading${headings === 1 ? '' : 's'} `
          + 'but no dialogue or action underneath.'
        : 'No scene headings, dialogue or action were found.';
      setStatus(`Nothing staged. ${why} Scene headings start with INT. or EXT.; a line in `
        + 'CAPS with text on the line below it is a character cue. The previous production '
        + 'is still loaded.', 'error');
      toast('Nothing to stage — see the Script panel', 4000);
      return;
    }

    let staged;
    try {
      staged = stageScript(text);
    } catch (err) {
      // Real failures belong on screen, not in a swallowed catch.
      console.error(err);
      setStatus(`Staging failed: ${err.message}`, 'error');
      toast(`Staging failed: ${err.message}`, 4600);
      return;
    }

    const shots = production.plan?.shots?.length ?? 0;
    const summary = `${staged.scenes.length} scene${staged.scenes.length === 1 ? '' : 's'}, `
      + `${staged.characters.length} speaking part${staged.characters.length === 1 ? '' : 's'}, `
      + `${beats} beat${beats === 1 ? '' : 's'}, ${shots} shot${shots === 1 ? '' : 's'}`;

    production.seek(0);
    production.play();

    if (!staged.characters.length) {
      // It stages — action-only scenes are legitimate — but silence about it
      // is how a mis-typed cue looks like the app ignoring you.
      setStatus(`Staged “${staged.meta.title}” with no speaking parts: ${summary}. `
        + 'Every line was read as action. A character cue is a line in CAPS with '
        + 'the dialogue on the line directly below it.', 'warn');
      toast('Staged, but no speaking parts were found', 4200);
      return;
    }

    setStatus(`Staged “${staged.meta.title}” — ${summary}: `
      + `${staged.characters.map((c) => c.name).join(', ')}.`, 'ok');
    closeSheet();
    toast(summary);
  };
  const reset = document.createElement('button');
  reset.className = 'btn';
  reset.textContent = 'Load sample';
  reset.onclick = () => {
    // Assigning .value fires no input event, so the buffer needs setting too.
    ta.value = SAMPLE;
    state.scriptText = SAMPLE;
    setStatus('Sample loaded — press Stage it to put it on its feet.', 'ok');
  };
  row.append(stage, reset);
  body.appendChild(row);
  body.appendChild(status);

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
    <p><strong>Props</strong> named in action lines get built into the set automatically, and
    "picks up the apple" / "sets it down" put them in and out of hands.</p>
    <p><strong>Notes.</strong> Pause playback and tap <code>+ Note</code> to direct any moment in
    plain words — "wider", "closer on a name", "make it handheld", "she carries the lantern".</p>`;
  body.appendChild(hint);
}

// --- Cast -------------------------------------------------------------------

// A filtered picker is a convenience on the desktop — its dialogs always have
// an "All files" escape hatch — and a wall on a phone: iOS maps accept tokens
// to UTIs, and .vrm/.fbx have none registered, so a filtered Files sheet greys
// out exactly the files this panel exists to import. loadAvatar() sniffs the
// real format from the bytes and never trusts the extension, so on touch
// devices the picker accepts everything and the loader is the gate.
const AVATAR_ACCEPT = (navigator.maxTouchPoints || 0) > 0
  || (window.matchMedia?.('(any-pointer: coarse)').matches ?? false)
  ? ''
  : '.glb,.gltf,.vrm,.fbx,model/gltf-binary';

/** How the mouth ended up being driven — visemes, a synthesised jaw, or nothing. */
function describeMouth(report) {
  if (report.generatedJaw) {
    return `jaw generated across ${report.generatedJaw.meshes} mesh`
      + `${report.generatedJaw.meshes === 1 ? '' : 'es'}`;
  }
  return report.visemes ? 'visemes found' : 'no visemes and no jaw — the mouth will not move';
}

/** Import a .glb/.vrm/.fbx for a character and report how well it mapped. */
async function importAvatarFor(name, file) {
  // A 27 MB Mixamo rig takes seconds to parse and retarget. Hold the notice
  // open for the whole of it and put a spinner on the card, or the interface
  // looks dead exactly when it is working hardest.
  state.importing.set(name, file.name);
  if (state.panel === 'cast') renderPanel('cast');
  toast(`Loading ${file.name} — a large avatar takes a few seconds…`, 0);

  try {
    const buffer = await file.arrayBuffer();
    const report = await production.setAvatar(name, buffer, file.name);
    const saved = await saveAvatarFile(name, buffer, file.name);
    const warn = report.unmapped.length
      ? ` · ${report.unmapped.length} bone${report.unmapped.length === 1 ? '' : 's'} unmapped`
      : '';
    toast(`${name}: ${report.retargeted}/21 bones retargeted, ${describeMouth(report)}${warn}`
      + `${saved ? '' : ' · could not be saved for next time'}`, 5200);
  } catch (err) {
    toast(`Could not load ${file.name}: ${err.message}`, 6000);
    console.error(err);
  } finally {
    state.importing.delete(name);
    if (state.panel === 'cast') renderPanel('cast');
  }
}

/** Re-attach avatars saved in a previous session. */
async function restoreAvatars() {
  const stored = await loadStoredAvatars();
  let restored = 0;
  const failed = [];
  for (const [name, record] of stored) {
    // A stored avatar for a character the current script does not have is not
    // an error: it waits, and re-attaches if that character comes back.
    if (!production.cast.has(name)) continue;
    try {
      await production.setAvatar(name, record.buffer, record.filename);
      restored++;
    } catch (err) {
      failed.push(name);
      console.error(`Could not restore the avatar for ${name}`, err);
    }
  }
  if (failed.length) {
    toast(`Could not restore ${failed.join(', ')} — re-import from the Cast panel`, 5000);
  } else if (restored) {
    toast(`Restored ${restored} imported avatar${restored === 1 ? '' : 's'}`);
  }
  return restored;
}

function renderCastPanel(body) {
  const script = production.script;
  if (!script?.characters.length) {
    body.innerHTML = '<div class="hint">No speaking parts found yet. Stage a script first.</div>';
    return;
  }

  const intro = document.createElement('div');
  intro.className = 'hint';
  intro.style.marginBottom = '10px';
  intro.innerHTML = `Import a <code>.glb</code>, <code>.vrm</code> or <code>.fbx</code> per character
    for a much higher quality cast — make them free at <strong>readyplayer.me</strong> (browser,
    exports .glb with visemes), <strong>VRoid Studio</strong> (.vrm) or <strong>Mixamo</strong>
    (.fbx; it ships no facial rig, so a jaw is synthesised for it here). Everything they do on
    stage — walking, gesturing, eye contact, lip sync — is driven here, so you never supply
    animation. Skin and costume are baked into the file, so make one avatar per character.`;
  body.appendChild(intro);

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

    // --- Imported avatar ---------------------------------------------------
    const imported = production.avatars.get(record.name);
    const importingFile = state.importing.get(record.name);
    const avatarRow = document.createElement('div');
    avatarRow.className = 'row';
    avatarRow.style.margin = '4px 0 10px';

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = AVATAR_ACCEPT;
    picker.style.display = 'none';
    picker.onchange = () => {
      const file = picker.files?.[0];
      // Clear before importing so re-picking the same file still fires change.
      picker.value = '';
      if (file) importAvatarFor(record.name, file);
    };
    avatarRow.appendChild(picker);

    const importBtn = document.createElement('button');
    importBtn.className = imported ? 'btn small' : 'btn small primary';
    importBtn.textContent = importingFile ? 'Loading…' : imported ? 'Replace avatar' : 'Import avatar';
    importBtn.disabled = !!importingFile;
    importBtn.onclick = () => picker.click();
    avatarRow.appendChild(importBtn);

    if (importingFile) {
      const busy = document.createElement('div');
      busy.className = 'hint';
      busy.style.cssText = 'width:100%;margin:2px 0 0';
      busy.textContent = `Loading ${importingFile} — parsing and retargeting can take a few seconds…`;
      avatarRow.appendChild(busy);
    }

    if (imported) {
      const drop = document.createElement('button');
      drop.className = 'btn small';
      drop.textContent = 'Remove';
      drop.disabled = !!importingFile;
      drop.onclick = async () => {
        await clearStoredAvatar(record.name);
        production.clearAvatar(record.name);
        renderPanel('cast');
      };
      avatarRow.appendChild(drop);

      const status = document.createElement('div');
      status.className = 'hint';
      status.style.cssText = 'width:100%;margin:2px 0 0';
      const r = imported.report;
      status.innerHTML = `<strong>${r.kind.toUpperCase()}</strong> · ${r.retargeted}/21 bones ·
        ${r.visemes ? `${r.morphTargets} morphs, visemes ✓` : 'no visemes'} ·
        scaled ×${r.appliedScale}
        ${r.unmapped.length ? `<br><span style="color:#c9a">unmapped: ${r.unmapped.join(', ')}</span>` : ''}`;
      avatarRow.appendChild(status);
    }
    card.appendChild(avatarRow);

    // Voice pick applies to imported and procedural bodies alike.
    if (speech.supported) {
      const sel = document.createElement('select');
      const plan = speech.planFor(record.name);
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = `Auto${plan?.voice ? ` — ${plan.voice.name}` : ''}`;
      sel.appendChild(auto);
      for (const v of speech.voices) {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        if (state.voices[record.name] === v.voiceURI) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => {
        const uri = sel.value || null;
        if (uri) state.voices[record.name] = uri;
        else delete state.voices[record.name];
        remember(VOICE_KEY, JSON.stringify(state.voices));
        speech.setVoiceOverride(record.name, uri);
      };
      card.appendChild(field('Voice', sel));
    }

    // Procedural controls only matter when there's no imported body.
    if (imported) {
      const note = document.createElement('div');
      note.className = 'hint';
      note.textContent = 'Skin, hair and costume come from the imported file. '
        + 'Poses, walk, gestures and lip sync are driven here.';
      card.appendChild(note);
      body.appendChild(card);
      continue;
    }

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
  // --- Spoken dialogue (browser TTS) --------------------------------------
  const voicesCard = document.createElement('div');
  voicesCard.className = 'card';
  voicesCard.innerHTML = '<h4>Spoken dialogue</h4>';
  if (!speech.supported) {
    const no = document.createElement('div');
    no.className = 'hint';
    no.textContent = 'This browser has no speech synthesis — captions and the performance still play.';
    voicesCard.appendChild(no);
  } else {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.marginBottom = '8px';
    hint.textContent = 'Characters read their lines with browser voices, cast by build and height '
      + '(pick a voice per character in the Cast panel). Speech is a separate output from a loaded '
      + 'recording — it cannot be mixed into it, and iPhones ignore its volume (use the hardware '
      + 'buttons). Press play once to let the browser start speaking.';
    voicesCard.appendChild(hint);

    const toggles = document.createElement('div');
    toggles.className = 'row';
    const mkToggle = (label, get, set) => {
      const b = document.createElement('button');
      b.className = 'btn';
      const paint = () => { b.textContent = get() ? `${label} ✓` : label; };
      paint();
      b.onclick = () => { set(!get()); paint(); saveSpeechPrefs(); };
      return b;
    };
    toggles.append(
      mkToggle('Speak dialogue', () => speech.enabled, (v) => {
        speech.enabled = v;
        if (!v) speech.cancel();
      }),
      // Honest label: SpeechSynthesis has no melody — this reads, it never sings.
      mkToggle('Read lyrics aloud (spoken, not sung)', () => speech.speakLyrics, (v) => {
        speech.speakLyrics = v;
      }),
    );
    voicesCard.appendChild(toggles);
  }
  body.appendChild(voicesCard);

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

// --- Director notes ---------------------------------------------------------

/** Human echo of a parsed directive, so the user sees what was understood. */
function describeDirective(d) {
  if (!d || d.error) return d?.error || 'Nothing understood';
  if (d.kind === 'prop') {
    const who = d.character || 'whoever is in shot';
    if (d.action === 'hold') {
      const known = d.prop && propsMentioned(d.prop).length;
      return `${who} holds the ${d.prop}`
        + (known ? '' : ` — no model for “${d.prop}”, so nothing will appear`);
    }
    return d.prop ? `${who} puts down the ${d.prop}` : `${who}: hands emptied`;
  }
  const bits = [];
  if (d.size) bits.push(`shot size → ${d.size}`);
  if (d.sizeStep) {
    bits.push(`${d.sizeStep > 0 ? 'wider' : 'closer'} → shot size ${d.sizeStep > 0 ? '+' : ''}${d.sizeStep}`);
  }
  if (d.move) bits.push(`camera → ${d.move}`);
  if (d.height) bits.push(`${d.height} angle`);
  if (d.subject) bits.push(`frame ${d.subject}`);
  if (d.cut) bits.push('cut to them');
  if (d.durationScale) bits.push(`hold ×${d.durationScale}`);
  return bits.join(' · ') || 'no change';
}

function renderNotesPanel(body) {
  const cast = production.script?.characters.map((c) => c.name) ?? [];

  const intro = document.createElement('div');
  intro.className = 'hint';
  intro.style.marginBottom = '8px';
  intro.innerHTML = `Pinned to <strong>${fmt(production.time)}</strong> — scrub first if the moment
    is elsewhere. Camera notes season the shot they land on: <code>wider</code>,
    <code>closer on ${cast[0] || 'MIREN'}</code>, <code>low angle</code>, <code>make it shake</code>,
    <code>hold this shot longer</code>. Prop notes stick until changed:
    <code>${cast[0] || 'she'} carries the lantern</code>, <code>put it down</code>.`;
  body.appendChild(intro);

  const row = document.createElement('div');
  row.className = 'row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Give a note…';
  input.style.cssText = 'flex:1;min-width:0;background:var(--panel);color:var(--ink);'
    + 'border:1px solid var(--line);border-radius:8px;padding:9px;font-size:13px';
  const add = document.createElement('button');
  add.className = 'btn primary';
  add.textContent = 'Add';
  row.append(input, add);
  body.appendChild(row);

  // Live echo: the parsed interpretation (or the honest failure) as they type.
  const echo = document.createElement('div');
  echo.className = 'hint';
  echo.style.margin = '0 0 10px';
  const setEcho = (text, tone = 'ok') => {
    state.noteStatus = text ? { text, tone } : null;
    echo.textContent = text || '';
    echo.style.color = STATUS_COLOURS[tone] || STATUS_COLOURS.ok;
  };
  if (state.noteStatus) setEcho(state.noteStatus.text, state.noteStatus.tone);
  body.appendChild(echo);

  input.oninput = () => {
    const text = input.value.trim();
    if (!text) { setEcho(''); return; }
    const d = parseNote(text, cast);
    if (d.error) setEcho(d.error, 'warn');
    else setEcho(`Reads as: ${describeDirective(d)}`, 'ok');
  };

  const commit = () => {
    const text = input.value.trim();
    if (!text) return;
    const note = production.notes.addNote(production.time, production.sceneIndex, text, cast);
    if (note.error) {
      setEcho(`${note.error}. Try camera words (wider, closer on a name, low angle, handheld) `
        + 'or prop words (carries the lantern, puts it down).', 'error');
      return;
    }
    notesChanged();
    input.value = '';
    setEcho(`Pinned at ${fmt(note.time)} — ${describeDirective(note.directive)}`, 'ok');
    renderPanel('notes');
  };
  add.onclick = commit;
  input.onkeydown = (e) => { if (e.key === 'Enter') commit(); };

  const historyRow = document.createElement('div');
  historyRow.className = 'row';
  const mkHistory = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = label;
    b.onclick = () => {
      const n = fn();
      if (!n) { setEcho(`Nothing to ${label.toLowerCase()}`, 'warn'); return; }
      notesChanged();
      setEcho(`${label.replace(/o$/, 'i')}d: “${n.text}”`, 'ok');
      renderPanel('notes');
    };
    return b;
  };
  historyRow.append(
    mkHistory('Undo', () => production.notes.undo()),
    mkHistory('Redo', () => production.notes.redo()),
  );
  body.appendChild(historyRow);

  const notes = production.notes.list();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'No notes yet. They save with this script and replay every time.';
    body.appendChild(empty);
    return;
  }

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h4>${notes.length} note${notes.length === 1 ? '' : 's'}</h4>`;
  for (const note of notes) {
    const r = document.createElement('div');
    r.className = 'lyricrow';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = fmt(note.time);
    const x = document.createElement('div');
    x.className = 'x';
    const line = document.createElement('div');
    line.textContent = note.text;
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:var(--ink-dim)';
    sub.textContent = describeDirective(note.directive);
    x.append(line, sub);
    if (!note.enabled) x.style.opacity = '0.4';

    const onoff = document.createElement('button');
    onoff.className = 'btn small';
    onoff.textContent = note.enabled ? 'On' : 'Off';
    onoff.onclick = () => {
      production.notes.toggle(note.id);
      notesChanged();
      renderPanel('notes');
    };
    const del = document.createElement('button');
    del.className = 'btn small';
    del.textContent = '✕';
    del.onclick = () => {
      production.notes.remove(note.id);
      notesChanged();
      renderPanel('notes');
    };
    r.append(t, x, onoff, del);
    card.appendChild(r);
  }
  body.appendChild(card);
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

/**
 * Boot with the writer's saved script when it still stages; otherwise the demo
 * plays and the saved draft stays in the editor for repair instead of being
 * silently discarded.
 */
function stageInitialScript() {
  const saved = recall(SCRIPT_KEY);
  if (saved && saved !== SAMPLE) {
    try {
      if (countBeats(parseScript(saved)) > 0) { stageScript(saved); return; }
    } catch (err) {
      console.error('Stored script failed to stage; falling back to the sample', err);
    }
    stageScript(SAMPLE);
    // stageScript(SAMPLE) just overwrote both the buffer and the stored copy —
    // put the draft back so a reload mid-repair still returns to it.
    state.scriptText = saved;
    remember(SCRIPT_KEY, saved);
    state.scriptStatus = {
      text: 'Restored your saved draft, but it does not stage yet, so the demo is playing. '
        + 'Press Stage it when it is ready.',
      tone: 'warn',
    };
    return;
  }
  stageScript(SAMPLE);
}

try {
  stageInitialScript();
  ui.bootMsg.textContent = 'Ready';
  setTimeout(() => ui.boot.classList.add('gone'), 260);
  production.seek(0);
  production.play();
  frame();
  // Async on purpose: a slow IndexedDB read must not hold the curtain.
  restoreAvatars().catch((err) => console.error('Avatar restore failed', err));
  // Say what's new exactly once, after the curtain is up.
  if (!recall(HINT_KEY)) {
    remember(HINT_KEY, '1');
    setTimeout(() => toast('New: the cast now speaks their lines — and you can pause '
      + 'and tap “+ Note” to direct the camera and props in plain words.', 7000), 1600);
  }
} catch (err) {
  ui.bootMsg.innerHTML = `Failed to start.<br><span style="font-size:11px;color:#c88">${err.message}</span>`;
  console.error(err);
}

// Expose for debugging from a device console.
window.playhouse = { engine, production, audio, speech, stageScript, THREE };
