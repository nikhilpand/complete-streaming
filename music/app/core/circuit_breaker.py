"""
Circuit breaker: CLOSED → OPEN → HALF_OPEN → CLOSED.

Protects the upstream provider from cascading failure.

States:
  CLOSED    Normal operation. Failures counted.
  OPEN      Too many failures. All requests rejected immediately.
  HALF_OPEN Cooldown expired. One probe allowed through.

Transitions:
  CLOSED  → OPEN       failure_threshold consecutive failures
  OPEN    → HALF_OPEN  after cb_timeout seconds
  HALF_OPEN→ CLOSED    success_threshold consecutive successes
  HALF_OPEN→ OPEN      any failure

Thread-safety: asyncio.Lock protects state transitions.
"""

from __future__ import annotations

import asyncio
import enum
import time
from typing import Callable

from app.core.errors import ProviderUnavailable


class CBState(str, enum.Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    def __init__(
        self,
        *,
        provider: str,
        failure_threshold: int = 5,
        success_threshold: int = 2,
        timeout: float = 30.0,
    ) -> None:
        self.provider = provider
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout

        self._state = CBState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._opened_at: float | None = None
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CBState:
        return self._state

    async def call(self, coro_fn: Callable, *args, **kwargs):
        """
        Execute an async callable through the circuit breaker.

        Raises ProviderUnavailable if OPEN.
        Records success/failure to manage state transitions.
        """
        await self._check_state()

        try:
            result = await coro_fn(*args, **kwargs)
            await self._on_success()
            return result
        except Exception as exc:
            await self._on_failure()
            raise

    async def _check_state(self) -> None:
        async with self._lock:
            if self._state == CBState.OPEN:
                elapsed = time.monotonic() - (self._opened_at or 0)
                if elapsed >= self.timeout:
                    self._state = CBState.HALF_OPEN
                    self._success_count = 0
                else:
                    raise ProviderUnavailable(
                        f"Circuit breaker OPEN for {self.provider} "
                        f"(retry in {self.timeout - elapsed:.0f}s)",
                        provider=self.provider,
                    )

    async def _on_success(self) -> None:
        async with self._lock:
            if self._state == CBState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.success_threshold:
                    self._state = CBState.CLOSED
                    self._failure_count = 0
            elif self._state == CBState.CLOSED:
                self._failure_count = max(0, self._failure_count - 1)

    async def _on_failure(self) -> None:
        async with self._lock:
            if self._state == CBState.HALF_OPEN:
                # Any failure in half-open reopens immediately
                self._state = CBState.OPEN
                self._opened_at = time.monotonic()
            elif self._state == CBState.CLOSED:
                self._failure_count += 1
                if self._failure_count >= self.failure_threshold:
                    self._state = CBState.OPEN
                    self._opened_at = time.monotonic()

    def status_dict(self) -> dict:
        return {
            "state": self._state.value,
            "failure_count": self._failure_count,
            "success_count": self._success_count,
            "opened_at": self._opened_at,
        }
