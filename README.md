# Part 107 Quiz

Free FAA Part 107 (remote pilot) practice tests — a full 60-question weighted mock exam, topic drills, and plain-English study guides.

**Live site:** https://part107quiz.com

- 170+ original exam-style questions, every answer explained with its FAA/CFR reference
- Mock exam mirrors the real test: 60 questions, 120-minute timer, official FAA area weighting
- Zero-dependency static site: no frameworks, no build step. The only external request by default is
  Google Analytics 4 (G-CBZ8Y19RJ0, added 2026-10-03; disclosed on privacy.html)
- Not affiliated with or endorsed by the FAA

## Structure

- `bank.js` — the question bank (single source of truth, topic-tagged)
- `quiz.js` — shared quiz engine (topic mode + weighted mock mode)
- `config.js` — the only file to touch to enable revenue features (ads/email/products)
- `track.js` — GA4 events: buy_click (Ko-fi), premium_click, offer_view, mock_finished, quiz_finished, generate_lead
- `tools/` — QC gate (`qc_bank.py`) and PDF factory (`build_free_mock_pdf.py`)
