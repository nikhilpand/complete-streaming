"""
Karaoke router — GET/POST /api/v1/karaoke/{track_id}
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.models import APIResponse
from app.services.karaoke import service as karaoke_service
from app.services.karaoke import separator as sep_module

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/karaoke", tags=["Karaoke"])

_TRACK_ID_RE = re.compile(r"^[A-Za-z0-9_\-:]{2,60}$")
_STEM_RE = re.compile(r"^(vocals|instrumental)$")


def _validate_track_id(track_id: str) -> str:
    tid = track_id.strip()
    if not _TRACK_ID_RE.match(tid):
        raise HTTPException(status_code=400, detail="Invalid track_id format")
    return tid


class PrepareRequest(BaseModel):
    stream_url: str
    canonical_track_key: Optional[str] = None


@router.get("/{track_id}", response_model=APIResponse, summary="Get karaoke status")
async def get_karaoke_status(request: Request, track_id: str):
    tid = _validate_track_id(track_id)
    if not sep_module.is_available():
        # Return graceful degradation — not an error, just not available
        from app.services.karaoke.models import KaraokeStatus, KaraokeInfo
        info = KaraokeInfo(
            track_id=tid,
            status=KaraokeStatus.FAILED,
            progress=0.0,
            ready=False,
            error=sep_module.get_error() or "Karaoke not available on this server",
        )
        return APIResponse(success=True, data=info.model_dump())
    info = await karaoke_service.get_status(tid)
    return APIResponse(success=True, data=info.model_dump())


@router.get("/{track_id}/status", response_model=APIResponse, summary="Poll karaoke preparation status")
async def poll_karaoke_status(request: Request, track_id: str):
    """Alias for GET /{track_id} — used for polling during preparation."""
    return await get_karaoke_status(request, track_id)


@router.post("/{track_id}/prepare", response_model=APIResponse, summary="Trigger karaoke preparation")
async def prepare_karaoke(
    request: Request,
    track_id: str,
    body: PrepareRequest,
):
    tid = _validate_track_id(track_id)

    if not sep_module.is_available():
        from app.services.karaoke.models import KaraokeStatus, KaraokeInfo
        info = KaraokeInfo(
            track_id=tid,
            status=KaraokeStatus.FAILED,
            progress=0.0,
            ready=False,
            error=sep_module.get_error() or "Karaoke not available on this server",
        )
        return APIResponse(success=True, data=info.model_dump())

    # Validate stream_url is a real URL (basic check — do not expose SSRF risk)
    url = body.stream_url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="stream_url must be an http/https URL")

    rec = await karaoke_service.prepare(
        track_id=tid,
        stream_url=url,
        canonical_track_key=body.canonical_track_key,
    )
    from app.services.karaoke.models import KaraokeStatus, KaraokeInfo
    info = KaraokeInfo(
        track_id=rec.track_id,
        status=rec.status,
        progress=rec.progress,
        ready=rec.status == KaraokeStatus.READY,
        model_used=rec.model_used,
        error=rec.error,
    )
    return APIResponse(success=True, data=info.model_dump())


@router.get("/{track_id}/stream/{stem}", summary="Stream a separated stem")
async def stream_karaoke_stem(
    request: Request,
    track_id: str,
    stem: str,
):
    """
    Stream vocals or instrumental stem.

    stem must be 'vocals' or 'instrumental'.
    Returns 404 if not ready, 400 if stem name invalid.
    """
    tid = _validate_track_id(track_id)
    if not _STEM_RE.match(stem):
        raise HTTPException(status_code=400, detail="stem must be 'vocals' or 'instrumental'")

    path = await karaoke_service.get_stem_path(tid, stem)
    if not path or not os.path.exists(path):
        raise HTTPException(
            status_code=404,
            detail=f"Stem '{stem}' not ready for track {tid}. Call POST /prepare first.",
        )

    media_type = "audio/mpeg" if path.endswith(".mp3") else "audio/mp4"
    return FileResponse(
        path=path,
        media_type=media_type,
        headers={
            "Cache-Control": "no-store",  # stems may be replaced if re-processed
            "Accept-Ranges": "bytes",
        },
    )
