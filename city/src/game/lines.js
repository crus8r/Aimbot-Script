// Things people in Port Solana say. Kept apart from behaviour so the lines
// can be rewritten without touching logic (and, later, generated per scene).

export const NAMES = {
  m: ['Marco', 'Luis', 'Dev', 'Theo', 'Sam', 'Jamal', 'Owen', 'Rafael', 'Ben', 'Hiro', 'Andre', 'Felix', 'Omar', 'Tomas', 'Isaac', 'Leo', 'Carlos', 'Victor'],
  f: ['Maya', 'Lucia', 'Ines', 'Priya', 'Jade', 'Rosa', 'Nina', 'Chloe', 'Amara', 'Sofia', 'Keiko', 'Tess', 'Dana', 'Elena', 'Gabi', 'Zoe', 'Lena', 'Ruby'],
};

export const CHATTER = [
  ['Did you catch the sunset yesterday?', 'Every day. Never gets old.'],
  ['I think I left my keys at the diner.', 'Again? That is the third time this week.'],
  ['The surf is supposed to be huge tomorrow.', 'I will believe it when I see it.'],
  ['Have you tried the new taco place?', 'The one with the pink sign? Line was around the block.'],
  ['My landlord raised the rent again.', 'Everyone is moving further inland.'],
  ['Are you going to the thing on Friday?', 'Depends who is going.'],
  ['This heat is unreal.', 'It is October. It is supposed to be cooling down.'],
  ['I saw a dolphin off the pier this morning.', 'No way. Pictures or it did not happen.'],
  ['Did you hear the Neon Lounge has live piano now?', 'I heard it is mostly one guy playing the same song.'],
  ['I am thinking of quitting my job.', 'You say that every Monday.'],
  ['Traffic on Ocean Drive was a nightmare.', 'Just walk. It is faster.'],
  ['Remember when this was all parking lots?', 'I remember when you had hair.'],
];

export const BUMPED = ['Hey, watch it!', 'Excuse me!', 'Whoa, careful.', 'Do you mind?', 'Seriously?', 'Easy there.', 'Sorry. Wait, why am I sorry?'];
export const BUMPED_HARD = ['Hey! Slow down!', 'What is your problem?', 'Watch where you are going!'];
export const WAVE_BACK = ['Hey there!', 'Hi!', 'Oh, hello!', 'Hey!', 'Morning!', 'Nice day, huh?'];
export const STAFF_GREET = {
  waitress: ['Welcome to the Sunny Side! Sit anywhere you like.', 'Hi hon, coffee is fresh.'],
  cook: ['Order up!', 'Two eggs, over easy, coming right up.'],
  clerk: ['Hey, welcome in. Let me know if you need anything.', 'Drinks are in the back.'],
  bartender: ['What can I get you?', 'Welcome to the Neon Lounge.'],
  receptionist: ['Welcome to Solana Media. Do you have an appointment?', 'Hi, can I help you?'],
};

export const GREETINGS = ['Hey!', 'Hi there.', 'Hello!', 'Oh, hi.', 'Hey, how is it going?'];

// Replies to what the player types, by rough intent. First match wins.
export const REPLIES = [
  // Specific questions first: "hi, where can I eat?" should get directions.
  [/where.*(eat|food|diner|coffee|breakfast|hungry)/i, ['Sunny Side Diner, on Ocean Drive. Best pancakes in town.', 'Try the diner by the beach. Ask for the key lime pie.']],
  [/where.*(drink|bar|party|club|dance|music)/i, ['The Neon Lounge, on Main Street. Head west from the pier.', 'Neon Lounge. There is a piano, if you play.', 'The Quik Stop has cold drinks, if you just need something from the fridge.']],
  [/where.*(beach|ocean|sea|pier|swim)/i, ['Just keep heading east. You can not miss the ocean.', 'The pier is at the end of Main Street.']],
  [/where.*(shop|store|buy|clothes|outfit)/i, ['The Quik Stop is open all night. For clothes, try Maison Solana.', 'Maison Solana, if you want to look sharp.']],
  [/where.*(park|fountain)/i, ['Palm Park is a few blocks west. Nice fountain.']],
  [/where/i, ['Honestly? No idea. I just moved here.', 'Try asking at the diner.', 'Somewhere past the park, I think.']],
  [/how are you|how's it going|how is it going|what's up|whats up|how you doing/i, ['Not bad, you?', 'Living the dream. Mostly.', 'Can not complain. Well, I can, but I will not.', 'Pretty good, thanks for asking.']],
  [/your name|who are you/i, ['I am {name}.', 'Name is {name}. And you are?', '{name}. Nice to meet you.']],
  [/my name is|i am |i'm /i, ['Nice to meet you. I am {name}.', 'Good to meet you!']],
  [/weather|hot|sunny|rain/i, ['It is always like this. You get used to it.', 'Hot enough for you?']],
  [/love|like you|cute|beautiful|handsome/i, ['Ha! Smooth.', 'Well, that is a nice thing to hear.', 'Do you say that to everyone?']],
  [/joke|funny/i, ['Why did the scarecrow win an award? He was outstanding in his field.', 'I would tell you a construction joke, but I am still working on it.']],
  [/thank/i, ['Any time.', 'No problem.', 'You got it.']],
  [/bye|see you|later|goodbye/i, ['See you around.', 'Take care!', 'Later!']],
  [/\b(hi|hello|hey|yo|sup|howdy|good (morning|afternoon|evening))\b/i, ['Hey! How are you?', 'Hi there.', 'Oh, hello!', 'Hey yourself.']],
  [/\?$/, ['Good question.', 'Hmm, I would have to think about that.', 'Why do you ask?', 'I have no idea, honestly.']],
  [/./, ['Huh. Okay.', 'Interesting.', 'Right, right.', 'If you say so.', 'Ha, fair enough.', 'Totally.']],
];

export function replyTo(text, npc, rand = Math.random) {
  for (const [re, lines] of REPLIES) {
    if (re.test(text)) return lines[Math.floor(rand() * lines.length)].replace('{name}', npc.name);
  }
  return 'Okay.';
}

export const pick = (a, rand = Math.random) => a[Math.floor(rand() * a.length)];
