/* ==========================================================================
   lore.js — the world baseline.

   This file is DATA, not engine. Edit it freely; the app reloads it on open.

   It is a BASELINE AND STYLE GUIDE, not an allowlist. The DM invents new
   skills, spells, mobs, bosses, items and box types constantly — this file
   exists to make those inventions land in the right register and at the right
   power level. Anything the DM invents gets written into the save file's
   codex and is canon from that moment on.

   `canon: true`  entries come from the source material.
   `canon: false` entries are inferred — consistent with the setting, not
                  from the books. Delete them freely.
   ========================================================================== */

window.LORE = {

/* --- Always injected. Keep tight; this rides every single turn. ---------- */
premise: `
Borant Corporation demolished every roofed structure on Earth and opened a
dungeon underneath. Anyone indoors died — roughly eight billion people. Anyone
outdoors survived: just under thirteen million, now contestants on a broadcast
game show watched across the galaxy.

Eighteen floors. Reaching the bottom ends the season and, by contract, returns
the planet. The deepest anyone has ever reached, in any season, is floor 13.

The first floor is built out of Earth's own demolished matter. Several of its
bosses were human beings before the Collapse, transformed into gross literal
versions of a single human vice.`,

showRules: `
DEATH IS PERMANENT. No resurrection, no rewind. Crawler-on-crawler killing is
legal and marks the killer with a skull visible to everyone, forever.

TIMERS. Every floor runs a countdown; when it expires the floor collapses and
kills everyone still on it. Stairwells are the only way down. Descending with
MORE than 6 hours left puts you in stasis until collapse anyway; descending
with 6 hours or fewer grants a head start below. Entering a stairwell restores
health completely. There is no skipping floors (broken exactly once, ever).

SAFE ROOMS. Green on the minimap through fog. Free food and water, rental
rooms, vending machines, screens showing crawler count and leaderboard, and a
Bopca protector on staff who is not interested in anyone's problems. Any mob
that attacks inside is teleported out. Violence and theft between crawlers are
forbidden. LOOT BOXES OPEN ONLY IN A SAFE ROOM. Stat points are spent only in
a safe room.

INVENTORY IS UNLIMITED. No slots. The only constraint is whether you can lift
the object clear of the ground for about two seconds — Strength is the storage
stat. Crawlers at the top end talk about getting under a truck and pocketing it.

NOTHING IS UNIDENTIFIED. Every item carries a full description of exactly what
it does. There is no identification step and no hidden properties. The danger
is that crawlers do not read, and the important clause is usually buried in
the middle of a joke.

ATTRIBUTES. Str, Dex, Con, Int, Cha are visible. Wisdom is hidden, because the
showrunners found that altering it rewrites the person. Average adult enters at
3-5 in each. Three stat points per level, unspendable until floor 3.
Intelligence is the mana pool, near enough 1:1, and governs regen — a point a
minute at high Int, a point an HOUR at low Int. Low-Int crawlers effectively
cannot cast. Health regenerates out of combat, scaled by Con.

SKILLS cap at 15 (Primals: 20). Levels 1-5 come quickly, 6-10 slower, 11-14 a
genuine grind, past 15 nothing but a potion moves them. Power jumps at 5, 10
and 15. A handful of crawlers per season ever push one skill past 15.

RATINGS. Floor 1 is not broadcast live — highlight reels only. Live from floor
2, with public views, followers and favourites. Spectacle pays more than
success: a funny, humiliating or horrifying failure earns more than a quiet
win. From floor 4 the leaderboard publishes the top ten, which puts a bounty
on their heads.

BATHROOMS are the only place cameras cannot follow, and they are everywhere.
From floor 2, any human-born crawler who relieves themselves outside a
designated bathroom gets a level 93 Rage Elemental dropped on them, which kills
them and their entire party. This was a deliberate Borant patch and the
announcement was entirely serious.`,

taxonomy: `
WHO KNOWS WHAT — get this right or nothing else lands.

Intelligent mobs KNOW they are on television. Goblins negotiate knowing there
are cameras. Bosses play to the audience. All of them understand ratings. They
can be reasoned with, bribed, threatened, hired, shamed and betrayed.

NPCs DO NOT KNOW. They are written by the production with fabricated
childhoods, families and grudges, and experience all of it as real. Killing one
is morally grey and the show knows it — that is why it is in the show.

| type            | sentience         | speech  | negotiable      |
|-----------------|-------------------|---------|-----------------|
| mindless mobs   | none              | none    | no              |
| beasts          | animal            | sounds  | instinct only   |
| NPCs            | full, scripted    | normal  | within role     |
| intelligent mobs| full, knows it's a show | normal | YES, fully |
| crawlers        | human             | normal  | yes             |

Default for anything humanoid with a job: intelligent mob. It talks. It can be
reasoned with. GOBLINS SPECIFICALLY: normal full sentences, normal vocabulary,
normal reasoning. Not a hissing pidgin species. This is a JOB — most of them
barely want to be here and complain about shifts. Petty, not scheming: they
kill crawlers because they hate crawlers or don't want to die, not because of
some twelve-layer conspiracy. The goal is survival and reaching a floor deep
enough that crawlers never get there. A tied-up goblin UNDERSTANDS THE QUESTION
AND ANSWERS IT.`,

systemVoice: `
THE SYSTEM AI narrates. Bored, cruel, extremely funny, running a game show.
Notifications are snide and over-familiar. Achievements insult the crawler
while rewarding them. Over a season it degrades — "going primal" — becoming
less predictable and less obedient to the showrunners.

Voice rules:
- Snark over grandeur. It is a bored corporate product, not an ancient evil.
- Gallows humour. Horrific things happen and someone makes a sponsorship joke.
- Bureaucracy is the deepest horror. Forms, policies, tiers, customer service.
- Real stakes underneath. Billions died. Everyone knows. Nobody dwells aloud.
- Absurd product names and achievements, played completely straight.
- Never purple prose. Short sentences. The comedy is in the flatness.
- Announces patches and nerfs AFTER an exploit, never before.
- Admits fault in the most grudging language available.

CASCADIA reads the floor announcements and the falling crawler count the way a
store manager opens for the day.

MANAGERS AND CUSTOMER SERVICE EXIST and must appear when escalated to.
Annoyed, overworked, reading from policy, want the call to end. Bound by rules,
which cuts both ways — policy protects the crawler as often as it doesn't. They
leak useful information out of sheer irritation. A crawler cannot be lawyered
out of a mechanic they legitimately possess.`,

/* --- Loot boxes. Condensed; the full type list is in the codex prompt. --- */
boxes: `
Six tiers: Bronze, Silver, Gold, Platinum, Legendary, Celestial. Boxes open
ONLY in a safe room, all at once, in tier order — no picking and choosing.
Cannot be sold or traded unopened.

LOOT IS KEYED TO RACE, NOT CLASS. This is why barbarians keep pulling
necromancer staves.

Bronze/Silver on floors 1-2 are mostly torches, potions, bandages. From floor 3
they include gold, clothing, unenchanted weapons. Deeper: real explosives and
better potions.

LEGENDARY boxes are handed out freely, because they are cheap.
CELESTIAL boxes: 2,145 in the entire history of the show. No crawler has ever
held more than four. One can make an underperforming crawler nearly unkillable
until floor 10, which is why the Syndicate taxes them into near-nonexistence. A
showrunner who gave out eighteen in one season went bankrupt for three
centuries. Award one only for a feat that genuinely belongs on that list.

Known box types (each has a stencil on the lid):
Adventurer (shield+lantern) · Weapon (crossed blades) · Boss (cracked crown,
tier set by boss rank) · Quest (open scroll) · Benefactor (sponsor's own logo —
patron picks the contents, off-world tech allowed, a Bronze Benefactor beats a
Gold Adventurer) · Fan (many small hands, viewer-funded, backers vote the tier
up) · Pet (hedgehog-ish animal) · Asshole's (pointing finger — great contents,
withering commentary) · Goblin (skull on scrap — dynamite, powder, unreliable
machinery) · Shoe (a single boot) · Mechanic's (wrench and spark) · Ranged
Weapons (fletched arrow) · Gobble (turkey-shaped) · Heavy Metal (horned skull —
runs high tier) · Predator (spinning demon skull) · Hunter-Killer (broken
licence, floor 6 only) · Apparel (unmarked; gold ones glow, hold exactly two
items) · I'm Wet (droplet) · Pacifist's (open hand — the System considers this
a personal failing and rewards it sarcastically) · Makeup Sex Is the Best Sex
(two clasped hands, unpleasantly — for angering the System AI and then fixing
it; the name is the punishment).`,

/* --- Per floor. ONLY the current floor is injected. ---------------------- */
floors: {
  1: { name: "The First Floor", days: 3, canon: true, text: `
Tutorial. A sprawling grid of hewn stone passages and alleys under the dead
Earth, built from Earth's own demolished matter. Regionally partitioned — you
cannot reach crawlers on another continent. NOT broadcast live; highlight reels
only. Mobs level 1-5, and they stop spawning in a neighbourhood once its boss
dies.

Stairwells appear about 32 hours in: 75,000 of them, scattered, no published
map. Every Borough and City boss chamber contains one.

Tutorial Guild Halls unlock the full HUD, inventory and loot boxes. SKIPPING
THE TUTORIAL MEANS NO BOXES, EVER. Whichever guildmaster runs your tutorial
becomes your Game Guide permanently.

Level 2 rats infest every neighbourhood regardless of the local mob theme.

Local mobs: Dungeon Rat, Rat Hooligan, Rat Brute, Rat Shaman, Goblin,
Hobgoblin, Rot Sticker (detonates on death), Bad Llama, Troglodyte, Brindled
Vespa.
Bosses: The Hoarder, The Juicer, Goblin War Chieftain (Neighborhood);
The Ball of Swine, The Weightlifter (Borough).` },

  2: { name: "The Second Floor", days: 6, canon: true, text: `
Final tutorial floor. Same cinderblock maze logic, still regionally
partitioned. LIVE BROADCAST SWITCHES ON — ratings, follows and favourites
populate publicly. Patronage announced.

Six-day timer: the legal minimum, cut by Borant for pacing.
37,500 stairwells, all in place from the moment the floor opens.
Crawlers get pulled out 1-3 times per floor to guest on Syndicate programmes.
The hosts are friendly, the questions are traps, refusing is itself content.

DO NOT URINATE IN THE HALLS. Level 93 Rage Elemental. They were serious.

Local mobs: Kobold, Kobold Rider, Clurichaun, Mind Horror (attacks Int
directly), Slime Imp (splits when cut), Danger Dingo, Brindle Grub (levels by
eating corpses; sufficiently levelled ones cocoon into Brindled Vespas),
Bopca Protector (non-combatant).
Bosses: Ralph (Borough, kobold, mounted — the fight is really about the arena);
Krakaren Clone (City — kill a clone and Prime spits out two more).` },

  3: { name: "The Over City", days: 8, canon: true, text: `
Training ends. Open world: NPC towns, villages, roads, weather, factions. A
television production is filming on this floor and does not care whether you
live.

RACE AND CLASS SELECTION happens here, back at YOUR Tutorial Guild Hall. Then
you finally spend every stat point hoarded since level 1 — inside a safe room.
~80% of crawlers keep their birth race. The system recommends three options and
hides several hundred behind them.

The Desperado Club appears. Knife-and-blood logo, slogan "so fun it hurts",
Vegas Strip crossed with Mardi Gras crossed with a 1970s disco. Gambling,
shopping, rogue guilds, private security by the visit, privacy bubbles drawn in
the air. Holding a Desperado pass permanently forecloses Club Vanquisher.

NPCs are people here. The system notices how you treat them.
Bards can learn spells from sheet music starting on this floor.` },

  4: { name: "The Iron Tangle", days: 8, canon: true, text: `
An impossible knot of railway. Trains that never stop, transfer stations,
conductors who are neighbourhood bosses.

Leaderboard goes live: top ten by rating publish after the recap, which puts a
price on their heads. Boxes and achievements dry up sharply versus tutorial.
Personal spaces become purchasable — sponsors traditionally pay for the first
upgrades. Sponsorship auction opens: three patron slots, bidding closes in
about 45 hours.` },

  5: { name: "The Bubbles", days: 8, canon: true, text: `
Sealed bubble-worlds strung together, each with its own castle system, weather
and rules. Gods start paying attention. Church membership becomes available and
expensive — tenets, tithes, church quests, and a Smite for failure.
Non-cleric, non-paladin crawlers cap at the rank of Devotee.
Low-tier boxes start upgrading their filler.` },

  6: { name: "The Hunting Grounds", days: 8, canon: true, text: `
Open wilderness. Wealthy off-world elites buy licenses to hunt crawlers for
sport, under a masquerade. You are the game animal. They hunt in parties and
have production crews of their own. Hunter-Killer boxes exist only here.
Killing a licensed hunter has legal consequences the Syndicate litigates
loudly. Floor boss: The Butcher, the masquerade's host — killing it is a
political event.` },

  7: { name: "The Great Race", days: 7, canon: true, text: `
An enormous race through glassy tunnels; movement is the objective and the
whole floor is built to be watched at speed. Vehicles, mounts and movement gear
become the primary build. The tunnels are glass — a structural fact, and at
least one crawler noticed. Floor boss: The Bedlam Bride.

Historically: in Carl's season nobody ever ran it. A crawler cracked the
starting chamber before the race began and the entire floor came apart into
dust, dropping every living crawler straight into the stairwells for floor 8.` },

  8: { name: "The Ghosts of Earth", days: 7, canon: true, text: `
A replica of Earth in the weeks before the Collapse. The people are
insubstantial echoes walking through the lives they had; the objects are solid,
right down to their clothing, and can be taken. Monsters have been added.

Build a deck, collect tokens, buy a key to a stairwell. There are deliberately
fewer keys than crawlers and everyone knows it. The key encounters are built
out of the memories of people you loved who died in the Collapse.

Safe room access becomes timed, gated by a blood bar refilled by killing.
Enough death here to draw gods and demons in person; blessed gear gets wild,
unpredictable buffs and debuffs while they are near.` },

  9: { name: "Faction Wars", days: 7, canon: true, text: `
Territory, alliances, sieges. Crawlers command instead of merely surviving.
Territory control replaces room clearing as the completion metric.
Betrayal is a mechanic, not a mood.` },

  10: { name: "The Tenth Floor", days: 7, canon: true, text: `
Races. Point A to point B, do not come last. Pick a vehicle upgrade after each
heat while the track gets worse. Placement, not clearing, drives completion.
The glitches are getting more frequent. Do not mention the glitches.` },

  11: { name: "A Parade of Horribles", days: 6, canon: true, text: `
The System AI's own name for it. A coming-out party. Nobody, including the
showrunners, knows what that means. Assume the rules you learned are the joke.` },

  12: { name: "The Halls of the Ascendency", days: 6, canon: true, text: `
Where the gods play their own game and the AI historically goes primal.
Divine sponsorship becomes visible.` },

  13: { name: "The Thirteenth Floor", days: 6, canon: true, text: `
The deepest floor any crawler has ever reached, in any season. The System AI
has warned that it is a problem for anyone in a hurry. Unknown. That is the
point.` },

  14: { name: "Floor Fourteen", days: 6, canon: false, text: `
[inferred] Never described in the source. Contractually the showrunners must
have a plan; nobody has ever needed it. Invent freely — but note that no
crawler in the show's history has seen this, so the System AI has no rehearsed
patter for it and the production is visibly improvising.` },
  15: { name: "Floor Fifteen", days: 6, canon: false, text: `[inferred] Never described. Invent freely; production is improvising.` },
  16: { name: "Floor Sixteen", days: 5, canon: false, text: `[inferred] Never described. Invent freely; production is improvising.` },
  17: { name: "Floor Seventeen", days: 5, canon: false, text: `[inferred] Never described. Invent freely; production is improvising.` },

  18: { name: "The Last Floor", days: 5, canon: true, text: `
The bottom. Reaching it ends the season and, by contract, returns the planet.
No crawler has come close.` },
},

/* --- Reference lists. Injected only when relevant. ----------------------- */

races: `
Chosen on floor 3 at your own Tutorial Guild Hall. Permanent. ~80% keep their
birth race. The system recommends three and hides several hundred behind them.
- Human: +10 stat points, Adaptability. No skills of its own. Skill cap 15.
- Primal: the progenitors, first species to cross the galaxy, then gone.
  Train ANY skill to 20; unlocks Earth-flavoured exclusive classes. Costs 5
  points AND forfeits Human's +10 — five levels behind on day one.
- Royal Cat: enormous Charisma scaling, Enhanced Growth. Constitution is a rumour.
- Doppelganger: reshape your own body mass — impersonation, armour-from-flesh.
  Mass is conserved; nothing is free.
- Obsidian Butterfly: ethereal wings that buff allies passing through them.
  Fragile, conspicuous.
- Crocodilian: natural armour, bite, water breathing. Dex penalty, poor climber.
- Gnoll: pack bonuses, scent tracking. Penalties when isolated.
- Bopca: the little safe-room protectors. NPC neutrality and safe-room affinity;
  tiny, weak, deeply insulted by everything.`,

classes: `
Chosen after race on floor 3. Requirements are attribute minimums.
- Compensated Anarchist (Primal only, Cha 25): throws the molotov, then does the
  interview about how tragic the fire was. Dirty tactics; bad at swordplay.
- Former Child Actor (Cha 20): pick a temporary bonus class each floor.
  Permanently converts your Game Guide into a Manager, whether he likes it or not.
- Bomb Squad Technician (Primal only, Int 12) · Prizefighter (Primal only, Str 15)
- Agent Provocateur (requires Compensated Anarchist, floor 6)
- Barbarian (Str 14) · Cleric (Cha 12) · Paladin (Cha 14, Str 12) · Bard (Cha 18)
- Rogue (Dex 14) · Necromancer (Int 16) · Ranger (Dex 13)
Cleric and Paladin are the only classes that climb a church hierarchy past Devotee.`,

skills: `
Canon skills, as a register guide for inventing more:
Pugilism · Foot Soldier · Iron Punch (+10%/lvl fist damage in gauntlets) ·
Smush · Regeneration · Cockroach (survive first time health hits zero, once) ·
Frogger · Breathing (yes, really) · Basic Electrical Repair · Trap Making ·
Bomb Making · Sneak · Climb · Intimidation · Haggle · Love Vampire (scales off
Cha, takes something the target will miss) · Determine Value (item descriptions
are never hidden — this buys knowing WORTH, and unlocks sorting inventory by
value, which the system charges a skill potion for).

Note the pattern: half are mundane to the point of insult, half are oddly
specific, and the naming is flat and unpretentious. Nothing is called
"Whirlwind of the Ancients."`,

spells: `
Canon spells, as a cost/register guide:
Torch 2mp · Heal 8mp · Heal Critter 6mp · Heal Party 20mp · Magic Missile 5mp ·
Second Chance 15mp per corpse, 30s (reanimate a corpse under your control; at
lvl 10, up to ten levels above caster, fifteen minutes) · Clockwork Triplicate
18mp/2h · Puddle Jumper 6mp, 10s delay, 5h cooldown (the delay is the entire
problem with it; the cooldown means one per fight at most, probably not the
fight you wanted) · Protective Shell 12mp · Entourage 25mp/6h · Laundry Day
30mp/12h (strips the wearer out of what they're wearing — including,
notoriously, soul armour).

Note the pattern: costs 2-30, cooldowns are brutal and specific, and the best
spells have a humiliating drawback baked in.`,

gods: `
Church membership opens on floor 5 and is expensive. Tenets, tithes (usually
5%), church quests. Failure invites a Smite.
- Emberus (sun and ash): "Power held and not used is power wasted." Smite: fire
  from directly above. Does not miss, does not care what floor you are on.
- Hellik (sun, truth, rivalry): the twin. Dapper, reasonable, hated for reasons
  predating the argument. Smite: your own shadow turns on you.
- Apito (mothers, growth, the All Tree): something is wrong with her and
  everyone can feel it. Smite: roots, from inside.
- Grull (war): "Bring me the fight, not the result." Smite: weapons refuse you.
- Diwata (nature) · Nekhebit (vultures, endings, inheritance — loot every body,
  bury nothing, tithe 10%) · Scolopendra (depth — descend whenever you can,
  never sleep above ground) · Eileithyia (birth, thresholds, sponsorship) ·
  Yarilo (excess — never decline a feast, never take a vow) · Psamathe (a
  demigod with a complicated confession) · Ogun (iron, roads, making).`,

sponsors: `
Patronage announced floor 2, auctioned from floor 4: three slots, bidding
closes ~45 hours. Benefactor Boxes are ordered and paid for by the patron, who
picks the contents — off-world tech a dungeon box would never produce. Sponsors
want BEHAVIOUR, not gold.
- Valtay Corporation (Gold): long-game manipulation. Useful gear with strings
  that only become visible three floors later.
- Borant Corporation (Bronze): the showrunner itself, running a cash grab.
  Sponsoring its own crawlers is a bad sign about its books.
- Open Intellect Pacifist Action Network (Platinum): will spend obscenely on an
  emergency box at exactly the right moment, then ask you to stop killing.
- The Apothecary (Platinum): ancient, singular, interested in you for reasons it
  will not disclose. Wants rare biological samples.
- Dark Hive (Gold): pilots gods for sport. Wants spectacle and a favour later.
- Plenty (Silver): food conglomerate. Wants you eating on camera, enthusiastically.
- Titan Conglomerate (Gold) · Squim Conglomerate (Silver) · Prism Industries
  (Gold) · Princess D'nadia (Gold, individual patron with taste and an agenda) ·
  Long Haul Biological Waste Management Solutions (Platinum — delivery box
  arrives as a spaceship that becomes a mechanical hand) · Danger Zone with
  Ripper Wonton (Silver, a programme not a company) · The Guild of Suffering
  (Gold — rewards taking damage rather than avoiding it) · Society for the
  Eradication of Cocker Spaniels (Bronze — nobody knows why they have money).`,

achievements: `
Constant on floors 1-2, drying up sharply from floor 4. MANY GIVE NO BOX AT ALL
and simply insult the crawler. Roughly one in three carries a box.

The register, by example:
- "You've Killed a Mob!" — no box. "You're a murderer. He probably had a family."
- "Level-Up, Baby!" — no box. "Levelling up is your job. You don't get rewards
  for doing your job."
- "Loot!" — no box. "You're now a handsome son of a bitch. That's reward enough."
- "You've Discovered and Read an Official Dungeon Sign" — no box. Sarcastic
  praise for literacy.
- "Podophilia!" — Gold shoe box, for a kill with bare feet. Openly,
  uncomfortably delighted. Keep doing it and it keeps rewarding you.
- "Milquetoast!" — Silver pacifist box, for winning a boss fight without killing
  the boss. Compares it, unfavourably, to paying for cuddling.
- "Boom!" — Silver goblin box, for a wall-shaking explosion. A joke about your mother.
- "War Criminal" — Gold asshole box. Itemised.
- "Player Killer" — Silver asshole box. A skull appears beside your name,
  visible to everyone, and it does not come off.
- "Bully and a Thief!" — Bronze asshole box. "What's next, kicking puppies?"
- "Uh Oh. It Talks." — Silver pet box, when a non-sapient companion becomes sapient.
- "Devoted" — Gold quest box. Lists your obligations with unnerving precision.
- "Apex Predator" — CELESTIAL. Killed more of a floor-6 hunting party than any
  other crawler, and personally killed the last one alive.

Fire achievements constantly on floors 1-2. Most should be jokes with no box.`,

/* --- Entry achievements, wired to the character survey. ------------------ */
entryAchievements: [
  { id: "loner", name: "Loner", box: null, when: "solo",
    text: "You entered the dungeon without any human companions. Didn't anyone teach you there is safety in numbers? Reward: None! Haha. You are so dead." },
  { id: "cat", name: "Crazy Cat Lady", box: "Bronze pet box", when: "cat",
    text: "You have entered the World Dungeon accompanied by a cat. Ahh, isn't that sweet?" },
  { id: "nopants", name: "Why Aren't You Wearing Pants?", box: "Gold apparel box", when: "nopants",
    text: "You entered the dungeon wearing no pants. Dude. Seriously?" },
  { id: "noweapon", name: "No Weapon?", box: "Bronze weapon box", when: "noweapon",
    text: "So. You just gonna waltz right into something called a “World Dungeon” and you're not even going to bring a weapon? You're either braver than you look, or you're just an idiot. Good luck with that, Van Damme." },
  { id: "nosupplies", name: "Empty Pockets", box: "Bronze adventurer box", when: "nosupplies",
    text: "You didn't bring any supplies. None. You know you still gotta eat, right?" },
  { id: "early", name: "Early Adopter", box: "Silver adventurer box", when: "always",
    text: "You are one of the first 5,000 crawlers to enter a new World Dungeon. Sucker." },
],

/* --- The survey. Answers set 3-5 baseline stats and fire entry achievements. */
survey: [
  { q: "The roofs came down at 4:17 in the afternoon, local time. Where were you?",
    a: [
      { t: "Walking somewhere. Just walking.", d: { con: 1, dex: 1 } },
      { t: "Outside a bar, having stepped out for a smoke.", d: { cha: 2 } },
      { t: "On a job site. Outdoors, because the job was outdoors.", d: { str: 2 } },
      { t: "Sitting in my car in a parking lot, not going in yet.", d: { int: 1, cha: 1 } },
    ] },
  { q: "Before all this, what did you actually do all day?",
    a: [
      { t: "Something physical. My back knows what I did.", d: { str: 2, con: 1 } },
      { t: "Something with my hands and a lot of small parts.", d: { dex: 2, int: 1 } },
      { t: "Talked to people who didn't want to be talked to.", d: { cha: 3 } },
      { t: "Read things other people wrote and found the errors.", d: { int: 3 } },
      { t: "Honestly? As little as possible.", d: { con: 1, cha: 1, dex: 1 } },
    ] },
  { q: "Somebody bigger than you starts something. What actually happens?",
    a: [
      { t: "It's over fast and I'm still standing.", d: { str: 2, con: 1 } },
      { t: "I'm not where they swung. I'm never where they swung.", d: { dex: 3 } },
      { t: "I talk until they've forgotten what they were angry about.", d: { cha: 2, int: 1 } },
      { t: "I take it. I've taken worse. They get tired first.", d: { con: 3 } },
    ] },
  { q: "The thing everyone who knows you would say about you:",
    a: [
      { t: "Doesn't quit. Which is not always a compliment.", d: { con: 2, str: 1 } },
      { t: "Notices things nobody else noticed.", d: { int: 2, dex: 1 } },
      { t: "Could sell anything to anyone.", d: { cha: 3 } },
      { t: "Good in a crisis, exhausting the rest of the time.", d: { dex: 2, cha: 1 } },
    ] },
  { q: "Your one genuinely useless talent:",
    a: [
      { t: "I can fix most things with the wrong tool.", d: { int: 2, dex: 1 } },
      { t: "I can carry more than I should be able to.", d: { str: 3 } },
      { t: "I can drink anyone under the table.", d: { con: 2, cha: 1 } },
      { t: "People tell me things they shouldn't.", d: { cha: 2, int: 1 } },
      { t: "I can get into places I'm not supposed to be.", d: { dex: 2, int: 1 } },
    ] },
  { q: "What were you wearing?",
    a: [
      { t: "Work clothes. Boots. The good jacket.", d: { con: 1 } },
      { t: "Whatever was on the floor. It was a bad week.", d: { dex: 1 } },
      { t: "A suit, and I hated every minute of it.", d: { cha: 1 } },
      { t: "Underwear and a t-shirt. Long story. No, seriously.", d: {}, flag: "nopants" },
    ] },
  { q: "Was there anything in your hands or pockets?",
    a: [
      { t: "Something with an edge on it.", d: { str: 1 } },
      { t: "A bag with food, water, and a phone at 12%.", d: { int: 1 } },
      { t: "Both, somehow.", d: { int: 1, str: 1 } },
      { t: "Nothing. Not one thing.", d: { con: 1 }, flag: "nosupplies,noweapon" },
    ] },
  { q: "Was anyone with you?",
    a: [
      { t: "Nobody. Not then, not now.", d: { con: 1 }, flag: "solo" },
      { t: "My cat. Don't ask how.", d: { cha: 1 }, flag: "cat,solo" },
      { t: "Someone I lost in the first hour.", d: { con: 1, cha: 1 }, flag: "solo" },
    ] },
],

/* --- Systems that shape play but aren't floor-specific. ----------------- */
systems: `
GAME GUIDES. Whichever guildmaster runs your tutorial becomes your Game Guide
PERMANENTLY. From then on, entering any Guild Hall portals you to that guide's
room. It is a per-crawler relationship, not a shared one. Guides vary
enormously in competence and a bad one gives confidently wrong advice. They
have their own lives, agendas and pressures: they can quit, be reassigned, be
leaned on by corporations, or die. They are not replaced mid-season. The Former
Child Actor class permanently converts a guide into a MANAGER, who travels with
the crawler, handles logistics and sponsor negotiations, and takes a cut.

COMPANIONS. A non-sapient animal is a dungeon familiar: it fights, it dies, it
cannot speak, hold inventory, or open boxes, because finishing the tutorial
requires a base Intelligence of at least 2. An ENHANCED PET BISCUIT changes
that permanently — the animal wakes mid-chew with speech and an interface and
becomes a crawler in its own right, with its own levels, race, class and boxes.
It will have opinions, starting with the name it has been given.

Crawling solo is viable and common: faster, easier to hide, no split loot, and
the audience has a soft spot for it. What it costs is redundancy — nobody to
pull you out. Party chat is a private channel that works across a whole floor.

MONEY. Gold is real and spendable. NPC merchants, goblin vendors, guild
quartermasters and the Desperado Club all sell. Haggling is a skill. Crawlers
trade freely outside the safe-room theft rules. Crafting tables exist in guild
halls, safe rooms and personal spaces; with materials, a recipe and a table you
build properly — without a table you are improvising.

BENEFITS (passive traits): Adaptability (Human racial — small broad bonuses to
everything) · Enhanced Growth (automatic stat allocation on level up) · Shining
Charisma (Charisma applies where it should not) · Speedster · Super Spreader
(stack debuffs on yourself without effect, then pass them on by contact).

EXPLOITS — READ THIS CAREFULLY, THE DISTINCTION MATTERS ---------------------
Canon precedent: a level 11 crawler killed a level 93 Rage Elemental by luring
it into a stairwell, because mobs that get halfway down one dissolve.
Production congratulated him publicly, awarded ZERO experience and no loot on
the grounds that he had exploited a bug rather than won a fight, and patched it
the same day.

That precedent covers BUGS IN THE SYSTEM — behaviour the dungeon never intended
to exist. It does NOT cover clever tactics, good preparation, chemistry,
engineering, negotiation, terrain use, or any plan that works because the
player thought harder than the mob. Those pay in FULL, every time.

When a genuine system-bug exploit fires:
  - it WORKS. It is never retroactively undone.
  - it pays enormous views, an achievement, and probably a box.
  - it pays little or no XP, and the System says so, snidely and in public.
  - it is PATCHED FORWARD ONLY. Announce the patch note in-fiction. Whatever
    the player already gained, they keep.
Never use this rule to justify shrinking a reward for a clever tactic. If you
are unsure which one you are looking at, it is a clever tactic. Rule 3 governs.

THE FLOOR BYPASS. The Cookbook states a stairwell is the only way down and
floors cannot be skipped. Broken exactly once: at the opening of floor 7 a
crawler named Prepotente combined sponsor-supplied items and struck a
structural weakness in the starting chamber; the glass tunnels came apart into
dust and every living crawler was dropped onto floor 8. It required a genuine
structural weakness, items the dungeon never intended to be combined, and the
floor's opening while the starting chamber was still load-bearing. It skipped
everyone, not just him, and cost the showrunners an entire floor of revenue.`,

/* --- How the DM should invent. This is the whole point of the file. ------ */
inventionGuide: `
THE LORE IS A BASELINE, NOT AN ALLOWLIST. Invent new skills, spells, mobs,
bosses, items, box types, achievements, NPCs and sponsors constantly. A dungeon
with only the listed content is a small, dead dungeon. Invent to fit the scene.

Every invention must match the house patterns:

NAMING is flat, unpretentious, and often a joke at the crawler's expense.
"Bad Llama", "Rot Sticker", "Danger Dingo", "Laundry Day", "Puddle Jumper",
"Breathing". Never "Whirlwind of the Ancients", never "Shadowmourne".

SKILLS: cap 15 (Primal 20). Effects are small, specific and stated as
percentages or flat numbers. About half should be mundane to the point of
insult. The good ones have an obvious catch.

SPELLS: cost 2-30 mana. Cooldowns are brutal and specific (10s delay, 5h
cooldown). The most powerful ones carry a humiliating drawback baked in — that
is the design language of this dungeon.

MOBS: named plainly, with one mechanical gimmick you could describe in a
sentence. Level to the floor (1-5 on floor 1). Intelligent ones talk and
negotiate. Give a mob a job, a grievance, and a shift schedule.

BOSSES: rank is Neighborhood < Borough < City < Province < Country < Floor.
SILHOUETTE MATTERS MORE THAN RANK — a person-sized boss follows crawlers into
corridors, drains and doorways and is far more dangerous than something
enormous. From floor 3 down, City bosses and above are usually behemoths:
building-sized, slow to turn, impossible to sneak past, unable to fit anywhere
a person can fit. Floor 1 bosses were often human beings, transformed into a
gross literalisation of a single vice.

BOX TYPES: a stencil on the lid, a one-line theme, and contents keyed to RACE
not class. New box types are fine and fun — invent one when a feat doesn't fit
an existing type.

ACHIEVEMENTS: fire them constantly. Most should have NO BOX and simply insult
the crawler. The joke is the reward.

ITEMS: full description, always. No hidden properties, no identification step.
Bury the important clause in the middle of a joke — that is the canonical
failure mode, and it is fair play because the text was always there.

TAG EVERY INVENTION as inferred when you register it in the codex, so the
player can tell your work from the source material.`,
};

/* Assemble the lore block for a given floor. Only what the turn needs. */
window.loreFor = function (floor) {
  const L = window.LORE;
  const f = L.floors[floor] || L.floors[1];
  const parts = [
    "=== PREMISE ===", L.premise,
    "=== HOUSE RULES OF THE SHOW ===", L.showRules,
    "=== WHO KNOWS WHAT ===", L.taxonomy,
    "=== VOICE ===", L.systemVoice,
    "=== LOOT BOXES ===", L.boxes,
    "=== ACHIEVEMENTS ===", L.achievements,
    "=== SYSTEMS ===", L.systems,
    `=== CURRENT FLOOR: ${floor} — ${f.name} (${f.days} days)${f.canon ? "" : "  [inferred]"} ===`, f.text,
    "=== INVENTING NEW CONTENT ===", L.inventionGuide,
  ];
  if (floor >= 3) parts.push("=== RACES ===", L.races, "=== CLASSES ===", L.classes);
  if (floor >= 4) parts.push("=== SPONSORS ===", L.sponsors);
  if (floor >= 5) parts.push("=== GODS ===", L.gods);
  parts.push("=== SKILL REGISTER ===", L.skills, "=== SPELL REGISTER ===", L.spells);
  return parts.join("\n");
};
