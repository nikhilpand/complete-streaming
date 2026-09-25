# Analysis of Community Bottlenecks & Remediation

## 1. The $1+N$ Upstream Request Explosion

### Community Antipattern
Almost every open-source JioSaavn wrapper (`cyberboysumanjay`, `sumitkolhe`, `anxkhn`) suffers from search result expansion:

```
User Query: "Arijit Singh"
  │
  ├─> 1 request: autocomplete.get (returns 20 song IDs)
  │
  ├─> Loop over 20 songs:
  │     ├── request 1: song.getDetails (id_1)
  │     ├── request 2: song.getDetails (id_2)
  │     └── ...
  │     └── request 20: song.getDetails (id_20)
  │
  └─> Total: 21 upstream requests for ONE search!
```

### Consequences:
1. Search latency increases by $20 \times$ network roundtrips ($\sim 2-5$ seconds).
2. JioSaavn rate-limiting (HTTP 429) triggers frequently.
3. If 1 of the 20 sub-requests times out or fails, the whole search crashes.

### SWAY Remediation:
1. **Lightweight Default**: `GET /api/v1/search` returns the clean, normalized search items without making additional requests (exactly 1 upstream request).
2. **Explicit Bounded Enrichment**: Only if `enrich=true` is requested, SWAY deduplicates IDs, bounds candidates to `SEARCH_ENRICH_LIMIT=5`, and fetches all uncached candidates in **ONE** batch call (`pids=id1,id2,id3,id4,id5`).
3. **Upstream Request Count**: Reduced from 21 to **1** (default) or **2** (enriched).

---

## 2. Per-Request Client Re-creation

### Community Antipattern:
```python
# Seen across multiple FastAPI / Flask wrappers:
async def get_song(id: str):
    async with httpx.AsyncClient() as client:  # CREATED ON EVERY REQUEST
        resp = await client.get(...)
```

### Consequences:
- TCP handshake (3-way) on every single request.
- TLS 1.3 negotiation on every single request ($\sim 100-200$ ms penalty).
- No connection pool reuse; exhausts OS ephemeral ports (`TIME_WAIT` saturation).

### SWAY Remediation:
- Single application-level `httpx.AsyncClient` created during FastAPI lifespan startup.
- Configured with persistent connection limits (`HTTP_MAX_CONNECTIONS=20`, `HTTP_MAX_KEEPALIVE=10`).
- TLS sessions and keep-alive sockets reused across requests.

---

## 3. Stale Media URL Cache Poisoning

### Community Antipattern:
Embedding decrypted download/stream URLs directly inside the song metadata object and caching the combined object for 24 hours.

### Consequences:
- JioSaavn CDN audio URLs expire or rotate token signatures every few hours.
- When an end-user attempts to play a song from a warm cache, the player encounters an immediate HTTP 403 or broken stream.

### SWAY Remediation:
- `Song` contains metadata **only** (title, album, artists, duration, artwork).
- Streaming URLs are resolved exclusively via `MediaResolver` (`/api/v1/songs/{id}/media`).
- Media cache uses a short 5-minute TTL with zero stale-window tolerance (`stale_window=0`).
- Song metadata cache remains fresh for 1 hour without being invalidated by expired stream URLs.

---

## 4. Unbounded Concurrency

### Community Antipattern:
Using raw `asyncio.gather(*[fetch(id) for id in ids])` without limits.

### Consequences:
- When 10 users trigger concurrent bulk lookups, 200 requests hit upstream simultaneously.
- Rapid upstream socket drops and connection resets.

### SWAY Remediation:
- All upstream calls pass through `ProviderConcurrencyLimiter` backed by `asyncio.Semaphore(SAAVN_MAX_CONCURRENCY)`.
- Extra tasks queue cleanly in async memory rather than swamping the network.
