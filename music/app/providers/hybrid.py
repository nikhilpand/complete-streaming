"""
Hybrid Music Provider for SWAY.

Composes SaavnProvider (fast primary CDN catalogue) with YouTubeProvider (universal catalogue).
Seamlessly handles:
  - Augmented search for songs/artists restricted or delisted on JioSaavn (e.g. Atif Aslam, Coke Studio)
  - Automatic stream fallback when JioSaavn tracks are marked disabled / unavailable
  - Full transparent playback for both saavn:* and youtube:* tracks
"""

from __future__ import annotations

import asyncio
import copy
import difflib
import logging
import re
import time
from typing import Optional

from app.core.errors import ProviderError, ProviderNotFound
from app.models import (
    Album,
    Artist,
    ArtistRef,
    Lyrics,
    MediaInfo,
    Playlist,
    SearchItem,
    SearchResults,
    Song,
)
from app.providers.base import MusicProvider
from app.providers.saavn.provider import SaavnProvider
from app.providers.youtube.provider import YouTubeProvider

logger = logging.getLogger(__name__)


def _clean_str(s: str) -> str:
    # Remove metadata in brackets like (From "Film"), [Official], etc.
    s = re.sub(r"[\(\[\{].*?[\)\]\}]", "", s)
    return re.sub(r"[^\w\s]", " ", s.lower()).strip()


def _extract_item_metadata(item: SearchItem) -> tuple[str, str, str]:
    """
    Extract canonical (clean_title, clean_artist, clean_album) from SearchItem.
    Works consistently across Saavn and YouTube items without lossy heuristics.
    """
    title_clean = _clean_str(item.title)
    extra = item.extra or {}
    album = extra.get("album") or ""
    primary_artist = extra.get("primary_artists") or extra.get("artist") or ""

    subtitle = item.subtitle or ""
    if not primary_artist:
        if item.provider == "youtube":
            primary_artist = subtitle.split(",")[0].strip()
        else:
            # JioSaavn subtitle format: "Album · Artist" or "Artist"
            parts = [p.strip() for p in re.split(r"[·•|]", subtitle) if p.strip()]
            if len(parts) > 1:
                if not album:
                    album = parts[0]
                primary_artist = parts[-1].split(",")[0].strip()
            elif len(parts) == 1:
                primary_artist = parts[0].split(",")[0].strip()

    return title_clean, _clean_str(primary_artist), _clean_str(album)


def _score_relevance(query: str, item: SearchItem, source_rank: int) -> float:
    """
    Multi-feature relevance model explicitly ranking:
      - Exact artist intent
      - Artist phrase & token boundaries
      - Exact title & token boundaries
      - Combined title + artist in query (strictly word/token bounded)
      - Album match
      - Full query token coverage
      - Source rank decay
    """
    q_clean = _clean_str(query)
    title_clean, artist_clean, album_clean = _extract_item_metadata(item)
    q_tokens = set(q_clean.split())

    score = 0.0

    # 1. Exact artist intent: query is purely the artist (e.g. "atif aslam" or "arijit singh")
    if q_clean and artist_clean and (q_clean == artist_clean):
        score += 160.0
    elif q_clean and artist_clean and (
        re.search(r"(?:\b|^)" + re.escape(artist_clean) + r"(?:\b|$)", q_clean)
        or re.search(r"(?:\b|^)" + re.escape(q_clean) + r"(?:\b|$)", artist_clean)
    ):
        score += 90.0
    elif q_clean and artist_clean and any(
        len(a_tok) > 2 and a_tok in q_tokens for a_tok in artist_clean.split()
    ):
        score += 70.0

    # 2. Exact title match (e.g. "tu chahiye")
    if q_clean and q_clean == title_clean:
        score += 140.0
    elif q_clean and title_clean and (
        re.search(r"(?:\b|^)" + re.escape(q_clean) + r"(?:\b|$)", title_clean)
    ):
        score += 75.0
    elif q_clean and title_clean and (
        re.search(r"(?:\b|^)" + re.escape(title_clean) + r"(?:\b|$)", q_clean)
    ):
        score += 55.0

    # 3. Combined title + artist in query (e.g. "tu chahiye atif aslam" or "tu chahiye atif")
    # Must match using token-boundary or whole phrase boundaries, avoiding substring false-positives
    if title_clean and artist_clean:
        title_matches_q = (
            (len(title_clean) >= 3 and bool(re.search(r"(?:\b|^)" + re.escape(title_clean) + r"(?:\b|$)", q_clean)))
            or any(t in q_tokens for t in title_clean.split() if len(t) > 2)
        )
        artist_matches_q = (
            (len(artist_clean) >= 3 and bool(re.search(r"(?:\b|^)" + re.escape(artist_clean) + r"(?:\b|$)", q_clean)))
            or any(a in q_tokens for a in artist_clean.split() if len(a) > 2)
        )
        if title_matches_q and artist_matches_q:
            score += 110.0

    # 4. Album match
    if q_clean and album_clean:
        if q_clean == album_clean:
            score += 50.0
        elif re.search(r"(?:\b|^)" + re.escape(q_clean) + r"(?:\b|$)", album_clean):
            score += 30.0

    # 5. Fuzzy title match fallback
    if title_clean:
        ratio = difflib.SequenceMatcher(None, q_clean, title_clean).ratio()
        if ratio > 0.72:
            score += ratio * 60.0

    # 6. Query token coverage across all metadata
    q_tokens_list = [t for t in q_clean.split() if len(t) > 1]
    title_tokens = set(title_clean.split())
    artist_tokens = set(artist_clean.split())
    album_tokens = set(album_clean.split())
    all_tokens = title_tokens | artist_tokens | album_tokens

    if q_tokens_list:
        matched = 0
        for qt in q_tokens_list:
            if qt in artist_tokens:
                score += 35.0
                matched += 1
            elif qt in title_tokens:
                score += 30.0
                matched += 1
            elif qt in album_tokens:
                score += 15.0
                matched += 1
            else:
                best = max([difflib.SequenceMatcher(None, qt, tok).ratio() for tok in all_tokens] or [0.0])
                if best >= 0.80:
                    score += best * 20.0
                    matched += 1

        if matched == len(q_tokens_list):
            score += 40.0

    # 7. Source rank preference (decay with position)
    score += max(0.0, 15.0 - (source_rank * 1.0))

    return score


def _rank_and_merge(
    query: str,
    saavn_songs: list[SearchItem],
    yt_songs: list[SearchItem],
    n: int,
) -> list[SearchItem]:
    """
    Rank and merge search items from multiple providers.

    Two-tier deduplication:
      Tier 1 (Canonical O(1) set & dict lookups):
        - Provider ID: item.id or "provider:provider_id"
        - Recording ISRC (if present in metadata)
        - Exact normalized (title, artist) pair
        - Exact normalized title mapped to artist set
      Tier 2 (Bounded secondary fuzzy pass):
        - Compares candidates against the bounded window of recently accepted
          items (capped at 25 items) to catch near-identical titles (e.g. "(Audio)", "(Official)").
    """
    scored_candidates: list[tuple[float, SearchItem]] = []
    for i, item in enumerate(saavn_songs):
        scored_candidates.append((_score_relevance(query, item, i), item))
    for j, item in enumerate(yt_songs):
        scored_candidates.append((_score_relevance(query, item, j), item))

    # Sort descending by score
    scored_candidates.sort(key=lambda x: x[0], reverse=True)

    merged: list[SearchItem] = []
    seen_provider_ids: set[str] = set()
    seen_isrcs: set[str] = set()
    seen_canonical_pairs: set[tuple[str, str]] = set()
    seen_titles_to_artists: dict[str, set[str]] = {}
    recent_fuzzy_window: list[tuple[str, str]] = []

    for score, item in scored_candidates:
        # Tier 1a: Exact Provider ID (O(1))
        prov_key = f"{item.provider}:{item.provider_id}"
        if item.id in seen_provider_ids or prov_key in seen_provider_ids:
            continue

        # Tier 1b: Exact ISRC Recording ID (O(1))
        extra = item.extra or {}
        isrc = extra.get("isrc")
        if isrc and isrc in seen_isrcs:
            continue

        t_clean, a_clean, _ = _extract_item_metadata(item)
        pair_key = (t_clean, a_clean)

        # Tier 1c: Exact Canonical (title, artist) pair (O(1))
        if t_clean and a_clean and pair_key in seen_canonical_pairs:
            continue

        # Tier 1d: Exact title match with matching or missing artist (O(1))
        if t_clean and t_clean in seen_titles_to_artists:
            existing_artists = seen_titles_to_artists[t_clean]
            if not a_clean or not existing_artists or any(
                a_clean == ea or a_clean in ea or ea in a_clean
                for ea in existing_artists
            ):
                continue

        # Tier 2: Bounded secondary fuzzy pass (at most 25 recent items)
        is_dup = False
        if t_clean and len(t_clean) > 5:
            for rt, ra in recent_fuzzy_window:
                if len(rt) > 5 and difflib.SequenceMatcher(None, t_clean, rt).ratio() >= 0.90:
                    if not a_clean or not ra or a_clean == ra or a_clean in ra or ra in a_clean:
                        is_dup = True
                        break

        if is_dup:
            continue

        seen_provider_ids.add(item.id)
        seen_provider_ids.add(prov_key)
        if isrc:
            seen_isrcs.add(isrc)
        if t_clean and a_clean:
            seen_canonical_pairs.add(pair_key)
        if t_clean:
            seen_titles_to_artists.setdefault(t_clean, set()).add(a_clean)
            recent_fuzzy_window.append((t_clean, a_clean))
            if len(recent_fuzzy_window) > 25:
                recent_fuzzy_window.pop(0)

        merged.append(item)
        if len(merged) >= n:
            break

    return merged


class HybridMusicProvider(MusicProvider):
    """
    Unified provider coordinating JioSaavn and YouTube Music.
    """

    provider_name: str = "hybrid"

    def __init__(
        self,
        saavn_provider: SaavnProvider,
        youtube_provider: YouTubeProvider,
    ) -> None:
        self.saavn = saavn_provider
        self.youtube = youtube_provider
        self._search_cache: dict[str, tuple[float, SearchResults]] = {}
        self._cache_ttl = 90.0  # 90 seconds query cache
        self._inflight_searches: dict[str, asyncio.Task[SearchResults]] = {}

    def _store_cache(self, key: str, res: SearchResults, ts: float) -> None:
        if len(self._search_cache) > 500:
            self._search_cache.clear()
        self._search_cache[key] = (ts, copy.deepcopy(res))

    # ── Search ───────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        q_clean = query.strip()
        cache_key = f"{q_clean.lower()}:{n}:{page}:{enrich}"
        now = time.time()

        # 1. Cache hit -> return isolated deep copy to prevent cross-request mutations
        if cache_key in self._search_cache:
            ts, cached_res = self._search_cache[cache_key]
            if now - ts < self._cache_ttl:
                return copy.deepcopy(cached_res)

        # 2. In-flight request coalescing -> wait on existing task if active
        if cache_key in self._inflight_searches:
            task = self._inflight_searches[cache_key]
            if not task.done():
                try:
                    res = await task
                    return copy.deepcopy(res)
                except Exception:
                    # In-flight task failed; fall through to fresh execution
                    pass

        # 3. Create fresh search execution task and register in _inflight_searches
        loop = asyncio.get_running_loop()
        search_task = loop.create_task(
            self._execute_search(
                query=query,
                q_clean=q_clean,
                n=n,
                page=page,
                enrich=enrich,
                cache_key=cache_key,
            )
        )
        self._inflight_searches[cache_key] = search_task

        try:
            res = await search_task
            return copy.deepcopy(res)
        finally:
            if self._inflight_searches.get(cache_key) is search_task:
                self._inflight_searches.pop(cache_key, None)

    async def _execute_search(
        self,
        query: str,
        q_clean: str,
        n: int,
        page: int,
        enrich: bool,
        cache_key: str,
    ) -> SearchResults:
        now = time.time()

        # Very short queries (<= 2 chars): fast provider-primary (Saavn) first
        if len(q_clean) <= 2:
            try:
                res = await self.saavn.search(query, n=n, page=page, enrich=enrich)
                self._store_cache(cache_key, res, now)
                return res
            except Exception as e:
                logger.warning("Saavn short query search failed: %s", e)

        # Full hybrid search: run Saavn + YouTube concurrently with 2.5s timeout on YouTube
        saavn_task = self.saavn.search(query, n=n, page=page, enrich=enrich)
        yt_task = asyncio.wait_for(
            self.youtube.search(query, n=min(n, 12), page=page),
            timeout=2.5,
        )

        saavn_res, yt_res = await asyncio.gather(saavn_task, yt_task, return_exceptions=True)

        if isinstance(saavn_res, Exception):
            logger.warning("Saavn search failed for query %r: %s", query, saavn_res)
            saavn_results = SearchResults(
                query=query, songs=[], albums=[], artists=[], playlists=[],
                total_songs=0, total_albums=0, total_artists=0, total_playlists=0,
            )
        else:
            saavn_results = saavn_res

        yt_songs: list[SearchItem] = []
        if not isinstance(yt_res, Exception) and yt_res and yt_res.songs:
            yt_songs = yt_res.songs

        if saavn_results.songs or yt_songs:
            saavn_results.songs = _rank_and_merge(query, saavn_results.songs, yt_songs, n=n)
            saavn_results.total_songs = len(saavn_results.songs)

        # Canonical enrichment without fabricated/synthetic fallback Song models
        if enrich and saavn_results.songs:
            existing_enriched = {
                s.id: s for s in (saavn_results.enriched_songs or []) if isinstance(s, Song)
            }
            existing_by_pid = {
                s.provider_id: s for s in (saavn_results.enriched_songs or []) if isinstance(s, Song)
            }

            resolved_map: dict[str, Song] = dict(existing_enriched)

            enrich_candidates = saavn_results.songs[:n]
            unresolved_yt: list[SearchItem] = [
                item for item in enrich_candidates
                if item.provider == "youtube" and item.id not in resolved_map and item.provider_id not in existing_by_pid
            ]
            unresolved_saavn: list[SearchItem] = [
                item for item in enrich_candidates
                if item.provider == "saavn" and item.id not in resolved_map and item.provider_id not in existing_by_pid
            ]

            async def _resolve_yt(item: SearchItem) -> None:
                try:
                    song = await self.youtube.get_song(item.provider_id)
                    if song:
                        resolved_map[item.id] = song
                except Exception as ex:
                    logger.debug("Canonical YouTube resolution omitted for %s: %s", item.id, ex)

            async def _resolve_saavn(item: SearchItem) -> None:
                try:
                    song = await self.saavn.get_song(item.provider_id)
                    if song:
                        resolved_map[item.id] = song
                except Exception as ex:
                    logger.debug("Canonical Saavn resolution omitted for %s: %s", item.id, ex)

            tasks = [_resolve_yt(item) for item in unresolved_yt]
            if unresolved_saavn:
                tasks.extend([_resolve_saavn(item) for item in unresolved_saavn[:5]])

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

            # Only genuine canonical Song objects returned by the provider are retained
            saavn_results.enriched_songs = [
                resolved_map[item.id]
                for item in saavn_results.songs
                if item.id in resolved_map
            ]

        self._store_cache(cache_key, saavn_results, now)
        return saavn_results

    # ── Song Metadata ─────────────────────────────────────────────────────────

    async def get_song(self, song_id: str) -> Song:
        sid = song_id.strip()
        if sid.startswith("youtube:") or sid.startswith("yt:"):
            return await self.youtube.get_song(sid)

        try:
            return await self.saavn.get_song(sid)
        except ProviderNotFound:
            # Fallback check YouTube
            try:
                return await self.youtube.get_song(sid)
            except Exception:
                raise ProviderNotFound(f"Song not found: {sid}", provider="hybrid")

    async def get_songs(self, song_ids: list[str]) -> list[Song]:
        saavn_ids: list[tuple[int, str]] = []
        yt_ids: list[tuple[int, str]] = []

        for idx, sid in enumerate(song_ids):
            if sid.startswith("youtube:") or sid.startswith("yt:"):
                yt_ids.append((idx, sid))
            else:
                saavn_ids.append((idx, sid))

        results: list[Optional[Song]] = [None] * len(song_ids)

        if saavn_ids:
            s_res = await self.saavn.get_songs([sid for _, sid in saavn_ids])
            for (idx, _), song in zip(saavn_ids, s_res):
                results[idx] = song

        if yt_ids:
            yt_res = await self.youtube.get_songs([sid for _, sid in yt_ids])
            for (idx, _), song in zip(yt_ids, yt_res):
                results[idx] = song

        return [r for r in results if r is not None]

    # ── Media Stream Resolution ───────────────────────────────────────────────

    async def resolve_media(self, song: Song) -> Optional[MediaInfo]:
        if song.provider == "youtube" or song.id.startswith("youtube:"):
            return await self.youtube.resolve_media(song)

        # Primary: JioSaavn
        try:
            media = await self.saavn.resolve_media(song)
            if media and media.streams:
                return media
        except Exception as exc:
            logger.warning("Saavn media resolution failed for %s: %s", song.id, exc)

        # Fallback to YouTube if JioSaavn has no streams or is disabled
        artist_str = ", ".join(a.name for a in song.artists if a.name)
        logger.info("JioSaavn streams unavailable for '%s'. Resolving via YouTube fallback...", song.title)
        return await self.youtube.resolve_by_query(song.title, artist_str)

    # ── Pass-throughs ─────────────────────────────────────────────────────────

    async def resolve_url(self, url: str):
        if "youtube.com" in url or "youtu.be" in url:
            return await self.youtube.resolve_url(url)
        return await self.saavn.resolve_url(url)

    async def get_lyrics(self, lyrics_id: str) -> Lyrics:
        if lyrics_id.startswith("youtube:") or lyrics_id.startswith("yt:"):
            return await self.youtube.get_lyrics(lyrics_id)
        return await self.saavn.get_lyrics(lyrics_id)

    async def get_album(self, album_id: str) -> Album:
        return await self.saavn.get_album(album_id)

    async def get_playlist(self, playlist_id: str) -> Playlist:
        return await self.saavn.get_playlist(playlist_id)

    async def get_artist(self, artist_id: str) -> Artist:
        return await self.saavn.get_artist(artist_id)

    async def get_artist_songs(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Song]:
        return await self.saavn.get_artist_songs(artist_id, page=page, n=n)

    async def get_artist_albums(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Album]:
        return await self.saavn.get_artist_albums(artist_id, page=page, n=n)

    async def health_check(self) -> dict:
        return await self.saavn.health_check()
