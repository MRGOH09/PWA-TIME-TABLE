from html import escape
from http.server import BaseHTTPRequestHandler
import os
import sys
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _system_auth import (
    cookie_header,
    exchange_google_code,
    make_session_cookie,
    parse_oauth_state,
    send_redirect,
)


def _send_error(handler, status, message):
    body = f"""<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Google 登录失败</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #0f172a;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    main {{
      max-width: 520px;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #172033;
      padding: 24px;
    }}
    h1 {{ margin: 0 0 8px; font-size: 22px; }}
    p {{ color: #94a3b8; line-height: 1.6; }}
    a {{ color: #38bdf8; }}
  </style>
</head>
<body>
<main>
  <h1>Google 登录失败</h1>
  <p>{escape(message)}</p>
  <p><a href="/api/auth_login">重新登录</a></p>
</main>
</body>
</html>""".encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            params = parse_qs(urlparse(self.path).query)
            if params.get("error"):
                _send_error(self, 401, (params.get("error_description") or params["error"])[0])
                return
            code = (params.get("code") or [""])[0]
            state = (params.get("state") or [""])[0]
            if not code or not state:
                _send_error(self, 400, "Google callback 缺少 code 或 state。")
                return
            state_payload = parse_oauth_state(state)
            if not state_payload:
                _send_error(self, 400, "Google 登录 state 已失效，请重新登录。")
                return
            user = exchange_google_code(code, state_payload)
            session = make_session_cookie(user)
            send_redirect(self, "/", cookies=[cookie_header(session)])
        except Exception as exc:
            _send_error(self, 500, str(exc))

    def log_message(self, format, *args):
        return
