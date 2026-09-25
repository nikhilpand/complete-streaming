"""
JioSaavn internal API endpoint definitions.

All `__call` parameter values and their required/optional parameters.
Centralised here so that if JioSaavn changes an endpoint, only this
file needs updating.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# Universal parameters sent with every request.
# NOTE: We intentionally omit api_version=4 and ctx=web6dot0 because the
# v4 response format wraps data differently (album-like entities, nested
# 'list' fields). The classic format (without these params) is the one
# used by all major OSS JioSaavn wrappers and returns the familiar flat
# song/album/playlist dicts with encrypted_media_url, duration, etc.
BASE_PARAMS: dict[str, str] = {
    "_format": "json",
    "_marker": "0",
    "cc": "in",
}


@dataclass(frozen=True)
class Endpoint:
    call: str                            # value for __call=
    required: list[str] = field(default_factory=list)
    optional: list[str] = field(default_factory=list)
    description: str = ""


# ── Search ────────────────────────────────────────────────────────────────────

SEARCH_ALL = Endpoint(
    call="autocomplete.get",
    required=["query"],
    optional=["includeMetaTags"],
    description="Global search across songs, albums, artists, playlists",
)

SEARCH_SONGS = Endpoint(
    call="search.getResults",
    required=["q"],
    optional=["n", "p"],
    description="Song-specific search with pagination",
)

SEARCH_ALBUMS = Endpoint(
    call="search.getAlbumResults",
    required=["q"],
    optional=["n", "p"],
)

SEARCH_PLAYLISTS = Endpoint(
    call="search.getPlaylistResults",
    required=["q"],
    optional=["n", "p"],
)

SEARCH_ARTISTS = Endpoint(
    call="search.getArtistResults",
    required=["q"],
    optional=["n", "p"],
)

# ── Song ──────────────────────────────────────────────────────────────────────

SONG_DETAILS = Endpoint(
    call="song.getDetails",
    required=["pids"],    # comma-separated song IDs
    description="Song details by ID(s)",
)

# ── Album ─────────────────────────────────────────────────────────────────────

ALBUM_DETAILS = Endpoint(
    call="content.getAlbumDetails",
    required=["albumid"],
    description="Full album with tracklist",
)

# ── Playlist ──────────────────────────────────────────────────────────────────

PLAYLIST_DETAILS = Endpoint(
    call="playlist.getDetails",
    required=["listid"],
    description="Full playlist with songs",
)

# ── Artist ────────────────────────────────────────────────────────────────────

ARTIST_PAGE = Endpoint(
    call="artist.getArtistPageDetails",
    required=["artistId"],
    optional=["page", "n_song", "n_album", "sub_type", "category", "sort_order", "includeMetaTags"],
    description="Artist page with top songs, albums, singles",
)

# ── Lyrics ────────────────────────────────────────────────────────────────────

LYRICS = Endpoint(
    call="lyrics.getLyrics",
    required=["lyrics_id"],
    description="Full lyrics for a song",
)

# ── URL-based resolution ──────────────────────────────────────────────────────

WEBAPI_GET = Endpoint(
    call="webapi.get",
    required=["token", "type"],
    description="Resolve any JioSaavn share URL by path token",
)
