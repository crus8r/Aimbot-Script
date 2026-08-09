/* synergy.js — the pre-written fusion matrix.
 *
 * This is what makes MANUAL mode work with no model in the loop: every pair of
 * categories already has a fused result written for it. The rule for every
 * entry is the same one the AI prompt enforces — the two inputs must produce a
 * single mechanism, not two powers standing next to each other.
 */

var Synergy = (function () {

  function pairKey(a, b) {
    return [a, b].sort().join('|');
  }

  var PAIRS = {
    'beastial|bio':        { name: 'Adaptive Predation', line: 'your body rebuilds itself mid-fight toward whatever just hurt you' },
    'beastial|elemental':  { name: 'Wildform',           line: 'an animal shape that carries a piece of the landscape it came out of' },
    'beastial|energy':     { name: 'Overdrive',          line: 'instinct converted straight into output — the more feral you feel, the more the air around you burns off' },
    'beastial|esoteric':   { name: 'Totem',              line: 'something older than you wears your body whenever you stop resisting it' },
    'beastial|luck':       { name: 'Survivor',           line: 'nothing catches you the same way twice; the odds fold themselves around your reflexes' },
    'beastial|psychic':    { name: 'Pack Sense',         line: 'you feel intent as physical pressure and move before it arrives' },
    'beastial|reality':    { name: 'Apex Clause',        line: 'in your presence the rules of a fight quietly rewrite to favour the thing with teeth' },
    'beastial|tech':       { name: 'Grafted Instinct',   line: 'reflexes fast enough that machinery has to be built to keep up with them' },
    'beastial|time':       { name: 'Hunt Tempo',         line: 'you move at the speed of the chase rather than the speed of the room' },

    'bio|elemental':       { name: 'Sympathetic Body',   line: 'your tissue takes on the properties of whatever element you are standing in' },
    'bio|energy':          { name: 'Kinetic Metabolism', line: 'you eat force and spend it as mass' },
    'bio|esoteric':        { name: 'Shed',               line: 'you can step out of your body and it keeps working without you in it' },
    'bio|luck':            { name: 'Improbable Anatomy', line: 'nothing ever lands somewhere fatal; you are built wrong in a way that keeps saving you' },
    'bio|psychic':         { name: 'Somatic Empathy',    line: 'you pull other people\'s injuries into your own body and carry them better than they could' },
    'bio|reality':         { name: 'Draft',              line: 'your body is a draft you keep revising, and each revision was always the truth' },
    'bio|tech':            { name: 'Assimilate',         line: 'anything mechanical you hold long enough becomes tissue' },
    'bio|time':            { name: 'Regression',         line: 'you can slide your own body along its personal timeline — younger, older, unhurt' },

    'elemental|energy':    { name: 'Discharge',          line: 'the element does not obey you, it passes through you, and it costs you either way' },
    'elemental|esoteric':  { name: 'Haunted Ground',     line: 'places remember what happened in them, and you can make them say it in weather' },
    'elemental|luck':      { name: 'Weathervane',        line: 'the environment always breaks your way, and never obviously enough to prove' },
    'elemental|psychic':   { name: 'Resonance',          line: 'you read people through the medium — what they feel reaches you as sound, heat, pressure or current' },
    'elemental|reality':   { name: 'Terraform',          line: 'you rewrite the local conditions of a place and the world agrees it was always like that' },
    'elemental|tech':      { name: 'Conductor',          line: 'infrastructure treats you as part of the grid' },
    'elemental|time':      { name: 'Weather Memory',     line: 'you can run a place backwards or forwards through its own conditions' },

    'energy|esoteric':     { name: 'Spirit Flare',       line: 'what you project is not light, it is some of you, and you do not get all of it back' },
    'energy|luck':         { name: 'Overload Field',     line: 'everything near you either fails outright or works perfectly, and you do not choose which' },
    'energy|psychic':      { name: 'Broadcast',          line: 'you project feeling as force — a room believes you, and the air moves with them' },
    'energy|reality':      { name: 'Assertion',          line: 'you say a thing loudly enough and locally it becomes true' },
    'energy|tech':         { name: 'Reactor',            line: 'you are the power supply, and anything can be wired into you' },
    'energy|time':         { name: 'Impulse',            line: 'you spend future output now and pay for it with a window where you are empty' },

    'esoteric|luck':       { name: 'Threadwalker',       line: 'you leave your body to scout the luckiest version of a path, then walk it' },
    'esoteric|psychic':    { name: 'Second Sight',       line: 'you perceive minds and places that are not currently present' },
    'esoteric|reality':    { name: 'Thin Place',         line: 'where you stand the rules go soft, and things that should not be here can be' },
    'esoteric|tech':       { name: 'Ghost in the Wire',  line: 'you can put yourself inside a system and be genuinely present in it' },
    'esoteric|time':       { name: 'Revenant Loop',      line: 'you can be somewhere you already were, in a form that is not quite you' },

    'luck|psychic':        { name: 'Read the Odds',      line: 'you perceive probability as intent, and can nudge people toward the outcome that was always likelier' },
    'luck|reality':        { name: 'House Rules',        line: 'improbable things stop being improbable near you, and they stay that way' },
    'luck|tech':           { name: 'Failure Engineering',line: 'you know which component fails and when — and you can decide it is a different one' },
    'luck|time':           { name: 'Near Miss',          line: 'the version of the next few seconds where you get hurt simply does not get selected' },

    'psychic|reality':     { name: 'Consensus',          line: 'enough minds believing a thing makes it locally true, and you can move that number' },
    'psychic|tech':        { name: 'Interface',          line: 'you think in systems; minds and machines are the same substrate to you' },
    'psychic|time':        { name: 'Precognition',       line: 'you receive fragments of the near future through whichever sense you trust most' },

    'reality|tech':        { name: 'Retrofit',           line: 'you install a part into something that never had one, and it always had one' },
    'reality|time':        { name: 'Pruning',            line: 'you can burn a branch of the near future out of the possibility set before it grows' },

    'tech|time':           { name: 'Prep',               line: 'you can invest work into a moment you have not reached yet and collect it when you arrive' }
  };

  /* Fallback if only one category scored at all. */
  var SINGLES = {
    psychic:   { name: 'Open Channel',   line: 'you read and move minds, and you cannot fully close the door once it is open' },
    time:      { name: 'Off-Beat',       line: 'you run on a slightly different clock to everyone around you' },
    elemental: { name: 'Conduit',        line: 'one element answers you, reliably, and nothing else does' },
    beastial:  { name: 'Feral Edge',     line: 'strength, speed and senses past the human ceiling, at the cost of the human brakes' },
    bio:       { name: 'Unfixed',        line: 'your body is not a settled thing and can be argued with' },
    energy:    { name: 'Output',         line: 'you produce raw force, and everyone within a street knows you did' },
    luck:      { name: 'Weighted',       line: 'outcomes near you are not fair, and never have been' },
    tech:      { name: 'Builder',        line: 'machines behave for you in a way that is not entirely explicable' },
    esoteric:  { name: 'Unmoored',       line: 'you are not fully fixed to your body or to this side of things' },
    reality:   { name: 'Editor',         line: 'small facts about the world will accept correction from you' }
  };

  /* Third-place category becomes a modifier on the fused mechanic, not a
   * third power. This is the "drop it or let it flavour" rule. */
  var MODIFIERS = {
    psychic:   'it needs a mind nearby to anchor to',
    time:      'it works in windows, not continuously',
    elemental: 'it expresses itself through one element and refuses the others',
    beastial:  'it runs on instinct and adrenaline rather than on intent',
    bio:       'the cost lands in your body before it lands anywhere else',
    energy:    'it is loud, visible, and impossible to do discreetly',
    luck:      'the result is never quite the one you aimed at',
    tech:      'it needs preparation — nothing works on instinct',
    esoteric:  'it works best when you are partly absent from yourself',
    reality:   'and while it holds, nobody remembers it being otherwise'
  };

  var ELEMENT_FLAVOUR = {
    fire:  'through heat and combustion',
    water: 'through water and pressure',
    earth: 'through stone and standing ground',
    air:   'through air and altitude',
    sound: 'through sound — you hear it before anything else does',
    storm: 'through charge and static',
    plant: 'through growth and rot',
    metal: 'through metal and magnetism'
  };

  /* ---- the manual composer ------------------------------------------- */

  function compose(profile) {
    var short = profile.shortlist;

    if (!short.length) {
      return {
        name: 'Dormant',
        line: 'nothing has activated yet',
        derivation: ['No category has scored. The X-gene is present and idle.'],
        modifier: null,
        third: null,
        primary: null,
        secondary: null
      };
    }

    var primary = short[0];
    var secondary = short[1] || null;
    var third = short[2] || null;

    var fused, derivation = [];

    if (secondary) {
      var key = pairKey(primary.key, secondary.key);
      fused = PAIRS[key] || SINGLES[primary.key];
      derivation.push(
        CATEGORY_BY_KEY[primary.key].name + ' × ' + CATEGORY_BY_KEY[secondary.key].name +
        ' → ' + fused.name
      );
    } else {
      fused = SINGLES[primary.key];
      derivation.push('Single axis: ' + CATEGORY_BY_KEY[primary.key].name + ' → ' + fused.name);
    }

    var line = fused.line;

    // Elemental in the fused pair? Give it a specific element rather than "an element".
    var elementalInPair = primary.key === 'elemental' ||
                          (secondary && secondary.key === 'elemental');
    if (elementalInPair && profile.element) {
      line += ', ' + ELEMENT_FLAVOUR[profile.element];
      derivation.push('Elemental bias resolves to ' + ELEMENT_BY_KEY[profile.element].name +
        ' (' + profile.subs[profile.element] + ').');
    }

    // Third place becomes a constraint clause.
    var modifier = null;
    if (third) {
      if (third.key === 'elemental' && profile.element) {
        modifier = 'it expresses itself ' + ELEMENT_FLAVOUR[profile.element];
      } else {
        modifier = MODIFIERS[third.key];
      }
      derivation.push('Modifier: ' + CATEGORY_BY_KEY[third.key].name + ' → ' + modifier + '.');
    }

    if (profile.dropped.length) {
      profile.dropped.forEach(function (d) {
        derivation.push('Dropped ' + CATEGORY_BY_KEY[d.key].name + ' (' + d.value +
          ') — below the gate of ' + TUNING.REALITY_GATE + '.');
      });
    }

    return {
      name: fused.name,
      line: line,
      modifier: modifier,
      derivation: derivation,
      primary: primary,
      secondary: secondary,
      third: third
    };
  }

  return {
    compose: compose,
    pairKey: pairKey,
    PAIRS: PAIRS,
    SINGLES: SINGLES,
    MODIFIERS: MODIFIERS,
    ELEMENT_FLAVOUR: ELEMENT_FLAVOUR
  };
})();
