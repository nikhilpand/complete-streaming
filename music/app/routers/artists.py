"""
Artists router — GET /api/v1/artists

Artist songs and albums are SEPARATE endpoints to avoid hidden N+1.
GET /api/v1/artists/{id}         → metadata only (with top 10 songs/albums)
GET /api/v1/artists/{id}/songs   → paginated songs
GET /api/v1/artists/{id}/albums  → paginated albums
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Query, Request

from app.core.errors import ProviderInvalidRequest
from app.models import APIResponse

router = APIRouter(prefix="/artists", tags=["Artists"])

_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,30}$")


def _validate_id(artist_id: str) -> str:
    aid = artist_id.strip()
    if not _ID_RE.match(aid):
        raise ProviderInvalidRequest(f"Invalid artist ID format: {aid!r}", provider="saavn")
    return aid


@router.get("", response_model=APIResponse, summary="Get artist by ID or URL")
async def get_artist(
    request: Request,
    id: str | None = Query(None, description="Artist ID"),
    link: str | None = Query(None, max_length=2048, description="JioSaavn artist URL"),
):
    """Retrieve artist metadata with top 10 songs and albums."""
    provider = request.app.state.provider

    if link:
        artist = await provider.resolve_url(link)
        return APIResponse(success=True, data=artist.model_dump())

    if not id:
        raise ProviderInvalidRequest("Supply either 'id' or 'link'", provider="saavn")

    validated = _validate_id(id)
    artist = await provider.get_artist(validated)
    return APIResponse(success=True, data=artist.model_dump())


@router.get("/{artist_id}", response_model=APIResponse, summary="Get artist by ID")
async def get_artist_by_id(request: Request, artist_id: str):
    provider = request.app.state.provider
    validated = _validate_id(artist_id)
    artist = await provider.get_artist(validated)
    return APIResponse(success=True, data=artist.model_dump())


@router.get("/{artist_id}/songs", response_model=APIResponse, summary="Get artist songs")
async def get_artist_songs(
    request: Request,
    artist_id: str,
    page: int = Query(0, ge=0, description="Page number (0-indexed)"),
    n: int = Query(50, ge=1, le=50, description="Songs per page"),
):
    """Paginated artist songs — separate from artist metadata."""
    provider = request.app.state.provider
    validated = _validate_id(artist_id)
    songs = await provider.get_artist_songs(validated, page=page, n=n)
    return APIResponse(success=True, data=[s.model_dump() for s in songs])


@router.get("/{artist_id}/albums", response_model=APIResponse, summary="Get artist albums")
async def get_artist_albums(
    request: Request,
    artist_id: str,
    page: int = Query(0, ge=0, description="Page number (0-indexed)"),
    n: int = Query(50, ge=1, le=50, description="Albums per page"),
):
    """Paginated artist albums — separate from artist metadata."""
    provider = request.app.state.provider
    validated = _validate_id(artist_id)
    albums = await provider.get_artist_albums(validated, page=page, n=n)
    return APIResponse(success=True, data=[a.model_dump() for a in albums])
