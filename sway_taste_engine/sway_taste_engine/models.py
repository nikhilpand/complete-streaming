from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Generic, Optional, TypeVar
from pydantic import BaseModel, ConfigDict, Field, model_validator

T = TypeVar("T")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EventType(str, Enum):
    # Milestone playback events
    PLAY_STARTED = "play_started"
    PLAY_10S = "play_10s"
    PLAY_30S = "play_30s"
    PLAY_50PCT = "play_50pct"
    PROGRESS = "play_progress"
    COMPLETED = "play_completed"
    REPLAY = "replay"

    # Explicit positive signals
    LIKE = "like"
    SAVE = "save"

    # Explicit negative signals
    UNLIKE = "unlike"
    UNSAVE = "unsave"
    DISLIKE = "dislike"
    NOT_INTERESTED = "not_interested"

    # Skips (calibrated by duration milestone)
    SKIP_LT_10S = "skip_lt_10s"
    SKIP_10_30S = "skip_10_30s"
    SKIP = "skip"

    # Navigation & Discovery
    SEARCH = "search"
    ARTIST_OPEN = "artist_open"
    ALBUM_OPEN = "album_open"
    PLAYLIST_OPEN = "playlist_open"
    RECOMMENDATION_IMPRESSION = "recommendation_impression"
    RECOMMENDATION_CLICK = "recommendation_click"


class FeedType(str, Enum):
    FOR_YOU = "for_you"
    DISCOVER = "discover"
    AUTOPLAY = "autoplay"
    TRACK_RADIO = "track_radio"
    ARTIST_RADIO = "artist_radio"
    NEW_RELEASES = "new_releases"
    TRENDING = "trending"


class FeatureValue(BaseModel, Generic[T]):
    """
    Feature provenance container.
    Records derived attribute value alongside source origin and measurement confidence.
    If unmeasured, value is None and confidence is 0.0.
    """
    value: Optional[T] = None
    source: str = "unmeasured"
    confidence: float = 0.0


class ArtistRole(BaseModel):
    """Structured artist reference with explicit role taxonomy."""
    id: str
    name: str
    role: str = "primary"  # singer, composer, lyricist, featured, producer
    image_url: Optional[str] = None


class Track(BaseModel):
    model_config = ConfigDict(extra="allow")

    # Factual features
    id: str
    title: str
    artist_id: str = ""
    artist_name: str = ""
    artists: list[ArtistRole] = Field(default_factory=list)
    album: Optional[str] = None
    album_id: Optional[str] = None
    album_name: Optional[str] = None
    year: Optional[int] = None
    duration_ms: Optional[int] = Field(default=None, ge=0)
    language: Optional[str] = None
    composers: list[str] = Field(default_factory=list)
    lyricists: list[str] = Field(default_factory=list)
    genres: list[str] = Field(default_factory=list)
    moods: list[str] = Field(default_factory=list)
    popularity: float = Field(default=0.5, ge=0, le=1)
    release_ts: Optional[float] = None
    artwork_url: Optional[str] = None
    provider_available: dict[str, bool] = Field(default_factory=dict)
    embedding: Optional[list[float]] = None

    # Derived features with provenance (Zero fake defaults)
    energy: Optional[float] = Field(default=None, ge=0, le=1)
    bpm: Optional[float] = Field(default=None, ge=0)
    energy_feature: FeatureValue[float] = Field(default_factory=FeatureValue[float])
    bpm_feature: FeatureValue[float] = Field(default_factory=FeatureValue[float])

    @model_validator(mode="before")
    @classmethod
    def _default_artist(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "artists" in data and data["artists"] and not data.get("artist_name"):
                first = data["artists"][0]
                if isinstance(first, dict):
                    data.setdefault("artist_id", first.get("id", ""))
                    data.setdefault("artist_name", first.get("name", ""))
                elif hasattr(first, "name"):
                    data.setdefault("artist_id", getattr(first, "id", ""))
                    data.setdefault("artist_name", getattr(first, "name", ""))
        return data

    @model_validator(mode="after")
    def _sync_provenance(self) -> Track:
        if not self.artist_name and self.artists:
            self.artist_name = self.artists[0].name
            if not self.artist_id:
                self.artist_id = self.artists[0].id
        if not self.album and self.album_name:
            self.album = self.album_name
        elif self.album and not self.album_name:
            self.album_name = self.album
        if self.energy is not None and self.energy_feature.value is None:
            self.energy_feature = FeatureValue[float](value=self.energy, source="direct_input", confidence=1.0)
        elif self.energy is None and self.energy_feature.value is not None:
            self.energy = self.energy_feature.value

        if self.bpm is not None and self.bpm_feature.value is None:
            self.bpm_feature = FeatureValue[float](value=self.bpm, source="direct_input", confidence=1.0)
        elif self.bpm is None and self.bpm_feature.value is not None:
            self.bpm = self.bpm_feature.value
        return self

    @property
    def playable(self) -> bool:
        return any(self.provider_available.values()) if self.provider_available else True


class UserEvent(BaseModel):
    event_id: str
    user_id: str
    session_id: str = "sess_default"
    event_type: EventType
    account_id: Optional[str] = None
    anonymous_id: Optional[str] = None
    track_id: Optional[str] = None
    artist_id: Optional[str] = None
    album_id: Optional[str] = None
    position_ms: Optional[int] = Field(default=None, ge=0)
    duration_ms: Optional[int] = Field(default=None, ge=0)
    completion_ratio: Optional[float] = Field(default=None, ge=0, le=1)
    effective_weight: float = 1.0
    source: Optional[str] = None
    recommendation_id: Optional[str] = None
    query: Optional[str] = None
    timestamp: datetime = Field(default_factory=utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _ensure_identity(self) -> UserEvent:
        if not self.anonymous_id and self.user_id.startswith("anon-"):
            self.anonymous_id = self.user_id
        if not self.account_id and not self.user_id.startswith("anon-"):
            self.account_id = self.user_id
        return self

    @property
    def played_ratio(self) -> float:
        if self.completion_ratio is not None:
            return max(0.0, min(1.0, self.completion_ratio))
        if self.position_ms is not None and self.duration_ms:
            return max(0.0, min(1.0, self.position_ms / self.duration_ms))
        return 0.0


class RecommendationContext(BaseModel):
    current_track_id: Optional[str] = None
    recent_track_ids: list[str] = Field(default_factory=list)
    session_id: Optional[str] = None
    activity: str = "unknown"
    energy_preference: Optional[float] = Field(default=None, ge=0, le=1)
    novelty_preference: float = Field(default=0.25, ge=0, le=1)
    language_preferences: list[str] = Field(default_factory=list)


class Bucket(BaseModel):
    positive: float = 0.0
    negative: float = 0.0
    last_seen: Optional[float] = None
    count: int = 0

    @property
    def net(self) -> float:
        return self.positive - self.negative


class HorizonTasteState(BaseModel):
    """Taste preference buckets bound to an explicit time decay horizon."""
    artist: dict[str, Bucket] = Field(default_factory=dict)
    genre: dict[str, Bucket] = Field(default_factory=dict)
    language: dict[str, Bucket] = Field(default_factory=dict)
    mood: dict[str, Bucket] = Field(default_factory=dict)
    track: dict[str, Bucket] = Field(default_factory=dict)
    composer: dict[str, Bucket] = Field(default_factory=dict)
    mean_energy: Optional[float] = None

    @property
    def artist_affinity(self) -> dict[str, float]:
        return {k: b.net for k, b in self.artist.items()}

    @property
    def genre_affinity(self) -> dict[str, float]:
        return {k: b.net for k, b in self.genre.items()}


class SessionTasteState(BaseModel):
    """Immediate listening context within the active session."""
    session_id: Optional[str] = None
    recent_tracks: list[str] = Field(default_factory=list)
    recent_artists: list[str] = Field(default_factory=list)
    active_moods: list[str] = Field(default_factory=list)
    energy_drift: list[float] = Field(default_factory=list)


class NegativeMemoryState(BaseModel):
    """Explicit blacklists and high-confidence skips."""
    explicit_negative_tracks: set[str] = Field(default_factory=set)
    explicit_negative_artists: set[str] = Field(default_factory=set)
    high_confidence_skips: set[str] = Field(default_factory=set)


class UserTasteProfile(BaseModel):
    user_id: str
    updated_at: datetime = Field(default_factory=utcnow)
    total_events: int = 0

    # Multi-horizon state
    long_term: HorizonTasteState = Field(default_factory=HorizonTasteState)
    recent_30d: HorizonTasteState = Field(default_factory=HorizonTasteState)
    session_state: SessionTasteState = Field(default_factory=SessionTasteState)
    negative_memory: NegativeMemoryState = Field(default_factory=NegativeMemoryState)

    novelty_tolerance: float = 0.25
    familiarity_preference: float = 0.75
    recent_recommendations: list[str] = Field(default_factory=list)

    # Backward-compatible accessors for existing engines and test suites
    @property
    def artist(self) -> dict[str, Bucket]:
        return self.recent_30d.artist

    @property
    def artist_affinity(self) -> dict[str, float]:
        return self.recent_30d.artist_affinity

    @property
    def genre(self) -> dict[str, Bucket]:
        return self.recent_30d.genre

    @property
    def genre_affinity(self) -> dict[str, float]:
        return self.recent_30d.genre_affinity

    @property
    def language(self) -> dict[str, Bucket]:
        return self.recent_30d.language

    @property
    def mood(self) -> dict[str, Bucket]:
        return self.recent_30d.mood

    @property
    def track(self) -> dict[str, Bucket]:
        return self.recent_30d.track

    @property
    def explicit_negative_tracks(self) -> set[str]:
        return self.negative_memory.explicit_negative_tracks

    @property
    def explicit_negative_artists(self) -> set[str]:
        return self.negative_memory.explicit_negative_artists

    @property
    def recent_tracks(self) -> list[str]:
        return self.session_state.recent_tracks

    @recent_tracks.setter
    def recent_tracks(self, val: list[str]) -> None:
        self.session_state.recent_tracks = val

    @property
    def recent_artists(self) -> list[str]:
        return self.session_state.recent_artists

    @recent_artists.setter
    def recent_artists(self, val: list[str]) -> None:
        self.session_state.recent_artists = val

    @property
    def recent_albums(self) -> list[str]:
        return [x for x in self.session_state.recent_tracks if x]

    @recent_albums.setter
    def recent_albums(self, val: list[str]) -> None:
        pass

    @property
    def recent_energy(self) -> Optional[float]:
        return self.recent_30d.mean_energy

    @recent_energy.setter
    def recent_energy(self, val: Optional[float]) -> None:
        self.recent_30d.mean_energy = val

    @property
    def long_term_energy(self) -> Optional[float]:
        return self.long_term.mean_energy

    @long_term_energy.setter
    def long_term_energy(self, val: Optional[float]) -> None:
        self.long_term.mean_energy = val

    def _make_bucket(self) -> Bucket:
        return Bucket()


class ScoreBreakdown(BaseModel):
    """Explainable attribution components for a ranked recommendation item."""
    total: float
    components: dict[str, float] = Field(default_factory=dict)
    explanation_type: str = "recommendation"
    explanation_label: str = "Recommended for you"
    reference_track_id: Optional[str] = None
    reference_artist_id: Optional[str] = None
    negative_checks_passed: bool = True


class RecommendationExplanation(BaseModel):
    type: str
    label: str
    reference_track_id: Optional[str] = None
    reference_artist_id: Optional[str] = None


class RecommendationItem(BaseModel):
    recommendation_id: str
    track: Track
    rank: int
    score: float
    source: str
    explanation: Optional[RecommendationExplanation] = None
    attribution: Optional[ScoreBreakdown] = None


class RecommendationResponse(BaseModel):
    feed: FeedType
    items: list[RecommendationItem]
    next_cursor: Optional[str] = None
    algorithm_version: str
    profile_version: str
