"""
SWAY Recommendation & Playback Telemetry Router
Backed by sway_taste_engine and dynamically hydrated with real JioSaavn tracks,
providing explainable recommendations, track radio, user taste profiling,
and settings persistence without any hardcoded mock IDs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

# Ensure sway_taste_engine is on path
repo_root = Path(__file__).resolve().parents[3]
taste_engine_dir = repo_root / "sway_taste_engine"
if str(taste_engine_dir) not in sys.path:
    sys.path.insert(0, str(taste_engine_dir))

from app.services.candidate_builder import CandidateBuilder
from sway_taste_engine.engine import RecommendationEngine
from sway_taste_engine.metadata import extract_track_features, clean_track_id
from sway_taste_engine.storage import SQLiteTasteStore
from sway_taste_engine.models import (
    EventType,
    FeedType,
    RecommendationContext,
    Track,
    UserEvent,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["recommendations"])

# Persistent SQLite store for user settings & offline events
DB_PATH = repo_root / "music_recs.db"
_taste_engine: Optional[RecommendationEngine] = None
_artwork_cache: Dict[str, str] = {}
_db_initialized = False


def _init_db() -> None:
    global _db_initialized
    if not _db_initialized:
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA busy_timeout = 5000;")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_settings (
                    user_id TEXT PRIMARY KEY,
                    settings_json TEXT,
                    updated_ts REAL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS event_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT,
                    user_id TEXT,
                    track_id TEXT,
                    event_type TEXT,
                    metadata_json TEXT,
                    ts REAL
                );
            """)
            conn.commit()
        _db_initialized = True


@contextmanager
def get_db():
    _init_db()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def get_taste_engine() -> RecommendationEngine:
    global _taste_engine
    if _taste_engine is None:
        store = SQLiteTasteStore(str(DB_PATH))
        _taste_engine = RecommendationEngine(store=store)
    return _taste_engine


def clean_track_id(tid: str) -> str:
    """Normalize 'saavn:abc123' to 'abc123'."""
    if ":" in tid:
        return tid.split(":", 1)[1].strip()
    return tid.strip()


def song_to_engine_track(song: Any) -> Track:
    """Convert a JioSaavn Song model into a sway_taste_engine Track model with factual features."""
    track = extract_track_features(song)
    if track.id and track.artwork_url:
        _artwork_cache[track.id] = track.artwork_url
    return track


class EventIn(BaseModel):
    user_id: str = "guest_user"
    track_id: Optional[str] = ""
    type: Optional[str] = None
    event_type: Optional[str] = None
    session_id: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    artist_id: Optional[str] = None
    album: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    position_ms: Optional[int] = Field(default=0, ge=0)
    duration_ms: Optional[int] = Field(default=None, ge=0)
    completion_ratio: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    thumbnail: Optional[str] = None
    source: Optional[str] = None
    query: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class UserSettingsIn(BaseModel):
    settings: Dict[str, Any]


EVENT_MAP = {
    "play": EventType.PLAY_STARTED,
    "play_started": EventType.PLAY_STARTED,
    "play_10s": EventType.PLAY_10S,
    "play_30s": EventType.PLAY_30S,
    "play_50pct": EventType.PLAY_50PCT,
    "play_complete": EventType.COMPLETED,
    "play_completed": EventType.COMPLETED,
    "completed": EventType.COMPLETED,
    "skip": EventType.SKIP,
    "skip_lt_10s": EventType.SKIP_LT_10S,
    "skip_10_30s": EventType.SKIP_10_30S,
    "like": EventType.LIKE,
    "unlike": EventType.UNLIKE,
    "dislike": EventType.DISLIKE,
    "not_interested": EventType.NOT_INTERESTED,
    "replay": EventType.REPLAY,
    "share": EventType.SAVE,
    "save": EventType.SAVE,
    "add_to_playlist": EventType.SAVE,
    "search": EventType.SEARCH,
}


@router.post(
    "/recommendations/events",
    summary="Ingest user playback telemetry event into taste engine (canonical)",
    tags=["recommendations"],
)
@router.post(
    "/recommendations/telemetry",
    summary="Alias for /recommendations/events",
    include_in_schema=False,
    tags=["recommendations"],
)
@router.post(
    "/events",
    summary="Compatibility alias for /recommendations/events",
    deprecated=True,
    include_in_schema=False,
    tags=["recommendations"],
)
def post_event(e: EventIn, request: Request = None):
    """Log user playback telemetry and update taste profile in real-time.
    
    Canonical write endpoint: POST /api/v1/recommendations/events
    Note: POST /api/v1/events is maintained as a backward-compatible alias.
    """
    eng = get_taste_engine()
    sid = clean_track_id(e.track_id) if e.track_id else ""
    evt_raw = e.event_type or e.type or "play_started"
    evt_type = EVENT_MAP.get(evt_raw, EventType.PLAY_STARTED)

    if e.thumbnail and sid:
        _artwork_cache[sid] = e.thumbnail

    # Check track in taste engine catalog (ZERO fake metadata injection)
    track = None
    if sid:
        track = eng.store.get_track(sid)
        if not track and request and hasattr(request.app, "state") and getattr(request.app.state, "provider", None):
            provider = request.app.state.provider
            try:
                loop = asyncio.get_running_loop()
                async def _hydrate():
                    try:
                        real_song = await provider.get_song(sid)
                        if real_song:
                            real_track = song_to_engine_track(real_song)
                            if real_track and real_track.id:
                                eng.seed_catalog([real_track])
                    except Exception as ex:
                        logger.debug("Telemetry background track hydration skipped for %s: %s", sid, ex)
                loop.create_task(_hydrate())
            except RuntimeError:
                pass

    comp_ratio = e.completion_ratio
    if comp_ratio is None and e.duration_ms and e.duration_ms > 0 and e.position_ms is not None:
        comp_ratio = max(0.0, min(1.0, e.position_ms / e.duration_ms))
    elif comp_ratio is None and evt_type == EventType.COMPLETED:
        comp_ratio = 1.0

    src = e.source or (e.metadata.get("source") if e.metadata else None)
    qry = e.query or (e.metadata.get("query") if e.metadata else None)
    meta = dict(e.metadata or {})
    if e.title:
        meta["title"] = e.title
    if e.artist:
        meta["artist"] = e.artist
    if e.genre:
        meta["genre"] = e.genre
    if src:
        meta["source"] = src
    if qry:
        meta["query"] = qry

    artist_id = (
        track.artist_id
        if track
        else (e.artist_id or (e.artist.lower().replace(" ", "_") if e.artist else None))
    )
    album_id = track.album_id if track else None


    user_event = UserEvent(
        event_id=f"evt_{uuid.uuid4().hex[:12]}",
        user_id=e.user_id,
        session_id=e.session_id or f"sess_{e.user_id}",
        event_type=evt_type,
        track_id=sid or None,
        artist_id=artist_id,
        album_id=album_id,
        position_ms=e.position_ms,
        duration_ms=e.duration_ms,
        completion_ratio=comp_ratio,
        source=src,
        query=qry,
        metadata=meta,
    )

    accepted = eng.ingest_event(user_event)

    # Persist log to SQLite
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO event_log (event_id, user_id, track_id, event_type, metadata_json, ts) VALUES (?,?,?,?,?,?)",
                (
                    user_event.event_id,
                    e.user_id,
                    sid,
                    evt_raw,
                    json.dumps(meta),
                    time.time(),
                ),
            )
            conn.commit()
    except Exception as ex:
        logger.warning("Failed to persist event to SQLite: %s", ex)

    return {"ok": True, "accepted": accepted, "event": evt_raw, "track_id": sid}


@router.get(
    "/recommendations/home",
    summary="Get personalized multi-shelf home feed (canonical alias)",
    tags=["recommendations"],
)
async def get_recommendations_home(
    request: Request,
    user_id: Optional[str] = Query(None, description="Optional user ID override"),
    limit_per_shelf: int = Query(10, ge=4, le=30, description="Max items per shelf"),
):
    """Canonical recommendation endpoint for the YouTube-Music-style Home feed."""
    from app.routers.home import get_home_feed
    return await get_home_feed(request, user_id=user_id, limit_per_shelf=limit_per_shelf)



class ShadowModeComparator:
    """
    Shadow Mode comparator for online A/B or algorithm migration validation.
    Runs side-by-side evaluation without user disruption.
    """

    @staticmethod
    def compare(primary: Any, shadow: Any) -> dict[str, Any]:
        def _extract_items(obj: Any) -> list[Any]:
            if hasattr(obj, "items"):
                return obj.items
            if isinstance(obj, list):
                return obj
            return []

        def _get_id(it: Any) -> str:
            if hasattr(it, "track"):
                return getattr(it.track, "id", "")
            if hasattr(it, "id"):
                return getattr(it, "id", "")
            if isinstance(it, dict):
                return str(it.get("id") or it.get("track_id") or "")
            return str(it)

        def _get_score(it: Any) -> float:
            if hasattr(it, "score"):
                return float(getattr(it, "score", 0.0))
            if isinstance(it, dict):
                return float(it.get("score", 0.0))
            return 0.0

        p_items = _extract_items(primary)
        s_items = _extract_items(shadow)

        p_ids = [_get_id(x) for x in p_items if _get_id(x)]
        s_ids = [_get_id(x) for x in s_items if _get_id(x)]

        p_set = set(p_ids)
        s_set = set(s_ids)

        overlap = len(p_set & s_set)
        union = len(p_set | s_set)
        jaccard = (overlap / union) if union > 0 else 1.0

        p_scores = [_get_score(x) for x in p_items]
        s_scores = [_get_score(x) for x in s_items]

        p_mean = sum(p_scores) / len(p_scores) if p_scores else 0.0
        s_mean = sum(s_scores) / len(s_scores) if s_scores else 0.0

        return {
            "primary_count": len(p_ids),
            "shadow_count": len(s_ids),
            "overlap_count": overlap,
            "jaccard_divergence": round(1.0 - jaccard, 4),
            "primary_mean_score": round(p_mean, 4),
            "shadow_mean_score": round(s_mean, 4),
            "top_1_match": (p_ids[0] == s_ids[0]) if (p_ids and s_ids) else False,
        }


@router.get("/recommendations/debug")
@router.get("/debug")
async def get_recommendations_debug(
    request: Request,
    user_id: str = "guest_user",
    feed: str = "for_you",
    feed_type: Optional[str] = None,
    track_id: Optional[str] = None,
    current_track_id: Optional[str] = None,
    limit: int = Query(default=10, ge=1, le=50),
    shadow: bool = Query(default=False),
):
    """
    Observability endpoint providing complete score breakdown,
    candidate generator counts, pruned tracks, and optional shadow mode comparison.
    """
    eng = get_taste_engine()
    raw_track_id = current_track_id or track_id
    curr_id = clean_track_id(raw_track_id) if raw_track_id else None

    # Parse feed
    selected_feed = feed_type or feed
    try:
        feed_enum = FeedType(selected_feed)
    except ValueError:
        feed_enum = FeedType.FOR_YOU

    provider = getattr(request.app.state, "provider", None)
    candidate_counts: dict[str, int] = {
        "same_artist": 0,
        "similar_artists": 0,
        "album_soundtrack": 0,
        "taste_neighbors": 0,
        "collaborative": 0,
        "discovery": 0,
        "exploration": 0,
    }

    curr_song = None
    if provider:
        if curr_id:
            try:
                curr_song = await provider.get_song(curr_id)
                if curr_song:
                    seed_track = song_to_engine_track(curr_song)
                    eng.seed_catalog([seed_track])
            except Exception as ex:
                logger.debug("Could not fetch current song %s: %s", curr_id, ex)

        builder = CandidateBuilder(provider=provider, taste_store=eng.store)
        profile = eng.store.get_profile(user_id)
        discovered, counts = await builder.build_candidates(
            seed_song=curr_song,
            profile=profile,
        )
        if discovered:
            eng.seed_catalog(discovered)
        candidate_counts.update(counts)
    else:
        all_tracks = eng.store.all_tracks()
        candidate_counts["taste_neighbors"] = len(all_tracks)

    profile = eng.store.get_profile(user_id)
    ctx = RecommendationContext(
        current_track_id=curr_id,
        session_id=f"sess_{user_id}",
    )

    resp = eng.recommend(user_id, feed=feed_enum, context=ctx, limit=limit)

    # Pruned tracks
    pruned: list[dict[str, str]] = [
        {"track_id": tid, "reason": "explicit_negative"}
        for tid in sorted(profile.explicit_negative_tracks)
    ] + [
        {"track_id": tid, "reason": "high_confidence_skip"}
        for tid in sorted(profile.negative_memory.high_confidence_skips)
    ]

    items_debug = []
    for item in resp.items:
        artwork = _artwork_cache.get(item.track.id, "")
        items_debug.append({
            "id": item.track.id,
            "track_id": item.track.id,
            "title": item.track.title,
            "artist": item.track.artist_name,
            "album": item.track.album_name,
            "artwork_url": artwork,
            "score": round(item.score, 4),
            "source": item.source,
            "rank": item.rank,
            "explanation": item.explanation.model_dump() if item.explanation else None,
            "attribution": item.attribution.model_dump() if item.attribution else {
                "total": round(item.score, 4),
                "components": {
                    "taste": 0.0,
                    "session": 0.0,
                    "similarity": 0.0,
                    "novelty": 0.0,
                    "freshness": 0.0,
                    "popularity": 0.0,
                    "energy_fit": 0.0,
                },
            },
        })

    debug_data: dict[str, Any] = {
        "user_id": user_id,
        "feed": feed_enum.value,
        "algorithm_version": resp.algorithm_version,
        "profile_version": resp.profile_version,
        "candidate_counts_by_generator": candidate_counts,
        "pruned_tracks": pruned,
        "count": len(items_debug),
        "items": items_debug,
    }

    if shadow:
        shadow_ctx = RecommendationContext(current_track_id=None, session_id=None)
        shadow_resp = eng.recommend(user_id, feed=FeedType.DISCOVER, context=shadow_ctx, limit=limit)
        debug_data["shadow_comparison"] = ShadowModeComparator.compare(resp.items, shadow_resp.items)

    return {
        "success": True,
        "data": debug_data,
    }


@router.get("/recommendations")
@router.get("/users/{uid}/recommendations")
async def get_recommendations(
    request: Request,
    uid: str = "guest_user",
    user_id: Optional[str] = None,
    track_id: Optional[str] = None,
    current_track_id: Optional[str] = None,
    feed_type: str = "for_you",
    n: int = Query(default=15, ge=1, le=50),
):
    """
    Get personalized recommendations dynamically powered by JioSaavn + sway_taste_engine.
    Dynamically fetches real candidate tracks, ranks them by affinity and diversity,
    and returns playable songs with real IDs, artwork, and explanations.
    """
    eng = get_taste_engine()
    target_uid = user_id or uid
    raw_track_id = current_track_id or track_id
    curr_id = clean_track_id(raw_track_id) if raw_track_id else None

    provider = getattr(request.app.state, "provider", None)

    # Hydrate real tracks dynamically via CandidateBuilder
    if provider:
        curr_song = None
        if curr_id:
            try:
                curr_song = await provider.get_song(curr_id)
                if curr_song:
                    seed_track = song_to_engine_track(curr_song)
                    eng.seed_catalog([seed_track])
            except Exception as ex:
                logger.debug("Could not fetch current song %s for seed: %s", curr_id, ex)

        builder = CandidateBuilder(provider=provider, taste_store=eng.store)
        profile = eng.store.get_profile(target_uid)
        discovered_tracks, attribution = await builder.build_candidates(
            seed_song=curr_song,
            profile=profile,
        )
        if discovered_tracks:
            eng.seed_catalog(discovered_tracks)

    # Choose feed
    feed = FeedType.FOR_YOU
    if curr_id:
        feed = FeedType.AUTOPLAY if feed_type == "autoplay" else FeedType.TRACK_RADIO
    elif feed_type == "discover":
        feed = FeedType.DISCOVER

    ctx = RecommendationContext(
        current_track_id=curr_id,
        session_id=f"sess_{target_uid}",
    )

    try:
        resp = eng.recommend(target_uid, feed=feed, context=ctx, limit=n)
        results = []
        for item in resp.items:
            badge = "For You"
            if item.source == "discovery":
                badge = "Discover"
            elif item.source == "similar_track":
                badge = "Track Radio"
            elif item.source == "affinity":
                badge = "Artist Match"
            elif item.source == "trending":
                badge = "Trending"

            # Artwork from in-memory cache
            artwork = _artwork_cache.get(item.track.id, "")

            results.append({
                "id": item.track.id,
                "title": item.track.title,
                "artist": item.track.artist_name,
                "album": item.track.album_name,
                "artwork_url": artwork,
                "genre": item.track.genres[0] if item.track.genres else "Music",
                "mood": item.track.moods[0] if item.track.moods else "Atmospheric",
                "score": round(item.score, 3),
                "source": item.source,
                "explanation": item.explanation.label,
                "badge": badge,
            })
        return results
    except Exception as ex:
        logger.exception("Recommendation calculation error: %s", ex)
        # Fallback to any tracks in store
        all_tracks = eng.store.all_tracks()
        return [
            {
                "id": t.id,
                "title": t.title,
                "artist": t.artist_name,
                "album": t.album_name,
                "artwork_url": _artwork_cache.get(t.id, ""),
                "genre": t.genres[0] if t.genres else "Music",
                "mood": t.moods[0] if t.moods else "Atmospheric",
                "score": 0.85,
                "source": "curated",
                "explanation": "Curated selection",
                "badge": "For You",
            }
            for t in all_tracks[:n]
        ]


@router.get("/tracks/{tid}/similar")
async def get_track_radio(request: Request, tid: str, n: int = 10):
    """Serve track radio using taste engine candidate retrieval."""
    clean_id = clean_track_id(tid)
    return await get_recommendations(request, current_track_id=clean_id, feed_type="track_radio", n=n)


@router.get("/users/{uid}/taste")
def get_taste(uid: str = "guest_user"):
    """Return user taste profile attributes."""
    eng = get_taste_engine()
    profile = eng.store.get_profile(uid)
    return {
        "user_id": uid,
        "archetype": "Eclectic Devotee" if "devotional" in profile.genre_affinity else "Atmospheric Explorer",
        "top_genres": sorted(profile.genre_affinity, key=profile.genre_affinity.get, reverse=True)[:5],
        "top_artists": sorted(profile.artist_affinity, key=profile.artist_affinity.get, reverse=True)[:5],
        "top_moods": sorted(profile.mood_affinity, key=profile.mood_affinity.get, reverse=True)[:5],
        "play_count": profile.total_plays,
    }


@router.get("/users/{uid}/settings")
def get_user_settings(uid: str = "guest_user"):
    """Get persisted lyrics and player preferences."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT settings_json FROM user_settings WHERE user_id=?", (uid,)
        ).fetchone()
        if row and row["settings_json"]:
            try:
                return {"settings": json.loads(row["settings_json"])}
            except Exception:
                pass
        return {"settings": {}}


@router.patch("/users/{uid}/settings")
def update_user_settings(uid: str, body: UserSettingsIn):
    """Save lyrics and player preferences."""
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (user_id, settings_json, updated_ts) VALUES (?,?,?)",
            (uid, json.dumps(body.settings), time.time()),
        )
        conn.commit()
    return {"ok": True}
