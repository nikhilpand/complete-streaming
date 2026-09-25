from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .config import RecommendationWeights
from .models import EventType, UserEvent, utcnow


class EventNormalizer:
    """Validates telemetry, resolves 3-tier identity, and computes calibrated event weights."""

    def __init__(self, weights: Optional[RecommendationWeights] = None) -> None:
        self.weights = weights or RecommendationWeights()

    def normalize(self, raw: dict[str, Any] | UserEvent) -> UserEvent:
        if isinstance(raw, UserEvent):
            data = raw.model_dump()
        else:
            data = dict(raw)

        # 1. Resolve 3-tier identity
        account_id = data.get("account_id")
        anonymous_id = data.get("anonymous_id")
        user_id = data.get("user_id") or account_id or anonymous_id
        if not user_id:
            user_id = f"anon-{data.get('event_id', 'unknown')}"
            anonymous_id = user_id

        session_id = data.get("session_id") or "sess_default"

        # 2. Parse EventType
        raw_type = data.get("event_type")
        if isinstance(raw_type, EventType):
            event_type = raw_type
        else:
            event_type = self._parse_event_type(str(raw_type or "progress"))

        # 3. Compute completion ratio
        duration_ms = data.get("duration_ms")
        position_ms = data.get("position_ms")
        completion_ratio = data.get("completion_ratio")

        if completion_ratio is None and position_ms is not None and duration_ms and duration_ms > 0:
            completion_ratio = max(0.0, min(1.0, position_ms / duration_ms))

        # 4. Compute effective weight
        effective_weight = data.get("effective_weight")
        if effective_weight is None:
            effective_weight = self._compute_effective_weight(
                event_type, completion_ratio, position_ms, duration_ms
            )

        # 5. Timestamp
        ts = data.get("timestamp")
        if isinstance(ts, str):
            try:
                timestamp = datetime.fromisoformat(ts)
            except ValueError:
                timestamp = utcnow()
        elif isinstance(ts, datetime):
            timestamp = ts
        else:
            timestamp = utcnow()

        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)

        return UserEvent(
            event_id=str(data.get("event_id", f"ev_{timestamp.timestamp()}")),
            user_id=str(user_id),
            session_id=str(session_id),
            event_type=event_type,
            account_id=str(account_id) if account_id else None,
            anonymous_id=str(anonymous_id) if anonymous_id else None,
            track_id=str(data.get("track_id")) if data.get("track_id") else None,
            artist_id=str(data.get("artist_id")) if data.get("artist_id") else None,
            album_id=str(data.get("album_id")) if data.get("album_id") else None,
            position_ms=position_ms,
            duration_ms=duration_ms,
            completion_ratio=completion_ratio,
            effective_weight=float(effective_weight),
            source=data.get("source"),
            recommendation_id=data.get("recommendation_id"),
            query=data.get("query"),
            timestamp=timestamp,
            metadata=data.get("metadata", {}),
        )

    def _parse_event_type(self, raw: str) -> EventType:
        norm = raw.lower().strip()
        type_mapping = {
            "like": EventType.LIKE,
            "save": EventType.SAVE,
            "play_completed": EventType.COMPLETED,
            "completed": EventType.COMPLETED,
            "replay": EventType.REPLAY,
            "play_30s": EventType.PLAY_30S,
            "play_10s": EventType.PLAY_10S,
            "play_50pct": EventType.PLAY_50PCT,
            "skip_10_30s": EventType.SKIP_10_30S,
            "skip_lt_10s": EventType.SKIP_LT_10S,
            "skip": EventType.SKIP,
            "dislike": EventType.DISLIKE,
            "not_interested": EventType.NOT_INTERESTED,
            "progress": EventType.PROGRESS,
            "play_started": EventType.PLAY_STARTED,
            "recommendation_click": EventType.RECOMMENDATION_CLICK,
            "artist_open": EventType.ARTIST_OPEN,
            "album_open": EventType.ALBUM_OPEN,
            "playlist_open": EventType.PLAYLIST_OPEN,
            "unlike": EventType.UNLIKE,
            "unsave": EventType.UNSAVE,
        }
        return type_mapping.get(norm, EventType.PROGRESS)

    def _compute_effective_weight(
        self,
        event_type: EventType,
        ratio: Optional[float],
        position_ms: Optional[int],
        duration_ms: Optional[int],
    ) -> float:
        w = self.weights

        if event_type == EventType.LIKE:
            return w.like
        elif event_type == EventType.SAVE:
            return w.save
        elif event_type == EventType.COMPLETED:
            return w.completed
        elif event_type == EventType.REPLAY:
            return w.replay
        elif event_type == EventType.PLAY_30S:
            return w.play_30s
        elif event_type == EventType.PLAY_10S:
            return w.play_10s
        elif event_type == EventType.PLAY_50PCT:
            return (w.play_30s + w.completed) / 2.0
        elif event_type == EventType.SKIP_10_30S:
            return w.skip_10_30s
        elif event_type == EventType.SKIP_LT_10S:
            return w.skip_lt_10s
        elif event_type == EventType.DISLIKE:
            return w.dislike
        elif event_type == EventType.NOT_INTERESTED:
            return w.not_interested
        elif event_type == EventType.SKIP:
            # Differentiate by duration or ratio if available
            if position_ms is not None and position_ms < 10000:
                return w.skip_lt_10s
            elif position_ms is not None and position_ms < 30000:
                return w.skip_10_30s
            elif ratio is not None and ratio < 0.1:
                return w.skip_lt_10s
            elif ratio is not None and ratio < 0.3:
                return w.skip_10_30s
            return w.skip_10_30s
        elif event_type in {EventType.PROGRESS, EventType.PLAY_STARTED}:
            if ratio is not None:
                if ratio >= 0.8:
                    return w.completed
                elif ratio < 0.08 and duration_ms and duration_ms > 30000:
                    return w.skip_lt_10s
                return max(0.1, min(1.0, ratio))
            return 0.5
        elif event_type == EventType.RECOMMENDATION_CLICK:
            return 0.35
        elif event_type in {EventType.ARTIST_OPEN, EventType.ALBUM_OPEN, EventType.PLAYLIST_OPEN}:
            return 0.20
        elif event_type in {EventType.UNLIKE, EventType.UNSAVE}:
            return -1.5

        return 0.5
