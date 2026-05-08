from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import send_auth_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send_auth_json(self, 501, {
            "success": False,
            "error": "Lark OAuth login is not connected yet",
            "nextStep": "Implement redirect to Lark OAuth authorization URL.",
        })

    def log_message(self, format, *args):
        return
