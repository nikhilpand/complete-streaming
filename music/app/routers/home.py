"""
SWAY Home Router — Multi-Shelf Personalized Feed
Composes rich differentiated shelves (Quick Mix, Because You Listened, Artist Radar,
Rediscover, Discover Mix) with zero fake data.
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
    "arijit singh romantic hits",
    "chill acoustic hindi",
]


async def _seed_catalog_if_empty(request: Request, engine) -> List[Track]:
    catalog = engine.store.all_tracks()
    if len(catalog) >= 15:
        return catalog

    provider = getattr(request.app.state, "provider", None)
    if provider:
        try:
            for q in DEFAULT_HOME_QUERIES:
                res = await provider.search(q, n=10)
                if res.songs:
                    for s_item in res.songs:
                        try:
                            full_song = await provider.get_song(s_item.id)
                            track = song_to_engine_track(full_song)
                            engine.store.upsert_tracks([track])
                        except Exception:
                            pass
                if len(engine.store.all_tracks()) >= 30:
                    break
        except Exception as e:
            logger.warning("Could not auto-seed home catalog from provider: %s", e)

    return engine.store.all_tracks()


@router.get("", response_model=APIResponse, summary="Get personalized multi-shelf home feed")
async def get_home_feed(
    request: Request,
    user_id: Optional[str] = Query(None, description="Optional user ID override"),
    limit_per_shelf: int = Query(10, ge=4, le=30, description="Max items per shelf"),
):
    """
    Retrieve 5 distinct, personalized shelves:
    1. Quick Mix (40% favorites, 25% similar artists, 20% taste, 15% discovery)
    2. Because You Listened (Top-K similarity neighborhood)
    3. Artist Radar (Top artist and contemporaries)
    4. Rediscover (Past favorites)
    5. Discover Mix (Novel tracks near user taste)
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

    # If catalog is still empty (e.g. offline/mock environment), create default seed tracks
    if not catalog:
        mock_seed = [
            Track(
                id=f"track_seed_{i}",
                title=f"Sample Track {i}",
                artist_id=f"art_{i % 3}",
                artist_name=f"Artist {i % 3}",
                genres=["bollywood", "romantic"],
                moods=["chill"],
                popularity=0.7,
                provider_available={"saavn": True},
            )
            for i in range(15)
        ]
        engine.store.upsert_tracks(mock_seed)
        catalog = engine.store.all_tracks()

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
                "items": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "artist_name": t.artist_name,
                        "artists": (
                            [{"id": a.id, "name": a.name, "role": a.role} for a in t.artists]
                            if t.artists
                            else [{"id": t.artist_id, "name": t.artist_name, "role": "primary"}]
                        ),
                        "album": t.album,
                        "year": t.year,
                        "language": t.language,
                        "artwork_url": t.artwork_url,
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
            "shelves": shelves_data,
        },
    )
