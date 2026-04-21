"""Audit Trail tab — registry events, auditor-oriented view (Phase S5+)."""

from __future__ import annotations

import streamlit as st


def render_audit_trail_tab() -> None:
    st.subheader("Audit Trail")
    st.caption(
        "Audit Trail (Auditor View): recent CaseRegistry events, filters, and refresh. "
        "Phase S5+."
    )
