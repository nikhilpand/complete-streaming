"""
SWAY Queue Router — Sequence-Optimized Next Queue
Optimizes continuous playback transitions (A -> B -> C)
avoiding abrupt mood or tempo/energy cliffs.
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

from app.models import APIResponse, Song
from app.routers import songs as songs_router
from app.routers.recommendations import get_taste_engine, song_to_engine_track
from app.services.candidate_builder import CandidateBuilder
from sway_taste_engine.config import QueueWeights
from sway_taste_engine.metadata import extract_track_features
from sway_taste_engine.models import Track, UserTasteProfile
from sway_taste_engine.queue_planner import QueuePlanner

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/queue", tags=["queue"])


async def _resolve_song(request: Request, song_id: str) -> Optional[Song]:
    # Check monkeypatched or helper in songs router
    if hasattr(songs_router, "get_song_by_id"):
        fn = getattr(songs_router, "get_song_by_id")
        try:
            res = fn(song_id)
            if asyncio.iscoroutine(res):
                return await res
            if res:
                return res
        except TypeError:
            try:
                provider = getattr(request.app.state, "provider", None)
                res = fn(song_id, provider=provider)
                if asyncio.iscoroutine(res):
                    return await res
                if res:
                    return res
            except Exception:
                pass
        except Exception:
            pass

    provider = getattr(request.app.state, "provider", None)
    if provider:
        try:
            return await provider.get_song(song_id)
        except Exception:
            pass
    return None


@router.get("/next", response_model=APIResponse, summary="Get sequence-optimized next queue")
async def get_next_queue(
    request: Request,
    current_track_id: str = Query(..., description="ID of the currently playing track"),
    count: int = Query(10, ge=1, le=50, description="Number of next tracks to sequence"),
    user_id: Optional[str] = Query(None, description="Explicit user or session identifier"),
):
    """
    Produce smooth continuation queue (A -> B -> C) matching energy and mood
    while avoiding abrupt genre and tempo cliffs.
    """
    effective_user_id = (
        user_id
        or request.headers.get("x-sway-user-id")
        or request.headers.get("x-sway-anon-id")
        or "anon-default"
    )

    engine = get_taste_engine()
    profile = engine.store.get_profile(effective_user_id)

    curr_song = await _resolve_song(request, current_track_id)
    if curr_song:
        current_track = song_to_engine_track(curr_song)
    else:
        # Check store
        stored = engine.store.get_track(current_track_id)
        if stored:
            current_track = stored
        else:
            current_track = Track(
                id=current_track_id,
                title=current_track_id,
                artist_id="unknown",
                artist_name="Unknown Artist",
            )

    candidates: List[Track] = []
    provider = getattr(request.app.state, "provider", None)

    # 1. Hydrate candidate pool using CandidateBuilder if provider is available
    if provider and curr_song:
        try:
            builder = CandidateBuilder(provider, taste_store=engine.store)
            retrieved_tracks, _ = await builder.build_candidates(curr_song, profile=profile)
            candidates.extend(retrieved_tracks)
        except Exception as e:
            logger.warning("Failed to build candidates with CandidateBuilder: %s", e)

    # 2. Fallback or augment with all catalog tracks in taste_store
    if len(candidates) < 15:
        all_catalog = engine.store.all_tracks()
        for t in all_catalog:
            if t.id != current_track.id and t.id not in {c.id for c in candidates}:
                candidates.append(t)

    planner = QueuePlanner()
    ranked_tracks = planner.plan_next(
        current_track=current_track,
        candidates=candidates,
        profile=profile,
        store=engine.store,
        count=count,
    )

    queue_data = [
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
        for t in ranked_tracks
    ]

    return APIResponse(
        success=True,
        data={
            "current_track_id": current_track_id,
            "queue": queue_data,
            "count": len(queue_data),
        },
    )
