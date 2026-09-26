from __future__ import annotations

from typing import List, Optional
from .config import QueueWeights
from .metadata import clean_track_id
from .models import Track, UserTasteProfile
from .normalizer import canonical_song_key, is_derivative_track
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
        curr_key = canonical_song_key(
            title=getattr(current_track, "title", ""),
            artist_name=getattr(current_track, "artist_name", ""),
            fallback_id=getattr(current_track, "id", ""),
            album=getattr(current_track, "album", ""),
        )
        curr_cid = clean_track_id(getattr(current_track, "id", ""))
        curr_is_derivative = is_derivative_track(
            getattr(current_track, "title", ""),
            getattr(current_track, "artist_name", ""),
        )
        seen_keys: set[tuple[str, str]] = {curr_key} if curr_key[0] else set()
        seen_ids: set[str] = {current_track.id}
        scored: list[tuple[Track, float]] = []

        for cand in candidates:
            if cand.id in seen_ids or (curr_cid and clean_track_id(cand.id) == curr_cid):
                continue
            cand_key = canonical_song_key(
                title=getattr(cand, "title", ""),
                artist_name=getattr(cand, "artist_name", ""),
                fallback_id=getattr(cand, "id", ""),
                album=getattr(cand, "album", ""),
            )
            if cand_key[0] and cand_key in seen_keys:
                continue

            # Filter derivative tracks unless the user is specifically playing a derivative track
            if not curr_is_derivative and is_derivative_track(getattr(cand, "title", ""), getattr(cand, "artist_name", "")):
                continue

            seen_ids.add(cand.id)
            if cand_key[0]:
                seen_keys.add(cand_key)

            s = self.score_transition(current_track, cand, profile, store=store)
            if s > -100.0:
                scored.append((cand, s))

        scored.sort(key=lambda x: x[1], reverse=True)

        def _same_artist(t1: Track, t2: Track) -> bool:
            if not t1 or not t2:
                return False
            name1 = (t1.artist_name or "").lower().strip()
            name2 = (t2.artist_name or "").lower().strip()
            if name1 and name2 and name1 == name2:
                return True
            id1 = (t1.artist_id or "").lower().strip()
            id2 = (t2.artist_id or "").lower().strip()
            if id1 and id2 and id1 not in ("sub_artist", "unknown", "artist_unknown", "") and id1 == id2:
                return True
            return False

        # Sequence construction with surface-specific anti-clustering
        max_consecutive = 1 if surface != "artist_radio" else 3
        sequence: List[Track] = []
        remaining = [t for t, _ in scored]

        consecutive_same_artist = 1 if current_track else 0
        last_track = current_track

        while remaining and len(sequence) < count:
            pick_idx = None
            for idx, cand in enumerate(remaining):
                if last_track and _same_artist(cand, last_track) and consecutive_same_artist >= max_consecutive:
                    continue
                pick_idx = idx
                break

            if pick_idx is None:
                # If only same-artist tracks remain, pick the first
                pick_idx = 0

            chosen = remaining.pop(pick_idx)
            if last_track and _same_artist(chosen, last_track):
                consecutive_same_artist += 1
            else:
                consecutive_same_artist = 1

            last_track = chosen
            sequence.append(chosen)

        return sequence
