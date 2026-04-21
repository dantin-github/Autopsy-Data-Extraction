#!/usr/bin/env python3
"""
S6.1 — Seed one on-chain case + one Pending modify proposal for judge-web / smoke.

Prerequisites: api-gateway running (CHAIN_MODE=contract, CASE_REGISTRY_ADDR, …).
See tests/README.md.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GATEWAY_DIR = REPO_ROOT / "api-gateway"
RESULT_PATH = Path(__file__).resolve().parent / ".seed_fixture_result.json"


def _run_node(gateway_dir: Path, script: str, env: dict[str, str]) -> None:
    subprocess.run(
        ["node", script],
        cwd=gateway_dir,
        env=env,
        check=True,
    )


def _read_otp(env_var: str, prompt: str) -> str:
    v = (os.environ.get(env_var) or "").strip()
    if v:
        return v
    return input(prompt).strip()


def _fail(msg: str, resp: requests.Response | None = None) -> None:
    print(msg, file=sys.stderr)
    if resp is not None:
        print(resp.status_code, file=sys.stderr)
        try:
            print(resp.text[:2000], file=sys.stderr)
        except OSError:
            pass
    sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(description="S6.1 seed: upload + propose + verify query/modify")
    p.add_argument(
        "--base-url",
        default=os.environ.get("API_GATEWAY_URL", "http://127.0.0.1:3000").rstrip("/"),
        help="Gateway base URL (default: env API_GATEWAY_URL or http://127.0.0.1:3000)",
    )
    p.add_argument(
        "--gateway-dir",
        type=Path,
        default=DEFAULT_GATEWAY_DIR,
        help="Path to api-gateway (default: <repo>/api-gateway)",
    )
    p.add_argument("--police-user", default="officer1")
    p.add_argument("--police-password", default="1")
    p.add_argument("--judge-user", default="judge1")
    p.add_argument("--judge-password", default="1")
    p.add_argument(
        "--record-store-path",
        default=os.environ.get("RECORD_STORE_PATH", "").strip() or None,
        help="If set, passed to Node gen-* scripts (must match running gateway)",
    )
    args = p.parse_args()

    gw: Path = args.gateway_dir.resolve()
    if not (gw / "scripts" / "gen-e2e-upload-body.js").is_file():
        _fail(f"api-gateway scripts not found under {gw}")

    sub_env = os.environ.copy()
    if args.record_store_path:
        sub_env["RECORD_STORE_PATH"] = args.record_store_path

    base = args.base_url.rstrip("/")
    print(f"Gateway: {base}")
    print(f"Record store for Node helpers: {sub_env.get('RECORD_STORE_PATH', '(default ~/.case_record_store.json)')}")

    try:
        r0 = requests.get(f"{base}/health", timeout=30)
        r0.raise_for_status()
        if r0.json().get("status") != "ok":
            _fail("GET /health did not return status=ok", r0)
    except requests.RequestException as e:
        _fail(f"GET /health failed: {e}")

    print("Running gen-e2e-upload-body.js …")
    _run_node(gw, "scripts/gen-e2e-upload-body.js", sub_env)

    query_path = gw / "e2e-query-body.json"
    upload_path = gw / "e2e-upload-body.json"
    query_body = json.loads(query_path.read_text(encoding="utf-8"))
    upload_body = json.loads(upload_path.read_text(encoding="utf-8"))
    case_id = query_body.get("caseId")
    if not case_id:
        _fail("e2e-query-body.json missing caseId")

    hdr = {"Accept": "application/json", "Content-Type": "application/json"}

    print("POST /login (police, first OTP for upload) …")
    r_login1 = requests.post(
        base + "/login",
        json={"username": args.police_user, "password": args.police_password},
        headers=hdr,
        timeout=60,
    )
    if r_login1.status_code != 200:
        _fail("Police login failed (first)", r_login1)
    j1 = r_login1.json()
    if j1.get("status") != "otp_sent":
        _fail(f"Expected otp_sent, got: {j1!r}", r_login1)

    otp_upload = _read_otp(
        "SEED_OTP_UPLOAD",
        "Paste upload OTP (16 hex, from MAIL_DRY_RUN gateway log after first police login): ",
    )
    if len(otp_upload) != 16 or any(c not in "0123456789abcdefABCDEF" for c in otp_upload):
        _fail("Upload OTP must be 16 hex characters")

    print("POST /api/upload …")
    r_up = requests.post(
        base + "/api/upload",
        json=upload_body,
        headers={**hdr, "X-Auth-Token": otp_upload},
        timeout=120,
    )
    if r_up.status_code != 200:
        _fail("POST /api/upload failed", r_up)

    print("POST /login (police, second OTP for session cookie) …")
    r_login2 = requests.post(
        base + "/login",
        json={"username": args.police_user, "password": args.police_password},
        headers=hdr,
        timeout=60,
    )
    if r_login2.status_code != 200:
        _fail("Police login failed (second)", r_login2)
    if r_login2.json().get("status") != "otp_sent":
        _fail("Expected otp_sent on second police login", r_login2)

    otp_session = _read_otp(
        "SEED_OTP_SESSION",
        "Paste session OTP (16 hex, from gateway log after second police login): ",
    )
    if len(otp_session) != 16 or any(c not in "0123456789abcdefABCDEF" for c in otp_session):
        _fail("Session OTP must be 16 hex characters")

    police = requests.Session()
    r_po = police.post(
        base + "/api/auth/police-otp",
        json={"username": args.police_user, "otp": otp_session},
        headers=hdr,
        timeout=60,
    )
    if r_po.status_code != 200:
        _fail("POST /api/auth/police-otp failed", r_po)

    print("Running gen-e2e-propose-body.js …")
    _run_node(gw, "scripts/gen-e2e-propose-body.js", sub_env)

    propose_path = gw / "e2e-propose-body.json"
    propose_body = json.loads(propose_path.read_text(encoding="utf-8"))

    print("POST /api/modify/propose …")
    r_prop = police.post(
        base + "/api/modify/propose",
        json=propose_body,
        headers=hdr,
        timeout=180,
    )
    if r_prop.status_code != 200:
        _fail("POST /api/modify/propose failed", r_prop)
    prop_json = r_prop.json()
    proposal_id = prop_json.get("proposalId")
    if not proposal_id:
        _fail(f"No proposalId in response: {prop_json!r}", r_prop)

    judge = requests.Session()
    print("POST /login (judge) …")
    r_j = judge.post(
        base + "/login",
        json={"username": args.judge_user, "password": args.judge_password},
        headers=hdr,
        timeout=60,
    )
    if r_j.status_code != 200:
        _fail("Judge login failed", r_j)

    print("POST /api/query …")
    r_q = judge.post(base + "/api/query", json=query_body, headers=hdr, timeout=120)
    if r_q.status_code != 200:
        _fail("POST /api/query failed", r_q)
    q_json = r_q.json()
    if not q_json.get("caseId"):
        _fail(f"Unexpected query body: {list(q_json.keys())}", r_q)

    pid_path = quote(str(proposal_id).strip(), safe="")
    mod_url = f"{base}/api/modify/{pid_path}"
    print(f"GET /api/modify/… ({proposal_id[:18]}…) …")
    r_m = judge.get(mod_url, headers={"Accept": "application/json"}, timeout=120)
    if r_m.status_code != 200:
        _fail("GET /api/modify/:proposalId failed", r_m)
    m_json = r_m.json()
    status = m_json.get("status")
    if status != "Pending":
        _fail(f"Expected proposal status Pending, got {status!r}", r_m)

    out = {
        "baseUrl": base,
        "caseId": case_id,
        "proposalId": proposal_id,
        "queryOk": True,
        "modifyPending": True,
    }
    RESULT_PATH.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")

    print("OK — case + Pending proposal seeded and verified.")
    print(f"  caseId:     {case_id}")
    print(f"  proposalId: {proposal_id}")
    print(f"  wrote:      {RESULT_PATH}")
    print("Example curl (save judge session first: curl -c judge-cookies.txt -X POST …/login …):")
    print(
        f'  curl -s -b judge-cookies.txt -X POST {base}/api/query -H "Content-Type: application/json" '
        f"--data-binary @{query_path.as_posix()}"
    )
    print(f"  curl -s -b judge-cookies.txt {mod_url}")


if __name__ == "__main__":
    main()
