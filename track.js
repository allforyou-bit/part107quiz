/* Conversion tracking for part107quiz.com
   -------------------------------------------------------------------------
   Added 2026-10-03, adapted from the sister site's track.js. The Premium Pack
   made its first sale on 2026-10-03 and the site had no analytics at all, so
   nobody could say which page, link or quiz result the buyer came through.
   GA4 property: G-CBZ8Y19RJ0 (its own property - the RedSeal one is separate
   so neither site's user counts are mixed into the other's).

   How the funnel is built on this site: the ONLY Ko-fi links are the two buy
   buttons on premium.html (their href is filled in from config.js
   products.premiumUrl at DOMContentLoaded). Every other Premium link - nav,
   footer, the quiz and mock result card, the free-PDF page, the mock-exam
   page, the cost guide, the free PDF's last page - points at premium.html,
   which explains the pack before anyone reaches the checkout. So there are
   two click events, and they are kept apart on purpose:

     buy_click       click on a ko-fi.com link (the checkout itself). Purchase
                     intent. Carries via_placement / via_page: the internal
                     link that brought this tab to premium.html, if any.
     premium_click   click on an internal link to premium.html. Interest, not
                     purchase intent - counting it as buy_click would count one
                     buyer twice (result card, then checkout button).
     offer_view      a priced offer (a Ko-fi button or an in-content Premium
                     Pack link) was at least half on screen for 1 second, once
                     per placement per page view. The nav and footer links are
                     on every page, so they are not offers here; their
                     denominator is page_view. The quiz/mock result card can
                     be shown several times in one page view (Try Again), so
                     its placement is re-armed on every finished attempt.
     mock_finished   the 60-question mock result screen was shown (quiz.js
                     dispatches "p107:finished"; one event per finished attempt)
     quiz_finished   a topic practice-test result screen was shown
     generate_lead   the free 50-question PDF was downloaded

   Parameters worth registering as GA4 event-scoped custom dimensions (GA4
   only keeps them from the day they are registered): placement, link_type,
   product, price_cad, source_page, via_placement, via_page.

   Everything is wrapped so a missing gtag, a blocked script or an unexpected
   DOM can never break the page or the quiz. ES5 only. */
(function () {
  "use strict";

  function send(name, params) {
    try {
      if (typeof window.gtag === "function") window.gtag("event", name, params || {});
    } catch (e) { /* analytics must never break the page */ }
  }

  /* Ko-fi product id -> product. The shop is shared with the sister site, so
     an unknown id is reported as "unknown", never guessed. */
  var PRODUCTS = { "b74b8f7ec3": "p107_premium" };

  /* Nav and footer appear on every page; an impression there says nothing. */
  var NOT_AN_OFFER = { "nav_premium": true, "footer_premium": true };

  var VIA_KEY = "p107_via";

  function isKofi(href) {
    return (href || "").indexOf("ko-fi.com/") !== -1;
  }

  /* ./premium.html, ../premium.html, /premium.html and the absolute
     https://part107quiz.com/premium.html - never someone else's premium.html */
  function isPremiumPage(href) {
    if (!href) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:\/\/(www\.)?part107quiz\.com\//i.test(href)) return false;
    return /(^|\/)premium\.html(?:[?#]|$)/i.test(href);
  }

  function quizResultName() {
    var qp = window.QUIZ_PAGE;
    return qp && qp.mode === "mock" ? "mock_result" : "quiz_result";
  }

  /* Where on the page the reader was when they clicked. Static links carry
     data-cta (nav_premium, footer_premium, premium_page_top,
     premium_page_bottom, free_pdf_page, mock_page, guide_cost_page) and quiz.js
     tags the result card (quiz_result / mock_result). The walk below only
     names a link someone adds later without a tag. */
  function placement(a) {
    var tag = a.getAttribute && a.getAttribute("data-cta");
    if (tag) return tag;
    var n = a, hops = 0;
    while (n && n.nodeType === 1 && n !== document.body && hops++ < 14) {
      if (n.id === "quiz-root") return quizResultName();
      var c = " " + ((typeof n.className === "string" && n.className) || "") + " ";
      if (n.tagName === "NAV" || n.tagName === "HEADER" || c.indexOf(" nav-links ") > -1) return "nav_premium";
      if (n.tagName === "FOOTER" || c.indexOf(" site-footer ") > -1) return "footer_premium";
      if (c.indexOf(" hero ") > -1) return "hero";
      if (c.indexOf(" cta-box ") > -1) return "cta_box";
      n = n.parentNode;
    }
    return "body_link";
  }

  function closestAnchor(el) {
    while (el && el.nodeType === 1) {
      if (el.tagName === "A" && el.getAttribute("href")) return el;
      el = el.parentNode;
    }
    return null;
  }

  /* Everything buy_click, premium_click and offer_view say about one anchor.
     All three read it from here, so a view and a click on the same button can
     never disagree about its placement - the click-through rate per placement
     is only meaningful if they cannot. Null for any other link. */
  function offerInfo(a) {
    var href = (a && a.getAttribute && a.getAttribute("href")) || "";
    var kind = isKofi(href) ? "kofi" : (isPremiumPage(href) ? "premium" : "");
    if (!kind) return null;
    var product = "p107_premium", linkType = "premium_page";
    if (kind === "kofi") {
      var m = href.toLowerCase().match(/ko-fi\.com\/s\/([0-9a-z]+)/);
      linkType = m ? "product" : "shop";
      product = m ? (Object.prototype.hasOwnProperty.call(PRODUCTS, m[1]) ? PRODUCTS[m[1]] : "unknown") : "shop";
    }
    /* The price is in the button text ("... - CA$29 (≈ US$21)"). One CA$
       amount is a price; none, or two different ones, report null. */
    var text = a.textContent || "";
    var prices = text.match(/CA\$\s*\d+(?:\.\d{2})?/g) || [];
    var price = null;
    for (var i = 0; i < prices.length; i++) {
      var v = parseFloat(prices[i].replace(/[^\d.]/g, ""));
      if (price === null) price = v;
      else if (v !== price) { price = null; break; }
    }
    return {
      kind: kind,
      placement: placement(a),
      link_type: linkType,
      product: product,
      price_cad: price,
      href: href
    };
  }

  function readVia() {
    try {
      var v = JSON.parse(sessionStorage.getItem(VIA_KEY) || "null");
      if (v && v.p) return v;
    } catch (e) { /* private mode, blocked storage */ }
    return null;
  }

  function saveVia(placementName, page) {
    try { sessionStorage.setItem(VIA_KEY, JSON.stringify({ p: placementName, s: page })); } catch (e) { /* ignore */ }
  }

  document.addEventListener("click", function (ev) {
    try {
      var a = closestAnchor(ev.target);
      if (!a) return;
      var href = a.getAttribute("href") || "";
      var page = location.pathname;
      var o = offerInfo(a);

      if (o && o.kind === "kofi") {
        var via = readVia();
        send("buy_click", {
          placement: o.placement,
          link_type: o.link_type,
          product: o.product,
          price_cad: o.price_cad,
          source_page: page,
          product_url: href,
          via_placement: via ? via.p : "none",
          via_page: via ? via.s : "none"
        });
        return;
      }

      if (o && o.kind === "premium") {
        send("premium_click", {
          placement: o.placement,
          price_cad: o.price_cad,
          source_page: page
        });
        /* Remember how this tab reached premium.html, so the checkout click
           there can say so. A click on premium.html's own nav link must not
           overwrite the way the visitor actually arrived. */
        if (!isPremiumPage(page)) saveVia(o.placement, page);
        return;
      }

      if (/\.pdf($|\?)/i.test(href)) {
        send("generate_lead", { source_page: page, file_name: href.split("/").pop() });
      }
    } catch (e) { /* never break the page */ }
  }, true);

  /* mock_finished / quiz_finished - from quiz.js finish(). The result card's
     placement is re-armed for offer_view, because a "Try Again" in the same
     page view shows a new card that deserves its own impression. */
  document.addEventListener("p107:finished", function (ev) {
    try {
      var d = (ev && ev.detail) || {};
      var params = { pct: d.pct, total: d.total, pass: !!d.pass, source_page: location.pathname };
      if (d.mode === "mock") {
        send("mock_finished", params);
      } else {
        params.topic = (d.topics || []).join(",");
        send("quiz_finished", params);
      }
      viewed.quiz_result = false;
      viewed.mock_result = false;
      refresh();
    } catch (e) { /* never break the quiz */ }
  });

  /* offer_view - the denominator for both click events. Fires once per
     placement per page view, when an anchor of that placement has been at
     least half on screen for DWELL_MS while the tab is in front. */
  var DWELL_MS = 1000;
  var viewed = {};    /* placement -> true once offer_view has fired */
  var io = null, infoOf = null, timers = null, onScreen = null;

  function viewFire(a) {
    var o = infoOf.get(a);
    if (!o || viewed[o.placement]) return;
    if (!document.documentElement.contains(a)) return; /* re-rendered away */
    viewed[o.placement] = true;
    send("offer_view", {
      placement: o.placement,
      link_type: o.link_type,
      product: o.product,
      price_cad: o.price_cad,
      source_page: location.pathname
    });
  }

  function arm(a) {
    if (timers.has(a) || document.hidden) return;
    timers.set(a, setTimeout(function () {
      timers["delete"](a);
      try { if (!document.hidden && onScreen.has(a)) viewFire(a); } catch (e) { /* never break the page */ }
    }, DWELL_MS));
  }

  function disarm(a) {
    if (timers.has(a)) { clearTimeout(timers.get(a)); timers["delete"](a); }
  }

  function onIntersect(entries) {
    try {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], a = e.target, o = infoOf.get(a);
        if (!o || viewed[o.placement]) { io.unobserve(a); onScreen["delete"](a); disarm(a); continue; }
        if (e.isIntersecting && e.intersectionRatio >= 0.5) { onScreen.add(a); arm(a); }
        else { onScreen["delete"](a); disarm(a); }
      }
    } catch (err) { /* never break the page */ }
  }

  /* A tab in the background is not a view: hold the clock while it is hidden
     and restart it for whatever is still on screen when it comes back. */
  function onVisibility() {
    try {
      if (document.hidden) {
        timers.forEach(function (t) { clearTimeout(t); });
        timers.clear();
      } else {
        onScreen.forEach(function (a) { arm(a); });
      }
    } catch (e) { /* never break the page */ }
  }

  function registerOffers() {
    var list = document.querySelectorAll('a[href*="ko-fi.com/"], a[href*="premium.html"]');
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (infoOf.has(a)) continue;
      var o = offerInfo(a);
      if (o && NOT_AN_OFFER[o.placement]) o = null;
      infoOf.set(a, o);
      if (o && !viewed[o.placement]) io.observe(a);
    }
  }

  var refreshTimer = 0;
  function refresh() {
    refreshTimer = 0;
    try { if (io) registerOffers(); } catch (e) { /* never break the page */ }
  }

  try {
    if (typeof window.IntersectionObserver === "function" && typeof window.WeakMap === "function" &&
        typeof window.Map === "function" && typeof window.Set === "function") {
      infoOf = new WeakMap(); timers = new Map(); onScreen = new Set();
      io = new IntersectionObserver(onIntersect, { threshold: [0.5] });
      document.addEventListener("visibilitychange", onVisibility);
    }
  } catch (e) { io = null; }

  /* The result card appears long after load, and premium.html's buy buttons
     only receive their Ko-fi href at DOMContentLoaded. Rescan when elements
     are added or an href changes - never on text-only changes such as the mock
     timer ticking every second - and at most every 250 ms. */
  function schedule() {
    if (!refreshTimer) refreshTimer = setTimeout(refresh, 250);
  }
  try {
    if (typeof window.MutationObserver === "function") {
      new MutationObserver(function (records) {
        try {
          for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (r.type === "attributes") { schedule(); return; }
            var added = r.addedNodes;
            for (var j = 0; j < added.length; j++) {
              if (added[j].nodeType === 1) { schedule(); return; }
            }
          }
        } catch (e) { /* never break the page */ }
      }).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["href"]
      });
    }
  } catch (e) { /* never break the page */ }
  try {
    document.addEventListener("DOMContentLoaded", refresh);
    window.addEventListener("load", refresh);
  } catch (e) { /* never break the page */ }
  refresh();
})();
