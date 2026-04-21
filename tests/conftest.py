"""Pytest fixtures for Phase 6 smoke (S6.2)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
import requests

TESTS_DIR = Path(__file__).resolve().parent


def pytest_configure(config) -> None:
    config.addinivalue_line("markers", "smoke: Phase 6 HTTP smoke (S6.2)")
    config.addinivalue_line(
        "markers",
        "police_gate: requires env SMOKE_POLICE_OTP from a prior police POST /login",
    )
DEFAULT_CONFIG = TESTS_DIR / "smoke_config.json"


@pytest.fixture(scope="module")
def smoke_config() -> dict:
    path = Path(os.environ.get("SMOKE_CONFIG", str(DEFAULT_CONFIG)))
    if not path.is_file():
        pytest.skip(
            f"Missing {path}. Generate it with:\n"
            "  python tests/seed_fixtures.py --prepare-smoke --gateway-dir api-gateway"
        )
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def base_url(smoke_config: dict) -> str:
    return str(smoke_config["baseUrl"]).rstrip("/")


@pytest.fixture(scope="module")
def judge_session(smoke_config: dict, base_url: str) -> requests.Session:
    s = requests.Session()
    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    r = s.post(
        f"{base_url}/login",
        json={
            "username": smoke_config["judgeUser"],
            "password": smoke_config["judgePassword"],
        },
        headers=hdr,
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("role") == "judge", body
    return s
