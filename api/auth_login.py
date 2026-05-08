from http.server import BaseHTTPRequestHandler
import os
import sys
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import make_oauth_state, send_redirect, state_cookie_header


DEFAULT_AUTHORIZE_URL = "https://accounts.larksuite.com/open-apis/authen/v1/index"


def _redirect_uri(handler):
    configured = os.environ.get("AUTH_REDIRECT_URL", "").strip()
    if configured:
        return configured
    proto = handler.headers.get("X-Forwarded-Proto") or ("https" if os.environ.get("VERCEL") else "http")
    host = handler.headers.get("Host")
    return f"{proto}://{host}/api/auth_callback"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        app_id = os.environ.get("LARK_APP_ID", "").strip()
        if not app_id:
            from _auth import send_auth_json
            send_auth_json(self, 500, {"success": False, "error": "Missing LARK_APP_ID"})
            return

        state = make_oauth_state()
        params = {
            "app_id": app_id,
            "redirect_uri": _redirect_uri(self),
            "response_type": "code",
            "state": state,
        }
        scope = os.environ.get("LARK_OAUTH_SCOPE", "").strip()
        if scope:
            params["scope"] = scope
        authorize_url = os.environ.get("LARK_OAUTH_AUTHORIZE_URL", DEFAULT_AUTHORIZE_URL).strip()
        send_redirect(self, f"{authorize_url}?{urlencode(params)}", cookies=[state_cookie_header(state)])

    def log_message(self, format, *args):
        return
