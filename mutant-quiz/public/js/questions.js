/* questions.js — the quiz itself.
 *
 * Every option carries its weights in code. Nothing is inferred at runtime.
 *   w:      category deltas   (may be negative)
 *   sub:    elemental sub-affinity deltas (flavour only, never a category)
 *   traits: tags the per-set notepad and the final fusion read
 *
 * Sets of 10. After each set the engine emits a summary before the next page.
 */

var QUESTION_SETS = [
  { n: 1, title: 'Instinct & Body',      caption: 'How the animal underneath behaves when you are not supervising it.' },
  { n: 2, title: 'Mind & Feeling',       caption: 'What happens in the space between a thing occurring and you reacting.' },
  { n: 3, title: 'World & Element',      caption: 'Where you sit inside a room, a landscape, a weather system.' },
  { n: 4, title: 'Conflict & Morality',  caption: 'What you do when something is at stake and someone has to decide.' },
  { n: 5, title: 'Identity & Want',      caption: 'The gap between who you are and who you keep almost being.' },
  { n: 6, title: 'Affinity',             caption: 'Direct preference. These break ties and set the flavour.' }
];

var QUESTIONS = [

  /* ── SET 1 — INSTINCT & BODY ────────────────────────────────────────── */

  { id: 'q1', set: 1, text: 'You come down with something nasty. How does your body handle it?',
    options: [
      { id: 'a', text: 'Badly for a day, then fine. I shake things off faster than people expect me to.', w: { beastial: 2, bio: 1 }, traits: ['resilient'] },
      { id: 'b', text: 'Slowly, and only if I actually stop. If I don\'t, it drags on for a month.', w: { bio: 2 }, traits: ['patient'] },
      { id: 'c', text: 'I go strange with it. Fever dreams, thoughts I\'d never have sober, and I half-believe them afterwards.', w: { psychic: 2, esoteric: 1 }, traits: ['dreamer'] },
      { id: 'd', text: 'It\'s mostly a negotiation with myself. If I\'ve decided I haven\'t got time to be ill, I\'m not ill.', w: { psychic: 1, bio: 1 }, traits: ['willful'] }
    ] },

  { id: 'q2', set: 1, text: 'Someone you love is in trouble on the other side of the city.',
    options: [
      { id: 'a', text: 'I\'m already moving. I\'ll work out the plan on the way.', w: { time: 2, beastial: 1 }, traits: ['urgent'] },
      { id: 'b', text: 'I find out who\'s nearest to them and talk that person into getting there first.', w: { psychic: 2 }, traits: ['connective'] },
      { id: 'c', text: 'I put myself in the middle of it. Whatever it is, it comes through me.', w: { bio: 1, beastial: 1, energy: 1 }, traits: ['protective'] },
      { id: 'd', text: 'Fastest route, who owes me a favour, what I\'ve got that\'s useful. Then I go.', w: { tech: 2, psychic: 1 }, traits: ['strategic'] }
    ] },

  { id: 'q3', set: 1, text: 'It is 3 a.m. and something breaks downstairs.',
    options: [
      { id: 'a', text: 'I\'m on my feet before I\'m properly awake.', w: { beastial: 2 }, traits: ['reactive'] },
      { id: 'b', text: 'I don\'t move. I lie there working out how many of them there are.', w: { psychic: 1, beastial: 1 }, sub: { sound: 1 }, traits: ['watchful'] },
      { id: 'c', text: 'I freeze, then start reasoning. What in this house could have fallen on its own.', w: { psychic: 2, beastial: -1 }, traits: ['analytical'] },
      { id: 'd', text: 'I decide it was the cat and go back to sleep.', w: { luck: 2 }, traits: ['fatalist'] }
    ] },

  { id: 'q4', set: 1, text: 'As a kid, what were you known for?',
    options: [
      { id: 'a', text: 'Being the one who fell out of the tree.', w: { beastial: 2 }, traits: ['physical'] },
      { id: 'b', text: 'Being outside in weather nobody else wanted to be out in.', w: { elemental: 2 }, sub: { storm: 1, air: 1 }, traits: ['dreamer', 'natural'] },
      { id: 'c', text: 'Knowing the adults had been arguing before anyone told me.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'd', text: 'Taking the back off things to see what was in there.', w: { tech: 2 }, traits: ['inventive'] }
    ] },

  { id: 'q5', set: 1, text: 'Is there anything unusual about your body — from birth or since?',
    options: [
      { id: 'a', text: 'Something people notice. Eyes, hair, height, the way I\'m put together.', w: { beastial: 1, bio: 1 }, traits: ['marked'] },
      { id: 'b', text: 'Something structural. Extra, missing, or wired differently to standard.', w: { bio: 2 }, traits: ['marked'] },
      { id: 'c', text: 'No. I\'m within tolerance in every direction.', w: { beastial: -1, bio: -1 }, traits: ['unremarkable'] },
      { id: 'd', text: 'Probably, but I\'ve never audited myself closely enough to say.', w: {}, traits: ['unbothered'] }
    ] },

  { id: 'q6', set: 1, text: 'What are your dreams like?',
    options: [
      { id: 'a', text: 'Physical. Running, falling, teeth, being followed.', w: { beastial: 2 }, traits: ['primal'] },
      { id: 'b', text: 'Somewhere with its own rules, and I resent being woken out of it.', w: { esoteric: 2, psychic: 1 }, traits: ['dissociative'] },
      { id: 'c', text: 'The same three places, on rotation, for years.', w: { time: 2 }, traits: ['cyclical'] },
      { id: 'd', text: 'I don\'t have any. I go under and I come back up.', w: { bio: 1 }, traits: ['grounded'] }
    ] },

  { id: 'q7', set: 1, text: 'Something falls off a shelf towards your head.',
    options: [
      { id: 'a', text: 'I catch it. I don\'t know how, I just usually do.', w: { beastial: 2 }, traits: ['reflexive'] },
      { id: 'b', text: 'It hits me. I am always a beat behind the physical world.', w: { time: -1, psychic: 1 }, traits: ['internal'] },
      { id: 'c', text: 'I\'m three feet away before I\'ve worked out what it was.', w: { bio: 1, beastial: 1 }, traits: ['defensive'] },
      { id: 'd', text: 'I don\'t remember deciding anything. I just find I\'ve already moved.', w: { time: 2 }, traits: ['dilating'] }
    ] },

  { id: 'q8', set: 1, text: 'Your relationship with pain.',
    options: [
      { id: 'a', text: 'High tolerance, and slightly proud of it, which is probably its own problem.', w: { beastial: 2 }, traits: ['enduring'] },
      { id: 'b', text: 'Enormous. And other people\'s lands on me nearly as hard as my own.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'c', text: 'It\'s data. Where, how sharp, whether it\'s new.', w: { tech: 1, bio: 1 }, traits: ['clinical'] },
      { id: 'd', text: 'I leave. I\'m not really in the room again until it\'s finished.', w: { esoteric: 2 }, traits: ['dissociative'] }
    ] },

  { id: 'q9', set: 1, text: 'You are past exhausted and there is still work left.',
    options: [
      { id: 'a', text: 'I keep going. Stopping feels worse than continuing.', w: { beastial: 2 }, traits: ['relentless'] },
      { id: 'b', text: 'Something kicks in around the point I should be finished. Not sustainable, but real.', w: { energy: 2 }, traits: ['surging'] },
      { id: 'c', text: 'I stop. I\'ve learned exactly what happens when I don\'t.', w: { bio: 1, psychic: 1 }, traits: ['measured'] },
      { id: 'd', text: 'I push it and deal with tomorrow tomorrow.', w: { luck: 2 }, traits: ['risk-taker'] }
    ] },

  { id: 'q10', set: 1, text: 'Which of your senses is unfairly sharp?',
    options: [
      { id: 'a', text: 'Hearing. I follow the conversation at the next table without meaning to.', w: { elemental: 1, psychic: 1 }, sub: { sound: 3 }, traits: ['attuned'] },
      { id: 'b', text: 'Sight. I notice when something has been moved.', w: { beastial: 2 }, traits: ['observant'] },
      { id: 'c', text: 'Smell. Mostly it is a liability.', w: { beastial: 1, bio: 1 }, traits: ['primal'] },
      { id: 'd', text: 'None of the five. But I can tell when two people in a room have fallen out.', w: { psychic: 2, esoteric: 1 }, traits: ['intuitive'] }
    ] },

  /* ── SET 2 — MIND & FEELING ─────────────────────────────────────────── */

  { id: 'q11', set: 2, text: 'You walk into a room where something has just happened.',
    options: [
      { id: 'a', text: 'I know within seconds. Nobody has to say anything.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'b', text: 'I work it out. Who is sitting apart, who is talking too much.', w: { psychic: 1, tech: 1 }, traits: ['analytical'] },
      { id: 'c', text: 'I find out days later, usually from somebody else.', w: { psychic: -1, bio: 1 }, traits: ['self-contained'] },
      { id: 'd', text: 'I clock it and immediately start talking to break it up.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  { id: 'q12', set: 2, text: 'Someone lies to your face.',
    options: [
      { id: 'a', text: 'I know at the time. I usually don\'t say so.', w: { psychic: 2 }, traits: ['perceptive'] },
      { id: 'b', text: 'I find out later, then replay every conversation we have ever had.', w: { psychic: 1, time: 1 }, traits: ['ruminative'] },
      { id: 'c', text: 'People lie. I would rather not make it a whole thing.', w: { luck: 1, psychic: 1 }, traits: ['permissive'] },
      { id: 'd', text: 'I want to know what made lying the easier option.', w: { psychic: 1, esoteric: 1 }, traits: ['curious'] }
    ] },

  { id: 'q13', set: 2, text: 'How does loss sit in you?',
    options: [
      { id: 'a', text: 'It rearranged me. I\'m not a sadder version of who I was, I\'m somebody else.', w: { bio: 2 }, traits: ['transformed'] },
      { id: 'b', text: 'It made me faster and less patient. Less willing to be caught out again.', w: { beastial: 1, time: 1 }, traits: ['hardened'] },
      { id: 'c', text: 'I go back to it. Certain days, certain months, without deciding to.', w: { time: 2 }, traits: ['ruminative'] },
      { id: 'd', text: 'I am much better at carrying other people\'s than my own.', w: { psychic: 2 }, traits: ['empathic'] }
    ] },

  { id: 'q14', set: 2, text: 'What kind of memory do you have?',
    options: [
      { id: 'a', text: 'Sensory. I remember rooms by how they smelled and sounded.', w: { elemental: 1, psychic: 1 }, sub: { sound: 2 }, traits: ['vivid'] },
      { id: 'b', text: 'Emotional. I have lost the details but I know exactly how it felt.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'c', text: 'Chronological. I can tell you what year almost anything happened.', w: { time: 2 }, traits: ['precise'] },
      { id: 'd', text: 'Bad. Genuinely bad. It has all been compressed.', w: { luck: 1, bio: 1 }, traits: ['present-focused'] }
    ] },

  { id: 'q15', set: 2, text: 'You are alone with nothing to do and no phone.',
    options: [
      { id: 'a', text: 'I find something to fix or make. My hands need a job.', w: { tech: 2 }, traits: ['inventive'] },
      { id: 'b', text: 'I go outside and walk until I feel better.', w: { elemental: 2 }, traits: ['natural'] },
      { id: 'c', text: 'I\'m fine. There is a great deal going on in there.', w: { psychic: 2 }, traits: ['introspective'] },
      { id: 'd', text: 'I last about nine minutes.', w: { beastial: 1, time: 1 }, traits: ['restless'] }
    ] },

  { id: 'q16', set: 2, text: 'Your mind at its worst does what?',
    options: [
      { id: 'a', text: 'The same thought, on a loop, for hours.', w: { time: 2 }, traits: ['anxious'] },
      { id: 'b', text: 'Builds the worst case in high definition, then furnishes it.', w: { psychic: 2, time: 1 }, traits: ['anxious'] },
      { id: 'c', text: 'Goes flat and very far away. I am functionally not there.', w: { esoteric: 2 }, traits: ['dissociative'] },
      { id: 'd', text: 'Wants to put a fist through something.', w: { beastial: 2 }, traits: ['volatile'] }
    ] },

  { id: 'q17', set: 2, text: 'When you are genuinely anxious, where does it live in your body?',
    options: [
      { id: 'a', text: 'Chest and hands. I cannot keep still.', w: { energy: 2 }, traits: ['anxious'] },
      { id: 'b', text: 'Stomach. It is physical and it is grim.', w: { bio: 2 }, traits: ['anxious'] },
      { id: 'c', text: 'Everything accelerates. Heart, thoughts, speech.', w: { time: 2 }, traits: ['anxious'] },
      { id: 'd', text: 'I go cold and completely still.', w: { beastial: 2 }, traits: ['anxious'] }
    ] },

  { id: 'q18', set: 2, text: 'How do you concentrate?',
    options: [
      { id: 'a', text: 'Total absorption. People have to say my name twice.', w: { psychic: 2 }, traits: ['focused'] },
      { id: 'b', text: 'I need something playing. Silence is louder than noise.', w: { elemental: 1 }, sub: { sound: 3 }, traits: ['attuned'] },
      { id: 'c', text: 'Walking. I cannot think properly sitting down.', w: { beastial: 1, time: 1 }, traits: ['kinetic'] },
      { id: 'd', text: 'Nothing for six days, then all of it in one night.', w: { energy: 2 }, traits: ['surging'] }
    ] },

  { id: 'q19', set: 2, text: 'How often do you turn out to have been right about something before there was any reason to be?',
    options: [
      { id: 'a', text: 'Often enough that I have stopped mentioning it. It does not go down well.', w: { time: 2, psychic: 1 }, traits: ['precognitive'] },
      { id: 'b', text: 'Sometimes, but I assume I am only remembering the times it worked.', w: { time: 1, esoteric: 1 }, traits: ['uncanny'] },
      { id: 'c', text: 'It is not a feeling. I am reading the same signs everyone else is ignoring.', w: { psychic: 1, tech: 1 }, traits: ['analytical'] },
      { id: 'd', text: 'Never, and I am suspicious of people who say otherwise.', w: { time: -1, esoteric: -1 }, traits: ['skeptical'] }
    ] },

  { id: 'q20', set: 2, text: 'What is hardest about being in a crowd?',
    options: [
      { id: 'a', text: 'Everyone\'s mood arrives at once and I cannot turn it down.', w: { psychic: 2 }, traits: ['empathic', 'overwhelmed'] },
      { id: 'b', text: 'The noise. Not the volume — the layers.', w: { elemental: 1 }, sub: { sound: 3 }, traits: ['attuned'] },
      { id: 'c', text: 'Being visible. Being looked at while doing nothing in particular.', w: { bio: 1, psychic: 1 }, traits: ['self-conscious'] },
      { id: 'd', text: 'Nothing. I am better in a crowd than out of one.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  /* ── SET 3 — WORLD & ELEMENT ────────────────────────────────────────── */

  { id: 'q21', set: 3, text: 'Where do you go to feel like yourself again?',
    options: [
      { id: 'a', text: 'Water. Sea, river, rain, or failing all that a very long shower.', w: { elemental: 2 }, sub: { water: 3 }, traits: ['natural'] },
      { id: 'b', text: 'Somewhere high. A roof, a hill, the top deck.', w: { elemental: 2 }, sub: { air: 3 }, traits: ['aerial'] },
      { id: 'c', text: 'Somewhere with trees, where the ground is soft.', w: { elemental: 2 }, sub: { earth: 2, plant: 2 }, traits: ['natural'] },
      { id: 'd', text: 'A room I have arranged myself, with the door shut.', w: { tech: 2 }, traits: ['nesting'] }
    ] },

  { id: 'q22', set: 3, text: 'Which weather feels like your interior?',
    options: [
      { id: 'a', text: 'The twenty minutes before a storm actually breaks.', w: { elemental: 2 }, sub: { storm: 3 }, traits: ['charged'] },
      { id: 'b', text: 'Close, heavy heat. Or a fire going in a cold room.', w: { elemental: 2 }, sub: { fire: 3 }, traits: ['intense'] },
      { id: 'c', text: 'Steady rain. Fog. Everything softened at the edges.', w: { elemental: 2, psychic: 1 }, sub: { water: 3 }, traits: ['quiet'] },
      { id: 'd', text: 'Cold, clear, and completely still.', w: { elemental: 1, psychic: 1 }, sub: { air: 2 }, traits: ['composed'] }
    ] },

  { id: 'q23', set: 3, text: 'Best time of day?',
    options: [
      { id: 'a', text: 'The hour before it gets light.', w: { time: 2 }, traits: ['liminal'] },
      { id: 'b', text: 'One in the morning, when it is finally quiet.', w: { esoteric: 2 }, traits: ['nocturnal'] },
      { id: 'c', text: 'Full afternoon sun.', w: { energy: 2, elemental: 1 }, sub: { fire: 1 }, traits: ['bright'] },
      { id: 'd', text: 'Dusk. The half hour where it could go either way.', w: { time: 1, esoteric: 1 }, traits: ['liminal'] }
    ] },

  { id: 'q24', set: 3, text: 'What is music to you?',
    options: [
      { id: 'a', text: 'Structural. I do not get through a day without it.', w: { elemental: 2 }, sub: { sound: 4 }, traits: ['musical'] },
      { id: 'b', text: 'I play, or I did. It is the thing I am least embarrassed about.', w: { elemental: 1, energy: 2 }, sub: { sound: 3 }, traits: ['musical', 'performer'] },
      { id: 'c', text: 'I like it. I could take it or leave it.', w: { tech: 1 }, traits: ['pragmatic'] },
      { id: 'd', text: 'It gets in too far. There are songs I have had to stop playing.', w: { elemental: 1, psychic: 2 }, sub: { sound: 3 }, traits: ['musical', 'empathic'] }
    ] },

  { id: 'q25', set: 3, text: 'You and machines.',
    options: [
      { id: 'a', text: 'We get on. I can usually fix a thing by feel.', w: { tech: 2 }, traits: ['inventive'] },
      { id: 'b', text: 'They die around me. Phones, watches, laptops, reliably.', w: { tech: -1, energy: 1, esoteric: 1 }, traits: ['chaotic'] },
      { id: 'c', text: 'I use them competently and have no interest in how they work.', w: { tech: 1 }, traits: ['pragmatic'] },
      { id: 'd', text: 'I would rather look after something alive than something built.', w: { tech: -1, elemental: 2 }, sub: { plant: 2 }, traits: ['natural'] }
    ] },

  { id: 'q26', set: 3, text: 'First thing you clock walking into a new place.',
    options: [
      { id: 'a', text: 'Where the doors are and who is between me and them.', w: { beastial: 2 }, traits: ['watchful'] },
      { id: 'b', text: 'Who is comfortable and who is pretending to be.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'c', text: 'The light and the temperature. Whether I want to be in it.', w: { elemental: 2 }, traits: ['attuned'] },
      { id: 'd', text: 'How it is put together. What has been done cheaply.', w: { tech: 2 }, traits: ['inventive'] }
    ] },

  { id: 'q27', set: 3, text: 'Which of these genuinely unsettles you?',
    options: [
      { id: 'a', text: 'Deep water. Specifically not being able to see the bottom.', w: { elemental: -1 }, sub: { water: -3 }, traits: ['wary'] },
      { id: 'b', text: 'Heights.', w: { elemental: -1 }, sub: { air: -3 }, traits: ['wary'] },
      { id: 'c', text: 'Complete darkness.', w: { esoteric: -2 }, traits: ['wary'] },
      { id: 'd', text: 'Small enclosed spaces.', w: { bio: -1, time: 1 }, sub: { earth: -2 }, traits: ['wary'] },
      { id: 'e', text: 'None of them, honestly.', w: { beastial: 1, elemental: 1 }, traits: ['fearless'] }
    ] },

  { id: 'q28', set: 3, text: 'Given a project — would you rather build it or grow it?',
    options: [
      { id: 'a', text: 'Build. I want to see the parts and know what each one does.', w: { tech: 2 }, traits: ['inventive'] },
      { id: 'b', text: 'Grow. I like tending something and finding out what it turns into.', w: { elemental: 2, bio: 1 }, sub: { plant: 3 }, traits: ['patient'] },
      { id: 'c', text: 'The interesting part is the seam where those two meet.', w: { tech: 1, elemental: 1, bio: 1 }, sub: { metal: 1, plant: 1 }, traits: ['hybrid'] },
      { id: 'd', text: 'Neither. I would rather find one somebody else abandoned.', w: { luck: 2 }, traits: ['opportunist'] }
    ] },

  { id: 'q29', set: 3, text: 'A relative you barely knew leaves you a locked box.',
    options: [
      { id: 'a', text: 'It is open within the hour. I am not precious about locks.', w: { tech: 2 }, sub: { metal: 1 }, traits: ['inventive'] },
      { id: 'b', text: 'I keep it shut for a long time. It feels like it is owed that.', w: { psychic: 1, esoteric: 2 }, traits: ['intuitive'] },
      { id: 'c', text: 'I open it in front of everyone, at the wake.', w: { luck: 2, energy: 1 }, traits: ['risk-taker'] },
      { id: 'd', text: 'I do not want it. Somebody else can deal with whatever that is.', w: { luck: -2, esoteric: -1 }, traits: ['cautious'] }
    ] },

  { id: 'q30', set: 3, text: 'Which of these would you want to stand near — safely?',
    options: [
      { id: 'a', text: 'A wildfire, from the far side of a valley.', w: { elemental: 2 }, sub: { fire: 4 }, traits: ['intense'] },
      { id: 'b', text: 'A storm surge coming over a sea wall.', w: { elemental: 2 }, sub: { water: 4 }, traits: ['intense'] },
      { id: 'c', text: 'A lightning strike close enough to feel in your teeth.', w: { elemental: 2 }, sub: { storm: 4 }, traits: ['charged'] },
      { id: 'd', text: 'Ground opening up. Something structural giving way.', w: { elemental: 2 }, sub: { earth: 4 }, traits: ['intense'] }
    ] },

  /* ── SET 4 — CONFLICT & MORALITY ────────────────────────────────────── */

  { id: 'q31', set: 4, text: 'Someone hurts a person you love.',
    options: [
      { id: 'a', text: 'I get very calm and very precise. That is the dangerous version of me.', w: { psychic: 2 }, traits: ['controlled'] },
      { id: 'b', text: 'I want it to cost them, and I want to be there when it does.', w: { beastial: 2 }, traits: ['retributive'] },
      { id: 'c', text: 'I want to know why before I decide what this is.', w: { psychic: 1, tech: 1 }, traits: ['analytical'] },
      { id: 'd', text: 'I stop caring about them and start making sure it cannot happen twice.', w: { bio: 1, energy: 1, beastial: 1 }, traits: ['protective'] }
    ] },

  { id: 'q32', set: 4, text: 'Rules.',
    options: [
      { id: 'a', text: 'Guidelines. I break them when the rule is worse than the breach.', w: { luck: 1, beastial: 1 }, traits: ['rulebreaker'] },
      { id: 'b', text: 'I keep them, and I am quietly furious at people who do not.', w: { tech: 1, psychic: 1 }, traits: ['orderly'] },
      { id: 'c', text: 'I do not break rules. I read them very carefully.', w: { tech: 2, luck: 1 }, traits: ['cunning'] },
      { id: 'd', text: 'I have never really experienced them as load-bearing.', w: { esoteric: 1, reality: 1, luck: 1 }, traits: ['unbound'] }
    ] },

  { id: 'q33', set: 4, text: 'You are in an argument you know you will win.',
    options: [
      { id: 'a', text: 'I finish it. Properly.', w: { psychic: 1, energy: 1 }, traits: ['assertive'] },
      { id: 'b', text: 'I stop, because being right is not going to help here.', w: { psychic: 2 }, traits: ['principled'] },
      { id: 'c', text: 'I give them a way out that lets them keep their dignity.', w: { psychic: 2 }, traits: ['strategic'] },
      { id: 'd', text: 'I enjoy it far too much.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  { id: 'q34', set: 4, text: 'You learn a secret that is not yours.',
    options: [
      { id: 'a', text: 'It dies with me. That is not a decision, it is just how I am built.', w: { psychic: 2 }, traits: ['trustworthy'] },
      { id: 'b', text: 'It sits badly until it is out. I am not good at this.', w: { energy: 1, psychic: 1 }, traits: ['candid'] },
      { id: 'c', text: 'I file it. I would use it if I had to.', w: { tech: 1, psychic: 1 }, traits: ['calculating'] },
      { id: 'd', text: 'I wish I did not have it. Knowing things is heavy.', w: { bio: 1, esoteric: 1 }, traits: ['burdened'] }
    ] },

  { id: 'q35', set: 4, text: 'In a team you end up as:',
    options: [
      { id: 'a', text: 'The one holding the shape of the whole thing in their head.', w: { psychic: 2 }, traits: ['strategic'] },
      { id: 'b', text: 'The one who absorbs the worst job so nobody else has to.', w: { bio: 2, beastial: 1 }, traits: ['protective'] },
      { id: 'c', text: 'The one who goes first and says it out loud.', w: { energy: 2, beastial: 1 }, traits: ['bold'] },
      { id: 'd', text: 'The one nobody has planned for, including me.', w: { luck: 2, elemental: 1 }, traits: ['wildcard'] }
    ] },

  { id: 'q36', set: 4, text: 'Would you give up something permanent to fix something temporary?',
    options: [
      { id: 'a', text: 'Yes. I have done it, and I would do it again.', w: { bio: 2 }, traits: ['sacrificial'] },
      { id: 'b', text: 'Yes, and I would bring it up for the rest of my life.', w: { psychic: 1, time: 1 }, traits: ['ruminative'] },
      { id: 'c', text: 'No. Permanent things are not currency.', w: { tech: 1, psychic: 1 }, traits: ['principled'] },
      { id: 'd', text: 'What are the odds?', w: { luck: 2 }, traits: ['gambler'] }
    ] },

  { id: 'q37', set: 4, text: 'How do you fight — literally or otherwise?',
    options: [
      { id: 'a', text: 'First and fast. I would rather it were over than fair.', w: { time: 2, beastial: 1 }, traits: ['aggressive'] },
      { id: 'b', text: 'I take it. I am still standing at the end and that is usually enough.', w: { bio: 2 }, traits: ['enduring'] },
      { id: 'c', text: 'I find the one thing that ends it and use only that.', w: { psychic: 1, tech: 1 }, traits: ['precise'] },
      { id: 'd', text: 'Loudly, so that there is not a second one.', w: { energy: 2 }, traits: ['overwhelming'] }
    ] },

  { id: 'q38', set: 4, text: 'You could unmake one bad thing that happened to you — but it would also unmake something good that grew out of it. Do you?',
    options: [
      { id: 'a', text: 'Yes. Immediately. I would not even think about it.', w: { time: 2, reality: 2 }, traits: ['regretful'] },
      { id: 'b', text: 'No. I am made out of it.', w: { bio: 2 }, traits: ['accepting'] },
      { id: 'c', text: 'I would want to see the other version first.', w: { time: 2, psychic: 1, reality: 1 }, traits: ['deliberative'] },
      { id: 'd', text: 'That is not a real question, so: no.', w: { psychic: 1 }, traits: ['grounded'] }
    ] },

  { id: 'q39', set: 4, text: 'The idea of having real power over other people.',
    options: [
      { id: 'a', text: 'It frightens me. I would be so careful I would be useless.', w: { psychic: 2 }, traits: ['principled'] },
      { id: 'b', text: 'I would take it. I think I would be good at it.', w: { energy: 1, tech: 1, reality: 1 }, traits: ['ambitious'] },
      { id: 'c', text: 'I avoid it already. I do not like being in charge of anything.', w: { esoteric: 1, bio: 1 }, traits: ['retiring'] },
      { id: 'd', text: 'Only to keep it away from somebody worse.', w: { psychic: 1, beastial: 1 }, traits: ['protective'] }
    ] },

  { id: 'q40', set: 4, text: 'When you turn out to be wrong.',
    options: [
      { id: 'a', text: 'I say so straight away. It costs me nothing.', w: { psychic: 1, tech: 1 }, traits: ['honest'] },
      { id: 'b', text: 'Badly, and slowly, and usually in private first.', w: { beastial: 1, time: 1 }, traits: ['stubborn'] },
      { id: 'c', text: 'I change my mind and never mention that I have.', w: { esoteric: 1, psychic: 1 }, traits: ['private'] },
      { id: 'd', text: 'I would rather have been wrong loudly than right quietly.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  /* ── SET 5 — IDENTITY & WANT ────────────────────────────────────────── */

  { id: 'q41', set: 5, text: 'Your reflection.',
    options: [
      { id: 'a', text: 'That is me. No notes.', w: { bio: -1, psychic: 1 }, traits: ['settled'] },
      { id: 'b', text: 'Takes a second to connect. Sometimes longer.', w: { bio: 2, esoteric: 1 }, traits: ['dysmorphic'] },
      { id: 'c', text: 'A costume I was assigned. Functional, but not the point.', w: { esoteric: 2, psychic: 1 }, traits: ['detached'] },
      { id: 'd', text: 'A draft. I keep making small edits to it.', w: { bio: 2 }, traits: ['transforming'] }
    ] },

  { id: 'q42', set: 5, text: 'Being looked at.',
    options: [
      { id: 'a', text: 'I am better with an audience, and I do not apologise for it.', w: { energy: 2 }, traits: ['performer'] },
      { id: 'b', text: 'I would take genuine invisibility tomorrow.', w: { bio: 2, esoteric: 1 }, traits: ['private'] },
      { id: 'c', text: 'Fine, as long as it was my idea.', w: { psychic: 1, tech: 1 }, traits: ['controlled'] },
      { id: 'd', text: 'It makes my skin feel like it does not quite fit.', w: { bio: 1, psychic: 1 }, traits: ['self-conscious'] }
    ] },

  { id: 'q43', set: 5, text: 'If you could change one thing about your body:',
    options: [
      { id: 'a', text: 'More of it. Stamina, strength, not being finished by four in the afternoon.', w: { beastial: 2 }, traits: ['physical'] },
      { id: 'b', text: 'I would want it less fixed. I do not like that it was decided without me.', w: { bio: 2, reality: 1 }, traits: ['transforming'] },
      { id: 'c', text: 'I would fix the part that hurts. That is the whole list.', w: { bio: 2 }, traits: ['enduring'] },
      { id: 'd', text: 'Nothing. The problem has never been the body.', w: { psychic: 2 }, traits: ['introspective'] }
    ] },

  { id: 'q44', set: 5, text: 'You need a name that is not yours. Which sounds right?',
    options: [
      { id: 'a', text: 'Something soft and strange — Echo, Auger, Vesper.', w: { psychic: 2, esoteric: 1 }, traits: ['mystic'] },
      { id: 'b', text: 'Something quick — Flint, Tempo, Quill.', w: { time: 2 }, traits: ['urgent'] },
      { id: 'c', text: 'Something elemental — Ember, Tide, Cinder.', w: { elemental: 2 }, traits: ['intense'] },
      { id: 'd', text: 'Something with teeth — Bramble, Fang, Ruin.', w: { beastial: 2 }, traits: ['feral'] }
    ] },

  { id: 'q45', set: 5, text: 'If you had to wear something to be seen in:',
    options: [
      { id: 'a', text: 'Something heavy and functional.', w: { bio: 1, tech: 1 }, sub: { metal: 2 }, traits: ['defensive'] },
      { id: 'b', text: 'Something that covers my face.', w: { esoteric: 2, psychic: 1 }, traits: ['private'] },
      { id: 'c', text: 'Something that looks incredible when I move.', w: { energy: 2 }, traits: ['performer'] },
      { id: 'd', text: 'My own clothes. I am not in disguise.', w: { psychic: 1, beastial: 1 }, traits: ['direct'] }
    ] },

  { id: 'q46', set: 5, text: 'Alone, or among people?',
    options: [
      { id: 'a', text: 'Alone, and I need more of it than most people do.', w: { psychic: 2 }, traits: ['solitary'] },
      { id: 'b', text: 'Among people, always. Silence is worse.', w: { energy: 2 }, traits: ['social'] },
      { id: 'c', text: 'One person at a time.', w: { psychic: 2 }, traits: ['intimate'] },
      { id: 'd', text: 'Wildly dependent on the day.', w: { luck: 1, bio: 1 }, traits: ['variable'] }
    ] },

  { id: 'q47', set: 5, text: 'You, five years ago.',
    options: [
      { id: 'a', text: 'A different person. Genuinely, not poetically.', w: { bio: 2, time: 1 }, traits: ['transformed'] },
      { id: 'b', text: 'The same, with less information.', w: { psychic: 1, tech: 1 }, traits: ['consistent'] },
      { id: 'c', text: 'I would want ninety seconds to tell them one specific thing.', w: { time: 2, reality: 1 }, traits: ['regretful'] },
      { id: 'd', text: 'I would rather not go back there, thanks.', w: { esoteric: 1, bio: 1 }, traits: ['avoidant'] }
    ] },

  { id: 'q48', set: 5, text: 'What would you want left behind?',
    options: [
      { id: 'a', text: 'Something built that outlasts me.', w: { tech: 2 }, traits: ['builder'] },
      { id: 'b', text: 'People who are better off.', w: { psychic: 2 }, traits: ['caring'] },
      { id: 'c', text: 'A story people keep telling.', w: { energy: 2 }, traits: ['performer'] },
      { id: 'd', text: 'Nothing. Clean exit.', w: { esoteric: 2 }, traits: ['detached'] }
    ] },

  { id: 'q49', set: 5, text: 'What do people consistently get wrong about you?',
    options: [
      { id: 'a', text: 'They think I am calm. I am not calm.', w: { energy: 1, time: 1 }, traits: ['masking'] },
      { id: 'b', text: 'They think I am cold. I feel everything.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'c', text: 'They think I am harmless.', w: { beastial: 2 }, traits: ['underestimated'] },
      { id: 'd', text: 'They think they know me at all.', w: { esoteric: 2 }, traits: ['private'] }
    ] },

  { id: 'q50', set: 5, text: 'If you vanished for a year and came back changed —',
    options: [
      { id: 'a', text: 'I would come back harder to frighten.', w: { beastial: 2 }, traits: ['hardened'] },
      { id: 'b', text: 'I would come back knowing something I could not explain to anyone.', w: { psychic: 2, esoteric: 1 }, traits: ['mystic'] },
      { id: 'c', text: 'I would come back physically different, and people would notice that first.', w: { bio: 2 }, traits: ['transformed'] },
      { id: 'd', text: 'I am not certain I would come back.', w: { esoteric: 2, reality: 1 }, traits: ['detached'] }
    ] },

  /* ── SET 6 — AFFINITY / TIE-BREAKERS ───────────────────────────────── */

  { id: 'q51', set: 6, text: 'Pick your element.',
    options: [
      { id: 'a', text: 'Fire', w: { elemental: 3 }, sub: { fire: 5 }, traits: ['intense'] },
      { id: 'b', text: 'Water', w: { elemental: 3 }, sub: { water: 5 } },
      { id: 'c', text: 'Earth, stone, growing things', w: { elemental: 3 }, sub: { earth: 3, plant: 3 } },
      { id: 'd', text: 'Air, wind, sky', w: { elemental: 3 }, sub: { air: 5 } },
      { id: 'e', text: 'Sound and vibration', w: { elemental: 3 }, sub: { sound: 5 }, traits: ['musical'] },
      { id: 'f', text: 'Lightning and storm', w: { elemental: 3 }, sub: { storm: 5 }, traits: ['charged'] },
      { id: 'g', text: 'Metal and magnetism', w: { elemental: 2, tech: 1 }, sub: { metal: 5 } },
      { id: 'h', text: 'None of these speak to me.', w: { elemental: -2 } }
    ] },

  { id: 'q52', set: 6, text: 'Which creature\'s edge would you take?', max: 2, hint: 'Pick up to two.',
    options: [
      { id: 'a', text: 'Wolf or big cat — endurance, pack sense, teeth', w: { beastial: 3 }, traits: ['feral'] },
      { id: 'b', text: 'Raptor or bat — flight, echolocation', w: { elemental: 2, beastial: 1 }, sub: { air: 2, sound: 1 }, traits: ['aerial'] },
      { id: 'c', text: 'Shark or cephalopod — water, camouflage, pressure', w: { elemental: 1, bio: 2 }, sub: { water: 2 } },
      { id: 'd', text: 'Spider or insect — patience, structure, sensitivity', w: { beastial: 1, psychic: 1, bio: 1 } },
      { id: 'e', text: 'Something venomous', w: { bio: 2, esoteric: 1 } },
      { id: 'f', text: 'None. Human is fine.', w: { beastial: -2, bio: -1 } }
    ] },

  { id: 'q53', set: 6, text: 'Which of these appeals most?', max: 2, hint: 'Pick up to two.',
    options: [
      { id: 'a', text: 'Reading and moving minds', w: { psychic: 3 } },
      { id: 'b', text: 'Speed, or time itself', w: { time: 3 } },
      { id: 'c', text: 'Commanding an element', w: { elemental: 3 } },
      { id: 'd', text: 'Changing your own body', w: { bio: 3 } },
      { id: 'e', text: 'Raw output — force, light, blast', w: { energy: 3 } },
      { id: 'f', text: 'Machines and making', w: { tech: 3 } },
      { id: 'g', text: 'Luck bending your way', w: { luck: 3 } },
      { id: 'h', text: 'Something stranger — spirit, chi, the other side', w: { esoteric: 3 } },
      { id: 'i', text: 'Rewriting what is true', w: { reality: 3 } }
    ] },

  { id: 'q54', set: 6, text: 'Which would you refuse outright?', max: 2, hint: 'Pick up to two.',
    options: [
      { id: 'a', text: 'Controlling other people\'s minds', w: { psychic: -3 } },
      { id: 'b', text: 'Earthquakes, storms — things that do not discriminate', w: { elemental: -3 } },
      { id: 'c', text: 'Living outside normal time', w: { time: -3 } },
      { id: 'd', text: 'Your body doing things bodies should not', w: { bio: -3 } },
      { id: 'e', text: 'Anything to do with death or spirits', w: { esoteric: -3 } },
      { id: 'f', text: 'Being a walking weapon', w: { energy: -3 } },
      { id: 'g', text: 'Depending on chance', w: { luck: -3 } },
      { id: 'h', text: 'Being fused with machinery', w: { tech: -3 } },
      { id: 'i', text: 'Altering reality itself', w: { reality: -4 } }
    ] },

  { id: 'q55', set: 6, text: 'How do you want to move?',
    options: [
      { id: 'a', text: 'On foot, faster than should be possible.', w: { beastial: 1, time: 2 } },
      { id: 'b', text: 'Flight.', w: { elemental: 2 }, sub: { air: 3 }, traits: ['aerial'] },
      { id: 'c', text: 'Here, then there. No in-between.', w: { time: 2, reality: 1 } },
      { id: 'd', text: 'I would rather stay put and have things come to me.', w: { psychic: 2 } }
    ] },

  { id: 'q56', set: 6, text: 'Which training sounds genuinely fun?',
    options: [
      { id: 'a', text: 'Combat and survival.', w: { beastial: 2 } },
      { id: 'b', text: 'Meditation and focus. Opening something up.', w: { psychic: 2, esoteric: 1 } },
      { id: 'c', text: 'Physics, mechanisms, how time actually works.', w: { time: 2, tech: 1 } },
      { id: 'd', text: 'Running wild terrain at speed.', w: { beastial: 1, elemental: 1, time: 1 } },
      { id: 'e', text: 'An instrument you can feel in your teeth.', w: { elemental: 1, energy: 1 }, sub: { sound: 4 }, traits: ['musical'] }
    ] },

  { id: 'q57', set: 6, text: 'What kind of story keeps you up?',
    options: [
      { id: 'a', text: 'A haunting. Something psychic and unprovable.', w: { psychic: 2, esoteric: 1 } },
      { id: 'b', text: 'Something huge and elemental — the world itself moving.', w: { elemental: 2 } },
      { id: 'c', text: 'A loop, a paradox, a clock running down.', w: { time: 2 } },
      { id: 'd', text: 'A body turning into something else.', w: { bio: 2 } },
      { id: 'e', text: 'A heist. A long con. An impossible plan.', w: { tech: 1, luck: 2 } }
    ] },

  { id: 'q58', set: 6, text: 'Pick an image you would want to be.',
    options: [
      { id: 'a', text: 'A lit match in a dark room.', w: { elemental: 1, energy: 1 }, sub: { fire: 4 } },
      { id: 'b', text: 'Something moving under still water.', w: { elemental: 1, psychic: 1 }, sub: { water: 4 } },
      { id: 'c', text: 'A note held too long.', w: { elemental: 1, time: 1 }, sub: { sound: 4 } },
      { id: 'd', text: 'A tree older than the road beside it.', w: { elemental: 1, bio: 1 }, sub: { earth: 2, plant: 3 } },
      { id: 'e', text: 'The second before lightning.', w: { elemental: 1, time: 1 }, sub: { storm: 4 } }
    ] },

  { id: 'q59', set: 6, text: 'Every real power has a leash. Which would you accept?',
    options: [
      { id: 'a', text: 'It only works when I am frightened or hurting.', w: { psychic: 2, time: 1 }, traits: ['conditional'] },
      { id: 'b', text: 'It costs me physically. Every use takes something.', w: { bio: 2, beastial: 1 }, traits: ['costly'] },
      { id: 'c', text: 'It needs preparation. Nothing on instinct.', w: { tech: 2, time: 1 }, traits: ['deliberate'] },
      { id: 'd', text: 'It works, but never quite the way I intended.', w: { luck: 2, reality: 1 }, traits: ['unpredictable'] },
      { id: 'e', text: 'Other people have to be nearby for it to work at all.', w: { psychic: 2, energy: 1 }, traits: ['relational'] }
    ] },

  { id: 'q60', set: 6, text: 'Last one. What would you actually want it for?',
    options: [
      { id: 'a', text: 'To keep specific people safe.', w: { psychic: 1, bio: 1 }, traits: ['protective'] },
      { id: 'b', text: 'To never be helpless again.', w: { beastial: 2 }, traits: ['hardened'] },
      { id: 'c', text: 'To be seen as something extraordinary.', w: { energy: 2 }, traits: ['performer'] },
      { id: 'd', text: 'To understand something I cannot currently reach.', w: { psychic: 1, esoteric: 1, tech: 1 }, traits: ['seeking'] },
      { id: 'e', text: 'To fix something that already happened.', w: { time: 2, reality: 2 }, traits: ['regretful'] }
    ] }
];

var QUESTIONS_BY_ID = {};
QUESTIONS.forEach(function (q) { QUESTIONS_BY_ID[q.id] = q; });

function questionsInSet(n) {
  return QUESTIONS.filter(function (q) { return q.set === n; });
}
