/* ============================================================
   Part 107 Quiz — site configuration
   This is the ONLY file you need to touch to turn on revenue.
   ------------------------------------------------------------
   siteUrl       : canonical origin (no trailing slash)
   adsenseClient : Google AdSense publisher id, e.g. "ca-pub-1234...".
                   Leave "" until AdSense shows this site as Ready. The review
                   does not need this script: AdSense verifies a site through
                   ads.txt (already live) or a meta tag. When set, Auto Ads
                   load on every page.
   email         : MailerLite embedded form (PUBLIC ids, not secrets).
                   mlAccount = account id digits, mlForm = form code.
                   When both set, the signup form on /free-mock-exam-pdf.html
                   goes live. Until then the page falls back to a direct
                   download so it is useful from day one.
   products      : paste store URLs (Ko-fi/Payhip) to light up paid CTAs.
                   Empty string = CTA hidden (no broken links).
                   premiumUrl opens premium.html's buy buttons and adds the
                   Premium Pack to every quiz/mock result card (quiz.js).
   ============================================================ */
window.P107_CONFIG = {
  siteUrl: "https://part107quiz.com",
  adsenseClient: "",
  email: {
    mlAccount: "",
    mlForm: ""
  },
  products: {
    /* Premium Pack v1.2 (5 mock exams + 385-question bank + 56 chart image
       questions, CA$29; Ko-fi file swapped 2026-10-06).
       Paste the Ko-fi/Payhip product URL to open the store —
       premium.html shows "coming soon" until this is set. */
    premiumUrl: "https://ko-fi.com/s/b74b8f7ec3"
  }
};

/* AdSense Auto Ads loader — inert until adsenseClient is set. */
(function () {
  var c = window.P107_CONFIG;
  if (!c.adsenseClient) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + c.adsenseClient;
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
})();
