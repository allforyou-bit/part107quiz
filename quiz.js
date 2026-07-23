/* ============================================================
   Part 107 Quiz — shared quiz engine
   Reads:
     window.P107_BANK  (bank.js — full question bank, topic-tagged)
     window.QUIZ_PAGE  (set inline per page):
       { mode: "topic", topics: ["regulations"], title: "..." }
       { mode: "mock",  title: "..." }   // 60-Q weighted, 120-min timer
   Renders into #quiz-root.
   Options are re-shuffled every attempt (no positional memorization).
   ============================================================ */
(function () {
  "use strict";

  var PASS_PCT = 70;

  /* FAA initial UAG knowledge-test area weights → 60-question mock */
  var MOCK_PLAN = [
    { area: "Regulations",            topics: ["regulations"],                              n: 12 },
    { area: "Airspace & Requirements",topics: ["airspace"],                                 n: 12 },
    { area: "Weather",                topics: ["weather"],                                  n: 8  },
    { area: "Loading & Performance",  topics: ["loading-performance"],                      n: 5  },
    { area: "Operations",             topics: ["operations", "night-operations", "remote-id"], n: 23 }
  ];
  var MOCK_MINUTES = 120;

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function areaOf(topic) {
    for (var i = 0; i < MOCK_PLAN.length; i++) {
      if (MOCK_PLAN[i].topics.indexOf(topic) !== -1) return MOCK_PLAN[i].area;
    }
    return "Operations";
  }

  function buildQuestionSet(page, bank) {
    var qs;
    if (page.mode === "mock") {
      qs = [];
      var used = {};
      MOCK_PLAN.forEach(function (plan) {
        var pool = shuffle(bank.filter(function (q) {
          return plan.topics.indexOf(q.topic) !== -1 && !used[q.id];
        }));
        pool.slice(0, plan.n).forEach(function (q) { used[q.id] = 1; qs.push(q); });
      });
      /* backfill if any pool ran short */
      if (qs.length < 60) {
        var rest = shuffle(bank.filter(function (q) { return !used[q.id]; }));
        qs = qs.concat(rest.slice(0, 60 - qs.length));
      }
      qs = shuffle(qs);
    } else {
      qs = shuffle(bank.filter(function (q) {
        return page.topics.indexOf(q.topic) !== -1;
      }));
    }
    /* per-attempt option shuffle, remap answer index */
    return qs.map(function (q) {
      var idx = shuffle([0, 1, 2, 3]);
      return {
        id: q.id, topic: q.topic, area: areaOf(q.topic),
        q: q.q,
        options: idx.map(function (k) { return q.options[k]; }),
        answer: idx.indexOf(q.answer),
        exp: q.exp, ref: q.ref
      };
    });
  }

  /* ---------- state ---------- */
  var root, page, set, cur, picks, feedbackMode, timerId, deadline;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function letter(i) { return ["A", "B", "C", "D"][i]; }

  function storageKey() {
    return "p107-best-" + (page.mode === "mock" ? "mock" : page.topics.join("-"));
  }

  /* ---------- screens ---------- */
  function renderStart() {
    root.innerHTML = "";
    var shell = el("div", "quiz-shell");
    var n = set.length;
    var best = null;
    try { best = localStorage.getItem(storageKey()); } catch (e) {}
    shell.appendChild(el("h2", null, page.title));
    var info = page.mode === "mock"
      ? "60 questions &middot; " + MOCK_MINUTES + "-minute timer &middot; FAA topic weighting &middot; pass mark " + PASS_PCT + "%"
      : n + " questions &middot; instant feedback with explanations &middot; pass mark " + PASS_PCT + "%";
    shell.appendChild(el("p", "quiz-note", info + (best ? " &middot; Your best: <strong>" + best + "%</strong>" : "")));
    var acts = el("div", "quiz-actions");
    var b = el("button", "btn btn-primary", page.mode === "mock" ? "Start Mock Exam" : "Start Practice Test");
    b.onclick = start;
    acts.appendChild(b);
    shell.appendChild(acts);
    shell.appendChild(el("p", "quiz-note", "Free forever. No sign-up needed. Answer choices are shuffled on every attempt, exactly like the real exam experience at a PSI test center."));
    root.appendChild(shell);
  }

  function start() {
    set = buildQuestionSet(page, window.P107_BANK);
    cur = 0; picks = new Array(set.length).fill(null);
    feedbackMode = page.mode !== "mock";
    if (page.mode === "mock") {
      deadline = Date.now() + MOCK_MINUTES * 60 * 1000;
      timerId = setInterval(tick, 1000);
    }
    renderQ();
  }

  function tick() {
    var left = deadline - Date.now();
    if (left <= 0) { clearInterval(timerId); finish(); return; }
    var t = document.getElementById("qtimer");
    if (t) {
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      t.textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
      if (left < 10 * 60 * 1000) t.classList.add("low");
    }
  }

  function renderQ() {
    root.innerHTML = "";
    var q = set[cur];
    var shell = el("div", "quiz-shell");

    var top = el("div", "quiz-topbar");
    top.appendChild(el("span", "qcount", "Question " + (cur + 1) + " / " + set.length));
    if (page.mode === "mock") {
      var t = el("span", "qtimer", "--:--");
      t.id = "qtimer";
      top.appendChild(t);
    } else {
      top.appendChild(el("span", "qcount", q.area));
    }
    shell.appendChild(top);

    var prog = el("div", "progress"); var bar = el("div");
    bar.style.width = ((cur) / set.length * 100).toFixed(1) + "%";
    prog.appendChild(bar); shell.appendChild(prog);

    shell.appendChild(el("div", "qtext", q.q));

    var opts = el("div", "opts");
    q.options.forEach(function (o, i) {
      var b = el("button", "opt");
      b.appendChild(el("span", "letter", letter(i) + "."));
      b.appendChild(el("span", null, o));
      b.onclick = function () { pick(i, b, opts); };
      opts.appendChild(b);
    });
    shell.appendChild(opts);

    var acts = el("div", "quiz-actions");
    acts.id = "q-acts";
    shell.appendChild(acts);
    root.appendChild(shell);
  }

  function pick(i, btn, optsEl) {
    var q = set[cur];
    if (feedbackMode) {
      if (picks[cur] !== null) return; /* already answered */
      picks[cur] = i;
      var buttons = optsEl.querySelectorAll(".opt");
      buttons.forEach(function (b, k) {
        b.disabled = true;
        if (k === q.answer) b.classList.add("correct");
        else if (k === i) b.classList.add("wrong");
      });
      var ex = el("div", "explain",
        (i === q.answer ? "<strong>Correct.</strong> " : "<strong>Not quite.</strong> The answer is " + letter(q.answer) + ". ") +
        q.exp + '<span class="ref">Reference: ' + q.ref + "</span>");
      optsEl.parentNode.insertBefore(ex, document.getElementById("q-acts"));
      var acts = document.getElementById("q-acts");
      var nb = el("button", "btn btn-blue", cur === set.length - 1 ? "See Results" : "Next Question");
      nb.onclick = next;
      acts.appendChild(nb);
    } else {
      picks[cur] = i;
      var bs = optsEl.querySelectorAll(".opt");
      bs.forEach(function (b) { b.classList.remove("sel"); });
      btn.classList.add("sel");
      var acts2 = document.getElementById("q-acts");
      if (!acts2.firstChild) {
        var nb2 = el("button", "btn btn-blue", cur === set.length - 1 ? "Finish Exam" : "Next Question");
        nb2.onclick = next;
        acts2.appendChild(nb2);
      }
    }
  }

  function next() {
    if (cur === set.length - 1) { finish(); return; }
    cur++; renderQ();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function finish() {
    if (timerId) clearInterval(timerId);
    var right = 0, byArea = {};
    set.forEach(function (q, k) {
      var a = byArea[q.area] || { n: 0, ok: 0 };
      a.n++;
      if (picks[k] === q.answer) { right++; a.ok++; }
      byArea[q.area] = a;
    });
    var pct = Math.round(right / set.length * 100);
    var pass = pct >= PASS_PCT;
    try {
      var prev = parseInt(localStorage.getItem(storageKey()) || "0", 10);
      if (pct > prev) localStorage.setItem(storageKey(), String(pct));
    } catch (e) {}

    root.innerHTML = "";
    var shell = el("div", "quiz-shell");
    var ring = el("div", "score-ring");
    ring.appendChild(el("div", "score-big " + (pass ? "pass" : "fail"), pct + "%"));
    ring.appendChild(el("div", "verdict " + (pass ? "pass" : "fail"),
      pass ? "PASS — at or above the FAA " + PASS_PCT + "% pass mark" : "Below the " + PASS_PCT + "% pass mark — keep practicing"));
    ring.appendChild(el("p", "quiz-note", "You answered " + right + " of " + set.length + " correctly."));
    shell.appendChild(ring);

    var bd = el("div", "breakdown");
    Object.keys(byArea).forEach(function (area) {
      var a = byArea[area];
      var row = el("div", "row");
      row.appendChild(el("span", "area", area));
      row.appendChild(el("span", null, a.ok + " / " + a.n + " (" + Math.round(a.ok / a.n * 100) + "%)"));
      bd.appendChild(row);
    });
    shell.appendChild(bd);

    /* CTA — free lead magnet always; paid bank only when URL configured */
    var cfg = window.P107_CONFIG || {};
    var cta = el("div", "cta-box");
    cta.appendChild(el("h3", null, pass ? "Ready to lock it in before test day?" : "Want a structured way to close the gap?"));
    cta.appendChild(el("p", null, "Download the free 50-question practice exam PDF with a full answer key and explanations — study anywhere, no internet needed."));
    var wrap = el("div");
    var dl = el("a", "btn btn-primary", "Get the Free 50-Question PDF");
    dl.href = (page.base || ".") + "/free-mock-exam-pdf.html";
    wrap.appendChild(dl);
    if (cfg.products && cfg.products.bankPdfUrl) {
      var buy = el("a", "btn btn-ghost", "Get the Complete Question Bank");
      buy.href = cfg.products.bankPdfUrl;
      buy.target = "_blank"; buy.rel = "noopener";
      wrap.appendChild(buy);
    }
    cta.appendChild(wrap);
    shell.appendChild(cta);

    /* review of misses */
    var wrong = [];
    set.forEach(function (q, k) { if (picks[k] !== q.answer) wrong.push({ q: q, you: picks[k] }); });
    if (wrong.length) {
      shell.appendChild(el("h3", null, "Review your " + wrong.length + " missed question" + (wrong.length > 1 ? "s" : "")));
      wrong.forEach(function (w) {
        var it = el("div", "review-item");
        it.appendChild(el("div", "rq", w.q.q));
        if (w.you !== null && w.you !== undefined) {
          it.appendChild(el("div", "ra you", "Your answer: " + letter(w.you) + ". " + w.q.options[w.you]));
        } else {
          it.appendChild(el("div", "ra you", "Your answer: (not answered)"));
        }
        it.appendChild(el("div", "ra key", "Correct: " + letter(w.q.answer) + ". " + w.q.options[w.q.answer]));
        it.appendChild(el("div", "rx", w.q.exp + " — " + w.q.ref));
        shell.appendChild(it);
      });
    }

    var acts = el("div", "quiz-actions");
    var again = el("button", "btn btn-blue", "Try Again (new shuffle)");
    again.onclick = function () { start(); window.scrollTo(0, 0); };
    acts.appendChild(again);
    shell.appendChild(acts);
    root.appendChild(shell);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- boot ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    root = document.getElementById("quiz-root");
    page = window.QUIZ_PAGE;
    if (!root || !page || !window.P107_BANK) return;
    set = buildQuestionSet(page, window.P107_BANK); /* for count on start screen */
    renderStart();
  });
})();
