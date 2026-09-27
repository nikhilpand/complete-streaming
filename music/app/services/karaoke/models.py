"""
Karaoke service data models.
"""
from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field

class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

class KaraokeStatus(str, Enum):
    NOT_PREPARED = "not_prepared"
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"

class KaraokeJobRecord(_Base):
    track_id: str                              # SWAY canonical track ID
    canonical_track_key: Optional[str] = None  # e.g. 'saavn:xyz'
    status: KaraokeStatus = KaraokeStatus.NOT_PREPARED
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    error: Optional[str] = None
    vocals_path: Optional[str] = None          # absolute path to vocals stem
    instrumental_path: Optional[str] = None    # absolute path to instrumental stem
    model_used: Optional[str] = None
    duration_sec: Optional[float] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class KaraokeInfo(_Base):
    """Public response model — no internal file paths exposed."""
    track_id: str
    status: KaraokeStatus
    progress: float
    ready: bool
    model_used: Optional[str] = None
    error: Optional[str] = None
