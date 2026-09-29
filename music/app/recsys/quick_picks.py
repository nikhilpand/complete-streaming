"""Quick picks: 'Start radio from a song you like'.

Seeds come from the listener's own history (recency x completion x likes) forced to differ in artist
and language; each seed contributes its best few recommendations from the same fused pipeline.
Cold start falls back to India trending (YTM charts + Saavn trending), computed once and shared."""
from __future__ import annotations

import asyncio
import math
import time
from typing import Optional

from .engine import RecommendationEngine
from .infra import TTLCache
from .models import Candidate
from .postfilter import diversify
from .ranker import UserProfile, build_profile
from .text import primary_artist_key


class QuickPicks:
    def __init__(self, engine: RecommendationEngine):
        self.e = engine
        self._cache = TTLCache(2048)

    async def _seed_weights(self, user: Optional[str], recent_ids: list[str], profile: UserProfile) -> dict[str, float]:
        now = time.time()
        w: dict[str, float] = {}
        if user:
            rows = self.e.store.user_events(user, now - 30 * 86400, ("complete", "like", "skip"))
            for ts, tid, kind, pos in rows:
                if kind == "skip" and pos < self.e.s.early_skip_ms:
                    continue
                base = {"complete": 1.0, "like": 2.0, "skip": 0.4}[kind]
                w[tid] = w.get(tid, 0.0) + base * math.exp(-(now - ts) / (7 * 86400))
        for i, tid in enumerate(recent_ids):                   # client-provided, newest first
            w[tid] = w.get(tid, 0.0) + 1.2 / (1 + 0.3 * i)
        return {t: v for t, v in w.items() if t not in profile.blocked_ids}

    async def _pick_seeds(self, weights: dict[str, float], k: int = 4) -> list[Candidate]:
        ordered = sorted(weights, key=weights.get, reverse=True)[:30]
        cands: list[tuple[float, Candidate]] = []
        for tid in ordered:
            m = self.e.store.meta_get(tid)
            c = Candidate.from_meta(m) if m else await self.e.load_seed(tid)
            if c is not None and c.title:
                c.saavn_id = c.saavn_id or tid
                cands.append((weights[tid], c))
        chosen: list[Candidate] = []
        langs: set[str] = set()
        artists: set[str] = set()
        while cands and len(chosen) < k:
            def adj(item):
                w, c = item
                return w * (0.6 if (c.language or "").lower() in langs else 1.0)
            eligible = [x for x in cands if primary_artist_key(x[1].artists) not in artists]
            if not eligible:
                break
            best = max(eligible, key=adj)
            cands.remove(best)
            chosen.append(best[1])
            artists.add(primary_artist_key(best[1].artists))
            if best[1].language:
                langs.add(best[1].language.lower())
        return chosen

    async def _picks_for_seed(self, seed: Candidate, n: int, profile: UserProfile, user: Optional[str]) -> list[Candidate]:
        lists, _ = await self.e.gather(seed)
        return await self.e.rank_pipeline(seed, lists, None, user, n, profile=profile, max_per_artist=2)

    async def get(self, *, user: Optional[str], recent_ids: list[str], limit: int = 12) -> dict:
        recent_ids = [r for r in recent_ids if r][:20]
        key = (user, tuple(recent_ids[:5]), limit)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        profile = build_profile(self.e.store, user, self.e.s)
        weights = await self._seed_weights(user, recent_ids, profile)
        seeds = await self._pick_seeds(weights) if weights else []
        mode = "personalized"
        if not seeds:
            items = await self.e.trending(limit)
            mode = "trending"
        else:
            per_seed = await asyncio.gather(*[self._picks_for_seed(s, 4, profile, user) for s in seeds])
            exclude = {s.saavn_id for s in seeds} | set(recent_ids)
            merged: list[Candidate] = []
            seen: set[str] = set()
            for rank_i in range(max(len(p) for p in per_seed) if per_seed else 0):   # round-robin across seeds
                for p in per_seed:
                    if rank_i < len(p) and p[rank_i].saavn_id not in seen and p[rank_i].saavn_id not in exclude:
                        seen.add(p[rank_i].saavn_id)
                        merged.append(p[rank_i])
            items = diversify(merged, limit, min_gap=2, max_per_artist=2)
            if len(items) < limit // 2:                       # thin personalisation: top up with trending
                have = {c.saavn_id for c in items} | exclude
                items += [c for c in await self.e.trending(limit) if c.saavn_id not in have][: limit - len(items)]
                mode = "personalized+trending"
        for c in items:
            self.e.store.meta_put(c)
        out = {"items": [c.to_public() for c in items[:limit]], "mode": mode,
               "seeds": [s.to_public() for s in seeds]}
        self._cache.set(key, out, self.e.s.quick_picks_ttl_s)
        return out
