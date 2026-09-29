"""Small resilience primitives: TTL cache, circuit breaker, single-flight coalescing."""
from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Optional


class TTLCache:
    def __init__(self, maxsize: int = 4096, clock: Callable[[], float] = time.monotonic):
        self._d: "OrderedDict[Any, tuple[float, Any]]" = OrderedDict()
        self._max = maxsize
        self._clock = clock

    def get(self, key) -> Optional[Any]:
        item = self._d.get(key)
        if item is None or item[0] < self._clock():
            return None
        self._d.move_to_end(key)
        return item[1]

    def get_stale(self, key) -> Optional[Any]:
        """Return the value even if expired (for stale-while-error)."""
        item = self._d.get(key)
        return None if item is None else item[1]

    def set(self, key, value, ttl: float) -> None:
        self._d[key] = (self._clock() + ttl, value)
        self._d.move_to_end(key)
        while len(self._d) > self._max:
            self._d.popitem(last=False)


class CircuitOpen(Exception):
    pass


class CircuitBreaker:
    """closed -> (N consecutive failures) -> open -> (cooldown) -> half-open trial -> closed/open."""

    def __init__(self, name: str, threshold: int = 5, cooldown_s: float = 30.0,
                 clock: Callable[[], float] = time.monotonic):
        self.name, self.threshold, self.cooldown_s, self._clock = name, threshold, cooldown_s, clock
        self.failures = 0
        self.opened_until = 0.0

    @property
    def state(self) -> str:
        if self.failures < self.threshold:
            return "closed"
        return "open" if self._clock() < self.opened_until else "half_open"

    async def call(self, fn: Callable[[], Awaitable[Any]]):
        if self.state == "open":
            raise CircuitOpen(self.name)
        try:
            result = await fn()
        except Exception:
            self.failures += 1
            if self.failures >= self.threshold:
                self.opened_until = self._clock() + self.cooldown_s
            raise
        self.failures = 0
        return result


class SingleFlight:
    """Many concurrent callers with the same key share one upstream call."""

    def __init__(self):
        self._inflight: dict[Any, asyncio.Future] = {}

    async def do(self, key, fn: Callable[[], Awaitable[Any]]):
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(fn())
            self._inflight[key] = task
            task.add_done_callback(lambda _t, k=key: self._inflight.pop(k, None))
        return await asyncio.shield(task)
