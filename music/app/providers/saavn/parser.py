"""
JioSaavn response parser.

Converts raw JioSaavn JSON dicts into validated intermediate structures.

Strategy:
  1. Validate response (is it a dict/list? does it have required fields?)
  2. Extract fields defensively (tolerate missing optional fields)
  3. Detect schema-breaking changes (required identity fields gone)
  4. Never use fragile .split() or regex on HTML when structured JSON exists

Raises ProviderSchemaChanged if required identity fields are absent.
Raises ProviderBadResponse if the top-level structure is wrong.

Does NOT raise for missing optional fields — uses None/defaults.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any

from app.core.errors import ProviderBadResponse, ProviderSchemaChanged

logger = logging.getLogger(__name__)

PROVIDER = "saavn"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _html_clean(text: str | None) -> str | None:
    """Unescape HTML entities and convert break tags to newlines."""
    if not text:
        return None
    return (
        text.replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("&quot;", '"')
        .replace("&amp;", "&")
        .replace("&#039;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )


def _str_bool(val: Any) -> bool:
    """Convert JioSaavn's string booleans ('true'/'false') to Python bool."""
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() == "true"


# Matches exactly ONE resolution token in the *last* path segment of a JioSaavn CDN URL.
# Anchor to forward-slash boundary so we only replace the image-size segment, not any
# resolution-like substring that may appear in the query string or host.
_HI_RES_RE = re.compile(r"(?<=/)(\d+x\d+)(?=/|$|\?)")


def _hi_res_image(url: str | None) -> str | None:
    """Replace the first (and typically only) resolution token in the URL with 500x500."""
    if not url:
        return None
    # Replace first match only to be safe; JioSaavn CDN URLs have exactly one such token.
    result, count = _HI_RES_RE.subn("500x500", url, count=1)
    if not count:
        # Fallback: try the original broad substitution so we don't silently lose the upgrade.
        result = re.sub(r"\d+x\d+", "500x500", url, count=1)
    return result


def _parse_duration_ms(duration_str: str | None) -> int | None:
    """JioSaavn returns duration in seconds (as string). Convert to ms."""
    if not duration_str:
        return None
    try:
        val = float(duration_str)
        if math.isinf(val) or math.isnan(val) or val < 0:
            return None
        return round(val * 1000)
    except (ValueError, TypeError, OverflowError):
        return None


def _safe_int(val: Any) -> int | None:
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _extract_artists(raw: dict, more_info: dict, artist_type: str = "primary") -> list[dict]:
    """
    Extract artists tolerating both structured mobile/v4 format and classic web format.
    Structured: more_info.artistMap.primary_artists = list[dict]
    Classic: primary_artists = "Name1, Name2", primary_artists_id = "id1, id2",
             artistMap = {"Name1": "id1", ...}
    """
    artist_map = more_info.get("artistMap") or raw.get("artistMap") or {}
    key = f"{artist_type}_artists"
    if isinstance(artist_map, dict) and isinstance(artist_map.get(key), list):
        parsed = _parse_artist_list(artist_map[key])
        if parsed:
            return parsed

    names_str = raw.get(key) or more_info.get(key)
    ids_str = raw.get(f"{key}_id") or more_info.get(f"{key}_id")

    if not names_str and artist_type == "primary":
        names_str = raw.get("singers") or more_info.get("singers")

    if not names_str:
        return []

    names = [n.strip() for n in str(names_str).split(",") if n.strip()]
    ids = [i.strip() for i in str(ids_str).split(",") if i.strip()] if ids_str else []

    results = []
    for idx, name in enumerate(names):
        aid = ""
        if idx < len(ids):
            aid = ids[idx]
        elif isinstance(artist_map, dict) and name in artist_map and isinstance(artist_map[name], str):
            aid = artist_map[name]

        if not aid:
            # No real upstream ID — skip rather than synthesise a collision-prone fallback.
            # Synthesised IDs like "a_r_rahman" can collide across distinct artists and
            # pollute caches that key on provider_id.
            logger.debug("Skipping artist %r — no upstream ID available", name)
            continue

        results.append({
            "id": aid,
            "name": _html_clean(name) or name,
            "role": artist_type,
            "image": None,
            "perma_url": None,
        })
    return results


# ── Song parser ───────────────────────────────────────────────────────────────

def parse_song_raw(raw: dict) -> dict:
    """
    Parse a raw JioSaavn song dict into a clean intermediate dict.

    Required field: 'id' (raises ProviderSchemaChanged if absent)
    """
    if not isinstance(raw, dict):
        raise ProviderBadResponse("Song is not a dict", provider=PROVIDER)

    song_id = raw.get("id")
    if not song_id:
        raise ProviderSchemaChanged(
            "Song response missing required 'id' field — schema may have changed",
            provider=PROVIDER,
        )

    more_info: dict = raw.get("more_info") or {}

    primary_artists = _extract_artists(raw, more_info, "primary")
    featured_artists = _extract_artists(raw, more_info, "featured")

    has_lyrics = _str_bool(
        raw.get("has_lyrics") or more_info.get("has_lyrics", False)
    )
    lyrics_id = (more_info.get("lyrics_id") or raw.get("lyrics_id") or song_id) if has_lyrics else None

    encrypted_url = raw.get("encrypted_media_url") or raw.get("media_url") or ""

    return {
        "id": song_id,
        "title": _html_clean(raw.get("song") or raw.get("title")) or "",
        "album": _html_clean(raw.get("album")),
        "album_id": raw.get("albumid") or raw.get("album_id") or more_info.get("album_id"),
        "year": raw.get("year"),
        "duration_ms": _parse_duration_ms(raw.get("duration")),
        "language": raw.get("language") or more_info.get("language"),
        "has_lyrics": has_lyrics,
        "lyrics_id": lyrics_id,
        "lyrics_snippet": _html_clean(raw.get("lyrics_snippet") or more_info.get("lyrics_snippet")),
        "image": _hi_res_image(raw.get("image")),
        "perma_url": raw.get("perma_url"),
        "release_date": more_info.get("release_date"),
        "label": _html_clean(raw.get("label")),
        "copyright_text": _html_clean(raw.get("copyright_text")),
        "is_320kbps": _str_bool(raw.get("320kbps", False)),
        "has_media": bool(encrypted_url),
        "encrypted_media_url": encrypted_url,
        "primary_artists": primary_artists,
        "featured_artists": featured_artists,
    }


def parse_songs_response(raw: Any) -> list[dict]:
    """
    Parse the response from song.getDetails.

    JioSaavn returns a dict keyed by song ID when multiple songs
    are requested, or a list, or a dict with a 'songs' key.
    Handles all known shapes.
    """
    if raw is None:
        return []

    # Shape: {"song_id": {...}, ...} — multi-song dict response
    if isinstance(raw, dict):
        # Some responses wrap in a "songs" key
        if "songs" in raw:
            items = raw["songs"]
            if isinstance(items, list):
                return [parse_song_raw(s) for s in items if isinstance(s, dict)]
            if isinstance(items, dict):
                return [parse_song_raw(v) for v in items.values() if isinstance(v, dict)]

        # Single song wrapped in dict
        if "id" in raw:
            return [parse_song_raw(raw)]

        # Dict of song_id → song_dict
        results = []
        for v in raw.values():
            if isinstance(v, dict) and "id" in v:
                try:
                    results.append(parse_song_raw(v))
                except (ProviderBadResponse, ProviderSchemaChanged):
                    logger.warning("Skipping malformed song in batch response")
        return results

    if isinstance(raw, list):
        results = []
        for item in raw:
            if isinstance(item, dict):
                try:
                    results.append(parse_song_raw(item))
                except (ProviderBadResponse, ProviderSchemaChanged):
                    logger.warning("Skipping malformed song in list")
        return results

    raise ProviderBadResponse(
        f"Unexpected songs response type: {type(raw).__name__}",
        provider=PROVIDER,
    )


# ── Artist list parser ────────────────────────────────────────────────────────

def _parse_artist_list(raw_list: list) -> list[dict]:
    results = []
    for a in raw_list:
        if not isinstance(a, dict):
            continue
        artist_id = a.get("id")
        if not artist_id:
            continue
        results.append({
            "id": artist_id,
            "name": _html_clean(a.get("name", "")) or "",
            "role": a.get("role"),
            "image": _hi_res_image(a.get("image")),
            "perma_url": a.get("perma_url"),
        })
    return results


# ── Album parser ──────────────────────────────────────────────────────────────

def parse_album_raw(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ProviderBadResponse("Album is not a dict", provider=PROVIDER)

    album_id = raw.get("albumid") or raw.get("id")
    if not album_id:
        raise ProviderSchemaChanged(
            "Album missing required ID field — schema may have changed",
            provider=PROVIDER,
        )

    songs_raw = raw.get("songs") or raw.get("list") or []
    songs = []
    for s in songs_raw:
        if isinstance(s, dict):
            try:
                songs.append(parse_song_raw(s))
            except (ProviderBadResponse, ProviderSchemaChanged) as e:
                logger.warning("Skipping malformed album track: %s", e)

    return {
        "id": album_id,
        "title": _html_clean(raw.get("title") or raw.get("name") or raw.get("album") or "") or "",
        "year": raw.get("year"),
        "language": raw.get("language"),
        "image": _hi_res_image(raw.get("image")),
        "perma_url": raw.get("perma_url"),
        "primary_artists": _html_clean(raw.get("primary_artists")),
        "primary_artists_id": raw.get("primary_artists_id"),
        "song_count": _safe_int(raw.get("list_count")) or len(songs),
        "songs": songs,
    }


# ── Playlist parser ───────────────────────────────────────────────────────────

def parse_playlist_raw(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ProviderBadResponse("Playlist is not a dict", provider=PROVIDER)

    playlist_id = raw.get("listid") or raw.get("id")
    if not playlist_id:
        raise ProviderSchemaChanged(
            "Playlist missing required ID field — schema may have changed",
            provider=PROVIDER,
        )

    songs_raw = raw.get("songs") or raw.get("list") or []
    songs = []
    for s in songs_raw:
        if isinstance(s, dict):
            try:
                songs.append(parse_song_raw(s))
            except (ProviderBadResponse, ProviderSchemaChanged) as e:
                logger.warning("Skipping malformed playlist track: %s", e)

    return {
        "id": playlist_id,
        "title": _html_clean(raw.get("listname") or raw.get("title") or raw.get("name") or "") or "",
        "image": _hi_res_image(raw.get("image")),
        "perma_url": raw.get("perma_url"),
        "follower_count": _safe_int(raw.get("follower_count")),
        "song_count": _safe_int(raw.get("list_count")) or len(songs),
        "last_updated": raw.get("last_updated"),
        "owner": raw.get("username") or raw.get("firstname"),
        "songs": songs,
    }


# ── Artist parser ─────────────────────────────────────────────────────────────

def parse_artist_raw(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ProviderBadResponse("Artist is not a dict", provider=PROVIDER)

    artist_id = raw.get("artistId") or raw.get("id")
    if not artist_id:
        raise ProviderSchemaChanged(
            "Artist missing required ID field — schema may have changed",
            provider=PROVIDER,
        )

    top_songs_raw = (raw.get("topSongs") or {}).get("songs") or []
    top_albums_raw = (raw.get("topAlbums") or {}).get("albums") or []
    singles_raw = (raw.get("singles") or {}).get("songs") or []

    return {
        "id": artist_id,
        "name": _html_clean(raw.get("name") or "") or "",
        "image": _hi_res_image(raw.get("image")),
        "follower_count": _safe_int(raw.get("follower_count")),
        "fan_count": _safe_int(raw.get("fan_count")),
        "bio": _html_clean(raw.get("bio")),
        "dob": raw.get("dob"),
        "fb": raw.get("fb"),
        "twitter": raw.get("twitter"),
        "wiki": raw.get("wiki"),
        "available_languages": raw.get("availableLanguages") or [],
        "top_songs_raw": [s for s in top_songs_raw if isinstance(s, dict)],
        "top_albums_raw": [a for a in top_albums_raw if isinstance(a, dict)],
        "singles_raw": [s for s in singles_raw if isinstance(s, dict)],
    }


# ── Lyrics parser ─────────────────────────────────────────────────────────────

def parse_lyrics_raw(raw: dict, lyrics_id: str) -> dict:
    if not isinstance(raw, dict):
        raise ProviderBadResponse("Lyrics is not a dict", provider=PROVIDER)

    return {
        "id": raw.get("id") or lyrics_id,
        "plain": _html_clean(raw.get("lyrics")),
        "snippet": _html_clean(raw.get("snippet")),
        "copyright_text": _html_clean(raw.get("lyrics_copyright")),
    }


# ── Search parser ─────────────────────────────────────────────────────────────

def parse_search_raw(raw: dict, query: str) -> dict:
    """Parse autocomplete.get response into structured search result dict."""
    if not isinstance(raw, dict):
        raise ProviderBadResponse("Search response is not a dict", provider=PROVIDER)

    def _items(section: str) -> list[dict]:
        section_data = raw.get(section) or {}
        if isinstance(section_data, dict):
            return [i for i in (section_data.get("data") or []) if isinstance(i, dict)]
        return []

    def _parse_item(item: dict, item_type: str) -> dict | None:
        item_id = item.get("id")
        if not item_id:
            return None
        title = _html_clean(
            item.get("title") or item.get("song") or
            item.get("name") or item.get("listname") or ""
        ) or ""
        subtitle = _html_clean(
            item.get("description") or
            item.get("primary_artists") or
            item.get("singers") or
            item.get("firstname")
        )
        more_info = item.get("more_info") or {}
        primary_artists = (
            more_info.get("primary_artists")
            or more_info.get("singers")
            or item.get("primary_artists")
            or item.get("singers")
        )
        album = item.get("album") or more_info.get("album")
        ctr = item.get("ctr") or more_info.get("ctr")

        extra = {}
        if album:
            extra["album"] = _html_clean(album)
        if primary_artists:
            extra["primary_artists"] = _html_clean(primary_artists)
        if ctr is not None:
            c = _safe_int(ctr)
            if c is not None:
                extra["ctr"] = c

        return {
            "id": item_id,
            "type": item.get("type") or item_type,
            "title": title,
            "subtitle": subtitle,
            "image": _hi_res_image(item.get("image")),
            "perma_url": item.get("perma_url"),
            "extra": extra,
        }

    songs = [r for i in _items("songs") if (r := _parse_item(i, "song"))]
    albums = [r for i in _items("albums") if (r := _parse_item(i, "album"))]
    artists = [r for i in _items("artists") if (r := _parse_item(i, "artist"))]
    playlists = [r for i in _items("playlists") if (r := _parse_item(i, "playlist"))]

    return {
        "query": query,
        "songs": songs,
        "albums": albums,
        "artists": artists,
        "playlists": playlists,
    }
