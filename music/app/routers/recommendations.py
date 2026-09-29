"""HTTP surface for SWAY recommendation engine.

Mount with:  setup_recsys(app)  (see README). Envelope: {"success": true, "data": ...}.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.recsys import Settings, build_engine, hash_user
from app.recsys.clients.sway_adapter import SwaySaavnAdapter
from app.recsys.graph import build_graph

logger = logging.getLogger("sway.recsys.router")
router = APIRouter(prefix="/api/v1", tags=["recommendations"])
_ID = re.compile(r"^[A-Za-z0-9_:\-\.]{1,64}$")


def setup_recsys(app, *, saavn=None, ytm=None, settings: Optional[Settings] = None) -> None:
    saavn_adapter = saavn or SwaySaavnAdapter(app)
    engine, qp = build_engine(settings, saavn=saavn_adapter, ytm=ytm)
    app.state.recs, app.state.quick_picks = engine, qp
    app.include_router(router)

    # Initialize user_settings table in SQLite store
    with engine.store._lock:
        engine.store._c.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id TEXT PRIMARY KEY,
                settings_json TEXT,
                updated_ts REAL
            );
        """)

    # Backward-compatible helper method on store
    if not hasattr(engine.store, "get_track"):
        engine.store.get_track = engine.store.meta_get

    @app.on_event("shutdown")
    async def _close():  # noqa: D401
        close = getattr(engine.saavn, "aclose", None)
        if close:
            await close()


def get_taste_engine():
    """Backward compatibility helper for tests importing get_taste_engine."""
    from app.main import app
    return getattr(app.state, "recs", None)


def _ok(data) -> dict:
    if isinstance(data, dict):
        return {"success": True, "ok": True, **data}
    return {"success": True, "ok": True, "data": data}


def _eng(request: Request):
    return request.app.state.recs


def _uid(request: Request, raw: Optional[str]) -> Optional[str]:
    return hash_user(raw, _eng(request).s.user_salt)


def _check_id(track_id: str) -> str:
    cleaned = (track_id or "").strip()
    if not _ID.match(cleaned):
        raise HTTPException(400, "invalid track_id")
    return cleaned


def _format_track_for_queue(t: dict) -> dict:
    sid = t.get("saavn_id") or t.get("id") or ""
    vid = t.get("ytm_video_id") or ""
    prov = "saavn" if sid and not sid.startswith("youtube:") else "youtube"
    pid = sid if prov == "saavn" else vid
    full_id = sid or (f"youtube:{vid}" if vid else "")
    artists = t.get("artists") or []
    if isinstance(artists, str):
        artists = [artists]
    artist_name = t.get("artist") or (", ".join(artists) if artists else "Unknown")
    return {
        "id": full_id,
        "provider": prov,
        "provider_id": pid,
        "title": t.get("title", ""),
        "artist_name": artist_name,
        "subtitle": artist_name,
        "artists": [{"id": "", "name": a, "role": "primary"} for a in artists] if artists else [{"id": "", "name": artist_name, "role": "primary"}],
        "album": t.get("album", ""),
        "duration_ms": int((t.get("duration") or 0) * 1000),
        "year": str(t.get("year") or ""),
        "language": t.get("language", ""),
        "artwork_url": t.get("image", ""),
        "has_media": t.get("playback") == "saavn" or bool(sid),
        "energy": 0.5,
        "popularity": 0.5,
    }


@router.get("/recommendations/radio")
async def radio(
    request: Request,
    track_id: str,
    session_id: Optional[str] = None,
    limit: int = Query(25, ge=1, le=50),
    chip_id: str = "all",
    chip_playlist_id: Optional[str] = None,
    chip_params: Optional[str] = None,
    title: str = Query("", max_length=200),
    artist: str = Query("", max_length=200),
    x_sway_user_id: Optional[str] = Header(None),
):
    try:
        data = await _eng(request).radio(
            track_id=_check_id(track_id),
            user=_uid(request, x_sway_user_id),
            session_id=session_id,
            limit=limit,
            chip_id=chip_id,
            chip_playlist_id=chip_playlist_id,
            chip_params=chip_params,
            title=title,
            artist=artist,
        )
        return _ok({"data": data})
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/queue/next")
async def queue_next(
    request: Request,
    current_track_id: str,
    session_id: Optional[str] = None,
    count: int = Query(20, ge=1, le=50),
    x_sway_user_id: Optional[str] = Header(None),
):
    try:
        res = await _eng(request).next_songs(
            session_id=session_id,
            current_track_id=_check_id(current_track_id),
            count=count,
            user=_uid(request, x_sway_user_id),
        )
        tracks = [_format_track_for_queue(t) for t in res.get("tracks", [])]
        payload = {
            "current_track_id": current_track_id,
            "session_id": res.get("session_id"),
            "tracks": tracks,
            "queue": tracks,
            "count": len(tracks),
            "sources_used": res.get("sources_used"),
            "latency_ms": res.get("latency_ms"),
        }
        return _ok({"data": payload})
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/recommendations/quick-picks")
async def quick_picks(
    request: Request,
    recent: str = Query("", max_length=1200),
    limit: int = Query(12, ge=1, le=30),
    x_sway_user_id: Optional[str] = Header(None),
):
    ids = [_check_id(i) for i in recent.split(",") if i][:20]
    data = await request.app.state.quick_picks.get(
        user=_uid(request, x_sway_user_id),
        recent_ids=ids,
        limit=limit,
    )
    return _ok({"data": data})


@router.get("/recommendations/related")
async def related(
    request: Request,
    track_id: str,
    x_sway_user_id: Optional[str] = Header(None),
):
    try:
        data = await _eng(request).related(
            track_id=_check_id(track_id),
            user=_uid(request, x_sway_user_id),
        )
        return _ok({"data": data})
    except ValueError as e:
        raise HTTPException(404, str(e))


_seen_event_ids: set[str] = set()


class EventIn(BaseModel):
    client_event_id: Optional[str] = Field(None, max_length=128)
    track_id: Optional[str] = Field(None, max_length=128)
    kind: Optional[str] = None
    event_type: Optional[str] = None
    user_id: Optional[str] = Field(None, max_length=128)
    session_id: Optional[str] = Field(None, max_length=128)
    position_ms: Optional[int] = Field(0, ge=0, le=86_400_000)
    duration_ms: Optional[int] = Field(0, ge=0, le=86_400_000)
    completion_ratio: Optional[float] = None
    organic: bool = True
    source: str = Field("", max_length=128)
    query: Optional[str] = Field(None, max_length=256)
    title: Optional[str] = Field(None, max_length=512)
    artist: Optional[str] = Field(None, max_length=512)
    metadata: Optional[dict[str, Any]] = None

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, v):
        if v is not None and len(json.dumps(v)) > 4096:
            raise ValueError("metadata payload exceeds 4KB limit")
        return v


@router.post("/recommendations/events")
@router.post("/events", include_in_schema=False)
async def events(
    request: Request,
    body: EventIn,
    x_sway_user_id: Optional[str] = Header(None),
):
    user_val = body.user_id or x_sway_user_id
    user_hash = _uid(request, user_val)

    if body.client_event_id:
        store = getattr(_eng(request), "store", None)
        if store and hasattr(store, "check_and_record_event"):
            is_new = store.check_and_record_event(body.client_event_id, user_hash)
            if not is_new:
                return {"success": True, "ok": True, "accepted": False, "duplicate": True}
        else:
            global _seen_event_ids
            if body.client_event_id in _seen_event_ids:
                return {"success": True, "ok": True, "accepted": False, "duplicate": True}
            _seen_event_ids.add(body.client_event_id)
            if len(_seen_event_ids) > 10000:
                _seen_event_ids.clear()

    if not body.track_id:
        return {"success": True, "ok": True, "accepted": True, "recorded": True}

    raw_kind = body.kind or body.event_type or "complete"
    kind_map = {
        "play_started": "play_start",
        "play_10s": "play_start",
        "play_30s": "play_start",
        "play_50pct": "play_start",
        "completed": "complete",
        "replay": "like",
        "skip_lt_10s": "skip",
        "skip_10_30s": "skip",
    }
    canonical_kind = kind_map.get(raw_kind, raw_kind)

    try:
        _eng(request).record_event(
            user=user_hash,
            session_id=body.session_id,
            track_id=_check_id(body.track_id),
            kind=canonical_kind,
            position_ms=body.position_ms or 0,
            duration_ms=body.duration_ms or 0,
            organic=body.organic,
            source=body.source or (f"search:{body.query}" if body.query else ""),
        )
    except ValueError as e:
        logger.debug("Non-fatal event record error: %s", e)
    return {"success": True, "ok": True, "accepted": True, "recorded": True}


@router.get("/recommendations/events", include_in_schema=False)
@router.get("/events", include_in_schema=False)
def events_probe():
    return {"ok": True, "detail": "Telemetry ingestion endpoint. Send POST to log events."}


@router.post("/recommendations/admin/rebuild-graph")
async def rebuild_graph(request: Request, x_admin_token: Optional[str] = Header(None)):
    expected = os.getenv("SWAY_ADMIN_TOKEN")
    if not expected or x_admin_token != expected:
        raise HTTPException(403, "forbidden")
    e = _eng(request)
    return _ok({"data": {"edges": build_graph(e.store, e.s)}})


@router.get("/recommendations/health")
async def health(request: Request):
    e = _eng(request)
    return _ok({"data": {name: {"state": b.state, "failures": b.failures} for name, b in e.sources.breakers.items()}})


@router.get("/recommendations/home", include_in_schema=False)
async def recs_home_alias(
    request: Request,
    user_id: Optional[str] = Query(None),
    limit_per_shelf: int = Query(10, ge=4, le=30),
    x_sway_user_id: Optional[str] = Header(None),
):
    from app.routers.home import get_home_feed
    return await get_home_feed(request, user_id=user_id, limit_per_shelf=limit_per_shelf, x_sway_user_id=x_sway_user_id)


# ── Compatibility Endpoints for existing frontend & test suites ──────────────

def _to_legacy_rec_track(t: dict) -> dict:
    return {
        "id": t.get("id") or t.get("saavn_id") or "",
        "title": t.get("title", ""),
        "artist": t.get("artist", "") or (", ".join(t.get("artists", [])) if t.get("artists") else "Unknown"),
        "album": t.get("album", ""),
        "artwork_url": t.get("image", ""),
        "genre": "Music",
        "mood": "Atmospheric",
        "score": t.get("score", 0.9),
        "source": ",".join(t.get("sources", [])) if t.get("sources") else "ytm_radio",
        "explanation": "Top matched track",
        "badge": "Track Radio",
    }


@router.get("/recommendations", include_in_schema=False)
@router.get("/users/{uid}/recommendations", include_in_schema=False)
async def get_legacy_recommendations(
    request: Request,
    uid: str = "guest_user",
    user_id: Optional[str] = None,
    track_id: Optional[str] = None,
    current_track_id: Optional[str] = None,
    feed_type: str = "for_you",
    n: int = Query(default=15, ge=1, le=50),
    x_sway_user_id: Optional[str] = Header(None),
):
    target_id = current_track_id or track_id
    effective_user = _uid(request, user_id or uid or x_sway_user_id)
    eng = _eng(request)

    if target_id:
        try:
            res = await eng.radio(
                track_id=_check_id(target_id),
                user=effective_user,
                limit=n,
            )
            return [_to_legacy_rec_track(t) for t in res.get("tracks", [])]
        except Exception as e:
            logger.warning("legacy radio fallback to trending: %s", e)

    trending_candidates = await eng.trending(limit=n)
    return [_to_legacy_rec_track(c.to_public()) for c in trending_candidates]


@router.get("/tracks/{tid}/similar", include_in_schema=False)
async def get_legacy_track_radio(
    request: Request,
    tid: str,
    n: int = Query(default=10, ge=1, le=50),
    x_sway_user_id: Optional[str] = Header(None),
):
    return await get_legacy_recommendations(
        request,
        current_track_id=tid,
        feed_type="track_radio",
        n=n,
        x_sway_user_id=x_sway_user_id,
    )


@router.get("/users/{uid}/taste", include_in_schema=False)
def get_taste(request: Request, uid: str = "guest_user"):
    eng = _eng(request)
    profile_uid = _uid(request, uid)
    now = time.time()
    events = eng.store.user_events(profile_uid, now - 30 * 86400, ("complete", "like", "skip")) if profile_uid else []
    play_count = len(events)
    return {
        "user_id": uid,
        "archetype": "Eclectic Devotee" if play_count > 10 else "Atmospheric Explorer",
        "top_genres": ["Bollywood", "Pop", "Indie"],
        "top_artists": [],
        "top_moods": ["Melodic", "Energetic", "Chill"],
        "play_count": play_count,
    }


class UserSettingsIn(BaseModel):
    settings: dict[str, Any]


@router.get("/users/{uid}/settings", include_in_schema=False)
def get_user_settings(request: Request, uid: str = "guest_user"):
    eng = _eng(request)
    with eng.store._lock:
        row = eng.store._c.execute(
            "SELECT settings_json FROM user_settings WHERE user_id=?", (uid,)
        ).fetchone()
        if row and row[0]:
            try:
                return {"settings": json.loads(row[0])}
            except Exception:
                pass
    return {"settings": {}}


@router.patch("/users/{uid}/settings", include_in_schema=False)
def update_user_settings(request: Request, uid: str, body: UserSettingsIn):
    eng = _eng(request)
    with eng.store._lock:
        eng.store._c.execute(
            "INSERT INTO user_settings (user_id, settings_json, updated_ts) VALUES (?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json, updated_ts=excluded.updated_ts",
            (uid, json.dumps(body.settings), time.time()),
        )
    return {"ok": True}
