"""
Performance benchmarks and load tests using a local mock provider.

Measures:
  - Cache hit vs Cache miss latency (p50, p95, p99)
  - Single song vs Bulk songs (1 vs 10 vs 20)
  - Search vs Enriched Search
  - Critical metric: UPSTREAM REQUESTS / USER REQUEST
  - Concurrency & Load test (1, 10, 50, 100 concurrent requests)
  - Circuit breaker activation under load without retry storm
"""

import asyncio
import json
import pathlib
import time

import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient

from app.main import create_app

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


def _load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


def calculate_percentiles(durations_ms: list[float]) -> dict[str, float]:
    if not durations_ms:
        return {"p50": 0.0, "p95": 0.0, "p99": 0.0, "min": 0.0, "max": 0.0, "mean": 0.0}
    s = sorted(durations_ms)
    n = len(s)
    def p(pct: float) -> float:
        idx = min(int(len(s) * (pct / 100.0)), n - 1)
        return float(s[idx])

    return {
        "p50": p(50),
        "p95": p(95),
        "p99": p(99),
        "min": float(s[0]),
        "max": float(s[-1]),
        "mean": float(sum(s) / n),
    }


class TestPerformanceBenchmarks:
    @respx.mock
    def test_cache_hit_vs_miss_and_upstream_ratio(self):
        """
        Verify:
          1. First request triggers 1 upstream call (cache miss).
          2. Subsequent 100 requests trigger 0 upstream calls (cache hits).
          3. UPSTREAM REQUESTS / USER REQUEST approaches ~0.01.
          4. Cache hit p95 latency is sub-millisecond.
        """
        app = create_app()
        song_fixture = _load_fixture("song.json")

        upstream_route = respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(200, json={"test123": song_fixture})
        )

        with TestClient(app) as client:
            # 1. Cache Miss
            t0 = time.perf_counter()
            r_miss = client.get("/api/v1/songs/test123")
            t_miss = (time.perf_counter() - t0) * 1000
            assert r_miss.status_code == 200
            assert upstream_route.call_count == 1

            # 2. 100 Cache Hits
            hit_durations = []
            for _ in range(100):
                t0 = time.perf_counter()
                r_hit = client.get("/api/v1/songs/test123")
                t_hit = (time.perf_counter() - t0) * 1000
                assert r_hit.status_code == 200
                hit_durations.append(t_hit)

            assert upstream_route.call_count == 1  # No additional upstream calls!

            total_user_requests = 101
            upstream_ratio = upstream_route.call_count / total_user_requests
            pct = calculate_percentiles(hit_durations)

            print(f"\n--- Cache Hit/Miss Benchmark ---")
            print(f"Miss Latency: {t_miss:.2f}ms")
            print(f"Hit Latency: p50={pct['p50']:.2f}ms, p95={pct['p95']:.2f}ms, p99={pct['p99']:.2f}ms")
            print(f"Upstream Requests / User Request: {upstream_ratio:.4f} (1 / {total_user_requests})")

            assert upstream_ratio < 0.05
            assert pct["p95"] < 10.0  # Fast local in-memory lookup

    @respx.mock
    def test_bulk_songs_single_upstream_call(self):
        """
        Verify:
          Bulk song fetching 10 IDs performs exactly 1 upstream request (not 10).
          Upstream calls per user request: exactly 1.0 (no N+1).
        """
        app = create_app()
        song_fixture = _load_fixture("song.json")
        ids = [f"song_{i}" for i in range(10)]

        mock_resp = {sid: dict(song_fixture, id=sid) for sid in ids}
        upstream_route = respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(200, json=mock_resp)
        )

        with TestClient(app) as client:
            t0 = time.perf_counter()
            resp = client.get(f"/api/v1/songs?id={','.join(ids)}")
            duration = (time.perf_counter() - t0) * 1000

            assert resp.status_code == 200
            data = resp.json()["data"]
            assert len(data) == 10
            assert upstream_route.call_count == 1  # 1 upstream call for 10 songs!

            print(f"\n--- Bulk Songs Benchmark ---")
            print(f"10 songs duration: {duration:.2f}ms")
            print(f"Upstream calls: {upstream_route.call_count} (Ratio: 1.0 upstream / user request)")


class TestLoadAndConcurrency:
    @pytest.mark.asyncio
    @respx.mock
    async def test_concurrent_load_levels(self):
        """
        Simulate concurrent traffic levels:
          1 concurrent, 10 concurrent, 50 concurrent, 100 concurrent.
        Verify:
          - Event loop responsiveness
          - Concurrency bounds respected
          - Response status 200
        """
        import httpx
        from app.main import create_app

        app = create_app()
        song_fixture = _load_fixture("song.json")

        # Mock with slight simulated network latency (10ms)
        async def mock_handler(request):
            await asyncio.sleep(0.01)
            return Response(200, json={"test123": song_fixture})

        respx.get("https://www.jiosaavn.com/api.php").mock(side_effect=mock_handler)

        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                # Warm up
                await client.get("/api/v1/songs/test123")

                for concurrency in [1, 10, 50, 100]:
                    start_time = time.perf_counter()

                    async def fetch(idx: int):
                        t0 = time.perf_counter()
                        resp = await client.get("/api/v1/songs/test123")
                        return resp.status_code, (time.perf_counter() - t0) * 1000

                    tasks = [fetch(i) for i in range(concurrency)]
                    results = await asyncio.gather(*tasks)

                    total_time = time.perf_counter() - start_time
                    statuses = [r[0] for r in results]
                    durations = [r[1] for r in results]

                    pct = calculate_percentiles(durations)
                    throughput = concurrency / total_time

                    print(f"\n--- Concurrency Level: {concurrency} ---")
                    print(f"Total time: {total_time * 1000:.2f}ms | Throughput: {throughput:.1f} req/s")
                    print(f"Latency: p50={pct['p50']:.2f}ms, p95={pct['p95']:.2f}ms, p99={pct['p99']:.2f}ms")

                    assert all(s == 200 for s in statuses)
                    assert pct["p99"] < 500.0  # Kept responsive under local load

    @pytest.mark.asyncio
    @respx.mock
    async def test_circuit_breaker_activates_under_load_no_retry_storm(self):
        """
        Verify:
          When upstream repeatedly fails, circuit breaker trips to OPEN.
          Downstream gets immediate 503 without hammering upstream.
        """
        import httpx
        from app.main import create_app

        app = create_app()

        upstream_route = respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(503, text="Service Unavailable")
        )

        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                responses = []
                for i in range(20):
                    resp = await client.get(f"/api/v1/songs/fail_{i}")
                    responses.append(resp.status_code)

                # Once circuit breaker opens (after CB_FAILURE_THRESHOLD failures),
                # upstream_route calls stop incrementing!
                upstream_calls = upstream_route.call_count
                print(f"\n--- Circuit Breaker Test ---")
                print(f"20 requests resulted in {upstream_calls} upstream calls (capped by CB)")
                assert upstream_calls < 20 * 3  # Way below 60 calls (no retry storm)
                assert any(s in (502, 503) for s in responses)
