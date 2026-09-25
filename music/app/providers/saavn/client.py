"""
JioSaavn provider HTTP client.

Responsibilities:
  - Build requests for each JioSaavn API call
  - Retry transient failures with exponential backoff + jitter
  - Route through circuit breaker
  - Route through concurrency limiter
  - Map HTTP errors to ProviderError hierarchy
  - Validate response size
  - Structured logging per request

What this does NOT do:
  - Parse JSON into models (that's parser.py)
  - Cache results (that's provider.py)
  - Validate business logic
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from typing import Any

import httpx

from app.config import settings
from app.core.circuit_breaker import CircuitBreaker
from app.core.concurrency import ProviderConcurrencyLimiter
from app.core.errors import (
    NON_RETRYABLE_HTTP_STATUS,
    RETRYABLE_HTTP_STATUS,
    ProviderBadResponse,
    ProviderError,
    ProviderNotFound,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
)
from app.providers.saavn.endpoints import BASE_PARAMS

logger = logging.getLogger(__name__)

PROVIDER = "saavn"


class SaavnClient:
    """
    Low-level async HTTP client for the JioSaavn internal API.

    One instance per application — shared via app.state.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        *,
        circuit_breaker: CircuitBreaker,
        limiter: ProviderConcurrencyLimiter,
    ) -> None:
        self._http = http_client
        self._cb = circuit_breaker
        self._limiter = limiter
        self._base_url = settings.SAAVN_BASE_URL

    # ── Public request method ─────────────────────────────────────────────────

    async def get(self, params: dict[str, Any]) -> Any:
        """
        Execute a JioSaavn API GET request.

        Merges base params, runs through circuit breaker + limiter + retry.
        Returns parsed JSON.
        """
        merged = {**BASE_PARAMS, **params}

        async def _do_request() -> Any:
            return await self._request_with_retry(merged)

        return await self._cb.call(
            lambda: self._limiter.run(_do_request)
        )

    # ── Retry logic ───────────────────────────────────────────────────────────

    async def _request_with_retry(self, params: dict[str, Any]) -> Any:
        last_exc: Exception | None = None
        attempts = settings.RETRY_MAX_ATTEMPTS

        for attempt in range(1, attempts + 1):
            try:
                return await self._raw_request(params)

            except ProviderError as exc:
                # Non-retryable errors: propagate immediately
                if exc.http_status in NON_RETRYABLE_HTTP_STATUS or isinstance(
                    exc, (ProviderNotFound, ProviderBadResponse)
                ):
                    raise

                last_exc = exc
                if attempt < attempts:
                    delay = self._backoff(attempt)
                    logger.warning(
                        "provider=%s attempt=%d/%d error=%s retry_in=%.2fs",
                        PROVIDER, attempt, attempts, type(exc).__name__, delay,
                    )
                    await asyncio.sleep(delay)

            except Exception as exc:
                last_exc = exc
                if attempt < attempts:
                    delay = self._backoff(attempt)
                    await asyncio.sleep(delay)

        raise ProviderUnavailable(
            f"All {attempts} attempts failed: {last_exc}",
            provider=PROVIDER,
        ) from last_exc

    def _backoff(self, attempt: int) -> float:
        """Exponential backoff with jitter. Never exceeds RETRY_MAX_DELAY."""
        base = settings.RETRY_BASE_DELAY * (2 ** (attempt - 1))
        jitter = random.uniform(0, settings.RETRY_JITTER * base)
        return min(base + jitter, settings.RETRY_MAX_DELAY)

    # ── Raw HTTP request ──────────────────────────────────────────────────────

    async def _raw_request(self, params: dict[str, Any]) -> Any:
        call_name = params.get("__call", "unknown")
        t0 = time.perf_counter()

        try:
            resp = await self._http.get(self._base_url, params=params)
        except httpx.TimeoutException as exc:
            raise ProviderTimeout(
                f"Request timed out for __call={call_name}: {exc}",
                provider=PROVIDER,
            ) from exc
        except httpx.ConnectError as exc:
            raise ProviderUnavailable(
                f"Connection error for __call={call_name}: {exc}",
                provider=PROVIDER,
            ) from exc
        except httpx.RequestError as exc:
            raise ProviderUnavailable(
                f"Request error for __call={call_name}: {exc}",
                provider=PROVIDER,
            ) from exc

        duration_ms = (time.perf_counter() - t0) * 1000
        logger.debug(
            "upstream __call=%s status=%d duration_ms=%.1f",
            call_name, resp.status_code, duration_ms,
        )

        self._check_status(resp, call_name)
        return self._parse_json(resp, call_name)

    def _check_status(self, resp: httpx.Response, call_name: str) -> None:
        status = resp.status_code
        if status == 200:
            return
        if status == 404:
            raise ProviderNotFound(
                f"Not found: __call={call_name}", provider=PROVIDER
            )
        if status == 429:
            retry_after = resp.headers.get("Retry-After")
            raise ProviderRateLimited(
                f"Rate limited: __call={call_name}",
                provider=PROVIDER,
                retry_after=int(retry_after) if retry_after else None,
            )
        if status in RETRYABLE_HTTP_STATUS:
            raise ProviderUnavailable(
                f"Upstream error {status}: __call={call_name}",
                provider=PROVIDER,
            )
        raise ProviderBadResponse(
            f"Unexpected status {status}: __call={call_name}",
            provider=PROVIDER,
        )

    def _parse_json(self, resp: httpx.Response, call_name: str) -> Any:
        # Guard against oversized responses
        content_length = int(resp.headers.get("content-length", 0))
        if content_length > settings.HTTP_MAX_RESPONSE_BYTES:
            raise ProviderBadResponse(
                f"Response too large ({content_length} bytes) for __call={call_name}",
                provider=PROVIDER,
            )

        try:
            return resp.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise ProviderBadResponse(
                f"Invalid JSON from __call={call_name}: {exc}",
                provider=PROVIDER,
            ) from exc
