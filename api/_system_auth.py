import base64
import hashlib
import hmac
import json
import os
import time


AUTH_COOKIE_NAME = "tuition_system_auth"
DEFAULT_SESSION_SECONDS = 60 * 60 * 8


def _configured_credentials():
    username = os.environ.get("SYSTEM_USERNAME", "").strip()
    password = os.environ.get("SYSTEM_PASSWORD", "").strip()
    if bool(username) != bool(password):
        raise RuntimeError("SYSTEM_USERNAME and SYSTEM_PASSWORD must both be set")
    return username, password


def auth_required():
    username, password = _configured_credentials()
    return bool(username and password)


def credentials_match(username, password):
    expected_username, expected_password = _configured_credentials()
    if not expected_username or not expected_password:
        return False
    return (
        hmac.compare_digest((username or "").strip(), expected_username)
        and hmac.compare_digest((password or "").strip(), expected_password)
    )


def _cookie_secret():
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


def _sign(payload):
    digest = hmac.new(_cookie_secret(), payload.encode("utf-8"), hashlib.sha256).digest()
    return _b64(digest)


def make_session_cookie(username, max_age=DEFAULT_SESSION_SECONDS):
    now = int(time.time())
    payload = {
        "username": username,
        "iat": now,
        "exp": now + max_age,
    }
    raw = _b64(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    return f"{raw}.{_sign(raw)}"


def parse_cookie_header(header):
    cookies = {}
    for part in (header or "").split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        cookies[key.strip()] = value.strip()
    return cookies


def current_user(handler):
    token = parse_cookie_header(handler.headers.get("Cookie")).get(AUTH_COOKIE_NAME)
    if not token or "." not in token:
        return None
    raw, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(_sign(raw), sig):
        return None
    try:
        payload = json.loads(_unb64(raw).decode("utf-8"))
    except Exception:
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    username = payload.get("username") or ""
    expected_username, _ = _configured_credentials()
    if not hmac.compare_digest(username, expected_username):
        return None
    return {"username": username}


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
