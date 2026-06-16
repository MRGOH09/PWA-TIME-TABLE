import base64
import hashlib
import json
import os
import re
import time
import zlib
from datetime import datetime, timezone, timedelta

import requests


DEFAULT_FRESH_SECONDS = 300
DEFAULT_STALE_SECONDS = 86400
CACHE_VERSION = 1
_ENCODING_PREFIX = "zlib64:"
_MEMORY_CACHE = {}


def _int_env(name, default, minimum=1):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, value)


def cache_fresh_seconds():
    return _int_env("SCHEDULE_CACHE_TTL_SECONDS", DEFAULT_FRESH_SECONDS, minimum=30)


def cache_stale_seconds():
    fresh = cache_fresh_seconds()
    stale = _int_env("SCHEDULE_CACHE_STALE_SECONDS", DEFAULT_STALE_SECONDS, minimum=fresh)
    return max(stale, fresh)


def make_cache_key(name, *parts):
    namespace = os.environ.get("SCHEDULE_CACHE_NAMESPACE", "pwa-time-table").strip()
    namespace = re.sub(r"[^a-zA-Z0-9:_-]+", "-", namespace) or "pwa-time-table"
    safe_name = re.sub(r"[^a-zA-Z0-9:_-]+", "-", str(name)) or "cache"
    digest = hashlib.sha256("\n".join(str(p or "") for p in parts).encode("utf-8")).hexdigest()[:20]
    return f"{namespace}:v{CACHE_VERSION}:{safe_name}:{digest}"


def _redis_config():
    url = (
        os.environ.get("KV_REST_API_URL", "").strip()
        or os.environ.get("UPSTASH_REDIS_REST_URL", "").strip()
    )
    token = (
        os.environ.get("KV_REST_API_TOKEN", "").strip()
        or os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
    )
    if not url or not token:
        return None
    return url.rstrip("/"), token


def redis_configured():
    return bool(_redis_config())


def _now():
    return time.time()


def _iso(ts):
    tz = timezone(timedelta(hours=8))
    return datetime.fromtimestamp(ts, tz=tz).isoformat(timespec="seconds")


def _encode_entry(entry):
    body = json.dumps(entry, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return _ENCODING_PREFIX + base64.b64encode(zlib.compress(body, level=6)).decode("ascii")


def _decode_entry(value):
    if not value:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if value.startswith(_ENCODING_PREFIX):
        raw = base64.b64decode(value[len(_ENCODING_PREFIX):].encode("ascii"))
        return json.loads(zlib.decompress(raw).decode("utf-8"))
    return json.loads(value)


def _redis_command(command, timeout=6):
    config = _redis_config()
    if not config:
        raise RuntimeError("Redis is not configured")
    url, token = config
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=command,
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise RuntimeError(f"Redis error: {data['error']}")
    return data.get("result")


def _read_redis(key):
    result = _redis_command(["GET", key], timeout=4)
    return _decode_entry(result) if result else None


def _write_redis(key, entry):
    ttl = max(1, int(entry["staleUntil"] - _now()))
    _redis_command(["SET", key, _encode_entry(entry), "EX", ttl], timeout=8)


def _read_memory(key):
    entry = _MEMORY_CACHE.get(key)
    if not entry:
        return None
    if _now() > float(entry.get("staleUntil", 0)):
        _MEMORY_CACHE.pop(key, None)
        return None
    return entry


def _write_memory(key, entry):
    _MEMORY_CACHE[key] = entry


def _read_cache(key):
    warnings = []
    if redis_configured():
        try:
            entry = _read_redis(key)
            if entry:
                return entry, "redis", warnings
        except Exception as exc:
            warnings.append(f"Redis read failed: {exc}")
    entry = _read_memory(key)
    if entry:
        return entry, "memory", warnings
    return None, "miss", warnings


def _new_entry(kind, payload, fresh_seconds=None, stale_seconds=None):
    now = _now()
    fresh = fresh_seconds or cache_fresh_seconds()
    stale = stale_seconds or cache_stale_seconds()
    return {
        "version": CACHE_VERSION,
        "kind": kind,
        "fetchedAt": now,
        "freshUntil": now + fresh,
        "staleUntil": now + max(fresh, stale),
        "payload": payload,
    }


def _meta(entry, backend, status, warnings=None):
    now = _now()
    warnings = warnings or []
    meta = {
        "status": status,
        "backend": backend,
        "fetchedAt": _iso(float(entry.get("fetchedAt", now))),
        "freshUntil": _iso(float(entry.get("freshUntil", now))),
        "staleUntil": _iso(float(entry.get("staleUntil", now))),
        "ageSeconds": max(0, int(now - float(entry.get("fetchedAt", now)))),
    }
    if warnings:
        meta["warning"] = "; ".join(str(w) for w in warnings)
    return meta


def _entry_valid(entry, kind):
    return (
        isinstance(entry, dict)
        and entry.get("version") == CACHE_VERSION
        and entry.get("kind") == kind
        and "payload" in entry
    )


def refresh_cached_value(key, kind, loader, fresh_seconds=None, stale_seconds=None):
    payload = loader()
    entry = _new_entry(kind, payload, fresh_seconds=fresh_seconds, stale_seconds=stale_seconds)
    warnings = []
    _write_memory(key, entry)
    backend = "memory"
    if redis_configured():
        try:
            _write_redis(key, entry)
            backend = "redis"
        except Exception as exc:
            warnings.append(f"Redis write failed: {exc}")
    return payload, _meta(entry, backend, "refresh", warnings)


def get_cached_value(
    key,
    kind,
    loader,
    fresh_seconds=None,
    stale_seconds=None,
    force_refresh=False,
    refresh_when_stale=True,
):
    entry = None
    backend = "miss"
    warnings = []
    if not force_refresh:
        entry, backend, warnings = _read_cache(key)
        if entry and not _entry_valid(entry, kind):
            warnings.append("Cached entry has incompatible shape")
            entry = None
        if entry and _now() <= float(entry.get("freshUntil", 0)):
            return entry["payload"], _meta(entry, backend, "hit", warnings)
        if entry and not refresh_when_stale:
            if _now() <= float(entry.get("staleUntil", 0)):
                return entry["payload"], _meta(entry, backend, "stale", warnings)
            entry = None
    try:
        return refresh_cached_value(
            key,
            kind,
            loader,
            fresh_seconds=fresh_seconds,
            stale_seconds=stale_seconds,
        )
    except Exception as exc:
        if entry and _now() <= float(entry.get("staleUntil", 0)):
            warnings.append(f"Refresh failed: {exc}")
            return entry["payload"], _meta(entry, backend, "stale", warnings)
        raise
