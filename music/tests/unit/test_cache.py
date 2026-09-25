"""
Unit tests for the TTL cache with stale-while-revalidate.
"""

import asyncio

import pytest

from app.core.cache import MemoryTTLCache


@pytest.mark.asyncio
class TestMemoryTTLCache:
    async def test_set_and_get_hit(self):
        cache = MemoryTTLCache()
        await cache.set("k1", "v1", ttl=60)
        val, status = await cache.get("k1")
        assert val == "v1"
        assert status == "hit"

    async def test_miss_on_empty(self):
        cache = MemoryTTLCache()
        val, status = await cache.get("nonexistent")
        assert val is None
        assert status == "miss"

    async def test_expired_returns_miss(self):
        cache = MemoryTTLCache(stale_window=0)
        await cache.set("exp", "val", ttl=0, stale_window=0)
        # TTL=0 means expired immediately
        await asyncio.sleep(0.01)
        val, status = await cache.get("exp")
        assert status == "miss"

    async def test_stale_returns_stale(self):
        cache = MemoryTTLCache(stale_window=60)
        await cache.set("stale", "val", ttl=0, stale_window=60)
        await asyncio.sleep(0.01)
        val, status = await cache.get("stale", stale_ok=True)
        assert val == "val"
        assert status == "stale"

    async def test_stale_not_returned_without_flag(self):
        cache = MemoryTTLCache(stale_window=60)
        await cache.set("stale2", "val", ttl=0, stale_window=60)
        await asyncio.sleep(0.01)
        val, status = await cache.get("stale2", stale_ok=False)
        assert status == "miss"

    async def test_delete(self):
        cache = MemoryTTLCache()
        await cache.set("del", "val", ttl=60)
        await cache.delete("del")
        val, status = await cache.get("del")
        assert status == "miss"

    async def test_clear(self):
        cache = MemoryTTLCache()
        await cache.set("a", 1, ttl=60)
        await cache.set("b", 2, ttl=60)
        assert len(cache) == 2
        await cache.clear()
        assert len(cache) == 0

    async def test_evict_expired(self):
        cache = MemoryTTLCache(stale_window=0)
        await cache.set("evict", "val", ttl=0, stale_window=0)
        await asyncio.sleep(0.01)
        count = await cache.evict_expired()
        assert count == 1
        assert len(cache) == 0
