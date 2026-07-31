# Dungeon Crawler World — Season: Earth

A tactical text RPG. Eighteen floors, a timer on each, permadeath, and an
audience of trillions who can see your health bar and have opinions about it.

A fan simulation in the spirit of Matt Dinniman's *Dungeon Crawler Carl*. None
of the prose is reproduced from the novels.

```bash
cd dungeon-crawler-world
npm run play          # start a run
npm run play -- --seed 4242   # start a specific run
npm run play -- --load        # resume
npm test              # 55 tests, no dependencies
npm run sim -- --runs 200     # play 200 runs and print the balance
```

Node 22.6+. **No dependencies, no build step** — Node runs the TypeScript
directly.

---

## The one design decision everything else follows from

**The simulation is the referee. The language model, if you turn it on at all,
is a camera.**

The obvious way to build this is to let a model narrate and adjudicate at the
same time, and then bolt on machinery to stop it being too generous: an effect
validator, a loot-tier authoriser, an appeals process for when it gets a ruling
wrong. Every one of those is a symptom. They exist because the thing writing
the prose is also the thing deciding whether you survived.

So here the model cannot decide anything. A turn resolves completely — dice,
damage, loot, death — and *then* the events are handed to a narrator to
describe. There is no validator because there is nothing to validate. There is
no appeals process because there is no ruling to appeal. And the game runs
perfectly with the network unplugged, which a text RPG has to.

```
command → simulation → events ──→ procedural narrator  (always)
                          └─────→ LLM narrator          (optional, prose only)
```

`npm run play -- --llm` uses `ANTHROPIC_API_KEY` if you have one. It rewrites
the description and nothing else; if the call fails, the local voice takes over
mid-sentence and the run continues. The System AI is funny without an API key,
because the simulation already knows you killed something four levels above you,
barefoot, in a doorway, at nine percent health — and given facts that specific,
templates stop reading like templates.

---

## What a fight actually is

The previous version of this idea tracked floor progress as a percentage the
model typed. That meant there was no space: no map, no flanking, no chokepoints,
no retreat. But *Dungeon Crawler Carl* is a series about terrain and
preparation, so that is what got built.

**A room is a small graph of positions.**

```
── round 1 ─────────────────────────────────────────────
▶ the arch [choke·2]
    you, the cat
  the open nave  1 away
  among the pillars [choke·2 cover]  2 away
    Dungeon Rat, Dungeon Rat γ
    ✦ the cargo hoist
  the raised gallery [choke·2 cover high]  2 away
    Dungeon Rat β
    ✦ the overturned bus

  1) Dungeon Rat  lv1 ██████████ 7/7   out of reach
  2) Dungeon Rat β lv1 ██████████ 7/7  out of reach
  actions: move ×1 | action available
```

Three ideas carry the whole system:

**Capacity.** Every position states how many enemies can bring a melee weapon
to bear on one defender standing in it. A doorway is capacity 1. That single
number is why one crawler with a spear can hold a corridor against six things,
and it is the mechanical form of "cleverness buys position, never a free win".
The seventh gnoll in the room is a spectator.

**Features.** Every room ships with one to three things that are not enemies and
can still end the fight. The bus you can shoulder over. The gas main nobody has
dealt with. The severed cable, in a room with standing water — and yes, those
two combine, and so do gas and fire. This is where clever play lives, and it is
mechanics rather than a prompt asking a model to be fair about it.

**Behaviour.** A brute walks into your spear. A pack hunter refuses to engage
until one of its friends is behind you. A shooter spends the entire fight
declining to come within reach, making you decide whether to leave your
doorway. Two mobs with identical statistics play completely differently.

Preparation is the other half. If you slip into a room unnoticed you can spend
real minutes wiring a trap, dragging a barricade, opening the gas main, or
going still for an ambush — and every minute you spend fiddling is another roll
against being noticed.

---

## The clock is the antagonist

Every action costs time off a floor timer that kills you when it runs out.
Travel is minutes on a graph edge. Searching a place is twenty-five. Sleeping
is **seven hours**, and it is the sharpest decision in the game: full health,
full stamina, cleared fatigue, bought with seven hours you cannot get back.

Fatigue and hunger climb and start subtracting from accuracy and defence. Out
of combat you regenerate on a Constitution curve; in combat you regenerate
nothing. Bleeding you ignore for six hours is bleeding that kills you.

## The show is a real loop, not a number

```
spectacle → views → sponsors → boxes → power
              ↘ bounty → hunters → you have a problem
```

Killing a rat with a sword is worth almost nothing. Killing it by dropping a
vending machine on it, while outnumbered, at a quarter health, with your bare
hands, is worth an order of magnitude more — and every point of that is also a
point on the price of your head. Fame spawns bounty hunters scaled to your
level. There is no way to farm views safely. That is the design.

Sponsors watch for a pattern, offer you gear for it, then hold you to a clause
checked against the simulation at the end of every floor. *No fleeing. Twelve
kills a floor. A third of them with your hands. Spare something, once.* Break it
twice and they terminate the arrangement publicly, by name.

---

## Character creation

The dungeon did not ask what class you wanted to be — it took whoever was
outside at three in the morning. So creation is eight questions about the hour
before the Collapse, and the system converts that life into numbers, badly, and
with opinions.

There is a ceiling on the total and deliberately **no floor**. Somebody who got
winded on stairs and calls a repairman arrives measurably worse at this than
somebody who trains and takes things apart, and the character sheet says so out
loud instead of quietly normalising them back to equal.

Race and class are chosen once, on the third floor, permanently. Human gives ten
extra points and small broad bonuses, and four crawlers in five are right to take
it. Primal costs five, forfeits Human's ten — fifteen points, five levels behind
on day one — and is the only thing in the game that lifts the skill ceiling from
15 to 20. That trade is the most interesting decision available and it is real.

Before you choose, points cannot be spent. Two of the three a level **drift**,
landing on their own, biased toward whatever you have been doing; one is banked
for the third floor. You still grow. You simply do not get a say in it yet.

## Inventory

There is no slot limit. There never was. The only question is whether you can
get the thing off the ground for the two seconds the interface needs — which
makes **Strength the storage stat**, and means yes, eventually, the vending
machine.

---

## Layout

```
src/core/     rng (seeded, serialisable, named streams), events, types
src/data/     content: items, mobs, floors, skills, boxes, sponsors, statuses
src/sim/      map generation, tactics, combat, enemy AI, loot, the show, the facade
src/voice/    the System AI's procedural voice, and the optional LLM camera
src/cli/      the terminal client — thin, and it cannot reach past Game.execute
tools/        the auto-player, and the balance harness built on it
test/         55 tests
```

Everything goes through `Game.execute(command)`. The terminal client, the
balance harness and the test suite all play exactly the same game, because none
of them can reach past that method.

## Determinism

Every number comes from a seeded stream. A run is reproducible from a seed plus
a list of commands, which makes bug reports exact and save-scumming pointless.
Floor generation uses a stream derived purely from `(seed, floor)`, so floor 3
is the same floor whether you got there in six hours or sixty. The obituary
prints your seed.

## Balance is measured, not asserted

`npm run sim` plays a few hundred complete runs with a competent policy and
reports what happened. Tuning a damage formula by reading it is guesswork.

```
  100 runs, stopping at floor 6

  SURVIVAL
    died                98  (98%)
    reached floor 2     60  (60%)
    reached floor 3     41  (41%)
    reached floor 4     24  (24%)
    reached floor 5      8  (8%)
    reached floor 6      2  (2%)

  WHERE IT ENDED
      3  Killed in the soot-choked brake house, by Bounty Crawler
      2  Killed in the well-kept pilgrim camp, by Wight Hound
      1  Killed in the burnt-out underpass, by The Juicer
      1  Caught on the floor at collapse
```

The harness is also the most demanding test in the repo. It found the collapsed
ceiling that orphaned a position so a fight could never end, the bounty hunter
that spawned at level 40 against a level 4 crawler, and the Celestial box that
quietly handed out rare loot because the catalogue fallback walked *down* the
rarity table. A hand-written test exercises the case you thought of.

## Adding content

Everything is a plain array. New entries are live immediately in generation,
loot tables and the codex.

```ts
// src/data/items.ts — an affix. `mods` are read by the combat resolver by name.
{ id: "serrated", name: "Serrated", on: ["weapon"], minRarity: "uncommon",
  value: 140, mods: [{ k: "crit", v: 1 }],
  note: "Leaves a wound that keeps arguing after the fight." }

// src/data/floors.ts — a room feature, which is a tactical option
{ id: "gas_main", name: "the ruptured gas main", kind: "gas", dc: 8,
  check: { skill: "engineering" }, requires: [], primes: ["fire"],
  verb: "open up",
  note: "You can hear it. Everyone in this room can hear it." }
```

The one rule the content follows: **if a skill or a modifier is on a list, some
line of code asks for it by name before it decides something.** No decorative
stat lines, and no skills that are only a joke — the joke goes in the
description, next to the number that does the work.
