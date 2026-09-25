from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from .config import DecayConfig, RecommendationWeights
from .models import Bucket, EventType, Track, UserEvent, UserTasteProfile, utcnow


EVENT_POSITIVE = {
    EventType.LIKE: 2.5,
    EventType.SAVE: 2.75,
    EventType.REPLAY: 1.1,
    EventType.COMPLETED: 1.0,
    EventType.PLAY_30S: 0.3,
    EventType.PLAY_10S: 0.15,
    EventType.PROGRESS: 0.8,
    EventType.PLAY_STARTED: 0.5,
    EventType.RECOMMENDATION_CLICK: 0.35,
    EventType.ARTIST_OPEN: 0.18,
    EventType.ALBUM_OPEN: 0.16,
    EventType.PLAYLIST_OPEN: 0.14,
}

EVENT_NEGATIVE = {
    EventType.DISLIKE: 3.5,
    EventType.NOT_INTERESTED: 5.0,
    EventType.SKIP_LT_10S: 1.4,
    EventType.SKIP_10_30S: 0.6,
    EventType.SKIP: 1.3,
    EventType.UNLIKE: 1.6,
    EventType.UNSAVE: 1.2,
}


class TasteProfileBuilder:
    """Builds multi-horizon user taste profiles with calibrated time decay and negative memory isolation."""

    def __init__(
        self,
        half_life_days: float = 21.0,
        decay_config: Optional[DecayConfig] = None,
        weights: Optional[RecommendationWeights] = None,
    ) -> None:
        if decay_config:
            self.decay = decay_config
        else:
            self.decay = DecayConfig(
                rolling_days=30,
                rolling_half_life_days=7.0,
                long_term_half_life_days=60.0,
            )
        self.half_life_days = half_life_days
        self.weights = weights or RecommendationWeights()

    def _decay_factor(self, age_days: float, half_life: float) -> float:
        if half_life <= 0:
            return 1.0
        return 2.0 ** (-max(0.0, age_days) / half_life)

    @staticmethod
    def _bucket(mapping: dict[str, Bucket], key: str) -> Bucket:
        if key not in mapping:
            mapping[key] = Bucket()
        return mapping[key]

    def build(
        self,
        user_id: str,
        events: list[UserEvent],
        catalog: dict[str, Track],
        now: datetime | None = None,
    ) -> UserTasteProfile:
        now = now or utcnow()
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        p = UserTasteProfile(user_id=user_id, updated_at=now, total_events=len(events))
        recent_energy: list[tuple[float, float]] = []
        long_energy: list[tuple[float, float]] = []
        recent_ids: list[tuple[datetime, str, str, str | None]] = []

        for e in sorted(events, key=lambda x: x.timestamp):
            event_ts = e.timestamp
            if event_ts.tzinfo is None:
                event_ts = event_ts.replace(tzinfo=timezone.utc)

            age_days = max(0.0, (now - event_ts).total_seconds() / 86400.0)

            # Determine base positive and negative magnitude
            pos_base = 0.0
            neg_base = 0.0

            if e.effective_weight > 0 and e.event_type not in EVENT_NEGATIVE:
                pos_base = e.effective_weight
            elif e.effective_weight < 0:
                neg_base = abs(e.effective_weight)
            else:
                pos_base = EVENT_POSITIVE.get(e.event_type, 0.0)
                neg_base = EVENT_NEGATIVE.get(e.event_type, 0.0)

            ratio = e.played_ratio
            if e.event_type in {
                EventType.PROGRESS,
                EventType.COMPLETED,
                EventType.PLAY_STARTED,
                EventType.REPLAY,
            }:
                pos_base *= max(0.25, 0.55 + 0.9 * ratio)
                if e.event_type == EventType.COMPLETED and ratio >= 0.9:
                    pos_base *= 1.2
                if e.event_type == EventType.REPLAY:
                    pos_base *= 1.2
            elif e.event_type == EventType.SKIP:
                if ratio >= 0.8:
                    neg_base *= 0.35
                elif ratio <= 0.08:
                    neg_base *= 1.35

            # Multi-horizon decays
            decay_long = self._decay_factor(age_days, self.decay.long_term_half_life_days)
            pos_long = pos_base * decay_long
            neg_long = neg_base * decay_long

            is_in_rolling = age_days <= self.decay.rolling_days
            decay_recent = (
                self._decay_factor(age_days, self.decay.rolling_half_life_days)
                if is_in_rolling
                else 0.0
            )
            pos_recent = pos_base * decay_recent
            neg_recent = neg_base * decay_recent

            track = catalog.get(e.track_id) if e.track_id else None
            artist_id = track.artist_id if track else e.artist_id

            if track:
                # 1. Update long-term horizon
                tb_l = self._bucket(p.long_term.track, track.id)
                tb_l.positive += pos_long
                tb_l.negative += neg_long
                tb_l.count += 1
                tb_l.last_seen = event_ts.timestamp()

                if artist_id:
                    ab_l = self._bucket(p.long_term.artist, artist_id)
                    ab_l.positive += pos_long
                    ab_l.negative += neg_long
                    ab_l.count += 1
                    ab_l.last_seen = event_ts.timestamp()

                for g in track.genres:
                    b_l = self._bucket(p.long_term.genre, g.lower())
                    b_l.positive += pos_long * 0.65
                    b_l.negative += neg_long * 0.65
                    b_l.count += 1
                    b_l.last_seen = event_ts.timestamp()

                if track.language:
                    b_l = self._bucket(p.long_term.language, track.language.lower())
                    b_l.positive += pos_long * 0.55
                    b_l.negative += neg_long * 0.55
                    b_l.count += 1
                    b_l.last_seen = event_ts.timestamp()

                for m in track.moods:
                    b_l = self._bucket(p.long_term.mood, m.lower())
                    b_l.positive += pos_long * 0.60
                    b_l.negative += neg_long * 0.60
                    b_l.count += 1
                    b_l.last_seen = event_ts.timestamp()

                # 2. Update recent 30d rolling horizon if within window
                if is_in_rolling:
                    tb_r = self._bucket(p.recent_30d.track, track.id)
                    tb_r.positive += pos_recent
                    tb_r.negative += neg_recent
                    tb_r.count += 1
                    tb_r.last_seen = event_ts.timestamp()

                    if artist_id:
                        ab_r = self._bucket(p.recent_30d.artist, artist_id)
                        ab_r.positive += pos_recent
                        ab_r.negative += neg_recent
                        ab_r.count += 1
                        ab_r.last_seen = event_ts.timestamp()

                    for g in track.genres:
                        b_r = self._bucket(p.recent_30d.genre, g.lower())
                        b_r.positive += pos_recent * 0.65
                        b_r.negative += neg_recent * 0.65
                        b_r.count += 1
                        b_r.last_seen = event_ts.timestamp()

                    if track.language:
                        b_r = self._bucket(p.recent_30d.language, track.language.lower())
                        b_r.positive += pos_recent * 0.55
                        b_r.negative += neg_recent * 0.55
                        b_r.count += 1
                        b_r.last_seen = event_ts.timestamp()

                    for m in track.moods:
                        b_r = self._bucket(p.recent_30d.mood, m.lower())
                        b_r.positive += pos_recent * 0.60
                        b_r.negative += neg_recent * 0.60
                        b_r.count += 1
                        b_r.last_seen = event_ts.timestamp()

                if track.energy is not None and pos_base > neg_base:
                    if is_in_rolling:
                        recent_energy.append((track.energy, pos_recent))
                    long_energy.append((track.energy, max(0.1, pos_long)))

                recent_ids.append((event_ts, track.id, artist_id or "", track.album_id))

            # 3. Update negative memory
            tid = e.track_id or (track.id if track else None)
            aid = artist_id

            if e.event_type in {EventType.DISLIKE, EventType.NOT_INTERESTED}:
                if tid:
                    p.negative_memory.explicit_negative_tracks.add(tid)
                if e.event_type == EventType.DISLIKE and aid:
                    p.negative_memory.explicit_negative_artists.add(aid)
            elif e.event_type == EventType.SKIP_LT_10S and tid:
                p.negative_memory.high_confidence_skips.add(tid)

            # 4. Session state tracking
            if e.session_id:
                p.session_state.session_id = e.session_id
                if tid and (not p.session_state.recent_tracks or p.session_state.recent_tracks[-1] != tid):
                    p.session_state.recent_tracks.append(tid)
                if aid and (not p.session_state.recent_artists or p.session_state.recent_artists[-1] != aid):
                    p.session_state.recent_artists.append(aid)
                if track:
                    for m in track.moods:
                        if m.lower() not in p.session_state.active_moods:
                            p.session_state.active_moods.append(m.lower())
                    if track.energy is not None:
                        p.session_state.energy_drift.append(track.energy)

        recent_ids.sort(reverse=True)
        # Cap session list length
        p.session_state.recent_tracks = p.session_state.recent_tracks[-30:]
        p.session_state.recent_artists = p.session_state.recent_artists[-30:]
        p.session_state.active_moods = p.session_state.active_moods[-10:]
        p.session_state.energy_drift = p.session_state.energy_drift[-20:]

        if recent_energy:
            den = sum(w for _, w in recent_energy)
            if den > 0:
                p.recent_energy = sum(v * w for v, w in recent_energy) / den
        if long_energy:
            den = sum(w for _, w in long_energy)
            if den > 0:
                p.long_term_energy = sum(v * w for v, w in long_energy) / den

        novelty = sum(
            1
            for e in events
            if e.event_type in {EventType.LIKE, EventType.COMPLETED, EventType.REPLAY}
            and e.track_id in catalog
        )
        unique_novelty = len(
            {
                e.track_id
                for e in events
                if e.event_type in {EventType.LIKE, EventType.COMPLETED, EventType.REPLAY}
                and e.track_id in catalog
            }
        )
        if novelty:
            ratio = unique_novelty / novelty
            p.novelty_tolerance = max(0.08, min(0.85, ratio))
            p.familiarity_preference = 1.0 - p.novelty_tolerance

        return p
