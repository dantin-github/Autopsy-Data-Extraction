"""Audit Trail tab — CaseRegistry audit log as dataframe (plan S5.1 / S5.2)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

import pandas as pd
import streamlit as st

from services.gateway_client import GatewayError, GatewayTransportError, get_gateway_client

_LIMIT_OPTIONS = [10, 50, 100, 500]
_AUDIT_APPLIED_LIMIT = "_audit_applied_limit"
_AUDIT_APPLIED_SINCE_ISO = "_audit_applied_since_iso"


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


def _local_naive_to_utc_iso_z(dt: datetime) -> str:
    """Interpret naive *dt* as local wall time; return UTC ISO 8601 ending in Z."""
    local_tz = datetime.now(timezone.utc).astimezone().tzinfo
    if local_tz is None:
        aware = dt.replace(tzinfo=timezone.utc)
    else:
        aware = dt.replace(tzinfo=local_tz)
    utc = aware.astimezone(timezone.utc)
    return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _utc_iso_z_to_naive_local(iso_z: str) -> datetime:
    s = iso_z.strip().replace("Z", "+00:00")
    aware_utc = datetime.fromisoformat(s)
    return aware_utc.astimezone().replace(tzinfo=None)


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
        "so block heights stay consistent with the current ledger."
    )

    if _AUDIT_APPLIED_LIMIT not in st.session_state:
        st.session_state[_AUDIT_APPLIED_LIMIT] = 50
        st.session_state[_AUDIT_APPLIED_SINCE_ISO] = None

    applied_lim = int(st.session_state[_AUDIT_APPLIED_LIMIT])
    applied_since = st.session_state[_AUDIT_APPLIED_SINCE_ISO]
    lim_index = (
        _LIMIT_OPTIONS.index(applied_lim) if applied_lim in _LIMIT_OPTIONS else 1
    )

    if applied_since:
        default_local = _utc_iso_z_to_naive_local(str(applied_since))
    else:
        default_local = datetime.now().replace(second=0, microsecond=0)

    with st.form("audit_trail_filters", clear_on_submit=False):
        c1, c2 = st.columns([1, 2])
        with c1:
            limit = st.selectbox(
                "Row limit",
                options=_LIMIT_OPTIONS,
                index=lim_index,
                help="Maximum rows returned after filtering (gateway cap 500).",
            )
        with c2:
            use_since = st.checkbox(
                "Only events on or after (local time)",
                value=applied_since is not None,
                help="When enabled, start time is converted to UTC ISO 8601 for the API.",
            )
            since_local = st.datetime_input(
                "Start time",
                value=default_local,
                disabled=not use_since,
            )
        submitted = st.form_submit_button("Apply filters")

    if submitted:
        st.session_state[_AUDIT_APPLIED_LIMIT] = int(limit)
        if use_since:
            st.session_state[_AUDIT_APPLIED_SINCE_ISO] = _local_naive_to_utc_iso_z(
                since_local
            )
        else:
            st.session_state[_AUDIT_APPLIED_SINCE_ISO] = None

    lim = int(st.session_state[_AUDIT_APPLIED_LIMIT])
    since_param = st.session_state[_AUDIT_APPLIED_SINCE_ISO]
    cap = f"Active filters: **{lim}** rows"
    if since_param:
        cap += f" · since **{since_param}** (UTC)"
    else:
        cap += " · no start-time filter"
    st.caption(cap)

    try:
        data = get_gateway_client().get_audit(
            limit=lim,
            since=str(since_param).strip() if since_param else None,
        )
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
    items: list[Mapping[str, Any]] = raw_items if isinstance(raw_items, list) else []

    if len(items) == 0:
        st.info(
            "No audit rows returned for these filters. "
            "Widen the time window, raise the row limit, or run a propose → approve → "
            "execute flow with the gateway event listener enabled."
        )
        return

    rows = [_flatten_audit_item(x) for x in items if isinstance(x, Mapping)]
    df = pd.DataFrame(rows)
    st.dataframe(df, use_container_width=True, hide_index=True)
