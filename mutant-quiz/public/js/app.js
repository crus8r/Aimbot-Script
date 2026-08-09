/* app.js — UI, navigation, demo instrumentation. */

var App = (function () {

  var state = {
    answers: {},
    screen: 'intro',      // intro | set | interstitial | results
    setIndex: 0,          // 0-based index into QUESTION_SETS
    notes: {},            // setNumber -> {observation, traits, source, stale}
    anchor: '',
    aiMode: true,
    demoMode: false,
    result: null,
    busy: false
  };

  var el = {};
  var otherTimers = {};
  var otherPending = {};

  /* ---- small helpers -------------------------------------------------- */

  function $(sel) { return document.querySelector(sel); }
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function sign(n) { return (n > 0 ? '+' : '') + n; }

  function currentSet() { return QUESTION_SETS[state.setIndex]; }

  function selectedTextsFor(q) {
    var a = state.answers[q.id];
    if (!a || !a.selected) return [];
    return a.selected.map(function (id) {
      for (var i = 0; i < q.options.length; i++) if (q.options[i].id === id) return q.options[i].text;
      return id;
    });
  }

  /* ---- rendering: shell ---------------------------------------------- */

  function renderChrome() {
    var p = Engine.profile(state);
    el.progressFill.style.width = Math.round(100 * p.answeredCount / p.totalQuestions) + '%';
    el.progressText.textContent = p.answeredCount + ' / ' + p.totalQuestions;
    document.body.classList.toggle('demo-on', state.demoMode);
    el.aiToggle.classList.toggle('on', state.aiMode);
    el.demoToggle.classList.toggle('on', state.demoMode);
    el.aiToggle.setAttribute('aria-pressed', String(state.aiMode));
    el.demoToggle.setAttribute('aria-pressed', String(state.demoMode));
    renderTally(p);
  }

  function transportLabel() {
    var t = LLM.state.transport;
    if (t === 'proxy') return 'server proxy';
    if (t === 'direct') return 'browser key';
    if (t === 'offline') return 'offline';
    return 'checking…';
  }

  /* ---- rendering: live tally (demo panel) ----------------------------- */

  function renderTally(p) {
    if (!state.demoMode) return;

    clear(el.tallyCats);
    var maxAbs = 1;
    CATEGORY_KEYS.forEach(function (k) { maxAbs = Math.max(maxAbs, Math.abs(p.scores[k])); });

    p.order.forEach(function (row, i) {
      var line = h('div', 'tally-row' + (row.value === 0 ? ' zero' : '') + (row.value < 0 ? ' neg' : ''));
      var inShort = p.shortlist.some(function (s) { return s.key === row.key; });
      if (inShort) line.classList.add('short-' + (i < 1 ? '1' : '2'));

      var label = h('span', 'tally-name', CATEGORY_BY_KEY[row.key].short);
      var barWrap = h('span', 'tally-bar');
      var bar = h('span', 'tally-fill');
      bar.style.width = Math.round(100 * Math.abs(row.value) / maxAbs) + '%';
      if (row.value < 0) bar.classList.add('is-neg');
      barWrap.appendChild(bar);
      var val = h('span', 'tally-val', String(row.value));

      line.appendChild(label);
      line.appendChild(barWrap);
      line.appendChild(val);
      el.tallyCats.appendChild(line);
    });

    clear(el.tallySubs);
    var anySub = false;
    ELEMENT_KEYS.forEach(function (k) {
      if (p.subs[k] === 0) return;
      anySub = true;
      var chip = h('span', 'sub-chip' + (k === p.element ? ' is-top' : ''),
        ELEMENT_BY_KEY[k].name + ' ' + sign(p.subs[k]));
      el.tallySubs.appendChild(chip);
    });
    if (!anySub) el.tallySubs.appendChild(h('span', 'muted-sm', 'no elemental bias yet'));

    clear(el.tallyTraits);
    if (p.traits.length) {
      p.traits.slice(0, 12).forEach(function (t) {
        el.tallyTraits.appendChild(h('span', 'trait-chip', t.tag + (t.n > 1 ? ' ×' + t.n : '')));
      });
    } else {
      el.tallyTraits.appendChild(h('span', 'muted-sm', 'no trait tags yet'));
    }

    var gate = p.realityAllowed ? 'OPEN' : 'closed';
    el.tallyMeta.textContent =
      'tier ' + p.tier.name.toUpperCase() +
      ' · strength ' + Math.round(p.tier.strength * 100) + '%' +
      ' (' + (p.shortlist[0] ? p.shortlist[0].value : 0) + '/' + Math.round(p.tier.ceiling) + ')' +
      ' · total +' + p.totalPositive +
      ' · reality gate ' + gate + ' (' + p.realityScore + '/' + TUNING.REALITY_GATE + ')' +
      ' · llm ' + transportLabel();
  }

  function appendSignal(entry) {
    if (!el.tallyLog) return;
    var line = h('div', 'signal' + (entry.ok ? '' : ' bad'));
    line.textContent = entry.at + '  ' + entry.kind + '  ' +
      (entry.ok ? (entry.ms + 'ms ' + (entry.tokens || '')) : 'FAIL') +
      (entry.detail ? '  ' + entry.detail : '');
    el.tallyLog.appendChild(line);
    el.tallyLog.scrollTop = el.tallyLog.scrollHeight;
  }

  /* ---- rendering: screens -------------------------------------------- */

  function render() {
    clear(el.stage);
    if (state.screen === 'intro') renderIntro();
    else if (state.screen === 'set') renderSet();
    else if (state.screen === 'interstitial') renderInterstitial();
    else if (state.screen === 'results') renderResults();
    renderChrome();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function renderIntro() {
    var wrap = h('section', 'panel intro');
    wrap.appendChild(h('p', 'kicker', 'X-GENE SEQUENCING · 60 QUESTIONS · 6 BLOCKS'));
    wrap.appendChild(h('h1', null, 'What did the mutation make you?'));

    var p1 = h('p', 'lede', 'Sixty questions about instinct, memory, fear and preference. None of them ask what power you want. Every answer moves hidden counters across ten categories; at the end the two or three that survive get fused into one ability.');
    wrap.appendChild(p1);

    var modes = h('div', 'mode-cards');

    var m1 = h('div', 'mode-card');
    m1.appendChild(h('h3', null, 'AI-assist'));
    m1.appendChild(h('p', null, 'Unlocks a free-text box on every question, keeps a running note on you between blocks, and writes a full custom ability at the end.'));
    m1.appendChild(h('p', 'mode-state', state.aiMode ? 'ON' : 'OFF'));
    m1.addEventListener('click', function () { toggleAI(); });
    modes.appendChild(m1);

    var m2 = h('div', 'mode-card');
    m2.appendChild(h('h3', null, 'Manual'));
    m2.appendChild(h('p', null, 'Pure arithmetic. Ranked scores, the synergy lookup, the resulting power and its tier — shown as the derivation it actually is.'));
    m2.appendChild(h('p', 'mode-state', state.aiMode ? 'OFF' : 'ON'));
    m2.addEventListener('click', function () { toggleAI(); });
    modes.appendChild(m2);

    wrap.appendChild(modes);

    var status = h('div', 'status-row');
    status.appendChild(h('span', 'dot dot-' + (LLM.available() ? 'ok' : 'off')));
    status.appendChild(h('span', null, 'Model access: ' + transportLabel() +
      (LLM.available() ? ' · ' + LLM.MODEL : ' · manual mode and offline fallbacks still work')));
    wrap.appendChild(status);

    if (!LLM.available()) {
      var keyRow = h('div', 'key-row');
      var input = h('input');
      input.type = 'password';
      input.placeholder = 'Paste an Anthropic API key to enable AI features in-browser';
      input.value = LLM.storedKey();
      var save = h('button', 'btn small', 'Use key');
      save.addEventListener('click', async function () {
        LLM.setKey(input.value.trim());
        await LLM.probe();
        render();
      });
      keyRow.appendChild(input);
      keyRow.appendChild(save);
      wrap.appendChild(keyRow);
      wrap.appendChild(h('p', 'fineprint', 'Stored in this browser only and sent straight to Anthropic. For anything shared, run the bundled server instead so the key stays server-side.'));
    }

    var go = h('button', 'btn primary large', 'Begin');
    go.addEventListener('click', function () {
      state.screen = 'set';
      state.setIndex = 0;
      render();
    });
    wrap.appendChild(go);

    var demoLine = h('p', 'fineprint', 'Demo toggle is top-right. It exposes every weight, the live tally, and the block summaries before they scroll past.');
    wrap.appendChild(demoLine);

    el.stage.appendChild(wrap);
  }

  function renderSet() {
    var setMeta = currentSet();
    var qs = questionsInSet(setMeta.n);

    var head = h('div', 'set-head');
    head.appendChild(h('p', 'kicker', 'BLOCK ' + setMeta.n + ' OF ' + QUESTION_SETS.length));
    head.appendChild(h('h2', null, setMeta.title));
    head.appendChild(h('p', 'caption', setMeta.caption));
    el.stage.appendChild(head);

    qs.forEach(function (q, i) {
      el.stage.appendChild(renderQuestion(q, i + 1 + (setMeta.n - 1) * 10));
    });

    // The fusion is much better when it has an ordinary life to hang on, and
    // nothing in the scored questions asks about one. Unweighted on purpose:
    // this changes no score, it only gives the final write-up something real.
    if (state.aiMode && state.setIndex === QUESTION_SETS.length - 1) {
      el.stage.appendChild(renderAnchor());
    }

    var nav = h('div', 'nav-row');

    if (state.setIndex > 0) {
      var back = h('button', 'btn ghost', '← Block ' + (setMeta.n - 1));
      back.addEventListener('click', function () {
        state.setIndex--;
        state.screen = 'set';
        render();
      });
      nav.appendChild(back);
    } else {
      nav.appendChild(h('span'));
    }

    var answered = qs.filter(function (q) {
      var a = state.answers[q.id];
      return a && ((a.selected && a.selected.length) || (a.other && a.other.text));
    }).length;

    var next = h('button', 'btn primary', state.setIndex === QUESTION_SETS.length - 1 ? 'Sequence result' : 'Continue');
    next.addEventListener('click', function () { advance(); });
    if (answered === 0) { next.disabled = true; next.title = 'Answer at least one question in this block'; }

    var count = h('span', 'nav-count', answered + ' of ' + qs.length + ' answered');
    nav.appendChild(count);
    nav.appendChild(next);
    el.stage.appendChild(nav);
  }

  function renderQuestion(q, number) {
    var card = h('article', 'q-card');
    card.dataset.qid = q.id;

    var head = h('div', 'q-head');
    head.appendChild(h('span', 'q-num', String(number).padStart(2, '0')));
    var textWrap = h('div');
    textWrap.appendChild(h('h3', 'q-text', q.text));
    if (q.hint) textWrap.appendChild(h('p', 'q-hint', q.hint));
    head.appendChild(textWrap);
    card.appendChild(head);

    var a = state.answers[q.id] || {};
    var sel = a.selected || [];

    var opts = h('div', 'opts');
    q.options.forEach(function (opt) {
      var b = h('button', 'opt' + (sel.indexOf(opt.id) !== -1 ? ' chosen' : ''));
      b.type = 'button';
      var row = h('span', 'opt-row');
      row.appendChild(h('span', 'opt-mark'));
      row.appendChild(h('span', 'opt-text', opt.text));
      b.appendChild(row);

      if (state.demoMode) {
        var chips = h('span', 'weights');
        var any = false;
        for (var k in (opt.w || {})) {
          if (!opt.w[k]) continue;
          any = true;
          chips.appendChild(h('span', 'w-chip ' + (opt.w[k] > 0 ? 'pos' : 'neg'),
            CATEGORY_BY_KEY[k].short + ' ' + sign(opt.w[k])));
        }
        for (var e in (opt.sub || {})) {
          if (!opt.sub[e]) continue;
          any = true;
          chips.appendChild(h('span', 'w-chip sub', ELEMENT_BY_KEY[e].name + ' ' + sign(opt.sub[e])));
        }
        (opt.traits || []).forEach(function (t) {
          any = true;
          chips.appendChild(h('span', 'w-chip trait', t));
        });
        if (!any) chips.appendChild(h('span', 'w-chip none', 'no weight'));
        b.appendChild(chips);
      }

      b.addEventListener('click', function () {
        Engine.toggleOption(state, q.id, opt.id);
        markSetStale(q.set);
        redrawQuestion(q);
        renderChrome();
        refreshNavCount();
      });
      opts.appendChild(b);
    });
    card.appendChild(opts);

    if (state.aiMode) card.appendChild(renderOther(q));

    return card;
  }

  function renderOther(q) {
    var wrap = h('div', 'other');
    var a = state.answers[q.id] || {};

    var ta = h('textarea', 'other-input');
    ta.rows = 2;
    ta.placeholder = 'Or say it in your own words…';
    ta.value = (a.other && a.other.text) || '';

    var status = h('div', 'other-status');
    wrap.appendChild(ta);
    wrap.appendChild(status);

    function paintStatus() {
      clear(status);
      if (otherPending[q.id]) {
        status.appendChild(h('span', 'pill working', 'reading…'));
        return;
      }
      var cur = (state.answers[q.id] || {}).other;
      if (!cur) return;
      var applied = Object.keys(cur.weights || {}).filter(function (k) { return cur.weights[k]; });
      if (!applied.length) {
        status.appendChild(h('span', 'pill', 'noted, no weight'));
      } else if (state.demoMode) {
        applied.forEach(function (k) {
          status.appendChild(h('span', 'w-chip ' + (cur.weights[k] > 0 ? 'pos' : 'neg'),
            CATEGORY_BY_KEY[k].short + ' ' + sign(cur.weights[k])));
        });
        (cur.traits || []).forEach(function (t) { status.appendChild(h('span', 'w-chip trait', t)); });
        status.appendChild(h('span', 'pill src', cur.source));
        if (cur.note) status.appendChild(h('span', 'other-note', cur.note));
      } else {
        status.appendChild(h('span', 'pill', 'noted'));
      }
    }

    ta.addEventListener('input', function () {
      var text = ta.value.trim();
      clearTimeout(otherTimers[q.id]);

      if (!text) {
        otherPending[q.id] = false;
        Engine.setOther(state, q.id, null);
        markSetStale(q.set);
        paintStatus();
        renderChrome();
        refreshNavCount();
        return;
      }

      otherPending[q.id] = true;
      paintStatus();

      otherTimers[q.id] = setTimeout(async function () {
        var result;
        try {
          if (LLM.available()) result = await LLM.scoreOther(q, selectedTextsFor(q), text);
          else result = LLM.heuristicScoreOther(text);
        } catch (e) {
          result = LLM.heuristicScoreOther(text);
          result.note = 'model unavailable — ' + result.note;
        }
        result.text = text;
        otherPending[q.id] = false;

        // The textarea may have changed while we were waiting.
        if (ta.value.trim() !== text) return;

        Engine.setOther(state, q.id, result);
        markSetStale(q.set);
        paintStatus();
        renderChrome();
        refreshNavCount();
      }, 900);
    });

    paintStatus();
    return wrap;
  }

  function renderAnchor() {
    var card = h('article', 'anchor-card');
    var head = h('div', 'q-head');
    head.appendChild(h('span', 'q-num', '—'));
    var wrap = h('div');
    wrap.appendChild(h('h3', 'q-text', 'Before it resolves: anything about your actual life?'));
    wrap.appendChild(h('p', 'q-hint', 'What you do, where you spend your time, a habit, something that happened. Optional, and worth nothing — it scores zero. It only gives the result something real to sit in.'));
    head.appendChild(wrap);
    card.appendChild(head);

    var ta = h('textarea', 'other-input anchor-input');
    ta.rows = 3;
    ta.placeholder = 'e.g. night shifts at a warehouse, two cats, haven\'t slept properly since March…';
    ta.value = state.anchor || '';
    ta.addEventListener('input', function () {
      state.anchor = ta.value;
      state.result = null;
    });
    card.appendChild(ta);
    return card;
  }

  function redrawQuestion(q) {
    var old = el.stage.querySelector('[data-qid="' + q.id + '"]');
    if (!old) return;
    var number = QUESTIONS.indexOf(q) + 1;
    var fresh = renderQuestion(q, number);
    old.parentNode.replaceChild(fresh, old);
  }

  function refreshNavCount() {
    var node = el.stage.querySelector('.nav-count');
    if (!node) return;
    var qs = questionsInSet(currentSet().n);
    var answered = qs.filter(function (q) {
      var a = state.answers[q.id];
      return a && ((a.selected && a.selected.length) || (a.other && a.other.text));
    }).length;
    node.textContent = answered + ' of ' + qs.length + ' answered';
    var next = el.stage.querySelector('.nav-row .btn.primary');
    if (next) next.disabled = answered === 0;
  }

  function markSetStale(n) {
    if (state.notes[n]) state.notes[n].stale = true;
    state.result = null;
  }

  /* ---- interstitial (block summary) ----------------------------------- */

  function renderInterstitial() {
    var setMeta = currentSet();
    var note = state.notes[setMeta.n];
    var p = Engine.profile(state);
    var block = p.perSet[setMeta.n];

    var wrap = h('section', 'panel interstitial');
    wrap.appendChild(h('p', 'kicker', 'NOTEPAD · AFTER BLOCK ' + setMeta.n));
    wrap.appendChild(h('h2', null, setMeta.title));

    var obs = h('blockquote', 'observation');
    obs.appendChild(h('p', null, note ? note.observation : '…'));
    obs.appendChild(h('span', 'pill src', note ? note.source : 'pending'));
    wrap.appendChild(obs);

    var deltas = h('div', 'delta-grid');
    deltas.appendChild(h('h4', null, 'This block contributed'));
    var any = false;
    CATEGORY_KEYS.forEach(function (k) {
      if (!block.cats[k]) return;
      any = true;
      deltas.appendChild(h('span', 'w-chip ' + (block.cats[k] > 0 ? 'pos' : 'neg'),
        CATEGORY_BY_KEY[k].name + ' ' + sign(block.cats[k])));
    });
    if (!any) deltas.appendChild(h('span', 'muted-sm', 'nothing'));
    wrap.appendChild(deltas);

    var running = h('div', 'delta-grid');
    running.appendChild(h('h4', null, 'Running order'));
    p.order.slice(0, 5).forEach(function (r, i) {
      running.appendChild(h('span', 'w-chip ' + (i === 0 ? 'pos' : ''),
        (i + 1) + '. ' + CATEGORY_BY_KEY[r.key].name + ' ' + r.value));
    });
    wrap.appendChild(running);

    var nav = h('div', 'nav-row');
    var back = h('button', 'btn ghost', '← Change answers');
    back.addEventListener('click', function () { state.screen = 'set'; render(); });
    nav.appendChild(back);
    nav.appendChild(h('span'));

    var go = h('button', 'btn primary',
      state.setIndex === QUESTION_SETS.length - 1 ? 'Sequence result' : 'Block ' + (setMeta.n + 1) + ' →');
    go.addEventListener('click', function () { proceedFromInterstitial(); });
    nav.appendChild(go);
    wrap.appendChild(nav);

    el.stage.appendChild(wrap);
  }

  /* ---- flow ----------------------------------------------------------- */

  async function ensureNote(setMeta) {
    var existing = state.notes[setMeta.n];
    if (existing && !existing.stale) return existing;

    var p = Engine.profile(state);
    var qs = questionsInSet(setMeta.n);
    var qa = qs.map(function (q) {
      var a = state.answers[q.id] || {};
      return {
        question: q.text,
        chose: selectedTextsFor(q),
        typed: (a.other && a.other.text) || null
      };
    }).filter(function (r) { return r.chose.length || r.typed; });

    var priorNotes = QUESTION_SETS
      .filter(function (s) { return s.n < setMeta.n && state.notes[s.n]; })
      .map(function (s) { return state.notes[s.n].observation; });

    var note;
    if (state.aiMode && LLM.available() && qa.length) {
      try {
        note = await LLM.setNote(setMeta, qa, priorNotes);
      } catch (e) {
        note = LLM.heuristicSetNote(setMeta, p.perSet[setMeta.n]);
      }
    } else {
      note = LLM.heuristicSetNote(setMeta, p.perSet[setMeta.n]);
    }

    note.stale = false;
    state.notes[setMeta.n] = note;
    return note;
  }

  async function advance() {
    if (state.busy) return;
    var setMeta = currentSet();

    setBusy(true, 'Reading block ' + setMeta.n + '…');
    await ensureNote(setMeta);
    setBusy(false);

    if (state.demoMode) {
      state.screen = 'interstitial';
      render();
    } else {
      await proceedFromInterstitial();
    }
  }

  async function proceedFromInterstitial() {
    if (state.setIndex < QUESTION_SETS.length - 1) {
      state.setIndex++;
      state.screen = 'set';
      render();
      return;
    }
    await finish();
  }

  function setBusy(on, label) {
    state.busy = on;
    el.busy.classList.toggle('show', on);
    if (label) el.busyText.textContent = label;
  }

  async function finish() {
    setBusy(true, 'Fusing…');

    var profile = Engine.profile(state);
    var seed = Synergy.compose(profile);

    var result = {
      profile: profile,
      seed: seed,
      power: null,
      powerSource: 'manual'
    };

    if (state.aiMode && LLM.available()) {
      var payload = buildFusionPayload(profile, seed);
      try {
        result.power = await LLM.fusePower(payload);
        result.powerSource = 'ai';
      } catch (e) {
        result.power = null;
        result.powerSource = 'manual';
        result.error = String(e.message || e);
      }
    }

    state.result = result;
    state.screen = 'results';
    setBusy(false);
    render();
  }

  function buildFusionPayload(profile, seed) {
    return {
      tier: profile.tier.name,
      tier_meaning: TIER_NOTES[profile.tier.key],
      reality_allowed: profile.realityAllowed,

      top_categories: profile.shortlist.map(function (r, i) {
        return {
          rank: i + 1,
          category: CATEGORY_BY_KEY[r.key].name,
          covers: CATEGORY_BY_KEY[r.key].blurb,
          score: r.value
        };
      }),

      full_ranking: profile.order.map(function (r) {
        return CATEGORY_BY_KEY[r.key].name + ': ' + r.value;
      }),

      dropped_categories: profile.dropped.map(function (r) {
        return CATEGORY_BY_KEY[r.key].name + ' (' + r.value + ', below gate)';
      }),

      elemental_bias: profile.element
        ? { element: profile.elementName, score: profile.subs[profile.element] }
        : null,

      recurring_traits: profile.traits.slice(0, 12).map(function (t) {
        return t.tag + (t.n > 1 ? ' (×' + t.n + ')' : '');
      }),

      block_notes: QUESTION_SETS
        .filter(function (s) { return state.notes[s.n]; })
        .map(function (s) {
          return { block: s.title, note: state.notes[s.n].observation };
        }),

      their_life: (state.anchor || '').trim() || null,

      their_own_words: QUESTIONS
        .filter(function (q) {
          var a = state.answers[q.id];
          return a && a.other && a.other.text;
        })
        .map(function (q) {
          return { question: q.text, answered: state.answers[q.id].other.text };
        }),

      skeleton: {
        note: 'A deterministic lookup produced by the scoring engine. Use it only to see WHICH two categories fuse and roughly how they interlock. Do not reuse its name or its phrasing — write something sharper and specific to this person.',
        fusion: seed.name,
        mechanism: seed.line,
        modifier: seed.modifier
      }
    };
  }

  /* ---- results -------------------------------------------------------- */

  function renderResults() {
    var r = state.result;
    if (!r) { state.screen = 'intro'; render(); return; }

    var p = r.profile;
    var wrap = h('section', 'results');

    if (r.power) {
      wrap.appendChild(renderPowerCard(r, p));
      wrap.appendChild(renderMath(r, p, true));
    } else {
      if (r.error) {
        var warn = h('div', 'panel warn');
        warn.appendChild(h('p', null, 'The fusion model was unreachable (' + r.error + '). Falling back to the deterministic readout.'));
        wrap.appendChild(warn);
      }
      wrap.appendChild(renderMath(r, p, false));
    }

    var nav = h('div', 'nav-row');
    var back = h('button', 'btn ghost', '← Revisit answers');
    back.addEventListener('click', function () {
      state.screen = 'set';
      state.setIndex = QUESTION_SETS.length - 1;
      render();
    });
    nav.appendChild(back);
    nav.appendChild(h('span'));
    var again = h('button', 'btn', 'Start over');
    again.addEventListener('click', function () {
      if (!confirm('Clear all sixty answers and start again?')) return;
      state.answers = {};
      state.notes = {};
      state.anchor = '';
      state.result = null;
      state.setIndex = 0;
      state.screen = 'intro';
      render();
    });
    nav.appendChild(again);
    wrap.appendChild(nav);

    el.stage.appendChild(wrap);
  }

  function renderPowerCard(r, p) {
    var pw = r.power;
    var card = h('section', 'panel power');

    card.appendChild(h('p', 'kicker', 'CLASSIFICATION · ' + p.tier.name.toUpperCase() + ' TIER'));
    card.appendChild(h('h1', 'power-name', pw.name));
    card.appendChild(h('p', 'power-who', pw.who));
    card.appendChild(h('p', 'power-body', pw.power));
    card.appendChild(h('p', 'power-sting', pw.sting));

    var tier = h('div', 'power-tier');
    tier.appendChild(h('span', 'tier-badge tier-' + p.tier.key, p.tier.name));
    tier.appendChild(h('span', 'tier-note', pw.tier_note));
    card.appendChild(tier);

    var read = h('div', 'power-read');
    read.appendChild(h('h4', null, 'Why this one'));
    read.appendChild(h('p', null, pw.read));
    card.appendChild(read);

    return card;
  }

  function renderMath(r, p, collapsible) {
    var seed = r.seed;
    var box = h('section', 'panel math');

    if (collapsible) {
      var toggle = h('button', 'math-toggle', 'Show the arithmetic ▾');
      var body = h('div', 'math-body hidden');
      toggle.addEventListener('click', function () {
        var hidden = body.classList.toggle('hidden');
        toggle.textContent = hidden ? 'Show the arithmetic ▾' : 'Hide the arithmetic ▴';
      });
      box.appendChild(toggle);
      fillMath(body, r, p, seed);
      box.appendChild(body);
      return box;
    }

    fillMath(box, r, p, seed);
    return box;
  }

  function fillMath(target, r, p, seed) {
    target.appendChild(h('p', 'kicker', 'DETERMINISTIC READOUT'));

    var table = h('div', 'score-table');
    p.order.forEach(function (row, i) {
      var line = h('div', 'score-line' + (row.value <= 0 ? ' dim' : ''));
      line.appendChild(h('span', 'sl-rank', String(i + 1)));
      line.appendChild(h('span', 'sl-name', CATEGORY_BY_KEY[row.key].name));
      var barWrap = h('span', 'sl-bar');
      var bar = h('span', 'sl-fill');
      var maxV = Math.max(1, p.order[0].value);
      bar.style.width = Math.max(0, Math.round(100 * row.value / maxV)) + '%';
      barWrap.appendChild(bar);
      line.appendChild(barWrap);
      line.appendChild(h('span', 'sl-val', String(row.value)));
      table.appendChild(line);
    });
    target.appendChild(table);

    var derive = h('div', 'derivation');
    derive.appendChild(h('h4', null, 'Derivation'));
    var ol = h('ol');
    seed.derivation.forEach(function (d) { ol.appendChild(h('li', null, d)); });
    if (!p.realityAllowed && p.realityScore > 0) {
      ol.appendChild(h('li', null, 'Reality held at ' + p.realityScore + ' of ' + TUNING.REALITY_GATE +
        ' required — excluded from the fusion.'));
    }
    var topName = p.shortlist[0] ? CATEGORY_BY_KEY[p.shortlist[0].key].name : '—';
    ol.appendChild(h('li', null,
      'Strength ' + (p.shortlist[0] ? p.shortlist[0].value : 0) + ' of a possible ' +
      Math.round(p.tier.ceiling) + ' for ' + topName + ' = ' +
      Math.round(p.tier.strength * 100) + '% → ' + p.tier.name + ' tier.'));
    derive.appendChild(ol);
    target.appendChild(derive);

    var verdict = h('div', 'verdict');
    var top = p.shortlist;
    var sentence = 'You scored highest in ' + (top[0] ? CATEGORY_BY_KEY[top[0].key].name : '—');
    if (top[1]) sentence += ', followed by ' + CATEGORY_BY_KEY[top[1].key].name;
    if (top[2]) sentence += ' and ' + CATEGORY_BY_KEY[top[2].key].name;
    sentence += '.';
    verdict.appendChild(h('p', 'verdict-line', sentence));
    verdict.appendChild(h('p', 'verdict-power',
      'Result — ' + seed.name + ': ' + seed.line + (seed.modifier ? '; ' + seed.modifier : '') + '.'));
    verdict.appendChild(h('p', 'verdict-tier',
      'Rated ' + p.tier.name + '. ' + TIER_NOTES[p.tier.key]));
    target.appendChild(verdict);

    if (Object.keys(state.notes).length) {
      var notes = h('div', 'notes-block');
      notes.appendChild(h('h4', null, 'Block notes'));
      QUESTION_SETS.forEach(function (s) {
        if (!state.notes[s.n]) return;
        var n = h('div', 'note-line');
        n.appendChild(h('span', 'note-tag', s.title));
        n.appendChild(h('span', null, state.notes[s.n].observation));
        notes.appendChild(n);
      });
      target.appendChild(notes);
    }

    if (p.traits.length) {
      var tw = h('div', 'derivation');
      tw.appendChild(h('h4', null, 'Trait tags'));
      var chips = h('div');
      p.traits.slice(0, 16).forEach(function (t) {
        chips.appendChild(h('span', 'trait-chip', t.tag + (t.n > 1 ? ' ×' + t.n : '')));
      });
      tw.appendChild(chips);
      target.appendChild(tw);
    }
  }

  /* ---- toggles -------------------------------------------------------- */

  function toggleAI() {
    state.aiMode = !state.aiMode;
    render();
  }
  function toggleDemo() {
    state.demoMode = !state.demoMode;
    render();
  }

  /* ---- boot ----------------------------------------------------------- */

  async function init() {
    el.stage = $('#stage');
    el.progressFill = $('#progress-fill');
    el.progressText = $('#progress-text');
    el.aiToggle = $('#toggle-ai');
    el.demoToggle = $('#toggle-demo');
    el.tallyCats = $('#tally-cats');
    el.tallySubs = $('#tally-subs');
    el.tallyTraits = $('#tally-traits');
    el.tallyMeta = $('#tally-meta');
    el.tallyLog = $('#tally-log');
    el.busy = $('#busy');
    el.busyText = $('#busy-text');

    el.aiToggle.addEventListener('click', toggleAI);
    el.demoToggle.addEventListener('click', toggleDemo);
    LLM.onLog(appendSignal);

    await LLM.probe();
    render();
  }

  return { init: init, state: state };
})();

document.addEventListener('DOMContentLoaded', App.init);
