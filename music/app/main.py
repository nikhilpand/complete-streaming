"""
FastAPI application factory.

Lifespan:
  startup  → create shared HTTP client, cache, circuit breaker,
              concurrency limiter, SaavnClient, SaavnProvider
  shutdown → close HTTP client, clear cache

All shared state lives on app.state — never as module-level globals.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.cache import MemoryTTLCache
from app.core.circuit_breaker import CircuitBreaker
from app.core.concurrency import ProviderConcurrencyLimiter
from app.core.errors import ProviderError
from app.core.http_client import build_http_client
from app.core.logging_config import (
    RequestIDFilter,
    RequestLoggingMiddleware,
    configure_logging,
)
from app.providers.saavn.client import SaavnClient
from app.providers.saavn.provider import SaavnProvider
from app.providers.youtube.provider import YouTubeProvider
from app.providers.hybrid import HybridMusicProvider
from app.routers import albums, artists, health, lyrics, playlists, recommendations, search, songs

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Creates shared infrastructure at startup, tears it down at shutdown.
    """
    configure_logging(settings.LOG_LEVEL)

    # Add request_id filter to root logger
    root_logger = logging.getLogger()
    root_logger.addFilter(RequestIDFilter())

    logger.info("Starting %s v%s", settings.APP_NAME, settings.APP_VERSION)

    # Build shared infrastructure
    http_client = build_http_client()
    cache = MemoryTTLCache(stale_window=settings.CACHE_STALE_WINDOW)
    circuit_breaker = CircuitBreaker(
        provider="saavn",
        failure_threshold=settings.CB_FAILURE_THRESHOLD,
        success_threshold=settings.CB_SUCCESS_THRESHOLD,
        timeout=settings.CB_TIMEOUT,
    )
    limiter = ProviderConcurrencyLimiter(
        max_concurrent=settings.SAAVN_MAX_CONCURRENCY,
        provider="saavn",
    )
    saavn_client = SaavnClient(
        http_client,
        circuit_breaker=circuit_breaker,
        limiter=limiter,
    )
    saavn_provider = SaavnProvider(
        client=saavn_client,
        cache=cache,
        limiter=limiter,
        circuit_breaker=circuit_breaker,
    )
    youtube_provider = YouTubeProvider(cache=cache)
    provider = HybridMusicProvider(
        saavn_provider=saavn_provider,
        youtube_provider=youtube_provider,
    )

    # Store on app.state
    app.state.http_client = http_client
    app.state.cache = cache
    app.state.circuit_breaker = circuit_breaker
    app.state.limiter = limiter
    app.state.provider = provider

    logger.info("Application ready")

    yield

    # Shutdown
    logger.info("Shutting down")
    await http_client.aclose()
    await cache.clear()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title="SWAY Saavn Provider",
        description=(
            "Production-grade JioSaavn provider for the SWAY music engine. "
            "Provides search, songs, albums, playlists, artists, lyrics, "
            "and optional media resolution."
        ),
        version=settings.APP_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────
    origins = settings.cors_origins
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # ── Logging middleware ────────────────────────────────────────────────
    app.add_middleware(RequestLoggingMiddleware)

    # ── Exception handler ─────────────────────────────────────────────────
    @app.exception_handler(ProviderError)
    async def provider_error_handler(request: Request, exc: ProviderError):
        """
        Map all ProviderError subclasses to structured JSON responses.
        Never expose internal tracebacks.
        """
        response = {
            "success": False,
            "error": exc.message,
            "error_code": exc.error_code,
        }
        headers = {}
        if hasattr(exc, "retry_after") and exc.retry_after:
            headers["Retry-After"] = str(exc.retry_after)

        return JSONResponse(
            status_code=exc.http_status,
            content=response,
            headers=headers,
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        """Catch-all: log the real error, return generic 500."""
        logger.exception("Unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "Internal server error",
                "error_code": "INTERNAL_ERROR",
            },
        )

    # ── Routers ───────────────────────────────────────────────────────────
    api_prefix = "/api/v1"

    app.include_router(search.router, prefix=api_prefix)
    app.include_router(songs.router, prefix=api_prefix)
    app.include_router(albums.router, prefix=api_prefix)
    app.include_router(playlists.router, prefix=api_prefix)
    app.include_router(artists.router, prefix=api_prefix)
    app.include_router(lyrics.router, prefix=api_prefix)
    app.include_router(recommendations.router, prefix=api_prefix)
    app.include_router(recommendations.router)
    app.include_router(health.router, prefix=api_prefix)
    app.include_router(health.router)

    # ── Test Web Console ──────────────────────────────────────────────────
    from pathlib import Path
    from fastapi.responses import FileResponse

    index_html = Path(__file__).parent / "static" / "index.html"

    @app.get("/", include_in_schema=False)
    async def serve_test_ui():
        if index_html.exists():
            return FileResponse(index_html)
        return {"status": "ok", "message": "SWAY Saavn Provider Running"}

    return app


app = create_app()
