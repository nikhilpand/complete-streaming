"""
Normaliser: Parser DTO → Canonical SWAY Models.

Pipeline:
    JioSaavn JSON
        ↓  (parser.py)
    Intermediate dict (provider-specific)
        ↓  (this file)
    Canonical SWAY Model (provider-agnostic)

If JioSaavn changes field names, only parser.py and this file change.
The router layer and SWAY engine see only canonical models.
"""

from __future__ import annotations

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

PROVIDER = "saavn"

# Quality suffix → (bitrate_kbps, label)
QUALITY_MAP: dict[str, tuple[int, str]] = {
    "_12": (12, "12kbps"),
    "_48": (48, "48kbps"),
    "_96": (96, "96kbps"),
    "_160": (160, "160kbps"),
    "_320": (320, "320kbps"),
}


# ── Artist reference ──────────────────────────────────────────────────────────

def norm_artist_ref(raw: dict) -> ArtistRef:
    return ArtistRef(
        id=f"{PROVIDER}:{raw['id']}",
        provider=PROVIDER,
        provider_id=raw["id"],
        name=raw["name"],
        role=raw.get("role"),
        image_url=raw.get("image"),
        profile_url=raw.get("perma_url"),
    )


# ── Song ──────────────────────────────────────────────────────────────────────

def norm_song(parsed: dict) -> Song:
    """Convert a parsed song dict into a canonical Song model."""
    primary = [norm_artist_ref(a) for a in parsed.get("primary_artists") or []]
    featured = [norm_artist_ref(a) for a in parsed.get("featured_artists") or []]

    return Song(
        id=f"{PROVIDER}:{parsed['id']}",
        provider=PROVIDER,
        provider_id=parsed["id"],
        title=parsed["title"],
        artists=primary,
        featured_artists=featured,
        album=parsed.get("album"),
        album_id=parsed.get("album_id"),
        duration_ms=parsed.get("duration_ms"),
        artwork_url=parsed.get("image"),
        language=parsed.get("language"),
        year=parsed.get("year"),
        release_date=parsed.get("release_date"),
        label=parsed.get("label"),
        copyright_text=parsed.get("copyright_text"),
        has_lyrics=parsed.get("has_lyrics", False),
        lyrics_id=parsed.get("lyrics_id"),
        lyrics_snippet=parsed.get("lyrics_snippet"),
        has_media=parsed.get("has_media", False),
        perma_url=parsed.get("perma_url"),
    )


# ── MediaInfo ─────────────────────────────────────────────────────────────────

def norm_media(parsed: dict) -> MediaInfo | None:
    """
    Build MediaInfo from a parsed song that has an encrypted_media_url.

    Returns None if no encrypted URL is available.

    The DES decryption is intentionally isolated here and in crypto.py.
    If the decryption mechanism changes, only these two files need updating.
    """
    from app.providers.saavn.crypto import build_streams

    encrypted = parsed.get("encrypted_media_url", "")
    if not encrypted:
        return None

    is_320 = parsed.get("is_320kbps", False)
    streams = build_streams(encrypted, has_320=is_320)
    if not streams:
        return None

    return MediaInfo(
        song_id=f"{PROVIDER}:{parsed['id']}",
        provider=PROVIDER,
        streams=streams,
    )


# ── Album ──────────────────────────────────────────────────────────────────────

def norm_album(parsed: dict) -> Album:
    songs = [norm_song(s) for s in parsed.get("songs") or []]

    return Album(
        id=f"{PROVIDER}:{parsed['id']}",
        provider=PROVIDER,
        provider_id=parsed["id"],
        title=parsed["title"],
        artists=parsed.get("primary_artists"),
        artist_ids=parsed.get("primary_artists_id"),
        year=parsed.get("year"),
        language=parsed.get("language"),
        artwork_url=parsed.get("image"),
        song_count=parsed.get("song_count") or len(songs),
        perma_url=parsed.get("perma_url"),
        songs=songs,
    )


# ── Playlist ──────────────────────────────────────────────────────────────────

def norm_playlist(parsed: dict) -> Playlist:
    songs = [norm_song(s) for s in parsed.get("songs") or []]

    return Playlist(
        id=f"{PROVIDER}:{parsed['id']}",
        provider=PROVIDER,
        provider_id=parsed["id"],
        title=parsed["title"],
        artwork_url=parsed.get("image"),
        follower_count=parsed.get("follower_count"),
        song_count=parsed.get("song_count") or len(songs),
        last_updated=parsed.get("last_updated"),
        owner=parsed.get("owner"),
        perma_url=parsed.get("perma_url"),
        songs=songs,
    )


# ── Artist ────────────────────────────────────────────────────────────────────

def norm_artist(parsed: dict) -> Artist:
    from app.providers.saavn.parser import parse_album_raw, parse_song_raw
    from app.core.errors import ProviderBadResponse, ProviderSchemaChanged
    import logging as _log
    _logger = _log.getLogger(__name__)

    top_songs: list = []
    for s in parsed.get("top_songs_raw") or []:
        try:
            top_songs.append(norm_song(parse_song_raw(s)))
        except (ProviderBadResponse, ProviderSchemaChanged) as exc:
            _logger.warning("Skipping malformed artist top_song: %s", exc)

    singles: list = []
    for s in parsed.get("singles_raw") or []:
        try:
            singles.append(norm_song(parse_song_raw(s)))
        except (ProviderBadResponse, ProviderSchemaChanged) as exc:
            _logger.warning("Skipping malformed artist single: %s", exc)

    top_albums: list = []
    for a in parsed.get("top_albums_raw") or []:
        try:
            top_albums.append(norm_album(parse_album_raw(a)))
        except (ProviderBadResponse, ProviderSchemaChanged) as exc:
            _logger.warning("Skipping malformed artist top_album: %s", exc)

    return Artist(
        id=f"{PROVIDER}:{parsed['id']}",
        provider=PROVIDER,
        provider_id=parsed["id"],
        name=parsed["name"],
        image_url=parsed.get("image"),
        follower_count=parsed.get("follower_count"),
        fan_count=parsed.get("fan_count"),
        bio=parsed.get("bio"),
        dob=parsed.get("dob"),
        fb=parsed.get("fb"),
        twitter=parsed.get("twitter"),
        wiki=parsed.get("wiki"),
        available_languages=parsed.get("available_languages") or [],
        top_songs=top_songs,
        top_albums=top_albums,
        singles=singles,
    )


# ── Lyrics ────────────────────────────────────────────────────────────────────

def norm_lyrics(parsed: dict, lyrics_id: str) -> Lyrics:
    return Lyrics(
        id=f"{PROVIDER}:{parsed['id']}",
        provider=PROVIDER,
        provider_id=parsed["id"],
        plain=parsed.get("plain"),
        synced=None,   # JioSaavn does not provide synced/LRC lyrics
        snippet=parsed.get("snippet"),
        copyright_text=parsed.get("copyright_text"),
    )


# ── Search ────────────────────────────────────────────────────────────────────

def norm_search(parsed: dict) -> SearchResults:
    def to_items(items: list[dict]) -> list[SearchItem]:
        result = []
        for i in items:
            if not i.get("id"):
                continue
            result.append(SearchItem(
                id=f"{PROVIDER}:{i['id']}",
                provider=PROVIDER,
                provider_id=i["id"],
                type=i.get("type", "song"),
                title=i.get("title", ""),
                subtitle=i.get("subtitle"),
                artwork_url=i.get("image"),
                perma_url=i.get("perma_url"),
                extra=i.get("extra") or {},
            ))
        return result

    songs = to_items(parsed.get("songs") or [])
    albums = to_items(parsed.get("albums") or [])
    artists = to_items(parsed.get("artists") or [])
    playlists = to_items(parsed.get("playlists") or [])

    return SearchResults(
        query=parsed["query"],
        songs=songs,
        albums=albums,
        artists=artists,
        playlists=playlists,
        total_songs=len(songs),
        total_albums=len(albums),
        total_artists=len(artists),
        total_playlists=len(playlists),
    )
