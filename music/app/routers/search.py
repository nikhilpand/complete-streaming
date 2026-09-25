"""
Search router — GET /api/v1/search
"""

from __future__ import annotations

import logging
import unicodedata

from fastapi import APIRouter, Query, Request

from app.config import settings
from app.core.errors import ProviderInvalidRequest
from app.models import APIResponse, SearchResults

router = APIRouter(prefix="/search", tags=["Search"])
logger = logging.getLogger(__name__)


def _normalize_query(query: str) -> str:
    """
    Normalize a search query:
      - NFC unicode normalization (preserves Devanagari, mixed-script meaning)
      - Strip leading/trailing whitespace
      - Collapse internal whitespace runs

    Does NOT lowercase (case matters for some Hindi/English mixed queries).
    """
    q = unicodedata.normalize("NFC", query.strip())
    return " ".join(q.split())


@router.get("", response_model=APIResponse, summary="Search all content types")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    n: int = Query(20, ge=1, le=50, description="Number of results per type"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    enrich: bool = Query(False, description="Enrich top song results with full metadata"),
):
    """
    Search for songs, albums, artists, and playlists.

    Returns lightweight results without deep enrichment by default.
    Set enrich=true to enrich top song results (bounded concurrency, cached).
    """
    provider = request.app.state.provider
    query = _normalize_query(q)

    if not query:
        raise ProviderInvalidRequest("Query cannot be empty after normalization", provider="saavn")

    results: SearchResults = await provider.search(query, n=n, page=page, enrich=enrich)

    return APIResponse(
        success=True,
        data=results.model_dump(),
        request_id=request.headers.get("X-Request-Id"),
    )
