"""
Albums router — GET /api/v1/albums
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Query, Request

from app.config import settings
from app.core.errors import ProviderInvalidRequest
from app.models import APIResponse

router = APIRouter(prefix="/albums", tags=["Albums"])

_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,30}$")


def _validate_id(album_id: str) -> str:
    aid = album_id.strip()
    if not _ID_RE.match(aid):
        raise ProviderInvalidRequest(f"Invalid album ID format: {aid!r}", provider="saavn")
    return aid


@router.get("", response_model=APIResponse, summary="Get album by ID or URL")
async def get_album(
    request: Request,
    id: str | None = Query(None, description="Album ID"),
    link: str | None = Query(None, max_length=2048, description="JioSaavn album URL"),
):
    """Retrieve album metadata with full tracklist."""
    provider = request.app.state.provider

    if link:
        album = await provider.resolve_url(link)
        return APIResponse(success=True, data=album.model_dump())

    if not id:
        raise ProviderInvalidRequest("Supply either 'id' or 'link'", provider="saavn")

    validated = _validate_id(id)
    album = await provider.get_album(validated)
    return APIResponse(success=True, data=album.model_dump())


@router.get("/{album_id}", response_model=APIResponse, summary="Get album by ID")
async def get_album_by_id(request: Request, album_id: str):
    provider = request.app.state.provider
    validated = _validate_id(album_id)
    album = await provider.get_album(validated)
    return APIResponse(success=True, data=album.model_dump())
