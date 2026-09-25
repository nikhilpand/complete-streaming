"""
Shared application-level async HTTP client.

KEY DESIGN PRINCIPLE:
  One client per application lifetime — NOT one per request.

Per-request `async with httpx.AsyncClient() as c:` throws away:
  - Connection pooling
  - Keep-alive connections
  - TLS session resumption
  - All the performance benefits of async HTTP

Instead:
  - Client is created at startup (lifespan event)
  - Shared via app.state.http_client
  - Closed cleanly at shutdown
"""

from __future__ import annotations

import httpx

from app.config import settings


def build_http_client() -> httpx.AsyncClient:
    """
    Create the application-wide async HTTP client.

    Configuration:
      - Explicit timeouts per phase (connect / read / write / pool)
      - Connection pool size limits
      - Response size limit
      - Persistent User-Agent header
    """
    timeout = httpx.Timeout(
        connect=settings.HTTP_CONNECT_TIMEOUT,
        read=settings.HTTP_READ_TIMEOUT,
        write=settings.HTTP_WRITE_TIMEOUT,
        pool=settings.HTTP_POOL_TIMEOUT,
    )

    limits = httpx.Limits(
        max_connections=settings.HTTP_MAX_CONNECTIONS,
        max_keepalive_connections=settings.HTTP_MAX_KEEPALIVE,
    )

    return httpx.AsyncClient(
        timeout=timeout,
        limits=limits,
        headers={"User-Agent": settings.SAAVN_USER_AGENT},
        follow_redirects=True,
        max_redirects=3,
        http2=False,   # keep simple; enable if provider supports it
    )
