"""
Songs router — GET /api/v1/songs
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Query, Request

from app.config import settings
from app.core.errors import ProviderInvalidRequest, ProviderNotFound
from app.models import APIResponse, Song

router = APIRouter(prefix="/songs", tags=["Songs"])

# JioSaavn song IDs: alphanumeric + underscore/hyphen, 4-30 chars
_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{2,30}$")


def _validate_id(song_id: str) -> str:
    sid = song_id.strip()
    is_yt = sid.startswith("youtube:") or sid.startswith("yt:")
    is_sp = sid.startswith("spotify:") or sid.startswith("sp:")
    raw = sid
    while ":" in raw:
        raw = raw.split(":", 1)[1]
    if not _ID_RE.match(raw):
        raise ProviderInvalidRequest(f"Invalid song ID format: {sid!r}", provider="saavn")
    if is_yt:
        return f"youtube:{raw}"
    if is_sp:
        return f"spotify:{raw}"
    return raw


async def _resolve_or_search_song(provider, song_id: str):
    sid = song_id.strip()
    target_id = _validate_id(sid)
    try:
        return await provider.get_song(target_id)
    except ProviderNotFound as err:
        # Fallback: search query if not found by exact ID
        clean_query = target_id.replace("youtube:", "").replace("_", " ").replace("-", " ").strip()
        if clean_query:
            try:
                res = await provider.search(clean_query, n=1)
                if res.songs:
                    return await provider.get_song(res.songs[0].id)
            except Exception:
                pass
        raise err


async def get_song_by_id(song_id: str, provider=None) -> Song | None:
    """Helper to look up a song by ID using the provider."""
    if not provider:
        return None
    try:
        return await _resolve_or_search_song(provider, song_id)
    except Exception:
        return None


@router.get("", response_model=APIResponse, summary="Get song(s) by ID or URL")
async def get_songs(
    request: Request,
    id: str | None = Query(None, description="Song ID or comma-separated IDs (max 20)"),
    link: str | None = Query(None, max_length=2048, description="JioSaavn song URL"),
):
    """
    Retrieve song metadata.

    Supply either `id` (single or comma-separated, max 20) or `link` (JioSaavn URL).

    Media URLs are NOT included. Use GET /api/v1/songs/{id}/media for streaming links.
    """
    provider = request.app.state.provider

    if link:
        song = await provider.resolve_url(link)
        return APIResponse(success=True, data=song.model_dump())

    if not id:
        raise ProviderInvalidRequest("Supply either 'id' or 'link'", provider="saavn")

    raw_ids = [i.strip() for i in id.split(",") if i.strip()]
    if not raw_ids:
        raise ProviderInvalidRequest("No valid IDs provided", provider="saavn")
    if len(raw_ids) > settings.BULK_IDS_MAX:
        raise ProviderInvalidRequest(
            f"Too many IDs (max {settings.BULK_IDS_MAX})", provider="saavn"
        )

    validated = [_validate_id(sid) for sid in raw_ids]

    if len(validated) == 1:
        song = await provider.get_song(validated[0])
        return APIResponse(success=True, data=song.model_dump())

    songs = await provider.get_songs(validated)
    return APIResponse(success=True, data=[s.model_dump() for s in songs])


@router.get("/{song_id}", response_model=APIResponse, summary="Get song by ID")
async def get_song(request: Request, song_id: str):
    provider = request.app.state.provider
    song = await _resolve_or_search_song(provider, song_id)
    return APIResponse(success=True, data=song.model_dump())


@router.get("/{song_id}/media", response_model=APIResponse, summary="Resolve media streams")
async def get_media(
    request: Request,
    song_id: str,
    title: Optional[str] = Query(None),
    artist: Optional[str] = Query(None),
):
    """
    Attempt to resolve streaming/download URLs for a song.

    Returns MediaInfo with streams if available, or null data if unavailable.
    Media URLs have short TTL — do not cache on the client side for long.
    """
    provider = request.app.state.provider
    sid = song_id.strip()
    target_id = _validate_id(sid)

    # Fast path 1: YouTube streams only need the video ID (bypass redundant ytmusicapi get_song)
    if target_id.startswith("youtube:"):
        raw_vid = target_id.split(":", 1)[1]
        song = Song(
            id=target_id,
            provider="youtube",
            provider_id=raw_vid,
            title=title or "",
            artists=[],
            featured_artists=[],
            has_media=True,
        )
        media = await provider.resolve_media(song)
        return APIResponse(
            success=True,
            data=media.model_dump() if media else None,
        )

    # Fast path 2: Spotify track media resolution via YouTube audio bridge
    is_spotify = target_id.startswith("spotify:") or bool(re.match(r"^[A-Za-z0-9]{22}$", target_id))
    if is_spotify:
        raw_sp_id = target_id.split(":", 1)[1] if ":" in target_id else target_id
        cache = getattr(provider, "_cache", None) or getattr(getattr(provider, "saavn", None), "_cache", None)
        if cache:
            cached_media, status = await cache.get(f"spotify:media:{raw_sp_id}", stale_ok=False)
            if cached_media:
                return APIResponse(success=True, data=cached_media.model_dump())

        query = ""
        if title:
            query = f"{title} {artist or ''}".strip()

        if not query:
            cached_song = None
            spotify_prov = getattr(provider, "spotify", None)
            if spotify_prov:
                try:
                    cached_song = await spotify_prov.get_song(raw_sp_id)
                except Exception:
                    pass

            if cached_song:
                artist_str = ", ".join(a.name for a in cached_song.artists if a.name)
                query = f"{cached_song.title} {artist_str}".strip()
            else:
                query = raw_sp_id.replace("_", " ").replace("-", " ")

        yt_prov = getattr(provider, "youtube", None) or provider
        media = await yt_prov.resolve_by_query(query)
        if media and cache:
            await cache.set(f"spotify:media:{raw_sp_id}", media, ttl=settings.CACHE_TTL_MEDIA)

        return APIResponse(
            success=True,
            data=media.model_dump() if media else None,
        )

    # Fast path 3: Check provider cache for already resolved Saavn media
    clean_saavn_id = target_id.replace("saavn:", "")
    cache = getattr(provider, "_cache", None) or getattr(getattr(provider, "saavn", None), "_cache", None)
    if cache:
        cached_media, status = await cache.get(f"saavn:media:{clean_saavn_id}", stale_ok=False)
        if cached_media:
            return APIResponse(
                success=True,
                data=cached_media.model_dump(),
            )

    song = None
    try:
        song = await _resolve_or_search_song(provider, target_id)
        media = await provider.resolve_media(song)
        if media and media.streams:
            return APIResponse(
                success=True,
                data=media.model_dump(),
            )
    except Exception:
        pass

    # Resilient fallback: If song has title, resolve stream via YouTube query
    if title:
        yt_prov = getattr(provider, "youtube", None) or provider
        query = f"{title} {artist or ''}".strip()
        media = await yt_prov.resolve_by_query(query)
        if media and media.streams:
            return APIResponse(
                success=True,
                data=media.model_dump(),
            )

    return APIResponse(
        success=True,
        data=None,
    )


@router.get("/{song_id}/lyrics", response_model=APIResponse, summary="Get song lyrics via lyrics_id")
async def get_song_lyrics(request: Request, song_id: str):
    """
    Get lyrics for a song by its song_id.

    Fetches the song first to get lyrics_id, then fetches lyrics.
    If the song has no lyrics (has_lyrics=False), returns null data.
    """
    provider = request.app.state.provider
    song = await _resolve_or_search_song(provider, song_id)
    if not song.has_lyrics or not song.lyrics_id:
        return APIResponse(success=True, data=None)
    lyrics = await provider.get_lyrics(song.lyrics_id)
    return APIResponse(success=True, data=lyrics.model_dump())
