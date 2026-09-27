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
    tmp_wav = None
    try:
        # Step 1: Download audio to temp file
        import httpx
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", stream_url, headers={"User-Agent": "Mozilla/5.0"}) as response:
                response.raise_for_status()
                # Write to temp file preserving extension hint
                suffix = ".mp4" if ".mp4" in stream_url.lower() else (".mp3" if ".mp3" in stream_url.lower() else ".audio")
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                    tmp_audio = f.name
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        f.write(chunk)

        rec.progress = 0.20
        await karaoke_cache.upsert(rec)

        # Step 2: Convert to 16-bit 44.1kHz stereo PCM WAV so soundfile/libsndfile never fails
        tmp_wav = tmp_audio.rsplit(".", 1)[0] + "_norm.wav"
        import subprocess
        cmd = [
            "ffmpeg", "-y", "-i", tmp_audio,
            "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2",
            tmp_wav
        ]
        await asyncio.to_thread(
            subprocess.run,
            cmd,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        rec.progress = 0.35
        await karaoke_cache.upsert(rec)

        # Step 3: Run separation in thread with smooth progress updates
        stop_progress = asyncio.Event()

        async def _advance_progress():
            curr = 0.35
            while not stop_progress.is_set() and curr < 0.95:
                await asyncio.sleep(2.5)
                if stop_progress.is_set():
                    break
                curr = min(0.95, round(curr + 0.03, 2))
                r = await karaoke_cache.get(track_id)
                if r and r.status == KaraokeStatus.PROCESSING:
                    r.progress = curr
                    await karaoke_cache.upsert(r)

        progress_task = asyncio.create_task(_advance_progress())
        try:
            stems = await asyncio.to_thread(
                sep_module.separate_stems,
                tmp_wav,
                track_id,
            )
        finally:
            stop_progress.set()
            await progress_task

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
        for p in (tmp_audio, tmp_wav):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass
