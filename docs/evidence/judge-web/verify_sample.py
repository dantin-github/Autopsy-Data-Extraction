"""
Independent structural check for samples/verification_report.json (thesis appendix).

Re-imports the same normalizer as judge-web so the JSON stays consistent with S3.6.

Usage (from repo root):

  python docs/evidence/judge-web/verify_sample.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
JUDGE_WEB = REPO / "judge-web"
SAMPLE = ROOT / "samples" / "verification_report.json"

REQUIRED_TOP = ("caseId", "chain", "integrity", "record", "verifiedAt", "verifiedBy")


def main() -> int:
    if not SAMPLE.is_file():
        print(f"Missing {SAMPLE}", file=sys.stderr)
        return 2
    raw = json.loads(SAMPLE.read_text(encoding="utf-8"))
    missing = [k for k in REQUIRED_TOP if k not in raw]
    if missing:
        print(f"Missing keys: {missing}", file=sys.stderr)
        return 1

    p = str(JUDGE_WEB.resolve())
    if p not in sys.path:
        sys.path.insert(0, p)
    from services.report_builder import build_verification_report_json

    # Rebuild from embedded record shape: reverse is not unique; compare chain+integrity+record.
    chain = raw.get("chain") if isinstance(raw.get("chain"), dict) else {}
    integrity = raw.get("integrity") if isinstance(raw.get("integrity"), dict) else {}
    record = raw.get("record")
    fake_query = {
        "caseId": raw.get("caseId"),
        "chain": chain,
        "integrity": integrity,
        "record": record,
    }
    rebuilt = build_verification_report_json(
        fake_query,
        verified_at=str(raw.get("verifiedAt") or ""),
        verified_by=str(raw.get("verifiedBy") or ""),
    )
    if rebuilt != raw:
        print("Normalized report does not match file on disk.", file=sys.stderr)
        print("--- file ---", file=sys.stderr)
        print(json.dumps(raw, indent=2, sort_keys=True), file=sys.stderr)
        print("--- rebuilt ---", file=sys.stderr)
        print(json.dumps(rebuilt, indent=2, sort_keys=True), file=sys.stderr)
        return 1

    rh_ok = integrity.get("recordHashMatch") is True
    loc = integrity.get("recordHashLocal")
    onc = integrity.get("recordHashOnChain")
    if rh_ok and loc != onc:
        print(
            "recordHashMatch is True but recordHashLocal != recordHashOnChain",
            file=sys.stderr,
        )
        return 1

    print("OK: verification_report.json passes structural + round-trip checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
