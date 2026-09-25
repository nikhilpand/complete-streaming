"""
Health endpoints.

GET /health/live   — process is alive (no upstream calls)
GET /health/ready  — app ready + provider state + cache state
GET /metrics       — operational metrics snapshot
"""

from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Basic health probe")
async def health():
    return {"status": "ok", "service": "sway-music-backend"}


@router.get("/health/live", summary="Liveness probe")
async def liveness():
    """
    Process liveness.

    Returns 200 if the FastAPI process is running.
    Does NOT check provider state or make upstream calls.
    Suitable for Kubernetes liveness probes.
    """
    return {"status": "alive"}


@router.get("/health/ready", summary="Readiness probe")
async def readiness(request: Request):
    """
    Application readiness.

    Reports:
      - Provider circuit breaker state
      - Cache size
      - Overall readiness

    Does NOT make upstream requests — reads cached state.
    Suitable for Kubernetes readiness probes.
    """
    provider = request.app.state.provider
    provider_health = await provider.health_check()

    cb_state = provider_health.get("circuit_breaker", {}).get("state", "unknown")
    ready = cb_state != "open"

    return {
        "status": "ready" if ready else "degraded",
        "provider": provider_health,
    }


@router.get("/metrics", summary="Operational metrics")
async def metrics(request: Request):
    """
    Operational metrics snapshot.

    Includes cache size, circuit breaker state.
    Future: Prometheus-compatible /metrics endpoint.
    """
    provider = request.app.state.provider
    provider_health = await provider.health_check()

    return {
        "provider": provider_health,
    }
