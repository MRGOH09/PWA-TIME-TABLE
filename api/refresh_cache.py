from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _data import refresh_all_cached_data
from _lark import get_env, get_tenant_access_token, send_json


def _authorized(handler):
    secret = os.environ.get("CRON_SECRET", "").strip()
    if not secret:
        return False, "Missing CRON_SECRET"
    auth_header = handler.headers.get("Authorization", "")
    if auth_header != f"Bearer {secret}":
        return False, "Unauthorized"
    return True, ""


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ok, error = _authorized(self)
        if not ok:
            send_json(self, 401, {"success": False, "error": error})
            return
        try:
            env = get_env()
            token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
            result = refresh_all_cached_data(token, env)
            send_json(self, 200, {"success": True, **result})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
