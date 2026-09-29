"""Adapter bridging SWAY's existing SaavnClient to the recsys SaavnClient protocol."""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.recsys.clients.saavn import HttpSaavnClient, _songs_from, normalize_song
from app.recsys.models import Candidate

logger = logging.getLogger("sway.recsys.adapter")


class SwaySaavnAdapter:
    """Wraps SWAY's SaavnClient (HTTP-level) to satisfy the recsys SaavnClient protocol."""

    def __init__(self, sway_client_or_app: Any = None) -> None:
        self._target = sway_client_or_app
        self._fallback: Optional[HttpSaavnClient] = None

    def _get_client(self):
        target = self._target
        if target is not None:
            if hasattr(target, "state") and getattr(target.state, "saavn_client", None) is not None:
                return target.state.saavn_client
            # If target is directly a SaavnClient
            if hasattr(target, "_cb") and hasattr(target, "_request_with_retry"):
                return target
        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if self._fallback is None or (hasattr(self, "_fallback_loop") and self._fallback_loop != loop):
            self._fallback_loop = loop
            self._fallback = HttpSaavnClient()
        return self._fallback

    async def aclose(self):
        if self._fallback is not None:
            await self._fallback.aclose()

    @staticmethod
    def _norm(items: list, limit: int) -> list[Candidate]:
        out = []
        for it in items:
            c = normalize_song(it)
            if c:
                out.append(c)
            if len(out) >= limit:
                break
        return out

    async def search_songs(self, query: str, limit: int = 5) -> list[Candidate]:
        client = self._get_client()
        if isinstance(client, HttpSaavnClient):
            return await client.search_songs(query, limit=limit)
        try:
            data = await client.get({"__call": "search.getResults", "q": query, "p": 1, "n": limit})
            return self._norm(_songs_from(data), limit)
        except Exception as e:
            logger.warning("search_songs failed: %s", e)
            return []

    async def get_song(self, saavn_id: str) -> Optional[Candidate]:
        client = self._get_client()
        if isinstance(client, HttpSaavnClient):
            return await client.get_song(saavn_id)
        try:
            data = await client.get({"__call": "song.getDetails", "pids": saavn_id})
            res = self._norm(_songs_from(data), 1)
            return res[0] if res else None
        except Exception as e:
            logger.warning("get_song failed for %s: %s", saavn_id, e)
            return None

    async def recommendations(self, saavn_id: str, limit: int = 20) -> list[Candidate]:
        client = self._get_client()
        if isinstance(client, HttpSaavnClient):
            return await client.recommendations(saavn_id, limit=limit)
        try:
            data = await client.get({"__call": "reco.getreco", "pid": saavn_id})
            return self._norm(_songs_from(data), limit)
        except Exception as e:
            logger.warning("recommendations failed for %s: %s", saavn_id, e)
            return []

    async def station_songs(self, saavn_id: str, limit: int = 20) -> list[Candidate]:
        client = self._get_client()
        if isinstance(client, HttpSaavnClient):
            return await client.station_songs(saavn_id, limit=limit)
        try:
            st = await client.get({
                "__call": "webradio.createEntityStation",
                "entity_id": json.dumps([saavn_id]),
                "entity_type": "queue",
            })
            station_id = st.get("stationid") if isinstance(st, dict) else None
            if not station_id:
                return []
            data = await client.get({"__call": "webradio.getSong", "stationid": station_id, "k": str(limit)})
            return self._norm(_songs_from(data), limit)
        except Exception as e:
            logger.warning("station_songs failed for %s: %s", saavn_id, e)
            return []

    async def trending(self, language: str = "hindi", limit: int = 30) -> list[Candidate]:
        client = self._get_client()
        if isinstance(client, HttpSaavnClient):
            return await client.trending(language=language, limit=limit)
        try:
            data = await client.get({
                "__call": "content.getTrending",
                "entity_type": "song",
                "entity_language": language,
            })
            return self._norm(_songs_from(data), limit)
        except Exception as e:
            logger.warning("trending failed: %s", e)
            return []
