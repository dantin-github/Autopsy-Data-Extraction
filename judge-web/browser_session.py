"""Persist judge gateway session in first-party browser cookies (survives full page refresh).

Streamlit ``st.session_state`` is cleared on browser reload; the API gateway cookie
(``gw.sid``) lives in the server-side ``requests.Session``. We mirror ``gw.sid`` and a
minimal user payload into JavaScript-readable cookies so a new Streamlit run can
re-seed the shared ``GatewayClient`` jar.

Do **not** store ``CookieManager`` in ``st.session_state`` — it breaks Streamlit and
can wipe auth. Use one manager per ``session_id`` in a module-level map instead.

Security: these cookies are not httpOnly (browser JS can read them). Use only on
trusted networks; logout clears them.
"""

from __future__ import annotations

import datetime
import json
import re
from typing import Any

import streamlit as st

try:
    from streamlit.runtime.scriptrunner import get_script_run_ctx
except Exception:  # pragma: no cover
    get_script_run_ctx = None  # type: ignore[assignment]

try:
    from extra_streamlit_components import CookieManager
except ImportError:  # pragma: no cover
    CookieManager = None  # type: ignore[misc, assignment]

COOKIE_SID = "jw_gw_sid"
COOKIE_USER = "jw_user_json"
_CM_KEY_PREFIX = "jw_cm"

_HYDRATE_ATTEMPTS = "_jw_cookie_hydrate_attempts"
_MAX_HYDRATE_RERUNS = 1

_cookie_managers: dict[str, Any] = {}


def _streamlit_session_id() -> str:
    if get_script_run_ctx is None:
        return "_default"
    try:
        ctx = get_script_run_ctx()
        if ctx is not None and getattr(ctx, "session_id", None) is not None:
            return str(ctx.session_id)
    except Exception:
        pass
    return "_default"


def _widget_key_for_session(sid: str) -> str:
    safe = re.sub(r"[^0-9a-zA-Z]+", "_", sid).strip("_") or "sess"
    return f"{_CM_KEY_PREFIX}_{safe}"


def _cookie_manager() -> Any:
    """One CookieManager per Streamlit browser session (not in session_state)."""
    if CookieManager is None:
        return None
    sid = _streamlit_session_id()
    if sid not in _cookie_managers:
        _cookie_managers[sid] = CookieManager(key=_widget_key_for_session(sid))
    return _cookie_managers[sid]


def drop_cookie_manager_for_current_session() -> None:
    """Remove manager for this session (e.g. full logout). Next use creates a fresh one."""
    sid = _streamlit_session_id()
    _cookie_managers.pop(sid, None)


def persist_judge_browser_session(gw_sid: str, user: dict[str, Any]) -> None:
    cm = _cookie_manager()
    if cm is None or not gw_sid or str(gw_sid).strip() == "":
        return
    exp = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)
    payload = {
        "userId": user.get("userId"),
        "username": user.get("username"),
        "role": user.get("role"),
    }
    try:
        cm.set(
            COOKIE_SID,
            str(gw_sid).strip(),
            expires_at=exp,
            same_site="lax",
            path="/",
        )
        cm.set(
            COOKIE_USER,
            json.dumps(payload, ensure_ascii=True),
            expires_at=exp,
            same_site="lax",
            path="/",
        )
    except Exception:
        # Login must still succeed if browser cookie sync fails
        pass


def clear_persisted_judge_browser_session() -> None:
    cm = _cookie_manager()
    if cm is None:
        return
    try:
        cm.delete(COOKIE_SID)
        cm.delete(COOKIE_USER)
    except Exception:
        pass
    st.session_state.pop(_HYDRATE_ATTEMPTS, None)
    # Do not drop the CookieManager here: recreating it in the same script run
    # reuses the same widget key and triggers StreamlitDuplicateElementKey.


def try_restore_judge_from_browser_cookies() -> None:
    """Repopulate ``st.session_state`` and ``get_gateway_client()`` from cookies after F5."""
    user = st.session_state.get("user")
    cookies_mirror = st.session_state.get("gw_cookies") or {}
    if (
        isinstance(user, dict)
        and str(user.get("role") or "").lower() == "judge"
        and cookies_mirror.get("gw.sid")
    ):
        st.session_state.pop(_HYDRATE_ATTEMPTS, None)
        return

    cm = _cookie_manager()
    if cm is None:
        return

    jar = cm.get_all()
    if jar is None:
        # First paint sometimes returns None before the component mounts; one rerun only.
        n = int(st.session_state.get(_HYDRATE_ATTEMPTS) or 0)
        if n < _MAX_HYDRATE_RERUNS:
            st.session_state[_HYDRATE_ATTEMPTS] = n + 1
            st.rerun()
        return

    st.session_state.pop(_HYDRATE_ATTEMPTS, None)

    sid = jar.get(COOKIE_SID)
    user_raw = jar.get(COOKIE_USER)
    if not sid or not user_raw:
        return
    try:
        user_obj = json.loads(str(user_raw))
    except json.JSONDecodeError:
        return
    if str(user_obj.get("role") or "").lower() != "judge":
        return

    from services.gateway_client import cookies_as_dict, get_gateway_client

    client = get_gateway_client()
    client.session.cookies.clear()
    try:
        from requests.cookies import create_cookie

        client.session.cookies.set_cookie(
            create_cookie("gw.sid", str(sid).strip(), path="/")
        )
    except Exception:
        client.session.cookies.set("gw.sid", str(sid).strip(), path="/")

    st.session_state["user"] = user_obj
    st.session_state["gw_cookies"] = cookies_as_dict(client)
