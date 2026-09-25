"""
Structured logging and request ID middleware.

Design:
  - Every request gets a UUID request_id
  - request_id propagated via contextvars (not thread-locals)
  - Log every request: route, method, status, duration_ms, cache_status
  - Never log: cookies, authorization, tokens, raw provider responses
"""

from __future__ import annotations

import contextvars
import logging
import time
import uuid
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# Context variable for request ID — available anywhere in the call stack
REQUEST_ID_CTX: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="no-request-id"
)


class StructuredFormatter(logging.Formatter):
    """Ensure request_id is always present on the log record."""

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "request_id"):
            record.request_id = REQUEST_ID_CTX.get("no-request-id")  # type: ignore[attr-defined]
        return super().format(record)


def configure_logging(level: str = "INFO") -> None:
    """Set up structured logging with safe request_id formatting."""
    handler = logging.StreamHandler()
    handler.setFormatter(
        StructuredFormatter("%(asctime)s %(levelname)s [%(name)s] request_id=%(request_id)s %(message)s")
    )
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # Replace existing handlers to avoid duplicates
    root.handlers = [handler]


class RequestIDFilter(logging.Filter):
    """Inject request_id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = REQUEST_ID_CTX.get("no-request-id")  # type: ignore[attr-defined]
        return True


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Log every HTTP request with timing and status.

    Excluded headers (never logged):
      Authorization, Cookie, X-Api-Key, X-Auth-Token
    """

    EXCLUDED_HEADERS = frozenset(
        {"authorization", "cookie", "x-api-key", "x-auth-token", "x-session-token"}
    )
    logger = logging.getLogger("api.access")

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = str(uuid.uuid4())
        REQUEST_ID_CTX.set(request_id)

        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000

        response.headers["X-Request-Id"] = request_id

        self.logger.info(
            "method=%s path=%s status=%d duration_ms=%.1f",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response
