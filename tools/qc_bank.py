#!/usr/bin/env python3
"""
qc_bank.py — Part107Quiz question-bank QC gate.
Port of the RedSeal RUNBOOK discipline: the site does not ship unless ALL PASS.

Checks:
  1. bank.js parses as strict JSON, schema valid
  2. no duplicate ids / duplicate (normalized) question text
  3. exactly 4 options per question, all unique, answer index valid
  4. explanation >= 40 chars and reference present
  5. topic counts match the published site copy
  6. source answer-key distribution within 15-35% per letter
  7. "longest option is correct" tell below 40%
  8. banned phrases (all/none of the above, guarantees)
  9. mock-exam pools can fill the FAA-weighted 60-question draw
 10. local link integrity across all HTML pages

Exit 0 = ALL PASS. Exit 1 = failures listed.
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, "bank.js")

EXPECTED_TOPICS = {
    "regulations": 41, "airspace": 38, "weather": 20,
    "loading-performance": 15, "operations": 46,
    "night-operations": 10, "remote-id": 10,
}
MOCK_NEEDS = [
    (["regulations"], 12), (["airspace"], 12), (["weather"], 8),
    (["loading-performance"], 5),
    (["operations", "night-operations", "remote-id"], 23),
]
BANNED = ["all of the above", "none of the above", "guaranteed to pass",
          "you will pass", "100% pass"]

fails, warns = [], []

def fail(msg): fails.append(msg)
def warn(msg): warns.append(msg)

# ---- 1. parse ----
raw = open(BANK, encoding="utf-8").read()
m = re.search(r"window\.P107_BANK\s*=\s*(\[.*\]);", raw, re.S)
if not m:
    print("FAIL: cannot locate JSON array in bank.js"); sys.exit(1)
try:
    bank = json.loads(m.group(1))
except json.JSONDecodeError as e:
    print(f"FAIL: bank.js JSON parse error: {e}"); sys.exit(1)

# ---- 2-4. per-question schema ----
ids, seen_text = set(), {}
for q in bank:
    qid = q.get("id", "?")
    for field in ("id", "topic", "q", "options", "answer", "exp", "ref"):
        if field not in q:
            fail(f"{qid}: missing field '{field}'")
    if qid in ids:
        fail(f"duplicate id: {qid}")
    ids.add(qid)
    norm = re.sub(r"[^a-z0-9]+", " ", q.get("q", "").lower()).strip()
    if norm in seen_text:
        fail(f"{qid}: duplicate question text of {seen_text[norm]}")
    seen_text[norm] = qid
    opts = q.get("options", [])
    if len(opts) != 4:
        fail(f"{qid}: {len(opts)} options (need 4)")
    if len(set(o.strip().lower() for o in opts)) != len(opts):
        fail(f"{qid}: duplicate options")
    ans = q.get("answer", -1)
    if not isinstance(ans, int) or not (0 <= ans <= 3):
        fail(f"{qid}: bad answer index {ans}")
    if len(q.get("exp", "")) < 40:
        fail(f"{qid}: explanation too short")
    if not q.get("ref", "").strip():
        fail(f"{qid}: missing reference")
    if q.get("topic") not in EXPECTED_TOPICS:
        fail(f"{qid}: unknown topic {q.get('topic')}")
    blob = (q.get("q", "") + " " + " ".join(opts) + " " + q.get("exp", "")).lower()
    for b in BANNED:
        if b in blob:
            fail(f"{qid}: banned phrase '{b}'")

# ---- 5. topic counts ----
counts = {}
for q in bank:
    counts[q["topic"]] = counts.get(q["topic"], 0) + 1
for t, n in EXPECTED_TOPICS.items():
    if counts.get(t, 0) != n:
        fail(f"topic {t}: {counts.get(t,0)} questions, expected {n}")

# ---- 6. answer distribution ----
dist = [0, 0, 0, 0]
for q in bank:
    if isinstance(q.get("answer"), int) and 0 <= q["answer"] <= 3:
        dist[q["answer"]] += 1
total = len(bank)
for i, n in enumerate(dist):
    pct = n / total * 100
    if not (15 <= pct <= 35):
        fail(f"answer letter {'ABCD'[i]}: {pct:.1f}% of source keys (band 15-35%)")

# ---- 7. longest-option tell ----
longest_correct = sum(
    1 for q in bank
    if max(range(4), key=lambda i: len(q["options"][i])) == q["answer"]
)
tell_pct = longest_correct / total * 100
if tell_pct >= 40:
    fail(f"longest-option-is-correct tell: {tell_pct:.1f}% (must be <40%)")

# ---- 9. mock pools ----
for topics, need in MOCK_NEEDS:
    have = sum(counts.get(t, 0) for t in topics)
    if have < need:
        fail(f"mock pool {topics}: {have} < required {need}")

# ---- 10. local link integrity ----
html_files = glob.glob(os.path.join(ROOT, "*.html")) + \
             glob.glob(os.path.join(ROOT, "study-guide", "*.html"))
for hf in html_files:
    base = os.path.dirname(hf)
    txt = open(hf, encoding="utf-8").read()
    for attr, target in re.findall(r'(?:href|src)="([^"#]+?)(#[^"]*)?"', txt):
        t = attr
        if t.startswith(("http", "data:", "mailto:", "//")):
            continue
        if t.startswith("/"):  # root-absolute (404 page) — checked against ROOT
            p = os.path.join(ROOT, t.lstrip("/"))
            if t == "/":
                continue
        else:
            p = os.path.normpath(os.path.join(base, t))
        if t.endswith("/"):
            p = os.path.join(p, "index.html")
        if not os.path.exists(p):
            fail(f"{os.path.relpath(hf, ROOT)}: broken local link -> {t}")

# ---- report ----
print(f"bank: {total} questions across {len(counts)} topics")
print(f"answer distribution A/B/C/D: {dist} "
      f"({'/'.join(f'{n/total*100:.0f}%' for n in dist)})")
print(f"longest-option tell: {tell_pct:.1f}%")
for w in warns:
    print("WARN:", w)
if fails:
    print(f"\n=== {len(fails)} FAILURE(S) ===")
    for f_ in fails:
        print("FAIL:", f_)
    sys.exit(1)
print("\nALL PASS")
