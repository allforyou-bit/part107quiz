#!/usr/bin/env python3
"""
build_free_mock_pdf.py — Part107Quiz lead magnet factory (reportlab).
Builds the free 50-question practice exam PDF with answer key + explanations.
Deterministic: fixed RNG seed -> same PDF on every rebuild (stable file).

Draw plan = the FAA UAG blueprint in effect since 2025-09-29 (PSI Applicant
Information Bulletin: Regulations 48%, Airspace 20%, Weather 5%, Loading &
Performance 2%, Operations 25%) scaled to 50 questions, by the ACS area each
question carries in q["acs"] (falls back to its topic's usual area):
  I 24, II 10, III 3, IV 1, V 12  = 50
"""
import json, os, random, re, sys

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate,
                                Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle, PageBreak, KeepTogether)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "downloads",
                   "part107-free-50-question-mock-exam.pdf")
SITE = "part107quiz.com"
SEED = 20260723

PLAN = [("I", 24), ("II", 10), ("III", 3), ("IV", 1), ("V", 12)]
TOPIC_ACS = {"regulations": "I", "remote-id": "I", "airspace": "II",
             "weather": "III", "loading-performance": "IV",
             "operations": "V", "night-operations": "V"}


def acs_of(q):
    return q.get("acs") or TOPIC_ACS.get(q["topic"], "V")

NAVY = colors.HexColor("#0b2545")
BLUE = colors.HexColor("#1d4e89")
SKY = colors.HexColor("#e3f1fb")
ORANGE = colors.HexColor("#fb8500")
MUTED = colors.HexColor("#5b6b82")


def load_bank():
    raw = open(os.path.join(ROOT, "bank.js"), encoding="utf-8").read()
    m = re.search(r"window\.P107_BANK\s*=\s*(\[.*\]);", raw, re.S)
    return json.loads(m.group(1))


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build():
    rng = random.Random(SEED)
    bank = load_bank()
    picked, used = [], set()
    for area, n in PLAN:
        pool = sorted([q for q in bank if acs_of(q) == area],
                      key=lambda q: q["id"])
        rng.shuffle(pool)
        for q in pool[:n]:
            used.add(q["id"])
            picked.append(q)
    assert len(picked) == 50, f"picked {len(picked)}"
    rng.shuffle(picked)

    # Place each key at a pre-balanced letter (13/13/12/12 across 50) and shuffle
    # the distractors into the other slots. A plain per-question shuffle left the
    # 2026-09-26 build at 11/18/10/11 (B = 36%), a letter bias a reader can use.
    targets = [i % 4 for i in range(len(picked))]
    rng.shuffle(targets)
    final = []
    letter_count = [0, 0, 0, 0]
    for q, ans in zip(picked, targets):
        others = [i for i in range(4) if i != q["answer"]]
        rng.shuffle(others)
        idx = others[:ans] + [q["answer"]] + others[ans:]
        opts = [q["options"][i] for i in idx]
        assert idx.index(q["answer"]) == ans
        letter_count[ans] += 1
        final.append({"q": q["q"], "opts": opts, "ans": ans,
                      "exp": q["exp"], "ref": q["ref"]})

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], textColor=NAVY,
                        fontSize=24, leading=30, spaceAfter=6)
    sub = ParagraphStyle("sub", parent=styles["Normal"], textColor=MUTED,
                         fontSize=11.5, leading=16, spaceAfter=4)
    qhead = ParagraphStyle("qhead", parent=styles["Normal"], fontSize=10.5,
                           leading=14.5, spaceBefore=10, spaceAfter=3,
                           textColor=NAVY, fontName="Helvetica-Bold")
    opt = ParagraphStyle("opt", parent=styles["Normal"], fontSize=10,
                         leading=13.5, leftIndent=18, spaceAfter=1.5)
    key = ParagraphStyle("key", parent=styles["Normal"], fontSize=9.5,
                         leading=13, spaceBefore=7, spaceAfter=2)
    keyref = ParagraphStyle("keyref", parent=key, textColor=MUTED,
                            fontSize=8.5, spaceBefore=0, leftIndent=14)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8.5,
                           leading=12, textColor=MUTED)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(0.75 * inch, 0.5 * inch,
                          f"Free Part 107 practice exam — more free tests at https://{SITE}")
        canvas.drawRightString(letter[0] - 0.75 * inch, 0.5 * inch,
                               f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(OUT, pagesize=letter,
                            leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.8 * inch, bottomMargin=0.8 * inch,
                            title="Free Part 107 Practice Exam — 50 Questions",
                            author=f"{SITE}")
    story = []

    # ---- cover / intro ----
    story.append(Paragraph("FAA Part 107 Practice Exam", h1))
    story.append(Paragraph("50 questions &bull; answer key with explanations &bull; free from "
                           f"<b>{SITE}</b>", sub))
    story.append(Spacer(1, 10))
    intro = Table([[Paragraph(
        "<b>How to use this exam:</b> give yourself 100 minutes (the real exam's pace), "
        "no notes, and circle your answers. The pass mark on the real test is 70% — "
        "35 of 50 here. Score yourself with the key at the back: every answer includes "
        "a plain-English explanation and the FAA reference behind it. "
        "Miss a topic repeatedly? Drill it free at the online practice tests.",
        ParagraphStyle("intro", parent=styles["Normal"], fontSize=10, leading=14))]],
        colWidths=[6.9 * inch])
    intro.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SKY),
        ("BOX", (0, 0), (-1, -1), 1, BLUE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(intro)
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Original questions based on public FAA source material (14 CFR Part 107, the Remote "
        "Pilot ACS, FAA study guides). Not affiliated with or endorsed by the FAA. "
        "Not actual exam questions — no one outside the FAA has those.", small))
    story.append(Spacer(1, 8))

    # ---- questions ----
    for i, q in enumerate(final, 1):
        block = [Paragraph(f"{i}. {esc(q['q'])}", qhead)]
        for k, o in enumerate(q["opts"]):
            block.append(Paragraph(f"{'ABCD'[k]}.&nbsp;&nbsp;{esc(o)}", opt))
        story.append(KeepTogether(block))

    # ---- answer key ----
    story.append(PageBreak())
    story.append(Paragraph("Answer Key &amp; Explanations", h1))
    story.append(Paragraph(
        "Score: correct ÷ 50. The FAA pass mark is 70% (35 correct). "
        f"85%+ (43 correct) means you're comfortably ready. More free practice: https://{SITE}", sub))
    story.append(Spacer(1, 6))
    for i, q in enumerate(final, 1):
        block = [
            Paragraph(f"<b>{i}. {'ABCD'[q['ans']]}</b> — {esc(q['exp'])}", key),
            Paragraph(f"Reference: {esc(q['ref'])}", keyref),
        ]
        story.append(KeepTogether(block))

    story.append(Spacer(1, 16))
    story.append(Paragraph(
        f"Want the full experience? The free online mock exam at https://{SITE} runs 60 "
        "questions against a live 120-minute timer with automatic per-area scoring — the "
        "closest thing to test day without the fee.", key))

    # ---- final page: the paid pack ----
    # Until 2026-09-29 the PDF ended on the line above and never named the
    # Premium Pack, so a reader who finished it had no way to learn the pack
    # existed. Everything before this page is unchanged by this block: the
    # questions are drawn from the seeded RNG above, before any story is built.
    story.append(PageBreak())
    story.append(Paragraph("Want more full-length practice?", h1))
    story.append(Paragraph(f"An optional paid add-on from {SITE}", sub))
    story.append(Spacer(1, 10))
    pbody = ParagraphStyle("pbody", parent=styles["Normal"], fontSize=11,
                           leading=16, spaceAfter=8)
    pbullet = ParagraphStyle("pbullet", parent=pbody, leftIndent=16,
                             bulletIndent=2, spaceAfter=6)
    ptitle = ParagraphStyle("ptitle", parent=pbody, fontName="Helvetica-Bold",
                            fontSize=14, leading=18, textColor=NAVY,
                            spaceAfter=10)
    box = Table([[[
        Paragraph("Part 107 Premium Pack", ptitle),
        Paragraph("5 more full 60-question mock exams, drawn at the FAA's area "
                  "weighting in effect since September 29, 2025. No question "
                  "repeats across the five exams.", pbullet, bulletText="•"),
        Paragraph("A 385-question study bank with the answer, a plain-English "
                  "explanation and the regulation reference under every question. "
                  "212 of those questions are not on the free site.",
                  pbullet, bulletText="•"),
        Paragraph("Printable PDFs. One-time CA$29 (about US$21), charged in "
                  "Canadian dollars. No subscription.", pbullet,
                  bulletText="•"),
    ]]], colWidths=[6.9 * inch])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SKY),
        ("BOX", (0, 0), (-1, -1), 1, BLUE),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(box)
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "Details and sample pages: "
        f'<a href="https://{SITE}/premium.html" color="#1d4e89"><u>{SITE}/premium.html</u></a>',
        pbody))
    story.append(Paragraph(
        "Checkout is on Ko-fi, under the shop name “Red Seal Exam Prep” "
        "(same publisher).", small))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Every practice test, explanation and study guide on {SITE} stays free, "
        "and so does this PDF.", small))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    dist = "/".join(str(n) for n in letter_count)
    print(f"OK {OUT}")
    print(f"answer letters A/B/C/D: {dist}")
    print(f"size: {os.path.getsize(OUT):,} bytes")


if __name__ == "__main__":
    build()
