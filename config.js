/* ============================================================
   Part 107 Quiz — site configuration
   This is the ONLY file you need to touch to turn on revenue.
   ------------------------------------------------------------
   siteUrl       : canonical origin (no trailing slash)
   adsenseClient : Google AdSense publisher id, e.g. "ca-pub-1234...".
                   Leave "" until AdSense approves this site. When set,
                   Auto Ads load on every page. Also update /ads.txt!
   email         : MailerLite embedded form (PUBLIC ids, not secrets).
                   mlAccount = account id digits, mlForm = form code.
                   When both set, the signup form on /free-mock-exam-pdf.html
                   goes live. Until then the page falls back to a direct
                   download so it is useful from day one.
   products      : paste store URLs (Ko-fi/Payhip) to light up paid CTAs.
                   Empty string = CTA hidden (no broken links).
   ============================================================ */
window.P107_CONFIG = {
  siteUrl: "https://part107quiz.com",
  adsenseClient: "",
  email: {
    mlAccount: "",
    mlForm: ""
  },
  products: {
    bankPdfUrl: ""
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
