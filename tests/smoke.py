"""
S6.2 -- HTTP smoke tests (pytest + requests) against a running api-gateway.

Prerequisites:
  python tests/seed_fixtures.py --prepare-smoke --gateway-dir api-gateway
  Optional for test_s6_2_07: police OTP in env SMOKE_POLICE_OTP (see tests/README.md)

Run: python -m pytest tests/smoke.py -v
"""

from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote

import pytest
import requests

# Role-gate test needs a one-time OTP after a new POST /login as police.
pytestmark = pytest.mark.smoke


def test_s6_2_01_judge_login_json(base_url: str, smoke_config: dict) -> None:
    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    r = requests.post(
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
    assert body.get("username"), body


def test_s6_2_02_query_ok(
    base_url: str, smoke_config: dict, judge_session: requests.Session
) -> None:
    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    r = judge_session.post(
        f"{base_url}/api/query",
        json=smoke_config["queryBody"],
        headers=hdr,
        timeout=120,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("caseId") == smoke_config["queryBody"]["caseId"]
    integrity = data.get("integrity") or {}
    assert integrity.get("recordHashMatch") is True, integrity
    assert integrity.get("aggregateHashValid") is True, integrity


def test_s6_2_03_query_tamper_then_restore(
    base_url: str, smoke_config: dict, judge_session: requests.Session
) -> None:
    store_path = Path(smoke_config["recordStorePath"])
    assert store_path.is_file(), f"Record store not found: {store_path}"

    raw = store_path.read_text(encoding="utf-8")
    store = json.loads(raw)
    case_id = smoke_config["queryBody"]["caseId"]
    assert case_id in store, f"caseId {case_id} not in store keys"

    backup = deepcopy(store)
    rec = json.loads(store[case_id])
    rec["examiner"] = "tampered-by-smoke-s6-2"
    store[case_id] = json.dumps(rec)
    store_path.write_text(json.dumps(store), encoding="utf-8")

    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    try:
        r = judge_session.post(
            f"{base_url}/api/query",
            json=smoke_config["queryBody"],
            headers=hdr,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        integrity = r.json().get("integrity") or {}
        assert integrity.get("recordHashMatch") is False, integrity
    finally:
        store_path.write_text(json.dumps(backup), encoding="utf-8")

    r2 = judge_session.post(
        f"{base_url}/api/query",
        json=smoke_config["queryBody"],
        headers=hdr,
        timeout=120,
    )
    assert r2.status_code == 200, r2.text
    integrity2 = r2.json().get("integrity") or {}
    assert integrity2.get("recordHashMatch") is True, integrity2


def test_s6_2_04_modify_approve(
    base_url: str, smoke_config: dict, judge_session: requests.Session
) -> None:
    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    pid = smoke_config["approve"]["proposalId"]
    r = judge_session.post(
        f"{base_url}/api/modify/approve",
        json={
            "proposalId": pid,
            "signingPassword": smoke_config["signingPassword"],
        },
        headers=hdr,
        timeout=180,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("txHash"), r.text

    r2 = judge_session.get(
        f"{base_url}/api/modify/{quote(str(pid).strip(), safe='')}",
        headers=hdr,
        timeout=120,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json().get("status") == "Approved", r2.text


def test_s6_2_05_modify_reject(
    base_url: str, smoke_config: dict, judge_session: requests.Session
) -> None:
    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    pid = smoke_config["reject"]["proposalId"]
    r = judge_session.post(
        f"{base_url}/api/modify/reject",
        json={
            "proposalId": pid,
            "signingPassword": smoke_config["signingPassword"],
            "reason": "Smoke S6.2 reject",
        },
        headers=hdr,
        timeout=180,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("txHash"), r.text

    r2 = judge_session.get(
        f"{base_url}/api/modify/{quote(str(pid).strip(), safe='')}",
        headers=hdr,
        timeout=120,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json().get("status") == "Rejected", r2.text


def test_s6_2_06_audit_at_least_n(
    base_url: str, judge_session: requests.Session,
) -> None:
    minimum = int(os.environ.get("SMOKE_AUDIT_MIN", "4"))
    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    r = judge_session.get(
        f"{base_url}/api/audit",
        params={"limit": 50},
        headers=hdr,
        timeout=120,
    )
    assert r.status_code == 200, r.text
    items = r.json().get("items")
    assert isinstance(items, list), r.text
    assert len(items) >= minimum, (
        f"Expected at least {minimum} audit rows (set SMOKE_AUDIT_MIN=1 for looser dev check). "
        f"Got {len(items)}."
    )


@pytest.mark.police_gate
def test_s6_2_07_role_gate_police_session_cannot_query(
    base_url: str, smoke_config: dict,
) -> None:
    otp = os.environ.get("SMOKE_POLICE_OTP", "").strip()
    if not otp:
        pytest.skip(
            "Before pytest: POST /login as police (JSON), copy 16 hex OTP from MAIL_DRY_RUN log, "
            "then set SMOKE_POLICE_OTP (do not call /login again inside the same flow)."
        )
    if len(otp) != 16 or any(c not in "0123456789abcdefABCDEF" for c in otp):
        pytest.fail("SMOKE_POLICE_OTP must be 16 hex characters")

    hdr = {"Accept": "application/json", "Content-Type": "application/json"}
    s = requests.Session()
    r2 = s.post(
        f"{base_url}/api/auth/police-otp",
        json={"username": smoke_config["policeUser"], "otp": otp},
        headers=hdr,
        timeout=60,
    )
    assert r2.status_code == 200, r2.text

    r3 = s.post(
        f"{base_url}/api/query",
        json=smoke_config["queryBody"],
        headers=hdr,
        timeout=120,
    )
    assert r3.status_code == 401, r3.text
