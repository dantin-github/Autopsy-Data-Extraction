"""Judicial Review tab — fetch modify proposals by case ID or proposal ID (Phase S4+)."""

from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timezone
from typing import Any, List, Mapping, Sequence, Tuple

import streamlit as st

from services.gateway_client import GatewayError, GatewayTransportError, get_gateway_client

_MODIFY_FETCH_RESULT_KEY = "judicial_modify_fetch_result"
_PENDING_WRAP_KEY = "judicial_pending_for_case_wrap"
_PENDING_LAST_CASE_ID_KEY = "judicial_pending_search_case_id"
_JUDICIAL_DECISION_FEEDBACK_KEY = "judicial_decision_feedback"

# Snapshot fields aligned with GET /api/modify/:id (S4.2); proposalId included for context.
_SNAPSHOT_FIELDS: Sequence[Tuple[str, str]] = (
    ("proposalId", "Proposal ID"),
    ("status", "Status"),
    ("proposer", "Proposer"),
    ("approver", "Approver"),
    ("oldHash", "Old hash"),
    ("newHash", "New hash"),
    ("reason", "Reason"),
    ("proposedAt", "Proposed at"),
    ("decidedAt", "Decided at"),
)

_HASH_LIKE_KEYS = frozenset(
    {"proposalId", "proposer", "approver", "oldHash", "newHash"}
)


def _clear_modify_fetch_result() -> None:
    st.session_state.pop(_MODIFY_FETCH_RESULT_KEY, None)


def _clear_pending_wrap() -> None:
    st.session_state.pop(_PENDING_WRAP_KEY, None)
    st.session_state.pop(_PENDING_LAST_CASE_ID_KEY, None)


def _proposal_form_suffix(proposal_id: str) -> str:
    """Stable fragment for Streamlit widget keys (must be unique per proposal)."""
    s = str(proposal_id or "").strip().replace("0x", "").replace("0X", "").lower()
    if len(s) >= 12 and all(c in "0123456789abcdef" for c in s):
        return s[:16]
    digest = hashlib.sha256(str(proposal_id).encode("utf-8")).hexdigest()
    return digest[:16]


def _render_modify_fetch_error(err: GatewayError) -> None:
    """English banners for /api/modify failures."""
    status = err.status
    if status == 404:
        st.warning(err.message or "Not found.")
    elif status == 400:
        st.error(f"Bad request: {err.message}")
    elif status == 503:
        st.error(
            "Chain or case registry is not configured. "
            "The gateway cannot load proposals until CASE_REGISTRY_ADDR and chain credentials are set."
        )
    elif status == 401:
        st.error(
            f"Not authorized ({status}): {err.message}. "
            "Approve and reject require an active **judge** gateway session."
        )
    elif status == 403:
        st.error(
            f"Forbidden ({status}): {err.message}. "
            "Judicial actions must be performed with a judge account, not police."
        )
    else:
        st.error(f"Request failed ({status}): {err.message}")


def _strip_pending_key(row: Mapping[str, Any]) -> dict[str, Any]:
    """Omit internal snapshot key from display dicts."""
    return {k: v for k, v in row.items() if k != "pendingKey"}


def _normalize_case_id_input(raw: str) -> str:
    """
    Trim and strip accidental ``caseId=…`` from copy-paste (matches gateway normalizeCaseIdParam).
    """
    s = (raw or "").strip()
    if not s:
        return ""
    m = re.match(r"(?i)^caseId\s*=\s*(.+)$", s)
    if m:
        return m.group(1).strip()
    return s


def _format_registry_timestamp(val: Any) -> str:
    """Chain returns uint as string (often ms since epoch for proposedAt). Local timezone display."""
    if val is None:
        return "—"
    s = str(val).strip()
    if s.lower() in ("", "0", "null", "none"):
        return "—"
    try:
        n = int(float(s))
    except ValueError:
        return html.escape(s)
    if n <= 0:
        return "—"
    # Heuristic: millisecond timestamps exceed ~1e11; seconds ~1e9–1e10.
    ts = n / 1000.0 if n > 100_000_000_000 else float(n)
    try:
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone()
        return dt.strftime("%Y-%m-%d %H:%M:%S %Z")
    except (OSError, OverflowError, ValueError):
        return html.escape(s)


def _format_snapshot_value(key: str, val: Any) -> str:
    if key in ("proposedAt", "decidedAt"):
        return _format_registry_timestamp(val)
    if val is None:
        return "—"
    s = str(val).strip()
    return html.escape(s) if s else "—"


def _status_badge_modifier(status_label: str) -> str:
    s = (status_label or "").strip().lower()
    if s == "pending":
        return "pending"
    if s == "approved":
        return "approved"
    if s == "rejected":
        return "rejected"
    if s == "executed":
        return "executed"
    if s == "none":
        return "none"
    return "unknown"


def _status_badge_html(raw: Any) -> str:
    """Colored pill for registry status (S4.3)."""
    label = str(raw).strip() if raw is not None else ""
    if not label:
        label = "—"
    mod = _status_badge_modifier(label if label != "—" else "")
    esc = html.escape(label)
    return (
        f'<span class="jw-status-badge jw-status-badge--{mod}" role="status">{esc}</span>'
    )


def _render_proposal_snapshot_table(row: Mapping[str, Any]) -> None:
    """Two-column snapshot: muted uppercase labels; monospace hashes (S4.2)."""
    body_rows: List[str] = []
    for key, label in _SNAPSHOT_FIELDS:
        raw = row.get(key)
        if key == "status":
            cell_inner = _status_badge_html(raw)
            val_class = "jw-snapshot-value"
        else:
            cell_inner = _format_snapshot_value(key, raw)
            val_class = "jw-hash-hex" if key in _HASH_LIKE_KEYS else "jw-snapshot-value"
        body_rows.append(
            "<tr>"
            f'<td class="jw-snapshot-label">{html.escape(label)}</td>'
            f'<td class="{val_class}">{cell_inner}</td>'
            "</tr>"
        )
    table_html = (
        '<table class="jw-snapshot-table" role="grid" '
        'aria-label="Proposal snapshot">'
        + "".join(body_rows)
        + "</table>"
    )
    st.markdown(table_html, unsafe_allow_html=True)


def _apply_decision_feedback_on_success(message: str, proposal_id: str) -> None:
    st.session_state[_JUDICIAL_DECISION_FEEDBACK_KEY] = message
    client = get_gateway_client()
    cid = st.session_state.get(_PENDING_LAST_CASE_ID_KEY)
    if cid:
        try:
            wrap = client.get_modify_pending_for_case(str(cid))
            st.session_state[_PENDING_WRAP_KEY] = wrap
        except (GatewayTransportError, GatewayError):
            pass
        st.session_state.pop(_MODIFY_FETCH_RESULT_KEY, None)
    else:
        try:
            st.session_state[_MODIFY_FETCH_RESULT_KEY] = client.get_modify(proposal_id)
        except (GatewayTransportError, GatewayError):
            pass
    st.rerun()


def _render_pending_decision_block(
    display: Mapping[str, Any], *, form_suffix: str
) -> None:
    """Approve / Reject forms — only when chain status is Pending (S4.3)."""
    status = str(display.get("status") or "").strip()
    proposal_id = str(display.get("proposalId") or "").strip()
    if not proposal_id:
        return
    if status != "Pending":
        st.info("Only Pending proposals can be decided.")
        return

    sfx = form_suffix or "default"
    st.markdown("##### Decision")
    col_a, col_b = st.columns(2, gap="medium")
    with col_a:
        with st.form(f"judicial_approve_form_{sfx}", clear_on_submit=False):
            ap_pw = st.text_input(
                "Signing password",
                type="password",
                autocomplete="current-password",
                key=f"judicial_approve_signing_pw_{sfx}",
            )
            ap_go = st.form_submit_button("Approve", type="primary")
    with col_b:
        with st.form(f"judicial_reject_form_{sfx}", clear_on_submit=False):
            rj_pw = st.text_input(
                "Signing password",
                type="password",
                autocomplete="current-password",
                key=f"judicial_reject_signing_pw_{sfx}",
            )
            rj_reason = st.text_input(
                "Rejection reason (required)",
                key=f"judicial_reject_reason_text_{sfx}",
            )
            rj_go = st.form_submit_button("Reject", type="secondary")

    client = get_gateway_client()
    if ap_go:
        if not (ap_pw or "").strip():
            st.warning("Enter signing password.")
        else:
            try:
                out = client.post_approve(proposal_id, ap_pw)
            except GatewayTransportError as e:
                st.error(str(e))
            except GatewayError as e:
                msg = e.message or "Request failed"
                if e.revert_reason:
                    msg = f"{msg} (revert: {e.revert_reason})"
                st.error(msg)
            else:
                tx = out.get("txHash") or "—"
                bn = out.get("blockNumber")
                tail = f", block {bn}" if bn is not None else ""
                _apply_decision_feedback_on_success(
                    f"Approved — txHash {tx}{tail}", proposal_id
                )

    if rj_go:
        reason = (rj_reason or "").strip()
        if not (rj_pw or "").strip():
            st.warning("Enter signing password.")
        elif not reason:
            st.warning("Rejection reason is required.")
        else:
            try:
                out = client.post_reject(proposal_id, rj_pw, reason)
            except GatewayTransportError as e:
                st.error(str(e))
            except GatewayError as e:
                msg = e.message or "Request failed"
                if e.revert_reason:
                    msg = f"{msg} (revert: {e.revert_reason})"
                st.error(msg)
            else:
                tx = out.get("txHash") or "—"
                bn = out.get("blockNumber")
                tail = f", block {bn}" if bn is not None else ""
                _apply_decision_feedback_on_success(
                    f"Rejected — txHash {tx}{tail}", proposal_id
                )


def render_judicial_review_tab() -> None:
    st.subheader("Judicial Review")
    fb = st.session_state.pop(_JUDICIAL_DECISION_FEEDBACK_KEY, None)
    if fb:
        st.success(fb)
    st.caption(
        "Look up a **pending** on-chain proposal by **case ID** (matches local "
        "`caseId::pending-…` snapshots after police **propose**), or fetch a snapshot by "
        "**proposal ID**."
    )

    with st.form("judicial_by_case_form", clear_on_submit=False):
        case_id = st.text_input(
            "Case ID",
            placeholder="e.g. e2e-1776731266432 (not caseId=e2e-…)",
            autocomplete="off",
            key="judicial_case_id_input",
        )
        find_submitted = st.form_submit_button("Find pending proposal", type="primary")

    if find_submitted:
        cid = _normalize_case_id_input(case_id or "")
        if not cid:
            _clear_modify_fetch_result()
            _clear_pending_wrap()
            st.warning("Enter a case ID.")
        else:
            try:
                with st.spinner("Searching for pending proposals…"):
                    wrap = get_gateway_client().get_modify_pending_for_case(cid)
            except GatewayTransportError as e:
                _clear_modify_fetch_result()
                _clear_pending_wrap()
                st.error(str(e))
            except GatewayError as e:
                _clear_modify_fetch_result()
                _clear_pending_wrap()
                _render_modify_fetch_error(e)
            else:
                st.session_state[_PENDING_WRAP_KEY] = wrap
                st.session_state[_PENDING_LAST_CASE_ID_KEY] = cid
                _clear_modify_fetch_result()
                pending: List[Mapping[str, Any]] = list(wrap.get("pending") or [])
                if len(pending) == 0:
                    hint = wrap.get("hint")
                    if hint:
                        st.warning(str(hint))
                    else:
                        st.info(
                            "No **Pending** on-chain proposal found for this case. "
                            "There must be a police **propose** for this case (creates a "
                            "`caseId::pending-0x…` entry), and the registry row must still be "
                            "**Pending** (not yet approved or rejected)."
                        )
                elif len(pending) == 1:
                    st.success("Found **1** pending proposal for this case.")
                else:
                    st.success(
                        f"Found **{len(pending)}** pending proposals for this case — "
                        "all are listed below."
                    )

    wrap = st.session_state.get(_PENDING_WRAP_KEY)
    pending_list: List[Mapping[str, Any]] = (
        list(wrap.get("pending") or []) if isinstance(wrap, dict) else []
    )

    with st.expander("Fetch by proposal ID (advanced)"):
        with st.form("judicial_fetch_by_pid_form", clear_on_submit=False):
            proposal_id = st.text_input(
                "Proposal ID",
                placeholder="0x + 64 hex characters",
                autocomplete="off",
                key="judicial_proposal_id_input",
            )
            pid_submitted = st.form_submit_button("Fetch")

        if pid_submitted:
            pid = (proposal_id or "").strip()
            if not pid:
                st.warning("Enter a proposal ID.")
            else:
                try:
                    with st.spinner("Fetching proposal from API gateway…"):
                        data = get_gateway_client().get_modify(pid)
                except GatewayTransportError as e:
                    _clear_modify_fetch_result()
                    _clear_pending_wrap()
                    st.error(str(e))
                except GatewayError as e:
                    _clear_modify_fetch_result()
                    _clear_pending_wrap()
                    _render_modify_fetch_error(e)
                else:
                    _clear_pending_wrap()
                    st.session_state[_MODIFY_FETCH_RESULT_KEY] = data

    if pending_list:
        st.markdown("### Pending proposals (this case)")
        for i, raw_row in enumerate(pending_list):
            if i > 0:
                st.divider()
            display = _strip_pending_key(raw_row)
            pid = str(display.get("proposalId") or "")
            sfx = _proposal_form_suffix(pid)
            st.markdown(f"##### Proposal snapshot ({i + 1} of {len(pending_list)})")
            st.markdown(f'<p class="jw-snapshot-proposal-id">{html.escape(pid)}</p>', unsafe_allow_html=True)
            _render_proposal_snapshot_table(display)
            _render_pending_decision_block(display, form_suffix=sfx)

    last = st.session_state.get(_MODIFY_FETCH_RESULT_KEY)
    if last is not None and not pending_list:
        st.markdown("##### Proposal snapshot")
        display = _strip_pending_key(last)
        sfx = _proposal_form_suffix(str(display.get("proposalId") or "single"))
        _render_proposal_snapshot_table(display)
        _render_pending_decision_block(display, form_suffix=sfx)
