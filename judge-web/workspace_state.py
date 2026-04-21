"""Shared session_state keys for main workspace tab + cross-tab navigation (S5.3)."""

from __future__ import annotations

WORKSPACE_TAB_INDEX_KEY = "jw_workspace_tab_index"
# Set from child views (e.g. Audit Trail) before st.rerun(); consumed at the start of
# _render_judge_workspace() before st.radio — avoids Streamlit's "cannot modify after widget" error.
PENDING_WORKSPACE_TAB_INDEX_KEY = "jw_pending_workspace_tab_index"
PENDING_PROPOSAL_ID_KEY = "pending_proposal_id"

WORKSPACE_LABELS: tuple[str, ...] = ("Query", "Judicial Review", "Audit Trail")
WORKSPACE_QUERY = 0
WORKSPACE_REVIEW = 1
WORKSPACE_AUDIT = 2
