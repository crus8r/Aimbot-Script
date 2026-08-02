/**
 * Fountain-flavoured screenplay / libretto parser.
 *
 * Accepts standard Fountain plus a few additions that matter for staged
 * musicals: `~` lyric lines are grouped into song blocks, and `[[ ... ]]`
 * notes are lifted into machine-readable staging cues.
 *
 * Output is deliberately engine-agnostic: a plain object the director can
 * consume without knowing anything about Three.js.
 */

const SCENE_PREFIX = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|EST\.?|I\/E)[\s.]/i;
const TRANSITION = /^(CUT TO|FADE OUT|FADE TO BLACK|FADE IN|DISSOLVE TO|SMASH CUT TO|MATCH CUT TO|INTERCUT|BLACKOUT|CURTAIN)[:.]?$/i;
const TIME_OF_DAY = /\s[-–—]\s*([A-Z' ]+)$/;
const CHARACTER_EXT = /\s*\((V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D|SINGING|SUNG|SPOKEN|OFF)\)\s*$/i;

/** Abilities the VFX layer knows how to stage. */
export const ABILITIES = [
  'light', 'fire', 'frost', 'telekinesis', 'heal',
  'teleport', 'shield', 'illusion', 'shadow', 'wind',
];

/** Loose keyword -> ability, so plain prose still triggers effects. */
const ABILITY_WORDS = {
  light: ['conjure', 'glow', 'glows', 'glowing', 'radiance', 'lumen', 'illuminate', 'spark', 'shimmer'],
  fire: ['flame', 'flames', 'fire', 'ignite', 'ignites', 'burn', 'burns', 'blaze', 'ember', 'scorch'],
  frost: ['frost', 'freeze', 'freezes', 'ice', 'icy', 'chill', 'winter'],
  telekinesis: ['lifts', 'levitate', 'levitates', 'floats', 'hovers', 'rises', 'telekines'],
  heal: ['heal', 'heals', 'healing', 'mend', 'mends', 'restore', 'restores'],
  teleport: ['vanish', 'vanishes', 'teleport', 'teleports', 'blink', 'disappears'],
  shield: ['shield', 'shields', 'ward', 'wards', 'barrier', 'protect'],
  illusion: ['illusion', 'phantom', 'mirage', 'apparition', 'conjures'],
  shadow: ['shadow', 'shadows', 'darkness', 'gloom', 'umbra'],
  wind: ['wind', 'gust', 'gale', 'storm', 'whirl'],
};

/** Emotion lexicon drives both posing and shot selection. */
const EMOTION_WORDS = {
  angry: ['angry', 'furious', 'rage', 'snarls', 'shouting', 'shouts', 'seething', 'sharp', 'bitter', 'hard'],
  tender: ['tender', 'gentle', 'softly', 'soft', 'quietly', 'warm', 'loving', 'kind', 'fondly'],
  afraid: ['afraid', 'frightened', 'terrified', 'trembling', 'scared', 'panicked', 'shaking'],
  sad: ['sad', 'grieving', 'weeping', 'crying', 'mournful', 'hollow', 'broken', 'aching'],
  joyful: ['delighted', 'laughing', 'joyful', 'bright', 'thrilled', 'beaming', 'grinning'],
  resolute: ['firm', 'resolute', 'determined', 'steady', 'certain', 'decisive', 'flat'],
  wonder: ['awed', 'wonder', 'amazed', 'breathless', 'reverent', 'astonished'],
};

const isBlank = (s) => s.trim().length === 0;
const upperish = (s) => s === s.toUpperCase() && /[A-Z]/.test(s);

/** Detect an emotion label from free text, or null. */
function detectEmotion(text) {
  if (!text) return null;
  const low = ` ${text.toLowerCase().replace(/[^a-z' ]/g, ' ')} `;
  for (const [emotion, words] of Object.entries(EMOTION_WORDS)) {
    if (words.some((w) => low.includes(` ${w} `))) return emotion;
  }
  if (/!\s*!/.test(text)) return 'angry';
  if (/!/.test(text)) return 'resolute';
  if (/\.\.\./.test(text)) return 'afraid';
  return null;
}

/** Rough intensity 0..1 — used to decide when to push in for a close-up. */
function detectIntensity(text) {
  if (!text) return 0.3;
  let score = 0.3;
  if (/!/.test(text)) score += 0.25;
  if (/!\s*!/.test(text)) score += 0.2;
  if (text === text.toUpperCase() && text.length > 8) score += 0.2;
  if (/\?/.test(text)) score += 0.05;
  if (text.length < 24) score += 0.1;
  return Math.min(1, score);
}

/**
 * Pull explicit `[[ ... ]]` cues out of a line.
 * Forms accepted:
 *   [[fire]]                      – ability, actor inferred from context
 *   [[fire: LYRA]]                – ability by actor
 *   [[fire: LYRA -> DOOR]]        – ability by actor at target
 *   [[enter: LYRA left]]          – staging directive
 */
function extractCues(raw, fallbackActor) {
  const cues = [];
  const text = raw.replace(/\[\[(.+?)\]\]/g, (_, body) => {
    const [headRaw, tailRaw = ''] = body.split(':');
    const head = headRaw.trim().toLowerCase();
    const [actorRaw, targetRaw] = tailRaw.split(/->|→/);
    const cue = {
      kind: ABILITIES.includes(head) ? 'ability' : head,
      ability: ABILITIES.includes(head) ? head : null,
      actor: (actorRaw || '').trim().toUpperCase() || fallbackActor || null,
      target: (targetRaw || '').trim().toUpperCase() || null,
    };
    cues.push(cue);
    return '';
  });
  return { text: text.replace(/\s{2,}/g, ' ').trim(), cues };
}

/** Infer an ability cue from ordinary prose, so unmarked scripts still work. */
function inferCue(text, knownCharacters) {
  const low = ` ${text.toLowerCase().replace(/[^a-z' ]/g, ' ')} `;
  for (const [ability, words] of Object.entries(ABILITY_WORDS)) {
    if (!words.some((w) => low.includes(` ${w} `))) continue;
    const upper = text.toUpperCase();
    const actor = knownCharacters.find((c) => upper.includes(c)) || null;
    return { kind: 'ability', ability, actor, target: null, inferred: true };
  }
  return null;
}

/** Split "INT. THE PARLOUR - NIGHT" into its parts. */
function parseHeading(line) {
  const interior = /^(INT|EST|I\/E)/i.test(line);
  let body = line.replace(SCENE_PREFIX, '').trim();
  let timeOfDay = 'DAY';
  const match = body.match(TIME_OF_DAY);
  if (match) {
    timeOfDay = match[1].trim();
    body = body.slice(0, match.index).trim();
  }
  return {
    heading: line,
    location: body.replace(/[.,]$/, '').trim() || 'STAGE',
    timeOfDay,
    interior: interior || /\b(ROOM|PARLOUR|PARLOR|HALL|KITCHEN|CHAMBER|LIBRARY|ATTIC|CELLAR)\b/i.test(body),
  };
}

/**
 * Parse a script into scenes and beats.
 * @param {string} source raw Fountain-ish text
 */
export function parseScript(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const meta = { title: 'Untitled', author: '', credit: '' };
  const scenes = [];
  const characters = new Map();

  let cursor = 0;

  // --- Title page: leading `Key: Value` block ------------------------------
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (isBlank(line)) { cursor++; continue; }
    const kv = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (!kv || SCENE_PREFIX.test(line)) break;
    const key = kv[1].trim().toLowerCase();
    if (!['title', 'author', 'authors', 'credit', 'source', 'draft date', 'contact'].includes(key)) break;
    if (key === 'title') meta.title = kv[2].trim();
    else if (key.startsWith('author')) meta.author = kv[2].trim();
    else if (key === 'credit') meta.credit = kv[2].trim();
    cursor++;
  }

  let scene = null;
  const openScene = (headingLine) => {
    scene = { ...parseHeading(headingLine), index: scenes.length, beats: [] };
    scenes.push(scene);
    return scene;
  };
  const ensureScene = () => scene || openScene('INT. STAGE - NIGHT');

  const pushBeat = (beat) => {
    const s = ensureScene();
    beat.id = `${s.index}.${s.beats.length}`;
    beat.scene = s.index;
    s.beats.push(beat);
    return beat;
  };

  let songId = 0;
  let activeSong = null;
  let lastSpeaker = null;

  for (; cursor < lines.length; cursor++) {
    const raw = lines[cursor];
    const line = raw.trim();

    if (isBlank(line)) { activeSong = null; continue; }
    if (line.startsWith('/*') || line.startsWith('#')) continue; // notes & section headers

    // --- Scene heading ----------------------------------------------------
    if (SCENE_PREFIX.test(line) || (line.startsWith('.') && !line.startsWith('..'))) {
      openScene(line.startsWith('.') ? `INT. ${line.slice(1).trim()}` : line);
      activeSong = null;
      lastSpeaker = null;
      continue;
    }

    // --- Transition -------------------------------------------------------
    if (TRANSITION.test(line) || line.startsWith('>')) {
      pushBeat({ type: 'transition', text: line.replace(/^>/, '').trim(), duration: 1.2 });
      continue;
    }

    // --- Lyric line -------------------------------------------------------
    if (line.startsWith('~')) {
      const text = line.slice(1).trim();
      if (!activeSong) {
        songId += 1;
        activeSong = { id: `song${songId}`, lineIndex: 0 };
      }
      const { text: clean, cues } = extractCues(text, lastSpeaker);
      pushBeat({
        type: 'lyric',
        character: lastSpeaker,
        text: clean,
        song: activeSong.id,
        songLine: activeSong.lineIndex++,
        emotion: detectEmotion(clean) || 'wonder',
        intensity: detectIntensity(clean),
        cues,
        duration: estimateDuration(clean, true),
      });
      continue;
    }

    // --- Character cue ----------------------------------------------------
    const forcedCharacter = line.startsWith('@');
    const candidate = forcedCharacter ? line.slice(1).trim() : line;
    const nameOnly = candidate.replace(CHARACTER_EXT, '').trim();
    const nextLine = lines[cursor + 1];
    const looksLikeCharacter =
      (forcedCharacter || (upperish(candidate) && !/[.!?,]$/.test(candidate) && nameOnly.length <= 40)) &&
      nextLine !== undefined && !isBlank(nextLine);

    if (looksLikeCharacter) {
      const name = nameOnly.toUpperCase();
      lastSpeaker = name;
      if (!characters.has(name)) {
        characters.set(name, { name, lines: 0, songLines: 0, firstScene: ensureScene().index });
      }
      const singing = /SINGING|SUNG/i.test(candidate);

      // Collect the dialogue block that follows.
      let parenthetical = null;
      const parts = [];
      let k = cursor + 1;
      for (; k < lines.length && !isBlank(lines[k]); k++) {
        const dl = lines[k].trim();
        if (/^\(.*\)$/.test(dl)) { parenthetical = dl.slice(1, -1).trim(); continue; }
        if (dl.startsWith('~')) break; // lyric block follows the cue
        parts.push(dl);
      }
      cursor = k - 1;

      const joined = parts.join(' ').trim();
      if (joined) {
        const { text, cues } = extractCues(joined, name);
        const record = characters.get(name);
        record.lines += 1;
        if (singing) record.songLines += 1;
        pushBeat({
          type: 'dialogue',
          character: name,
          parenthetical,
          text,
          singing,
          emotion: detectEmotion(parenthetical) || detectEmotion(text) || 'neutral',
          intensity: detectIntensity(text),
          cues,
          duration: estimateDuration(text, singing),
        });
      }
      continue;
    }

    // --- Action -----------------------------------------------------------
    const { text, cues } = extractCues(line, lastSpeaker);
    if (!text && cues.length) {
      cues.forEach((c) => pushBeat({ type: 'cue', ...c, duration: 1.4 }));
      continue;
    }
    if (!text) continue;
    const inferred = cues.length ? null : inferCue(text, [...characters.keys()]);
    pushBeat({
      type: 'action',
      text,
      cues: inferred ? [inferred] : cues,
      emotion: detectEmotion(text),
      intensity: detectIntensity(text) * 0.7,
      duration: estimateDuration(text, false) * 0.75,
    });
  }

  // Characters mentioned only in action lines still deserve a body on stage.
  for (const s of scenes) {
    s.characters = [...new Set(s.beats.filter((b) => b.character).map((b) => b.character))];
    if (!s.characters.length && characters.size) s.characters = [[...characters.keys()][0]];
  }

  return {
    meta,
    scenes: scenes.length ? scenes : [{ ...parseHeading('INT. EMPTY STAGE - NIGHT'), index: 0, beats: [], characters: [] }],
    characters: [...characters.values()].sort((a, b) => b.lines - a.lines),
    songs: songId,
  };
}

/** Estimated spoken/sung length in seconds. Sung lines breathe more. */
export function estimateDuration(text, singing) {
  const words = (text || '').split(/\s+/).filter(Boolean).length;
  const rate = singing ? 1.75 : 2.7; // words per second
  return Math.max(singing ? 2.0 : 1.1, words / rate + (singing ? 0.7 : 0.45));
}

/** Total runtime of a parsed script, in seconds. */
export function scriptDuration(script) {
  return script.scenes.reduce(
    (total, s) => total + s.beats.reduce((t, b) => t + (b.duration || 1), 0),
    0,
  );
}
