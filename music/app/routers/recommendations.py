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

from sway_taste_engine.engine import RecommendationEngine
from sway_taste_engine.metadata import extract_track_features, clean_track_id
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
        _taste_engine = RecommendationEngine()
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
    track_id: str
    type: str  # play | play_started | play_completed | skip | like | unlike | replay | share
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    genre: Optional[str] = "pop"
    mood: Optional[str] = "chill"
    position_ms: Optional[int] = 0
    duration_ms: Optional[int] = 180000
    thumbnail: Optional[str] = None


class UserSettingsIn(BaseModel):
    settings: Dict[str, Any]


EVENT_MAP = {
    "play": EventType.PLAY_STARTED,
    "play_started": EventType.PLAY_STARTED,
    "play_complete": EventType.COMPLETED,
    "play_completed": EventType.COMPLETED,
    "skip": EventType.SKIP,
    "like": EventType.LIKE,
    "unlike": EventType.UNLIKE,
    "dislike": EventType.DISLIKE,
    "replay": EventType.REPLAY,
    "share": EventType.SAVE,
    "add_to_playlist": EventType.SAVE,
}


@router.post("/events")
def post_event(e: EventIn):
    """Log user playback telemetry and update taste profile in real-time."""
    eng = get_taste_engine()
    sid = clean_track_id(e.track_id)
    evt_type = EVENT_MAP.get(e.type, EventType.PLAY_STARTED)

    if e.thumbnail and sid:
        _artwork_cache[sid] = e.thumbnail

    # Auto-register track in taste engine catalog if not already present
    track = eng.store.get_track(sid)
    if not track:
        track = Track(
            id=sid,
            title=e.title or f"Track {sid}",
            artist_id=e.artist.lower().replace(" ", "_") if e.artist else "artist_unknown",
            artist_name=e.artist or "Unknown Artist",
            album_name=e.album or "Single",
            genres=[e.genre] if e.genre else ["pop"],
            moods=[e.mood] if e.mood else ["chill"],
            energy=0.6,
            bpm=110.0,
            popularity=0.85,
        )
        eng.seed_catalog([track])

    user_event = UserEvent(
        event_id=f"evt_{uuid.uuid4().hex[:12]}",
        user_id=e.user_id,
        session_id=f"sess_{e.user_id}",
        event_type=evt_type,
        track_id=sid,
        artist_id=track.artist_id,
        album_id=track.album_id,
        position_ms=e.position_ms,
        duration_ms=e.duration_ms,
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
                    e.type,
                    json.dumps({"title": e.title, "artist": e.artist, "genre": e.genre}),
                    time.time(),
                ),
            )
            conn.commit()
    except Exception as ex:
        logger.warning("Failed to persist event to SQLite: %s", ex)

    return {"ok": True, "accepted": accepted, "event": e.type, "track_id": sid}


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

    # Hydrate real tracks dynamically from JioSaavn provider
    if provider:
        search_queries: List[str] = []
        if curr_id:
            try:
                curr_song = await provider.get_song(curr_id)
                if curr_song:
                    seed_track = song_to_engine_track(curr_song)
                    eng.seed_catalog([seed_track])
                    if curr_song.artists:
                        search_queries.append(curr_song.artists[0].name)
                    if curr_song.title:
                        search_queries.append(f"{curr_song.title} song")
            except Exception as ex:
                logger.debug("Could not fetch current song %s for seed: %s", curr_id, ex)

        if not search_queries:
            search_queries = ["trending hindi songs", "arijit singh top hits", "punjabi hits 2024"]

        # Run candidate searches concurrently
        async def fetch_query(q: str):
            try:
                res = await provider.search(q, n=15)
                return res.songs or []
            except Exception as e:
                logger.debug("Provider search failed for query %s: %s", q, e)
                return []

        search_results = await asyncio.gather(*(fetch_query(q) for q in search_queries[:3]))
        discovered_tracks: List[Track] = []
        for song_list in search_results:
            for s in song_list:
                t = song_to_engine_track(s)
                discovered_tracks.append(t)

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
