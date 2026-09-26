"""
SWAY Home Router — Multi-Shelf YouTube-Music-Style Progressive Feed
Composes rich differentiated shelves (Trending, Popular Regional, Made For You,
Because You Listened, Artist Radar, Recently Played, Rediscover, Discover Something New)
with zero mock data and natural progressive personalization.
"""

from __future__ import annotations

import asyncio
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
from sway_taste_engine.normalizer import canonical_song_key, is_derivative_track, normalize_title

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/home", tags=["home"])

DEFAULT_HOME_QUERIES = [
    "top bollywood hits",
    "trending songs hindi",
    "arijit singh hits",
    "atif aslam romantic",
    "chill acoustic hindi",
]

_seed_lock = asyncio.Lock()


def is_valid_catalog_track(t: Track) -> bool:
    """Validate that a track has genuine metadata and artwork before feeding to Home."""
    if not t or not getattr(t, "id", None):
        return False
    if not t.artwork_url or not str(t.artwork_url).strip():
        return False
    if is_derivative_track(t.title or "", t.artist_name or ""):
        return False
    t_title = (t.title or "").strip().lower()
    if not t_title or t_title.startswith("track ") or t_title.startswith("sample track") or t_title.startswith("debug"):
        return False
    t_artist = (t.artist_name or "").strip().lower()
    if not t_artist or t_artist in ("unknown artist", "unknown", "artist 0", "none", "null"):
        return False
    t_artist_id = (t.artist_id or "").strip().lower()
    if not t_artist_id or t_artist_id in ("artist_unknown", "unknown", "none", "null") or t_artist_id.startswith("unknown"):
        return False
    if t.id.startswith("debug") or t.id.startswith("track_seed_"):
        return False
    return True


async def _seed_catalog_if_empty(request: Request, engine) -> List[Track]:
    """Hydrate catalog from provider if store contains fewer than 25 valid tracks (with in-flight coalescing)."""
    valid_catalog = [t for t in engine.store.all_tracks() if is_valid_catalog_track(t)]
    if len(valid_catalog) >= 25:
        return valid_catalog

    async with _seed_lock:
        # Double check after acquiring lock
        valid_catalog = [t for t in engine.store.all_tracks() if is_valid_catalog_track(t)]
        if len(valid_catalog) >= 25:
            return valid_catalog

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
                                if track and is_valid_catalog_track(track):
                                    engine.store.upsert_tracks([track])
                            except Exception:
                                pass
                    valid_catalog = [t for t in engine.store.all_tracks() if is_valid_catalog_track(t)]
                    if len(valid_catalog) >= 35:
                        break
            except Exception as e:
                logger.warning("Could not auto-seed home catalog from provider: %s", e)

        return [t for t in engine.store.all_tracks() if is_valid_catalog_track(t)]


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

    raw_catalog = await _seed_catalog_if_empty(request, engine)
    catalog = [t for t in raw_catalog if is_valid_catalog_track(t)]

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
        shelf_items = []
        seen_shelf_song_keys: set[tuple[str, str]] = set()
        seen_shelf_titles: set[str] = set()
        for t in s.items:
            if is_derivative_track(getattr(t, "title", ""), getattr(t, "artist_name", "")):
                continue
            norm_title = normalize_title(getattr(t, "title", ""))
            if norm_title and norm_title in seen_shelf_titles:
                continue
            c_key = canonical_song_key(
                title=getattr(t, "title", ""),
                artist_name=getattr(t, "artist_name", ""),
                fallback_id=getattr(t, "id", ""),
                album=getattr(t, "album", ""),
            )
            if c_key in seen_shelf_song_keys:
                continue
            seen_shelf_song_keys.add(c_key)
            if norm_title:
                seen_shelf_titles.add(norm_title)

            prov = getattr(t, "provider", None)
            p_id = getattr(t, "provider_id", None)
            if not prov or not p_id:
                if ":" in t.id:
                    prov, p_id = t.id.split(":", 1)
                else:
                    prov = "saavn"
                    p_id = t.id

            full_id = f"{prov}:{p_id}" if prov == "youtube" and not t.id.startswith(("youtube:", "yt:")) else t.id
            has_media = getattr(t, "has_media", None)
            if has_media is None:
                if isinstance(getattr(t, "provider_available", None), dict) and prov in t.provider_available:
                    has_media = t.provider_available[prov]
                else:
                    has_media = True

            shelf_items.append(
                {
                    "id": full_id,
                    "provider": prov,
                    "provider_id": p_id,
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
                    "has_media": has_media,
                    "energy": t.energy,
                    "popularity": t.popularity,
                }
            )

        if shelf_items:
            shelves_data.append(
                {
                    "id": s.id,
                    "type": s.type,
                    "title": s.title,
                    "subtitle": s.subtitle,
                    "badge": s.badge,
                    "reason": s.reason,
                    "items": shelf_items,
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
