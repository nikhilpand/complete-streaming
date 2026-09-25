"""
SaavnProvider: implements MusicProvider for JioSaavn.

Responsibilities at this layer:
  - Check cache (hit → return, stale → return + background refresh, miss → fetch)
  - Call SaavnClient for upstream requests
  - Parse raw responses via parser.py
  - Normalise to canonical models via normaliser.py
  - Cache results with appropriate TTLs
  - Handle partial failures gracefully

What this does NOT do:
  - Make HTTP requests (SaavnClient does that)
  - Parse raw JSON (parser.py does that)
  - Transform to canonical models (normaliser.py does that)
"""

from __future__ import annotations

import asyncio
import logging
from typing import Union

from app.config import settings
from app.core.cache import MemoryTTLCache
from app.core.circuit_breaker import CircuitBreaker
from app.core.concurrency import ProviderConcurrencyLimiter
from app.core.errors import ProviderNotFound
from app.models import (
    Album,
    Artist,
    Lyrics,
    MediaInfo,
    Playlist,
    SearchResults,
    Song,
)
from app.providers.base import MusicProvider
from app.providers.saavn import client as _client_module
from app.providers.saavn.client import SaavnClient
from app.providers.saavn.normaliser import (
    norm_album,
    norm_artist,
    norm_lyrics,
    norm_media,
    norm_playlist,
    norm_search,
    norm_song,
)
from app.providers.saavn.parser import (
    parse_album_raw,
    parse_artist_raw,
    parse_lyrics_raw,
    parse_playlist_raw,
    parse_search_raw,
    parse_songs_response,
)
from app.providers.saavn.resolver import SaavnURLResolver

logger = logging.getLogger(__name__)

PROVIDER = "saavn"


class SaavnProvider(MusicProvider):
    """
    JioSaavn implementation of MusicProvider.

    Fully async, cache-aware, concurrency-bounded.
    """

    provider_name = PROVIDER

    def __init__(
        self,
        client: SaavnClient,
        cache: MemoryTTLCache,
        limiter: ProviderConcurrencyLimiter,
        circuit_breaker: CircuitBreaker,
    ) -> None:
        self._client = client
        self._cache = cache
        self._limiter = limiter
        self._cb = circuit_breaker
        # Keeps strong references to in-flight background refresh tasks so that
        # the GC cannot collect a pending Task before it finishes (which would
        # silently drop the refresh and emit a "Task was destroyed" warning).
        self._bg_tasks: set[asyncio.Task] = set()

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _cached(
        self,
        key: str,
        fetch_fn,
        ttl: int,
        *,
        stale_ok: bool = True,
    ):
        value, status = await self._cache.get(key, stale_ok=stale_ok)
        if status == "hit":
            logger.debug("cache=hit key=%s", key)
            return value
        if status == "stale":
            logger.debug("cache=stale key=%s (serving stale, refreshing async)", key)
            task = asyncio.create_task(self._background_refresh(key, fetch_fn, ttl))
            self._bg_tasks.add(task)  # strong reference: GC-safe until done
            return value
        # miss
        logger.debug("cache=miss key=%s", key)
        result = await fetch_fn()
        await self._cache.set(key, result, ttl=ttl, stale_window=settings.CACHE_STALE_WINDOW)
        return result

    async def _background_refresh(self, key: str, fetch_fn, ttl: int) -> None:
        try:
            result = await fetch_fn()
            await self._cache.set(key, result, ttl=ttl, stale_window=settings.CACHE_STALE_WINDOW)
            logger.debug("background_refresh=ok key=%s", key)
        except Exception as exc:
            logger.warning("background_refresh=failed key=%s error=%s", key, exc)
        finally:
            # Remove self from the live-tasks set so the task object can be GC'd
            # now that it has completed.  This is the counterpart to the add in _cached.
            self._bg_tasks.discard(asyncio.current_task())

    # ── Search ────────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        import hashlib
        cache_key = f"saavn:search:{hashlib.sha256(f'{query}:{n}:{page}:{enrich}'.encode()).hexdigest()[:16]}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "autocomplete.get",
                "query": query,
                "includeMetaTags": "1",
            })
            parsed = parse_search_raw(raw, query)
            results = norm_search(parsed)

            if enrich and results.songs:
                # Deduplicate song IDs, bounded to SEARCH_ENRICH_LIMIT
                candidate_ids = list(dict.fromkeys(s.provider_id for s in results.songs))[:settings.SEARCH_ENRICH_LIMIT]
                if candidate_ids:
                    try:
                        # Batch-fetches uncached songs via single request + checks cache
                        results.enriched_songs = await self.get_songs(candidate_ids)
                    except Exception as exc:
                        # Preserve search results even if enrichment fails
                        logger.warning("Search enrichment failed for query %r: %s", query, exc)

            return results

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_SEARCH)

    # ── Songs ─────────────────────────────────────────────────────────────────

    async def get_song(self, song_id: str) -> Song:
        cache_key = f"saavn:song:{song_id}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "song.getDetails",
                "pids": song_id,
            })
            songs = parse_songs_response(raw)
            if not songs:
                raise ProviderNotFound(f"Song not found: {song_id}", provider=PROVIDER)
            return norm_song(songs[0])

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_SONG)

    async def get_songs(self, song_ids: list[str]) -> list[Song]:
        """
        Fetch multiple songs.

        Strategy:
          1. Check cache for each ID
          2. Batch-fetch uncached IDs in ONE upstream request (not N requests)
          3. Cache results individually
        """
        if not song_ids:
            return []

        # Cap batch size
        ids = list(dict.fromkeys(song_ids))[:settings.BULK_IDS_MAX]

        # Check cache first
        cached: dict[str, Song] = {}
        uncached_ids: list[str] = []
        for sid in ids:
            val, status = await self._cache.get(f"saavn:song:{sid}", stale_ok=True)
            if val is not None:
                cached[sid] = val
            else:
                uncached_ids.append(sid)

        # Batch fetch uncached — ONE upstream request, not N
        if uncached_ids:
            raw = await self._client.get({
                "__call": "song.getDetails",
                "pids": ",".join(uncached_ids),
            })
            fetched_songs = parse_songs_response(raw)
            for parsed in fetched_songs:
                song = norm_song(parsed)
                cached[parsed["id"]] = song
                await self._cache.set(
                    f"saavn:song:{parsed['id']}",
                    song,
                    ttl=settings.CACHE_TTL_SONG,
                    stale_window=settings.CACHE_STALE_WINDOW,
                )

        # Return in original order
        return [cached[sid] for sid in ids if sid in cached]

    # ── Albums ────────────────────────────────────────────────────────────────

    async def get_album(self, album_id: str) -> Album:
        cache_key = f"saavn:album:{album_id}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "content.getAlbumDetails",
                "albumid": album_id,
            })
            parsed = parse_album_raw(raw)
            return norm_album(parsed)

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_ALBUM)

    # ── Playlists ─────────────────────────────────────────────────────────────

    async def get_playlist(self, playlist_id: str) -> Playlist:
        cache_key = f"saavn:playlist:{playlist_id}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "playlist.getDetails",
                "listid": playlist_id,
            })
            parsed = parse_playlist_raw(raw)
            return norm_playlist(parsed)

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_PLAYLIST)

    # ── Artists ───────────────────────────────────────────────────────────────

    async def get_artist(self, artist_id: str) -> Artist:
        """Fetch artist metadata. top_songs/top_albums populated from page data."""
        cache_key = f"saavn:artist:{artist_id}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "artist.getArtistPageDetails",
                "artistId": artist_id,
                "page": "0",
                "n_song": "10",    # lightweight — top_songs only
                "n_album": "10",
                "includeMetaTags": "0",
            })
            parsed = parse_artist_raw(raw)
            return norm_artist(parsed)

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_ARTIST)

    async def get_artist_songs(self, artist_id: str, *, page: int = 0, n: int = 50) -> list[Song]:
        """Paginated artist songs — separate call, not bundled with get_artist."""
        cache_key = f"saavn:artist_songs:{artist_id}:{page}:{n}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "artist.getArtistPageDetails",
                "artistId": artist_id,
                "page": page,
                "n_song": n,
                "n_album": "0",
                "sub_type": "songs",
            })
            top_songs_raw = (raw.get("topSongs") or {}).get("songs") or []
            from app.providers.saavn.parser import parse_song_raw
            return [norm_song(parse_song_raw(s)) for s in top_songs_raw if isinstance(s, dict)]

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_ARTIST)

    async def get_artist_albums(self, artist_id: str, *, page: int = 0, n: int = 50) -> list[Album]:
        """Paginated artist albums — separate call."""
        cache_key = f"saavn:artist_albums:{artist_id}:{page}:{n}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "artist.getArtistPageDetails",
                "artistId": artist_id,
                "page": page,
                "n_song": "0",
                "n_album": n,
                "sub_type": "albums",
            })
            top_albums_raw = (raw.get("topAlbums") or {}).get("albums") or []
            from app.providers.saavn.parser import parse_album_raw
            return [norm_album(parse_album_raw(a)) for a in top_albums_raw if isinstance(a, dict)]

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_ARTIST)

    # ── Lyrics ────────────────────────────────────────────────────────────────

    async def get_lyrics(self, lyrics_id: str) -> Lyrics:
        cache_key = f"saavn:lyrics:{lyrics_id}"

        async def _fetch():
            raw = await self._client.get({
                "__call": "lyrics.getLyrics",
                "lyrics_id": lyrics_id,
                "ctx": "web6dot0",
            })
            parsed = parse_lyrics_raw(raw, lyrics_id)
            return norm_lyrics(parsed, lyrics_id)

        return await self._cached(cache_key, _fetch, ttl=settings.CACHE_TTL_LYRICS)

    # ── Media resolution ──────────────────────────────────────────────────────

    async def resolve_media(self, song: Song) -> MediaInfo | None:
        """
        Attempt media URL resolution for a song.

        Uses a SHORT TTL cache (5 min) because CDN URLs expire.
        Never uses the same cache as song metadata.

        Returns None if the song has no media or decryption fails.
        """
        if not song.has_media:
            return None

        cache_key = f"saavn:media:{song.provider_id}"
        value, status = await self._cache.get(cache_key, stale_ok=False)
        if value is not None:
            return value

        # Re-fetch song to get fresh encrypted URL
        try:
            raw = await self._client.get({
                "__call": "song.getDetails",
                "pids": song.provider_id,
            })
            songs = parse_songs_response(raw)
            if not songs:
                return None

            media = norm_media(songs[0])
            if media:
                await self._cache.set(
                    cache_key, media,
                    ttl=settings.CACHE_TTL_MEDIA,
                    stale_window=0,  # NO stale window for media URLs
                )
            return media
        except Exception as exc:
            logger.warning("Media resolution failed for %s: %s", song.provider_id, exc)
            return None

    # ── URL resolution ────────────────────────────────────────────────────────

    async def resolve_url(self, url: str) -> Union[Song, Album, Playlist, Artist]:
        """Resolve a JioSaavn share URL to the appropriate resource."""
        token, resource_type = SaavnURLResolver.parse(url)

        raw = await self._client.get({
            "__call": "webapi.get",
            "token": token,
            "type": resource_type,
        })

        if resource_type == "song":
            songs = parse_songs_response(raw)
            if not songs:
                raise ProviderNotFound(f"Song not found for URL: {url}", provider=PROVIDER)
            return norm_song(songs[0])
        elif resource_type == "album":
            return norm_album(parse_album_raw(raw))
        elif resource_type == "playlist":
            return norm_playlist(parse_playlist_raw(raw))
        elif resource_type == "artist":
            return norm_artist(parse_artist_raw(raw))
        else:
            # Default: try song
            songs = parse_songs_response(raw)
            if songs:
                return norm_song(songs[0])
            raise ProviderNotFound(f"Could not resolve URL: {url}", provider=PROVIDER)

    # ── Health ────────────────────────────────────────────────────────────────

    async def health_check(self) -> dict:
        """
        Lightweight health probe.

        Reports circuit breaker state.
        Does NOT make upstream requests (would make health expensive).
        """
        cb_status = self._cb.status_dict()
        return {
            "provider": PROVIDER,
            "circuit_breaker": cb_status,
            "cache_size": len(self._cache),
        }
