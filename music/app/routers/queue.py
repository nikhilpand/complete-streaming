"""SWAY Queue Router — Sequence-Optimized Next Queue backed by recsys."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, Query, Request

from app.models import APIResponse
from app.recsys import hash_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/queue", tags=["queue"])


@router.get("/next", response_model=APIResponse, summary="Get sequence-optimized next queue")
async def get_next_queue(
    request: Request,
    current_track_id: str = Query(..., description="ID of the currently playing track"),
    count: int = Query(10, ge=1, le=50, description="Number of next tracks to sequence"),
    user_id: Optional[str] = Query(None, description="Explicit user or session identifier"),
    session_id: Optional[str] = Query(None, description="Session ID"),
    x_sway_user_id: Optional[str] = Header(None),
):
    recs = getattr(request.app.state, "recs", None)
    if not recs:
        return APIResponse(success=True, data={"current_track_id": current_track_id, "queue": [], "count": 0})

    uid = user_id or x_sway_user_id
    effective_user = hash_user(uid, recs.s.user_salt) if (recs.s.user_salt and uid) else None
    try:
        res = await recs.next_songs(
            session_id=session_id,
            current_track_id=current_track_id,
            count=count,
            user=effective_user,
        )
        tracks = res.get("tracks", [])
        queue_data = []
        for t in tracks:
            sid = t.get("saavn_id") or t.get("id") or ""
            vid = t.get("ytm_video_id") or ""
            prov = "saavn" if sid and not sid.startswith("youtube:") else "youtube"
            pid = sid if prov == "saavn" else vid
            full_id = sid or (f"youtube:{vid}" if vid else "")
            artists = t.get("artists") or []
            artist_name = t.get("artist") or (", ".join(artists) if artists else "Unknown")
            queue_data.append({
                "id": full_id,
                "provider": prov,
                "provider_id": pid,
                "title": t.get("title", ""),
                "artist_name": artist_name,
                "artists": [{"id": "", "name": a, "role": "primary"} for a in artists],
                "album": t.get("album", ""),
                "year": t.get("year", ""),
                "language": t.get("language", ""),
                "artwork_url": t.get("image", ""),
                "has_media": t.get("playback") == "saavn",
                "energy": 0.5,
                "popularity": 0.5,
            })
        return APIResponse(
            success=True,
            data={
                "current_track_id": current_track_id,
                "session_id": res.get("session_id"),
                "queue": queue_data,
                "count": len(queue_data),
            },
        )
    except Exception as e:
        logger.warning("queue next failed: %s", e)
        return APIResponse(success=True, data={"current_track_id": current_track_id, "queue": [], "count": 0})
