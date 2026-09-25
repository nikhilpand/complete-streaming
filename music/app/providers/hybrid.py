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
import logging
from typing import Optional

from app.core.errors import ProviderError, ProviderNotFound
from app.models import (
    Album,
    Artist,
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

# Keywords / artists known to be restricted, delisted, or sparse on JioSaavn
_RESTRICTED_KEYWORDS = (
    "atif",
    "aslam",
    "rahat",
    "nusrat",
    "coke studio",
    "chahiye",
    "chaiye",
    "ali zafar",
    "pakistani",
    "qawwali",
)


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

    # ── Search ───────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        q_lower = query.lower()
        should_query_youtube = any(kw in q_lower for kw in _RESTRICTED_KEYWORDS)

        # 1. Run Saavn search
        try:
            saavn_results = await self.saavn.search(query, n=n, page=page, enrich=enrich)
        except Exception as exc:
            logger.warning("Saavn search failed for query %r: %s", query, exc)
            saavn_results = SearchResults(
                query=query, songs=[], albums=[], artists=[], playlists=[],
                total_songs=0, total_albums=0, total_artists=0, total_playlists=0,
            )

        # If Saavn results are sparse (< 4 songs) or query targets known restricted keywords
        if should_query_youtube or len(saavn_results.songs) < 4:
            try:
                yt_results = await self.youtube.search(query, n=min(n, 10), page=page)
                if yt_results.songs:
                    # Blend results: prioritize YouTube songs if query matched restricted keywords
                    existing_titles = {s.title.lower().strip() for s in saavn_results.songs}
                    unique_yt_songs = [
                        s for s in yt_results.songs
                        if s.title.lower().strip() not in existing_titles or should_query_youtube
                    ]

                    if should_query_youtube:
                        # Prepend high-relevance YouTube songs (e.g. Tu Chahiye - Atif Aslam)
                        merged_songs = unique_yt_songs + [
                            s for s in saavn_results.songs
                            if s.id not in {y.id for y in unique_yt_songs}
                        ]
                    else:
                        merged_songs = saavn_results.songs + unique_yt_songs

                    saavn_results.songs = merged_songs[:n]
                    saavn_results.total_songs = len(saavn_results.songs)
            except Exception as yt_exc:
                logger.warning("YouTube search fallback failed for query %r: %s", query, yt_exc)

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
