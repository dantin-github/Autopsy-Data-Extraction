#!/usr/bin/env python3
"""
S6.3 — Record a HAR of the api-gateway REST sequence equivalent to judge workflow:
  health → judge login → /api/query → GET /api/modify/:id (Pending) →
  POST /api/modify/approve → GET /api/audit

Uses Playwright (Chromium) so requests originate from http://localhost:3000 and are
captured in the HAR. The Streamlit UI (:8501) talks to the gateway from the server;
this file captures the same gateway endpoints the Python client uses.

Prerequisites:
  pip install -r tests/requirements-har.txt
  playwright install chromium

Run AFTER tests/smoke_config.json exists (prepare-smoke) and BEFORE pytest smoke
if you need the approve proposal still Pending; or use a fresh prepare-smoke.

  python tests/record_gateway_har.py --out docs/evidence/judge-web/network/approve-flow.har
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = Path(__file__).resolve().parent / "smoke_config.json"


def _fail(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


def main() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        _fail(
            "Playwright not installed. Run:\n"
            "  python -m pip install -r tests/requirements-har.txt\n"
            "  playwright install chromium"
        )

    p = argparse.ArgumentParser(description="Record api-gateway HAR (S6.3)")
    p.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("SMOKE_CONFIG", str(DEFAULT_CONFIG))),
    )
    p.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT
        / "docs"
        / "evidence"
        / "judge-web"
        / "network"
        / "approve-flow.har",
    )
    args = p.parse_args()

    if not args.config.is_file():
        _fail(
            f"Missing {args.config}. Run: python tests/seed_fixtures.py --prepare-smoke ..."
        )

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    base = str(cfg["baseUrl"]).rstrip("/")
    judge_user = cfg["judgeUser"]
    judge_pw = cfg["judgePassword"]
    sign_pw = cfg["signingPassword"]
    query_body = cfg["queryBody"]
    pid = str(cfg["approve"]["proposalId"]).strip()
    pid_enc = quote(pid, safe="")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    har_path = str(args.out.resolve())

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(record_har_path=har_path, record_har_mode="full")
        page = context.new_page()
        try:
            page.goto(f"{base}/login", wait_until="domcontentloaded", timeout=60_000)

            st = page.evaluate(
                """async () => {
                  const r = await fetch('/health', { credentials: 'omit' });
                  return { status: r.status };
                }"""
            )
            if st["status"] != 200:
                _fail(f"/health failed: {st}")

            st = page.evaluate(
                """async ({ user, password }) => {
                  const r = await fetch('/login', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                    },
                    body: JSON.stringify({ username: user, password: password }),
                  });
                  return { status: r.status, body: await r.json().catch(() => ({})) };
                }""",
                {"user": judge_user, "password": judge_pw},
            )
            if st["status"] != 200:
                _fail(f"login failed: {st}")

            st = page.evaluate(
                """async (body) => {
                  const r = await fetch('/api/query', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                    },
                    body: JSON.stringify(body),
                  });
                  return { status: r.status };
                }""",
                query_body,
            )
            if st["status"] != 200:
                _fail(f"/api/query failed: {st}")

            st = page.evaluate(
                """async (url) => {
                  const r = await fetch(url, {
                    method: 'GET',
                    credentials: 'include',
                    headers: { Accept: 'application/json' },
                  });
                  return { status: r.status };
                }""",
                f"/api/modify/{pid_enc}",
            )
            if st["status"] != 200:
                _fail(f"GET /api/modify failed: {st}")

            st = page.evaluate(
                """async ({ proposalId, signingPassword }) => {
                  const r = await fetch('/api/modify/approve', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                    },
                    body: JSON.stringify({ proposalId, signingPassword }),
                  });
                  return { status: r.status };
                }""",
                {"proposalId": pid, "signingPassword": sign_pw},
            )
            if st["status"] != 200:
                _fail(f"/api/modify/approve failed: {st}")

            st = page.evaluate(
                """async () => {
                  const r = await fetch('/api/audit?limit=50', {
                    method: 'GET',
                    credentials: 'include',
                    headers: { Accept: 'application/json' },
                  });
                  return { status: r.status };
                }"""
            )
            if st["status"] != 200:
                _fail(f"/api/audit failed: {st}")

        finally:
            context.close()
            browser.close()

    print(f"Wrote HAR: {har_path}")


if __name__ == "__main__":
    main()
