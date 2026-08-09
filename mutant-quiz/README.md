# X-Gene Sequencing

A 60-question mutant-power quiz. Every answer's weight is **hard-coded in the
source** — a model never tracks your score, never sees a number it didn't get
handed, and never decides a tier. The arithmetic runs entirely in the browser.
A model is used only at the end, and only for the parts arithmetic is bad at.

```
node server.js                                  # manual mode + offline fallbacks
ANTHROPIC_API_KEY=sk-... node server.js         # everything on
# → http://localhost:4173
```

`public/index.html` also opens directly off the filesystem with no server at
all — manual mode and the offline fallbacks work fine that way.

---

## The two modes

|                       | **Manual** | **AI-assist** |
| --------------------- | ---------- | ------------- |
| Scoring               | hard-coded weights | hard-coded weights |
| Free-text "other" box | hidden | shown on every question |
| Per-block notepad     | deterministic digest of trait tags | model writes 2–3 sentences about you |
| Final result          | ranked scores → synergy lookup → power + tier, shown as the derivation it is | one custom ability written to your profile |

Manual mode reads like a machine filling in a form, on purpose:

```
You scored highest in Psychic, followed by Beastial and Elemental.

Result — Pack Sense: you feel intent as physical pressure and move
before it arrives; it expresses itself through heat and combustion.

Rated Delta. Subtle. Easy to underestimate, hard to weaponise.

Derivation
  1. Psychic × Beastial → Pack Sense
  2. Modifier: Elemental → it expresses itself through heat and combustion.
  3. Reality held at 2 of 8 required — excluded from the fusion.
  4. Strength 35 of a possible 83 for Psychic = 42% → Delta tier.
```

Enough scaffolding for the imagination to finish the job, and the tier tells
you how much room you have to interpret.

---

## Demo mode

Top-right toggle. Turns the hidden tab inside-out:

- every option's weights printed under it, live
- a sticky panel with the running tally, elemental bias, and trait tags —
  recomputed from scratch on every click, so changing or clearing an answer
  moves the numbers back exactly
- what each free-text answer was scored at, and whether the model or the
  offline heuristic scored it
- the per-block notepad entry, shown before you move on
- a signal log of every model call: which one, how long, tokens, result

---

## How scoring works

**Full recompute, every time.** `Engine.profile()` walks all sixty questions
and rebuilds every total from nothing. There is no running counter to corrupt,
so switching an answer, clearing one, or clicking the same option forty times
all land exactly where one deliberate click lands. Clicking a selected option
deselects it; multi-select questions drop the oldest choice rather than
refusing the new one.

**Ten categories.** Psychic, Temporal, Elemental, Beastial, Biological,
Energy, Probability, Technological, Esoteric, Reality. Elemental additionally
tracks eight sub-affinities (fire/water/earth/air/sound/storm/growth/metal)
that only ever decide *flavour*, never rank.

**Reality is gated.** It scores like anything else but is excluded from the
fusion until it clears `REALITY_GATE` (8 of a possible 14 — it takes deliberate
alignment across several questions). Below that it is dropped and the drop is
shown in the derivation. Omega additionally requires Alpha-grade focus, so
casual answers cannot produce a reality-warper.

**Tier comes from strength, not points.**

```
strength = your top category score ÷ the most that category could score
```

Raw totals are useless: every completed quiz banks roughly the same number of
points, so a random player out-scores a focused player who left half the quiz
blank. Normalising against each category's achievable maximum (computed from
the question bank at load, so it stays correct when questions change) makes
categories comparable *and* makes an unfinished quiz read as the weak
manifestation it is. Thresholds come from `test/calibrate.js`, which sweeps
simulated players from perfect min-maxing down to pure noise:

| Tier | Strength | Who lands here |
| --- | --- | --- |
| Omega | ≥ 0.80 + reality gate open | deliberate, rare |
| Alpha | ≥ 0.80 | min-maxed or a very committed profile |
| Beta | ≥ 0.62 | a clear consistent theme |
| Gamma | ≥ 0.48 | a real lean |
| Delta | ≥ 0.34 | complete quiz, no strong theme |
| Epsilon | below | the sequence was left unfinished |

---

## Where the model is used

Three calls, all `claude-opus-5`, all returning JSON via structured outputs
(`output_config.format`), all with hard client-side clamps on anything they
hand back.

1. **Free-text scoring** (`effort: low`) — reads one typed answer and proposes
   weights. Clamped to ±2 per category, 3 categories, total magnitude 4, so a
   paragraph can never outweigh several questions. Unknown categories are
   dropped. Re-scoring *replaces* the previous contribution, so editing the box
   repeatedly can't inflate anything. Reality is capped at +1 from this path.
2. **Per-block notepad** (`effort: low`) — after each set of ten, writes 2–3
   sentences about the person. Keeps the final call's job small: six short
   notes plus a score table instead of sixty raw answers.
3. **The fusion** (`effort: high`) — receives the score table, the shortlist,
   the elemental bias, trait tags, the six notes, the typed answers, the
   optional life anchor, the tier ceiling, and a deterministic skeleton showing
   *which* two categories fuse. Returns six fields: `name`, `who`, `power`,
   `sting`, `tier_note`, `read`.

The fusion prompt carries five load-bearing rules, each fixing an observed
failure:

- **Anchor it in a life**, ideally a job. Powers are memorable when they belong
  to someone ordinary — the work is where the ability lives and what it costs.
- **Fuse, don't staple.** Two capabilities joined by "and" is a wrong answer.
  One category supplies the method, the other the medium or the price.
- **The third category is the ledger** — where it is paid for, triggered or
  bounded. Never a second power.
- **Pay with consequence, not shrinkage.** The commonest failure is making an
  ability feeble so it feels balanced, which produces something nobody wants.
  Let the effect be striking and charge for it — the body, the memory, someone
  else, something small and nearby that never agreed to it.
- **Don't explain yourself.** No category names in the ability, no "the twist
  is", no marking its own homework.

Plus: one **denial clause** ("not repair, transfusion") to rule out the obvious
reading, and a preference for one exact physical detail over three
abstractions.

The schema is deliberately only six fields. An earlier version had separate
`trigger` / `limit` / `cost` / `hook` slots and the slots *were* the problem — a
form with six boxes gets filled in, and the result reads as a spec sheet.
Mechanism and price belong in the same paragraph.

### The life anchor

Nothing in the sixty scored questions asks what anyone does for a living, and
the fusion is markedly better when it has an ordinary life to hang on. So the
final block ends with an optional free-text box that is **worth exactly zero
points** — it never touches a score, a tier or the gate. It exists only to give
the write-up something real to sit in.

**If no model is reachable, nothing breaks.** Free-text falls back to a
keyword heuristic, block notes to a trait digest, and the final result to the
manual readout. The quiz always completes.

---

## Transports

Tried in order:

1. **`/api/anthropic`** — the bundled server proxies with a server-side key.
   The model ID is pinned server-side; the browser can't ask for another.
2. **Direct** — a key the user pastes on the intro screen, kept in
   `localStorage` and sent straight to Anthropic. Fine for a personal machine;
   use the proxy for anything shared.
3. **Offline** — the fallbacks above.

---

## Tuning

| Want to change | Edit |
| --- | --- |
| Any answer's weights | `public/js/questions.js` |
| Categories, tiers, gates, clamps | `TUNING` in `public/js/categories.js` |
| What two categories fuse into | `PAIRS` in `public/js/synergy.js` (all 45 pairs) |
| Third-place flavour text | `MODIFIERS` / `ELEMENT_FLAVOUR`, same file |
| The prompts | `*_SYSTEM` in `public/js/llm.js` |

Adding questions needs nothing else touched — set `set:` to a block number,
and the category maxima, progress bar and per-block grouping all follow.

---

## Tests

```
npm test                  # 40 checks: data integrity, scoring, clamps, gate, fusion, tiering
node test/calibrate.js    # tier distribution across simulated players
```

The suite specifically pins the behaviours that are easy to regress:
re-clicking clears, changing an answer swaps rather than stacks, 51 clicks
equals 1 click, editing free text replaces rather than accumulates, every one
of the 45 category pairs has a written fusion, and reality stays out of the
shortlist until the gate opens.

The browser paths (both modes, all six blocks, the live tally, and every
outbound request checked against the API contract) were verified with
Playwright against a mock upstream.
