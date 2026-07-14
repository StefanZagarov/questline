/* ============================================================
   QUESTLINE — map interactions (vanilla JS, no dependencies)

   What it does:
   - Quest data model (prereqs, objective types, targets)
   - Checkbox / slider / reflection inputs update progress
   - Lock-gating: quests unseal when their prereq is conquered
   - Map cards, pills, edges, drawer badges, header bar, and
     summit banner all re-render from state
   - Progress + notes persist in localStorage
   - Home page: syncs the Backend Developer card + level badge
   ============================================================ */

(function () {
  'use strict';

  /* ---------- data ---------- */

  var QUESTS = [
    { id: 'q1', prereq: null, optional: false, objectives: [
      { id: 'q1o1', type: 'check' },
      { id: 'q1o2', type: 'check' },
      { id: 'q1o3', type: 'check' },
    ]},
    { id: 'q2', prereq: 'q1', optional: false, objectives: [
      { id: 'q2o1', type: 'check' },
      { id: 'q2o2', type: 'check' },
      { id: 'q2o3', type: 'slider', target: 60 },
      { id: 'q2o4', type: 'reflect' },
    ]},
    { id: 'q3', prereq: 'q2', optional: false, objectives: [
      { id: 'q3o1', type: 'check' },
      { id: 'q3o2', type: 'slider', target: 5 },
      { id: 'q3o3', type: 'reflect' },
    ]},
    { id: 'qb', prereq: 'q3', optional: true, objectives: [
      { id: 'qbo1', type: 'check' },
      { id: 'qbo2', type: 'slider', target: 4 },
      { id: 'qbo3', type: 'reflect' },
    ]},
    { id: 'q4', prereq: 'q3', optional: false, objectives: [
      { id: 'q4o1', type: 'check' },
      { id: 'q4o2', type: 'check' },
      { id: 'q4o3', type: 'slider', target: 30 },
    ]},
    { id: 'q5', prereq: 'q4', optional: false, objectives: [
      { id: 'q5o1', type: 'check' },
      { id: 'q5o2', type: 'check' },
      { id: 'q5o3', type: 'reflect' },
    ]},
    { id: 'q6', prereq: 'q5', optional: false, objectives: [
      { id: 'q6o1', type: 'check' },
      { id: 'q6o2', type: 'check' },
      { id: 'q6o3', type: 'slider', target: 3 },
      { id: 'q6o4', type: 'reflect' },
    ]},
  ];

  var DEFAULT_PROGRESS = { q1o1: true, q1o2: true, q1o3: true, q2o1: true, q2o3: 7 };
  var DEFAULT_NOTES = { q1: 'Finally understand what actually happens between typing a URL and seeing a page.' };

  var STORE_KEY = 'questline-static';

  /* ---------- state ---------- */

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* private mode etc. — fall through */ }
    return { progress: assign({}, DEFAULT_PROGRESS), notes: assign({}, DEFAULT_NOTES) };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function assign(target, src) {
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    return target;
  }

  /* ---------- model helpers ---------- */

  function byId(id) {
    for (var i = 0; i < QUESTS.length; i++) if (QUESTS[i].id === id) return QUESTS[i];
    return null;
  }

  function isDone(obj) {
    var v = state.progress[obj.id];
    if (obj.type === 'check') return !!v;
    if (obj.type === 'slider') return typeof v === 'number' && v >= obj.target;
    return !!(v && String(v).trim());
  }

  function questDone(q) {
    return q.objectives.every(isDone);
  }

  function statusOf(q) {
    if (questDone(q)) return 'complete';
    var prereq = q.prereq ? byId(q.prereq) : null;
    return (!prereq || questDone(prereq)) ? 'open' : 'locked';
  }

  function mainQuests() {
    return QUESTS.filter(function (q) { return !q.optional; });
  }

  function stats() {
    var main = mainQuests();
    var done = main.filter(questDone).length;
    var bonus = QUESTS.filter(function (q) { return q.optional && questDone(q); }).length;
    var xp = 480 + done * 120 + bonus * 80;
    return {
      done: done,
      total: main.length,
      pct: Math.round((done / main.length) * 100),
      level: Math.floor(xp / 300) + 1,
    };
  }

  /* ---------- dom helpers ---------- */

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  /* ---------- rendering ---------- */

  var GLYPHS = { check: '▣', slider: '◄►', reflect: '✎' };

  var EDGE_COLORS = {
    both: '#4E7C43',      // prereq and quest conquered
    prereqDone: '#A87A1E', // path is walkable
    locked: '#77683F',     // target quest sealed
    idle: '#B3A47E',
  };

  function render() {
    var s = stats();
    var firstOpen = null;
    mainQuests().forEach(function (q) {
      if (!firstOpen && statusOf(q) === 'open') firstOpen = q.id;
    });

    QUESTS.forEach(function (q) {
      var st = statusOf(q);
      var locked = st === 'locked';

      /* map card */
      var card = $('[data-card="' + q.id + '"]');
      if (card) {
        card.classList.remove('qcard-done', 'qcard-open', 'qcard-locked', 'glow');
        card.classList.add(st === 'complete' ? 'qcard-done' : st === 'open' ? 'qcard-open' : 'qcard-locked');
        if (q.id === firstOpen) card.classList.add('glow');
      }

      /* pills */
      q.objectives.forEach(function (o) {
        var pill = $('[data-pill="' + o.id + '"]');
        if (!pill) return;
        var done = isDone(o);
        pill.classList.toggle('pill-done', done);
        pill.classList.toggle('pill-muted', locked);
        pill.querySelector('.glyph').textContent = done ? '✓' : GLYPHS[o.type];
      });

      /* incoming edge (from this quest's prereq) */
      var edge = $('[data-edge="' + q.id + '"]');
      if (edge && q.prereq) {
        var pDone = questDone(byId(q.prereq));
        var color = pDone && questDone(q) ? EDGE_COLORS.both
          : pDone ? EDGE_COLORS.prereqDone
          : locked ? EDGE_COLORS.locked
          : EDGE_COLORS.idle;
        edge.setAttribute('stroke', color);
      }

      /* drawer: badge, count, sealed note, objective list */
      var badge = $('[data-badge="' + q.id + '"]');
      if (badge) {
        badge.classList.remove('badge-done', 'badge-progress', 'badge-sealed');
        if (st === 'complete') { badge.textContent = '★ CONQUERED'; badge.classList.add('badge-done'); }
        else if (st === 'open') { badge.textContent = '⚑ IN PROGRESS'; badge.classList.add('badge-progress'); }
        else { badge.textContent = '⛓ SEALED'; badge.classList.add('badge-sealed'); }
      }

      var count = $('[data-count="' + q.id + '"]');
      if (count) {
        var doneCount = q.objectives.filter(isDone).length;
        count.textContent = doneCount + ' / ' + q.objectives.length + ' DONE';
      }

      var sealedNote = $('[data-sealed="' + q.id + '"]');
      if (sealedNote) sealedNote.style.display = locked ? '' : 'none';

      var objList = $('[data-objlist="' + q.id + '"]');
      if (objList) objList.classList.toggle('sealed', locked);

      /* slider value labels + target hints */
      q.objectives.forEach(function (o) {
        if (o.type !== 'slider') return;
        var input = $('input[data-obj="' + o.id + '"]');
        var val = typeof state.progress[o.id] === 'number' ? state.progress[o.id] : 0;
        var valEl = $('[data-val="' + o.id + '"]');
        var hintEl = $('[data-hint="' + o.id + '"]');
        if (valEl && input) {
          valEl.textContent = val + ' / ' + input.max;
          valEl.classList.toggle('done', val >= o.target);
        }
        if (hintEl) hintEl.textContent = val >= o.target ? 'target reached ✓' : (o.target - val) + ' to go';
      });
    });

    /* header HUD */
    var hudCount = $('[data-hud-count]');
    var hudPct = $('[data-hud-pct]');
    var hudBar = $('[data-hud-bar]');
    if (hudCount) hudCount.textContent = s.done + ' / ' + s.total + ' QUESTS';
    if (hudPct) hudPct.textContent = s.pct + '%';
    if (hudBar) hudBar.style.width = s.pct + '%';
    $$('[data-lv]').forEach(function (el) { el.textContent = 'LV ' + s.level; });

    /* summit banner */
    var summit = $('[data-summit]');
    if (summit) {
      var complete = s.done === s.total;
      summit.style.background = complete ? '#C9962E' : '';
      summit.style.color = complete ? '#241A08' : '';
      summit.style.animation = complete ? 'glowPulse 2.4s infinite' : '';
    }

    /* home page: Backend Developer card */
    var homeBar = $('[data-home-bar]');
    if (homeBar) {
      homeBar.style.width = s.pct + '%';
      var hc = $('[data-home-count]'); if (hc) hc.textContent = s.done + ' / ' + s.total + ' QUESTS';
      var hp = $('[data-home-pct]'); if (hp) hp.textContent = s.pct + '%';
    }
  }

  /* ---------- restore inputs from saved state ---------- */

  function restoreInputs() {
    $$('input[type=checkbox][data-obj]').forEach(function (el) {
      el.checked = !!state.progress[el.dataset.obj];
    });
    $$('input[type=range][data-obj]').forEach(function (el) {
      var v = state.progress[el.dataset.obj];
      el.value = typeof v === 'number' ? v : 0;
    });
    $$('textarea[data-obj]').forEach(function (el) {
      el.value = state.progress[el.dataset.obj] || '';
    });
    $$('textarea[data-note]').forEach(function (el) {
      if (state.notes[el.dataset.note] !== undefined) el.value = state.notes[el.dataset.note];
    });
  }

  /* ---------- listeners ---------- */

  function wire() {
    $$('input[type=checkbox][data-obj]').forEach(function (el) {
      el.addEventListener('change', function () {
        state.progress[el.dataset.obj] = el.checked;
        if (el.checked) toast('+ OBJECTIVE COMPLETE');
        save();
        render();
      });
    });

    $$('input[type=range][data-obj]').forEach(function (el) {
      el.addEventListener('input', function () {
        state.progress[el.dataset.obj] = Number(el.value);
        save();
        render();
      });
    });

    $$('textarea[data-obj]').forEach(function (el) {
      el.addEventListener('input', function () {
        state.progress[el.dataset.obj] = el.value;
        save();
        render();
      });
    });

    $$('textarea[data-note]').forEach(function (el) {
      el.addEventListener('input', function () {
        state.notes[el.dataset.note] = el.value;
        save();
      });
    });
  }

  restoreInputs();
  wire();
  render();
})();
