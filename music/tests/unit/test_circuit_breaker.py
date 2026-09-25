"""
Unit tests for the circuit breaker.
"""

import pytest

from app.core.circuit_breaker import CBState, CircuitBreaker
from app.core.errors import ProviderUnavailable


@pytest.mark.asyncio
class TestCircuitBreaker:
    async def test_starts_closed(self):
        cb = CircuitBreaker(provider="test", failure_threshold=3, timeout=1.0)
        assert cb.state == CBState.CLOSED

    async def test_closes_after_threshold_failures(self):
        cb = CircuitBreaker(provider="test", failure_threshold=3, timeout=1.0)

        for _ in range(3):
            with pytest.raises(ValueError):
                await cb.call(self._fail_fn)

        assert cb.state == CBState.OPEN

    async def test_open_rejects_immediately(self):
        cb = CircuitBreaker(provider="test", failure_threshold=1, timeout=100.0)

        with pytest.raises(ValueError):
            await cb.call(self._fail_fn)

        assert cb.state == CBState.OPEN

        with pytest.raises(ProviderUnavailable):
            await cb.call(self._ok_fn)

    async def test_success_decrements_failure_count(self):
        cb = CircuitBreaker(provider="test", failure_threshold=3, timeout=1.0)

        # 2 failures (below threshold)
        for _ in range(2):
            with pytest.raises(ValueError):
                await cb.call(self._fail_fn)

        # 1 success brings count down
        await cb.call(self._ok_fn)

        # Should still be closed — we had 2 failures, 1 success, net=1
        assert cb.state == CBState.CLOSED

    async def test_status_dict(self):
        cb = CircuitBreaker(provider="test", failure_threshold=3, timeout=1.0)
        status = cb.status_dict()
        assert status["state"] == "closed"
        assert status["failure_count"] == 0

    # Helpers

    @staticmethod
    async def _ok_fn():
        return "ok"

    @staticmethod
    async def _fail_fn():
        raise ValueError("simulated failure")
