"""
Songs router — GET /api/v1/songs
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Query, Request

from app.config import settings
from app.core.errors import ProviderInvalidRequest, ProviderNotFound
from app.models import APIResponse, Song

router = APIRouter(prefix="/songs", tags=["Songs"])

# JioSaavn song IDs: alphanumeric + underscore/hyphen, 4-30 chars
_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{2,30}$")


def _validate_id(song_id: str) -> str:
    sid = song_id.strip()
    if ":" in sid:
        sid = sid.split(":", 1)[1]
    if not _ID_RE.match(sid):
        raise ProviderInvalidRequest(f"Invalid song ID format: {sid!r}", provider="saavn")
    return sid


async def _resolve_or_search_song(provider, song_id: str):
    sid = song_id.strip()
    is_yt = sid.startswith("youtube:") or sid.startswith("yt:")
    validated = _validate_id(sid)
    target_id = f"youtube:{validated}" if is_yt else validated
    try:
        return await provider.get_song(target_id)
    except ProviderNotFound:
        # Fallback: search query if not found by exact ID
        clean_query = sid.replace("_", " ").replace("-", " ").strip()
        if clean_query:
            try:
                res = await provider.search(clean_query, n=1)
                if res.songs:
                    return await provider.get_song(res.songs[0].id)
            except Exception:
                pass
        raise


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
async def get_media(request: Request, song_id: str):
    """
    Attempt to resolve streaming/download URLs for a song.

    Returns MediaInfo with streams if available, or null data if unavailable.
    Media URLs have short TTL — do not cache on the client side for long.
    """
    provider = request.app.state.provider
    sid = song_id.strip()
    try:
        song = await _resolve_or_search_song(provider, sid)
    except Exception:
        if sid.startswith("youtube:") or sid.startswith("yt:"):
            vid = _validate_id(sid)
            song = Song(
                id=f"youtube:{vid}",
                provider="youtube",
                provider_id=vid,
                title="",
                artists=[],
                featured_artists=[],
                has_media=True,
            )
        else:
            raise
    media = await provider.resolve_media(song)
    return APIResponse(
        success=True,
        data=media.model_dump() if media else None,
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
