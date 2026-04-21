"""Audit Trail tab — CaseRegistry audit log as dataframe (plan S5.1)."""

from __future__ import annotations

from typing import Any, Mapping

import pandas as pd
import streamlit as st

from services.gateway_client import GatewayError, GatewayTransportError, get_gateway_client


def _flatten_audit_item(item: Mapping[str, Any]) -> dict[str, Any]:
    """Map JSONL row to plan columns: ts / event / proposalId / caller / txHash / blockNumber."""
    args = item.get("args") if isinstance(item.get("args"), dict) else {}
    event = str(item.get("event") or "").strip() or "—"

    raw_pid = args.get("proposalId")
    if raw_pid is None or str(raw_pid).strip() == "":
        proposal_id = "—"
    else:
        proposal_id = str(raw_pid).strip()

    caller = "—"
    if args.get("creator") is not None:
        caller = str(args["creator"]).strip() or "—"
    elif args.get("proposer") is not None:
        caller = str(args["proposer"]).strip() or "—"
    elif args.get("approver") is not None:
        caller = str(args["approver"]).strip() or "—"

    ts = str(item.get("ts") or "").strip() or "—"
    tx_hash = str(item.get("txHash") or "").strip() or "—"
    bn = item.get("blockNumber")
    block_number = bn if bn is not None and str(bn).strip() != "" else "—"

    return {
        "ts": ts,
        "event": event,
        "proposalId": proposal_id,
        "caller": caller,
        "txHash": tx_hash,
        "blockNumber": block_number,
    }


def render_audit_trail_tab() -> None:
    st.subheader("Audit Trail")
    st.caption(
        "Auditor view: recent CaseRegistry events from the gateway audit log (newest first). "
        "Default limit is 50 rows."
    )

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
    items: list[Mapping[str, Any]] = raw_items if isinstance(raw_items, list) else []

    if len(items) == 0:
        st.info(
            "No audit rows returned. After a full propose → approve → execute flow with the "
            "gateway event listener enabled, expect at least three rows here."
        )
        return

    rows = [_flatten_audit_item(x) for x in items if isinstance(x, Mapping)]
    df = pd.DataFrame(rows)
    st.dataframe(df, use_container_width=True, hide_index=True)
