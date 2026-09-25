"""
MusicProvider abstract base class — the SWAY provider interface.

SWAY music engine imports THIS, not any specific provider.

The engine is unaware of JioSaavn, YouTube, or any specific source.
Providers are interchangeable behind this interface.

Usage in SWAY:
    provider: MusicProvider = SaavnProvider(...)
    results = await provider.search("arijit singh")
    song    = await provider.get_song("some_id")
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import (
    Album,
    Artist,
    Lyrics,
    MediaInfo,
    Playlist,
    SearchResults,
    Song,
)


class MusicProvider(ABC):
    """
    Abstract music data provider.

    All provider implementations must implement every method.
    Methods should raise ProviderError subclasses on failure —
    never raw httpx or JSON exceptions.
    """

    provider_name: str = "unknown"

    # ── Search ───────────────────────────────────────────────────────────────

    @abstractmethod
    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        """
        Search for songs, albums, artists, playlists.

        Returns lightweight SearchResults without deep enrichment by default.
        When enrich=True, enriches up to a bounded number of top song results.
        """

    # ── Songs ────────────────────────────────────────────────────────────────

    @abstractmethod
    async def get_song(self, song_id: str) -> Song:
        """Fetch full metadata for a single song by provider ID."""

    @abstractmethod
    async def get_songs(self, song_ids: list[str]) -> list[Song]:
        """Fetch multiple songs. IDs must belong to this provider."""

    # ── Albums ───────────────────────────────────────────────────────────────

    @abstractmethod
    async def get_album(self, album_id: str) -> Album:
        """Fetch full album with tracklist."""

    # ── Playlists ────────────────────────────────────────────────────────────

    @abstractmethod
    async def get_playlist(self, playlist_id: str) -> Playlist:
        """Fetch full playlist with songs."""

    # ── Artists ──────────────────────────────────────────────────────────────

    @abstractmethod
    async def get_artist(self, artist_id: str) -> Artist:
        """Fetch artist page metadata (no songs/albums by default)."""

    @abstractmethod
    async def get_artist_songs(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Song]:
        """Paginated artist songs. Separate call to avoid hidden N+1."""

    @abstractmethod
    async def get_artist_albums(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Album]:
        """Paginated artist albums. Separate call to avoid hidden N+1."""

    # ── Lyrics ───────────────────────────────────────────────────────────────

    @abstractmethod
    async def get_lyrics(self, lyrics_id: str) -> Lyrics:
        """
        Fetch lyrics for the given lyrics_id.

        lyrics_id comes from Song.lyrics_id (only present when has_lyrics=True).
        Lyrics are NOT automatically fetched with Song metadata.
        """

    # ── Media ────────────────────────────────────────────────────────────────

    @abstractmethod
    async def resolve_media(self, song: Song) -> MediaInfo | None:
        """
        Attempt to resolve media streaming/download info.

        Returns None if media cannot be resolved through an authorized
        or observable mechanism.

        IMPORTANT: MediaInfo must NOT be cached with the same TTL
        as Song metadata. Media URLs expire independently.
        """

    # ── URL resolution ───────────────────────────────────────────────────────

    @abstractmethod
    async def resolve_url(self, url: str) -> Song | Album | Playlist | Artist:
        """
        Resolve a provider share URL to the appropriate resource.

        Implementors MUST validate the URL against an allowlist of
        provider hostnames before making any upstream request (SSRF guard).
        """

    # ── Health ───────────────────────────────────────────────────────────────

    @abstractmethod
    async def health_check(self) -> dict:
        """
        Non-blocking health probe.

        Must complete in < 2s. Must not make expensive upstream calls
        on every invocation (cache or rate-limit the probe).
        """
