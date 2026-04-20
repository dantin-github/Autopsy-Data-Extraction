"""Post-login main area placeholder until Phase S3 tabs land (Phase S2.4)."""

from __future__ import annotations

import streamlit as st

from components.styles import login_brand_html

_LOGIN_FOOT = (
    "<strong>Restricted.</strong> Access is logged and subject to organizational policy. "
    "Use only for authorized investigations."
)


def render_dashboard_placeholder() -> None:
    """Centered shell: brand strip + signed-in notice (tabs follow in S3.1)."""
    user = st.session_state.get("user") or {}
    _, center, _ = st.columns([1, 2, 1])
    with center:
        brand = login_brand_html(
            title="Data Presentation Dashboard",
            subtitle=(
                "Authenticated access to case verification, chain-backed hash records, "
                "and audit trails."
            ),
            badge="Judge & auditor",
        )
        st.markdown(
            f'<div class="jw-dashboard-center">{brand}</div>',
            unsafe_allow_html=True,
        )
        st.success(
            f"Signed in as **{user.get('username', '')}** (judge). "
            "Query, Judicial Review, and Audit Trail tabs will appear in Phase S3+."
        )
        st.markdown(
            f'<div class="jw-dashboard-center jw-login-foot-wrap">'
            f'<footer class="jw-foot">{_LOGIN_FOOT}</footer></div>',
            unsafe_allow_html=True,
        )
