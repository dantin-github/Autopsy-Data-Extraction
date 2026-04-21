#!/usr/bin/env python3
"""
S6.1 — Seed one on-chain case + one Pending modify proposal for judge-web / smoke.

S6.2 prep — `--prepare-smoke` runs two independent cases (two Pending proposals) and
writes `tests/smoke_config.json` for `pytest tests/smoke.py`.

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
TESTS_DIR = Path(__file__).resolve().parent
DEFAULT_GATEWAY_DIR = REPO_ROOT / "api-gateway"
RESULT_PATH = TESTS_DIR / ".seed_fixture_result.json"
SMOKE_CONFIG_PATH = TESTS_DIR / "smoke_config.json"


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


def _hdr() -> dict[str, str]:
    return {"Accept": "application/json", "Content-Type": "application/json"}


def upload_propose_one_case(
    *,
    base: str,
    gw: Path,
    sub_env: dict[str, str],
    args: argparse.Namespace,
    se_upload: str,
    se_session: str,
    prompt_upload: str,
    prompt_session: str,
    propose_note: str | None = None,
) -> tuple[dict, str, str]:
    """
    One full upload + police session + propose cycle.
    Returns (query_body dict, case_id, proposal_id).
    """
    env = dict(sub_env)
    if propose_note:
        env["PROPOSE_NOTE"] = propose_note

    print("Running gen-e2e-upload-body.js …")
    _run_node(gw, "scripts/gen-e2e-upload-body.js", env)

    query_path = gw / "e2e-query-body.json"
    upload_path = gw / "e2e-upload-body.json"
    query_body = json.loads(query_path.read_text(encoding="utf-8"))
    upload_body = json.loads(upload_path.read_text(encoding="utf-8"))
    case_id = query_body.get("caseId")
    if not case_id:
        _fail("e2e-query-body.json missing caseId")

    hdr = _hdr()

    print("POST /login (police, OTP for upload) …")
    r_login1 = requests.post(
        base + "/login",
        json={"username": args.police_user, "password": args.police_password},
        headers=hdr,
        timeout=60,
    )
    if r_login1.status_code != 200:
        _fail("Police login failed (first)", r_login1)
    if r_login1.json().get("status") != "otp_sent":
        _fail(f"Expected otp_sent, got: {r_login1.json()!r}", r_login1)

    otp_upload = _read_otp(se_upload, prompt_upload)
    if len(otp_upload) != 16 or any(
        c not in "0123456789abcdefABCDEF" for c in otp_upload
    ):
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

    print("POST /login (police, OTP for session) …")
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

    otp_session = _read_otp(se_session, prompt_session)
    if len(otp_session) != 16 or any(
        c not in "0123456789abcdefABCDEF" for c in otp_session
    ):
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
    _run_node(gw, "scripts/gen-e2e-propose-body.js", env)

    propose_body = json.loads(
        (gw / "e2e-propose-body.json").read_text(encoding="utf-8")
    )

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

    return query_body, str(case_id), str(proposal_id)


def _health_check(base: str) -> None:
    try:
        r0 = requests.get(f"{base}/health", timeout=30)
        r0.raise_for_status()
        if r0.json().get("status") != "ok":
            _fail("GET /health did not return status=ok", r0)
    except requests.RequestException as e:
        _fail(f"GET /health failed: {e}")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="S6.1 seed / S6.2 --prepare-smoke (two Pending proposals)"
    )
    p.add_argument(
        "--base-url",
        default=os.environ.get("API_GATEWAY_URL", "http://127.0.0.1:3000").rstrip(
            "/"
        ),
        help="Gateway base URL",
    )
    p.add_argument(
        "--gateway-dir",
        type=Path,
        default=DEFAULT_GATEWAY_DIR,
        help="Path to api-gateway",
    )
    p.add_argument("--police-user", default="officer1")
    p.add_argument("--police-password", default="1")
    p.add_argument("--judge-user", default="judge1")
    p.add_argument("--judge-password", default="1")
    p.add_argument(
        "--record-store-path",
        default=os.environ.get("RECORD_STORE_PATH", "").strip() or None,
        help="Passed to Node gen-* scripts (must match running gateway)",
    )
    p.add_argument(
        "--prepare-smoke",
        action="store_true",
        help="Two cases + two Pending proposals → tests/smoke_config.json (S6.2)",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    gw: Path = args.gateway_dir.resolve()
    if not (gw / "scripts" / "gen-e2e-upload-body.js").is_file():
        _fail(f"api-gateway scripts not found under {gw}")

    sub_env = os.environ.copy()
    if args.record_store_path:
        sub_env["RECORD_STORE_PATH"] = args.record_store_path

    base = args.base_url.rstrip("/")
    print(f"Gateway: {base}")
    print(
        "Record store for Node helpers:",
        sub_env.get("RECORD_STORE_PATH", "(default ~/.case_record_store.json)"),
    )
    _health_check(base)

    if args.prepare_smoke:
        _run_prepare_smoke(base, gw, sub_env, args)
        return

    query_body, case_id, proposal_id = upload_propose_one_case(
        base=base,
        gw=gw,
        sub_env=sub_env,
        args=args,
        se_upload="SEED_OTP_UPLOAD",
        se_session="SEED_OTP_SESSION",
        prompt_upload=(
            "Paste upload OTP (16 hex, from MAIL_DRY_RUN gateway log): "
        ),
        prompt_session=(
            "Paste session OTP (16 hex, from gateway log after second police login): "
        ),
        propose_note=None,
    )

    hdr = _hdr()
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
    if not r_q.json().get("caseId"):
        _fail(f"Unexpected query body: {list(r_q.json().keys())}", r_q)

    pid_path = quote(str(proposal_id).strip(), safe="")
    mod_url = f"{base}/api/modify/{pid_path}"
    print(f"GET /api/modify/… ({proposal_id[:18]}…) …")
    r_m = judge.get(mod_url, headers={"Accept": "application/json"}, timeout=120)
    if r_m.status_code != 200:
        _fail("GET /api/modify/:proposalId failed", r_m)
    if r_m.json().get("status") != "Pending":
        _fail(f"Expected Pending, got {r_m.json().get('status')!r}", r_m)

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


def _run_prepare_smoke(
    base: str, gw: Path, sub_env: dict[str, str], args: argparse.Namespace
) -> None:
    import time

    ts = int(time.time() * 1000)
    note_a = f"v2-smoke-a-{ts}"
    note_b = f"v2-smoke-b-{ts}"

    print("\n=== Smoke case A (approve target) ===\n")
    qb_a, case_a, prop_a = upload_propose_one_case(
        base=base,
        gw=gw,
        sub_env=sub_env,
        args=args,
        se_upload="SEED_A_OTP_UPLOAD",
        se_session="SEED_A_OTP_SESSION",
        prompt_upload="[Case A] Upload OTP (16 hex): ",
        prompt_session="[Case A] Session OTP (16 hex): ",
        propose_note=note_a,
    )

    print("\n=== Smoke case B (reject target) ===\n")
    qb_b, case_b, prop_b = upload_propose_one_case(
        base=base,
        gw=gw,
        sub_env=sub_env,
        args=args,
        se_upload="SEED_B_OTP_UPLOAD",
        se_session="SEED_B_OTP_SESSION",
        prompt_upload="[Case B] Upload OTP (16 hex): ",
        prompt_session="[Case B] Session OTP (16 hex): ",
        propose_note=note_b,
    )

    rsp = sub_env.get("RECORD_STORE_PATH", "").strip()
    if not rsp:
        home = os.path.expanduser("~")
        rsp = str(Path(home) / ".case_record_store.json")

    cfg = {
        "baseUrl": base,
        "recordStorePath": str(Path(rsp).resolve()),
        "judgeUser": args.judge_user,
        "judgePassword": args.judge_password,
        "signingPassword": "1",
        "policeUser": args.police_user,
        "policePassword": args.police_password,
        "queryBody": qb_a,
        "approve": {"caseId": case_a, "proposalId": prop_a},
        "reject": {"caseId": case_b, "proposalId": prop_b},
    }
    SMOKE_CONFIG_PATH.write_text(
        json.dumps(cfg, indent=2) + "\n", encoding="utf-8"
    )

    print("\nWrote", SMOKE_CONFIG_PATH)
    print("  approve:", case_a, prop_a[:18] + "…")
    print("  reject: ", case_b, prop_b[:18] + "…")
    print("\nNext:")
    print("  1) POST /login as police once more; set SMOKE_POLICE_OTP for pytest role-gate test:")
    print("       PowerShell:  $env:SMOKE_POLICE_OTP='<16 hex>'")
    print("  2) pytest tests/smoke.py -v")


if __name__ == "__main__":
    main()
