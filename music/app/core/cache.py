"""
In-memory TTL cache with stale-while-revalidate support.

Design:
  - Generic key → value cache with per-entry TTL
  - Stale-while-revalidate: expired entries can be served stale
    for a grace window while a background refresh runs
  - Thread-safe via asyncio.Lock
  - No external dependency (Redis interface can be added later)

Usage:
    cache = MemoryTTLCache()
    await cache.set("key", value, ttl=300)
    result = await cache.get("key", stale_ok=True)
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Generic, Optional, TypeVar

T = TypeVar("T")


@dataclass
class CacheEntry:
    value: Any
    stored_at: float       # epoch seconds
    ttl: int               # seconds before fresh → stale
    stale_window: int = 0  # extra seconds stale data is acceptable


class MemoryTTLCache:
    """
    Simple async-safe in-memory cache.

    TTL semantics:
        0..ttl           → FRESH
        ttl..ttl+window  → STALE (served, triggers background refresh)
        >ttl+window      → EXPIRED (not served)
    """

    def __init__(self, stale_window: int = 60) -> None:
        self._store: dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()
        self._default_stale_window = stale_window

    async def get(self, key: str, *, stale_ok: bool = False) -> tuple[Any, str]:
        """
        Returns (value, status) where status is one of:
          "hit"    → fresh
          "stale"  → stale but acceptable (caller should revalidate async)
          "miss"   → not found or expired
        """
        async with self._lock:
            entry = self._store.get(key)
        if entry is None:
            return None, "miss"

        age = time.monotonic() - entry.stored_at
        if age <= entry.ttl:
            return entry.value, "hit"
        if stale_ok and age <= entry.ttl + entry.stale_window:
            return entry.value, "stale"
        return None, "miss"

    async def set(
        self,
        key: str,
        value: Any,
        ttl: int,
        stale_window: int | None = None,
    ) -> None:
        entry = CacheEntry(
            value=value,
            stored_at=time.monotonic(),
            ttl=ttl,
            stale_window=stale_window if stale_window is not None else self._default_stale_window,
        )
        async with self._lock:
            self._store[key] = entry

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()

    async def evict_expired(self) -> int:
        """Remove entries past their stale window. Returns count evicted."""
        now = time.monotonic()
        async with self._lock:
            expired = [
                k for k, e in self._store.items()
                if now > e.stored_at + e.ttl + e.stale_window
            ]
            for k in expired:
                del self._store[k]
        return len(expired)

    def __len__(self) -> int:
        return len(self._store)
