"""
Lyrics router — GET /api/v1/lyrics

Provides:
- Synchronized and Word-level lyrics retrieval from persistent cache
- Asynchronous word synchronization generation triggering
- Job status polling
- Existing provider lyrics retrieval (backward compatible)
"""

from __future__ import annotations

import re
import hashlib
from typing import Optional, List
from fastapi import APIRouter, Query, Request, HTTPException, Body
from pydantic import BaseModel, Field

from app.core.errors import ProviderInvalidRequest
from app.models import APIResponse
from app.services.alignment.models import LyricsLine, LyricsDocument, AlignmentJob
from app.services.alignment.storage import storage
from app.services.alignment.worker import alignment_worker

router = APIRouter(prefix="/lyrics", tags=["Lyrics"])

_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


def _validate_id(lyrics_id: str) -> str:
    lid = lyrics_id.strip()
    if not _ID_RE.match(lid):
        raise ProviderInvalidRequest(f"Invalid lyrics ID format: {lid!r}", provider="saavn")
    return lid


class GenerateLyricsRequest(BaseModel):
    title: str
    artist: str
    album: Optional[str] = None
    duration_ms: Optional[int] = None
    lines: List[LyricsLine] = Field(default_factory=list)
    identity_hash: Optional[str] = None
    stream_url: Optional[str] = None


@router.get("/sync/{track_id}", response_model=APIResponse, summary="Get synchronized lyrics from persistent store")
async def get_synchronized_lyrics(
    track_id: str,
    identity_hash: Optional[str] = Query(None, description="Optional canonical identity hash"),
):
    """
    Check if a high-quality synchronized or word-aligned lyrics document
    exists in the persistent store for this track.
    """
    doc = None
    if identity_hash:
        doc = await storage.get_lyrics_by_hash(identity_hash)
    if not doc:
        doc = await storage.get_lyrics_by_id(track_id)

    if not doc:
        return APIResponse(success=True, data=None)

    return APIResponse(success=True, data=doc.model_dump())


@router.get("/jobs/{job_id}", response_model=APIResponse, summary="Get alignment job status")
async def get_alignment_job_status(job_id: str):
    """Poll the status and progress of an asynchronous alignment job."""
    job = await storage.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return APIResponse(success=True, data=job.model_dump())


@router.post("/{track_id}/generate", response_model=APIResponse, summary="Trigger asynchronous word alignment")
async def generate_word_alignment(
    request: Request,
    track_id: str,
    payload: GenerateLyricsRequest = Body(...),
):
    """
    Trigger server-side asynchronous word alignment for a track.

    The request returns immediately with an AlignmentJob descriptor (status: QUEUED or PROCESSING).
    The client or frontend resolver can continue using line-synced lyrics immediately
    while the worker generates word timestamps in the background.
    """
    provider = getattr(request.app.state, "provider", None)

    # Compute identity hash if not provided
    ident_hash = payload.identity_hash
    if not ident_hash:
        raw_key = f"{payload.title.strip().lower()}|{payload.artist.strip().lower()}|{int((payload.duration_ms or 0) / 5000)}"
        ident_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:16]

    job = await alignment_worker.enqueue_alignment(
        track_id=track_id,
        identity_hash=ident_hash,
        title=payload.title,
        artist=payload.artist,
        duration_ms=payload.duration_ms,
        lines=payload.lines,
        stream_url=payload.stream_url,
        provider_instance=provider,
    )

    return APIResponse(success=True, data=job.model_dump())


@router.get("/{lyrics_id}", response_model=APIResponse, summary="Get lyrics by ID from provider")
async def get_lyrics(request: Request, lyrics_id: str):
    """
    Retrieve lyrics for a given lyrics_id from upstream provider.

    The lyrics_id is obtained from Song.lyrics_id (only present when has_lyrics=True).
    If synced/timestamped lyrics are unavailable, the 'synced' field will be null.
    """
    provider = request.app.state.provider
    validated = _validate_id(lyrics_id)
    lyrics = await provider.get_lyrics(validated)
    return APIResponse(success=True, data=lyrics.model_dump())
