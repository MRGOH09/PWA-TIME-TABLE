from datetime import datetime, timezone, timedelta
import os

from _lark import (
    create_record,
    extract_text,
    fetch_all_records,
    get_env,
    get_tenant_access_token,
)


FIELD_NAME = "姓名"
FIELD_PRIMARY = "Text"
FIELD_OPEN_ID = "Open ID"
FIELD_UNION_ID = "Union ID"
FIELD_USER_ID = "User ID"
FIELD_EMAIL = "Email"
FIELD_ALLOWED = "可以进入"
FIELD_STATUS = "状态"
FIELD_NOTE = "备注"
FIELD_LAST_LOGIN = "最后登录"

YES_VALUES = {"yes", "y", "true", "1", "allow", "allowed", "active", "启用", "允许", "可以", "是", "✅", "通过"}


def _now_text():
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")


def _truthy(value):
    text = extract_text(value).strip().lower()
    return text in YES_VALUES


def _user_ids(user):
    return {
        x for x in (
            user.get("open_id"),
            user.get("union_id"),
            user.get("user_id"),
            user.get("id"),
        ) if x
    }


def _matches_user(fields, user):
    ids = _user_ids(user)
    row_ids = {
        extract_text(fields.get(FIELD_OPEN_ID)),
        extract_text(fields.get(FIELD_UNION_ID)),
        extract_text(fields.get(FIELD_USER_ID)),
    }
    if ids.intersection({x for x in row_ids if x}):
        return True
    email = (user.get("email") or "").strip().lower()
    row_email = extract_text(fields.get(FIELD_EMAIL)).strip().lower()
    return bool(email and row_email and email == row_email)


def _pending_fields(user):
    name = user.get("name") or "Lark User"
    open_id = user.get("open_id") or ""
    return {
        FIELD_PRIMARY: f"{name} {open_id}".strip(),
        FIELD_NAME: name,
        FIELD_OPEN_ID: open_id,
        FIELD_UNION_ID: user.get("union_id") or "",
        FIELD_USER_ID: user.get("user_id") or "",
        FIELD_EMAIL: user.get("email") or "",
        FIELD_ALLOWED: "No",
        FIELD_STATUS: "待批准",
        FIELD_LAST_LOGIN: _now_text(),
        FIELD_NOTE: "自动登记：把“可以进入”改成 Yes 后，此用户下次登录即可进入。",
    }


def _env_allowed(user):
    raw_ids = os.environ.get("ALLOWED_LARK_OPEN_IDS", "")
    raw_emails = os.environ.get("ALLOWED_EMAILS", "")
    allowed_ids = {x.strip() for x in raw_ids.replace("\n", ",").split(",") if x.strip()}
    allowed_emails = {x.strip().lower() for x in raw_emails.replace("\n", ",").split(",") if x.strip()}
    if allowed_ids.intersection(_user_ids(user)):
        return True
    email = (user.get("email") or "").strip().lower()
    return bool(email and email in allowed_emails)


def check_access(user):
    """Return (allowed, detail). If LARK_AUTH_TABLE_ID is set, use Lark Base as the whitelist.

    Vercel env whitelist still works as a bootstrap/admin bypass.
    """
    if _env_allowed(user):
        return True, {"source": "env"}

    auth_table_id = os.environ.get("LARK_AUTH_TABLE_ID", "").strip()
    if not auth_table_id:
        return True, {"source": "open"}

    env = get_env()
    auth_base_token = os.environ.get("LARK_AUTH_BASE_TOKEN", "").strip()
    if auth_base_token:
        env = {**env, "LARK_BASE_TOKEN": auth_base_token}
    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    records = fetch_all_records(token, env, table_id=auth_table_id)
    for record in records:
        fields = record.get("fields", {}) or {}
        if not _matches_user(fields, user):
            continue
        allowed = _truthy(fields.get(FIELD_ALLOWED))
        return allowed, {
            "source": "lark_table",
            "registered": True,
            "recordId": record.get("record_id", ""),
            "status": "allowed" if allowed else "pending",
        }

    created = create_record(token, env, auth_table_id, _pending_fields(user))
    return False, {
        "source": "lark_table",
        "registered": False,
        "createdRecordId": created.get("record_id", ""),
        "status": "pending",
    }
