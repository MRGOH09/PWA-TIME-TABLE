import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import urlencode

import requests


AUTH_COOKIE_NAME = "tuition_google_auth"
STATE_MAX_AGE_SECONDS = 10 * 60
DEFAULT_SESSION_SECONDS = 60 * 60 * 8
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _configured_system_credentials():
    username = os.environ.get("SYSTEM_USERNAME", "").strip()
    password = os.environ.get("SYSTEM_PASSWORD", "").strip()
    if bool(username) != bool(password):
        raise RuntimeError("SYSTEM_USERNAME and SYSTEM_PASSWORD must both be set")
    return username, password


def google_auth_configured():
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    if bool(client_id) != bool(client_secret):
        raise RuntimeError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set")
    return bool(client_id and client_secret)


def auth_mode():
    if google_auth_configured():
        return "google"
    username, password = _configured_system_credentials()
    if username and password:
        return "system"
    return "none"


def auth_required():
    return auth_mode() != "none"


def credentials_match(username, password):
    expected_username, expected_password = _configured_system_credentials()
    if not expected_username or not expected_password:
        return False
    return (
        hmac.compare_digest((username or "").strip(), expected_username)
        and hmac.compare_digest((password or "").strip(), expected_password)
    )


def _cookie_secret():
    secret = os.environ.get("GOOGLE_AUTH_SECRET", "").strip()
    if secret:
        return secret.encode("utf-8")
    secret = os.environ.get("SYSTEM_AUTH_SECRET", "").strip()
    if secret:
        return secret.encode("utf-8")
    password = os.environ.get("SYSTEM_PASSWORD", "").strip()
    if password:
        return password.encode("utf-8")
    fallback = os.environ.get("LARK_APP_SECRET", "").strip()
    if fallback:
        return fallback.encode("utf-8")
    return b"dev-only-change-me"


def _b64(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(data):
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + pad).encode("ascii"))


def _json_b64(payload):
    return _b64(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _sign(raw):
    digest = hmac.new(_cookie_secret(), raw.encode("utf-8"), hashlib.sha256).digest()
    return _b64(digest)


def _pack(payload):
    raw = _json_b64(payload)
    return f"{raw}.{_sign(raw)}"


def _unpack(token):
    if not token or "." not in token:
        return None
    raw, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(_sign(raw), sig):
        return None
    try:
        return json.loads(_unb64(raw).decode("utf-8"))
    except Exception:
        return None


def parse_cookie_header(header):
    cookies = {}
    for part in (header or "").split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        cookies[key.strip()] = value.strip()
    return cookies


def _public_origin(handler):
    proto = (
        handler.headers.get("X-Forwarded-Proto")
        or ("https" if os.environ.get("VERCEL") else "http")
    ).split(",")[0].strip()
    host = (
        handler.headers.get("X-Forwarded-Host")
        or handler.headers.get("Host")
        or os.environ.get("VERCEL_URL", "")
    ).split(",")[0].strip()
    if host and not host.startswith("http"):
        return f"{proto}://{host}"
    return host.rstrip("/")


def redirect_uri(handler):
    configured = os.environ.get("GOOGLE_REDIRECT_URI", "").strip()
    if configured:
        return configured
    origin = _public_origin(handler).rstrip("/")
    if not origin:
        raise RuntimeError("Cannot determine Google OAuth redirect URI")
    return f"{origin}/api/auth_callback"


def make_oauth_state(handler):
    payload = {
        "nonce": secrets.token_urlsafe(16),
        "iat": int(time.time()),
        "exp": int(time.time()) + STATE_MAX_AGE_SECONDS,
        "redirect_uri": redirect_uri(handler),
    }
    return _pack(payload)


def parse_oauth_state(state):
    payload = _unpack(state)
    if not payload:
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    return payload


def google_authorize_url(handler):
    if not google_auth_configured():
        raise RuntimeError("Google auth is not configured")
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"].strip(),
        "redirect_uri": redirect_uri(handler),
        "response_type": "code",
        "scope": "openid email profile",
        "state": make_oauth_state(handler),
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def exchange_google_code(code, state_payload):
    data = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"].strip(),
        "client_secret": os.environ["GOOGLE_CLIENT_SECRET"].strip(),
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": state_payload["redirect_uri"],
    }
    resp = requests.post(GOOGLE_TOKEN_URL, data=data, timeout=15)
    resp.raise_for_status()
    token_data = resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise RuntimeError("Google token response did not include access_token")
    user_resp = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    user_resp.raise_for_status()
    user = user_resp.json()
    email = (user.get("email") or "").strip().lower()
    if not email:
        raise RuntimeError("Google account did not return an email")
    if user.get("email_verified") is False:
        raise RuntimeError("Google account email is not verified")
    return {
        "email": email,
        "name": (user.get("name") or email).strip(),
        "picture": (user.get("picture") or "").strip(),
        "sub": (user.get("sub") or "").strip(),
    }


def make_session_cookie(user, max_age=DEFAULT_SESSION_SECONDS):
    now = int(time.time())
    payload = {
        "mode": "google",
        "email": (user.get("email") or "").strip().lower(),
        "name": (user.get("name") or "").strip(),
        "picture": (user.get("picture") or "").strip(),
        "sub": (user.get("sub") or "").strip(),
        "iat": now,
        "exp": now + max_age,
    }
    return _pack(payload)


def make_legacy_session_cookie(username, max_age=DEFAULT_SESSION_SECONDS):
    now = int(time.time())
    payload = {
        "mode": "system",
        "username": username,
        "iat": now,
        "exp": now + max_age,
    }
    return _pack(payload)


def current_user(handler):
    token = parse_cookie_header(handler.headers.get("Cookie")).get(AUTH_COOKIE_NAME)
    payload = _unpack(token)
    if not payload:
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    mode = auth_mode()
    if mode == "google":
        if payload.get("mode") != "google":
            return None
        email = (payload.get("email") or "").strip().lower()
        if not email:
            return None
        return {
            "authMode": "google",
            "email": email,
            "name": (payload.get("name") or email).strip(),
            "picture": (payload.get("picture") or "").strip(),
            "sub": (payload.get("sub") or "").strip(),
        }
    if mode == "system":
        if payload.get("mode") != "system":
            return None
        username = payload.get("username") or ""
        expected_username, _ = _configured_system_credentials()
        if not hmac.compare_digest(username, expected_username):
            return None
        return {"authMode": "system", "username": username}
    return None


def cookie_header(value, max_age=DEFAULT_SESSION_SECONDS):
    secure = "Secure; " if os.environ.get("VERCEL") else ""
    return (
        f"{AUTH_COOKIE_NAME}={value}; Max-Age={max_age}; Path=/; "
        f"{secure}HttpOnly; SameSite=Lax"
    )


def clear_cookie_header():
    secure = "Secure; " if os.environ.get("VERCEL") else ""
    return f"{AUTH_COOKIE_NAME}=; Max-Age=0; Path=/; {secure}HttpOnly; SameSite=Lax"


def send_auth_json(handler, status, payload, cookie=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    if cookie:
        handler.send_header("Set-Cookie", cookie)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def send_redirect(handler, location, cookies=None):
    handler.send_response(302)
    handler.send_header("Location", location)
    handler.send_header("Cache-Control", "no-store")
    for cookie in cookies or []:
        if cookie:
            handler.send_header("Set-Cookie", cookie)
    handler.end_headers()
