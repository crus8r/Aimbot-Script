import type { GameState } from "../core/types.ts";
import type { Tier } from "./boxes.ts";

/**
 * Achievements fire from state, once each, whatever anybody is narrating.
 *
 * The previous design asked a language model to remember what it had already
 * awarded, which it could not, so it either reissued the same achievement
 * every turn or silently stopped handing out boxes. A predicate over game
 * state has neither failure mode.
 *
 * Roughly one in three carries a box. The rest are purely the dungeon having
 * an opinion about you in front of an audience of trillions.
 */

export interface AchievementDef {
  id: string;
  name: string;
  text: string;
  box?: [string, Tier];
  test: (s: GameState) => boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: "first_kill", name: "You've Killed a Mob!",
    text: "You're a murderer. He probably had a family, a routine, and a favourite corner. Reward: you can now earn experience, which is a reward in the sense that a shovel is a gift.",
    test: (s) => s.counters.kills >= 1,
  },
  {
    id: "first_level", name: "Level-Up, Baby!",
    text: "You have gained a level. Reward: nothing. Levelling up is your job and we do not hand out prizes for doing the job.",
    test: (s) => s.crawler.level >= 2,
  },
  {
    id: "first_unarmed", name: "With Your Bare Hands",
    text: "You killed something that was holding a weapon, using two things that were not. The audience metrics on this are frankly concerning and we are going to encourage it.",
    box: ["weapon", "Bronze"],
    test: (s) => s.counters.unarmedKills >= 1,
  },
  {
    id: "first_environmental", name: "That Was Load-Bearing",
    text: "You did not kill it. The building killed it. You merely had opinions about the building. This is the highest form of the art and we will be showing it again.",
    box: ["mechanic", "Bronze"],
    test: (s) => s.counters.environmentalKills >= 1,
  },
  {
    id: "punching_up", name: "Well Above Your Weight",
    text: "You killed something three levels above you. Statistically that was not available to you. We have checked the numbers twice and remain irritated.",
    box: ["adventurer", "Bronze"],
    test: (s) => s.counters.punchingUpKills >= 1,
  },
  {
    id: "near_death", name: "Somehow Still Alive",
    text: "You finished a fight under a twentieth of your health. Congratulations on a decision-making process that we can only describe as ongoing.",
    box: ["lucky", "Silver"],
    test: (s) => s.counters.nearDeaths >= 1,
  },
  {
    id: "ten_kills", name: "Getting the Hang of It",
    text: "Ten. The audience has started keeping count, which means you should too, because so has everything else on this floor.",
    box: ["adventurer", "Bronze"],
    test: (s) => s.counters.kills >= 10,
  },
  {
    id: "fifty_kills", name: "Industrious",
    text: "Fifty. At this rate the neighbourhood is going to notice that something is eating it.",
    box: ["savage", "Silver"],
    test: (s) => s.counters.kills >= 50,
  },
  {
    id: "first_boss", name: "Neighborhood Boss!",
    text: "A bronze star now follows your name in every notification you will ever receive, including the one about your death.",
    box: ["boss", "Bronze"],
    test: (s) => s.counters.bossKills >= 1,
  },
  {
    id: "coward", name: "Discretion, Apparently",
    text: "Three successful escapes. The gear in this box is genuinely excellent at running away. The name on the lid is permanent and will be read out at every award ceremony.",
    box: ["coward", "Bronze"],
    test: (s) => s.counters.fled >= 3,
  },
  {
    id: "negotiator", name: "Words, Then",
    text: "You resolved something without killing it. The audience is disappointed, the sponsors are interested, and we are contractually obliged to reward this despite considering it a personal failing.",
    box: ["pacifist", "Silver"],
    test: (s) => s.counters.parleys >= 1,
  },
  {
    id: "trapper", name: "You Made the Room Do It",
    text: "You laid a trap and something walked into it. There is a whole school of thought that says this is cheating. That school of thought is dead now.",
    box: ["mechanic", "Bronze"],
    test: (s) => s.counters.trapsSet >= 3,
  },
  {
    id: "cartographer", name: "Somebody's Been Busy",
    text: "Ten places cleared. You have seen more of this floor than most of the people currently dying on it.",
    box: ["cartographer", "Silver"],
    test: (s) => s.counters.roomsCleared >= 10,
  },
  {
    id: "first_box", name: "Christmas Morning",
    text: "Your first box. In case it was not clear: it is all of them or none of them, in tier order, and you do not get to choose. This is not a punishment. It is a business model.",
    test: (s) => s.counters.boxesOpened >= 1,
  },
  {
    id: "rich", name: "Liquid",
    text: "A thousand gold. There is genuinely almost nowhere to spend it yet and we find that very funny.",
    test: (s) => s.crawler.gold >= 1000,
  },
  {
    id: "packrat", name: "Pack Rat",
    text: "Forty separate things in an inventory with no slot limit. Nobody is stopping you. Somebody probably should have.",
    box: ["cartographer", "Bronze"],
    test: (s) => s.inventory.length >= 40,
  },
  {
    id: "views_million", name: "They're Chanting Your Name",
    text: "One million views. Reward: a great many strangers now recognise you. Also — and this is in smaller text — your bounty.",
    box: ["fan", "Silver"],
    test: (s) => s.ratings.views >= 1_000_000,
  },
  {
    id: "floor_two", name: "Still Here",
    text: "You reached the second floor. Under half of them did. Reward: the second floor.",
    box: ["adventurer", "Silver"],
    test: (s) => s.floor.n >= 2,
  },
  {
    id: "floor_three", name: "The Training Wheels Come Off",
    text: "Third floor. There is a sky here, of a sort, and NPCs who will remember your face. Everything you do from here is on the record.",
    box: ["adventurer", "Gold"],
    test: (s) => s.floor.n >= 3,
  },
  {
    id: "sponsored", name: "You've Been Sponsored!",
    text: "A patron has taken an interest. Viewers will now see advertisements on your feed, and you will now see a clause on your character sheet. One of those two parties reads the clause.",
    test: (s) => s.sponsors.length >= 1,
  },
  {
    id: "hoarder", name: "The Strength Is For This",
    text: "You are carrying two hundred kilograms of a demolished planet. The inventory has no limit and you have located the one that does.",
    box: ["savage", "Silver"],
    test: (s) => s.inventory.reduce((n, i) => n + i.weight * i.qty, 0) >= 200,
  },
  {
    id: "specialist", name: "Actually Good At Something",
    text: "A skill at ten. That is past the second milestone, and from here every level costs more than the one before it did. Most crawlers never get one this far.",
    box: ["adventurer", "Gold"],
    test: (s) => Object.values(s.skills).some((k) => k.level >= 10),
  },
];

/** Fired at character creation, based purely on how you walked in. */
export interface EntryAchievement {
  id: string;
  name: string;
  text: string;
  box?: [string, Tier];
  test: (a: { dress: string; carried: string[]; companion: string }) => boolean;
}

export const ENTRY_ACHIEVEMENTS: readonly EntryAchievement[] = [
  {
    id: "loner", name: "Loner",
    text: "You came down alone. Did nobody ever explain safety in numbers to you? Reward: none. Haha. You are so dead.",
    test: (a) => a.companion === "none",
  },
  {
    id: "cat", name: "Crazy Cat Lady",
    text: "You entered a World Dungeon accompanied by a cat. Isn't that sweet. It is going to watch you die and then it is going to be fine.",
    box: ["pet", "Bronze"],
    test: (a) => a.companion === "cat",
  },
  {
    id: "dog", name: "Man's Best Friend, Allegedly",
    text: "You entered accompanied by a dog. Statistically it dies protecting you. The audience adores this. You will not.",
    box: ["pet", "Bronze"],
    test: (a) => a.companion === "dog",
  },
  {
    id: "no_trousers", name: "Why Aren't You Wearing Pants?",
    text: "You entered the dungeon with no trousers on. Dude. Seriously? Here. Take this. Put something on.",
    box: ["apparel", "Gold"],
    test: (a) => a.dress === "underdressed",
  },
  {
    id: "barefoot", name: "No Shoes, No Service",
    text: "Barefoot. I want you to know that I have already made this a recurring segment and there is nothing you can do about it.",
    box: ["apparel", "Bronze"],
    test: (a) => a.dress === "underdressed" || a.dress === "bed",
  },
  {
    id: "empty", name: "Empty Pockets",
    text: "You brought nothing. Not a thing. You do understand that you still have to eat?",
    box: ["adventurer", "Bronze"],
    test: (a) => a.carried.length === 0,
  },
  {
    id: "prepared", name: "Someone Packed a Bag",
    text: "You brought supplies. Multiple supplies. Somewhere out there is a forum full of people who owe you an apology and a subscription fee.",
    box: ["cartographer", "Bronze"],
    test: (a) => a.carried.length >= 3,
  },
];
