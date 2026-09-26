from __future__ import annotations

from typing import List, Optional
from .config import QueueWeights
from .models import Track, UserTasteProfile
from .storage import TasteStore


class QueuePlanner:
    """Optimizes sequence transitions (A -> B -> C) to avoid abrupt mood/tempo cliffs."""

    def __init__(self, weights: Optional[QueueWeights] = None, store: Optional[TasteStore] = None):
        self.weights = weights or QueueWeights()
        self.store = store

    def score_transition(
        self,
        current_track: Track,
        candidate: Track,
        profile: UserTasteProfile,
        store: Optional[TasteStore] = None,
    ) -> float:
        # 1. Negative memory checks
        if (
            candidate.id in profile.explicit_negative_tracks
            or candidate.artist_id in profile.explicit_negative_artists
            or candidate.id in profile.negative_memory.high_confidence_skips
        ):
            return -999.0

        # 2. Mood continuity (weight: 0.30)
        curr_moods = {m.lower().strip() for m in current_track.moods} | {
            g.lower().strip() for g in current_track.genres
        }
        cand_moods = {m.lower().strip() for m in candidate.moods} | {
            g.lower().strip() for g in candidate.genres
        }
        if curr_moods and cand_moods:
            mood_continuity = len(curr_moods & cand_moods) / len(curr_moods | cand_moods)
        else:
            mood_continuity = 0.5

        # 3. Energy smoothness (weight: 0.25)
        if current_track.energy is not None and candidate.energy is not None:
            diff = abs(current_track.energy - candidate.energy)
            energy_smoothness = max(0.0, 1.0 - (2.0 * diff))
        else:
            energy_smoothness = 0.5

        # 4. Artist affinity (weight: 0.20)
        if (
            current_track.artist_id
            and candidate.artist_id
            and current_track.artist_id == candidate.artist_id
        ):
            artist_affinity = 1.0
        elif candidate.artist_id in profile.artist:
            max_net = max((b.net for b in profile.artist.values()), default=1.0)
            artist_affinity = min(
                1.0, max(0.0, profile.artist[candidate.artist_id].net / max(0.1, max_net))
            )
        else:
            artist_affinity = 0.0

        # 5. Transition graph (weight: 0.15)
        transition_graph = 0.0
        if store is not None:
            transition_graph = min(1.0, max(0.0, store.get_transition_score(current_track.id, candidate.id)))

        # 6. Novelty (weight: 0.10)
        if candidate.id in profile.recent_tracks:
            novelty = 0.0
        elif candidate.id in profile.track:
            novelty = 0.5
        else:
            novelty = 1.0

        w = self.weights
        total = (
            w.mood_continuity * mood_continuity
            + w.energy_smoothness * energy_smoothness
            + w.artist_affinity * artist_affinity
            + w.transition_graph * transition_graph
            + w.novelty * novelty
        )
        return total

    def plan_next(
        self,
        current_track: Track,
        candidates: List[Track],
        profile: UserTasteProfile,
        store: Optional[TasteStore] = None,
        count: int = 10,
        surface: str = "queue",
    ) -> List[Track]:
        scored: list[tuple[Track, float]] = []
        seen_ids = set()
        for cand in candidates:
            if cand.id == current_track.id or cand.id in seen_ids:
                continue
            seen_ids.add(cand.id)
            s = self.score_transition(current_track, cand, profile, store=store)
            if s > -100.0:
                scored.append((cand, s))

        scored.sort(key=lambda x: x[1], reverse=True)

        # Sequence construction with surface-specific anti-clustering
        max_consecutive = 1 if surface != "artist_radio" else 3
        sequence: List[Track] = []
        remaining = [t for t, _ in scored]

        prev_artist = (current_track.artist_id or current_track.artist_name.lower().strip()) if current_track else ""
        consecutive_same_artist = 1 if prev_artist else 0

        while remaining and len(sequence) < count:
            pick_idx = None
            for idx, cand in enumerate(remaining):
                cand_artist = cand.artist_id or cand.artist_name.lower().strip()
                if cand_artist and cand_artist == prev_artist and consecutive_same_artist >= max_consecutive:
                    continue
                pick_idx = idx
                break

            if pick_idx is None:
                pick_idx = 0

            chosen = remaining.pop(pick_idx)
            chosen_artist = chosen.artist_id or chosen.artist_name.lower().strip()
            if chosen_artist and chosen_artist == prev_artist:
                consecutive_same_artist += 1
            else:
                consecutive_same_artist = 1
                prev_artist = chosen_artist

            sequence.append(chosen)

        return sequence
