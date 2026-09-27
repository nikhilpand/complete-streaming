"""
Karaoke service — orchestrates download → separation → caching.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from app.services.karaoke.models import KaraokeJobRecord, KaraokeStatus, KaraokeInfo
from app.services.karaoke.cache import karaoke_cache
from app.services.karaoke import separator as sep_module

logger = logging.getLogger(__name__)


async def get_status(track_id: str) -> KaraokeInfo:
    """Return current karaoke status for a track."""
    rec = await karaoke_cache.get(track_id)
    if not rec:
        return KaraokeInfo(
            track_id=track_id,
            status=KaraokeStatus.NOT_PREPARED,
            progress=0.0,
            ready=False,
        )
    return KaraokeInfo(
        track_id=track_id,
        status=rec.status,
        progress=rec.progress,
        ready=rec.status == KaraokeStatus.READY,
        model_used=rec.model_used,
        error=rec.error,
    )


async def get_stem_path(track_id: str, stem: str) -> Optional[str]:
    """
    Return absolute file path for the requested stem ('vocals' or 'instrumental').
    Returns None if not ready.
    """
    rec = await karaoke_cache.get(track_id)
    if not rec or rec.status != KaraokeStatus.READY:
        return None
    if stem == "vocals":
        return rec.vocals_path
    elif stem == "instrumental":
        return rec.instrumental_path
    return None


async def prepare(
    track_id: str,
    stream_url: str,
    canonical_track_key: Optional[str] = None,
) -> KaraokeJobRecord:
    """
    Start karaoke preparation for a track.

    If already ready or processing, returns existing record.
    Otherwise enqueues background work.
    """
    # Check if already done
    existing = await karaoke_cache.get(track_id)
    if existing:
        if existing.status in (KaraokeStatus.READY, KaraokeStatus.PROCESSING, KaraokeStatus.QUEUED):
            return existing

    # Check availability before creating a record
    if not sep_module.is_available():
        err = sep_module.get_error() or "Vocal separator not available"
        rec = KaraokeJobRecord(
            track_id=track_id,
            canonical_track_key=canonical_track_key,
            status=KaraokeStatus.FAILED,
            error=err,
        )
        await karaoke_cache.upsert(rec)
        return rec

    # Create queued record
    rec = KaraokeJobRecord(
        track_id=track_id,
        canonical_track_key=canonical_track_key,
        status=KaraokeStatus.QUEUED,
        progress=0.0,
    )
    await karaoke_cache.upsert(rec)

    # Spawn background task (fire-and-forget)
    asyncio.create_task(
        _run_separation(track_id=track_id, stream_url=stream_url, canonical_track_key=canonical_track_key)
    )

    return rec


async def _run_separation(
    track_id: str,
    stream_url: str,
    canonical_track_key: Optional[str],
) -> None:
    """Background task: download audio, run separation, update cache."""
    # Mark as processing
    rec = await karaoke_cache.get(track_id)
    if not rec:
        return
    rec.status = KaraokeStatus.PROCESSING
    rec.progress = 0.05
    await karaoke_cache.upsert(rec)

    tmp_audio = None
    try:
        # Step 1: Download audio to temp file
        import httpx
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", stream_url) as response:
                response.raise_for_status()
                # Write to temp file preserving extension hint
                suffix = ".mp3" if "mp3" in stream_url.lower() else ".m4a"
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                    tmp_audio = f.name
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        f.write(chunk)

        rec.progress = 0.30
        await karaoke_cache.upsert(rec)

        # Step 2: Run separation in thread (CPU-bound)
        stems = await asyncio.to_thread(
            sep_module.separate_stems,
            tmp_audio,
            track_id,
        )

        rec.status = KaraokeStatus.READY
        rec.progress = 1.0
        rec.vocals_path = stems["vocals"]
        rec.instrumental_path = stems["instrumental"]
        rec.model_used = sep_module.DEFAULT_MODEL
        await karaoke_cache.upsert(rec)
        logger.info("KaraokeService: separation complete for %s", track_id)

    except Exception as e:
        logger.exception("KaraokeService: separation failed for %s: %s", track_id, e)
        if rec:
            rec.status = KaraokeStatus.FAILED
            rec.error = str(e)[:500]
            rec.progress = 0.0
            await karaoke_cache.upsert(rec)
    finally:
        if tmp_audio and os.path.exists(tmp_audio):
            try:
                os.unlink(tmp_audio)
            except OSError:
                pass
