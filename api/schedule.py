from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (
    get_env,
    get_tenant_access_token,
    send_json,
)
from _access import filter_records_for_profile, load_access_profile_from_profiles, public_access_summary
from _data import get_access_profiles, get_schedule_records
from _system_auth import auth_mode, auth_required, current_user


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            requires_auth = auth_required()
            user = current_user(self)
            if requires_auth and not user:
                send_json(self, 401, {"success": False, "error": "Unauthorized"})
                return
            env = get_env()
            token = None

            def get_token():
                nonlocal token
                if not token:
                    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
                return token

            records, schedule_cache = get_schedule_records(get_token, env)
            access = None
            permission_cache = None
            if auth_mode() == "google":
                profiles, permission_cache = get_access_profiles(get_token, env)
                profile = load_access_profile_from_profiles(user, profiles)
                if not profile:
                    send_json(self, 403, {
                        "success": False,
                        "error": "No timetable permission found for this Google account",
                    })
                    return
                records = filter_records_for_profile(records, profile)
                access = public_access_summary(profile, len(records))
            tz = timezone(timedelta(hours=8))
            cache_control = (
                "private, no-store"
                if requires_auth
                else "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
            )
            send_json(self, 200, {
                "success": True,
                "updatedAt": schedule_cache.get("fetchedAt") or datetime.now(tz).isoformat(timespec="seconds"),
                "count": len(records),
                "access": access,
                "cache": {
                    "schedule": schedule_cache,
                    "permissions": permission_cache,
                },
                "records": records,
            }, cache_control=cache_control)
        except Exception as exc:
            # Errors stay no-store so a transient Lark failure won't get cached.
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
