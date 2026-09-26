"""
Canonical data models for the Word Synchronization Generation Layer.

Design Principles:
- Dual representations: original display lyrics are preserved verbatim; alignment text is normalized.
- Immutable line timestamps constrain word boundaries.
- Confidence scores track alignment reliability to prevent degraded karaoke experiences.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class SyncType(str, Enum):
    PLAIN = "PLAIN"
    LINE = "LINE"
    WORD = "WORD"
    DERIVED_WORD = "DERIVED_WORD"


class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class WordTimingType(str, Enum):
    ACOUSTIC_ANCHOR = "ACOUSTIC_ANCHOR"
    INTERPOLATED = "INTERPOLATED"
    UNCERTAIN = "UNCERTAIN"


class LyricsWord(_Base):
    """Word-level timestamped unit within a lyric line."""
    text: str
    start_ms: int
    end_ms: int
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    timing_type: WordTimingType = Field(default=WordTimingType.ACOUSTIC_ANCHOR)


class LyricsLine(_Base):
    """Line-level lyric unit containing text and optional word-level breakdowns."""
    id: int
    start_ms: Optional[int] = None
    end_ms: Optional[int] = None
    original: str
    alignment_text: Optional[str] = None
    romanized: Optional[str] = None
    words: list[LyricsWord] = Field(default_factory=list)
    is_instrumental: bool = False


class LyricsDocument(_Base):
    """Canonical persistent lyrics document."""
    id: str
    track_id: str
    canonical_track_key: Optional[str] = None
    provider: Optional[str] = None
    provider_track_id: Optional[str] = None
    identity_hash: str
    engine_version: str = "v4"
    title: str
    artist: str
    album: Optional[str] = None
    duration_ms: Optional[int] = None
    sync_type: SyncType
    lines: list[LyricsLine] = Field(default_factory=list)
    plain_text: Optional[str] = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    match_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    timing_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    line_source_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    alignment_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_provider: str
    engine_used: Optional[str] = None
    language: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AlignmentJob(_Base):
    """Asynchronous job descriptor for word alignment tasks."""
    job_id: str
    track_id: str
    canonical_track_key: Optional[str] = None
    provider: Optional[str] = None
    provider_track_id: Optional[str] = None
    identity_hash: str
    status: JobStatus = JobStatus.QUEUED
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    error: Optional[str] = None
    sync_type: Optional[SyncType] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
