"""JioSaavn client: native search, recommendations and radio stations.

If SWAY already has a Saavn client, implement the `SaavnClient` protocol as a thin adapter and skip
`HttpSaavnClient`. Endpoint names (reco.getreco, webradio.createEntityStation, webradio.getSong) are
from the community JioSaavn wrappers; exact params/response shapes are unofficial and drift, so the
normaliser is deliberately tolerant. Verify against live responses in the Phase-0 spike.
"""
from __future__ import annotations

import html
import json
import re
from typing import Any, Optional, Protocol

from ..models import Candidate


class SaavnClient(Protocol):
    async def search_songs(self, query: str, limit: int = 5) -> list[Candidate]: ...
    async def get_song(self, saavn_id: str) -> Optional[Candidate]: ...
    async def recommendations(self, saavn_id: str, limit: int = 20) -> list[Candidate]: ...
    async def station_songs(self, saavn_id: str, limit: int = 20) -> list[Candidate]: ...
    async def trending(self, language: str = "hindi", limit: int = 30) -> list[Candidate]: ...


def _u(s: Any) -> str:
    return html.unescape(str(s or "")).strip()


def normalize_song(d: dict) -> Optional[Candidate]:
    if not isinstance(d, dict) or not d.get("id"):
        return None
    more = d.get("more_info") or {}
    names: list[str] = []
    amap = (more.get("artistMap") or {})
    for a in (amap.get("primary_artists") or []):
        if a.get("name"):
            names.append(_u(a["name"]))
    if not names:
        raw = d.get("primary_artists") or more.get("primary_artists") or d.get("subtitle") or ""
        names = [_u(x) for x in re.split(r",|&", str(raw)) if x.strip()]
    image = _u(d.get("image"))
    image = re.sub(r"(\d+)x(\d+)", "500x500", image) if image else ""
    try:
        duration = int(more.get("duration") or d.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0
    return Candidate(
        title=_u(d.get("title") or d.get("song")),
        artists=names,
        album=_u(more.get("album") or d.get("album")),
        duration_sec=duration,
        language=_u(d.get("language") or more.get("language")).lower(),
        image=image,
        explicit=str(d.get("explicit_content", "0")) == "1",
        year=_u(d.get("year")),
        saavn_id=str(d["id"]),
    )


def _songs_from(payload: Any) -> list[dict]:
    """Payloads come back as a list, {'results': [...]}, {'songs': [...]}, or {'0': {'song': {...}}, ...}."""
    if isinstance(payload, list):
        return [x.get("song", x) if isinstance(x, dict) else x for x in payload]
    if isinstance(payload, dict):
        for k in ("results", "songs", "data"):
            if isinstance(payload.get(k), list):
                return payload[k]
            if isinstance(payload.get(k), dict) and isinstance(payload[k].get("results"), list):
                return payload[k]["results"]
        return [v.get("song", v) for v in payload.values() if isinstance(v, dict) and (v.get("song") or v.get("id"))]
    return []


class HttpSaavnClient:
    BASE = "https://www.jiosaavn.com/api.php"

    def __init__(self, http: Any = None, timeout_s: float = 4.0):
        self._http = http
        self._timeout = timeout_s

    def _client(self):
        import asyncio
        import httpx
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if (
            self._http is None
            or getattr(self._http, "is_closed", False)
            or (hasattr(self, "_loop") and self._loop != loop)
        ):
            self._loop = loop
            self._http = httpx.AsyncClient(timeout=self._timeout, headers={"User-Agent": "Mozilla/5.0"})
        return self._http

    async def aclose(self):
        if self._http is not None:
            await self._http.aclose()

    async def _call(self, call: str, **params) -> Any:
        q = {"__call": call, "_format": "json", "_marker": "0", "api_version": "4", "ctx": "web6dot0", **params}
        try:
            r = await self._client().get(self.BASE, params=q)
        except RuntimeError as e:
            if "Event loop is closed" in str(e):
                self._http = None
                r = await self._client().get(self.BASE, params=q)
            else:
                raise
        r.raise_for_status()
        return r.json()

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
        return self._norm(_songs_from(await self._call("search.getResults", q=query, p=1, n=limit)), limit)

    async def get_song(self, saavn_id: str) -> Optional[Candidate]:
        res = self._norm(_songs_from(await self._call("song.getDetails", pids=saavn_id)), 1)
        return res[0] if res else None

    async def recommendations(self, saavn_id: str, limit: int = 20) -> list[Candidate]:
        return self._norm(_songs_from(await self._call("reco.getreco", pid=saavn_id)), limit)

    async def station_songs(self, saavn_id: str, limit: int = 20) -> list[Candidate]:
        st = await self._call("webradio.createEntityStation", entity_id=json.dumps([saavn_id]), entity_type="queue")
        station_id = st.get("stationid") if isinstance(st, dict) else None
        if not station_id:
            return []
        data = await self._call("webradio.getSong", stationid=station_id, k=limit)
        return self._norm(_songs_from(data), limit)

    async def trending(self, language: str = "hindi", limit: int = 30) -> list[Candidate]:
        data = await self._call("content.getTrending", entity_type="song", entity_language=language)
        return self._norm(_songs_from(data), limit)
