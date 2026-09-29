"""
Spotify Provider for SWAY.

Fulfills MusicProvider interface for playlist and track metadata extraction using:
  1. Keyless Spotify Embed scraping (zero API keys required, out-of-the-box).
  2. Optional official Spotify Web API Client Credentials flow (if SPOTIFY_CLIENT_ID
     and SPOTIFY_CLIENT_SECRET are configured).
  3. Seamless bridge to YouTube audio resolution for audio streaming.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Optional
from urllib.parse import urlparse

import httpx

from app.config import settings
from app.core.errors import ProviderError, ProviderInvalidRequest, ProviderNotFound
from app.models import (
    Album,
    Artist,
    ArtistRef,
    Lyrics,
    MediaInfo,
    Playlist,
    SearchResults,
    Song,
)
from app.providers.base import MusicProvider

logger = logging.getLogger(__name__)

_SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")
_PLAYLIST_URL_RE = re.compile(r"playlist/([A-Za-z0-9]{22})")
_SPOTIFY_URI_RE = re.compile(r"spotify:playlist:([A-Za-z0-9]{22})")


def _sanitize_spotify_id(raw_id: str) -> str:
    sid = raw_id.strip()
    if sid.startswith("spotify:playlist:"):
        sid = sid[17:]
    elif sid.startswith("spotify:"):
        sid = sid[8:]
    elif sid.startswith("playlist:"):
        sid = sid[9:]
    return sid


class SpotifyProvider(MusicProvider):
    """
    Provider for Spotify metadata ingestion and playlist import.
    """

    def __init__(self, cache=None):
        self._cache = cache
        self._token: Optional[str] = None
        self._token_expires_at: float = 0.0

    async def _get_app_token(self, client: httpx.AsyncClient) -> Optional[str]:
        """Obtain Spotify Web API access token via client credentials if configured."""
        if not settings.SPOTIFY_CLIENT_ID or not settings.SPOTIFY_CLIENT_SECRET:
            return None

        now = asyncio.get_event_loop().time()
        if self._token and self._token_expires_at > now + 60:
            return self._token

        try:
            res = await client.post(
                "https://accounts.spotify.com/api/token",
                data={"grant_type": "client_credentials"},
                auth=(settings.SPOTIFY_CLIENT_ID, settings.SPOTIFY_CLIENT_SECRET),
                timeout=10.0,
            )
            if res.status_code == 200:
                data = res.json()
                self._token = data.get("access_token")
                expires_in = data.get("expires_in", 3600)
                self._token_expires_at = now + expires_in
                return self._token
        except Exception as e:
            logger.warning("Failed to obtain Spotify official token: %s", e)

        return None

    # ── Playlist Ingestion ───────────────────────────────────────────────────

    async def get_playlist(self, playlist_id: str) -> Playlist:
        clean_id = _sanitize_spotify_id(playlist_id)
        if not _SPOTIFY_ID_RE.match(clean_id):
            raise ProviderInvalidRequest(
                f"Invalid Spotify playlist ID format: {playlist_id!r}",
                provider="spotify",
            )

        cache_key = f"spotify:playlist:{clean_id}"
        if self._cache:
            val, status = await self._cache.get(cache_key)
            if status == "hit" and val is not None and len(getattr(val, "songs", [])) > 0:
                return val

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15.0) as client:
            # 1. Try official API if credentials available
            token = await self._get_app_token(client)
            if token:
                try:
                    official_pl = await self._fetch_playlist_official(client, clean_id, token, cache_key)
                    if official_pl and len(official_pl.songs) > 0:
                        return official_pl
                    logger.warning("Official Spotify API returned 0 tracks for %s, falling back to embed", clean_id)
                except Exception as e:
                    logger.warning("Official Spotify API fetch failed (%s), falling back to embed", e)

            # 2. Keyless Embed HTML extraction
            return await self._fetch_playlist_embed(client, clean_id, cache_key)

    async def _fetch_playlist_embed(
        self, client: httpx.AsyncClient, clean_id: str, cache_key: str
    ) -> Playlist:
        embed_url = f"https://open.spotify.com/embed/playlist/{clean_id}"
        res = await client.get(embed_url)
        if res.status_code == 404:
            raise ProviderNotFound(f"Spotify playlist not found: {clean_id}", provider="spotify")
        if res.status_code != 200:
            raise ProviderError(
                f"Spotify returned status {res.status_code}",
                provider="spotify",
                status_code=res.status_code,
            )

        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', res.text, re.DOTALL)
        if not match:
            raise ProviderError("Failed to extract playlist metadata from Spotify embed", provider="spotify")

        try:
            payload = json.loads(match.group(1))
            entity = payload["props"]["pageProps"]["state"]["data"]["entity"]
        except (json.JSONDecodeError, KeyError) as e:
            raise ProviderError(f"Malformed Spotify embed data structure: {e}", provider="spotify")

        title = entity.get("title") or entity.get("name") or "Spotify Playlist"
        subtitle = entity.get("subtitle") or ""
        authors = entity.get("authors") or []
        owner_name = authors[0].get("name") if authors else subtitle or "Spotify"

        # Artwork
        cover_sources = entity.get("coverArt", {}).get("sources", [])
        artwork_url = cover_sources[0].get("url") if cover_sources else ""

        # Parse songs
        raw_tracks = entity.get("trackList", [])
        songs: list[Song] = []

        for idx, item in enumerate(raw_tracks):
            track_uri = item.get("uri") or ""
            track_id = track_uri.split(":")[-1] if track_uri else item.get("uid") or f"sp_{idx}"
            track_title = (item.get("title") or "Unknown Track").strip()
            artist_str = (item.get("subtitle") or "Unknown Artist").strip()

            # Split artists if comma-separated
            artist_names = [a.strip() for a in re.split(r",|&", artist_str) if a.strip()]
            artists = [
                ArtistRef(
                    id=f"spotify:artist:{name.lower().replace(' ', '_')}",
                    provider="spotify",
                    provider_id=name.lower().replace(" ", "_"),
                    name=name,
                    role="primary",
                )
                for name in (artist_names or [artist_str])
            ]

            duration_ms = item.get("duration")
            is_explicit = bool(item.get("isExplicit"))

            song = Song(
                id=f"spotify:{track_id}",
                provider="spotify",
                provider_id=track_id,
                title=track_title,
                artists=artists,
                featured_artists=[],
                album=title,
                album_id=f"spotify:playlist:{clean_id}",
                duration_ms=duration_ms,
                artwork_url=artwork_url,
                has_media=True,
                is_explicit=is_explicit,
                perma_url=f"https://open.spotify.com/track/{track_id}" if track_id else None,
            )
            songs.append(song)

            # Pre-populate song cache for fast stream resolution upon playback
            if self._cache:
                await self._cache.set(f"spotify:song:{track_id}", song, ttl=86400)

        # Enrich individual tracks with true album artwork and real album names
        token = await self._get_app_token(client)
        sem = asyncio.Semaphore(10)

        async def _enrich_track(s: Song):
            clean_tid = s.provider_id
            if not _SPOTIFY_ID_RE.match(clean_tid):
                return

            if self._cache:
                cached_song, status = await self._cache.get(f"spotify:song:{clean_tid}")
                if status == "hit" and cached_song is not None and cached_song.artwork_url and cached_song.artwork_url != artwork_url:
                    s.artwork_url = cached_song.artwork_url
                    if cached_song.album and cached_song.album != title:
                        s.album = cached_song.album
                    return

            async with sem:
                # 1. Try official API with token
                if token:
                    try:
                        res = await client.get(
                            f"https://api.spotify.com/v1/tracks/{clean_tid}",
                            headers={"Authorization": f"Bearer {token}"},
                        )
                        if res.status_code == 200:
                            tdata = res.json()
                            album_info = tdata.get("album", {})
                            images = album_info.get("images", [])
                            if images:
                                s.artwork_url = images[0].get("url")
                            if album_info.get("name"):
                                s.album = album_info.get("name")
                            if self._cache:
                                await self._cache.set(f"spotify:song:{clean_tid}", s, ttl=86400)
                            return
                    except Exception as ex:
                        logger.debug("Official track enrichment failed for %s: %s", clean_tid, ex)

                # 2. Keyless embed fallback for individual track
                try:
                    res = await client.get(f"https://open.spotify.com/embed/track/{clean_tid}")
                    if res.status_code == 200:
                        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', res.text, re.DOTALL)
                        if match:
                            payload = json.loads(match.group(1))
                            tent = payload.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
                            images = tent.get("visualIdentity", {}).get("image", [])
                            if images:
                                s.artwork_url = images[-1].get("url") or images[0].get("url")
                            if self._cache:
                                await self._cache.set(f"spotify:song:{clean_tid}", s, ttl=86400)
                except Exception as ex:
                    logger.debug("Keyless track enrichment failed for %s: %s", clean_tid, ex)

        if songs:
            await asyncio.gather(*(_enrich_track(s) for s in songs), return_exceptions=True)

        playlist = Playlist(
            id=f"spotify:{clean_id}",
            provider="spotify",
            provider_id=clean_id,
            title=title,
            artwork_url=artwork_url,
            follower_count=None,
            song_count=len(songs),
            last_updated=None,
            owner=owner_name,
            perma_url=f"https://open.spotify.com/playlist/{clean_id}",
            songs=songs,
        )

        if self._cache:
            await self._cache.set(cache_key, playlist, ttl=settings.CACHE_TTL_PLAYLIST)

        return playlist

    async def _fetch_playlist_official(
        self, client: httpx.AsyncClient, clean_id: str, token: str, cache_key: str
    ) -> Playlist:
        api_url = f"https://api.spotify.com/v1/playlists/{clean_id}"
        res = await client.get(api_url, headers={"Authorization": f"Bearer {token}"})
        if res.status_code == 404:
            raise ProviderNotFound(f"Spotify playlist not found: {clean_id}", provider="spotify")
        if res.status_code != 200:
            raise ProviderError(
                f"Spotify API returned {res.status_code}",
                provider="spotify",
                status_code=res.status_code,
            )

        data = res.json()
        title = data.get("name") or "Spotify Playlist"
        owner_name = data.get("owner", {}).get("display_name") or "Spotify"
        images = data.get("images") or []
        artwork_url = images[0].get("url") if images else ""

        tracks_page = data.get("tracks") or {}
        raw_items = list(tracks_page.get("items", [])) if isinstance(tracks_page, dict) else []

        # Paginate additional tracks if official API provides pagination
        next_url = tracks_page.get("next") if isinstance(tracks_page, dict) else None
        pages_fetched = 0
        while next_url and pages_fetched < 10:
            pages_fetched += 1
            try:
                p_res = await client.get(next_url, headers={"Authorization": f"Bearer {token}"})
                if p_res.status_code == 200:
                    p_data = p_res.json()
                    raw_items.extend(p_data.get("items", []))
                    next_url = p_data.get("next")
                else:
                    break
            except Exception:
                break

        songs: list[Song] = []

        for item in raw_items:
            track = item.get("track")
            if not track or not track.get("id"):
                continue

            track_id = track.get("id")
            track_title = (track.get("name") or "Unknown Track").strip()
            artists = [
                ArtistRef(
                    id=f"spotify:artist:{a.get('id', a.get('name', '').lower().replace(' ', '_'))}",
                    provider="spotify",
                    provider_id=a.get("id") or a.get("name", ""),
                    name=a.get("name", "Unknown Artist"),
                    role="primary",
                )
                for a in track.get("artists", [])
                if a.get("name")
            ]
            album_name = track.get("album", {}).get("name")
            album_images = track.get("album", {}).get("images", [])
            track_art = album_images[0].get("url") if album_images else artwork_url

            song = Song(
                id=f"spotify:{track_id}",
                provider="spotify",
                provider_id=track_id,
                title=track_title,
                artists=artists,
                featured_artists=[],
                album=album_name or title,
                album_id=None,
                duration_ms=track.get("duration_ms"),
                artwork_url=track_art,
                has_media=True,
                is_explicit=bool(track.get("explicit")),
                perma_url=f"https://open.spotify.com/track/{track_id}",
            )
            songs.append(song)

            if self._cache:
                await self._cache.set(f"spotify:song:{track_id}", song, ttl=86400)

        if not songs:
            raise ProviderError(
                f"Official Spotify API returned 0 playable tracks for playlist {clean_id}",
                provider="spotify",
            )

        playlist = Playlist(
            id=f"spotify:{clean_id}",
            provider="spotify",
            provider_id=clean_id,
            title=title,
            artwork_url=artwork_url,
            follower_count=data.get("followers", {}).get("total"),
            song_count=len(songs),
            last_updated=None,
            owner=owner_name,
            perma_url=f"https://open.spotify.com/playlist/{clean_id}",
            songs=songs,
        )

        if self._cache:
            await self._cache.set(cache_key, playlist, ttl=settings.CACHE_TTL_PLAYLIST)

        return playlist

    # ── URL Resolution ───────────────────────────────────────────────────────

    async def resolve_url(self, url: str) -> Playlist:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()

        if hostname not in settings.SPOTIFY_ALLOWED_HOSTS:
            raise ProviderInvalidRequest(
                f"Spotify URL hostname not in allowlist: {hostname!r}",
                provider="spotify",
            )

        # Handle spotify.link shortlinks
        target_url = url
        if hostname == "spotify.link":
            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                res = await client.head(url)
                target_url = str(res.url)

        match = _PLAYLIST_URL_RE.search(target_url) or _SPOTIFY_URI_RE.search(target_url)
        if match:
            return await self.get_playlist(match.group(1))

        raise ProviderNotFound(f"Cannot resolve Spotify playlist URL: {url}", provider="spotify")

    # ── Stubs for MusicProvider interface ────────────────────────────────────

    async def search(self, query: str, *, n: int = 20, page: int = 1) -> SearchResults:
        return SearchResults(
            query=query,
            songs=[],
            albums=[],
            artists=[],
            playlists=[],
            total_songs=0,
            total_albums=0,
            total_artists=0,
            total_playlists=0,
        )

    async def get_song(self, song_id: str) -> Song:
        clean_id = _sanitize_spotify_id(song_id)
        if ":" in clean_id:
            clean_id = clean_id.split(":")[-1]

        if not _SPOTIFY_ID_RE.match(clean_id):
            raise ProviderInvalidRequest(
                f"Invalid Spotify song ID format: {song_id!r}",
                provider="spotify",
            )

        if self._cache:
            val, status = await self._cache.get(f"spotify:song:{clean_id}")
            if status == "hit" and val is not None:
                return val

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        }

        async with httpx.AsyncClient(timeout=10.0, headers=headers) as client:
            # 1. Try official API if credentials/token available
            token = await self._get_app_token(client)
            if token:
                try:
                    res = await client.get(
                        f"https://api.spotify.com/v1/tracks/{clean_id}",
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    if res.status_code == 200:
                        data = res.json()
                        title = data.get("name") or "Unknown Title"
                        artists = [
                            ArtistRef(
                                id=f"spotify:artist:{a.get('id', '')}",
                                provider="spotify",
                                provider_id=a.get("id", ""),
                                name=a.get("name", "Unknown Artist"),
                                role="primary",
                            )
                            for a in data.get("artists", [])
                        ]
                        images = data.get("album", {}).get("images") or []
                        artwork_url = images[0].get("url") if images else ""
                        duration_ms = data.get("duration_ms")
                        is_explicit = bool(data.get("explicit"))
                        album_name = data.get("album", {}).get("name")

                        song = Song(
                            id=f"spotify:{clean_id}",
                            provider="spotify",
                            provider_id=clean_id,
                            title=title,
                            artists=artists,
                            featured_artists=[],
                            album=album_name,
                            album_id=f"spotify:album:{data.get('album', {}).get('id', '')}",
                            duration_ms=duration_ms,
                            artwork_url=artwork_url,
                            has_media=True,
                            is_explicit=is_explicit,
                            perma_url=f"https://open.spotify.com/track/{clean_id}",
                        )
                        if self._cache:
                            await self._cache.set(f"spotify:song:{clean_id}", song, ttl=86400)
                        return song
                except Exception as e:
                    logger.warning("Spotify official API track fetch failed: %s", e)

            # 2. Fall back to embed scrape
            try:
                embed_url = f"https://open.spotify.com/embed/track/{clean_id}"
                res = await client.get(embed_url)
                if res.status_code == 200:
                    html = res.text
                    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
                    if match:
                        payload = json.loads(match.group(1))
                        entity = payload.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
                        title = entity.get("title") or entity.get("name") or "Unknown Track"
                        artist_names = [a.get("name") for a in entity.get("artists", []) if a.get("name")]
                        artists = [
                            ArtistRef(
                                id=f"spotify:artist:{name.lower().replace(' ', '_')}",
                                provider="spotify",
                                provider_id=name.lower().replace(" ", "_"),
                                name=name,
                                role="primary",
                            )
                            for name in (artist_names or ["Unknown Artist"])
                        ]
                        images = entity.get("coverArt", {}).get("sources", [])
                        artwork_url = images[0].get("url") if images else ""
                        duration_ms = entity.get("duration")

                        song = Song(
                            id=f"spotify:{clean_id}",
                            provider="spotify",
                            provider_id=clean_id,
                            title=title,
                            artists=artists,
                            featured_artists=[],
                            duration_ms=duration_ms,
                            artwork_url=artwork_url,
                            has_media=True,
                        )
                        if self._cache:
                            await self._cache.set(f"spotify:song:{clean_id}", song, ttl=86400)
                        return song
            except Exception as e:
                logger.warning("Spotify embed track fetch failed: %s", e)

        raise ProviderNotFound(f"Spotify song not found: {song_id}", provider="spotify")

    async def get_songs(self, song_ids: list[str]) -> list[Song]:
        songs: list[Song] = []
        for sid in song_ids:
            try:
                songs.append(await self.get_song(sid))
            except Exception:
                pass
        return songs

    async def get_album(self, album_id: str) -> Album:
        raise ProviderNotFound("Spotify albums not implemented", provider="spotify")

    async def get_artist(self, artist_id: str) -> Artist:
        raise ProviderNotFound("Spotify artists not implemented", provider="spotify")

    async def get_artist_songs(self, artist_id: str, *, page: int = 0, n: int = 50) -> list[Song]:
        return []

    async def get_artist_albums(self, artist_id: str, *, page: int = 0, n: int = 50) -> list[Album]:
        return []

    async def resolve_media(self, song: Song) -> MediaInfo:
        raise ProviderNotFound("Spotify does not provide direct media streams", provider="spotify")

    async def get_lyrics(self, lyrics_id: str) -> Lyrics:
        return Lyrics(id=lyrics_id, provider="spotify", provider_id=lyrics_id, plain=None, synced=None)

    async def health_check(self) -> dict:
        return {"status": "ok", "provider": "spotify"}
