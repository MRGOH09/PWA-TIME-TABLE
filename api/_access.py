import os
import re

from _lark import extract_text, fetch_all_records


FIELD_NAME = "名字"
FIELD_FULL_NAME = "名字全名"
FIELD_LARK_ACCOUNT = "飞书账户"
FIELD_GMAIL = "GMAIL"
FIELD_TIMETABLE_PERMISSION = "时间表权限"

PERMISSION_GLOBAL = "全局"
PERMISSION_PERSONAL = "个人"
PERMISSION_SECONDARY_SCIENCE = "中学科学"
PERMISSION_SECONDARY_STEM = "中学理科"
PERMISSION_SECONDARY_CHINESE = "中学华语"


def _split_multi(value):
    text = extract_text(value)
    if not text:
        return []
    return [p.strip() for p in re.split(r"[\n,，;/|]+", text) if p.strip()]


def _norm(value):
    text = extract_text(value).lower()
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]+", "", text)


def _name_tokens(value):
    out = set()
    for part in _split_multi(value):
        n = _norm(part)
        if n:
            out.add(n)
            for prefix in ("ms", "mr"):
                if n.startswith(prefix) and len(n) > len(prefix):
                    out.add(n[len(prefix):])
    n = _norm(value)
    if n:
        out.add(n)
        for prefix in ("ms", "mr"):
            if n.startswith(prefix) and len(n) > len(prefix):
                out.add(n[len(prefix):])
    return out


def _profile_from_record(item):
    fields = item.get("fields", {}) or {}
    emails = [_norm(e) for e in _split_multi(fields.get(FIELD_GMAIL))]
    emails = [e for e in emails if e]
    name = extract_text(fields.get(FIELD_NAME))
    lark_account = extract_text(fields.get(FIELD_LARK_ACCOUNT))
    full_name = extract_text(fields.get(FIELD_FULL_NAME))
    permission = extract_text(fields.get(FIELD_TIMETABLE_PERMISSION)) or PERMISSION_PERSONAL
    match_tokens = set()
    for value in (name, lark_account, full_name):
        match_tokens.update(_name_tokens(value))
    return {
        "emails": emails,
        "name": name,
        "fullName": full_name,
        "larkAccount": lark_account,
        "permission": permission,
        "matchTokens": sorted(match_tokens),
    }


def permission_env(env):
    table_id = os.environ.get("LARK_PERMISSION_TABLE_ID", "").strip()
    if not table_id:
        raise RuntimeError("Missing LARK_PERMISSION_TABLE_ID")
    permission_env = dict(env)
    permission_env["LARK_TABLE_ID"] = table_id
    permission_base = os.environ.get("LARK_PERMISSION_BASE_TOKEN", "").strip()
    if permission_base:
        permission_env["LARK_BASE_TOKEN"] = permission_base
    return permission_env


def build_access_profiles(records):
    return [_profile_from_record(item) for item in records]


def load_access_profile_from_profiles(user, profiles):
    email = _norm((user or {}).get("email"))
    if not email:
        return None
    for profile in profiles or []:
        if email in profile["emails"]:
            return profile
    return None


def load_access_profile(user, token, env):
    raw = fetch_all_records(token, permission_env(env))
    return load_access_profile_from_profiles(user, build_access_profiles(raw))


def record_matches_profile(record, profile):
    tokens = set()
    for key in ("teacher", "teacherDisplay", "teacherLookup"):
        tokens.update(_name_tokens(record.get(key)))
    return bool(tokens & set(profile.get("matchTokens") or []))


def filter_records_for_profile(records, profile):
    if not profile:
        return []
    permission = profile.get("permission") or PERMISSION_PERSONAL
    if permission == PERMISSION_GLOBAL:
        return list(records)
    if permission == PERMISSION_SECONDARY_SCIENCE:
        return [
            r for r in records
            if record_matches_profile(r, profile)
            or (
                r.get("level") == "中学"
                and str(r.get("subject") or "").upper() == "SN"
            )
        ]
    if permission == PERMISSION_SECONDARY_STEM:
        return [
            r for r in records
            if r.get("level") == "中学"
            and str(r.get("subject") or "").upper() in {"BIO", "PHY", "CHEM"}
        ]
    if permission == PERMISSION_SECONDARY_CHINESE:
        return [
            r for r in records
            if r.get("level") == "中学" and str(r.get("subject") or "").upper() == "BC"
        ]
    return [r for r in records if record_matches_profile(r, profile)]


def public_access_summary(profile, count):
    if not profile:
        return None
    return {
        "name": profile.get("name") or "",
        "permission": profile.get("permission") or PERMISSION_PERSONAL,
        "recordCount": count,
    }
