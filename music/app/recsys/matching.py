"""Cross-catalog identity: score whether two records are the same *recording*, and resolve YTM<->Saavn."""
from __future__ import annotations

import asyncio
from difflib import SequenceMatcher
from typing import Optional

from .config import Settings
from .infra import SingleFlight
from .models import Candidate
from .store import Store
from .text import artist_keys, base_title


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    r = SequenceMatcher(None, a, b).ratio()
    ts = SequenceMatcher(None, " ".join(sorted(a.split())), " ".join(sorted(b.split()))).ratio()
    return max(r, ts)


def _artist_sim(a: Candidate, b: Candidate) -> float:
    ka, kb = artist_keys(a.artists), artist_keys(b.artists)
    if not ka or not kb:
        return 0.5
    small, big = (ka, kb) if len(ka) <= len(kb) else (kb, ka)
    hits = sum(1 for x in small if any(_ratio(x, y) >= 0.85 for y in big))
    return hits / len(small)


def _duration_sim(a: int, b: int) -> float:
    if not a or not b:
        return 0.5
    d = abs(a - b)
    return 1.0 if d <= 3 else 0.6 if d <= 6 else 0.3 if d <= 10 else 0.0


def match_score(a: Candidate, b: Candidate) -> float:
    """0..1. Penalises version mismatches (original vs lofi/remix/cover) and wrong artists hard."""
    ba, ta = base_title(a.title)
    bb, tb = base_title(b.title)
    title = _ratio(ba, bb)
    artist = _artist_sim(a, b)
    dur = _duration_sim(a.duration_sec, b.duration_sec)
    album = _ratio(base_title(a.album)[0], base_title(b.album)[0]) if a.album and b.album else 0.5
    score = 0.45 * title + 0.30 * artist + 0.15 * dur + 0.10 * album
    if title < 0.6:
        score *= 0.5
    if ta != tb:
        score *= 0.55
    return score


class IdentityResolver:
    def __init__(self, store: Store, saavn, ytm, settings: Settings):
        self.store, self.saavn, self.ytm, self.s = store, saavn, ytm, settings
        self._sem = asyncio.Semaphore(settings.resolve_concurrency)
        self._flight = SingleFlight()

    # ---- YTM candidate -> playable Saavn identity (mutates + returns candidate, or None)
    async def to_saavn(self, c: Candidate) -> Optional[Candidate]:
        if c.saavn_id:
            return c
        vid = c.ytm_video_id
        if not vid:
            return None
        hit = self.store.identity_get_by_ytm(vid)
        if hit:
            self._apply(c, hit[0], hit[1], self.store.meta_get(hit[0]))
            return c
        if self.store.negative_has("ytm", vid):
            return None
        res = await self._flight.do(f"s:{vid}", lambda: self._resolve_saavn(c))
        if not res:
            return None
        sid, conf, meta = res
        self._apply(c, sid, conf, meta)
        return c

    def _apply(self, c: Candidate, sid: str, conf: float, meta: Optional[dict]) -> None:
        if meta:  # prefer Saavn metadata: that's what will actually play
            m = Candidate.from_meta(meta)
            c.title, c.artists = m.title or c.title, m.artists or c.artists
            c.album, c.language, c.image = m.album or c.album, m.language or c.language, m.image or c.image
            c.duration_sec = m.duration_sec or c.duration_sec
            c.explicit = c.explicit or m.explicit
        c.saavn_id, c.confidence = sid, conf

    async def _resolve_saavn(self, c: Candidate):
        async with self._sem:
            base = base_title(c.title)[0]
            queries = [f"{base} {c.primary_artist}".strip()]
            if c.album:
                queries.append(f"{base} {base_title(c.album)[0]}")
            best: Optional[tuple[float, Candidate]] = None
            errored = False
            for q in queries:
                try:
                    results = await self.saavn.search_songs(q, limit=6)
                except Exception:
                    errored = True
                    continue
                for r in results:
                    sc = match_score(c, r)
                    if best is None or sc > best[0]:
                        best = (sc, r)
                if best and best[0] >= self.s.accept_conf:
                    break
            if best and best[0] >= self.s.probable_conf:
                sc, r = best
                self.store.identity_put(r.saavn_id, c.ytm_video_id, sc)
                self.store.meta_put(r)
                return r.saavn_id, sc, r.to_meta()
            if not errored:  # don't negative-cache transient upstream failures
                self.store.negative_put("ytm", c.ytm_video_id, self.s.negative_ttl_s)
            return None

    # ---- Saavn seed -> YTM videoId (needed to query the YTM radio)
    async def to_ytm(self, seed: Candidate) -> Optional[str]:
        if seed.ytm_video_id:
            return seed.ytm_video_id
        if not seed.saavn_id:
            return None
        hit = self.store.identity_get_by_saavn(seed.saavn_id)
        if hit:
            return hit[0]
        if not seed.title or self.store.negative_has("saavn", seed.saavn_id):
            return None
        return await self._flight.do(f"y:{seed.saavn_id}", lambda: self._resolve_ytm(seed))

    async def _resolve_ytm(self, seed: Candidate) -> Optional[str]:
        async with self._sem:
            base = base_title(seed.title)[0]
            try:
                results = await self.ytm.search_song(f"{base} {seed.primary_artist}".strip(), limit=5)
            except Exception:
                return None
            best: Optional[tuple[float, Candidate]] = None
            for r in results:
                sc = match_score(seed, r)
                if r.extra.get("video_type") == "MUSIC_VIDEO_TYPE_ATV":
                    sc += 0.02  # prefer official audio over clips as a tie-breaker
                if best is None or sc > best[0]:
                    best = (sc, r)
            if best and best[0] >= self.s.probable_conf:
                self.store.identity_put(seed.saavn_id, best[1].ytm_video_id, min(best[0], 1.0))
                return best[1].ytm_video_id
            self.store.negative_put("saavn", seed.saavn_id, self.s.negative_ttl_s)
            return None
