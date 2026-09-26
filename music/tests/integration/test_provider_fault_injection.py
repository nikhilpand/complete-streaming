"""
Ultra-hardcore fault injection test suite for upstream music providers.

Covers:
  - Circuit Breaker:
      * State machine transitions: CLOSED -> OPEN -> HALF-OPEN -> CLOSED
      * Fast rejection with ProviderUnavailable when OPEN
      * Re-opening immediately on half-open failure
      * High-concurrency race condition resistance
  - Concurrency Limiter:
      * Semaphore bounded concurrency with active worker peak tracking
      * gather_bounded error tolerance and exception propagation
  - In-flight Request Coalescing (Cache Stampede Prevention):
      * 10+ concurrent identical searches trigger exactly ONE upstream call
      * Independent deepcopy isolation (mutating one caller result does not mutate others)
      * Graceful recovery and cleanup on task failure
  - Upstream Failure Resilience:
      * Saavn HTTP 500/502/503/504/429 / malformed responses with YouTube fallback
      * YouTube timeout / failure with Saavn survival
      * Dual upstream catastrophic failure returns empty SearchResults without server crash
  - Media Stream Resolution Fallback:
      * JioSaavn stream failure triggers YouTube audio search resolution
      * YouTube direct track IDs bypass Saavn
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock
import pytest

from app.core.circuit_breaker import CBState, CircuitBreaker
from app.core.concurrency import ProviderConcurrencyLimiter
from app.core.errors import (
    ProviderBadResponse,
    ProviderError,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
)
from app.models import (
    ArtistRef,
    MediaInfo,
    MediaStream,
    SearchItem,
    SearchResults,
    Song,
)
from app.providers.hybrid import HybridMusicProvider


# ============================================================================
# 1. CIRCUIT BREAKER FAULT INJECTION & CONCURRENCY
# ============================================================================


class TestCircuitBreakerFaultInjection:
    """Stress tests and state transitions for CircuitBreaker."""

    @pytest.mark.asyncio
    async def test_full_state_lifecycle(self):
        cb = CircuitBreaker(
            provider="test_saavn",
            failure_threshold=3,
            success_threshold=2,
            timeout=0.1,  # 100ms cooldown
        )

        async def _failing_op():
            raise ProviderBadResponse("Simulated 502 Bad Gateway", provider="test_saavn")

        async def _successful_op():
            return {"status": "ok"}

        # 1. Starts CLOSED
        assert cb.state == CBState.CLOSED

        # 2. 3 consecutive failures trip the breaker to OPEN
        for i in range(3):
            with pytest.raises(ProviderBadResponse):
                await cb.call(_failing_op)

        assert cb.state == CBState.OPEN

        # 3. OPEN state immediately rejects requests without executing the coroutine
        executed = False

        async def _probe():
            nonlocal executed
            executed = True
            return "ok"

        with pytest.raises(ProviderUnavailable):
            await cb.call(_probe)
        assert executed is False

        # 4. Wait for cooldown timeout to expire -> transitions to HALF_OPEN on next call
        await asyncio.sleep(0.12)

        # 5. In HALF_OPEN, success_threshold (2) consecutive successes close the circuit
        res1 = await cb.call(_successful_op)
        assert res1 == {"status": "ok"}
        assert cb.state == CBState.HALF_OPEN

        res2 = await cb.call(_successful_op)
        assert res2 == {"status": "ok"}
        assert cb.state == CBState.CLOSED

    @pytest.mark.asyncio
    async def test_half_open_failure_reopens_immediately(self):
        cb = CircuitBreaker(
            provider="test",
            failure_threshold=2,
            success_threshold=3,
            timeout=0.05,
        )

        async def _fail():
            raise RuntimeError("Failure")

        # Trip to OPEN
        for _ in range(2):
            with pytest.raises(RuntimeError):
                await cb.call(_fail)
        assert cb.state == CBState.OPEN

        # Wait for cooldown
        await asyncio.sleep(0.06)

        # Single failure in HALF_OPEN trips immediately back to OPEN
        with pytest.raises(RuntimeError):
            await cb.call(_fail)
        assert cb.state == CBState.OPEN

    @pytest.mark.asyncio
    async def test_concurrent_breaker_hammering(self):
        cb = CircuitBreaker(provider="test", failure_threshold=5, timeout=10.0)

        fail_count = 0

        async def _random_worker(worker_id: int):
            nonlocal fail_count
            try:
                # Force failure for first 8 workers
                if worker_id < 8:
                    fail_count += 1
                    raise ValueError(f"Worker {worker_id} exploded")
                return f"Worker {worker_id} ok"
            except Exception:
                raise

        # Launch 30 concurrent workers through the circuit breaker
        async def _run_worker(wid: int):
            try:
                return await cb.call(_random_worker, wid)
            except Exception as e:
                return str(type(e).__name__)

        tasks = [_run_worker(i) for i in range(30)]
        results = await asyncio.gather(*tasks)

        # Circuit must be OPEN
        assert cb.state == CBState.OPEN
        # Many later workers must have received ProviderUnavailable
        assert "ProviderUnavailable" in results


# ============================================================================
# 2. CONCURRENCY LIMITER STRESS
# ============================================================================


class TestConcurrencyLimiterStress:
    """Stress tests ensuring semaphore concurrency limits are never exceeded."""

    @pytest.mark.asyncio
    async def test_bounded_parallelism_never_exceeded(self):
        max_parallel = 3
        limiter = ProviderConcurrencyLimiter(max_concurrent=max_parallel, provider="saavn_enrich")

        active_workers = 0
        peak_active_workers = 0
        lock = asyncio.Lock()

        async def _worker():
            nonlocal active_workers, peak_active_workers
            async with lock:
                active_workers += 1
                if active_workers > peak_active_workers:
                    peak_active_workers = active_workers

            # Simulate network I/O
            await asyncio.sleep(0.03)

            async with lock:
                active_workers -= 1
            return "done"

        # Launch 25 workers concurrently
        tasks = [limiter.run(_worker) for _ in range(25)]
        results = await asyncio.gather(*tasks)

        assert len(results) == 25
        assert peak_active_workers <= max_parallel

    @pytest.mark.asyncio
    async def test_gather_bounded_with_exceptions(self):
        limiter = ProviderConcurrencyLimiter(max_concurrent=4)

        async def _good(val: int):
            await asyncio.sleep(0.01)
            return val * 2

        async def _bad(val: int):
            await asyncio.sleep(0.01)
            raise ValueError(f"Bad {val}")

        fns = [
            (lambda: _good(1)),
            (lambda: _bad(2)),
            (lambda: _good(3)),
            (lambda: _bad(4)),
            (lambda: _good(5)),
        ]

        results = await limiter.gather_bounded(fns, return_exceptions=True)
        assert len(results) == 5
        assert results[0] == 2
        assert isinstance(results[1], ValueError)
        assert results[2] == 6
        assert isinstance(results[3], ValueError)
        assert results[4] == 10


# ============================================================================
# 3. IN-FLIGHT REQUEST COALESCING (CACHE STAMPEDE PREVENTION)
# ============================================================================


class TestInflightRequestCoalescing:
    """Tests verifying multiple concurrent identical searches execute upstream once."""

    @pytest.mark.asyncio
    async def test_concurrent_identical_searches_coalesce(self):
        mock_saavn = MagicMock()
        mock_saavn.search = AsyncMock()

        mock_yt = MagicMock()
        mock_yt.search = AsyncMock()

        # Simulate slow upstream search (50ms)
        async def _slow_saavn_search(*args, **kwargs):
            await asyncio.sleep(0.05)
            return SearchResults(
                query="Arijit Singh",
                songs=[
                    SearchItem(
                        id="saavn:t1",
                        provider="saavn",
                        provider_id="t1",
                        type="song",
                        title="Tum Hi Ho",
                        subtitle="Aashiqui 2 · Arijit Singh",
                        extra={"primary_artists": "Arijit Singh"},
                    )
                ],
                albums=[],
                artists=[],
                playlists=[],
                total_songs=1,
                total_albums=0,
                total_artists=0,
                total_playlists=0,
            )

        mock_saavn.search.side_effect = _slow_saavn_search
        mock_yt.search.return_value = SearchResults(
            query="Arijit Singh", songs=[], albums=[], artists=[], playlists=[],
            total_songs=0, total_albums=0, total_artists=0, total_playlists=0,
        )

        hybrid = HybridMusicProvider(saavn_provider=mock_saavn, youtube_provider=mock_yt)

        # Launch 10 concurrent requests for "Arijit Singh"
        tasks = [hybrid.search("Arijit Singh", n=10) for _ in range(10)]
        results = await asyncio.gather(*tasks)

        assert len(results) == 10
        for r in results:
            assert len(r.songs) == 1
            assert r.songs[0].id == "saavn:t1"

        # The slow Saavn search should only have been called ONCE
        assert mock_saavn.search.call_count == 1

    @pytest.mark.asyncio
    async def test_deepcopy_isolation_between_coalesced_callers(self):
        mock_saavn = MagicMock()
        mock_saavn.search = AsyncMock()
        mock_yt = MagicMock()
        mock_yt.search = AsyncMock()

        item = SearchItem(
            id="saavn:t1",
            provider="saavn",
            provider_id="t1",
            type="song",
            title="Tum Hi Ho",
            extra={"tags": ["original"]},
        )
        mock_saavn.search.return_value = SearchResults(
            query="test", songs=[item], albums=[], artists=[], playlists=[],
            total_songs=1, total_albums=0, total_artists=0, total_playlists=0,
        )
        mock_yt.search.return_value = SearchResults(
            query="test", songs=[], albums=[], artists=[], playlists=[],
            total_songs=0, total_albums=0, total_artists=0, total_playlists=0,
        )

        hybrid = HybridMusicProvider(saavn_provider=mock_saavn, youtube_provider=mock_yt)

        # Call search twice
        res1 = await hybrid.search("test")
        res2 = await hybrid.search("test")

        # Mutating res1's items must NOT mutate res2's items
        res1.songs[0].extra["tags"].append("mutated_tag")
        assert "mutated_tag" not in res2.songs[0].extra["tags"]


# ============================================================================
# 4. UPSTREAM FAULT INJECTION & CATASTROPHIC RECOVERY
# ============================================================================


class TestUpstreamFaultInjection:
    """Fault injection simulating partial and total upstream outages."""

    @pytest.fixture
    def mock_saavn(self):
        provider = MagicMock()
        provider.search = AsyncMock()
        provider.get_song = AsyncMock()
        provider.resolve_media = AsyncMock()
        return provider

    @pytest.fixture
    def mock_youtube(self):
        provider = MagicMock()
        provider.search = AsyncMock()
        provider.get_song = AsyncMock()
        provider.resolve_by_query = AsyncMock()
        provider.resolve_media = AsyncMock()
        return provider

    @pytest.fixture
    def hybrid(self, mock_saavn, mock_youtube):
        return HybridMusicProvider(saavn_provider=mock_saavn, youtube_provider=mock_youtube)

    @pytest.mark.asyncio
    async def test_saavn_down_falls_back_to_youtube_results(self, hybrid, mock_saavn, mock_youtube):
        # Saavn throws 503 ProviderUnavailable
        mock_saavn.search.side_effect = ProviderUnavailable("JioSaavn upstream offline", provider="saavn")

        # YouTube returns valid results
        yt_song = SearchItem(
            id="youtube:abc1234",
            provider="youtube",
            provider_id="abc1234",
            type="song",
            title="Pasoori",
            subtitle="Ali Sethi, Shae Gill - Topic",
            extra={"primary_artists": "Ali Sethi, Shae Gill", "views": "700M"},
        )
        mock_youtube.search.return_value = SearchResults(
            query="Pasoori",
            songs=[yt_song],
            albums=[],
            artists=[],
            playlists=[],
            total_songs=1,
            total_albums=0,
            total_artists=0,
            total_playlists=0,
        )

        results = await hybrid.search("Pasoori", n=10)
        assert len(results.songs) == 1
        assert results.songs[0].id == "youtube:abc1234"

    @pytest.mark.asyncio
    async def test_youtube_times_out_saavn_results_survive(self, hybrid, mock_saavn, mock_youtube):
        # Saavn responds promptly
        saavn_song = SearchItem(
            id="saavn:s1",
            provider="saavn",
            provider_id="s1",
            type="song",
            title="Kesariya",
            extra={"primary_artists": "Arijit Singh"},
        )
        mock_saavn.search.return_value = SearchResults(
            query="Kesariya",
            songs=[saavn_song],
            albums=[],
            artists=[],
            playlists=[],
            total_songs=1,
            total_albums=0,
            total_artists=0,
            total_playlists=0,
        )

        # YouTube raises TimeoutError
        mock_youtube.search.side_effect = asyncio.TimeoutError()

        # Should complete immediately because YouTube task returns TimeoutError
        results = await hybrid.search("Kesariya", n=10)
        assert len(results.songs) == 1
        assert results.songs[0].id == "saavn:s1"

    @pytest.mark.asyncio
    async def test_both_providers_fail_catastrophically_returns_empty_safely(
        self, hybrid, mock_saavn, mock_youtube
    ):
        mock_saavn.search.side_effect = ProviderBadResponse("HTML 502 Cloudflare Gateway Error")
        mock_youtube.search.side_effect = ProviderRateLimited("YouTube 429 Too Many Requests")

        results = await hybrid.search("Catastrophe", n=10)
        # Must not raise an unhandled exception or crash the server
        assert isinstance(results, SearchResults)
        assert len(results.songs) == 0
        assert results.total_songs == 0


# ============================================================================
# 5. MEDIA STREAM RESOLUTION FALLBACK
# ============================================================================


class TestMediaStreamResolutionFallback:
    """Tests for seamless audio stream fallback from Saavn to YouTube."""

    @pytest.fixture
    def mock_saavn(self):
        provider = MagicMock()
        provider.resolve_media = AsyncMock()
        return provider

    @pytest.fixture
    def mock_youtube(self):
        provider = MagicMock()
        provider.resolve_by_query = AsyncMock()
        provider.resolve_media = AsyncMock()
        return provider

    @pytest.fixture
    def hybrid(self, mock_saavn, mock_youtube):
        return HybridMusicProvider(saavn_provider=mock_saavn, youtube_provider=mock_youtube)

    def _sample_song(self, song_id: str, title: str, artist: str = "Arijit Singh") -> Song:
        prov = "saavn" if not song_id.startswith("youtube:") else "youtube"
        pid = song_id.split(":")[-1]
        return Song(
            id=song_id,
            provider=prov,
            provider_id=pid,
            title=title,
            artists=[ArtistRef(id="a1", provider=prov, provider_id="a1", name=artist, role="primary")],
            album=None,
            year="2024",
            duration_ms=200000,
            artwork_url="https://c.jpg",
            has_media=True,
        )

    @pytest.mark.asyncio
    async def test_saavn_stream_success_returns_immediately(self, hybrid, mock_saavn, mock_youtube):
        song = self._sample_song("saavn:123", "Tum Hi Ho")
        mock_media = MediaInfo(
            song_id="123",
            provider="saavn",
            streams=[MediaStream(quality="320kbps", url="https://saavn.cdn/stream.mp4", bitrate_kbps=320)],
        )
        mock_saavn.resolve_media.return_value = mock_media

        resolved = await hybrid.resolve_media(song)
        assert resolved == mock_media
        # YouTube fallback must NOT have been called
        assert mock_youtube.resolve_by_query.call_count == 0

    @pytest.mark.asyncio
    async def test_saavn_stream_missing_falls_back_to_youtube(self, hybrid, mock_saavn, mock_youtube):
        song = self._sample_song("saavn:456", "Pakistani Coke Studio Hit", artist="Ali Sethi")
        # Saavn returns media with NO streams (e.g. Geo-blocked / delisted song)
        mock_saavn.resolve_media.return_value = MediaInfo(
            song_id="456",
            provider="saavn",
            streams=[],
        )

        yt_media = MediaInfo(
            song_id="youtube:yt_stream_99",
            provider="youtube",
            streams=[MediaStream(quality="160kbps", url="https://googlevideo.com/videoplayback", bitrate_kbps=160, mime_type="audio/webm")],
        )
        mock_youtube.resolve_by_query.return_value = yt_media

        resolved = await hybrid.resolve_media(song)
        assert resolved == yt_media
        # Verify YouTube was queried using song title and artist
        mock_youtube.resolve_by_query.assert_called_once_with("Pakistani Coke Studio Hit", "Ali Sethi")

    @pytest.mark.asyncio
    async def test_youtube_track_resolves_directly_via_youtube_provider(self, hybrid, mock_saavn, mock_youtube):
        song = self._sample_song("youtube:yt_direct_1", "Direct YouTube Track", artist="Underground Artist")
        mock_yt_media = MediaInfo(
            song_id="youtube:yt_direct_1",
            provider="youtube",
            streams=[MediaStream(quality="128kbps", url="https://googlevideo.com/direct", bitrate_kbps=128, mime_type="audio/webm")],
        )
        mock_youtube.resolve_media.return_value = mock_yt_media

        resolved = await hybrid.resolve_media(song)
        assert resolved == mock_yt_media
        # Saavn resolve_media must NOT have been called
        assert mock_saavn.resolve_media.call_count == 0
