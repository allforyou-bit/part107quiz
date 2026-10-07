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

  /* FAA UAG test blueprint -> 60-question mock.
     Source: PSI "Unmanned Aircraft General - Small" Applicant Information
     Bulletin, effective 2025-09-29. The FAA points candidates to it in place
     of the older percentage ranges printed in FAA-S-ACS-10B:
     Regulations 48%, Airspace 20%, Weather 5%, Loading & Performance 2%,
     Operations 25%  ->  29 / 12 / 3 / 1 / 15 of 60.
     Each bank question carries the ACS area it tests in q.acs ("I".."V");
     questions without it fall back to their topic's usual area. */
  var MOCK_PLAN = [
    { area: "Regulations",             acs: "I",   n: 29 },
    { area: "Airspace & Requirements", acs: "II",  n: 12 },
    { area: "Weather",                 acs: "III", n: 3  },
    { area: "Loading & Performance",   acs: "IV",  n: 1  },
    { area: "Operations",              acs: "V",   n: 15 }
  ];
  var TOPIC_ACS = {
    "regulations": "I", "remote-id": "I", "airspace": "II", "weather": "III",
    "loading-performance": "IV", "operations": "V", "night-operations": "V"
  };
  var MOCK_MINUTES = 120;

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function acsOf(q) {
    return q.acs || TOPIC_ACS[q.topic] || "V";
  }

  function areaOf(q) {
    var code = acsOf(q);
    for (var i = 0; i < MOCK_PLAN.length; i++) {
      if (MOCK_PLAN[i].acs === code) return MOCK_PLAN[i].area;
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
          return acsOf(q) === plan.acs && !used[q.id];
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
        id: q.id, topic: q.topic, area: areaOf(q),
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

  /* ---------- screen position ---------- */
  /* Each question and the result start with the quiz card at the top of the
     screen, just under the sticky header (the offset goTo() uses on
     chart-image-practice.html). Until 2026-10-07 they scrolled to the top of
     the PAGE, so the page heading and intro came back above every question:
     at 375x812 the question text started 559-710 px down and no question had
     all its options on screen, and every result screen opened with its
     Premium Pack button off screen (810-922 px down at 1280x800, 1287-1394 px
     at 375x812). */
  function toQuiz() {
    var hdr = document.querySelector(".site-header");
    var off = hdr ? hdr.getBoundingClientRect().height : 0;
    var y = root.getBoundingClientRect().top + (window.pageYOffset || 0) - off - 12;
    try { window.scrollTo({ top: y, behavior: "smooth" }); } catch (e) { window.scrollTo(0, y); }
  }

  /* The analytics notice (#cookieBanner) is fixed to the bottom of the screen,
     above everything, until OK is pressed. On a first visit it sat on the
     lower answer options and the Next / Finish button: with real clicks it
     took 15-30 of the 74-120 option and Next clicks in a full test at 375x812,
     and 31 of 120 in the mock at 1280x800. Once a test starts it is hidden for
     the rest of this page view. Nothing is stored, so it shows again on the
     next page until OK is pressed. */
  function hideNotice() {
    var b = document.getElementById("cookieBanner");
    if (b) b.hidden = true;
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
      ? "60 questions &middot; " + MOCK_MINUTES + "-minute timer &middot; current FAA area weighting &middot; pass mark " + PASS_PCT + "%"
      : n + " questions &middot; instant feedback with explanations &middot; pass mark " + PASS_PCT + "%";
    shell.appendChild(el("p", "quiz-note", info + (best ? " &middot; Your best: <strong>" + best + "%</strong>" : "")));
    var acts = el("div", "quiz-actions");
    var b = el("button", "btn btn-primary", page.mode === "mock" ? "Start Mock Exam" : "Start Practice Test");
    b.onclick = start;
    acts.appendChild(b);
    shell.appendChild(acts);
    shell.appendChild(el("p", "quiz-note", "Free forever. No sign-up needed. Answer choices are shuffled on every attempt so you learn the concept, not the letter position."));
    root.appendChild(shell);
  }

  function start() {
    hideNotice();
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
    toQuiz();
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

    /* CTA — free lead magnet always; the Premium Pack whenever the store URL
       (products.premiumUrl) is configured. The button links to premium.html,
       which says what is in the pack before anyone reaches the checkout.
       Until 2026-09-29 this read products.bankPdfUrl, a key config.js never
       filled, so no quiz or mock result ever showed the paid option. */
    var cfg = window.P107_CONFIG || {};
    var base = page.base || ".";
    var hasPremium = !!(cfg.products && cfg.products.premiumUrl);
    var premiumFirst = hasPremium && page.mode === "mock"; /* just finished a full-length rehearsal */
    var cta = el("div", "cta-box");
    cta.appendChild(el("h3", null, premiumFirst
      ? (pass ? "Want more full-length rehearsals before test day?" : "Want more full-length practice to close the gap?")
      : (pass ? "Ready to lock it in before test day?" : "Want a structured way to close the gap?")));
    var freeText = "Download the free 50-question practice exam PDF with a full answer key and explanations — study anywhere, no internet needed.";
    var paidText = "<strong>Premium Pack:</strong> 5 full 60-question mocks + 385-question bank (212 not on this site) + 56 sectional chart image questions, CA$29 (≈ US$21). Printable PDFs, one-time purchase.";
    var dl = el("a", "btn " + (premiumFirst ? "btn-ghost" : "btn-primary"), "Get the Free 50-Question PDF");
    dl.href = base + "/free-mock-exam-pdf.html";
    var buy = null;
    if (hasPremium) {
      buy = el("a", "btn " + (premiumFirst ? "btn-primary" : "btn-ghost"), "See the Premium Pack — CA$29");
      buy.href = base + "/premium.html";
      /* placement for track.js: a mock result and a topic-test result are
         different moments and are reported separately */
      buy.setAttribute("data-cta", page.mode === "mock" ? "mock_result" : "quiz_result");
    }
    var wrap = el("div");
    if (premiumFirst) {
      cta.appendChild(el("p", null, paidText));
      cta.appendChild(el("p", null, "Or start with the free 50-question practice exam PDF — full answer key and explanations, no internet needed."));
      wrap.appendChild(buy);
      wrap.appendChild(dl);
    } else {
      cta.appendChild(el("p", null, freeText));
      if (buy) cta.appendChild(el("p", null, paidText));
      wrap.appendChild(dl);
      if (buy) wrap.appendChild(buy);
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
    again.onclick = function () { start(); }; /* renderQ() brings question 1 to the top */
    acts.appendChild(again);
    shell.appendChild(acts);
    root.appendChild(shell);

    /* Announce the finished attempt (added 2026-10-03). track.js turns this
       into mock_finished / quiz_finished; nothing listens when it is not
       loaded, and a browser without CustomEvent simply skips it. Fired once
       per finish(), after the result screen is in the DOM. */
    try {
      document.dispatchEvent(new CustomEvent("p107:finished", { detail: {
        mode: page.mode, topics: page.topics || [], pct: pct, right: right,
        total: set.length, pass: pass
      } }));
    } catch (e) { /* analytics must never break the quiz */ }

    toQuiz();
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
