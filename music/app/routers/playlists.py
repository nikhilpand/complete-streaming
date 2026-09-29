"""
Playlists router — GET /api/v1/playlists, POST /api/v1/playlists/import
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from app.core.errors import ProviderInvalidRequest
from app.models import APIResponse

router = APIRouter(prefix="/playlists", tags=["Playlists"])

_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


def _validate_id(playlist_id: str) -> str:
    pid = playlist_id.strip()
    is_spotify = pid.startswith("spotify:")
    is_youtube = pid.startswith("youtube:") or pid.startswith("yt:")
    raw = pid
    if ":" in raw:
        parts = raw.split(":")
        raw = parts[-1]
    if not _ID_RE.match(raw):
        raise ProviderInvalidRequest(f"Invalid playlist ID format: {pid!r}", provider="hybrid")
    if is_spotify:
        return f"spotify:{raw}"
    if is_youtube:
        return f"youtube:{raw}"
    return raw


class PlaylistImportRequest(BaseModel):
    url: str = Field(..., description="Spotify, YouTube, or JioSaavn playlist URL or URI")


@router.get("", response_model=APIResponse, summary="Get playlist by ID or URL")
async def get_playlist(
    request: Request,
    id: str | None = Query(None, description="Playlist ID"),
    link: str | None = Query(None, max_length=2048, description="Spotify, YouTube Music, or JioSaavn playlist URL"),
):
    """Retrieve playlist metadata with full song list from JioSaavn, YouTube, or Spotify."""
    provider = request.app.state.provider

    if link:
        playlist = await provider.resolve_url(link.strip())
        return APIResponse(success=True, data=playlist.model_dump())

    if not id:
        raise ProviderInvalidRequest("Supply either 'id' or 'link'", provider="hybrid")

    validated = _validate_id(id)
    playlist = await provider.get_playlist(validated)
    return APIResponse(success=True, data=playlist.model_dump())


@router.post("/import", response_model=APIResponse, summary="Import playlist from Spotify, YouTube, or JioSaavn URL")
async def import_playlist(request: Request, body: PlaylistImportRequest):
    """Import and resolve playlist metadata and tracklist from an external URL."""
    provider = request.app.state.provider
    url_str = body.url.strip()
    if not url_str:
        raise ProviderInvalidRequest("URL cannot be empty", provider="hybrid")
    playlist = await provider.resolve_url(url_str)
    return APIResponse(success=True, data=playlist.model_dump())


@router.get("/{playlist_id}", response_model=APIResponse, summary="Get playlist by ID")
async def get_playlist_by_id(request: Request, playlist_id: str):
    provider = request.app.state.provider
    validated = _validate_id(playlist_id)
    playlist = await provider.get_playlist(validated)
    return APIResponse(success=True, data=playlist.model_dump())
