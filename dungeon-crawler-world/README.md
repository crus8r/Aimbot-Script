# Dungeon Crawler World — Season: Earth

A tactical text RPG. Eighteen floors, a timer on each, permadeath, and an
audience of trillions who can see your health bar and have opinions about it.

A fan simulation in the spirit of Matt Dinniman's *Dungeon Crawler Carl*. None
of the prose is reproduced from the novels.

```bash
cd dungeon-crawler-world
npm run play          # start a run in the terminal
npm run play -- --seed 4242   # start a specific run
npm run play -- --load        # resume
npm test              # 105 tests
npm run sim -- --runs 200     # play 200 runs and print the balance
npm run build:web     # one self-contained HTML file you can host anywhere
npm run smoke         # build it, then play it in a real browser
```

Node 22.6+. The game itself has **no dependencies and no build step** — Node
runs the TypeScript directly, and every test, the CLI and the balance harness
run against the source. The three devDependencies (esbuild, TypeScript,
Playwright) exist only to bundle the web page, typecheck, and drive a headless
browser over it.

## Playing it on a phone

`npm run build:web` produces `web/index.html`: the entire game — engine,
content, client, styles — inlined into a single file that makes no network
requests at all. Put it on any static host, or open it off the filesystem, and
it works. It saves to `localStorage` after every single command, so closing the
tab mid-fight and coming back a week later resumes exactly where you were, and
the menu will hand you the whole run as text to paste onto another device.

It is built for a phone first: one column, every action a tap, and the freeform
text box as a power feature rather than the price of entry. `npm run smoke`
builds it and then plays it in a headless Chromium on a 390px viewport —
walking the intake, taking sixty turns, opening every sheet, reloading the page
and checking the run survived.

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

## Content the run produces, not content the repo ships

The books are explicit that there are hundreds of skills and nobody has the
list. You cannot author that, and pretending to is how you end up with forty-six
entries where most are a name and a joke. So the engine watches instead.

**Skills you were never given.** The simulation tracks what you actually keep
doing — fighting in doorways, killing things with the room, winning at nine
percent health, opening fights nobody knew had started. When a pattern becomes
undeniable and no existing skill covers it, one is minted, with real hooks, and
it is working on the very next swing.

```
NEW SKILL: Corridor Fighting
You keep putting your back in a doorway and making things come to you one at a
time. It is a real skill now, at level one, and it will grow the way the others
do — +1 accuracy while holding a narrow position, +1 defence while holding a
narrow position.
```

`skills` also shows what the dungeon is *currently counting* and has not
committed to yet, so a pattern you are two kills away from is visible.

**Classes assembled around you.** The third-floor menu is ten options: a few
authored, and the rest built on the spot out of your own record — including the
skills that did not exist when the run started. *Contracted Doorwarden of the
Third Shift. Retained Load-Bearer with Distinction.* They are not on anybody
else's list and they are exactly as permanent as the ones written down in
advance.

**Spells nobody wrote.** Tomes come out of boxes and shrines carrying spells
composed from the same closed effect set the resolver reads — *Ninth-Edition
Lance*, *Hobgoblin Bloom of Bad Ideas*. The mana pool is your Intelligence, one
point for one, refilling at about a point an hour, so a spell is a decision
about the day rather than a bar to drain.

The rule that makes all of this safe is in `src/core/hooks.ts`: **the engine
owns the verbs, and a generator only ever composes from them.** A minted skill
is not a name and a description, it is `{ k: "accuracy", when: "choke", v: 1 }`.
And a generator cannot express "you win", because there is no hook for it.

## Saying it in your own words

Anything the verb list does not recognise is read as an instruction rather than
refused.

```
› shove the shelving onto them
│ Read as: There is nothing here matching that. What is actually in this room:
  the cargo hoist, the overturned bus.

› back into the doorway
│ Read as: Backing into the arch.

› kick the nearest one
│ Read as: Going at Dungeon Rat with your hands.
│ You get your weight behind it. 6, and something inside Dungeon Rat gives.
```

It always says what it understood, so a misreading costs one line instead of a
turn, and an unparseable action costs nothing at all. Being argued with by a
parser is a worse experience than losing.

The same applies to your pockets. `claim a multi-tool because I was an
electrician for eleven years` is granted, warmly, because everybody was carrying
a dozen unremarkable objects when the buildings came down and almost none of
them were itemised at intake. The test is whether the justification describes
your **life** or your **predicament**: a life gets a yes, and a crowbar
requested in the exact minute you met a stuck door does not.

## Nobody dies between two lines of text

The first blow in a fight that would kill you instead leaves you upright, on one
knee, with a round in hand.

```
│ That should have been the end of it. It is not, quite. You are on one knee
  with a round in hand and every camera in the district swinging onto you —
  change something, or this was simply a longer way of dying.
```

It is not a free life. Nothing is healed, the clock does not stop, and the next
thing that lands finishes it — but you get to answer. Some minted skills and
classes grant a second one.

Past that there is a ladder, and it is the reason nothing in this game has to
pull a punch: **the start of the room, then the start of the floor, then that is
the run.** Both come back every time you take the stairs. A game with permadeath
and no second chances has to be careful with you or it is cruel; a game with
unlimited ones has no stakes; this one can build a floor that genuinely kills
people and still be fair about it.

The death screen also tells you, flatly and without softening anything, what was
in reach and never used — the healing you were carrying and did not drink, the
device still in the bag, the spell you could afford. Not to soften the death. A
death you can see the shape of is one you can learn from, and the alternative is
a screen that just says no.

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

## The game is allowed to lose

A crawler who works out how to build a burn-through charge, puts a fuse in a
pouch, throws it, and lands it on a person-sized boss's head does not get a
health bar in reply. The boss dies. The fight is over in four seconds, the
pacing is ruined, the encounter budget is a joke, and **that is the correct
outcome** — the same way the crawlers who came down the stairs holding service
pistols got to shoot things in the head until the ammunition ran out.

Nothing here is a damage cap. What keeps it from trivialising the game is that
every devastating answer is narrow in four separate places:

- **Knowledge.** Recipes are gated on real skill levels, and the serious ones
  are learned, found, or worked out at a bench over hours you do not have.
- **Materials.** Not lying around.
- **Delivery.** It has to land, on something moving that has noticed you.
- **The target's own nature.** This is the one that does the work.

```ts
export function vitalMultiplier(target: Combatant, tags: readonly string[]): number {
  const traits = traitsOf(target);
  for (const tag of tags) if (traits.includes(`immune:${tag}`)) return 0;
  let mult = 1;
  if (traits.includes("no_vitals")) mult *= 0.2;   // an ooze, a swarm, a construct
  if (traits.includes("massive")) mult *= 0.35;    // more mass than you can carry upstairs
  else if (traits.includes("large")) mult *= 0.7;
  ...
```

Same charge, same throw, three targets:

| target | | result |
|---|---|---|
| The Hoarder | 220 hp, person-sized | **888 damage. Dead.** |
| The Ball of Swine | 620 hp, `massive` | 194 damage. It has 426 left and a great many other places. |
| Soot Djinn | 96 hp, `immune:fire` | 0. You have given it a warm afternoon and told it where you are standing. |

Called shots work the same way: much harder to land, ignore armour entirely,
and triple what the weapon does — so a firearm reliably ends an ordinary mob in
one shot without ever one-shotting something built out of a building. An ooze
will tell you there is nowhere on it that matters more than anywhere else on it.

Build the run around one answer and the floor that answers back kills you. That
is a better trade than a damage cap, and it is the whole reason bosses can be
genuinely hard.

## Where the gold goes

Money used to accumulate with nothing to spend it on, which quietly deletes a
whole decision layer: whether to sell the thing, whether to walk back to a shop,
whether this is a buying floor or a saving floor.

A **personal space** (3,200g, from floor three) is a door that was not there,
off every safe room on every floor from then on. It is empty. It is four walls
and a light, and it is the first thing since the sky went that belongs to you.
Then you pay for everything you put in it:

| | | |
|---|---|---|
| Alchemy Bench | 2,600g | potions, toxins, reagents worth carrying |
| Engineering Bench | 4,200g | traps that reset, repairs that are not a bodge |
| **Ordnance Studio** | **7,800g** | blast-rated, ventilated, behind its own door — the reason people take out loans |
| Forge | 11,000g | raises a weapon's damage die permanently, which nothing else does |
| A Real Bed | 1,800g | Rested lasts twice as long |
| Grow Lamps | 3,600g | reagents accumulate while you are elsewhere being hit |
| Armoury Wall | 2,900g | gear kept here does not degrade |
| Storage Racking | 1,400g | somewhere to put the vending machine |

Guild halls keep a communal alchemy and engineering bench — worn out, always
busy, free — which is how most crawlers make their first potion and why the
crafting layer is never gated behind money entirely. The Ordnance Studio is
never communal. That is the entire reason it costs what it costs.

The numbers are measured, not guessed: `npm run sim` reports what a crawler is
actually carrying at each depth, and prices are set so a room lands around floor
five, the first bench a floor or two later, and the studio is a real commitment
somewhere past floor eight.

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

## Inventory, for people who loot everything

There is no slot limit. There never was. The only question is whether you can
get the thing off the ground for the two seconds the interface needs — which
makes **Strength the storage stat**, and means yes, eventually, the vending
machine.

Which means the bag gets enormous, so it comes with tools:

| | |
|---|---|
| `inv weapons\|armour\|consumables\|materials\|junk` | filter |
| `sort value\|weight\|rarity\|name\|recent` | reorder; default is relevance |
| `equip best` | wear the best of what you carry, in one command |
| `drop junk` | everything worthless and unlocked, on the floor |
| `lock 7` | protect something from bulk operations |
| `use 4` / `equip 11` | every item has a number; nobody types full names |

Every line shows `▲ better than Padded Gambeson` against what you have on, so
comparing does not mean remembering.

Loot itself is a deliberate mixture. Most lines come off the catalogue, about a
quarter are procedurally affixed with real modifiers, and a few — only at rare
and above — are **tailored**: made for you, and they say so.

> *Serrated Maul of Small Hours, Fitted* — Leaves a wound that keeps arguing
> after the fight. Made from what was left of The Hoarder. It is still slightly
> warm and the system would like you to notice that.

---

## Layout

```
src/core/     rng, events, types, and hooks — the vocabulary generated content is built from
src/data/     content: items, mobs, floors, skills, boxes, sponsors, statuses, recipes
src/sim/      map generation, tactics, combat, enemy AI, loot, spells, the show,
              emergent (minted skills and assembled classes), crafting, devices,
              improvise, the facade
src/voice/    the System AI's procedural voice, and the optional LLM camera
src/cli/      the terminal client — thin, and it cannot reach past Game.execute
src/web/      the browser client, and the HTML shell it gets inlined into
tools/        the auto-player, the balance harness, the web build, the browser smoke test
test/         105 tests
web/          the built single-file page, committed so it can be hosted directly
```

Everything goes through `Game.execute(command)`. The terminal client, the
browser client, the balance harness and the test suite all play exactly the same
game, because none of them can reach past that method — the web client has no
privileged access whatsoever, it can only ask questions and draw answers.

## Determinism

Every number comes from a seeded stream. A run is reproducible from a seed plus
a list of commands, which makes bug reports exact and save-scumming pointless.
Floor generation uses a stream derived purely from `(seed, floor)`, so floor 3
is the same floor whether you got there in six hours or sixty. The obituary
prints your seed.

## Balance is measured, not asserted

`npm run sim` plays a few hundred complete runs with a competent policy and
reports what happened. Tuning a damage formula by reading it is guesswork.

The policy plays through the same public command surface a person uses,
including the backload ladder — a harness that ignores it is measuring a game
with permadeath and no second chances, which is not this game, and it is the
number every floor's difficulty was set against.

```
  120 runs, stopping at floor 18

  SURVIVAL
    died               110  (92%)
    reached floor 2     80  (67%)
    reached floor 4     47  (39%)
    reached floor 6     17  (14%)
    reached floor 9      9  (8%)
    reached floor 12     3  (3%)
    reached floor 16     1  (1%)

  PROGRESSION            mean    median
    backloads spent         3.3     3.0
    gold                  656.9   319.0
    gold + sellable      5081.2  2212.0

  THE ECONOMY
    could afford a space        50  (3200g)
    could afford the studio     19  (7800g)
```

The harness is the most demanding test in the repo, and it is the only reason
any of the following were ever found: the collapsed ceiling that orphaned a
position so a fight could never end; the bounty hunter that spawned at level 40
against a level 4 crawler; the Celestial box that quietly handed out rare loot
because the catalogue fallback walked *down* the rarity table; the build bias
that appended tags to an already-broad pool so a Gold box felt identical for a
brawler and an archer; the five-level cliff between floors three and four,
caused by a mob arriving at the top of its level band the instant it became
legal at all; and a floor-eighteen corridor holding a level-four crab, because
the authored bestiary runs out around floor four and the fallback reached for
the weakest thing on the list rather than the hardest. A hand-written test
exercises the case you thought of.

Floors five and deeper currently reuse floor four's template with levels
extrapolated by depth. That is a placeholder with the right shape, and it is
marked as one in the code — it wants its own bestiary and bosses.

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

```ts
// src/data/emergent.ts — a pattern the engine can notice about you
{ id: "choke_fight", threshold: 6, group: "combat",
  names: ["Doorway Work", "Holding the Line", "Corridor Fighting"],
  hooks: [{ k: "accuracy", when: "choke", v: 1 }, { k: "defense", when: "choke", v: 1 }],
  origin: "You keep putting your back in a doorway and making things come to you one at a time.",
  coveredBy: ["shield", "polearm"] }
```

The one rule the content follows: **if a skill or a modifier is on a list, some
line of code asks for it by name before it decides something.** No decorative
stat lines, and no skills that are only a joke — the joke goes in the
description, next to the number that does the work. That rule is what lets
generated content be trusted: everything the generator can say, the resolver
already knows how to read.
