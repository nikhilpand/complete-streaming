from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Dict, List, Optional
from .config import RecommendationWeights
from .models import FeedType, RecommendationContext, Track, UserTasteProfile
from .retrieval import Candidate


@dataclass
class RankedCandidate:
    candidate: Candidate
    score: float
    components: dict[str, float]


class RuleBasedRanker:
    VERSION = "rule-v2"
    FEED_WEIGHTS: Dict[FeedType, Dict[str, float]] = {
        FeedType.FOR_YOU: {"taste": 0.26, "session": 0.15, "similarity": 0.12, "novelty": 0.07, "freshness": 0.06, "popularity": 0.04, "playability": 0.06},
        FeedType.DISCOVER: {"taste": 0.18, "session": 0.10, "similarity": 0.18, "novelty": 0.18, "freshness": 0.09, "popularity": 0.03, "playability": 0.05},
        FeedType.AUTOPLAY: {"taste": 0.23, "session": 0.23, "similarity": 0.16, "novelty": 0.04, "freshness": 0.03, "popularity": 0.02, "playability": 0.09},
        FeedType.TRACK_RADIO: {"taste": 0.12, "session": 0.10, "similarity": 0.30, "novelty": 0.09, "freshness": 0.04, "popularity": 0.03, "playability": 0.06},
        FeedType.ARTIST_RADIO: {"taste": 0.20, "session": 0.12, "similarity": 0.24, "novelty": 0.10, "freshness": 0.04, "popularity": 0.03, "playability": 0.06},
        FeedType.NEW_RELEASES: {"taste": 0.27, "session": 0.06, "similarity": 0.08, "novelty": 0.09, "freshness": 0.30, "popularity": 0.03, "playability": 0.06},
        FeedType.TRENDING: {"taste": 0.20, "session": 0.08, "similarity": 0.08, "novelty": 0.04, "freshness": 0.10, "popularity": 0.35, "playability": 0.06},
    }

    def __init__(self, weights: Optional[RecommendationWeights] = None):
        self.weights = weights or RecommendationWeights()

    def _affinity(self, p: UserTasteProfile, t: Track) -> tuple[float, dict[str, float]]:
        artist = max(0.0, p.artist.get(t.artist_id).net if t.artist_id in p.artist else 0.0)
        genre = max(0.0, max((p.genre[g.lower()].net for g in t.genres if g.lower() in p.genre), default=0.0))
        lang = max(0.0, p.language[t.language.lower()].net if t.language and t.language.lower() in p.language else 0.0)
        mood = max(0.0, max((p.mood[m.lower()].net for m in t.moods if m.lower() in p.mood), default=0.0))
        den = max(1.0, max((b.net for b in p.artist.values()), default=1.0))
        score = min(1.0, (0.50 * artist + 0.22 * genre + 0.12 * lang + 0.16 * mood) / den)
        return score, {
            "artist_affinity": artist,
            "genre_affinity": genre,
            "language_affinity": lang,
            "mood_affinity": mood,
        }

    def _novelty(self, p: UserTasteProfile, t: Track) -> float:
        if t.id in p.recent_tracks:
            return 0.0
        b = p.track.get(t.id)
        return 0.25 if b and b.count > 0 else 1.0

    def _session_fit(self, ctx: RecommendationContext, t: Track, ix: dict[str, Track]) -> float:
        best = 0.0
        for tid in ctx.recent_track_ids[:10]:
            r = ix.get(tid)
            if not r:
                continue
            v = (
                (0.45 if r.artist_id == t.artist_id else 0)
                + (0.25 if set(r.genres) & set(t.genres) else 0)
                + (0.12 if r.language and r.language == t.language else 0)
                + (0.10 if set(r.moods) & set(t.moods) else 0)
            )
            if r.energy is not None and t.energy is not None:
                v += max(0.0, 0.08 - abs(r.energy - t.energy) * 0.16)
            best = max(best, v)
        return best

    def rank(
        self,
        candidates: List[Candidate],
        p: UserTasteProfile,
        ctx: RecommendationContext,
        feed: FeedType,
        ix: dict[str, Track],
    ) -> List[RankedCandidate]:
        w = self.FEED_WEIGHTS.get(feed, self.FEED_WEIGHTS[FeedType.FOR_YOU])
        mx = max((c.track.popularity for c in candidates), default=1.0)
        recent = set(p.recent_tracks + ctx.recent_track_ids[:20])
        out: List[RankedCandidate] = []
        duplicate_counts: dict[str, int] = {}
        for c in candidates:
            duplicate_counts[c.track.id] = duplicate_counts.get(c.track.id, 0) + 1

        for c in candidates:
            t = c.track
            # Strict negative memory and unplayable pruning
            if (
                not t.playable
                or t.id in p.explicit_negative_tracks
                or t.artist_id in p.explicit_negative_artists
                or t.id in p.negative_memory.high_confidence_skips
                or t.id in recent
            ):
                continue

            taste, parts = self._affinity(p, t)
            session = self._session_fit(ctx, t, ix)
            sim = (
                max(0.0, min(1.0, c.source_strength))
                if c.source in {"similar_track", "similar_artist"}
                else 0.0
            )
            nov = self._novelty(p, t)
            fresh = (
                0.25
                if t.release_ts is None
                else math.exp(-max(0.0, (time.time() - t.release_ts) / 86400) / 120.0)
            )
            pop = t.popularity / max(0.0001, mx)
            repeat = 0.45 if t.id in recent else 0.0
            repeat += 0.20 if t.id in p.recent_recommendations else 0.0
            neg = min(
                0.9,
                max(0.0, (p.track.get(t.id).negative if t.id in p.track else 0.0)) * 0.08,
            )
            target = (
                ctx.energy_preference
                if ctx.energy_preference is not None
                else (
                    0.85
                    if ctx.activity == "workout"
                    else 0.35
                    if ctx.activity == "focus"
                    else p.recent_energy or p.long_term_energy or 0.5
                )
            )
            energy = 1.0 - abs(t.energy - target) if t.energy is not None else 0.5

            score = (
                w["taste"] * taste
                + w["session"] * session
                + w["similarity"] * sim
                + w["novelty"] * nov * max(0.15, ctx.novelty_preference)
                + w["freshness"] * fresh
                + w["popularity"] * pop
                + w["playability"] * 1.0
                + 0.05 * energy
                + 0.03 * c.source_strength
                + min(0.12, 0.03 * duplicate_counts[t.id])
                - repeat
                - neg
            )

            parts.update(
                {
                    "taste": taste,
                    "session": session,
                    "similarity": sim,
                    "novelty": nov,
                    "freshness": fresh,
                    "popularity": pop,
                    "playability": 1.0,
                    "energy_fit": energy,
                    "repeat_penalty": repeat,
                    "negative_penalty": neg,
                }
            )
            out.append(RankedCandidate(c, score, parts))

        return sorted(out, key=lambda x: x.score, reverse=True)
