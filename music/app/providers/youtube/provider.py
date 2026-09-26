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


def _parse_yt_length_ms(length_str: Optional[str]) -> Optional[int]:
    if not length_str or not isinstance(length_str, str):
        return None
    try:
        parts = [int(p) for p in length_str.split(":")]
        if len(parts) == 2:
            return (parts[0] * 60 + parts[1]) * 1000
        elif len(parts) == 3:
            return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    except (ValueError, TypeError):
        pass
    return None


def _yt_item_to_canonical_song(item: dict) -> Optional[Song]:
    vid = item.get("videoId")
    if not vid:
        return None
    vid = _sanitize_id(vid)
    title = (item.get("title") or "YouTube Track").strip()

    artists_raw = item.get("artists") or []
    artists: list[ArtistRef] = []
    for a in artists_raw:
        if isinstance(a, dict):
            aname = a.get("name", "").strip()
            aid = a.get("id") or aname.lower().replace(" ", "_")
            if aname:
                artists.append(
                    ArtistRef(
                        id=f"youtube:artist:{aid}",
                        provider="youtube",
                        provider_id=str(aid),
                        name=aname,
                        role="primary",
                    )
                )
        elif isinstance(a, str) and a.strip():
            artists.append(
                ArtistRef(
                    id=f"youtube:artist:{a.strip().lower().replace(' ', '_')}",
                    provider="youtube",
                    provider_id=a.strip().lower().replace(" ", "_"),
                    name=a.strip(),
                    role="primary",
                )
            )
    if not artists:
        author = item.get("author") or "YouTube Music"
        artists = [
            ArtistRef(
                id=f"youtube:artist:{author.lower().replace(' ', '_')}",
                provider="youtube",
                provider_id=author.lower().replace(" ", "_"),
                name=author,
                role="primary",
            )
        ]

    duration_s = item.get("duration_seconds")
    if duration_s:
        duration_ms = int(duration_s) * 1000
    else:
        duration_ms = _parse_yt_length_ms(item.get("length"))

    thumbnails = item.get("thumbnails") or item.get("thumbnail") or []
    if isinstance(thumbnails, dict):
        thumbnails = [thumbnails]
    artwork = _best_thumbnail(thumbnails) or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

    album_dict = item.get("album")
    album_name = album_dict.get("name") if isinstance(album_dict, dict) else (album_dict or "YouTube Music")

    return Song(
        id=f"youtube:{vid}",
        provider="youtube",
        provider_id=vid,
        title=title,
        artists=artists,
        featured_artists=[],
        album=album_name,
        album_id=None,
        duration_ms=duration_ms,
        artwork_url=artwork,
        language=None,
        year=str(item.get("year")) if item.get("year") else None,
        release_date=None,
        label="YouTube Music",
        copyright_text=None,
        has_lyrics=False,
        lyrics_id=None,
        has_media=True,
        is_explicit=bool(item.get("isExplicit", False)),
        perma_url=f"https://music.youtube.com/watch?v={vid}",
    )



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
        def _fetch_songs():
            try:
                return self._get_yt().search(query, filter="songs") or []
            except Exception as e:
                logger.warning("ytmusicapi songs search error for %r: %s", query, e)
                return []

        def _fetch_general():
            try:
                return self._get_yt().search(query) or []
            except Exception as e:
                logger.debug("ytmusicapi general search error for %r: %s", query, e)
                return []

        songs_res, general_res = await asyncio.gather(
            asyncio.to_thread(_fetch_songs),
            asyncio.to_thread(_fetch_general),
            return_exceptions=True,
        )
        songs_raw = songs_res if isinstance(songs_res, list) else []
        general_raw = general_res if isinstance(general_res, list) else []
        songs: list[SearchItem] = []
        seen_vids: set[str] = set()

        raw_song_list = songs_raw if songs_raw else [item for item in general_raw if item.get("resultType") in ("song", "video")]

        for item in raw_song_list[:n]:
            video_id = item.get("videoId")
            if not video_id or video_id in seen_vids:
                continue
            seen_vids.add(video_id)

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
                        "album": (item.get("album") or {}).get("name") if isinstance(item.get("album"), dict) else item.get("album"),
                        "views": item.get("views"),
                    },
                )
            )

        artists_list: list[SearchItem] = []
        albums_list: list[SearchItem] = []
        seen_art_names: set[str] = set()
        seen_alb_names: set[str] = set()

        for item in general_raw:
            rtype = item.get("resultType")
            if rtype == "artist":
                aname = item.get("artist") or (item.get("artists") and item.get("artists")[0].get("name"))
                bid = item.get("browseId") or (item.get("artists") and item.get("artists")[0].get("id"))
                if aname and aname.strip().lower() not in seen_art_names:
                    seen_art_names.add(aname.strip().lower())
                    thumbnails = item.get("thumbnails", [])
                    art_img = _best_thumbnail(thumbnails) if thumbnails else ""
                    clean_id = str(bid or aname.strip().lower().replace(" ", "_"))
                    artists_list.append(
                        SearchItem(
                            id=f"youtube:artist:{clean_id}",
                            provider="youtube",
                            provider_id=clean_id,
                            type="artist",
                            title=aname.strip(),
                            subtitle="Artist",
                            artwork_url=art_img,
                            perma_url=f"https://music.youtube.com/channel/{bid}" if bid else "",
                            extra={"subscribers": item.get("subscribers")},
                        )
                    )
            elif rtype == "album":
                atitle = item.get("title")
                bid = item.get("browseId")
                if atitle and atitle.strip().lower() not in seen_alb_names:
                    seen_alb_names.add(atitle.strip().lower())
                    thumbnails = item.get("thumbnails", [])
                    alb_img = _best_thumbnail(thumbnails) if thumbnails else ""
                    artists = [a.get("name", "") for a in item.get("artists", []) if a.get("name")]
                    artist_str = ", ".join(artists) if artists else "YouTube Music"
                    clean_id = str(bid or atitle.strip().lower().replace(" ", "_"))
                    albums_list.append(
                        SearchItem(
                            id=f"youtube:album:{clean_id}",
                            provider="youtube",
                            provider_id=clean_id,
                            type="album",
                            title=atitle.strip(),
                            subtitle=artist_str,
                            artwork_url=alb_img,
                            perma_url=f"https://music.youtube.com/browse/{bid}" if bid else "",
                            extra={"year": item.get("year"), "type": item.get("type")},
                        )
                    )

        return SearchResults(
            query=query,
            songs=songs,
            albums=albums_list[:n],
            artists=artists_list[:n],
            playlists=[],
            total_songs=len(songs),
            total_albums=len(albums_list),
            total_artists=len(artists_list),
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

    # ── Candidate Discovery (YouTube Music Integration) ───────────────────────

    async def get_radio_candidates(self, video_id: str, limit: int = 20) -> list[Song]:
        """Fetch YouTube Music watch-next / radio tracks seeded by video ID."""
        vid = _sanitize_id(video_id)
        if not vid:
            return []

        def _fetch_radio():
            yt = self._get_yt()
            try:
                wp = yt.get_watch_playlist(videoId=vid, limit=min(50, limit * 2))
                return wp.get("tracks", []) if isinstance(wp, dict) else []
            except Exception as e:
                logger.debug("yt.get_watch_playlist error for %s: %s", vid, e)
                return []

        raw_tracks = await asyncio.to_thread(_fetch_radio)
        candidates: list[Song] = []
        for it in raw_tracks:
            # Skip the seed track itself
            if it.get("videoId") == vid:
                continue
            song = _yt_item_to_canonical_song(it)
            if song:
                candidates.append(song)
                if len(candidates) >= limit:
                    break
        return candidates

    async def get_related_candidates(self, video_id: str, limit: int = 20) -> list[Song]:
        """Fetch YouTube Music related content tracks seeded by video ID."""
        vid = _sanitize_id(video_id)
        if not vid:
            return []

        def _fetch_related():
            yt = self._get_yt()
            try:
                wp = yt.get_watch_playlist(videoId=vid, limit=5)
                rel_id = wp.get("related") if isinstance(wp, dict) else None
                if not rel_id:
                    return []
                rel_sections = yt.get_song_related(browseId=rel_id)
                tracks = []
                for sec in rel_sections:
                    contents = sec.get("contents", [])
                    for c in contents:
                        if c.get("videoId"):
                            tracks.append(c)
                return tracks
            except Exception as e:
                logger.debug("yt.get_song_related error for %s: %s", vid, e)
                return []

        raw_tracks = await asyncio.to_thread(_fetch_related)
        candidates: list[Song] = []
        for it in raw_tracks:
            if it.get("videoId") == vid:
                continue
            song = _yt_item_to_canonical_song(it)
            if song:
                candidates.append(song)
                if len(candidates) >= limit:
                    break
        return candidates

    async def get_artist_candidates(self, artist_name_or_id: str, limit: int = 20) -> list[Song]:
        """Fetch YouTube Music artist tracks / recommendations seeded by artist name or channel ID."""
        target = artist_name_or_id.strip()
        if not target:
            return []

        def _fetch_artist():
            yt = self._get_yt()
            try:
                if target.startswith("UC") and len(target) >= 20:
                    art = yt.get_artist(channelId=target)
                    songs = (art.get("songs") or {}).get("results", [])
                    if songs:
                        return songs
                return yt.search(f"{target} songs", filter="songs")[:limit]
            except Exception as e:
                logger.debug("yt.get_artist / search error for %s: %s", target, e)
                return []

        raw_tracks = await asyncio.to_thread(_fetch_artist)
        candidates: list[Song] = []
        for it in raw_tracks:
            song = _yt_item_to_canonical_song(it)
            if song:
                candidates.append(song)
                if len(candidates) >= limit:
                    break
        return candidates

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
