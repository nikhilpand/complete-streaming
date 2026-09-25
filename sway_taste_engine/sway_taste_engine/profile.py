from __future__ import annotations
import math
from datetime import datetime, timezone
from .models import Bucket, EventType, Track, UserEvent, UserTasteProfile
EVENT_POSITIVE = {
    EventType.LIKE: 3.0, EventType.SAVE: 2.4, EventType.REPLAY: 2.8,
    EventType.COMPLETED: 1.7, EventType.PROGRESS: 0.8, EventType.PLAY_STARTED: 0.5,
    EventType.RECOMMENDATION_CLICK: 0.35, EventType.ARTIST_OPEN: 0.18,
    EventType.ALBUM_OPEN: 0.16, EventType.PLAYLIST_OPEN: 0.14,
}
EVENT_NEGATIVE = {
    EventType.DISLIKE: 4.5, EventType.NOT_INTERESTED: 4.0,
    EventType.SKIP: 1.3, EventType.UNLIKE: 1.6, EventType.UNSAVE: 1.2,
}
class TasteProfileBuilder:
    def __init__(self, half_life_days: float = 21.0) -> None: self.half_life_days = half_life_days
    def _decay(self, event_time: datetime, now: datetime) -> float:
        age_days = max(0.0, (now - event_time).total_seconds() / 86400.0)
        return math.exp(-math.log(2) * age_days / self.half_life_days)
    @staticmethod
    def _bucket(mapping: dict[str, Bucket], key: str) -> Bucket:
        if key not in mapping: mapping[key] = Bucket()
        return mapping[key]
    def build(self, user_id: str, events: list[UserEvent], catalog: dict[str, Track], now: datetime | None = None) -> UserTasteProfile:
        now = now or datetime.now(timezone.utc)
        p = UserTasteProfile(user_id=user_id)
        recent_energy: list[tuple[float, float]] = []
        long_energy: list[tuple[float, float]] = []
        recent_ids: list[tuple[datetime, str, str, str | None]] = []
        for e in sorted(events, key=lambda x: x.timestamp):
            decay = self._decay(e.timestamp, now)
            positive = EVENT_POSITIVE.get(e.event_type, 0.0)
            negative = EVENT_NEGATIVE.get(e.event_type, 0.0)
            ratio = e.played_ratio
            if e.event_type in {EventType.PROGRESS, EventType.COMPLETED, EventType.PLAY_STARTED, EventType.REPLAY}:
                positive *= max(0.25, 0.55 + 0.9 * ratio)
                if e.event_type == EventType.COMPLETED and ratio >= 0.9: positive *= 1.2
                if e.event_type == EventType.REPLAY: positive *= 1.2
            if e.event_type == EventType.SKIP:
                if ratio >= 0.8: negative *= 0.35
                elif ratio <= 0.08: negative *= 1.35
            positive *= decay; negative *= decay
            track = catalog.get(e.track_id) if e.track_id else None
            if not track: continue
            tb = self._bucket(p.track, track.id); tb.positive += positive; tb.negative += negative; tb.count += 1; tb.last_seen = e.timestamp.timestamp()
            ab = self._bucket(p.artist, track.artist_id); ab.positive += positive; ab.negative += negative; ab.count += 1; ab.last_seen = e.timestamp.timestamp()
            for g in track.genres:
                b = self._bucket(p.genre, g.lower()); b.positive += positive * .65; b.negative += negative * .65; b.count += 1; b.last_seen = e.timestamp.timestamp()
            if track.language:
                b = self._bucket(p.language, track.language.lower()); b.positive += positive * .55; b.negative += negative * .55; b.count += 1; b.last_seen = e.timestamp.timestamp()
            for m in track.moods:
                b = self._bucket(p.mood, m.lower()); b.positive += positive * .60; b.negative += negative * .60; b.count += 1; b.last_seen = e.timestamp.timestamp()
            if track.energy is not None and positive > negative:
                recent_energy.append((track.energy, positive)); long_energy.append((track.energy, max(.1, positive * decay)))
            recent_ids.append((e.timestamp, track.id, track.artist_id, track.album_id))
            if e.event_type in {EventType.DISLIKE, EventType.NOT_INTERESTED}:
                p.explicit_negative_tracks.add(track.id)
                if e.event_type == EventType.DISLIKE: p.explicit_negative_artists.add(track.artist_id)
        recent_ids.sort(reverse=True)
        p.recent_tracks = [x[1] for x in recent_ids[:30]]
        p.recent_artists = [x[2] for x in recent_ids[:30]]
        p.recent_albums = [x[3] for x in recent_ids if x[3]][:30]
        p.updated_at = now
        if recent_energy:
            den = sum(w for _, w in recent_energy); p.recent_energy = sum(v*w for v,w in recent_energy) / den
        if long_energy:
            den = sum(w for _, w in long_energy); p.long_term_energy = sum(v*w for v,w in long_energy) / den
        novelty = sum(1 for e in events if e.event_type in {EventType.LIKE, EventType.COMPLETED, EventType.REPLAY} and e.track_id in catalog)
        unique_novelty = len({e.track_id for e in events if e.event_type in {EventType.LIKE, EventType.COMPLETED, EventType.REPLAY} and e.track_id in catalog})
        if novelty:
            ratio = unique_novelty / novelty
            p.novelty_tolerance = max(.08, min(.85, ratio)); p.familiarity_preference = 1.0 - p.novelty_tolerance
        return p
