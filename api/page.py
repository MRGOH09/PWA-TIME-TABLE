from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import auth_required, current_user, send_redirect


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if auth_required() and not current_user(self):
            send_redirect(self, "/api/auth_login")
            return

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        index_path = os.path.join(root, "index.html")
        with open(index_path, "rb") as fh:
            body = fh.read()

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return
