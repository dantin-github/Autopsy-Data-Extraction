"""
Data Presentation Dashboard — Streamlit entry.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import streamlit as st

import config
from components.styles import inject_theme
from pages_ui import render_login_form
from pages_ui.audit_trail_tab import render_audit_trail_tab
from pages_ui.judicial_review_tab import render_judicial_review_tab
from pages_ui.query_tab import render_query_tab
from services.gateway_client import GatewayError, GatewayTransportError, get_gateway_client
from session_guard import (
    clear_judge_auth,
    ensure_logged_out_client_if_no_mirror,
    is_judge_authenticated,
    logout_completely,
    probe_judge_session,
)


def _render_judge_workspace() -> None:
    """Main area after login: full-width Query / Judicial Review / Audit Trail tabs (S3.1)."""
    tab_query, tab_review, tab_audit = st.tabs(
        ["Query", "Judicial Review", "Audit Trail"],
    )
    with tab_query:
        render_query_tab()
    with tab_review:
        render_judicial_review_tab()
    with tab_audit:
        render_audit_trail_tab()

try:
    _settings = {
        "api_gateway_url": config.get_api_gateway_url(),
        "log_level": config.get_log_level(),
    }
except ValueError as e:
    st.set_page_config(page_title="Judge Dashboard", page_icon="⚖️", layout="wide")
    st.error("Configuration error")
    st.code(str(e))
    st.stop()

st.set_page_config(
    page_title="Judge Dashboard",
    page_icon="⚖️",
    layout="wide",
)

inject_theme()

if "gateway_ping" not in st.session_state:
    st.session_state.gateway_ping = None

with st.sidebar:
    st.header("Configuration")
    st.markdown("**API Gateway (base URL)**")
    st.code(_settings["api_gateway_url"], language="text")
    st.markdown("**Log level**")
    st.code(_settings["log_level"], language="text")
    st.caption(
        "Values load from `judge-web/.env` first (create by copying `.env.example`). "
        "Restart the app after edits. `.env.example` is only a template and is not read."
    )

    st.divider()
    st.subheader("Connectivity")
    if st.button("Ping Gateway", key="ping_gateway_btn", use_container_width=True):
        t0 = time.perf_counter()
        checked_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        try:
            body = get_gateway_client().get_health()
            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            status = str(body.get("status", "ok"))
            st.session_state.gateway_ping = {
                "ok": True,
                "status": status,
                "latency_ms": latency_ms,
                "checked_at": checked_at,
                "uptime": body.get("uptime"),
                "body": body,
            }
        except GatewayTransportError as e:
            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            st.session_state.gateway_ping = {
                "ok": False,
                "status": "unreachable",
                "latency_ms": latency_ms,
                "checked_at": checked_at,
                "error": str(e),
            }
        except GatewayError as e:
            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            st.session_state.gateway_ping = {
                "ok": False,
                "status": "error",
                "latency_ms": latency_ms,
                "checked_at": checked_at,
                "error": e.message,
                "http_status": e.status,
            }

    ping = st.session_state.gateway_ping
    if ping is None:
        st.caption("Click **Ping Gateway** to test connectivity to `/health`.")
    elif ping["ok"]:
        st.success(f"**{ping['status']}** — {ping['latency_ms']} ms")
        st.caption(f"Last check: {ping['checked_at']}")
        if ping.get("uptime") is not None:
            st.caption(f"Gateway uptime (s): {ping['uptime']}")
    else:
        st.error(f"**{ping['status']}** — {ping['latency_ms']} ms")
        st.caption(f"Last check: {ping['checked_at']}")
        err = ping.get("error") or "Unknown error"
        st.caption(err[:500] + ("…" if len(err) > 500 else ""))

    st.divider()
    st.subheader("CaseRegistry (S5.1)")
    st.caption(
        "Deploy **CaseRegistry** on the gateway host: `cd api-gateway` then "
        "`npm run compile -- contracts/CaseRegistry.sol` and `npm run deploy-contract`. "
        "See **Phase 5 · Deploy CaseRegistry (S5.1)** in `api-gateway/README.md`."
    )
    ping_body = (
        (st.session_state.gateway_ping or {}).get("body")
        if isinstance(st.session_state.gateway_ping, dict)
        else None
    )
    gw = (
        ping_body.get("gateway")
        if isinstance(ping_body, dict) and isinstance(ping_body.get("gateway"), dict)
        else None
    )
    if gw:
        rows = [
            ("CHAIN_MODE (reported)", str(gw.get("chainMode", ""))),
            ("FISCO CRUD configured", "yes" if gw.get("chainConfigured") else "no"),
            ("CASE_REGISTRY_ADDR set", "yes" if gw.get("caseRegistryConfigured") else "no"),
            (
                "Registry address (last 6 hex)",
                str(gw.get("caseRegistryAddrTail") or "-"),
            ),
            (
                "Upload uses contract path",
                "yes" if gw.get("uploadContractPathEnabled") else "no",
            ),
        ]
        st.markdown(
            "\n".join(f"- **{label}:** `{value}`" for label, value in rows)
        )
    else:
        st.caption("Run **Ping Gateway** above to load chain / CaseRegistry flags from `/health`.")

    if is_judge_authenticated():
        st.divider()
        st.subheader("Session")
        st.caption("End your gateway session and return to the sign-in screen.")
        if st.button("Logout", key="jw_logout_btn", use_container_width=True):
            logout_completely()
            st.rerun()

_auth_flash = st.session_state.pop("_auth_flash", None)

if is_judge_authenticated():
    _probe = probe_judge_session()
    if _probe == "unauthorized":
        clear_judge_auth()
        st.session_state["_auth_flash"] = (
            "Your session expired or was revoked. Please sign in again."
        )
        st.rerun()
    elif _probe == "transport":
        if _auth_flash:
            st.warning(_auth_flash)
        st.warning(
            "Cannot reach the API gateway to verify your session. "
            "You can keep working, but requests may fail until connectivity returns."
        )
        _render_judge_workspace()
    elif _probe == "error":
        if _auth_flash:
            st.warning(_auth_flash)
        st.warning("The gateway could not verify your session. Try again shortly.")
        _render_judge_workspace()
    else:
        if _auth_flash:
            st.warning(_auth_flash)
        _render_judge_workspace()
else:
    ensure_logged_out_client_if_no_mirror()
    if _auth_flash:
        st.warning(_auth_flash)
    render_login_form()
