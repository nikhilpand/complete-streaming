"""
Concurrency limiter: wraps asyncio.Semaphore with structured logging.

Prevents the application from hammering the upstream provider with
unbounded parallel requests — especially critical for search enrichment
which could otherwise create 1 user request → 20 upstream requests.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

logger = logging.getLogger(__name__)


class ProviderConcurrencyLimiter:
    """
    Semaphore-backed concurrency limiter.

    Usage:
        limiter = ProviderConcurrencyLimiter(max_concurrent=5)
        result = await limiter.run(some_async_fn, arg1, arg2)
    """

    def __init__(self, max_concurrent: int, *, provider: str = "unknown") -> None:
        self._sem = asyncio.Semaphore(max_concurrent)
        self._max = max_concurrent
        self.provider = provider

    async def run(self, coro_fn: Callable, *args, **kwargs):
        """Acquire semaphore slot, run coroutine, release."""
        async with self._sem:
            return await coro_fn(*args, **kwargs)

    async def gather_bounded(
        self,
        coro_fns: list[Callable],
        *,
        return_exceptions: bool = True,
    ) -> list:
        """
        Run a list of coroutine functions with bounded concurrency.

        Unlike asyncio.gather with unlimited concurrency, this respects
        the semaphore and prevents request avalanches.

        Preserves partial results when return_exceptions=True.
        """
        tasks = [
            asyncio.create_task(self.run(fn))
            for fn in coro_fns
        ]
        return await asyncio.gather(*tasks, return_exceptions=return_exceptions)
