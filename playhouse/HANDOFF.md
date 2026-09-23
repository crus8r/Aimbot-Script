# Playhouse — handoff

## The idea

A written script — screenplay, play, or musical — staged automatically as a
directed 3D film. Two layers:

1. A movie-making toolkit: an asset catalogue, a scene format, cameras with
   real shot grammar, TTS voices, captions, a procedural underscore, and
   plain-language director notes.
2. An LLM that reads a script and *drives* that toolkit — picks the location,
   places the cast, chooses coverage, and emits scene files.

The motivation is to watch your own musical without paying for AI video
generation, and the bet is that a fixed vocabulary of nouns, verbs and shot
types is enough for a model to direct with. (Published work agrees: FilmAgent
independently arrived at the same design — preset positions, preset actions,
preset shots — and scored 3.98/5 in human evaluation.)

## Where things are

- Repo `crus8r/Aimbot-Script`, branch `claude/sims-design-cinematic-assessment-y1s146`
- The project is `playhouse/`
- Live preview: https://claude.ai/code/artifact/c98e2eb8-87db-4d44-a494-101b101fd796

## Architecture — the one thing not to break

**ONE scene-file format, TWO renderers.**

- `src/scenefile.js` defines and validates the format.
- `src/*.js` — a three.js browser preview. This is what a person opens.
- `blender/*.py` — Blender/Cycles stills (bpy from PyPI, CPU only). The film.

Where the two disagree, **Blender is the reference**: its behaviour was
arrived at by rendering, measuring and fixing. Port back to the browser; do not
renegotiate. They currently agree on camera framing to within centimetres and
on frame luminance to within 0.94x–1.36x, both measured, and both are easy to
break by accident.

## The missing piece

**Nothing writes scene files automatically.** Every scene file so far was
written by hand. That gap *is* the project — everything else exists to make it
possible. Building it is the next job.

Concretely the bridge is: a system prompt generated from `src/vocabulary.js`,
a screenplay in, a scene file out, `validateScene()` checks it, errors go back
for a repair attempt. One cheap model call per scene, not a coding session.

## Commands worth knowing

```
npm test                                   # vocabulary freshness + smoke
node tools/build.mjs                       # bundle to dist/ (smoke/UI tests read the BUNDLE, so rebuild first)
node tools/vocabulary.mjs                  # regenerate src/vocabulary.js, report divergences
node tools/smoke.mjs                       # headless browser run
node tools/test-ui.mjs                     # 31 UI cases, several minutes
node tools/render-scene.mjs scenes/X.mjs   # browser screenshot per shot
node tools/scene-to-json.mjs scenes/X.mjs out.json
python3 blender/render_scene.py out.json outdir --dry-run    # ~8s, solves every camera, no render
python3 blender/render_scene.py out.json outdir --samples 24 --res 480x270 --shot ID
```

`--dry-run` is the most valuable tool in the repo. It solves every camera,
checks occlusion, and emits warnings phrased like a first AD's notes, in eight
seconds with no Cycles. Use it constantly. A full-quality still is ~90s/frame
on 4 CPU cores, so budget *frames*, not seconds.

## What is built

- **Format**: `validateScene` collects ALL errors at once (deliberate — a model
  gets one complete critique per attempt), with did-you-mean suggestions.
- **Vocabulary**: `src/vocabulary.js` is GENERATED from both renderers by
  `tools/vocabulary.mjs`. The only way to teach the validator a new prop is to
  write the prop. It carries names *and* grammar: `SCENE_GRAMMAR`,
  `ACTION_GRAMMAR`, `FIELD_TYPES`, `CONVENTIONS`, `OPTION_SUPPORT`,
  `HOLDABLE`, `PROP_SYNONYMS`. `npm test` fails if it is stale.
- **Catalogue**: 21 prop types in Blender, 36 in the browser, 25 poses in both,
  10 VFX abilities. 8 action verbs: move pose look hold release face vfx prop.
- **Cameras**: shot-size ladder ECU..EWS, two-shot framing that solves distance
  *and* azimuth, over-the-shoulder, inserts on props, occlusion gating.
- **Audio**: Web Speech TTS with deterministic per-character voices; a
  procedural underscore cued from the script (`src/score.js`, off by default).
- **Director notes**: pause, type a plain-language change, undo.

## Hard-won lessons — the actually valuable part

**1. Measure; never eyeball.** Nearly every real bug this project has had was
invisible to reading and obvious to measurement. The preview ran 2.2x–13.2x
darker than the film for months and nobody noticed, because both looked
"fine" alone. Render both ways, compute mean luminance, compare. Same for
camera agreement: drive both solvers over identical world state and diff the
positions.

**2. Silent failure is the enemy.** The recurring bug class, over and over:
*it validates, it renders, and it renders something other than what it says.*
18 poses silently became `idle`. Prop options were never read. `camera.ots` was
never copied, so an entire working code path was dead. A prop handed between
characters came back a different colour. Whenever you add a field, ask what
happens when a renderer doesn't implement it — and make it *say so*.

**3. A pose name matching is not a pose matching.** Two tables can both say
`kneel` and describe different postures. The generator now compares them
bone-by-bone and fails the build on any divergence not on a recorded-exceptions
list. Divergence stays allowed; happening by accident does not.

**4. Alarms that fire on everything are the same as no alarm.** The first
version of that pose comparison reported all 25 poses as divergent because it
parsed Python tuples with `JSON.parse`. Check that a new check is *quiet* when
things are right.

**5. Keep the schema flat.** Published evidence: schema compliance runs 93–96%
for flat structures and collapses to 3–41% for deeply nested ones. `options` is
the one nesting level; resist adding more.

**6. Validator messages are repair instructions, not error text.**
`pose "sitting" is not a pose; did you mean "sit"?` is worth ten times
`invalid pose` when the reader is a model with one attempt to fix itself. But
add a distance floor — a confidently wrong suggestion is worse than none.

**7. Primitives work for dressing, not for hero props.** Measured over 83
objects in three scripts: 79.5% read as a box/cylinder/sphere plus colour. But
split by role it is **87.3% for set dressing and 14.3% for the props the script
actually names or touches.** Failure rate rises with narrative importance.
Expose *named* types built from primitives, never raw shapes — a name carries
the metadata (a mug is 8cm, is not a hero prop, may not be a close-up subject)
that an anonymous slab cannot.

**8. Blender ships zero props.** Its bundled asset library is brushes and
geometry-node tools. It does ship 8 usable world HDRIs.

**9. `git clone` works from this sandbox** even though the GitHub API, the
archive tarballs, and every 3D asset site are blocked. Blobless clones
(`--filter=blob:none`) make three real libraries reachable:
KhronosGroup/glTF-Sample-Assets (148 models), mrdoob/three.js examples (97),
BabylonJS/Assets (620, CC-BY-4.0, 300KB to enumerate). **Rigged Mixamo
characters with named Walk/Run/Idle actions import into Blender intact** —
verified. Licences are per-model, not blanket CC0. Check before relying on one.

**10. Prior art is 80% occupied and 20% empty.** LLM-to-Blender is crowded
(SceneCraft, 3D-GPT, BlenderLLM, BlenderMCP at 25k stars) but all of it builds
*static scenes*. LLM film direction exists too, but targets Unity/Unreal or
video diffusion. **Nobody does shot coverage in Blender.** That intersection is
the opportunity.

**11. Emit relations, not coordinates — eventually.** Nearly every successful
layout system has the model emit spatial relations and a solver compute
coordinates. This format makes the model emit absolute `[x, y, z]`. That is the
highest-risk part of the current design.

**12. Rebuild before testing the browser.** `smoke.mjs` and `test-ui.mjs` run
against `dist/`, not `src/`. Editing source and re-running a test without
`node tools/build.mjs` tests the old code. This wastes an hour every time.

## Working practices that worked

- **Parallelise by disjoint file ownership**, then integrate and adversarially
  review. Agents editing the same file collide; agents on separate files with a
  written contract do not.
- **Never claim something works without running it.** "It did not throw" is not
  evidence that a Web Audio graph makes sound or that a pose touches the floor.
- **Comments explain WHY, never what.** If a number came from a measurement,
  say what was wrong without it. The existing docstrings are the standard.
- **Report failures honestly and immediately.** Several times an agent's
  confident claim was wrong and only an independent check caught it.

## What to do next, in order

1. **The LLM bridge.** Generate the system prompt from `src/vocabulary.js` so it
   can never describe a capability the renderers lack. Then: screenplay in,
   scene file out, validate, repair, render. Before writing much code, run the
   loop BY HAND once — paste the format at a model, give it a page of script,
   and keep a log of every word it wanted that does not exist. That log is the
   vocabulary gap, measured instead of guessed.
2. **Unknown keys are accepted silently at every level** of the format — scene,
   environment, prop, cast, shot, camera, action. That is the one typo class a
   model will definitely make and the last silent failure of any size.
3. **Locomotion.** Poses are not animation. This gates every action beat. Lesson
   9 means it is far more achievable than it looked.
4. **Faces cannot act** — there is a jaw and no expressions, and the direction
   keeps cutting to them.

## Known rough edges

- `scenes/forest-stop.mjs` shot 7: the guards face away from the man they are
  aiming at. An authoring bug, not a renderer bug — both now place them
  identically.
- `describeShot` prints "OTS" even when the shot fell through to two-shot
  framing.
- The browser's world state depends on the path taken through the timeline;
  Blender replays from scratch. Scrubbing backwards leaves them different.
- `caption`, `fade` and a few other fields are validated and only partly read.
