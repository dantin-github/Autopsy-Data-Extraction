"""Judicial Review tab — modify proposals (Phase S4+)."""

from __future__ import annotations

import streamlit as st


def render_judicial_review_tab() -> None:
    st.subheader("Judicial Review")
    st.caption(
        "Fetch proposals, approve or reject with signing password, and view on-chain outcomes. "
        "Phase S4+."
    )
