"""
SWAY Home Router — Multi-Shelf Progressive Feed
Composes rich, non-duplicated shelves powered by the unified recsys engine and JioSaavn.
Supports cold -> seeded -> personalized user lifecycle evolution.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, Query, Request

from app.models import APIResponse
from app.recsys import hash_user
from app.recsys.ranker import build_profile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/home", tags=["home"])

DEFAULT_HOME_QUERIES = [
    ("bollywood_hits", "Top Bollywood Hits", "Trending Bollywood favourites", "Bollywood", "top bollywood hits", "discovery"),
    ("chill_hindi", "Melodic & Acoustic", "Chill, relaxing melodic tracks", "Chill", "chill acoustic hindi", "discovery"),
    ("arijit_spotlight", "Arijit Singh Essentials", "Top romantic anthems by Arijit Singh", "Artist", "arijit singh hits", "discovery"),
    ("punjabi_pop", "Punjabi Pop Hits", "High-energy chartbusters", "Trending", "trending punjabi hits", "discovery"),
]


def _cand_to_song_dict(t: dict) -> dict:
    sid = t.get("saavn_id") or t.get("id") or ""
    vid = t.get("ytm_video_id") or ""
    prov = "saavn" if sid and not sid.startswith("youtube:") else "youtube"
    pid = sid if prov == "saavn" else vid
    full_id = sid or (f"youtube:{vid}" if vid else "")
    artists = t.get("artists") or []
    if isinstance(artists, str):
        artists = [artists]
    artist_name = t.get("artist") or (", ".join(artists) if artists else "Unknown Artist")
    return {
        "id": full_id,
        "provider": prov,
        "provider_id": pid,
        "type": "song",
        "title": t.get("title", ""),
        "subtitle": artist_name,
        "artist_name": artist_name,
        "artists": [{"id": "", "name": a, "role": "primary"} for a in artists] if artists else [{"id": "", "name": artist_name, "role": "primary"}],
        "album": t.get("album", ""),
        "duration_ms": int((t.get("duration") or 0) * 1000),
        "artwork_url": t.get("image", ""),
        "language": t.get("language", ""),
        "has_media": True,
        "is_explicit": bool(t.get("explicit", False)),
    }


def _provider_song_to_dict(s: Any) -> dict:
    prov = getattr(s, "provider", "saavn") or "saavn"
    pid = getattr(s, "provider_id", None) or getattr(s, "id", "")
    full_id = getattr(s, "id", "") or f"{prov}:{pid}"
    artists = getattr(s, "artists", []) or []
    art_dicts = []
    if artists:
        for a in artists:
            if hasattr(a, "name"):
                art_dicts.append({"id": getattr(a, "id", "") or "", "name": a.name, "role": getattr(a, "role", "primary")})
            elif isinstance(a, dict):
                art_dicts.append(a)
    subtitle = getattr(s, "subtitle", "") or (art_dicts[0]["name"] if art_dicts else "Unknown Artist")
    return {
        "id": full_id,
        "provider": prov,
        "provider_id": pid,
        "type": "song",
        "title": getattr(s, "title", ""),
        "subtitle": subtitle,
        "artist_name": subtitle,
        "artists": art_dicts if art_dicts else [{"id": "", "name": subtitle, "role": "primary"}],
        "album": getattr(s, "album", ""),
        "duration_ms": getattr(s, "duration_ms", 0) or 0,
        "artwork_url": getattr(s, "artwork_url", "") or "",
        "language": getattr(s, "language", "") or "",
        "has_media": True,
        "is_explicit": getattr(s, "is_explicit", False),
    }


@router.get("", response_model=APIResponse, summary="Get personalized multi-shelf home feed")
@router.get("/recommendations/home", response_model=APIResponse, summary="Canonical home recommendation feed alias")
async def get_home_feed(
    request: Request,
    user_id: Optional[str] = Query(None, description="Optional user ID override"),
    limit_per_shelf: int = Query(10, ge=4, le=30, description="Max items per shelf"),
    x_sway_user_id: Optional[str] = Header(None),
):
    """
    Retrieve YouTube-Music-style progressive Home feed:
    - COLD users: Discovery shelves with state="cold"
    - SEEDED/PERSONALIZED users: Quick mix & personalized shelves
    - Full cross-shelf deduplication & dislike filtering
    """
    effective_user_id = (
        user_id
        or x_sway_user_id
        or request.headers.get("x-sway-user-id")
        or request.headers.get("x-sway-anon-id")
        or "anon-default"
    )

    recs = getattr(request.app.state, "recs", None)
    quick_picks = getattr(request.app.state, "quick_picks", None)
    provider = getattr(request.app.state, "provider", None)

    user_hash = hash_user(effective_user_id, recs.s.user_salt) if (recs and recs.s.user_salt) else None

    # Determine user lifecycle state from events in Store
    blocked_ids = set()
    user_event_count = 0
    recent_seed_track = None
    if recs and user_hash:
        now = time.time()
        evts = recs.store.user_events(user_hash, now - 90 * 86400, ("complete", "like", "skip", "dislike", "play_start"))
        user_event_count = len(evts)
        if evts:
            recent_seed_track = evts[0][1]  # tid of most recent event
        try:
            profile = build_profile(recs.store, user_hash, recs.s)
            blocked_ids = profile.blocked_ids
        except Exception:
            pass

    if user_event_count == 0:
        lifecycle_state = "cold"
    elif user_event_count < 5:
        lifecycle_state = "seeded"
    else:
        lifecycle_state = "personalized"

    global_seen: set[str] = set()
    shelves_data: list[dict[str, Any]] = []

    def _is_allowed(item_id: str, title: str) -> bool:
        if not item_id or item_id in blocked_ids or item_id in global_seen:
            return False
        clean_title = (title or "").lower().strip()
        if not clean_title or "sample track" in clean_title:
            return False
        return True

    # 1. Quick Picks Shelf (when seeded/personalized)
    if lifecycle_state in {"seeded", "personalized"} and quick_picks:
        try:
            qp_res = await quick_picks.get(user=user_hash, recent_ids=[], limit=limit_per_shelf)
            items = []
            for it in qp_res.get("items", []):
                s_dict = _cand_to_song_dict(it)
                if _is_allowed(s_dict["id"], s_dict["title"]):
                    global_seen.add(s_dict["id"])
                    items.append(s_dict)
            if items:
                shelves_data.append({
                    "id": "quick_picks",
                    "type": "quick_mix",
                    "title": "Quick Picks",
                    "subtitle": "Start radio from songs you love",
                    "badge": "For You",
                    "items": items,
                })
        except Exception as ex:
            logger.warning("Quick picks shelf error: %s", ex)

    # 2. Similarity Shelf ("Because you listened to...")
    if lifecycle_state in {"seeded", "personalized"} and recs and recent_seed_track:
        try:
            radio_res = await recs.radio(track_id=recent_seed_track, user=user_hash, limit=limit_per_shelf)
            seed_info = radio_res.get("seed", {})
            seed_title = seed_info.get("title") or "recent music"
            sim_items = []
            for t in radio_res.get("tracks", []):
                s_dict = _cand_to_song_dict(t)
                if _is_allowed(s_dict["id"], s_dict["title"]):
                    global_seen.add(s_dict["id"])
                    sim_items.append(s_dict)
            if sim_items:
                shelves_data.append({
                    "id": "similarity_shelf",
                    "type": "similarity",
                    "title": f"Similar to {seed_title}",
                    "subtitle": f"Recommended based on your interest in {seed_title}",
                    "badge": "Because You Listened",
                    "items": sim_items,
                })
        except Exception as ex:
            logger.debug("Similarity shelf error: %s", ex)

    # 3. Trending in India
    if recs:
        try:
            trending_tracks = await recs.trending(limit=limit_per_shelf + len(global_seen))
            items = []
            for t in trending_tracks:
                s_dict = _cand_to_song_dict(t.to_public())
                if _is_allowed(s_dict["id"], s_dict["title"]):
                    global_seen.add(s_dict["id"])
                    items.append(s_dict)
                if len(items) >= limit_per_shelf:
                    break
            if items:
                shelves_data.append({
                    "id": "trending_india",
                    "type": "trending",
                    "title": "Trending in India",
                    "subtitle": "Top hits right now across YouTube Music & JioSaavn",
                    "badge": "Trending",
                    "items": items,
                })
        except Exception as ex:
            logger.warning("Trending shelf error: %s", ex)

    # 4. Curated Discovery Shelves
    fetch_client = provider or (getattr(recs, "saavn", None) if recs else None)
    if fetch_client:
        async def _fetch_shelf(shelf_id: str, title: str, subtitle: str, badge: str, query: str, shelf_type: str):
            try:
                items = []
                if hasattr(fetch_client, "search"):
                    res = await fetch_client.search(query, n=limit_per_shelf + 5)
                    raw_songs = getattr(res, "enriched_songs", None) or getattr(res, "songs", None) or []
                    for s in raw_songs:
                        s_dict = _provider_song_to_dict(s)
                        if _is_allowed(s_dict["id"], s_dict["title"]):
                            items.append(s_dict)
                        if len(items) >= limit_per_shelf:
                            break
                elif hasattr(fetch_client, "search_songs"):
                    cands = await fetch_client.search_songs(query, limit=limit_per_shelf + 5)
                    for c in cands:
                        s_dict = _cand_to_song_dict(c.to_public())
                        if _is_allowed(s_dict["id"], s_dict["title"]):
                            items.append(s_dict)
                        if len(items) >= limit_per_shelf:
                            break
                if items:
                    return {
                        "id": shelf_id,
                        "type": shelf_type,
                        "title": title,
                        "subtitle": subtitle,
                        "badge": badge,
                        "items": items,
                    }
            except Exception as e:
                logger.debug("Failed to fetch shelf %s: %s", shelf_id, e)
            return None

        shelf_tasks = [
            _fetch_shelf(sid, stitle, ssub, sbadge, sq, stype)
            for sid, stitle, ssub, sbadge, sq, stype in DEFAULT_HOME_QUERIES
        ]
        results = await asyncio.gather(*shelf_tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, dict) and r.get("items"):
                filtered_items = []
                for it in r["items"]:
                    if it["id"] not in global_seen and it["id"] not in blocked_ids:
                        global_seen.add(it["id"])
                        filtered_items.append(it)
                if filtered_items:
                    r["items"] = filtered_items
                    shelves_data.append(r)

    return APIResponse(
        success=True,
        data={
            "user_id": effective_user_id,
            "state": lifecycle_state,
            "shelves": shelves_data,
        },
    )
