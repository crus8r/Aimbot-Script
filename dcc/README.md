# Dungeon crawler RP kit

A small, file-based setup for running a long-form dungeon-crawler roleplay campaign with an
LLM without it (a) forgetting everything, (b) nerfing you into misery, or (c) taking forty
seconds per turn.

## The premise

The usual failures — goalpost-moving on clever plays, rewards shrunk "for balance," death
from a partially-realized plan, appeals that go nowhere, NPCs played dumber than they are —
are **contract failures, not memory failures**. A bigger lore bible makes all of them worse,
because it slows responses and crowds out the state that actually matters.

So this kit is inverted from the usual approach:

- **A short, binding Constitution** the DM re-reads every session — how it must adjudicate
  cleverness, reward, lethality, and appeals.
- **Stance cards** instead of encyclopedia entries — how things *behave*, not what exists.
- **State on disk**, loaded selectively, so memory is a filesystem problem instead of a
  context-window problem.
- **A pacing gauge** that forces story beats on a timer, so the campaign never degrades
  into wandering corridors.
- **Lore read on demand**, one page at a time, never wholesale.

## Files

| File | What it is |
|---|---|
| `CONSTITUTION.md` | The DM contract. Outranks everything. Read every session. |
| `VOICE.md` | Tone, mob taxonomy, NPC stance cards. |
| `CLAUDE.md` | The turn loop. Auto-loads when running in this directory. |
| `TESTS.md` | 7 regression tests. Run before investing hours in any new setup. |
| `state/` | Live game state. The DM writes here every turn. |
| `state/rooms/` | Compacted room cards, digested every 10 rooms. |
| `lore/` | On-demand reference. One page per topic. |

## Running it

**In Claude Code (recommended).** `cd` into this directory and start a session. `CLAUDE.md`
loads the turn loop automatically, state persists on disk, and context compaction stops
mattering — if the session compacts, the next turn re-reads the files and nothing is lost.
That is the property a chat window can't give you at this length.

**In a chat window.** Paste `CONSTITUTION.md` and `VOICE.md` as the opening message, keep
the state files as project files, and paste updated state every ~20 turns. Works, but you
are doing the filesystem's job by hand.

**In an app you build.** Keep the app thin: a state store and a turn endpoint. Send the
model the Constitution (2 pages) + current state (1 page) + retrieved lore (0–2 pages).
Do **not** make the app enforce the rules — the model is good at following a short
constitution and bad at following a long rulebook, and an app that adjudicates will spend
its whole life fighting the model that's also adjudicating.

## Before you commit real time

Run `TESTS.md`. Seven tests, about fifteen minutes. Tests 2 and 5 predict misery — if
either fails, fix the contract before playing.

## Tuning

Everything in the Constitution is meant to be edited. The numbers most worth tuning first:

- Pacing thresholds (§8) — lower `pressure` for a harsher run, lower `spectacle` for a
  sillier one.
- Rule of Cool tokens (§7) — 3 per floor is a starting point. Two if wins feel cheap, four
  if you're getting argued with.
- Death ladder (§5) — removing the "non-lethal hit first" step makes the game much more
  dangerous without making it arbitrary.

Do not add rules to fix a bad session. Change a number, or add six lines to a stance card.
Growth in this kit is the failure mode it was built to avoid.
