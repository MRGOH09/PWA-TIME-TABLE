from html import escape
from http.server import BaseHTTPRequestHandler
import os
import sys
from urllib.parse import parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _system_auth import (
    auth_required,
    auth_mode,
    cookie_header,
    credentials_match,
    current_user,
    google_authorize_url,
    make_legacy_session_cookie,
    send_redirect,
)


def _login_html(error=""):
    error_html = f'<p class="error">{escape(error)}</p>' if error else ""
    return f"""<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>系统登录</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #0f172a;
      --panel: #172033;
      --border: #334155;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --error: #fecaca;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    main {{
      width: min(100%, 380px);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 24px;
    }}
    h1 {{ margin: 0 0 6px; font-size: 24px; }}
    p {{ margin: 0 0 18px; color: var(--muted); }}
    label {{ display: block; margin-top: 14px; font-size: 13px; color: var(--muted); }}
    input {{
      width: 100%;
      margin-top: 6px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #0b1220;
      color: var(--text);
      padding: 11px 12px;
      font: inherit;
    }}
    button {{
      width: 100%;
      margin-top: 18px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      background: var(--accent);
      color: #082f49;
      padding: 11px 12px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }}
    .error {{ color: var(--error); margin: 10px 0 0; }}
  </style>
</head>
<body>
<main>
  <h1>系统登录</h1>
  <p>请输入系统用户名和密码。</p>
  {error_html}
  <form method="post" action="/api/auth_login">
    <label>用户名
      <input name="username" autocomplete="username" required autofocus>
    </label>
    <label>密码
      <input name="password" type="password" autocomplete="current-password" required>
    </label>
    <button type="submit">进入 Dashboard</button>
  </form>
</main>
</body>
</html>"""


def _send_html(handler, status, html):
    body = html.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            if not auth_required() or current_user(self):
                send_redirect(self, "/")
                return
            if auth_mode() == "google":
                send_redirect(self, google_authorize_url(self))
                return
            _send_html(self, 200, _login_html())
        except Exception as exc:
            self.send_error(500, str(exc))

    def do_POST(self):
        try:
            if not auth_required() or auth_mode() == "google":
                send_redirect(self, "/")
                return
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(min(length, 10000)).decode("utf-8", "replace")
            params = parse_qs(body)
            username = (params.get("username") or [""])[0]
            password = (params.get("password") or [""])[0]
            if credentials_match(username, password):
                session = make_legacy_session_cookie(username.strip())
                send_redirect(self, "/", cookies=[cookie_header(session)])
                return
            _send_html(self, 401, _login_html("用户名或密码不正确。"))
        except Exception as exc:
            self.send_error(500, str(exc))

    def log_message(self, format, *args):
        return
