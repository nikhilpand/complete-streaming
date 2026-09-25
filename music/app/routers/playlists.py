"""
Playlists router — GET /api/v1/playlists
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Query, Request

from app.core.errors import ProviderInvalidRequest
from app.models import APIResponse

router = APIRouter(prefix="/playlists", tags=["Playlists"])

_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,30}$")


def _validate_id(playlist_id: str) -> str:
    pid = playlist_id.strip()
    if not _ID_RE.match(pid):
        raise ProviderInvalidRequest(f"Invalid playlist ID format: {pid!r}", provider="saavn")
    return pid


@router.get("", response_model=APIResponse, summary="Get playlist by ID or URL")
async def get_playlist(
    request: Request,
    id: str | None = Query(None, description="Playlist ID"),
    link: str | None = Query(None, max_length=2048, description="JioSaavn playlist URL"),
):
    """Retrieve playlist metadata with full song list."""
    provider = request.app.state.provider

    if link:
        playlist = await provider.resolve_url(link)
        return APIResponse(success=True, data=playlist.model_dump())

    if not id:
        raise ProviderInvalidRequest("Supply either 'id' or 'link'", provider="saavn")

    validated = _validate_id(id)
    playlist = await provider.get_playlist(validated)
    return APIResponse(success=True, data=playlist.model_dump())


@router.get("/{playlist_id}", response_model=APIResponse, summary="Get playlist by ID")
async def get_playlist_by_id(request: Request, playlist_id: str):
    provider = request.app.state.provider
    validated = _validate_id(playlist_id)
    playlist = await provider.get_playlist(validated)
    return APIResponse(success=True, data=playlist.model_dump())
