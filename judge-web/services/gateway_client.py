"""
HTTP client for the Case API Gateway (Phase S1.3).

Uses a requests.Session for cookie persistence (e.g. gw.sid after login).
All user-visible error strings are English (see .cursor/rules/english-only-ui.mdc).
"""

from __future__ import annotations

from typing import Any, Mapping, MutableMapping, Optional

import requests

DEFAULT_TIMEOUT_S = 30.0


class GatewayError(Exception):
    """HTTP error response from the gateway (non-2xx) with parsed JSON body."""

    def __init__(
        self,
        status: int,
        message: str,
        *,
        revert_reason: Optional[str] = None,
        body: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self.status = status
        self.message = message
        self.revert_reason = revert_reason
        self.body: Mapping[str, Any] = dict(body) if body else {}
        super().__init__(message)


class GatewayTransportError(Exception):
    """Network failure before a response status line is received (DNS, refused, timeout)."""

    pass


def _extract_revert_reason(data: Mapping[str, Any]) -> Optional[str]:
    ce = data.get("chainError")
    if not isinstance(ce, dict):
        return None
    r = ce.get("revertReason")
    if r is not None and str(r).strip() != "":
        return str(r).strip()
    r2 = ce.get("revert_reason")
    if r2 is not None and str(r2).strip() != "":
        return str(r2).strip()
    return None


class GatewayClient:
    """Thin wrapper around requests.Session for gateway REST calls."""

    def __init__(self, base_url: str, *, timeout: float = DEFAULT_TIMEOUT_S) -> None:
        self.base_url = str(base_url).rstrip("/")
        self.timeout = float(timeout)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "judge-web-dashboard/1.0",
            }
        )

    def _url(self, path: str) -> str:
        p = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}{p}"

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[MutableMapping[str, Any]] = None,
        params: Optional[Mapping[str, Any]] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
    ) -> dict[str, Any]:
        url = self._url(path)
        headers = dict(extra_headers) if extra_headers else None
        try:
            r = self.session.request(
                method,
                url,
                json=json_body,
                params=params,
                headers=headers,
                timeout=self.timeout,
            )
        except requests.exceptions.RequestException as e:
            raise GatewayTransportError(
                f"Cannot reach API gateway ({method} {path}): {e}"
            ) from e

        try:
            data: dict[str, Any] = r.json() if r.content else {}
        except ValueError:
            data = {}

        if not r.ok:
            err_msg = str(data.get("error") or r.reason or "Request failed")
            rev = _extract_revert_reason(data)
            raise GatewayError(
                r.status_code, err_msg, revert_reason=rev, body=data
            )

        return data

    def get_health(self) -> dict[str, Any]:
        """GET /health — no auth."""
        return self._request_json("GET", "/health")

    def post_login(self, username: str, password: str) -> dict[str, Any]:
        """
        POST /login — JSON body; for judges, response includes redirect URL and Set-Cookie.
        """
        return self._request_json(
            "POST",
            "/login",
            json_body={"username": username, "password": password},
            extra_headers={"Accept": "application/json"},
        )

    def post_query(self, case_id: str) -> dict[str, Any]:
        """POST /api/query — requires judge session cookie."""
        return self._request_json("POST", "/api/query", json_body={"caseId": case_id})

    def get_modify(self, proposal_id: str) -> dict[str, Any]:
        """GET /api/modify/:proposalId — police or judge session."""
        pid = str(proposal_id).strip()
        return self._request_json("GET", f"/api/modify/{pid}")

    def post_approve(self, proposal_id: str, signing_password: str) -> dict[str, Any]:
        """POST /api/modify/approve — judge session."""
        return self._request_json(
            "POST",
            "/api/modify/approve",
            json_body={
                "proposalId": proposal_id,
                "signingPassword": signing_password,
            },
        )

    def post_reject(
        self, proposal_id: str, signing_password: str, reason: str
    ) -> dict[str, Any]:
        """POST /api/modify/reject — judge session."""
        return self._request_json(
            "POST",
            "/api/modify/reject",
            json_body={
                "proposalId": proposal_id,
                "signingPassword": signing_password,
                "reason": reason,
            },
        )

    def get_audit(
        self, *, limit: int = 50, since: Optional[str] = None
    ) -> dict[str, Any]:
        """GET /api/audit — judge session."""
        params: dict[str, Any] = {"limit": limit}
        if since is not None and str(since).strip() != "":
            params["since"] = str(since).strip()
        return self._request_json("GET", "/api/audit", params=params)


def get_client() -> GatewayClient:
    """Build a client using API_GATEWAY_URL from config (judge-web/.env)."""
    import config

    return GatewayClient(config.get_api_gateway_url(), timeout=DEFAULT_TIMEOUT_S)
