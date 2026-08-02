# Crawl — the app

Three files. Download the folder, double-click `index.html`, paste an API key.
No install, no build step, no server.

| file | what it is | how often you'll touch it |
|---|---|---|
| `index.html` | engine + UI + state | rarely |
| `lore.js` | the world | constantly |
| `rules.js` | the DM contract and the prompt | when the DM misbehaves |

`lore.js` and `rules.js` are plain data and plain prose. Edit them in any text
editor, reload the page, and the change is live in the next turn. That is the
whole point — the thing you will spend your time tuning is deliberately not
buried in application code.

## Setup

1. Get a key at `console.anthropic.com` → API keys.
2. Open `index.html`, click ⚙, paste it. It is stored in your browser's
   localStorage and sent directly to Anthropic — nothing passes through any
   other server, because there is no other server.
3. Answer the survey. Play.

If the first turn errors with a network or CORS failure, the direct browser
call is being blocked. Serve the folder locally instead:

```
cd dcc/app && python3 -m http.server 8080     # then open localhost:8080
```

## Model and cost

Defaults to **Opus 5**, switchable mid-run from settings — there's no reason
not to run corridors on Sonnet and flip to Opus for a boss floor. Effort is
also switchable (`low` / `medium` / `high`); it controls how hard the DM thinks
before answering, which mostly means how closely it follows the Constitution.

Per turn the request is roughly a 7k-token system prompt (cached after the
first turn, so it bills at about a tenth of that afterwards), ~400 tokens of
live state, and whatever conversation is still in the window. Check current
per-token pricing on Anthropic's pricing page and multiply — but the shape to
know is that the expensive part is cached and the per-turn marginal cost is
small.

## How a turn works

```
you type  →  state block + your action appended to history
          →  streamed narration appears live
          →  DM calls apply_turn once, at the end
          →  deltas applied to state, panels refresh, autosave
```

The DM writes prose first and calls the tool last, so you watch the turn arrive
in real time and the mechanics land when it finishes. State updates come
through a typed tool call rather than being parsed out of prose, which is why
your HP and inventory don't drift.

## Memory

Nothing important lives in the chat history.

- **Live state** — character, inventory, threads, NPCs, codex — is rebuilt into
  every request, so it can never be forgotten.
- **Room cards** are written when you leave somewhere and compact 10-at-a-time
  into digests. Detail is discarded on purpose; the card is the memory.
- **Conversation** is trimmed to a rolling window. What falls out is already
  captured above.

So a session can run indefinitely without the model losing the plot, and a
context limit is never something you have to think about.

## Inventory

Bulk loot goes into **pools** with prose descriptions the DM rewrites as you
add to them — *"a few short swords and about a dozen goblin knives"* becomes
*"some of everything: clubs, knives, swords, you name it"*. Ask for two swords
and two shields and the DM checks the description and rules on plausibility.

Distinct things — loot-box drops, quest items, anything with a real
description — stay itemised with full text. Per canon, nothing is
unidentified: every item tells you exactly what it does, and the important
clause is usually buried in the middle of a joke.

Off-body stashes are supported, so four hundred goblin shortswords is one line
in a stash room rather than four hundred rows.

## The codex

The lore is a baseline, not an allowlist — the DM invents skills, spells, mobs,
bosses, box types and achievements constantly, following the house patterns in
`lore.js`. **Every invention is written into the codex in your save file and
re-injected every turn, and is canon from that moment on.** It cannot be
contradicted later. That is what stops the drift where a skill invented on
floor 2 behaves differently on floor 5.

Codex entries are tagged `inferred`, the same convention the lore file uses, so
you can always see what's source material and what's the DM. Anything you like,
paste into `lore.js` to keep it across runs.

## Buttons that matter

- **✦ rule of cool** — spend a token. Your plan resolves at its most favourable
  reasonable interpretation, no pushback, no added requirements. Three per
  floor by default. This is the pressure valve; it exists so a negotiation
  spiral can never happen.
- **appeal that** — forces the citation-or-reverse procedure. If the DM can't
  quote text that already existed, the ruling is overturned automatically.
- **fix a number** — bookkeeping correction. Not a ruling, never argued.
- **get a manager** — in-fiction escalation. The System is obligated to produce
  one, and a manager can overturn the DM.

## Tuning

Everything worth changing is a number in settings or a line in `rules.js`.

- **Pacing thresholds** — turns since a beat last fired. Lower `pressure` for a
  harsher run, lower `spectacle` for a sillier one. `drift` (default 3) is the
  one that stops you wandering corridors: when it trips, the dungeon comes to
  you.
- **Rule of Cool tokens** — 2 if wins feel cheap, 4 if you're getting argued with.
- **Death ladder** (`rules.js` §5) — removing the "non-lethal hit first" step
  makes the game much more dangerous without making it arbitrary.

Do not fix a bad session by adding rules. Change a number, or add six lines to
a stance in `lore.js`. Growth in these files is the failure mode they were
built to avoid.

## Saves

Autosaves to localStorage every turn. **`save` in the header exports a JSON
file** — do that before clearing browser data, and to move a run between
machines. Load from settings.

## Known limits

- Not tested against a live API key in this environment — the request shape is
  validated against the current API docs and by an offline test suite, but the
  first real call is the first real call.
- One player, one crawler. No party members as separate sheets.
- The DM tracks the floor timer through the `minutes` it reports; it is not a
  wall clock.
