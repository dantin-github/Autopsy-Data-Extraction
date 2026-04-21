"""
Load runtime configuration from environment / .env (Phase S1.2).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent


def _reload_env() -> None:
    """Re-read `.env` on each access so Streamlit reruns pick up edits without restarting the process."""
    load_dotenv(_ROOT / ".env", override=True)


def _default_api_gateway_url() -> str:
    return "http://localhost:3000"


def get_api_gateway_url() -> str:
    """Base URL of the Case Gateway (no trailing slash)."""
    _reload_env()
    raw = os.getenv("API_GATEWAY_URL")
    if raw is None or str(raw).strip() == "":
        return _default_api_gateway_url()
    url = str(raw).strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(
            f"API_GATEWAY_URL must be a valid http(s) URL (got: {raw!r})"
        )
    return url


def get_log_level() -> str:
    """Logging verbosity: trace|debug|info|warn|error (default info)."""
    _reload_env()
    raw = os.getenv("LOG_LEVEL", "info")
    level = str(raw).strip().lower() if raw else "info"
    return level if level else "info"


# Canonical demo case for Query tab / smoke tests (user workspace fixture).
_DEFAULT_SMOKE_CASE_ID = "e2e-1776665697937"


def get_smoke_case_id() -> str:
    """Case ID used in docs, placeholders, and automated smoke tests (env: ``SMOKE_CASE_ID``)."""
    _reload_env()
    raw = os.getenv("SMOKE_CASE_ID")
    if raw is not None and str(raw).strip() != "":
        return str(raw).strip()
    return _DEFAULT_SMOKE_CASE_ID
