# Part 107 Quiz

Free FAA Part 107 (remote pilot) practice tests — a full 60-question weighted mock exam, topic drills, and plain-English study guides.

**Live site:** https://part107quiz.com

- 110+ original exam-style questions, every answer explained with its FAA/CFR reference
- Mock exam mirrors the real test: 60 questions, 120-minute timer, official FAA area weighting
- Zero-dependency static site: no frameworks, no build step, no external requests by default
- Not affiliated with or endorsed by the FAA

## Structure

- `bank.js` — the question bank (single source of truth, topic-tagged)
- `quiz.js` — shared quiz engine (topic mode + weighted mock mode)
- `config.js` — the only file to touch to enable revenue features (ads/email/products)
- `tools/` — QC gate (`qc_bank.py`) and PDF factory (`build_free_mock_pdf.py`)
