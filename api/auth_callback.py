from http.server import BaseHTTPRequestHandler
import os
import sys
from urllib.parse import parse_qs, urlparse

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import (
    clear_state_cookie_header,
    cookie_header,
    current_oauth_state,
    make_session_cookie,
    send_auth_json,
    send_redirect,
)


APP_TOKEN_URL = "https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal"
USER_TOKEN_URL = "https://open.larksuite.com/open-apis/authen/v1/access_token"
USER_INFO_URL = "https://open.larksuite.com/open-apis/authen/v1/user_info"


def _split_env(name):
    raw = os.environ.get(name, "")
    return {x.strip() for x in raw.replace("\n", ",").split(",") if x.strip()}


def _home_url(handler):
    configured = os.environ.get("AUTH_SUCCESS_URL", "").strip()
    if configured:
        return configured
    proto = handler.headers.get("X-Forwarded-Proto") or ("https" if os.environ.get("VERCEL") else "http")
    host = handler.headers.get("Host")
    return f"{proto}://{host}/"


def _get_app_access_token():
    app_id = os.environ.get("LARK_APP_ID", "").strip()
    app_secret = os.environ.get("LARK_APP_SECRET", "").strip()
    if not app_id or not app_secret:
        raise RuntimeError("Missing LARK_APP_ID or LARK_APP_SECRET")
    resp = requests.post(
        APP_TOKEN_URL,
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark app token error: {data.get('msg', 'unknown')}")
    return data.get("app_access_token")


def _exchange_code(code):
    app_access_token = _get_app_access_token()
    resp = requests.post(
        USER_TOKEN_URL,
        headers={"Authorization": f"Bearer {app_access_token}"},
        json={
            "grant_type": "authorization_code",
            "code": code,
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark user token error: {data.get('msg', 'unknown')}")
    block = data.get("data") or data
    token = block.get("access_token") or block.get("user_access_token")
    if not token:
        raise RuntimeError("Lark user token response missing access_token")
    return token


def _get_user_info(user_access_token):
    resp = requests.get(
        USER_INFO_URL,
        headers={"Authorization": f"Bearer {user_access_token}"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark user info error: {data.get('msg', 'unknown')}")
    return data.get("data") or {}


def _normalize_user(info):
    return {
        "id": info.get("open_id") or info.get("union_id") or info.get("user_id") or "",
        "open_id": info.get("open_id") or "",
        "union_id": info.get("union_id") or "",
        "user_id": info.get("user_id") or "",
        "email": info.get("email") or "",
        "name": info.get("name") or info.get("en_name") or info.get("email") or "Lark User",
        "avatar": info.get("avatar_url") or "",
        "source": "lark",
    }


def _is_allowed(user):
    open_ids = _split_env("ALLOWED_LARK_OPEN_IDS")
    emails = {x.lower() for x in _split_env("ALLOWED_EMAILS")}
    if not open_ids and not emails:
        return True
    ids = {user.get("open_id"), user.get("union_id"), user.get("user_id"), user.get("id")}
    if open_ids.intersection({x for x in ids if x}):
        return True
    email = (user.get("email") or "").lower()
    return bool(email and email in emails)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            if query.get("error"):
                send_auth_json(self, 400, {
                    "success": False,
                    "error": query.get("error", ["access_denied"])[0],
                    "errorDescription": query.get("error_description", [""])[0],
                }, cookie=clear_state_cookie_header())
                return

            code = (query.get("code") or [""])[0]
            state = (query.get("state") or [""])[0]
            expected_state = current_oauth_state(self)
            if not code:
                send_auth_json(self, 400, {"success": False, "error": "Missing code"})
                return
            if not state or state != expected_state:
                send_auth_json(self, 400, {"success": False, "error": "Invalid OAuth state"})
                return

            user_access_token = _exchange_code(code)
            user = _normalize_user(_get_user_info(user_access_token))
            if not _is_allowed(user):
                send_auth_json(self, 403, {
                    "success": False,
                    "error": "This Lark account is not allowed",
                    "user": user,
                }, cookie=clear_state_cookie_header())
                return

            send_redirect(
                self,
                _home_url(self),
                cookies=[
                    cookie_header(make_session_cookie(user)),
                    clear_state_cookie_header(),
                ],
            )
        except Exception as exc:
            send_auth_json(self, 500, {"success": False, "error": str(exc)}, cookie=clear_state_cookie_header())

    def log_message(self, format, *args):
        return
