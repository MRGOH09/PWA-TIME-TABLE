from _access import build_access_profiles, permission_env
from _cache import get_cached_value, make_cache_key, refresh_cached_value
from _lark import fetch_all_records, normalize_record


def _resolve_token(token_or_loader):
    return token_or_loader() if callable(token_or_loader) else token_or_loader


def schedule_cache_key(env):
    return make_cache_key("schedule", env.get("LARK_BASE_TOKEN"), env.get("LARK_TABLE_ID"))


def access_cache_key(env):
    penv = permission_env(env)
    return make_cache_key(
        "permissions",
        penv.get("LARK_BASE_TOKEN"),
        penv.get("LARK_TABLE_ID"),
    )


def load_schedule_records(token_or_loader, env):
    raw = fetch_all_records(_resolve_token(token_or_loader), env)
    return [normalize_record(it) for it in raw]


def load_access_profiles(token_or_loader, env):
    raw = fetch_all_records(_resolve_token(token_or_loader), permission_env(env))
    return build_access_profiles(raw)


def get_schedule_records(token_or_loader, env, force_refresh=False, refresh_when_stale=True):
    return get_cached_value(
        schedule_cache_key(env),
        "schedule-records",
        lambda: load_schedule_records(token_or_loader, env),
        force_refresh=force_refresh,
        refresh_when_stale=refresh_when_stale,
    )


def get_access_profiles(token_or_loader, env, force_refresh=False, refresh_when_stale=True):
    return get_cached_value(
        access_cache_key(env),
        "access-profiles",
        lambda: load_access_profiles(token_or_loader, env),
        force_refresh=force_refresh,
        refresh_when_stale=refresh_when_stale,
    )


def refresh_all_cached_data(token, env):
    records, schedule_meta = refresh_cached_value(
        schedule_cache_key(env),
        "schedule-records",
        lambda: load_schedule_records(token, env),
    )
    profiles, permission_meta = refresh_cached_value(
        access_cache_key(env),
        "access-profiles",
        lambda: load_access_profiles(token, env),
    )
    return {
        "schedule": {
            "count": len(records),
            "cache": schedule_meta,
        },
        "permissions": {
            "count": len(profiles),
            "cache": permission_meta,
        },
    }
