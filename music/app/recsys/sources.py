"""Uniform, failure-isolated access to every candidate source.

Every upstream call goes through: timeout -> circuit breaker -> single-flight -> TTL cache, and never
raises into the pipeline (a dead source just contributes nothing)."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Optional

from .clients.ytm import RadioCursor, RadioPage
from .config import Settings
from .infra import CircuitBreaker, CircuitOpen, SingleFlight, TTLCache
from .models import Candidate
from .store import Store

log = logging.getLogger("sway.recsys")


def _tag(cands: list[Candidate], source: str) -> list[Candidate]:
    for i, c in enumerate(cands):
        c.source, c.source_rank = source, i
    return cands


class Sources:
    def __init__(self, ytm, saavn, store: Store, settings: Settings):
        self.ytm, self.saavn, self.store, self.s = ytm, saavn, store, settings
        self.breakers = {"ytm": CircuitBreaker("ytm"), "saavn": CircuitBreaker("saavn")}
        self._cache = TTLCache(2048)
        self._flight = SingleFlight()

    async def _guard(self, name: str, fn: Callable[[], Awaitable[Any]], default: Any = None) -> Any:
        try:
            return await self.breakers[name].call(lambda: asyncio.wait_for(fn(), self.s.source_timeout_s))
        except CircuitOpen:
            return default
        except Exception as e:  # noqa: BLE001 - a source must never take the request down
            log.warning("source %s failed: %r", name, e)
            return default

    async def _cached(self, key, ttl: float, name: str, fn, default):
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        async def load():
            v = await self._guard(name, fn, None)
            if v is not None:
                self._cache.set(key, v, ttl)
            return v
        v = await self._flight.do(key, load)
        if v is None:
            stale = self._cache.get_stale(key)     # stale-while-error beats an empty radio
            return stale if stale is not None else default
        return v

    # ---- YTM
    async def ytm_radio(self, video_id: str, playlist_id: Optional[str] = None,
                        params: Optional[str] = None) -> Optional[RadioPage]:
        page = await self._cached(("radio", video_id, playlist_id, params), self.s.radio_cache_ttl_s, "ytm",
                                  lambda: self.ytm.radio_page(video_id, playlist_id, params), None)
        return page.clone() if page else None

    async def ytm_continue(self, cursor: RadioCursor) -> Optional[RadioPage]:
        page = await self._guard("ytm", lambda: self.ytm.radio_continue(cursor), None)
        return page

    async def ytm_charts(self, country: str = "IN") -> list[Candidate]:
        r = await self._cached(("charts", country), self.s.trending_ttl_s, "ytm", lambda: self.ytm.charts(country), [])
        return [c.clone() for c in r]

    async def ytm_related(self, video_id: str) -> dict:
        return await self._cached(("related", video_id), self.s.reco_cache_ttl_s, "ytm", lambda: self.ytm.related(video_id), {})

    # ---- Saavn
    async def saavn_song(self, saavn_id: str) -> Optional[Candidate]:
        r = await self._cached(("song", saavn_id), 24 * 3600, "saavn", lambda: self.saavn.get_song(saavn_id), None)
        return r.clone() if r else None

    async def saavn_reco(self, saavn_id: str) -> list[Candidate]:
        r = await self._cached(("reco", saavn_id), self.s.reco_cache_ttl_s, "saavn",
                               lambda: self.saavn.recommendations(saavn_id, 25), [])
        return _tag([c.clone() for c in r], "saavn_reco")

    async def saavn_station(self, saavn_id: str) -> list[Candidate]:
        r = await self._cached(("station", saavn_id), self.s.reco_cache_ttl_s, "saavn",
                               lambda: self.saavn.station_songs(saavn_id, 20), [])
        return _tag([c.clone() for c in r], "saavn_station")

    async def saavn_trending(self) -> list[Candidate]:
        r = await self._cached(("trending",), self.s.trending_ttl_s, "saavn", lambda: self.saavn.trending("hindi", 30), [])
        return _tag([c.clone() for c in r], "trending_saavn")

    # ---- own graph
    def graph(self, saavn_id: str, limit: int = 30) -> list[Candidate]:
        nbrs = self.store.neighbors(saavn_id, limit)
        meta = self.store.meta_get_many(n for n, _ in nbrs)
        out = []
        for nid, _w in nbrs:
            m = meta.get(nid)
            if m:
                c = Candidate.from_meta(m)
                out.append(c)
        return _tag(out, "graph")
