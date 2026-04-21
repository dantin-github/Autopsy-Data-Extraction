"""Verification report payloads for export (Phase S3.6 JSON, S3.7 PDF)."""

from __future__ import annotations

import re
import textwrap
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

_CHAIN_KEYS = (
    "indexHash",
    "recordHash",
    "blockNumber",
    "txHash",
    "caseRegistryTxHash",
)
_INTEGRITY_KEYS = (
    "recordHashMatch",
    "aggregateHashValid",
    "recordHashLocal",
    "recordHashOnChain",
)


def _utc_now_iso_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def safe_report_slug(case_id: Any) -> str:
    """Filesystem-friendly fragment from ``caseId``."""
    s = str(case_id or "case").strip() or "case"
    s = re.sub(r"[^\w\-.]", "_", s)
    return s[:100] if len(s) > 100 else s


def verification_report_json_filename(case_id: Any, verified_at_iso_z: str) -> str:
    """
    ``verification_report_<caseId>_<ts>.json`` — ``ts`` derived from ISO Zulu time (no ``:``).
    """
    safe = safe_report_slug(case_id)
    ts = verified_at_iso_z.strip()
    if len(ts) >= 20 and "T" in ts:
        d, rest = ts.split("T", 1)
        d_compact = d.replace("-", "")
        time_part = rest.rstrip("Z")[:8] if rest else ""
        t_compact = time_part.replace(":", "")
        ts_compact = f"{d_compact}T{t_compact}Z"
    else:
        ts_compact = re.sub(r"[^\dTZz]", "", ts) or "time"
    return f"verification_report_{safe}_{ts_compact}.json"


def build_verification_report_json(
    query_response: Mapping[str, Any],
    *,
    verified_at: Optional[str] = None,
    verified_by: Optional[str] = None,
) -> dict[str, Any]:
    """
    Normalized report dict for ``json.dumps`` / downstream validators.

    Fields: ``caseId``, ``chain``, ``integrity``, ``record``, ``verifiedAt``, ``verifiedBy``.
    """
    ts = verified_at if verified_at else _utc_now_iso_z()
    chain_in = query_response.get("chain")
    integrity_in = query_response.get("integrity")
    chain_out: dict[str, Any] = {}
    if isinstance(chain_in, dict):
        for k in _CHAIN_KEYS:
            if k in chain_in and chain_in[k] is not None:
                chain_out[k] = chain_in[k]
    int_out: dict[str, Any] = {}
    if isinstance(integrity_in, dict):
        for k in _INTEGRITY_KEYS:
            if k in integrity_in:
                int_out[k] = integrity_in[k]
    return {
        "caseId": query_response.get("caseId"),
        "chain": chain_out,
        "integrity": int_out,
        "record": query_response.get("record"),
        "verifiedAt": ts,
        "verifiedBy": (verified_by or "").strip(),
    }


def verification_report_pdf_filename(case_id: Any, verified_at_iso_z: str) -> str:
    """``verification_report_<caseId>_<ts>.pdf`` (same stem as JSON)."""
    return verification_report_json_filename(case_id, verified_at_iso_z).replace(
        ".json", ".pdf"
    )


def build_verification_report_pdf(
    query_response: Mapping[str, Any],
    *,
    verified_at: Optional[str] = None,
    verified_by: Optional[str] = None,
    version: str = "1.0.0",
) -> bytes:
    """
    Printable **white** PDF (Phase S3.7): title block, two-column facts, integrity ✓/✗ line,
    record snapshot, footer with issuer and time.
    """
    from io import BytesIO
    from xml.sax.saxutils import escape

    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Flowable,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    report = build_verification_report_json(
        query_response,
        verified_at=verified_at,
        verified_by=verified_by,
    )
    case_id = report.get("caseId")
    chain = report.get("chain") or {}
    integrity = report.get("integrity") or {}
    record = report.get("record")
    v_at = report.get("verifiedAt") or ""
    v_by = report.get("verifiedBy") or ""

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=22 * mm,
        bottomMargin=16 * mm,
        title="Evidence Verification Report",
    )
    W, H = A4
    accent = HexColor("#3dd6f5")
    muted = HexColor("#64748b")

    class _ShieldIcon(Flowable):
        """Small black-outline shield for the cover row (B&W-print friendly)."""

        width = 26
        height = 30

        def draw(self) -> None:
            c = self.canv
            c.saveState()
            c.setStrokeColor(colors.black)
            c.setLineWidth(1)
            w, h = self.width, self.height
            p = c.beginPath()
            p.moveTo(w / 2, h - 1)
            p.lineTo(1.5, h * 0.52)
            p.lineTo(1.5, h * 0.22)
            p.lineTo(w / 2, 2)
            p.lineTo(w - 1.5, h * 0.22)
            p.lineTo(w - 1.5, h * 0.52)
            p.close()
            c.drawPath(p, stroke=1, fill=0)
            c.restoreState()

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        name="EvTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.black,
        spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        name="EvSub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=11,
        leading=14,
        textColor=muted,
        spaceAfter=2,
    )
    lbl_style = ParagraphStyle(
        name="EvLbl",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=muted,
    )
    val_style = ParagraphStyle(
        name="EvVal",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=13,
        textColor=colors.black,
    )
    mono_style = ParagraphStyle(
        name="EvMono",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=8.5,
        leading=11,
        textColor=colors.black,
    )
    integ_style = ParagraphStyle(
        name="EvInteg",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.black,
    )

    def _p(text: str, style: ParagraphStyle) -> Paragraph:
        return Paragraph(escape(str(text or "")).replace("\n", "<br/>"), style)

    def _mono_paragraph(
        raw: Any,
        *,
        max_chars: int = 4000,
        wrap_width: int = 82,
    ) -> Paragraph:
        """
        Monospace cell safe for Table layouts: hard-wrap long unbroken strings (JSON / hex)
        so ReportLab does not compute a runaway row height.
        """
        s = str(raw if raw is not None else "")
        if not s.strip():
            return Paragraph("—", mono_style)
        if len(s) > max_chars:
            s = s[:max_chars] + "…"
        lines = textwrap.wrap(
            s,
            width=wrap_width,
            break_long_words=True,
            break_on_hyphens=False,
        )
        if not lines:
            return Paragraph(escape(s[:200]), mono_style)
        inner = "<br/>".join(escape(line) for line in lines)
        return Paragraph(inner, mono_style)

    def _integrity_line(label: str, ok: Any) -> Paragraph:
        if ok is True:
            sym = "✓"
            tail = " Yes."
        elif ok is False:
            sym = "✗"
            tail = " No."
        else:
            sym = "?"
            tail = " Unknown."
        html = (
            f'{escape(label)} <b>{sym}</b>{escape(tail)}'
        )
        return Paragraph(html, integ_style)

    story: list = []
    # Two-row header (avoid KeepTogether inside a Table cell — breaks on page splits).
    hdr_tbl = Table(
        [
            [_ShieldIcon(), _p("Evidence Verification Report", title_style)],
            [Spacer(32, 2), _p(f"Case ID: {case_id}", sub_style)],
        ],
        colWidths=[32, doc.width - 32],
    )
    hdr_tbl.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(hdr_tbl)
    story.append(Spacer(1, 10 * mm))

    rows_body: list[list] = []
    rows_body.append(
        [_p("Index hash", lbl_style), _mono_paragraph(chain.get("indexHash") or "—")]
    )
    rows_body.append(
        [_p("Record hash", lbl_style), _mono_paragraph(chain.get("recordHash") or "—")]
    )
    if chain.get("txHash"):
        rows_body.append(
            [_p("Transaction hash (CRUD)", lbl_style), _mono_paragraph(chain.get("txHash"))]
        )
    if chain.get("caseRegistryTxHash"):
        rows_body.append(
            [
                _p("Case registry tx", lbl_style),
                _mono_paragraph(chain.get("caseRegistryTxHash")),
            ]
        )
    if chain.get("blockNumber") is not None:
        rows_body.append(
            [_p("Block number", lbl_style), _p(str(chain.get("blockNumber")), val_style)]
        )

    story.append(_p("On-chain", lbl_style))
    t_on = Table(rows_body, colWidths=[38 * mm, doc.width - 38 * mm])
    t_on.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LINEABOVE", (0, 0), (-1, 0), 0.25, muted),
                ("LINEBELOW", (0, -1), (-1, -1), 0.25, HexColor("#e2e8f0")),
            ]
        )
    )
    story.append(t_on)
    story.append(Spacer(1, 6 * mm))

    story.append(_p("Chain of custody", lbl_style))
    rh = integrity.get("recordHashMatch")
    agg = integrity.get("aggregateHashValid")
    rows_i = [
        [
            _integrity_line("Record hash matches on-chain record (CaseRegistry when set):", rh),
        ],
        [
            _integrity_line("Aggregate hash verification:", agg),
        ],
    ]
    t_i = Table(rows_i, colWidths=[doc.width])
    t_i.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("BOX", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e1")),
            ]
        )
    )
    story.append(t_i)
    story.append(Spacer(1, 6 * mm))

    story.append(_p("Record snapshot", lbl_style))
    if isinstance(record, dict):
        r_rows = [
            [_p("case_id", lbl_style), _p(record.get("case_id") or "—", val_style)],
            [_p("examiner", lbl_style), _p(record.get("examiner") or "—", val_style)],
            [_p("created_at", lbl_style), _mono_paragraph(record.get("created_at") or "—")],
            [
                _p("aggregate_hash", lbl_style),
                _mono_paragraph(record.get("aggregate_hash") or "—"),
            ],
        ]
        cj = record.get("case_json")
        if cj is not None:
            r_rows.append(
                [_p("case_json", lbl_style), _mono_paragraph(str(cj), max_chars=6000)]
            )
        t_r = Table(r_rows, colWidths=[34 * mm, doc.width - 34 * mm])
    else:
        t_r = Table(
            [[_p("(no record)", val_style)]],
            colWidths=[doc.width],
        )
    t_r.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LINEBELOW", (0, -1), (-1, -1), 0.25, HexColor("#e2e8f0")),
            ]
        )
    )
    story.append(t_r)

    if isinstance(integrity, dict):
        story.append(Spacer(1, 5 * mm))
        story.append(_p("Hash comparison (integrity payload)", lbl_style))
        h_rows = []
        if "recordHashLocal" in integrity:
            h_rows.append(
                [
                    _p("recordHashLocal", lbl_style),
                    _mono_paragraph(integrity.get("recordHashLocal") or "—"),
                ]
            )
        if "recordHashOnChain" in integrity:
            h_rows.append(
                [
                    _p("recordHashOnChain", lbl_style),
                    _mono_paragraph(integrity.get("recordHashOnChain") or "—"),
                ]
            )
        if h_rows:
            t_h = Table(h_rows, colWidths=[40 * mm, doc.width - 40 * mm])
            t_h.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 2),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ]
                )
            )
            story.append(t_h)

    def _draw_header_line(canvas: Any, _doc: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(accent)
        canvas.setLineWidth(2)
        canvas.line(18 * mm, H - 8 * mm, W - 18 * mm, H - 8 * mm)
        canvas.restoreState()

    def _draw_footer(canvas: Any, _doc: Any) -> None:
        canvas.saveState()
        canvas.setFont("Courier", 8)
        canvas.setFillColor(HexColor("#475569"))
        foot = (
            f"Generated by judge-web v{version} — verified by {v_by or '—'} — {v_at}"
        )
        canvas.drawCentredString(W / 2, 12 * mm, foot)
        canvas.restoreState()

    def _on_page(canvas: Any, doc_: Any) -> None:
        _draw_header_line(canvas, doc_)
        _draw_footer(canvas, doc_)

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    out = buf.getvalue()
    buf.close()
    return out
