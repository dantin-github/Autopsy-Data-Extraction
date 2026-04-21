"""
Sign-in card (Phase S2.1) — matches api-gateway login.html fields and layout.

Phase S2.2: POST /login with JSON Accept, persist ``gw.sid`` in the shared
``requests.Session`` and mirror cookie dict + user payload in ``st.session_state``.

Phase S2.3: Only ``role == judge`` may proceed; police (``otp_sent``) and other
non-judge outcomes are rejected with a fixed English message; no ``gw_cookies``.

Phase S2.4: Login form only; post-login UI is gated in ``app.py``.
"""

from __future__ import annotations

import streamlit as st

from components.styles import login_brand_html
from session_guard import clear_judge_auth
from services.gateway_client import (
    GatewayError,
    GatewayTransportError,
    cookies_as_dict,
    get_gateway_client,
)

_LOGIN_FOOT = (
    "<strong>Restricted.</strong> Access is logged and subject to organizational policy. "
    "Use only for authorized investigations."
)

# Wording aligned with plan §6 (S2.3 acceptance).
_ROLE_GATE_MSG = (
    "This dashboard is for judges and auditors. Police should use the "
    "Autopsy Ingest Module with OTP."
)


def _reject_non_judge() -> None:
    st.error(_ROLE_GATE_MSG)


def render_login_form() -> None:
    """Centered gateway-style card; judge-only role gate (S2.3) + session commit (S2.2)."""
    _, center, _ = st.columns([1, 2, 1])
    with center:
        with st.form("sign_in_form", clear_on_submit=False):
            st.markdown(login_brand_html(), unsafe_allow_html=True)
            username = st.text_input(
                "Operator ID",
                placeholder="e.g. judge1 or officer1",
                autocomplete="username",
                key="login_username",
            )
            password = st.text_input(
                "Password",
                type="password",
                placeholder="••••••••",
                autocomplete="current-password",
                key="login_password",
            )
            submitted = st.form_submit_button("Sign in", use_container_width=True, type="primary")

        st.markdown(
            f'<div class="jw-login-foot-wrap"><footer class="jw-foot">{_LOGIN_FOOT}</footer></div>',
            unsafe_allow_html=True,
        )

        if submitted:
            u = (username or "").strip()
            p = password or ""
            if not u or not p:
                st.warning("Enter operator ID and password.")
            else:
                client = get_gateway_client()
                clear_judge_auth()
                try:
                    data = client.post_login(u, p)
                except GatewayError as e:
                    if e.status == 401:
                        st.error("Invalid credentials")
                    elif e.status == 403:
                        _reject_non_judge()
                    else:
                        st.error(str(e.message))
                except GatewayTransportError as e:
                    st.error(str(e))
                else:
                    status = str(data.get("status") or "")
                    role_norm = str(data.get("role") or "").lower()

                    if status == "otp_sent" or role_norm == "police":
                        _reject_non_judge()
                    elif status == "redirect" and role_norm == "judge":
                        st.session_state["gw_cookies"] = cookies_as_dict(client)
                        st.session_state["user"] = {
                            "userId": data.get("userId"),
                            "username": data.get("username"),
                            "role": data.get("role"),
                        }
                        if not st.session_state["gw_cookies"].get("gw.sid"):
                            st.error(
                                "Login succeeded but no gateway session cookie was returned. "
                                "Check API gateway session configuration."
                            )
                            clear_judge_auth()
                        else:
                            st.rerun()
                    elif status == "redirect":
                        # Unexpected role with redirect shape — treat as non-judge.
                        _reject_non_judge()
                    else:
                        st.error("Login failed.")
