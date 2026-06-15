import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta

import requests

LARK_TOKEN_URL = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
LARK_RECORDS_URL = "https://open.larksuite.com/open-apis/bitable/v1/apps/{app}/tables/{table}/records"

REQUIRED_ENV = ("LARK_APP_ID", "LARK_APP_SECRET", "LARK_BASE_TOKEN", "LARK_TABLE_ID")

FIELD_NO = "No"
FIELD_CLASS = "Class"
FIELD_GRADE = "年纪"
FIELD_SUBJECT = "科目"
FIELD_DAY = "礼拜"
FIELD_TIME = "时间"
FIELD_BRANCH = "分行"
FIELD_MONTH = "月份"
FIELD_TEACHER_LOOKUP = "looklookup"
FIELD_LEVEL = "FORMULA 中小"
FIELD_NONE = "None"
FIELD_PRESENT = "Present"
FIELD_ABSENT = "Absent"
FIELD_TEACHER = "Teacher"
FIELD_TEACHER_DISPLAY = "LOOKUP老师名字"
FIELD_DATE_TEXT = "Date"
FIELD_DATE = "日期"


def get_env():
    env = {}
    for k in REQUIRED_ENV:
        v = os.environ.get(k)
        if not v:
            raise RuntimeError(f"Missing {k}")
        env[k] = v.strip()
    return env


def get_tenant_access_token(app_id, app_secret):
    resp = requests.post(
        LARK_TOKEN_URL,
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark token error: {data.get('msg', 'unknown')}")
    return data["tenant_access_token"]


def records_url(env, table_id=None):
    return LARK_RECORDS_URL.format(
        app=env["LARK_BASE_TOKEN"],
        table=table_id or env["LARK_TABLE_ID"],
    )


def fetch_all_records(token, env, table_id=None):
    headers = {"Authorization": f"Bearer {token}"}
    out = []
    page_token = None
    while True:
        params = {"page_size": 500}
        if page_token:
            params["page_token"] = page_token
        resp = requests.get(
            records_url(env, table_id=table_id),
            headers=headers,
            params=params,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"Lark records error: {data.get('msg', 'unknown')}")
        block = data.get("data", {}) or {}
        out.extend(block.get("items") or [])
        if not block.get("has_more"):
            break
        page_token = block.get("page_token")
        if not page_token:
            break
    return out


def extract_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        for k in ("text", "value", "name", "en_name"):
            if k in value and value[k] is not None:
                return extract_text(value[k])
        return ""
    if isinstance(value, list):
        parts = [extract_text(it) for it in value]
        joined = ", ".join([p for p in parts if p])
        return joined
    return str(value).strip()


def extract_first_text(value):
    """Lookup fields often arrive as [{text: '...'}] — return the first cell only."""
    if value is None:
        return ""
    if isinstance(value, list):
        for it in value:
            t = extract_text(it)
            if t:
                return t
        return ""
    return extract_text(value)


def extract_number(value, default=0):
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, list):
        return extract_number(value[0], default) if value else default
    if isinstance(value, dict):
        for k in ("text", "value"):
            if k in value:
                return extract_number(value[k], default)
        return default
    if isinstance(value, str):
        m = re.search(r"-?\d+", value)
        return int(m.group()) if m else default
    return default


def extract_date(value):
    """Lark date field may be epoch millis (number), ISO string, or wrapped dict.

    Always return ISO date 'YYYY-MM-DD' or '' if unknown.
    """
    if value is None or value == "":
        return ""
    if isinstance(value, list):
        return extract_date(value[0]) if value else ""
    if isinstance(value, dict):
        for k in ("value", "text"):
            if k in value:
                return extract_date(value[k])
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        try:
            ts = int(value)
            if ts > 1_000_000_000_000:
                ts = ts / 1000.0
            elif ts > 10_000_000_000:
                ts = ts / 1000.0
            dt = datetime.fromtimestamp(ts, tz=timezone(timedelta(hours=8)))
            return dt.strftime("%Y-%m-%d")
        except (ValueError, OSError, OverflowError):
            return ""
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return ""
        m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
        if m:
            y, mo, d = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
            return f"{y}-{mo}-{d}"
        m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
        if m:
            d, mo, y = m.group(1).zfill(2), m.group(2).zfill(2), m.group(3)
            return f"{y}-{mo}-{d}"
        return s
    return ""


def parse_day_order(day_str):
    if not day_str:
        return 99
    m = re.match(r"\s*(\d+)", str(day_str))
    return int(m.group(1)) if m else 99


def parse_month_order(month_str):
    if not month_str:
        return 99
    m = re.match(r"\s*(\d+)", str(month_str))
    return int(m.group(1)) if m else 99


def _parse_clock(piece):
    if not piece:
        return None
    t = str(piece).strip().upper().replace(" ", "")
    suffix = None
    if t.endswith("AM"):
        suffix = "AM"
        t = t[:-2]
    elif t.endswith("PM"):
        suffix = "PM"
        t = t[:-2]
    if not t:
        return None
    if ":" in t:
        try:
            hh, mm = t.split(":", 1)
            h = int(hh)
            mm = re.sub(r"\D", "", mm) or "0"
            m = int(mm)
        except ValueError:
            return None
    elif "." in t:
        try:
            hh, mm = t.split(".", 1)
            h = int(hh)
            mm = re.sub(r"\D", "", mm) or "0"
            m = int(mm)
        except ValueError:
            return None
    else:
        try:
            h = int(t)
            m = 0
        except ValueError:
            return None
    if suffix == "PM" and h < 12:
        h += 12
    elif suffix == "AM" and h == 12:
        h = 0
    if h < 0 or h > 24 or m < 0 or m > 59:
        return None
    return h * 60 + m


def parse_time_range(s):
    if not s:
        return (None, None)
    text = str(s).strip()
    text = re.sub(r"^\s*\d+\.\s*", "", text)
    for sep in ("—", "–", "～", "~", "至", "to", "TO"):
        text = text.replace(sep, "-")
    if "-" not in text:
        return (None, None)
    left, right = text.split("-", 1)
    return (_parse_clock(left), _parse_clock(right))


def normalize_record(item):
    fields = item.get("fields", {}) or {}

    branch = extract_text(fields.get(FIELD_BRANCH))
    day = extract_text(fields.get(FIELD_DAY))
    time_range = extract_text(fields.get(FIELD_TIME))
    start_min, end_min = parse_time_range(time_range)
    subject = extract_text(fields.get(FIELD_SUBJECT))
    grade = extract_text(fields.get(FIELD_GRADE))
    level = extract_text(fields.get(FIELD_LEVEL))
    teacher = extract_text(fields.get(FIELD_TEACHER))
    teacher_display = extract_first_text(fields.get(FIELD_TEACHER_DISPLAY)) or teacher
    teacher_lookup = extract_first_text(fields.get(FIELD_TEACHER_LOOKUP))
    month = extract_text(fields.get(FIELD_MONTH))
    date_iso = extract_date(fields.get(FIELD_DATE)) or extract_date(fields.get(FIELD_DATE_TEXT))

    none_count = extract_number(fields.get(FIELD_NONE), 0)
    present_count = extract_number(fields.get(FIELD_PRESENT), 0)
    absent_count = extract_number(fields.get(FIELD_ABSENT), 0)
    class_size = none_count + present_count + absent_count

    return {
        "recordId": item.get("record_id", ""),
        "no": extract_number(fields.get(FIELD_NO), 0),
        "branch": branch,
        "day": day,
        "dayOrder": parse_day_order(day),
        "timeRange": time_range,
        "startMinutes": start_min,
        "endMinutes": end_min,
        "subject": subject,
        "grade": grade,
        "level": level,
        "teacher": teacher,
        "teacherDisplay": teacher_display,
        "teacherLookup": teacher_lookup,
        "month": month,
        "monthOrder": parse_month_order(month),
        "date": date_iso,
        "none": none_count,
        "present": present_count,
        "absent": absent_count,
        "classSize": class_size,
    }


def send_json(handler, status, payload, cache_control="no-store"):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", cache_control)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def ensure_path():
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
