"""
Provider error hierarchy.

Every provider error maps to a specific HTTP status code.
Internal errors (tracebacks, raw upstream responses) are never
surfaced to API consumers.
"""

from __future__ import annotations


class ProviderError(Exception):
    """Base for all provider errors."""
    http_status: int = 502
    error_code: str = "PROVIDER_ERROR"

    def __init__(self, message: str, *, provider: str = "unknown") -> None:
        super().__init__(message)
        self.provider = provider
        self.message = message


class ProviderTimeout(ProviderError):
    """Upstream request timed out."""
    http_status = 504
    error_code = "PROVIDER_TIMEOUT"


class ProviderUnavailable(ProviderError):
    """Upstream is down or circuit breaker is OPEN."""
    http_status = 503
    error_code = "PROVIDER_UNAVAILABLE"


class ProviderRateLimited(ProviderError):
    """Upstream is rate-limiting us."""
    http_status = 429
    error_code = "PROVIDER_RATE_LIMITED"

    def __init__(self, message: str, *, provider: str = "unknown", retry_after: int | None = None) -> None:
        super().__init__(message, provider=provider)
        self.retry_after = retry_after


class ProviderNotFound(ProviderError):
    """Requested resource does not exist upstream."""
    http_status = 404
    error_code = "PROVIDER_NOT_FOUND"


class ProviderBadResponse(ProviderError):
    """Upstream returned a malformed or unexpected response."""
    http_status = 502
    error_code = "PROVIDER_BAD_RESPONSE"


class ProviderSchemaChanged(ProviderError):
    """
    Upstream response shape no longer matches expected schema.
    This is a critical signal — required identity fields vanished.
    """
    http_status = 502
    error_code = "PROVIDER_SCHEMA_CHANGED"


class ProviderInvalidRequest(ProviderError):
    """Request to upstream would be invalid (bad ID format etc.)."""
    http_status = 400
    error_code = "PROVIDER_INVALID_REQUEST"


class SSRFAttempt(ProviderError):
    """A user-supplied URL failed SSRF validation."""
    http_status = 400
    error_code = "INVALID_URL"


# ── Retryable status codes ───────────────────────────────────────────────────

RETRYABLE_HTTP_STATUS: frozenset[int] = frozenset({408, 502, 503, 504})
NON_RETRYABLE_HTTP_STATUS: frozenset[int] = frozenset({400, 401, 403, 404})

RETRYABLE_ERRORS: tuple[type[ProviderError], ...] = (
    ProviderTimeout,
    ProviderUnavailable,
)
