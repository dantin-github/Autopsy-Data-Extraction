"""
Regenerate Phase S7.1 artifacts under this directory:

- samples/verification_report.json + .pdf (same shape as live gateway + judge-web export)
- screens/*.png — labeled placeholders for thesis captures (replace with real UI shots)

Run from any cwd:

  pip install -r docs/evidence/judge-web/requirements-build.txt
  python docs/evidence/judge-web/build_evidence_artifacts.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
JUDGE_WEB = REPO / "judge-web"
SAMPLES = ROOT / "samples"
SCREENS = ROOT / "screens"
NETWORK = ROOT / "network"

# Representative gateway /query body — English-only strings (product rule).
SAMPLE_QUERY_RESPONSE: dict = {
    "caseId": "thesis-appendix-sample-001",
    "chain": {
        "indexHash": "0" * 64,
        "recordHash": "f" * 64,
        "blockNumber": 128,
        "txHash": "0x" + "1" * 64,
        "caseRegistryTxHash": "0x" + "2" * 64,
    },
    "integrity": {
        "recordHashMatch": True,
        "aggregateHashValid": True,
        "recordHashLocal": "f" * 64,
        "recordHashOnChain": "f" * 64,
    },
    "record": {
        "case_id": "thesis-appendix-sample-001",
        "examiner": "demo-examiner",
        "created_at": "2026-04-20T12:00:00Z",
        "aggregate_hash": "a" * 64,
        "case_json": {
            "note": "Appendix sample — replace field values after exporting from a live gateway session if required.",
        },
    },
}

SCREEN_SPECS: list[tuple[str, str]] = [
    ("login.png", "Login — judge username / password; gateway session cookie held by Streamlit."),
    ("role-gate-police-rejected.png", "Role gate — police OTP rejected at dashboard (HTTP 403 from gateway)."),
    ("query-ok.png", "Query tab — green integrity badges; indexHash / recordHash visible."),
    ("query-tampered-diff.png", "Query tab — tampered local record: diff / red integrity state."),
    ("report-json-sample.png", "Query tab — JSON verification report download control (or saved file open in editor)."),
    ("report-pdf-rendered.png", "PDF verification report opened in viewer (white letterhead layout)."),
    ("judicial-pending.png", "Judicial Review — Pending proposal list / detail."),
    ("judicial-approved.png", "Judicial Review — Approve outcome; tx hash / block if returned."),
    ("judicial-rejected.png", "Judicial Review — Reject outcome with reason."),
    ("audit-normal.png", "Audit Trail — table populated; manual refresh."),
    ("audit-open-in-review.png", "Audit Trail — open row / deep link into Judicial Review context."),
]


def _ensure_judge_web_on_path() -> None:
    p = str(JUDGE_WEB.resolve())
    if p not in sys.path:
        sys.path.insert(0, p)


def _write_samples() -> None:
    _ensure_judge_web_on_path()
    from services.report_builder import (
        build_verification_report_json,
        build_verification_report_pdf,
    )

    SAMPLES.mkdir(parents=True, exist_ok=True)
    verified_at = "2026-04-20T12:00:00Z"
    verified_by = "appendix-build-script"
    report = build_verification_report_json(
        SAMPLE_QUERY_RESPONSE,
        verified_at=verified_at,
        verified_by=verified_by,
    )
    json_path = SAMPLES / "verification_report.json"
    json_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    pdf_bytes = build_verification_report_pdf(
        SAMPLE_QUERY_RESPONSE,
        verified_at=verified_at,
        verified_by=verified_by,
    )
    (SAMPLES / "verification_report.pdf").write_bytes(pdf_bytes)
    print(f"Wrote {json_path} and verification_report.pdf")


def _write_placeholder_screens() -> None:
    from PIL import Image, ImageDraw, ImageFont

    SCREENS.mkdir(parents=True, exist_ok=True)
    w, h = 1280, 720
    bg = (15, 23, 42)
    fg = (226, 232, 240)
    accent = (61, 214, 245)
    for filename, caption in SCREEN_SPECS:
        img = Image.new("RGB", (w, h), bg)
        draw = ImageDraw.Draw(img)
        try:
            title_font = ImageFont.truetype("arial.ttf", 28)
            body_font = ImageFont.truetype("arial.ttf", 18)
        except OSError:
            title_font = ImageFont.load_default()
            body_font = ImageFont.load_default()
        stem = filename.replace(".png", "").replace("-", " ").title()
        draw.rectangle([0, 0, w, 6], fill=accent)
        draw.text((40, 40), "Judge Web — thesis evidence placeholder", fill=accent, font=title_font)
        draw.text((40, 90), stem, fill=fg, font=title_font)
        # Word-wrap caption
        max_w = w - 80
        lines: list[str] = []
        words = caption.split()
        line = ""
        for word in words:
            test = f"{line} {word}".strip()
            bbox = draw.textbbox((0, 0), test, font=body_font)
            if bbox[2] - bbox[0] <= max_w:
                line = test
            else:
                if line:
                    lines.append(line)
                line = word
        if line:
            lines.append(line)
        y = 160
        for ln in lines:
            draw.text((40, y), ln, fill=fg, font=body_font)
            y += 26
        draw.text(
            (40, h - 48),
            "Replace this file with a real Streamlit screenshot before final thesis submission.",
            fill=(100, 116, 139),
            font=body_font,
        )
        out = SCREENS / filename
        img.save(out, "PNG")
        print(f"Wrote {out}")


def _sync_har() -> None:
    sample = NETWORK / "approve-flow.sample.har"
    final = NETWORK / "approve-flow.har"
    if not sample.is_file():
        print(f"Skip HAR copy: missing {sample}", file=sys.stderr)
        return
    shutil.copyfile(sample, final)
    print(f"Copied {sample.name} -> {final.name}")


def main() -> None:
    _write_samples()
    _write_placeholder_screens()
    _sync_har()


if __name__ == "__main__":
    main()
