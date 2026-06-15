from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _system_auth import auth_mode, auth_required, current_user, send_auth_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            required = auth_required()
            user = current_user(self) if required else None
            send_auth_json(self, 200, {
                "success": True,
                "authRequired": required,
                "authMode": auth_mode(),
                "authenticated": bool(user),
                "user": user,
            })
        except Exception as exc:
            send_auth_json(self, 500, {"success": False, "error": str(exc)})

    def log_message(self, format, *args):
        return
