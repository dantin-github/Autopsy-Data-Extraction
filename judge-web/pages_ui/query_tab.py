"""Query tab — case lookup via POST /api/query; chain-of-custody check, then on-chain + case records."""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

import streamlit as st

import config
from services.gateway_client import GatewayError, GatewayTransportError, get_gateway_client
from services.report_builder import (
    build_verification_report_json,
    build_verification_report_pdf,
    verification_report_json_filename,
    verification_report_pdf_filename,
)

_QUERY_LAST_RESULT_KEY = "query_tab_last_result"


def _clear_query_tab_result() -> None:
    """Drop cached panels so a failed submit does not leave the previous success visible."""
    st.session_state.pop(_QUERY_LAST_RESULT_KEY, None)


def _render_gateway_query_error(err: GatewayError) -> None:
    """Status-specific banners (S3.4); all copy is English."""
    status = err.status
    if status == 404:
        st.warning("Case not found in local store.")
    elif status == 503:
        st.error(
            "Chain not configured. The gateway cannot query the ledger until FISCO "
            "credentials are installed."
        )
    elif status == 400:
        st.error(f"Bad request: {err.message}")
    else:
        st.error(f"Request failed ({status}): {err.message}")


def _labeled_full_width_line(
    label: str,
    value: Any,
    *,
    missing_caption: Optional[str] = None,
) -> None:
    """Muted uppercase label; hash/value in JSON-string orange (theme.css)."""
    st.markdown(
        f'<p class="jw-onchain-field-label">{html.escape(label)}</p>',
        unsafe_allow_html=True,
    )
    s = None if value is None else str(value).strip()
    if not s:
        st.markdown(
            '<p class="jw-onchain-missing">—</p>',
            unsafe_allow_html=True,
        )
        if missing_caption:
            st.caption(missing_caption)
        return
    st.markdown(
        f'<div class="jw-onchain-hash-value">{html.escape(s)}</div>',
        unsafe_allow_html=True,
    )


def _render_query_result_blocks(data: Mapping[str, Any]) -> None:
    """Chain of Custody Check first, then on-chain records and case records."""
    chain = data.get("chain") if isinstance(data.get("chain"), dict) else {}
    record = data.get("record")
    integrity = data.get("integrity") if isinstance(data.get("integrity"), dict) else {}

    st.markdown("##### Chain of Custody Check")
    rh_match = integrity.get("recordHashMatch")
    agg_ok = integrity.get("aggregateHashValid")
    if rh_match is True:
        st.success("Record hash matches the on-chain record (CaseRegistry when configured).")
    elif rh_match is False:
        st.error("Record hash does **not** match the on-chain record.")
    else:
        st.warning("Record hash match status is unknown.")
    if integrity.get("crudRegistryOutOfSync"):
        st.info(
            "The **t_case_hash** (CRUD) row differs from **CaseRegistry** for this index. "
            "Verification uses CaseRegistry as the source of truth when CRUD lags. "
            "To align the mirror, call **POST /api/modify/sync-crud-mirror** with a **police** "
            "session and body `{\"caseId\": \"…\"}` (same as after execute when `crudSyncHint` is returned)."
        )
    if agg_ok is True:
        st.success("Aggregate hash verification passed.")
    elif agg_ok is False:
        st.error("Aggregate hash verification failed.")
    else:
        st.warning("Aggregate hash status is unknown.")

    st.markdown("##### On-chain records")
    _labeled_full_width_line("Index hash", chain.get("indexHash"))
    _labeled_full_width_line("Record hash (verification)", chain.get("recordHash"))
    if chain.get("recordHashCrud") and chain.get("recordHashRegistry"):
        crud_v = str(chain.get("recordHashCrud") or "").strip().lower()
        reg_v = str(chain.get("recordHashRegistry") or "").strip().lower()
        if crud_v and reg_v and crud_v != reg_v:
            _labeled_full_width_line("Record hash (CRUD mirror)", chain.get("recordHashCrud"))
            _labeled_full_width_line("Record hash (CaseRegistry)", chain.get("recordHashRegistry"))
    _labeled_full_width_line(
        "Transaction hash (CRUD insert)",
        chain.get("txHash"),
        missing_caption=(
            "Saved at upload time when the case row is written to the ledger. "
            "Cases created before this metadata was stored, or without a successful upload, "
            "will not show a hash here."
        ),
    )
    reg_tx = chain.get("caseRegistryTxHash")
    if reg_tx:
        _labeled_full_width_line("Case registry transaction hash", reg_tx)

    st.markdown("##### Case Records")
    if record is not None:
        # expanded=True so the tree is open; users still expand nested nodes as needed.
        st.json(record, expanded=True)
    else:
        st.info("No record payload in this response.")

    st.markdown("##### Verification report")
    st.caption(
        "Download a machine-readable snapshot of this query for records and downstream checks."
    )
    verified_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    user = st.session_state.get("user") if isinstance(st.session_state.get("user"), dict) else {}
    verified_by = str(user.get("username") or user.get("userId") or "")
    report = build_verification_report_json(
        data,
        verified_at=verified_at,
        verified_by=verified_by,
    )
    json_payload = json.dumps(report, indent=2, ensure_ascii=False)
    json_name = verification_report_json_filename(data.get("caseId"), verified_at)
    pdf_name = verification_report_pdf_filename(data.get("caseId"), verified_at)
    pdf_bytes = build_verification_report_pdf(
        data,
        verified_at=verified_at,
        verified_by=verified_by,
    )
    dc1, dc2 = st.columns(2)
    with dc1:
        st.download_button(
            "Download Report (JSON)",
            data=json_payload,
            file_name=json_name,
            mime="application/json",
            key="jw_verification_report_json",
            use_container_width=True,
        )
    with dc2:
        st.download_button(
            "Download Report (PDF)",
            data=pdf_bytes,
            file_name=pdf_name,
            mime="application/pdf",
            key="jw_verification_report_pdf",
            use_container_width=True,
        )


def render_query_tab() -> None:
    st.subheader("Query")
    st.caption(
        "Enter a case ID to load the local record, verify aggregate integrity, "
        "and compare the record hash with the on-chain row (indexed hash)."
    )

    with st.form("query_case_form", clear_on_submit=False):
        _demo = config.get_smoke_case_id()
        case_id = st.text_input(
            "Case ID",
            placeholder=f"e.g. {_demo}",
            autocomplete="off",
            key="query_case_id_input",
        )
        submitted = st.form_submit_button("Submit", type="primary")

    if submitted:
        cid = (case_id or "").strip()
        if not cid:
            _clear_query_tab_result()
            st.warning("Enter a case ID.")
        else:
            try:
                with st.spinner("Querying API gateway…"):
                    data = get_gateway_client().post_query(cid)
            except GatewayTransportError as e:
                _clear_query_tab_result()
                st.error(str(e))
            except GatewayError as e:
                _clear_query_tab_result()
                _render_gateway_query_error(e)
            else:
                st.session_state[_QUERY_LAST_RESULT_KEY] = data

    last = st.session_state.get(_QUERY_LAST_RESULT_KEY)
    if last is not None:
        _render_query_result_blocks(last)
