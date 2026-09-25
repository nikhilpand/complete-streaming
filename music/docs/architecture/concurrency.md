# SWAY Concurrency & Resilience Architecture

## 1. Concurrency Limiting (`ProviderConcurrencyLimiter`)

Unbounded concurrency against unofficial upstream APIs triggers HTTP 429 (Too Many Requests), Cloudflare challenge barriers, or silent IP blacklisting.

SWAY implements a semaphore-bounded concurrency governor:

```
Incoming Tasks
  │  │  │  │  │  │  │  │
  ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼
┌─────────────────────────┐
│   asyncio.Semaphore     │  Max Concurrency = SAAVN_MAX_CONCURRENCY (default: 5)
└─────────────────────────┘
  │        │        │
  ▼        ▼        ▼
Active Upstream Connections (Bounded <= 5)
```

### `gather_bounded` Pattern
When multiple concurrent operations must run (e.g. multi-song enrichment or search post-processing), standard `asyncio.gather` launches all tasks simultaneously. SWAY's `ProviderConcurrencyLimiter.gather_bounded()` queues tasks through the semaphore:

- **Bounded Execution**: Maximum concurrent tasks never exceed `SAAVN_MAX_CONCURRENCY`.
- **Partial Failure Resilience**: Uses `return_exceptions=True` so a single failing task does not abort the entire batch.

---

## 2. Circuit Breaker (`CircuitBreaker`)

To prevent cascade failures and socket exhaustion when upstream services degrade, SWAY utilizes a three-state finite state machine:

```
            ┌────────────────────────────────────────┐
            │                                        │
            ▼                                        │
      ┌───────────┐      Threshold Failures    ┌───────────┐
      │  CLOSED   │ ─────────────────────────> │   OPEN    │
      └───────────┘                            └───────────┘
            ▲                                        │
            │ Successes >= Threshold                 │ Cooldown Elapsed
            │                                        ▼
            │                                  ┌───────────┐
            └───────────────────────────────── │ HALF-OPEN │
                       Any Failure             └───────────┘
```

### State Transitions

1. **CLOSED**:
   - Requests execute normally.
   - Successful requests reduce failure counters.
   - Consecutive failures reaching `CB_FAILURE_THRESHOLD` (default: 5) trip circuit to **OPEN**.

2. **OPEN**:
   - All inbound requests immediately fail fast with HTTP 503 (`ProviderUnavailable`).
   - Zero upstream network traffic is generated.
   - After `CB_TIMEOUT` (default: 30s), transitions to **HALF-OPEN**.

3. **HALF-OPEN**:
   - A single trial request is permitted through to probe upstream recovery.
   - If trial fails: Immediately re-opens for another cooldown period.
   - If trial succeeds: Upon reaching `CB_SUCCESS_THRESHOLD` (default: 2), resets to **CLOSED**.

---

## 3. Retry Policy & Anti-Storm Backoff

The client executes retries only on transient failures:

### Retryable Errors
- HTTP 408 (Request Timeout)
- HTTP 502 (Bad Gateway)
- HTTP 503 (Service Unavailable)
- HTTP 504 (Gateway Timeout)
- Network disconnects & socket timeouts

### Non-Retryable Errors (Fail Fast)
- HTTP 400 (Bad Request)
- HTTP 401 (Unauthorized)
- HTTP 403 (Forbidden)
- HTTP 404 (Not Found)
- Schema validation errors (`ProviderSchemaChanged`)

### Exponential Backoff with Jitter
To prevent synchronized "retry storms", backoff incorporates randomized jitter:

$$\text{Delay} = \min\left(\text{base} \times 2^{\text{attempt}-1} + \text{uniform}(0, \text{jitter} \times \text{base}), \text{max\_delay}\right)$$

This spreads retries evenly across the timeline.
