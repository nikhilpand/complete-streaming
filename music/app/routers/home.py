"""
SWAY Home Router — Multi-Shelf YouTube-Music-Style Progressive Feed
Composes rich differentiated shelves (Trending, Popular Regional, Made For You,
Because You Listened, Artist Radar, Recently Played, Rediscover, Discover Something New)
with zero mock data and natural progressive personalization.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, Request

# Ensure sway_taste_engine is importable
repo_root = Path(__file__).resolve().parents[3]
taste_engine_dir = repo_root / "sway_taste_engine"
if str(taste_engine_dir) not in sys.path:
    sys.path.insert(0, str(taste_engine_dir))

from app.models import APIResponse
from app.routers.recommendations import get_taste_engine, song_to_engine_track
from sway_taste_engine.mix_planner import MixPlanner
from sway_taste_engine.models import Track

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/home", tags=["home"])

DEFAULT_HOME_QUERIES = [
    "top bollywood hits",
    "trending songs hindi",
    "arijit singh hits",
    "atif aslam romantic",
    "chill acoustic hindi",
]


async def _seed_catalog_if_empty(request: Request, engine) -> List[Track]:
    """Hydrate catalog from provider if store contains fewer than 15 tracks."""
    catalog = engine.store.all_tracks()
    if len(catalog) >= 15:
        return catalog

    provider = getattr(request.app.state, "provider", None)
    if provider:
        try:
            for q in DEFAULT_HOME_QUERIES:
                res = await provider.search(q, n=10)
                songs = getattr(res, "enriched_songs", None) or getattr(res, "songs", None) or []
                if songs:
                    for s_item in songs:
                        try:
                            # If item is already full Song, convert directly
                            if hasattr(s_item, "duration_ms") and s_item.duration_ms:
                                track = song_to_engine_track(s_item)
                            else:
                                full_song = await provider.get_song(s_item.id)
                                track = song_to_engine_track(full_song or s_item)
                            if track and track.id:
                                engine.store.upsert_tracks([track])
                        except Exception:
                            pass
                if len(engine.store.all_tracks()) >= 30:
                    break
        except Exception as e:
            logger.warning("Could not auto-seed home catalog from provider: %s", e)

    return engine.store.all_tracks()


@router.get("", response_model=APIResponse, summary="Get personalized multi-shelf home feed")
@router.get("/recommendations/home", response_model=APIResponse, summary="Canonical home recommendation feed alias")
async def get_home_feed(
    request: Request,
    user_id: Optional[str] = Query(None, description="Optional user ID override"),
    limit_per_shelf: int = Query(10, ge=4, le=30, description="Max items per shelf"),
):
    """
    Retrieve YouTube-Music-style progressive Home feed:
    - COLD users: Discovery-first shelves (Trending, Popular in India, New Releases, Discover Something New, Chill & Melodic).
    - SEEDED users: Early personalization (Made for You, Because You Listened, Artist Radar, Trending, Discover).
    - LEARNING users: Balanced mix (Made for You, Because You Listened, Recently Played, Artists You Like, New Music for You, Discover).
    - PERSONALIZED users: Deep personalization with continued exploration (Made for You, Because You Listened, Your Artists, Recently Played, Rediscover, Trending for You, Discover Different).
    """
    effective_user_id = (
        user_id
        or request.headers.get("x-sway-user-id")
        or request.headers.get("x-sway-anon-id")
        or "anon-default"
    )

    engine = get_taste_engine()
    profile = engine.store.get_profile(effective_user_id)

    catalog = await _seed_catalog_if_empty(request, engine)

    # If catalog is still empty (e.g. offline and no provider), return empty shelves without fake mock tracks
    if not catalog:
        return APIResponse(
            success=True,
            data={
                "user_id": effective_user_id,
                "state": profile.personalization_state.value,
                "shelves": [],
            },
        )

    planner = MixPlanner(store=engine.store)
    shelves = planner.plan_home_feed(profile, catalog, limit_per_shelf=limit_per_shelf)

    shelves_data = []
    for s in shelves:
        shelves_data.append(
            {
                "id": s.id,
                "type": s.type,
                "title": s.title,
                "subtitle": s.subtitle,
                "badge": s.badge,
                "reason": s.reason,
                "items": [
                    {
                        "id": t.id,
                        "provider": "jiosaavn",
                        "provider_id": t.id,
                        "type": "song",
                        "title": t.title,
                        "subtitle": t.artist_name,
                        "artist_name": t.artist_name,
                        "artists": (
                            [{"id": a.id, "name": a.name, "role": a.role, "image_url": a.image_url} for a in t.artists]
                            if t.artists
                            else [{"id": t.artist_id, "name": t.artist_name, "role": "primary"}]
                        ),
                        "album": t.album,
                        "album_id": t.album_id,
                        "year": t.year,
                        "language": t.language,
                        "duration_ms": t.duration_ms,
                        "artwork_url": t.artwork_url,
                        "has_media": True,
                        "energy": t.energy,
                        "popularity": t.popularity,
                    }
                    for t in s.items
                ],
            }
        )

    return APIResponse(
        success=True,
        data={
            "user_id": effective_user_id,
            "state": profile.personalization_state.value,
            "shelves": shelves_data,
        },
    )
