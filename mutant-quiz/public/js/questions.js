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
      { id: 'a', text: 'Annoyingly hard to keep down. I bounce back faster than people expect.', w: { beastial: 2, bio: 1 }, traits: ['resilient'] },
      { id: 'b', text: 'Slowly and properly. I need real rest, but I get there.', w: { bio: 2 }, traits: ['patient'] },
      { id: 'c', text: 'I go strange while I\'m sick — vivid dreams, ideas that feel like warnings.', w: { psychic: 2, esoteric: 1 }, traits: ['dreamer'] },
      { id: 'd', text: 'Entirely down to my head. If I\'ve decided I\'m fine, I\'m fine.', w: { psychic: 1, bio: 1 }, traits: ['willful'] }
    ] },

  { id: 'q2', set: 1, text: 'Someone you love is in trouble across the city. Before you think — what does your body want to do?',
    options: [
      { id: 'a', text: 'Move. I\'d be out the door before I had a plan.', w: { time: 2, beastial: 1 }, traits: ['urgent'] },
      { id: 'b', text: 'Reach them. Calling, texting, willing them to pick up.', w: { psychic: 2 }, traits: ['connective'] },
      { id: 'c', text: 'Get between them and it. I want to be the wall.', w: { bio: 1, beastial: 1, energy: 1 }, traits: ['protective'] },
      { id: 'd', text: 'Fastest route, right person to call, whatever leverage exists.', w: { tech: 2, psychic: 1 }, traits: ['strategic'] }
    ] },

  { id: 'q3', set: 1, text: 'It is 3 a.m. and something breaks downstairs.',
    options: [
      { id: 'a', text: 'Adrenaline. I\'m up, I\'m moving, I\'m ready.', w: { beastial: 2 }, traits: ['reactive'] },
      { id: 'b', text: 'I go completely still and listen. Every sound gets louder.', w: { psychic: 1, beastial: 1 }, sub: { sound: 1 }, traits: ['watchful'] },
      { id: 'c', text: 'I freeze, then the analysis starts. What, where, how many.', w: { psychic: 2, beastial: -1 }, traits: ['analytical'] },
      { id: 'd', text: 'Honestly? I decide it\'s nothing and go back to sleep.', w: { luck: 2 }, traits: ['fatalist'] }
    ] },

  { id: 'q4', set: 1, text: 'As a kid, what were you known for?',
    options: [
      { id: 'a', text: 'Scabbed knees. Always climbing something I shouldn\'t.', w: { beastial: 2 }, traits: ['physical'] },
      { id: 'b', text: 'Staring out of the window at the weather.', w: { elemental: 2 }, sub: { storm: 1, air: 1 }, traits: ['dreamer', 'natural'] },
      { id: 'c', text: 'Knowing adults were upset before they said anything.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'd', text: 'Taking things apart. Sometimes they went back together.', w: { tech: 2 }, traits: ['inventive'] }
    ] },

  { id: 'q5', set: 1, text: 'Is there anything unusual about your body — from birth or since?',
    options: [
      { id: 'a', text: 'Something visible. Eyes, hair, markings, the shape of me.', w: { beastial: 1, bio: 1 }, traits: ['marked'] },
      { id: 'b', text: 'Something structural. Extra, missing, or simply built differently.', w: { bio: 2 }, traits: ['marked'] },
      { id: 'c', text: 'No. I read as completely ordinary.', w: { beastial: -1, bio: -1 }, traits: ['unremarkable'] },
      { id: 'd', text: 'Probably, but I\'ve never thought about it hard enough to say.', w: {}, traits: ['unbothered'] }
    ] },

  { id: 'q6', set: 1, text: 'What are your dreams like?',
    options: [
      { id: 'a', text: 'Loud and physical. Running, falling, being chased.', w: { beastial: 2 }, traits: ['primal'] },
      { id: 'b', text: 'I am somewhere else entirely and I don\'t come back easily.', w: { esoteric: 2, psychic: 1 }, traits: ['dissociative'] },
      { id: 'c', text: 'Repeating. The same places and people, over and over.', w: { time: 2 }, traits: ['cyclical'] },
      { id: 'd', text: 'I don\'t remember them. Lights out, lights on.', w: { bio: 1 }, traits: ['grounded'] }
    ] },

  { id: 'q7', set: 1, text: 'Something falls off a shelf towards your head.',
    options: [
      { id: 'a', text: 'I catch it. I usually catch things.', w: { beastial: 2 }, traits: ['reflexive'] },
      { id: 'b', text: 'It hits me. I am always half a second late.', w: { time: -1, psychic: 1 }, traits: ['internal'] },
      { id: 'c', text: 'I recoil hard. My whole body gets out of the way.', w: { bio: 1, beastial: 1 }, traits: ['defensive'] },
      { id: 'd', text: 'Everything stretches for a moment and I move without deciding to.', w: { time: 2 }, traits: ['dilating'] }
    ] },

  { id: 'q8', set: 1, text: 'Your relationship with pain.',
    options: [
      { id: 'a', text: 'High tolerance. I\'ve learned to work through it.', w: { beastial: 2 }, traits: ['enduring'] },
      { id: 'b', text: 'I feel it enormously — mine and other people\'s.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'c', text: 'It\'s information. Where, how bad, what changed.', w: { tech: 1, bio: 1 }, traits: ['clinical'] },
      { id: 'd', text: 'I go somewhere else in my head until it is over.', w: { esoteric: 2 }, traits: ['dissociative'] }
    ] },

  { id: 'q9', set: 1, text: 'You are past exhausted and there is still work left.',
    options: [
      { id: 'a', text: 'I keep going. Something in me refuses to stop.', w: { beastial: 2 }, traits: ['relentless'] },
      { id: 'b', text: 'A second wind arrives from somewhere I can\'t account for.', w: { energy: 2 }, traits: ['surging'] },
      { id: 'c', text: 'I stop, and I make peace with stopping.', w: { bio: 1, psychic: 1 }, traits: ['measured'] },
      { id: 'd', text: 'I push and hope it doesn\'t cost me tomorrow.', w: { luck: 2 }, traits: ['risk-taker'] }
    ] },

  { id: 'q10', set: 1, text: 'Which of your senses is unfairly sharp?',
    options: [
      { id: 'a', text: 'Hearing. I catch things nobody else in the room does.', w: { elemental: 1, psychic: 1 }, sub: { sound: 3 }, traits: ['attuned'] },
      { id: 'b', text: 'Sight. Movement, detail, anything that changed.', w: { beastial: 2 }, traits: ['observant'] },
      { id: 'c', text: 'Smell or taste. It\'s almost inconvenient.', w: { beastial: 1, bio: 1 }, traits: ['primal'] },
      { id: 'd', text: 'None of the five. I just know when something is off.', w: { psychic: 2, esoteric: 1 }, traits: ['intuitive'] }
    ] },

  /* ── SET 2 — MIND & FEELING ─────────────────────────────────────────── */

  { id: 'q11', set: 2, text: 'You walk into a room where something has just happened.',
    options: [
      { id: 'a', text: 'I can feel it immediately. It\'s almost physical.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'b', text: 'I read the evidence. Postures, distances, who isn\'t talking.', w: { psychic: 1, tech: 1 }, traits: ['analytical'] },
      { id: 'c', text: 'I don\'t notice until somebody tells me.', w: { psychic: -1, bio: 1 }, traits: ['self-contained'] },
      { id: 'd', text: 'I notice, and my instinct is to break the tension.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  { id: 'q12', set: 2, text: 'Someone lies to your face.',
    options: [
      { id: 'a', text: 'I know. I almost always know.', w: { psychic: 2 }, traits: ['perceptive'] },
      { id: 'b', text: 'I find out later and it eats me.', w: { psychic: 1, time: 1 }, traits: ['ruminative'] },
      { id: 'c', text: 'I let it go. People lie; that\'s their business.', w: { luck: 1, psychic: 1 }, traits: ['permissive'] },
      { id: 'd', text: 'I want to know why. The lie is more interesting than the truth.', w: { psychic: 1, esoteric: 1 }, traits: ['curious'] }
    ] },

  { id: 'q13', set: 2, text: 'How does loss sit in you?',
    options: [
      { id: 'a', text: 'It changed me structurally. I am a different shape now.', w: { bio: 2 }, traits: ['transformed'] },
      { id: 'b', text: 'It sharpened something. I got harder and faster.', w: { beastial: 1, time: 1 }, traits: ['hardened'] },
      { id: 'c', text: 'I keep going back to it. I replay it.', w: { time: 2 }, traits: ['ruminative'] },
      { id: 'd', text: 'I carry other people\'s grief more easily than my own.', w: { psychic: 2 }, traits: ['empathic'] }
    ] },

  { id: 'q14', set: 2, text: 'What kind of memory do you have?',
    options: [
      { id: 'a', text: 'Sensory. I remember how things smelled and sounded.', w: { elemental: 1, psychic: 1 }, sub: { sound: 2 }, traits: ['vivid'] },
      { id: 'b', text: 'Emotional. I remember exactly how a moment felt.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'c', text: 'Chronological. I can place things on a timeline.', w: { time: 2 }, traits: ['precise'] },
      { id: 'd', text: 'Poor, honestly. It\'s all a blur.', w: { luck: 1, bio: 1 }, traits: ['present-focused'] }
    ] },

  { id: 'q15', set: 2, text: 'You are alone with nothing to do and no phone.',
    options: [
      { id: 'a', text: 'I make something. My hands need work.', w: { tech: 2 }, traits: ['inventive'] },
      { id: 'b', text: 'I go outside.', w: { elemental: 2 }, traits: ['natural'] },
      { id: 'c', text: 'I go inward. Think, imagine, drift.', w: { psychic: 2 }, traits: ['introspective'] },
      { id: 'd', text: 'I get restless fast. I need motion.', w: { beastial: 1, time: 1 }, traits: ['restless'] }
    ] },

  { id: 'q16', set: 2, text: 'Your mind at its worst does what?',
    options: [
      { id: 'a', text: 'Loops. The same thought, hundreds of times.', w: { time: 2 }, traits: ['anxious'] },
      { id: 'b', text: 'Runs every worst case in vivid detail.', w: { psychic: 2, time: 1 }, traits: ['anxious'] },
      { id: 'c', text: 'Goes quiet and very far away.', w: { esoteric: 2 }, traits: ['dissociative'] },
      { id: 'd', text: 'Wants to break something.', w: { beastial: 2 }, traits: ['volatile'] }
    ] },

  { id: 'q17', set: 2, text: 'When you are genuinely anxious, where does it live in your body?',
    options: [
      { id: 'a', text: 'Chest and hands. I vibrate.', w: { energy: 2 }, traits: ['anxious'] },
      { id: 'b', text: 'Stomach. Heavy and nauseating.', w: { bio: 2 }, traits: ['anxious'] },
      { id: 'c', text: 'Everything speeds up — heart, thoughts, the room.', w: { time: 2 }, traits: ['anxious'] },
      { id: 'd', text: 'I go cold and still, like prey.', w: { beastial: 2 }, traits: ['anxious'] }
    ] },

  { id: 'q18', set: 2, text: 'How do you concentrate?',
    options: [
      { id: 'a', text: 'Total tunnel. The world stops existing.', w: { psychic: 2 }, traits: ['focused'] },
      { id: 'b', text: 'I need noise. Music, something running underneath.', w: { elemental: 1 }, sub: { sound: 3 }, traits: ['attuned'] },
      { id: 'c', text: 'I need to be moving. Walking, pacing, hands busy.', w: { beastial: 1, time: 1 }, traits: ['kinetic'] },
      { id: 'd', text: 'In bursts. Nothing, nothing, nothing, everything.', w: { energy: 2 }, traits: ['surging'] }
    ] },

  { id: 'q19', set: 2, text: 'Have you ever known something before it happened?',
    options: [
      { id: 'a', text: 'Yes. More than once, and it unsettles me.', w: { time: 2, psychic: 1 }, traits: ['precognitive'] },
      { id: 'b', text: 'Déjà vu constantly, but I don\'t read into it.', w: { time: 1, esoteric: 1 }, traits: ['uncanny'] },
      { id: 'c', text: 'No, but I\'m very good at seeing where things are going.', w: { psychic: 1, tech: 1 }, traits: ['analytical'] },
      { id: 'd', text: 'No, and I don\'t believe in it.', w: { time: -1, esoteric: -1 }, traits: ['skeptical'] }
    ] },

  { id: 'q20', set: 2, text: 'What is hardest about being in a crowd?',
    options: [
      { id: 'a', text: 'Everyone\'s feelings arrive at once and I can\'t filter them.', w: { psychic: 2 }, traits: ['empathic', 'overwhelmed'] },
      { id: 'b', text: 'The noise. Layers and layers of it.', w: { elemental: 1 }, sub: { sound: 3 }, traits: ['attuned'] },
      { id: 'c', text: 'Being looked at.', w: { bio: 1, psychic: 1 }, traits: ['self-conscious'] },
      { id: 'd', text: 'Nothing. Crowds are where I come alive.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  /* ── SET 3 — WORLD & ELEMENT ────────────────────────────────────────── */

  { id: 'q21', set: 3, text: 'Where do you go to feel like yourself again?',
    options: [
      { id: 'a', text: 'Water. Ocean, river, rain, a very long bath.', w: { elemental: 2 }, sub: { water: 3 }, traits: ['natural'] },
      { id: 'b', text: 'High up. A roof, a hill, a window seat.', w: { elemental: 2 }, sub: { air: 3 }, traits: ['aerial'] },
      { id: 'c', text: 'Somewhere with trees and dirt.', w: { elemental: 2 }, sub: { earth: 2, plant: 2 }, traits: ['natural'] },
      { id: 'd', text: 'A room I built. My space, my things, my rules.', w: { tech: 2 }, traits: ['nesting'] }
    ] },

  { id: 'q22', set: 3, text: 'Which weather feels like your interior?',
    options: [
      { id: 'a', text: 'A storm about to break.', w: { elemental: 2 }, sub: { storm: 3 }, traits: ['charged'] },
      { id: 'b', text: 'Heavy heat, or a fire in the dark.', w: { elemental: 2 }, sub: { fire: 3 }, traits: ['intense'] },
      { id: 'c', text: 'Fog, or steady rain.', w: { elemental: 2, psychic: 1 }, sub: { water: 3 }, traits: ['quiet'] },
      { id: 'd', text: 'Still, clear and cold.', w: { elemental: 1, psychic: 1 }, sub: { air: 2 }, traits: ['composed'] }
    ] },

  { id: 'q23', set: 3, text: 'Best time of day?',
    options: [
      { id: 'a', text: 'Right before dawn.', w: { time: 2 }, traits: ['liminal'] },
      { id: 'b', text: 'The middle of the night.', w: { esoteric: 2 }, traits: ['nocturnal'] },
      { id: 'c', text: 'Peak afternoon. Full sun.', w: { energy: 2, elemental: 1 }, sub: { fire: 1 }, traits: ['bright'] },
      { id: 'd', text: 'Dusk. The in-between.', w: { time: 1, esoteric: 1 }, traits: ['liminal'] }
    ] },

  { id: 'q24', set: 3, text: 'What is music to you?',
    options: [
      { id: 'a', text: 'Load-bearing. I don\'t function well without it.', w: { elemental: 2 }, sub: { sound: 4 }, traits: ['musical'] },
      { id: 'b', text: 'I make it, or I used to.', w: { elemental: 1, energy: 2 }, sub: { sound: 3 }, traits: ['musical', 'performer'] },
      { id: 'c', text: 'Pleasant. I don\'t need it.', w: { tech: 1 }, traits: ['pragmatic'] },
      { id: 'd', text: 'It gets into me too much. Certain songs are dangerous.', w: { elemental: 1, psychic: 2 }, sub: { sound: 3 }, traits: ['musical', 'empathic'] }
    ] },

  { id: 'q25', set: 3, text: 'You and machines.',
    options: [
      { id: 'a', text: 'We understand each other. I fix things intuitively.', w: { tech: 2 }, traits: ['inventive'] },
      { id: 'b', text: 'They break around me. Constantly.', w: { tech: -1, energy: 1, esoteric: 1 }, traits: ['chaotic'] },
      { id: 'c', text: 'I use them well. I don\'t care how they work.', w: { tech: 1 }, traits: ['pragmatic'] },
      { id: 'd', text: 'I would rather have something living than something built.', w: { tech: -1, elemental: 2 }, sub: { plant: 2 }, traits: ['natural'] }
    ] },

  { id: 'q26', set: 3, text: 'First thing you clock walking into a new place.',
    options: [
      { id: 'a', text: 'Exits, sightlines, who is where.', w: { beastial: 2 }, traits: ['watchful'] },
      { id: 'b', text: 'The mood. Who is comfortable and who isn\'t.', w: { psychic: 2 }, traits: ['empathic'] },
      { id: 'c', text: 'The light, the smell, the temperature.', w: { elemental: 2 }, traits: ['attuned'] },
      { id: 'd', text: 'The wiring, the kit, how it was put together.', w: { tech: 2 }, traits: ['inventive'] }
    ] },

  { id: 'q27', set: 3, text: 'Which of these genuinely unsettles you?',
    options: [
      { id: 'a', text: 'Deep water.', w: { elemental: -1 }, sub: { water: -3 }, traits: ['wary'] },
      { id: 'b', text: 'Heights.', w: { elemental: -1 }, sub: { air: -3 }, traits: ['wary'] },
      { id: 'c', text: 'Total darkness.', w: { esoteric: -2 }, traits: ['wary'] },
      { id: 'd', text: 'Enclosed spaces.', w: { bio: -1, time: 1 }, sub: { earth: -2 }, traits: ['wary'] },
      { id: 'e', text: 'None of them, really.', w: { beastial: 1, elemental: 1 }, traits: ['fearless'] }
    ] },

  { id: 'q28', set: 3, text: 'Given a project — would you rather build it or grow it?',
    options: [
      { id: 'a', text: 'Build. I want to see the parts.', w: { tech: 2 }, traits: ['inventive'] },
      { id: 'b', text: 'Grow. I want to tend it and see what it becomes.', w: { elemental: 2, bio: 1 }, sub: { plant: 3 }, traits: ['patient'] },
      { id: 'c', text: 'Both. I like the seam where they meet.', w: { tech: 1, elemental: 1, bio: 1 }, sub: { metal: 1, plant: 1 }, traits: ['hybrid'] },
      { id: 'd', text: 'Neither. I would rather find something already made.', w: { luck: 2 }, traits: ['opportunist'] }
    ] },

  { id: 'q29', set: 3, text: 'Somebody hands you a rusted, faintly humming object with no label.',
    options: [
      { id: 'a', text: 'I take it apart to find out what it is.', w: { tech: 2 }, sub: { metal: 1 }, traits: ['inventive'] },
      { id: 'b', text: 'I hold it and see how it feels.', w: { psychic: 1, esoteric: 2 }, traits: ['intuitive'] },
      { id: 'c', text: 'I turn it on. Obviously.', w: { luck: 2, energy: 1 }, traits: ['risk-taker'] },
      { id: 'd', text: 'I get rid of it. I don\'t want whatever that is.', w: { luck: -2, esoteric: -1 }, traits: ['cautious'] }
    ] },

  { id: 'q30', set: 3, text: 'Which of these would you want to stand near — safely?',
    options: [
      { id: 'a', text: 'A wildfire.', w: { elemental: 2 }, sub: { fire: 4 }, traits: ['intense'] },
      { id: 'b', text: 'A tidal surge.', w: { elemental: 2 }, sub: { water: 4 }, traits: ['intense'] },
      { id: 'c', text: 'A lightning storm.', w: { elemental: 2 }, sub: { storm: 4 }, traits: ['charged'] },
      { id: 'd', text: 'An earthquake. Something breaking open.', w: { elemental: 2 }, sub: { earth: 4 }, traits: ['intense'] }
    ] },

  /* ── SET 4 — CONFLICT & MORALITY ────────────────────────────────────── */

  { id: 'q31', set: 4, text: 'Someone hurts a person you love.',
    options: [
      { id: 'a', text: 'Something in me goes very quiet and very cold.', w: { psychic: 2 }, traits: ['controlled'] },
      { id: 'b', text: 'I want them to feel it. Immediately.', w: { beastial: 2 }, traits: ['retributive'] },
      { id: 'c', text: 'I want to understand why before I decide anything.', w: { psychic: 1, tech: 1 }, traits: ['analytical'] },
      { id: 'd', text: 'I get between them and it ever happening again.', w: { bio: 1, energy: 1, beastial: 1 }, traits: ['protective'] }
    ] },

  { id: 'q32', set: 4, text: 'Rules.',
    options: [
      { id: 'a', text: 'Guidelines. I break them when it is worth breaking them.', w: { luck: 1, beastial: 1 }, traits: ['rulebreaker'] },
      { id: 'b', text: 'I follow them, and it bothers me when others don\'t.', w: { tech: 1, psychic: 1 }, traits: ['orderly'] },
      { id: 'c', text: 'I don\'t break rules. I find the gaps in them.', w: { tech: 2, luck: 1 }, traits: ['cunning'] },
      { id: 'd', text: 'I don\'t really register them as real.', w: { esoteric: 1, reality: 1, luck: 1 }, traits: ['unbound'] }
    ] },

  { id: 'q33', set: 4, text: 'You are in an argument you know you will win.',
    options: [
      { id: 'a', text: 'I win it. Cleanly and completely.', w: { psychic: 1, energy: 1 }, traits: ['assertive'] },
      { id: 'b', text: 'I stop, because winning is not the point.', w: { psychic: 2 }, traits: ['principled'] },
      { id: 'c', text: 'I let them save face. They will come round on their own.', w: { psychic: 2 }, traits: ['strategic'] },
      { id: 'd', text: 'I enjoy it, honestly. It is a good feeling.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  { id: 'q34', set: 4, text: 'You learn a secret that is not yours.',
    options: [
      { id: 'a', text: 'It stays with me. Permanently.', w: { psychic: 2 }, traits: ['trustworthy'] },
      { id: 'b', text: 'It bothers me until it is out in the open.', w: { energy: 1, psychic: 1 }, traits: ['candid'] },
      { id: 'c', text: 'I use it, carefully, if I need to.', w: { tech: 1, psychic: 1 }, traits: ['calculating'] },
      { id: 'd', text: 'I would rather not have known. Information is weight.', w: { bio: 1, esoteric: 1 }, traits: ['burdened'] }
    ] },

  { id: 'q35', set: 4, text: 'In a team you end up as:',
    options: [
      { id: 'a', text: 'The one who sees the shape of the whole thing.', w: { psychic: 2 }, traits: ['strategic'] },
      { id: 'b', text: 'The one who takes the hit so nobody else has to.', w: { bio: 2, beastial: 1 }, traits: ['protective'] },
      { id: 'c', text: 'The one who goes first and loudest.', w: { energy: 2, beastial: 1 }, traits: ['bold'] },
      { id: 'd', text: 'The one nobody can predict, including me.', w: { luck: 2, elemental: 1 }, traits: ['wildcard'] }
    ] },

  { id: 'q36', set: 4, text: 'Would you give up something permanent to fix something temporary?',
    options: [
      { id: 'a', text: 'Yes. I have done it.', w: { bio: 2 }, traits: ['sacrificial'] },
      { id: 'b', text: 'Yes, and I would resent it forever.', w: { psychic: 1, time: 1 }, traits: ['ruminative'] },
      { id: 'c', text: 'No. Permanent things are not currency.', w: { tech: 1, psychic: 1 }, traits: ['principled'] },
      { id: 'd', text: 'Depends entirely on the odds.', w: { luck: 2 }, traits: ['gambler'] }
    ] },

  { id: 'q37', set: 4, text: 'How do you fight — literally or otherwise?',
    options: [
      { id: 'a', text: 'Fast and first. Overwhelm before they set up.', w: { time: 2, beastial: 1 }, traits: ['aggressive'] },
      { id: 'b', text: 'Absorb, endure, outlast.', w: { bio: 2 }, traits: ['enduring'] },
      { id: 'c', text: 'Find the one thing that ends it, and use only that.', w: { psychic: 1, tech: 1 }, traits: ['precise'] },
      { id: 'd', text: 'Big and loud, so nobody wants a second round.', w: { energy: 2 }, traits: ['overwhelming'] }
    ] },

  { id: 'q38', set: 4, text: 'You could unmake one bad thing that happened to you — but it would also unmake something good that grew out of it. Do you?',
    options: [
      { id: 'a', text: 'Yes. Instantly. No hesitation.', w: { time: 2, reality: 2 }, traits: ['regretful'] },
      { id: 'b', text: 'No. It made me.', w: { bio: 2 }, traits: ['accepting'] },
      { id: 'c', text: 'I would want to see both versions before deciding.', w: { time: 2, psychic: 1, reality: 1 }, traits: ['deliberative'] },
      { id: 'd', text: 'That isn\'t a real question, so: no.', w: { psychic: 1 }, traits: ['grounded'] }
    ] },

  { id: 'q39', set: 4, text: 'The idea of having power over other people.',
    options: [
      { id: 'a', text: 'Frightens me. I would be careful to the point of paralysis.', w: { psychic: 2 }, traits: ['principled'] },
      { id: 'b', text: 'I would want it. I think I would use it well.', w: { energy: 1, tech: 1, reality: 1 }, traits: ['ambitious'] },
      { id: 'c', text: 'I already avoid it. I don\'t like being in charge.', w: { esoteric: 1, bio: 1 }, traits: ['retiring'] },
      { id: 'd', text: 'Only to stop someone worse from having it.', w: { psychic: 1, beastial: 1 }, traits: ['protective'] }
    ] },

  { id: 'q40', set: 4, text: 'When you turn out to be wrong.',
    options: [
      { id: 'a', text: 'I say so immediately.', w: { psychic: 1, tech: 1 }, traits: ['honest'] },
      { id: 'b', text: 'I hate it, and it takes me a while.', w: { beastial: 1, time: 1 }, traits: ['stubborn'] },
      { id: 'c', text: 'I adjust quietly and never mention it.', w: { esoteric: 1, psychic: 1 }, traits: ['private'] },
      { id: 'd', text: 'I would rather be wrong loudly than right quietly.', w: { energy: 2 }, traits: ['performer'] }
    ] },

  /* ── SET 5 — IDENTITY & WANT ────────────────────────────────────────── */

  { id: 'q41', set: 5, text: 'Your reflection.',
    options: [
      { id: 'a', text: 'Familiar. That is me.', w: { bio: -1, psychic: 1 }, traits: ['settled'] },
      { id: 'b', text: 'Often a stranger. It takes a second to connect.', w: { bio: 2, esoteric: 1 }, traits: ['dysmorphic'] },
      { id: 'c', text: 'A costume. Useful, but not really the point.', w: { esoteric: 2, psychic: 1 }, traits: ['detached'] },
      { id: 'd', text: 'A work in progress that I keep editing.', w: { bio: 2 }, traits: ['transforming'] }
    ] },

  { id: 'q42', set: 5, text: 'Being looked at.',
    options: [
      { id: 'a', text: 'I want it. I am better with an audience.', w: { energy: 2 }, traits: ['performer'] },
      { id: 'b', text: 'I would genuinely rather be invisible.', w: { bio: 2, esoteric: 1 }, traits: ['private'] },
      { id: 'c', text: 'Fine, as long as I chose it.', w: { psychic: 1, tech: 1 }, traits: ['controlled'] },
      { id: 'd', text: 'It makes my skin feel wrong.', w: { bio: 1, psychic: 1 }, traits: ['self-conscious'] }
    ] },

  { id: 'q43', set: 5, text: 'If you could change one thing about your body:',
    options: [
      { id: 'a', text: 'Stronger, faster, harder to damage.', w: { beastial: 2 }, traits: ['physical'] },
      { id: 'b', text: 'I would want to change it whenever I liked.', w: { bio: 2, reality: 1 }, traits: ['transforming'] },
      { id: 'c', text: 'I would fix the part that hurts or fails.', w: { bio: 2 }, traits: ['enduring'] },
      { id: 'd', text: 'Nothing. I would change what is in it, not what it is.', w: { psychic: 2 }, traits: ['introspective'] }
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
      { id: 'a', text: 'Armour. Real, heavy, functional.', w: { bio: 1, tech: 1 }, sub: { metal: 2 }, traits: ['defensive'] },
      { id: 'b', text: 'A mask. Nobody gets my face.', w: { esoteric: 2, psychic: 1 }, traits: ['private'] },
      { id: 'c', text: 'Something that moves and looks incredible.', w: { energy: 2 }, traits: ['performer'] },
      { id: 'd', text: 'My own clothes. I am not hiding.', w: { psychic: 1, beastial: 1 }, traits: ['direct'] }
    ] },

  { id: 'q46', set: 5, text: 'Alone, or among people?',
    options: [
      { id: 'a', text: 'Alone, and I need it more than most people do.', w: { psychic: 2 }, traits: ['solitary'] },
      { id: 'b', text: 'Among people, always. Silence is worse.', w: { energy: 2 }, traits: ['social'] },
      { id: 'c', text: 'One person at a time.', w: { psychic: 2 }, traits: ['intimate'] },
      { id: 'd', text: 'Wildly dependent on the day.', w: { luck: 1, bio: 1 }, traits: ['variable'] }
    ] },

  { id: 'q47', set: 5, text: 'You, five years ago.',
    options: [
      { id: 'a', text: 'A different person. I have been rebuilt since.', w: { bio: 2, time: 1 }, traits: ['transformed'] },
      { id: 'b', text: 'The same, with less information.', w: { psychic: 1, tech: 1 }, traits: ['consistent'] },
      { id: 'c', text: 'I would want to warn them about something specific.', w: { time: 2, reality: 1 }, traits: ['regretful'] },
      { id: 'd', text: 'I try not to look back there.', w: { esoteric: 1, bio: 1 }, traits: ['avoidant'] }
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
      { id: 'a', text: 'I would come back stronger and less afraid.', w: { beastial: 2 }, traits: ['hardened'] },
      { id: 'b', text: 'I would come back knowing something I can\'t explain.', w: { psychic: 2, esoteric: 1 }, traits: ['mystic'] },
      { id: 'c', text: 'I would come back physically different.', w: { bio: 2 }, traits: ['transformed'] },
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
