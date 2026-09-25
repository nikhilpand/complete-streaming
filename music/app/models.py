"""
Canonical data models for the SWAY MusicProvider interface.

Design principles:
  - Song metadata and media resolution are SEPARATE concerns.
  - Every model carries `provider` and `provider_id` for multi-provider support.
  - download_urls / streams are NEVER embedded in Song metadata.
  - All optional fields default to None rather than raising.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# ── Artist reference (lightweight, used inside Song / Album) ─────────────────

class ArtistRef(_Base):
    id: str
    provider: str
    provider_id: str
    name: str
    role: Optional[str] = None
    image_url: Optional[str] = None
    profile_url: Optional[str] = None


# ── Song ─────────────────────────────────────────────────────────────────────

class Song(_Base):
    """
    Canonical song model.

    Media delivery (streaming URLs, download links) is intentionally absent.
    Fetch MediaInfo separately via MediaResolver to avoid stale URL caching.
    """
    id: str
    provider: str
    provider_id: str
    title: str
    artists: list[ArtistRef] = Field(default_factory=list)
    featured_artists: list[ArtistRef] = Field(default_factory=list)
    album: Optional[str] = None
    album_id: Optional[str] = None
    duration_ms: Optional[int] = None        # None if unknown
    artwork_url: Optional[str] = None
    language: Optional[str] = None
    year: Optional[str] = None
    release_date: Optional[str] = None
    label: Optional[str] = None
    copyright_text: Optional[str] = None
    has_lyrics: bool = False
    lyrics_id: Optional[str] = None
    lyrics_snippet: Optional[str] = None
    has_media: bool = False                  # hint: media may be resolvable
    is_explicit: bool = False
    perma_url: Optional[str] = None


# ── Album ────────────────────────────────────────────────────────────────────

class Album(_Base):
    id: str
    provider: str
    provider_id: str
    title: str
    artists: Optional[str] = None
    artist_ids: Optional[str] = None
    year: Optional[str] = None
    language: Optional[str] = None
    artwork_url: Optional[str] = None
    song_count: int = 0
    perma_url: Optional[str] = None
    songs: list[Song] = Field(default_factory=list)


# ── Playlist ─────────────────────────────────────────────────────────────────

class Playlist(_Base):
    id: str
    provider: str
    provider_id: str
    title: str
    artwork_url: Optional[str] = None
    follower_count: Optional[int] = None
    song_count: int = 0
    last_updated: Optional[str] = None
    owner: Optional[str] = None
    perma_url: Optional[str] = None
    songs: list[Song] = Field(default_factory=list)


# ── Artist (full page) ───────────────────────────────────────────────────────

class Artist(_Base):
    id: str
    provider: str
    provider_id: str
    name: str
    image_url: Optional[str] = None
    follower_count: Optional[int] = None
    fan_count: Optional[int] = None
    bio: Optional[str] = None
    dob: Optional[str] = None
    fb: Optional[str] = None
    twitter: Optional[str] = None
    wiki: Optional[str] = None
    available_languages: list[str] = Field(default_factory=list)
    # Populated only when specifically requested
    top_songs: list[Song] = Field(default_factory=list)
    top_albums: list[Album] = Field(default_factory=list)
    singles: list[Song] = Field(default_factory=list)


# ── Lyrics ───────────────────────────────────────────────────────────────────

class Lyrics(_Base):
    id: str
    provider: str
    provider_id: str
    song_id: Optional[str] = None
    plain: Optional[str] = None          # full lyrics text, HTML-stripped
    synced: Optional[str] = None         # LRC or timestamped format if available
    snippet: Optional[str] = None
    copyright_text: Optional[str] = None


# ── Media delivery ───────────────────────────────────────────────────────────

class MediaStream(_Base):
    quality: str                          # "96kbps", "320kbps" etc.
    url: str
    mime_type: str = "audio/mp4"
    bitrate_kbps: int


class MediaInfo(_Base):
    """
    Resolved streaming/download information for a Song.

    NEVER cache MediaInfo with the same TTL as Song metadata.
    URLs expire at the CDN level independently of song data.
    """
    song_id: str
    provider: str
    streams: list[MediaStream] = Field(default_factory=list)
    resolved_at: datetime = Field(default_factory=datetime.utcnow)
    expires_hint: Optional[datetime] = None


# ── Search ───────────────────────────────────────────────────────────────────

class SearchItem(_Base):
    """Lightweight item in a search listing. No deep enrichment by default."""
    id: str
    provider: str
    provider_id: str
    type: str                             # "song", "album", "artist", "playlist"
    title: str
    subtitle: Optional[str] = None       # artist name, album name etc.
    artwork_url: Optional[str] = None
    perma_url: Optional[str] = None
    extra: dict = Field(default_factory=dict)  # type-specific extras


class SearchResults(_Base):
    query: str
    songs: list[SearchItem] = Field(default_factory=list)
    albums: list[SearchItem] = Field(default_factory=list)
    artists: list[SearchItem] = Field(default_factory=list)
    playlists: list[SearchItem] = Field(default_factory=list)
    total_songs: int = 0
    total_albums: int = 0
    total_artists: int = 0
    total_playlists: int = 0
    enriched_songs: list[Song] = Field(default_factory=list)


# ── API response envelope ─────────────────────────────────────────────────────

class APIResponse(_Base):
    success: bool = True
    data: object = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    request_id: Optional[str] = None
