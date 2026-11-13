# -*- coding: utf-8 -*-
"""Site chrome for every page (v2 design, 2026-11-12): brand mark, footer, favicon.

  py -3.12 tools/site_chrome.py          rewrite the pages in place (idempotent)
  py -3.12 tools/site_chrome.py --check  exit 1 if any page is out of date

What it touches, and nothing else:
  - the brand link in the header (and in the footer): the emoji glyph becomes the
    inline SVG mark below; the nav links next to it are left exactly as they are
    (their order, data-cta tags and per-page variants are the pages' own)
  - the footer's link block: rebuilt as four columns; the page's own legal
    paragraphs (FAA or Transport Canada wording, tooling note) are kept verbatim
  - the favicon <link>: the emoji data URI becomes favicon.svg
Paths are written relative to the page (./ at the root, ../ in study-guide/),
except pages that already use root-absolute paths (404.html).
"""
import glob, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MARK = ('<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
        '<rect width="32" height="32" rx="8" fill="#0a2540"/>'
        '<path d="M10.5 10.5l11 11M21.5 10.5l-11 11" stroke="#8cc4f2" stroke-width="2.2" stroke-linecap="round"/>'
        '<g fill="none" stroke="#fff" stroke-width="1.8"><circle cx="9" cy="9" r="4.2"/><circle cx="23" cy="9" r="4.2"/>'
        '<circle cx="9" cy="23" r="4.2"/><circle cx="23" cy="23" r="4.2"/></g>'
        '<rect x="13" y="13" width="6" height="6" rx="1.6" fill="#f5a524"/></svg>')
BRAND_INNER = MARK + ' <span class="brand-word">Part 107 <span class="tail">Quiz</span></span>'

FAVICON_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
               '<rect width="32" height="32" rx="8" fill="#0a2540"/>'
               '<path d="M10.5 10.5l11 11M21.5 10.5l-11 11" stroke="#8cc4f2" stroke-width="2.2" stroke-linecap="round"/>'
               '<g fill="none" stroke="#fff" stroke-width="1.8"><circle cx="9" cy="9" r="4.2"/><circle cx="23" cy="9" r="4.2"/>'
               '<circle cx="9" cy="23" r="4.2"/><circle cx="23" cy="23" r="4.2"/></g>'
               '<rect x="13" y="13" width="6" height="6" rx="1.6" fill="#f5a524"/></svg>\n')

FOOT_BLURB = "Free practice tests and plain-English study guides for the FAA Part 107 remote pilot knowledge test."

FOOT_COLS = [
    ("Practice", [
        ("mock-exam.html", "Part 107 mock exam", None),
        ("regulations.html", "Regulations", None),
        ("airspace.html", "Airspace", None),
        ("weather.html", "Weather", None),
        ("operations.html", "Operations", None),
        ("chart-image-practice.html", "Sectional chart images", None),
        ("metar-taf-decoder.html", "METAR &amp; TAF decoder", None),
    ]),
    ("Study", [
        ("study-guide/", "Study guide", None),
        ("study-guide/how-to-get-part-107-license.html", "How to get your certificate", None),
        ("free-mock-exam-pdf.html", "Free 50-question PDF", None),
        ("premium.html", "Part 107 Premium Pack", "footer_premium"),
        ("canada-drone-pilot-exam.html", "Canada drone pilot exam", None),
        ("private-pilot-knowledge-test.html", "Private pilot (PAR) test", None),
    ]),
    ("Site", [
        ("", "Home", None),
        ("about.html", "About", None),
        ("contact.html", "Contact", None),
        ("privacy.html", "Privacy", None),
        ("terms.html", "Terms", None),
    ]),
]

BRAND_RE = re.compile(r'<a class="brand" href="([^"]*)"(?: aria-label="[^"]*")?>.*?</a>(?=\s*(?:<div class="nav-links">|</nav>|</div>|<p))', re.S)
FOOTER_RE = re.compile(r'<footer class="site-footer">.*?</footer>', re.S)
LEGAL_RE = re.compile(r'<p class="legal"[^>]*>.*?</p>', re.S)
FAVICON_RE = re.compile(r'<link rel="icon" href="[^"]*"[^>]*>')  # the old href was a data URI holding an <svg>: match to the closing quote


def pages():
    out = sorted(glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "study-guide", "*.html")))
    return [p for p in out if not os.path.basename(p).startswith("google")]


def prefix_for(path, html):
    if 'href="/styles.css"' in html:
        return "/"
    return "../" if os.path.basename(os.path.dirname(path)) == "study-guide" else "./"


def footer(R, legal):
    cols = []
    for title, links in FOOT_COLS:
        lis = []
        for href, label, cta in links:
            attr = ' data-cta="%s"' % cta if cta else ""
            lis.append('<li><a%s href="%s%s">%s</a></li>' % (attr, R, href, label))
        cols.append('    <div class="foot-col"><h4>%s</h4><ul>\n      %s\n    </ul></div>' % (title, "\n      ".join(lis)))
    return ('<footer class="site-footer"><div class="container">\n'
            '  <div class="foot-grid">\n'
            '    <div class="foot-brand">\n'
            '      <a class="brand" href="%s">%s</a>\n'
            '      <p>%s</p>\n'
            '    </div>\n'
            '%s\n'
            '  </div>\n'
            '  <div class="foot-bottom">\n  %s\n  </div>\n'
            '</div></footer>') % (R, BRAND_INNER, FOOT_BLURB, "\n".join(cols), "\n  ".join(legal))


def render(path, html):
    R = prefix_for(path, html)
    # header brand
    hdr = re.search(r'<header class="site-header">.*?</header>', html, re.S)
    if hdr:
        new_hdr = BRAND_RE.sub(lambda m: '<a class="brand" href="%s" aria-label="Part 107 Quiz home">%s</a>' % (m.group(1), BRAND_INNER), hdr.group(0), count=1)
        html = html[:hdr.start()] + new_hdr + html[hdr.end():]
    # footer
    f = FOOTER_RE.search(html)
    if f:
        legal = LEGAL_RE.findall(f.group(0))
        if not legal:
            raise SystemExit("%s: footer without a legal paragraph" % path)
        html = html[:f.start()] + footer(R, legal) + html[f.end():]
    # favicon
    html = FAVICON_RE.sub('<link rel="icon" href="%sfavicon.svg" type="image/svg+xml">' % R, html, count=1)
    return html


def main():
    check = "--check" in sys.argv
    stale = []
    fav = os.path.join(ROOT, "favicon.svg")
    if not os.path.exists(fav) or io.open(fav, encoding="utf-8").read() != FAVICON_SVG:
        stale.append("favicon.svg")
        if not check:
            io.open(fav, "w", encoding="utf-8", newline="\n").write(FAVICON_SVG)
    for p in pages():
        html = io.open(p, encoding="utf-8").read()
        new = render(p, html)
        if new != html:
            stale.append(os.path.relpath(p, ROOT))
            if not check:
                io.open(p, "w", encoding="utf-8", newline="\n").write(new)
    if check:
        print("stale:", stale if stale else "none")
        sys.exit(1 if stale else 0)
    print("updated %d file(s)" % len(stale))


if __name__ == "__main__":
    main()
