from __future__ import annotations

from collections import Counter
from typing import List
from .models import FeedType
from .ranking import RankedCandidate


class DiversityReranker:
    def __init__(
        self,
        artist_lambda: float = 0.11,
        album_lambda: float = 0.04,
        genre_lambda: float = 0.03,
        language_lambda: float = 0.02,
        max_consecutive_artist: int = 2,
        max_album_per_window: int = 3,
        window_size: int = 20,
    ):
        self.artist_lambda = artist_lambda
        self.album_lambda = album_lambda
        self.genre_lambda = genre_lambda
        self.language_lambda = language_lambda
        self.max_consecutive_artist = max_consecutive_artist
        self.max_album_per_window = max_album_per_window
        self.window_size = window_size

    def rerank(
        self, ranked: List[RankedCandidate], feed: FeedType, limit: int
    ) -> List[RankedCandidate]:
        ranked_pool = list(ranked)
        selected: List[RankedCandidate] = []
        a = Counter()
        al = Counter()
        g = Counter()
        l = Counter()

        while ranked_pool and len(selected) < limit:
            best_i = -1
            best_s = float("-inf")

            # Check sliding window state
            last_artist = None
            consecutive_artist_count = 0
            if selected:
                last_artist = selected[-1].candidate.track.artist_id
                for item in reversed(selected):
                    if item.candidate.track.artist_id == last_artist:
                        consecutive_artist_count += 1
                    else:
                        break

            window_slice = (
                selected[-(self.window_size - 1):] if self.window_size > 1 else []
            )
            window_album_counts = Counter(
                item.candidate.track.album_id or "_"
                for item in window_slice
                if item.candidate.track.album_id
            )

            # Pass 1: Choose best candidate satisfying hard sliding window constraints
            for i, item in enumerate(ranked_pool):
                t = item.candidate.track
                if (
                    last_artist
                    and t.artist_id == last_artist
                    and consecutive_artist_count >= self.max_consecutive_artist
                ):
                    continue
                if (
                    t.album_id
                    and window_album_counts.get(t.album_id, 0)
                    >= self.max_album_per_window
                ):
                    continue

                penalty = (
                    self.artist_lambda * a[t.artist_id]
                    + self.album_lambda * al[t.album_id or "_"]
                    + self.genre_lambda * sum(g[x.lower()] for x in t.genres[:3])
                    + self.language_lambda * l[t.language.lower() if t.language else "_"]
                )
                s = item.score - penalty
                if s > best_s:
                    best_i = i
                    best_s = s

            # Pass 2: Fall back to best candidate if hard constraint cannot be satisfied
            if best_i == -1:
                for i, item in enumerate(ranked_pool):
                    t = item.candidate.track
                    penalty = (
                        self.artist_lambda * a[t.artist_id]
                        + self.album_lambda * al[t.album_id or "_"]
                        + self.genre_lambda * sum(g[x.lower()] for x in t.genres[:3])
                        + self.language_lambda * l[t.language.lower() if t.language else "_"]
                    )
                    s = item.score - penalty
                    if s > best_s:
                        best_i = i
                        best_s = s

            if best_i == -1:
                break

            chosen = ranked_pool.pop(best_i)
            t = chosen.candidate.track
            selected.append(
                RankedCandidate(
                    chosen.candidate,
                    best_s,
                    {**chosen.components, "diversity_adjusted": best_s},
                )
            )
            a[t.artist_id] += 1
            al[t.album_id or "_"] += 1
            for x in t.genres[:3]:
                g[x.lower()] += 1
            l[t.language.lower() if t.language else "_"] += 1

        return selected
