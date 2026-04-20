"""
Inject global CSS aligned with api-gateway login.html (Phase S1.5).
"""

from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def inject_theme() -> None:
    """Load static/theme.css into the page (call once per run, after st.set_page_config)."""
    import streamlit as st

    css_path = _ROOT / "static" / "theme.css"
    css = css_path.read_text(encoding="utf-8")
    st.markdown(f"<style>\n{css}\n</style>", unsafe_allow_html=True)


def _shield_svg() -> str:
    return (_ROOT / "static" / "icons" / "shield.svg").read_text(encoding="utf-8")


def login_brand_html(
    *,
    title: str = "Central Gateway",
    subtitle: str = (
        "Authenticated access to case hash services and chain-backed evidence workflows."
    ),
    badge: str = "Digital forensics",
) -> str:
    """HTML for .jw-brand block (same structure as api-gateway login.html)."""
    svg = _shield_svg()
    return f"""
<div class="jw-brand">
  <div class="jw-mark" aria-hidden="true">{svg}</div>
  <div>
    <h1>{title}</h1>
    <p>{subtitle}</p>
    <span class="jw-badge">{badge}</span>
  </div>
</div>
"""


def render_main_shell(
    *,
    title: str,
    subtitle: str,
    badge: str,
    body_html: str,
    foot_html: str,
) -> None:
    """
    One HTML panel matching login.html structure (.panel, .brand, .badge, .foot).
    Use for placeholder or future login; avoids broken div nesting with Streamlit widgets.
    """
    import streamlit as st

    svg = _shield_svg()
    st.markdown(
        f"""
<div class="jw-panel">
  <div class="jw-brand">
    <div class="jw-mark" aria-hidden="true">{svg}</div>
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <span class="jw-badge">{badge}</span>
    </div>
  </div>
  <div class="jw-banner jw-banner--info" role="status">
    {body_html}
  </div>
  <footer class="jw-foot">{foot_html}</footer>
</div>
""",
        unsafe_allow_html=True,
    )
