from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _system_auth import clear_cookie_header, send_auth_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send_auth_json(self, 200, {"success": True}, cookie=clear_cookie_header())

    def do_POST(self):
        self.do_GET()

    def log_message(self, format, *args):
        return
