"""
YouTube Music Provider for SWAY.

Fulfills MusicProvider interface using:
  - ytmusicapi for fast catalogue search and metadata
  - yt-dlp for direct audio stream URL extraction (with in-memory TTL caching)

Enables full access to global catalogue, unreleased tracks, and songs
restricted/delisted on domestic providers (e.g. Atif Aslam, Coke Studio, Pakistani OSTs).
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from app.core.errors import ProviderError, ProviderNotFound
from app.models import (
    Album,
    Artist,
    ArtistRef,
    Lyrics,
    MediaInfo,
    MediaStream,
    Playlist,
    SearchItem,
    SearchResults,
    Song,
)
from app.providers.base import MusicProvider

logger = logging.getLogger(__name__)


def _sanitize_id(video_id: str) -> str:
    sid = video_id.strip()
    if sid.startswith("youtube:"):
        sid = sid[8:]
    elif sid.startswith("yt:"):
        sid = sid[3:]
    return sid


def _best_thumbnail(thumbnails: list[dict]) -> Optional[str]:
    if not thumbnails:
        return None
    # Pick largest thumbnail and upgrade sizing if googleusercontent URL
    url = thumbnails[-1].get("url")
    if not url:
        return None
    # If it's a googleusercontent image, upgrade dimensions to 500x500
    if "googleusercontent.com" in url:
        return re.sub(r"=w\d+-h\d+", "=w500-h500", url)
    return url


class YouTubeProvider(MusicProvider):
    """
    YouTube Music data provider.
    """

    provider_name: str = "youtube"

    def __init__(self, cache=None) -> None:
        self._cache = cache
        self._yt = None

    def _get_yt(self):
        if self._yt is None:
            from ytmusicapi import YTMusic
            self._yt = YTMusic()
        return self._yt

    # ── Search ───────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        def _do_search():
            yt = self._get_yt()
            try:
                return yt.search(query, filter="songs")
            except Exception as e:
                logger.warning("ytmusicapi search error for %r: %s", query, e)
                return []

        raw_results = await asyncio.to_thread(_do_search)
        songs: list[SearchItem] = []

        for item in raw_results[:n]:
            video_id = item.get("videoId")
            if not video_id:
                continue

            artists = [a.get("name", "") for a in item.get("artists", []) if a.get("name")]
            artist_str = ", ".join(artists) if artists else "YouTube Music"
            artwork = _best_thumbnail(item.get("thumbnails", [])) or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

            duration_s = item.get("duration_seconds")
            duration_ms = duration_s * 1000 if duration_s else None

            songs.append(
                SearchItem(
                    id=f"youtube:{video_id}",
                    provider="youtube",
                    provider_id=video_id,
                    type="song",
                    title=item.get("title", ""),
                    subtitle=artist_str,
                    artwork_url=artwork,
                    perma_url=f"https://music.youtube.com/watch?v={video_id}",
                    extra={
                        "duration_ms": duration_ms,
                        "is_explicit": item.get("isExplicit", False),
                        "album": (item.get("album") or {}).get("name"),
                    },
                )
            )

        return SearchResults(
            query=query,
            songs=songs,
            albums=[],
            artists=[],
            playlists=[],
            total_songs=len(songs),
            total_albums=0,
            total_artists=0,
            total_playlists=0,
        )

    # ── Song Metadata ─────────────────────────────────────────────────────────

    async def get_song(self, song_id: str) -> Song:
        vid = _sanitize_id(song_id)

        # Check cache if available
        cache_key = f"yt:song:{vid}"
        if self._cache:
            val, status = await self._cache.get(cache_key)
            if status == "hit" and val is not None:
                return val

        def _fetch_song_details():
            yt = self._get_yt()
            try:
                data = yt.get_song(vid)
                details = data.get("videoDetails", {})
                if details:
                    return details
            except Exception as e:
                logger.debug("yt.get_song error for %s: %s", vid, e)

            # Fallback to search if get_song details empty
            return None

        details = await asyncio.to_thread(_fetch_song_details)

        if details:
            title = details.get("title", "Unknown Title")
            author = details.get("author", "Unknown Artist")
            # Split multiple artists separated by commas or ampersands
            artist_names = [a.strip() for a in re.split(r",|&", author) if a.strip()]
            artists = [
                ArtistRef(
                    id=f"youtube:artist:{name.lower().replace(' ', '_')}",
                    provider="youtube",
                    provider_id=name.lower().replace(" ", "_"),
                    name=name,
                    role="primary",
                )
                for name in (artist_names or [author])
            ]
            length_s = int(details.get("lengthSeconds") or 0)
            duration_ms = length_s * 1000 if length_s > 0 else None
            thumbnails = details.get("thumbnail", {}).get("thumbnails", [])
            artwork = _best_thumbnail(thumbnails) or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        else:
            # Fallback metadata
            title = "Track"
            artists = [
                ArtistRef(
                    id="youtube:artist:unknown",
                    provider="youtube",
                    provider_id="unknown",
                    name="Artist",
                    role="primary",
                )
            ]
            duration_ms = None
            artwork = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

        canonical_song = Song(
            id=f"youtube:{vid}",
            provider="youtube",
            provider_id=vid,
            title=title,
            artists=artists,
            featured_artists=[],
            album="YouTube Music",
            album_id=None,
            duration_ms=duration_ms,
            artwork_url=artwork,
            language=None,
            year=None,
            release_date=None,
            label="YouTube Music",
            copyright_text=None,
            has_lyrics=False,
            lyrics_id=None,
            has_media=True,
            is_explicit=False,
            perma_url=f"https://music.youtube.com/watch?v={vid}",
        )

        if self._cache:
            await self._cache.set(cache_key, canonical_song, ttl=86400)

        return canonical_song

    async def get_songs(self, song_ids: list[str]) -> list[Song]:
        tasks = [self.get_song(sid) for sid in song_ids]
        return await asyncio.gather(*tasks, return_exceptions=False)

    # ── Media Stream Resolution ───────────────────────────────────────────────

    async def resolve_media(self, song: Song) -> Optional[MediaInfo]:
        vid = _sanitize_id(song.provider_id or song.id)

        # Check cache (4 hours TTL for stream URLs)
        cache_key = f"yt:media:{vid}"
        if self._cache:
            val, status = await self._cache.get(cache_key)
            if status == "hit" and val is not None:
                return val

        def _extract():
            import yt_dlp
            ydl_opts = {
                "format": "bestaudio[ext=m4a]/bestaudio/best",
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "noplaylist": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
                return info

        try:
            info = await asyncio.to_thread(_extract)
            stream_url = info.get("url")
            if not stream_url:
                return None

            bitrate = int(info.get("abr") or info.get("tbr") or 160)
            mime = "audio/mp4" if info.get("ext") == "m4a" else "audio/webm"

            media = MediaInfo(
                song_id=f"youtube:{vid}",
                provider="youtube",
                streams=[
                    MediaStream(
                        quality="high",
                        url=stream_url,
                        mime_type=mime,
                        bitrate_kbps=bitrate,
                    )
                ],
                resolved_at=datetime.utcnow(),
                expires_hint=datetime.utcnow() + timedelta(hours=4),
            )

            if self._cache:
                await self._cache.set(cache_key, media, ttl=14400)

            return media
        except Exception as exc:
            logger.error("Failed to resolve YouTube media for %s: %s", vid, exc)
            return None

    # ── Search & Resolve by Title + Artist ────────────────────────────────────

    async def resolve_by_query(self, title: str, artists: str = "") -> Optional[MediaInfo]:
        """
        Search YouTube Music for a given title + artist and resolve its media stream.
        Used as seamless fallback when JioSaavn media is disabled or unavailable.
        """
        search_q = f"{title} {artists}".strip()
        results = await self.search(search_q, n=1)
        if not results.songs:
            return None

        top_song = await self.get_song(results.songs[0].provider_id)
        return await self.resolve_media(top_song)

    # ── Unsupported endpoints default graceful returns ────────────────────────

    async def resolve_url(self, url: str):
        # Extract video ID from youtube URL
        match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_\-]{11})", url)
        if match:
            return await self.get_song(match.group(1))
        raise ProviderNotFound(f"Cannot resolve URL: {url}", provider="youtube")

    async def get_lyrics(self, lyrics_id: str) -> Lyrics:
        return Lyrics(
            id=lyrics_id,
            provider="youtube",
            provider_id=lyrics_id,
            plain=None,
            synced=None,
        )

    async def get_album(self, album_id: str) -> Album:
        raise ProviderNotFound("YouTube albums not implemented", provider="youtube")

    async def get_playlist(self, playlist_id: str) -> Playlist:
        raise ProviderNotFound("YouTube playlists not implemented", provider="youtube")

    async def get_artist(self, artist_id: str) -> Artist:
        raise ProviderNotFound("YouTube artists not implemented", provider="youtube")

    async def get_artist_songs(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Song]:
        return []

    async def get_artist_albums(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Album]:
        return []

    async def health_check(self) -> dict:
        return {"status": "ok", "provider": "youtube"}
