/* engine.js — the hidden tab.
 *
 * Everything here is deterministic arithmetic. The scoring is recomputed from
 * scratch on every change, which is what makes changing or clearing an answer
 * safe: nothing accumulates, so there is nothing to spam.
 */

var Engine = (function () {

  function blankCats() {
    var o = {};
    CATEGORY_KEYS.forEach(function (k) { o[k] = 0; });
    return o;
  }

  function blankSubs() {
    var o = {};
    ELEMENT_KEYS.forEach(function (k) { o[k] = 0; });
    return o;
  }

  function addWeights(target, weights) {
    if (!weights) return;
    for (var k in weights) {
      if (Object.prototype.hasOwnProperty.call(target, k)) target[k] += weights[k];
    }
  }

  function addTraits(bag, traits) {
    if (!traits) return;
    traits.forEach(function (t) { bag[t] = (bag[t] || 0) + 1; });
  }

  /* Clamp anything an LLM (or the offline heuristic) proposes for a free-text
   * answer. This is the only path where weights are not authored by hand, so
   * it is the only path that needs a hard ceiling. */
  function sanitiseOtherWeights(raw) {
    var out = {};
    if (!raw) return out;

    var entries = [];
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (CATEGORY_KEYS.indexOf(k) === -1) continue;      // unknown category — drop
      var v = Number(raw[k]);
      if (!isFinite(v) || v === 0) continue;
      v = Math.max(-TUNING.OTHER_MAX_PER_CATEGORY,
          Math.min(TUNING.OTHER_MAX_PER_CATEGORY, Math.round(v)));
      if (v !== 0) entries.push([k, v]);
    }

    // Keep the strongest few only.
    entries.sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); });
    entries = entries.slice(0, TUNING.OTHER_MAX_CATEGORIES);

    // And cap the total magnitude so one paragraph can't outweigh five questions.
    var budget = TUNING.OTHER_MAX_TOTAL_MAGNITUDE;
    entries.forEach(function (e) {
      if (budget <= 0) return;
      var mag = Math.min(Math.abs(e[1]), budget);
      budget -= mag;
      out[e[0]] = e[1] < 0 ? -mag : mag;
    });

    return out;
  }

  /* ---- core scoring ------------------------------------------------- */

  function score(state) {
    var cats = blankCats();
    var subs = blankSubs();
    var traits = {};
    var perSet = {};
    var answeredCount = 0;

    QUESTION_SETS.forEach(function (s) {
      perSet[s.n] = { cats: blankCats(), traits: {}, answered: 0, total: questionsInSet(s.n).length };
    });

    QUESTIONS.forEach(function (q) {
      var a = state.answers[q.id];
      if (!a) return;
      var touched = false;

      (a.selected || []).forEach(function (optId) {
        var opt = null;
        for (var i = 0; i < q.options.length; i++) {
          if (q.options[i].id === optId) { opt = q.options[i]; break; }
        }
        if (!opt) return;
        touched = true;
        addWeights(cats, opt.w);
        addWeights(subs, opt.sub);
        addTraits(traits, opt.traits);
        addWeights(perSet[q.set].cats, opt.w);
        addTraits(perSet[q.set].traits, opt.traits);
      });

      if (a.other && a.other.weights) {
        var ow = a.other.weights;
        var any = false;
        for (var k in ow) { if (ow[k]) { any = true; break; } }
        if (any) touched = true;
        addWeights(cats, ow);
        addWeights(perSet[q.set].cats, ow);
        addTraits(traits, a.other.traits);
        addTraits(perSet[q.set].traits, a.other.traits);
      }

      if (touched || (a.selected && a.selected.length)) {
        answeredCount++;
        perSet[q.set].answered++;
      }
    });

    return {
      cats: cats,
      subs: subs,
      traits: traits,
      perSet: perSet,
      answeredCount: answeredCount,
      totalQuestions: QUESTIONS.length
    };
  }

  /* ---- ranking, gating, tiering -------------------------------------- */

  function ranked(cats) {
    return CATEGORY_KEYS
      .map(function (k) { return { key: k, name: CATEGORY_BY_KEY[k].name, value: cats[k] }; })
      .sort(function (a, b) {
        if (b.value !== a.value) return b.value - a.value;
        return CATEGORY_KEYS.indexOf(a.key) - CATEGORY_KEYS.indexOf(b.key);
      });
  }

  function dominantElement(subs) {
    var best = null;
    ELEMENT_KEYS.forEach(function (k) {
      if (subs[k] <= 0) return;
      if (!best || subs[k] > subs[best]) best = k;
    });
    return best;
  }

  /* The most each category could possibly score if every question were answered
   * in the way that most favours it. Computed once, from the question bank, so
   * it stays correct when questions are added or reweighted. */
  var MAXIMA = (function () {
    var m = blankCats();
    QUESTIONS.forEach(function (q) {
      var picks = q.max || 1;
      CATEGORY_KEYS.forEach(function (k) {
        var vals = q.options
          .map(function (o) { return (o.w || {})[k] || 0; })
          .filter(function (v) { return v > 0; })
          .sort(function (a, b) { return b - a; });
        for (var i = 0; i < Math.min(picks, vals.length); i++) m[k] += vals[i];
      });
    });
    return m;
  })();

  function tierFor(top1, topKey, totalPositive, realityScore, realityInTop) {
    var ceiling = topKey ? (MAXIMA[topKey] || 1) : 1;
    var strength = Math.max(0, top1) / ceiling;
    var share = totalPositive > 0 ? top1 / totalPositive : 0;

    if (realityInTop &&
        realityScore >= TUNING.REALITY_GATE &&
        strength >= TUNING.OMEGA_STRENGTH) {
      return { key: 'omega', name: 'Omega', strength: strength, share: share, ceiling: ceiling };
    }

    var t = TUNING.TIERS[TUNING.TIERS.length - 1];
    for (var i = 0; i < TUNING.TIERS.length; i++) {
      if (strength >= TUNING.TIERS[i].min) { t = TUNING.TIERS[i]; break; }
    }

    return { key: t.key, name: t.name, strength: strength, share: share, ceiling: ceiling };
  }

  /* Produce the full derivation used by both output modes.
   * Split from score() so a profile can also be derived from a score vector
   * directly — used by the test suite and by tools/profiles.js to exercise
   * category combinations that would be tedious to reach by hand. */
  function derive(s) {
    var order = ranked(s.cats);

    var totalPositive = 0;
    order.forEach(function (r) { if (r.value > 0) totalPositive += r.value; });

    var realityScore = s.cats.reality;
    var realityRank = -1;
    order.forEach(function (r, i) { if (r.key === 'reality') realityRank = i; });

    var realityAllowed = realityScore >= TUNING.REALITY_GATE;

    // Build the shortlist: top three positive categories, with reality dropped
    // unless it earned its place. This is the "drop reality, it's doing more
    // harm than good" rule, made mechanical.
    var pool = order.filter(function (r) { return r.value > 0; });
    var shortlist = [];
    var dropped = [];

    pool.forEach(function (r) {
      if (shortlist.length >= 3) return;
      if (r.key === 'reality' && !realityAllowed) { dropped.push(r); return; }
      shortlist.push(r);
    });

    // Reality is allowed as a *third* only — never as the whole identity of the
    // power unless it is genuinely dominant.
    if (shortlist.length && shortlist[0].key === 'reality' && !(realityAllowed && realityScore >= TUNING.OMEGA_TOP1)) {
      var moved = shortlist.shift();
      shortlist.push(moved);
      shortlist = shortlist.slice(0, 3);
    }

    var top1 = shortlist.length ? shortlist[0].value : 0;
    var topKey = shortlist.length ? shortlist[0].key : null;
    var tier = tierFor(top1, topKey, totalPositive, realityScore,
      shortlist.some(function (r) { return r.key === 'reality'; }));

    var element = dominantElement(s.subs);

    var traitList = Object.keys(s.traits)
      .map(function (t) { return { tag: t, n: s.traits[t] }; })
      .sort(function (a, b) { return b.n - a.n; });

    return {
      scores: s.cats,
      subs: s.subs,
      order: order,
      shortlist: shortlist,
      dropped: dropped,
      totalPositive: totalPositive,
      realityScore: realityScore,
      realityRank: realityRank,
      realityAllowed: realityAllowed,
      tier: tier,
      element: element,
      elementName: element ? ELEMENT_BY_KEY[element].name : null,
      traits: traitList,
      traitCounts: s.traits,
      perSet: s.perSet,
      answeredCount: s.answeredCount,
      totalQuestions: s.totalQuestions,
      maxima: MAXIMA
    };
  }

  function profile(state) {
    return derive(score(state));
  }

  /* Build a score bundle from a plain {category: value} map. */
  function bundle(cats, subs, traits) {
    var c = blankCats(), sb = blankSubs();
    Object.keys(cats || {}).forEach(function (k) { if (k in c) c[k] = cats[k]; });
    Object.keys(subs || {}).forEach(function (k) { if (k in sb) sb[k] = subs[k]; });
    var perSet = {};
    QUESTION_SETS.forEach(function (s) {
      perSet[s.n] = { cats: blankCats(), traits: {}, answered: 0, total: 10 };
    });
    return {
      cats: c, subs: sb, traits: traits || {}, perSet: perSet,
      answeredCount: 0, totalQuestions: QUESTIONS.length
    };
  }

  /* ---- answer mutation ------------------------------------------------ */

  function toggleOption(state, questionId, optionId) {
    var q = QUESTIONS_BY_ID[questionId];
    if (!q) return;
    var max = q.max || 1;
    var a = state.answers[questionId] || (state.answers[questionId] = { selected: [], other: null });
    var sel = a.selected || (a.selected = []);
    var at = sel.indexOf(optionId);

    if (at !== -1) {
      sel.splice(at, 1);              // clicking a chosen answer clears it
      return;
    }
    sel.push(optionId);
    while (sel.length > max) sel.shift(); // oldest choice falls off, no dead ends
  }

  function setOther(state, questionId, payload) {
    var a = state.answers[questionId] || (state.answers[questionId] = { selected: [], other: null });
    if (!payload || !payload.text) { a.other = null; return; }
    a.other = {
      text: payload.text,
      weights: sanitiseOtherWeights(payload.weights),
      traits: (payload.traits || []).slice(0, 4),
      note: payload.note || '',
      source: payload.source || 'local'
    };
  }

  return {
    MAXIMA: MAXIMA,
    blankCats: blankCats,
    score: score,
    derive: derive,
    bundle: bundle,
    profile: profile,
    ranked: ranked,
    toggleOption: toggleOption,
    setOther: setOther,
    sanitiseOtherWeights: sanitiseOtherWeights
  };
})();
