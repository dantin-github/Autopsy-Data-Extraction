"""Audit Trail tab — CaseRegistry audit log as dataframe (plan S5.1–S5.3)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

import pandas as pd
import streamlit as st

from services.gateway_client import GatewayError, GatewayTransportError, get_gateway_client
from workspace_state import (
    PENDING_PROPOSAL_ID_KEY,
    PENDING_WORKSPACE_TAB_INDEX_KEY,
    WORKSPACE_REVIEW,
)

_AUDIT_AUTO_REFRESH_KEY = "audit_trail_auto_refresh_10s"


def _dash(v: Any) -> str:
    if v is None:
        return "—"
    s = str(v).strip()
    return s if s else "—"


def _split_iso_ts(ts_raw: str) -> tuple[str, str]:
    s = str(ts_raw or "").strip()
    if not s:
        return "—", "—"
    try:
        if s.endswith("Z"):
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        d = d.astimezone(timezone.utc)
        date_part = d.strftime("%Y-%m-%d")
        time_part = d.strftime("%H:%M:%S Z")
        return date_part, time_part
    except ValueError:
        return s, "—"


def _flatten_audit_item(item: Mapping[str, Any]) -> dict[str, Any]:
    """Map audit API row to table columns (gateway may enrich caseId, callerName, etc.)."""
    args = item.get("args") if isinstance(item.get("args"), dict) else {}
    event = str(item.get("event") or "").strip() or "—"

    raw_pid = args.get("proposalId")
    if raw_pid is None or str(raw_pid).strip() == "":
        proposal_id = "—"
    else:
        proposal_id = str(raw_pid).strip()

    caller_name = item.get("callerName")
    if caller_name is None or str(caller_name).strip() == "":
        caller = "—"
        if args.get("creator") is not None:
            caller = str(args["creator"]).strip() or "—"
        elif args.get("proposer") is not None:
            caller = str(args["proposer"]).strip() or "—"
        elif args.get("approver") is not None:
            caller = str(args["approver"]).strip() or "—"
    else:
        caller = str(caller_name).strip()

    case_id = _dash(item.get("caseId"))

    reject_raw = item.get("rejectReason")
    if event == "ProposalRejected":
        reject_reason = _dash(reject_raw)
    else:
        reject_reason = "—"

    event_date = _dash(item.get("eventDate"))
    event_time = _dash(item.get("eventTime"))
    if event_date == "—" or event_time == "—":
        ts = str(item.get("ts") or "").strip()
        if ts:
            d_part, t_part = _split_iso_ts(ts)
            if event_date == "—":
                event_date = d_part
            if event_time == "—":
                event_time = t_part

    tx_hash = str(item.get("txHash") or "").strip() or "—"
    bn = item.get("blockNumber")
    block_number = bn if bn is not None and str(bn).strip() != "" else "—"

    return {
        "Event date": event_date,
        "Event time": event_time,
        "Event": event,
        "Case ID": case_id,
        "Proposal ID": proposal_id,
        "Caller": caller,
        "Reject reason": reject_reason,
        "Tx hash": tx_hash,
        "Block": block_number,
    }


def render_audit_trail_tab() -> None:
    st.subheader("Audit Trail")
    st.caption(
        "Auditor view: recent CaseRegistry events from the gateway audit log. "
        "Rows are sorted by event time (newest first), then block height. "
        "If you reset the chain or switch networks, archive or clear `data/audit.jsonl` "
        "so block heights stay consistent with the current ledger. "
        "Default limit is 50 rows."
    )

    c_refresh, c_auto, c_live = st.columns([1, 2, 3])
    with c_refresh:
        if st.button("Refresh", type="secondary", key="audit_trail_manual_refresh"):
            st.rerun()
    with c_auto:
        st.checkbox(
            "Auto-refresh every 10s",
            key=_AUDIT_AUTO_REFRESH_KEY,
        )
    with c_live:
        if st.session_state.get(_AUDIT_AUTO_REFRESH_KEY, False):
            st.caption("Live · polling every 10s")

    def _audit_table_and_jump() -> None:
        try:
            data = get_gateway_client().get_audit(limit=50)
        except GatewayTransportError as e:
            st.error(str(e))
            return
        except GatewayError as e:
            if e.status == 401:
                st.error(
                    "Unauthorized. Sign in as a judge to load the audit trail."
                )
            else:
                st.error(f"Request failed ({e.status}): {e.message}")
            return

        raw_items = data.get("items")
        items: list[Mapping[str, Any]] = (
            raw_items if isinstance(raw_items, list) else []
        )

        st.caption(
            "Last fetched: "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC"
        )

        if len(items) == 0:
            st.info(
                "No audit rows returned. After a full propose → approve → execute flow with the "
                "gateway event listener enabled, expect at least three rows here."
            )
            return

        rows = [_flatten_audit_item(x) for x in items if isinstance(x, Mapping)]
        df = pd.DataFrame(rows)
        st.dataframe(df, use_container_width=True, hide_index=True)

        proposal_choices = sorted(
            {
                str(r.get("Proposal ID", "")).strip()
                for r in rows
                if r.get("Proposal ID") not in (None, "", "—")
            }
        )
        if proposal_choices:
            st.markdown("##### Open in Judicial Review")
            st.caption(
                "Select a proposal ID from this page, then open the Judicial Review tab "
                "with that snapshot loaded."
            )
            pick = st.selectbox(
                "Proposal ID",
                options=proposal_choices,
                key="audit_trail_jump_proposal_select",
                label_visibility="collapsed",
            )
            if st.button(
                "Open in Judicial Review", type="primary", key="audit_open_review_btn"
            ):
                st.session_state[PENDING_PROPOSAL_ID_KEY] = pick
                st.session_state[PENDING_WORKSPACE_TAB_INDEX_KEY] = WORKSPACE_REVIEW
                st.rerun()

    auto_on = bool(st.session_state.get(_AUDIT_AUTO_REFRESH_KEY, False))
    st.fragment(run_every=timedelta(seconds=10) if auto_on else None)(
        _audit_table_and_jump
    )()
