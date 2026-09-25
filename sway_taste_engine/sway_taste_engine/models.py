from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

def utcnow() -> datetime:
    return datetime.now(timezone.utc)

class EventType(str, Enum):
    PLAY_STARTED = "play_started"
    PROGRESS = "play_progress"
    COMPLETED = "play_completed"
    SKIP = "skip"
    LIKE = "like"
    UNLIKE = "unlike"
    DISLIKE = "dislike"
    REPLAY = "replay"
    SAVE = "save"
    UNSAVE = "unsave"
    SEARCH = "search"
    ARTIST_OPEN = "artist_open"
    ALBUM_OPEN = "album_open"
    PLAYLIST_OPEN = "playlist_open"
    RECOMMENDATION_IMPRESSION = "recommendation_impression"
    RECOMMENDATION_CLICK = "recommendation_click"
    NOT_INTERESTED = "not_interested"

class FeedType(str, Enum):
    FOR_YOU = "for_you"
    DISCOVER = "discover"
    AUTOPLAY = "autoplay"
    TRACK_RADIO = "track_radio"
    ARTIST_RADIO = "artist_radio"
    NEW_RELEASES = "new_releases"
    TRENDING = "trending"

class Track(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    title: str
    artist_id: str
    artist_name: str
    album_id: str | None = None
    album_name: str | None = None
    genres: list[str] = Field(default_factory=list)
    language: str | None = None
    moods: list[str] = Field(default_factory=list)
    energy: float | None = Field(default=None, ge=0, le=1)
    bpm: float | None = Field(default=None, ge=0)
    popularity: float = Field(default=0.5, ge=0, le=1)
    release_ts: float | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    provider_available: dict[str, bool] = Field(default_factory=dict)
    embedding: list[float] | None = None

    @property
    def playable(self) -> bool:
        return any(self.provider_available.values()) if self.provider_available else True

class UserEvent(BaseModel):
    event_id: str
    user_id: str
    session_id: str
    event_type: EventType
    track_id: str | None = None
    artist_id: str | None = None
    album_id: str | None = None
    position_ms: int | None = Field(default=None, ge=0)
    duration_ms: int | None = Field(default=None, ge=0)
    completion_ratio: float | None = Field(default=None, ge=0, le=1)
    source: str | None = None
    recommendation_id: str | None = None
    query: str | None = None
    timestamp: datetime = Field(default_factory=utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def played_ratio(self) -> float:
        if self.completion_ratio is not None:
            return max(0.0, min(1.0, self.completion_ratio))
        if self.position_ms is not None and self.duration_ms:
            return max(0.0, min(1.0, self.position_ms / self.duration_ms))
        return 0.0

class RecommendationContext(BaseModel):
    current_track_id: str | None = None
    recent_track_ids: list[str] = Field(default_factory=list)
    session_id: str | None = None
    activity: str = "unknown"
    energy_preference: float | None = Field(default=None, ge=0, le=1)
    novelty_preference: float = Field(default=0.25, ge=0, le=1)
    language_preferences: list[str] = Field(default_factory=list)

class Bucket(BaseModel):
    positive: float = 0.0
    negative: float = 0.0
    last_seen: float | None = None
    count: int = 0
    @property
    def net(self) -> float:
        return self.positive - self.negative

class UserTasteProfile(BaseModel):
    user_id: str
    updated_at: datetime = Field(default_factory=utcnow)
    artist: dict[str, Bucket] = Field(default_factory=dict)
    genre: dict[str, Bucket] = Field(default_factory=dict)
    language: dict[str, Bucket] = Field(default_factory=dict)
    mood: dict[str, Bucket] = Field(default_factory=dict)
    track: dict[str, Bucket] = Field(default_factory=dict)
    long_term_energy: float | None = None
    recent_energy: float | None = None
    novelty_tolerance: float = 0.25
    familiarity_preference: float = 0.75
    explicit_negative_tracks: set[str] = Field(default_factory=set)
    explicit_negative_artists: set[str] = Field(default_factory=set)
    recent_tracks: list[str] = Field(default_factory=list)
    recent_artists: list[str] = Field(default_factory=list)
    recent_albums: list[str] = Field(default_factory=list)
    recent_recommendations: list[str] = Field(default_factory=list)

class RecommendationExplanation(BaseModel):
    type: str
    label: str
    reference_track_id: str | None = None
    reference_artist_id: str | None = None

class RecommendationItem(BaseModel):
    recommendation_id: str
    track: Track
    rank: int
    score: float
    source: str
    explanation: RecommendationExplanation | None = None

class RecommendationResponse(BaseModel):
    feed: FeedType
    items: list[RecommendationItem]
    next_cursor: str | None = None
    algorithm_version: str
    profile_version: str
