from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import cookie_header, make_session_cookie, send_auth_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if os.environ.get("ALLOW_DEV_LOGIN", "").strip().lower() not in ("1", "true", "yes", "on"):
            send_auth_json(self, 404, {"success": False, "error": "Dev login is disabled"})
            return
        user = {
            "id": "dev-user",
            "name": "开发测试用户",
            "source": "dev",
        }
        send_auth_json(
            self,
            200,
            {"success": True, "user": user},
            cookie=cookie_header(make_session_cookie(user)),
        )

    def log_message(self, format, *args):
        return
