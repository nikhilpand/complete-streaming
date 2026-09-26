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
        canonical_track_key: Optional[str] = None,
        provider: Optional[str] = None,
        provider_track_id: Optional[str] = None,
        stream_url: Optional[str] = None,
        provider_instance = None,
    ) -> AlignmentJob:
        """
        Check for existing cache/job and enqueue background alignment task.
        """
        c_key = canonical_track_key or track_id

        # 1. Check if high-quality word sync is already stored
        existing_doc = await storage.get_lyrics_by_canonical_key(c_key, identity_hash)
        if not existing_doc:
            existing_doc = await storage.get_lyrics_by_hash(identity_hash)

        if existing_doc and existing_doc.sync_type in (SyncType.WORD, SyncType.DERIVED_WORD) and existing_doc.confidence >= 0.78:
            job_id = f"job_hit_{uuid.uuid4().hex[:12]}"
            return AlignmentJob(
                job_id=job_id,
                track_id=track_id,
                canonical_track_key=c_key,
                provider=provider,
                provider_track_id=provider_track_id,
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
        job = await storage.create_job(
            job_id=job_id,
            track_id=track_id,
            canonical_track_key=c_key,
            provider=provider,
            provider_track_id=provider_track_id,
            identity_hash=identity_hash,
        )

        # 4. Spawn background task
        task = asyncio.create_task(
            self._execute_alignment_pipeline(
                job_id=job_id,
                track_id=track_id,
                canonical_track_key=c_key,
                provider=provider,
                provider_track_id=provider_track_id,
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
        canonical_track_key: str,
        provider: Optional[str],
        provider_track_id: Optional[str],
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

                # 1. Resolve stream URL if not directly passed (Audio Stream Parity)
                resolved_url = stream_url
                if not resolved_url and provider_instance:
                    try:
                        if canonical_track_key.startswith("youtube:") and hasattr(provider_instance, "ytmusic") and provider_instance.ytmusic:
                            yt_id = provider_track_id or canonical_track_key.split("youtube:", 1)[1]
                            song = await provider_instance.ytmusic.get_song(yt_id)
                            media = await provider_instance.ytmusic.resolve_media(song)
                        else:
                            song = await provider_instance.get_song(track_id)
                            media = await provider_instance.resolve_media(song)

                        if media and media.streams:
                            best_stream = max(media.streams, key=lambda s: s.bitrate_kbps or 0)
                            resolved_url = best_stream.url
                    except Exception as res_err:
                        logger.warning("Stream resolution error for %s: %s", canonical_track_key, res_err)

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

                # 3. Two-Stage Monotonic Alignment
                total_lines = len(lines)
                if total_lines == 0:
                    await storage.update_job(
                        job_id,
                        JobStatus.FAILED,
                        progress=0.0,
                        error="No lyric lines provided for alignment",
                    )
                    return

                sample_text = " ".join(l.original for l in lines[:10] if not l.is_instrumental)
                from app.services.alignment.normalizer import detect_language
                lang_code = detect_language(sample_text)

                await storage.update_job(job_id, JobStatus.PROCESSING, progress=0.40)

                # Execute two-stage alignment in thread pool
                aligned_lines, is_valid_stage, anchor_rate = await asyncio.to_thread(
                    self.engine.align_track,
                    audio_pcm,
                    lines,
                    16000,
                    lang_code,
                )

                await storage.update_job(job_id, JobStatus.PROCESSING, progress=0.85)

                if is_valid_stage:
                    # 4. Quality Validation
                    is_valid, aggregate_conf, errors = AlignmentValidator.validate_document(aligned_lines)
                else:
                    is_valid = False
                    aggregate_conf = 0.0
                    errors = [f"Anchor rate ({anchor_rate:.1%}) below 60% requirement or gap too wide"]

                if is_valid:
                    # Construct and save DERIVED_WORD document
                    doc = LyricsDocument(
                        id=f"doc_{uuid.uuid4().hex[:12]}",
                        track_id=track_id,
                        canonical_track_key=canonical_track_key,
                        provider=provider,
                        provider_track_id=provider_track_id,
                        identity_hash=identity_hash,
                        engine_version="v4",
                        title=title,
                        artist=artist,
                        duration_ms=duration_ms,
                        sync_type=SyncType.DERIVED_WORD,
                        lines=aligned_lines,
                        plain_text="\n".join(l.original for l in lines),
                        confidence=aggregate_conf,
                        match_confidence=1.0,
                        timing_confidence=aggregate_conf,
                        line_source_confidence=1.0,
                        alignment_confidence=anchor_rate,
                        source_provider="alignment_worker",
                        engine_used="whisper_two_stage",
                        language=lang_code,
                    )
                    await storage.save_lyrics(doc)
                    await storage.update_job(
                        job_id,
                        JobStatus.COMPLETED,
                        progress=1.0,
                        sync_type=SyncType.DERIVED_WORD,
                    )
                    logger.info("Successfully generated DERIVED_WORD alignment for '%s' (conf: %.2f, anchor_rate: %.2f)", title, aggregate_conf, anchor_rate)
                else:
                    err_summary = "; ".join(errors[:3])
                    logger.warning("Alignment rejected for '%s': %s", title, err_summary)
                    # Safe fallback to LINE sync with explicit calibrated confidences (Point 16)
                    fallback_doc = LyricsDocument(
                        id=f"doc_{uuid.uuid4().hex[:12]}",
                        track_id=track_id,
                        canonical_track_key=canonical_track_key,
                        provider=provider,
                        provider_track_id=provider_track_id,
                        identity_hash=identity_hash,
                        engine_version="v4",
                        title=title,
                        artist=artist,
                        duration_ms=duration_ms,
                        sync_type=SyncType.LINE,
                        lines=[l.model_copy(update={"words": []}) for l in lines],
                        plain_text="\n".join(l.original for l in lines),
                        confidence=0.85,
                        match_confidence=1.0,
                        timing_confidence=0.85,
                        line_source_confidence=0.85,
                        alignment_confidence=0.0,  # Explicitly 0.0 for failed alignment
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
