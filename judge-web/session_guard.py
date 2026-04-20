from __future__ import annotations

# Judge session flags, cleanup, gateway session probe (Phase S2.4), and logout (S2.5).
# ``gw.sid`` lives in ``get_gateway_client().session``; ``st.session_state`` mirrors
# metadata. If either is missing or the gateway returns 401/403 on a judge-only route,
# the UI returns to the login form.

from typing import Literal

import streamlit as st

from services.gateway_client import (
    GatewayClient,
    GatewayError,
    GatewayTransportError,
    get_gateway_client,
)

ProbeResult = Literal["ok", "unauthorized", "error", "transport"]


def is_judge_authenticated() -> bool:
    user = st.session_state.get("user")
    cookies = st.session_state.get("gw_cookies") or {}
    if not isinstance(user, dict):
        return False
    if str(user.get("role") or "").lower() != "judge":
        return False
    return bool(cookies.get("gw.sid"))


def clear_judge_auth() -> None:
    """Drop mirrored auth state and the shared requests cookie jar."""
    st.session_state.pop("user", None)
    st.session_state.pop("gw_cookies", None)
    st.session_state.pop("_judge_probe_at", None)
    get_gateway_client().session.cookies.clear()


def logout_completely() -> None:
    """
    Clear the shared HTTP cookie jar and wipe all ``st.session_state`` (plan S2.5).

    The next run creates a fresh ``GatewayClient`` with an empty jar.
    """
    get_gateway_client().session.cookies.clear()
    st.session_state.clear()


def probe_judge_session(client: GatewayClient | None = None) -> ProbeResult:
    """
    GET /api/audit?limit=1 — lightweight judge-session check (plan S2.4).
    """
    c = client or get_gateway_client()
    try:
        c.get_audit(limit=1)
    except GatewayError as e:
        if e.status in (401, 403):
            return "unauthorized"
        return "error"
    except GatewayTransportError:
        return "transport"
    return "ok"


def ensure_logged_out_client_if_no_mirror() -> None:
    """If UI state says logged out but the jar still holds gw.sid, clear the jar."""
    if is_judge_authenticated():
        return
    jar = get_gateway_client().session.cookies
    if jar.get("gw.sid"):
        jar.clear()
