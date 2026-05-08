from http.server import BaseHTTPRequestHandler
import os
import sys
from urllib.parse import parse_qs, urlparse
from html import escape

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _access import check_access
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
    return check_access(user)


def _send_denied_html(handler, user, detail):
    rows = [
        ("姓名", user.get("name") or ""),
        ("Email", user.get("email") or "没有返回"),
        ("Open ID", user.get("open_id") or ""),
        ("Union ID", user.get("union_id") or ""),
        ("状态", "已登记，等待管理员批准" if detail.get("status") == "pending" else "没有权限"),
    ]
    table_rows = "".join(
        "<tr>"
        f"<th>{escape(label)}</th>"
        f"<td><code>{escape(value)}</code></td>"
        "</tr>"
        for label, value in rows
    )
    body = f"""<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>等待批准</title>
  <style>
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.5;
    }}
    main {{ max-width: 760px; margin: 0 auto; padding: 32px 18px; }}
    h1 {{ font-size: 24px; margin: 0 0 6px; }}
    p {{ color: #94a3b8; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      overflow: hidden;
      margin: 18px 0;
    }}
    th, td {{ text-align: left; padding: 12px; border-bottom: 1px solid #334155; }}
    th {{ width: 150px; color: #94a3b8; font-weight: 600; }}
    tr:last-child th, tr:last-child td {{ border-bottom: 0; }}
    code {{ color: #bbf7d0; word-break: break-all; }}
    .box {{
      background: #172033;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 14px;
      margin-top: 14px;
    }}
    a {{ color: #38bdf8; }}
  </style>
</head>
<body>
<main>
  <h1>等待管理员批准</h1>
  <p>你的 Lark 身份已经登记到权限表。管理员把“可以进入”改成 Yes 后，你再登录一次就能进入 dashboard。</p>
  <table>{table_rows}</table>
  <div class="box">
    <strong>管理员要做什么？</strong>
    <p>打开 Lark Base 的权限表，找到上面的名字或 Open ID，把 <code>可以进入</code> 改成 <code>Yes</code>。</p>
  </div>
  <p><a href="/api/auth_login">重新登录</a></p>
</main>
</body>
</html>""".encode("utf-8")
    handler.send_response(403)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Set-Cookie", clear_state_cookie_header())
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


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
            allowed, access_detail = _is_allowed(user)
            if not allowed:
                _send_denied_html(self, user, access_detail)
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
