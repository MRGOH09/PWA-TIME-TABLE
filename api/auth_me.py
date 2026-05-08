from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import auth_required, current_user, send_auth_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        user = current_user(self)
        send_auth_json(self, 200, {
            "success": True,
            "authRequired": auth_required(),
            "authenticated": bool(user),
            "user": user,
        })

    def log_message(self, format, *args):
        return
