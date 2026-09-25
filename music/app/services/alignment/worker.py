"""
Asynchronous Alignment Worker and Concurrency Manager.

Coordinates audio downloading, line-constrained windowing, ML alignment,
quality validation, and persistent storage with semaphore concurrency control.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Optional, List

from app.services.alignment.models import (
    AlignmentJob,
    JobStatus,
    LyricsDocument,
    LyricsLine,
    LyricsWord,
    SyncType,
)
from app.services.alignment.storage import storage
from app.services.alignment.audio_provider import AudioProvider
from app.services.alignment.whisper_engine import WhisperAlignmentEngine
from app.services.alignment.validator import AlignmentValidator
from app.services.alignment.normalizer import detect_script

logger = logging.getLogger(__name__)


class AlignmentWorkerManager:
    def __init__(self, max_concurrency: int = 2):
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.engine = WhisperAlignmentEngine(model_size="base")
        self._active_tasks: dict[str, asyncio.Task] = {}

    async def enqueue_alignment(
        self,
        track_id: str,
        identity_hash: str,
        title: str,
        artist: str,
        duration_ms: Optional[int],
        lines: List[LyricsLine],
        stream_url: Optional[str] = None,
        provider_instance = None,
    ) -> AlignmentJob:
        """
        Check for existing cache/job and enqueue background alignment task.
        """
        # 1. Check if high-quality word sync is already stored
        existing_doc = await storage.get_lyrics_by_hash(identity_hash)
        if existing_doc and existing_doc.sync_type in (SyncType.WORD, SyncType.DERIVED_WORD) and existing_doc.confidence >= 0.78:
            job_id = f"job_hit_{uuid.uuid4().hex[:12]}"
            return AlignmentJob(
                job_id=job_id,
                track_id=track_id,
                identity_hash=identity_hash,
                status=JobStatus.COMPLETED,
                progress=1.0,
                sync_type=existing_doc.sync_type,
            )

        # 2. Check if a job is already in flight for this track identity
        active_job = await storage.get_active_job_by_hash(identity_hash)
        if active_job:
            return active_job

        # 3. Create new job entry
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job = await storage.create_job(job_id=job_id, track_id=track_id, identity_hash=identity_hash)

        # 4. Spawn background task
        task = asyncio.create_task(
            self._execute_alignment_pipeline(
                job_id=job_id,
                track_id=track_id,
                identity_hash=identity_hash,
                title=title,
                artist=artist,
                duration_ms=duration_ms,
                lines=lines,
                stream_url=stream_url,
                provider_instance=provider_instance,
            )
        )
        self._active_tasks[job_id] = task

        def _cleanup(_):
            self._active_tasks.pop(job_id, None)

        task.add_done_callback(_cleanup)
        return job

    async def _execute_alignment_pipeline(
        self,
        job_id: str,
        track_id: str,
        identity_hash: str,
        title: str,
        artist: str,
        duration_ms: Optional[int],
        lines: List[LyricsLine],
        stream_url: Optional[str],
        provider_instance,
    ) -> None:
        async with self.semaphore:
            try:
                await storage.update_job(job_id, JobStatus.PROCESSING, progress=0.05)

                # 1. Resolve stream URL if not directly passed
                resolved_url = stream_url
                if not resolved_url and provider_instance:
                    song = await provider_instance.get_song(track_id)
                    media = await provider_instance.resolve_media(song)
                    if media and media.streams:
                        # Pick highest bitrate stream
                        best_stream = max(media.streams, key=lambda s: s.bitrate_kbps or 0)
                        resolved_url = best_stream.url

                if not resolved_url:
                    await storage.update_job(
                        job_id,
                        JobStatus.FAILED,
                        progress=0.0,
                        error="Could not resolve media stream URL for track",
                    )
                    return

                # 2. Stream and decode audio to 16kHz mono float32
                await storage.update_job(job_id, JobStatus.PROCESSING, progress=0.20)
                audio_pcm = await AudioProvider.fetch_and_decode(resolved_url)

                if len(audio_pcm) == 0:
                    await storage.update_job(
                        job_id,
                        JobStatus.FAILED,
                        progress=0.0,
                        error="Audio stream decoded to 0 samples",
                    )
                    return

                # 3. Line-constrained alignment loop
                total_lines = len(lines)
                if total_lines == 0:
                    await storage.update_job(
                        job_id,
                        JobStatus.FAILED,
                        progress=0.0,
                        error="No lyric lines provided for alignment",
                    )
                    return

                # Track-level language detection hint
                sample_text = " ".join(l.original for l in lines[:5])
                script = detect_script(sample_text)
                lang_code = "hi" if script == "devanagari" else "pa" if script == "gurmukhi" else "en"

                aligned_lines: List[LyricsLine] = []

                for idx, line in enumerate(lines):
                    # Progress from 0.25 to 0.85
                    curr_progress = 0.25 + (0.60 * (idx / total_lines))
                    await storage.update_job(job_id, JobStatus.PROCESSING, progress=round(curr_progress, 2))

                    if line.is_instrumental or not line.original.strip():
                        aligned_lines.append(line.model_copy(update={"words": []}))
                        continue

                    # Fallback boundary if line timestamps missing
                    st = line.start_ms if line.start_ms is not None else 0
                    en = line.end_ms if line.end_ms is not None else st + 3500

                    window_pcm, win_start = AudioProvider.slice_window(audio_pcm, st, en, pad_ms=250)

                    # Align words in window
                    words = await self.engine.align_line_async(
                        audio_window_pcm=window_pcm,
                        window_start_ms=win_start,
                        line=line,
                        language=lang_code,
                    )

                    aligned_lines.append(line.model_copy(update={"words": words}))

                # 4. Quality Validation
                await storage.update_job(job_id, JobStatus.PROCESSING, progress=0.90)
                is_valid, aggregate_conf, errors = AlignmentValidator.validate_document(aligned_lines)

                if is_valid:
                    # Construct and save DERIVED_WORD document
                    doc = LyricsDocument(
                        id=f"doc_{uuid.uuid4().hex[:12]}",
                        track_id=track_id,
                        identity_hash=identity_hash,
                        title=title,
                        artist=artist,
                        duration_ms=duration_ms,
                        sync_type=SyncType.DERIVED_WORD,
                        lines=aligned_lines,
                        plain_text="\n".join(l.original for l in lines),
                        confidence=aggregate_conf,
                        source_provider="alignment_worker",
                        engine_used="whisper_line_constrained",
                        language=lang_code,
                    )
                    await storage.save_lyrics(doc)
                    await storage.update_job(
                        job_id,
                        JobStatus.COMPLETED,
                        progress=1.0,
                        sync_type=SyncType.DERIVED_WORD,
                    )
                    logger.info("Successfully generated DERIVED_WORD alignment for '%s' (conf: %.2f)", title, aggregate_conf)
                else:
                    err_summary = "; ".join(errors[:3])
                    logger.warning("Alignment rejected for '%s' (conf: %.2f): %s", title, aggregate_conf, err_summary)
                    # Safe fallback to LINE sync
                    fallback_doc = LyricsDocument(
                        id=f"doc_{uuid.uuid4().hex[:12]}",
                        track_id=track_id,
                        identity_hash=identity_hash,
                        title=title,
                        artist=artist,
                        duration_ms=duration_ms,
                        sync_type=SyncType.LINE,
                        lines=[l.model_copy(update={"words": []}) for l in lines],
                        plain_text="\n".join(l.original for l in lines),
                        confidence=0.85,
                        source_provider="alignment_fallback",
                        engine_used="line_fallback",
                        language=lang_code,
                    )
                    await storage.save_lyrics(fallback_doc)
                    await storage.update_job(
                        job_id,
                        JobStatus.FAILED,
                        progress=1.0,
                        error=f"Rejected: {err_summary}",
                        sync_type=SyncType.LINE,
                    )

            except Exception as e:
                logger.exception("Error during alignment execution for job %s: %s", job_id, e)
                await storage.update_job(job_id, JobStatus.FAILED, progress=0.0, error=str(e))


# Global worker manager instance
alignment_worker = AlignmentWorkerManager(max_concurrency=2)
