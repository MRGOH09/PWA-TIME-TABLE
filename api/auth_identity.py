from http.server import BaseHTTPRequestHandler
from html import escape
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import current_user, send_redirect


def _field(user, key):
    return escape(str((user or {}).get(key) or ""))


def _row(label, value):
    shown = value or "没有返回"
    return (
        "<tr>"
        f"<th>{escape(label)}</th>"
        f"<td><code>{escape(shown)}</code></td>"
        "</tr>"
    )


def _send_html(handler, html):
    body = html.encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        user = current_user(self)
        if not user:
            send_redirect(self, "/api/auth_login")
            return

        open_id = _field(user, "open_id")
        email = _field(user, "email")
        preferred = (
            f"ALLOWED_EMAILS={email}"
            if email
            else f"ALLOWED_LARK_OPEN_IDS={open_id or _field(user, 'id')}"
        )
        html = f"""<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lark 登录身份</title>
  <style>
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.5;
    }}
    main {{
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 18px;
    }}
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
    th, td {{
      text-align: left;
      padding: 12px;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }}
    th {{ width: 150px; color: #94a3b8; font-weight: 600; }}
    tr:last-child th, tr:last-child td {{ border-bottom: 0; }}
    code {{
      color: #bbf7d0;
      word-break: break-all;
      white-space: pre-wrap;
    }}
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
  <h1>Lark 登录身份</h1>
  <p>把下面推荐的白名单变量复制到 Vercel Environment Variables。</p>
  <table>
    {_row("姓名", _field(user, "name"))}
    {_row("Email", email)}
    {_row("Open ID", open_id)}
    {_row("Union ID", _field(user, "union_id"))}
    {_row("User ID", _field(user, "user_id"))}
  </table>
  <div class="box">
    <strong>推荐复制这一行：</strong>
    <p><code>{escape(preferred)}</code></p>
    <p>如果 Email 显示“没有返回”，就用 <code>ALLOWED_LARK_OPEN_IDS</code>。</p>
  </div>
  <p><a href="/">回到 Dashboard</a></p>
</main>
</body>
</html>"""
        _send_html(self, html)

    def log_message(self, format, *args):
        return
