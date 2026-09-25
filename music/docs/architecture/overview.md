# Architecture Overview

> This document describes the high-level architecture of the SWAY music provider API service,
> its layered design, request lifecycle, and key design principles.

---

## System Context

SWAY is an API service that provides a unified, clean JSON API over music streaming provider
backends. The initial backend is JioSaavn. The architecture is designed so that additional
providers (Spotify metadata, Apple Music, YouTube Music) can be plugged in without changing
the API contract or routing layer.

---

## High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            SWAY API SERVICE                             │
│                                                                         │
│  ┌──────────┐   ┌──────────────────────────────────────────────────┐   │
│  │          │   │                 FastAPI Application               │   │
│  │  Client  │──▶│  ┌──────────┐   ┌──────────┐   ┌──────────────┐ │   │
│  │ (browser │   │  │  Router  │──▶│ Provider │──▶│  SaavnClient  │ │   │
│  │  / app)  │   │  │  Layer   │   │  Layer   │   │  (httpx pool) │ │   │
│  │          │   │  └──────────┘   └──────────┘   └──────┬───────┘ │   │
│  └──────────┘   │                      ▲                │          │   │
│                 │                      │                ▼          │   │
│                 │               ┌──────┴───────┐  ┌──────────────┐│   │
│                 │               │MusicProvider │  │ CircuitBreak ││   │
│                 │               │  Interface   │  │  + Retry     ││   │
│                 │               └──────────────┘  └──────┬───────┘│   │
│                 │                                        │         │   │
│                 │  ┌──────────────────────────────────────────┐   │   │
│                 │  │          Cache Layer (TTLCache / Redis)   │   │   │
│                 │  └──────────────────────────────────────────┘   │   │
│                 └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────┬──────────────────────────────┘
                                           │ HTTPS
                                           ▼
                             ┌─────────────────────────┐
                             │  JioSaavn API (external) │
                             │  api.php + CDN           │
                             └─────────────────────────┘
```

---

## Provider Abstraction Diagram

```
                    ┌─────────────────────────┐
                    │    MusicProvider (ABC)   │
                    │─────────────────────────│
                    │ search()                │
                    │ get_song()              │
                    │ get_album()             │
                    │ get_playlist()          │
                    │ get_artist()            │
                    │ get_lyrics()            │
                    │ resolve_media()         │
                    └────────────┬────────────┘
                                 │ implements
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼─────────┐  ┌────▼──────┐  ┌───────▼──────┐
    │   SaavnProvider   │  │ (Future)  │  │   (Future)   │
    │───────────────────│  │ Spotify   │  │ AppleMusic   │
    │ SaavnClient       │  │ Provider  │  │ Provider     │
    │ SaavnParser       │  └───────────┘  └──────────────┘
    │ SaavnNormaliser   │
    │ SaavnMediaResolver│
    └───────────────────┘
```

The router layer depends **only** on `MusicProvider`. The active provider is resolved at startup
via dependency injection and injected into all routes via `Depends(get_music_provider)`.

---

## Request Lifecycle

```
Client Request
     │
     ▼
┌────────────────────────────────────────────┐
│  1. MIDDLEWARE LAYER                        │
│     • Generate X-Request-Id (UUID)          │
│     • Attach to structlog context           │
│     • CORS validation (allowlist check)     │
│     • Rate limit check (sliding window)     │
└────────────────────────┬───────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────┐
│  2. ROUTER LAYER                            │
│     • Route matching (/api/v1/...)          │
│     • Input validation (Pydantic)           │
│     • Inject MusicProvider via Depends()    │
│     • Call provider method                  │
└────────────────────────┬───────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────┐
│  3. PROVIDER LAYER (SaavnProvider)          │
│     • Check cache → HIT: return immediately │
│     • Build upstream request parameters     │
│     • Call SaavnClient                      │
│     • On response: parse → normalise        │
│     • Store in cache with appropriate TTL   │
│     • Return normalised model               │
└────────────────────────┬───────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────┐
│  4. CLIENT LAYER (SaavnClient)              │
│     • Check circuit breaker state           │
│       OPEN: raise CircuitOpenError          │
│       CLOSED/HALF-OPEN: proceed             │
│     • Acquire concurrency semaphore         │
│     • Execute httpx request (shared pool)   │
│     • On success: record success to CB      │
│     • On failure: record failure to CB      │
│     • Retry with exponential backoff+jitter │
│       (connection errors, 503, 429 only)    │
│     • Release semaphore                     │
└────────────────────────┬───────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────┐
│  5. UPSTREAM (JioSaavn api.php)             │
│     HTTPS GET with universal params         │
└────────────────────────┬───────────────────┘
                         │
               ┌─────────▼──────────┐
               │  Response flows     │
               │  back up the stack  │
               └─────────┬──────────┘
                         │
                         ▼
┌────────────────────────────────────────────┐
│  6. PARSER LAYER                            │
│     • Pydantic model instantiation          │
│     • Field alias mapping (camelCase→snake) │
│     • Type coercion (str→int for duration)  │
│     • Optional field handling               │
│     • Log warning on missing expected fields│
└────────────────────────┬───────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────┐
│  7. NORMALISER LAYER                        │
│     • Image URL upscaling (50x50→500x500)   │
│     • has_lyrics string→bool conversion     │
│     • Duration string→int conversion        │
│     • Provider-specific field→canonical     │
│       model field mapping                   │
└────────────────────────┬───────────────────┘
                         │
                         ▼
                   JSON Response
               (via FastAPI + Pydantic)
```

---

## Layer Descriptions

### Router Layer

**Responsibility:** HTTP surface — routes, input validation, and dependency wiring.

**Does:**
- Defines all route paths under `/api/v1/`
- Validates all request parameters via Pydantic `Query()` with explicit constraints
- Injects `MusicProvider` via `Depends(get_music_provider)`
- Maps provider responses to HTTP response models
- Returns appropriate HTTP status codes on provider errors

**Does not:**
- Know anything about JioSaavn
- Perform any HTTP I/O
- Contain business logic

**Key files:** `app/routers/search.py`, `app/routers/songs.py`, `app/routers/albums.py`,
`app/routers/playlists.py`, `app/routers/artists.py`, `app/routers/lyrics.py`

---

### Provider Layer

**Responsibility:** Orchestrate operations to fulfill a request — coordinate client calls,
apply caching, enforce invariants, and return normalised domain models.

**Does:**
- Implements `MusicProvider` interface
- Checks cache before calling client
- Collects song IDs and performs bulk `song.getDetails` fetches (eliminates N+1)
- Passes raw responses to Parser, then Normaliser
- Stores results in cache with per-type TTLs

**Does not:**
- Know anything about HTTP (delegates to client)
- Know anything about the raw JioSaavn response format (delegates to parser)
- Know anything about JSON serialisation (delegates to Pydantic models)

**Key files:** `app/providers/saavn/provider.py`

---

### Client Layer (SaavnClient)

**Responsibility:** Reliable HTTP communication with JioSaavn.

**Does:**
- Holds the shared `httpx.AsyncClient` reference
- Appends universal query parameters to all requests
- Enforces concurrency limit via `asyncio.Semaphore`
- Checks and updates circuit breaker state
- Executes retry logic with exponential backoff + jitter
- Returns raw HTTP response body (JSON-decoded dict)

**Does not:**
- Parse or normalise response data
- Implement caching
- Know anything about which endpoint is being called (accepts `__call` and params)

**Key files:** `app/providers/saavn/client.py`

---

### Parser Layer

**Responsibility:** Convert raw JioSaavn JSON dicts into typed internal models.

**Does:**
- Instantiates Pydantic models from raw response dicts
- Handles field aliases (`songId` → `song_id`)
- Handles optional/missing fields gracefully
- Emits structured warning logs for missing expected fields
- Rejects responses that fail minimum structural requirements

**Does not:**
- Perform any data transformation or normalisation
- Know anything about the canonical output format

**Key files:** `app/providers/saavn/parsers/song.py`, `.../album.py`, `.../artist.py`, etc.

---

### Normaliser Layer

**Responsibility:** Transform parsed provider-specific models into canonical domain models.

**Does:**
- Maps `SaavnSong` → `Song`
- Upscales image URLs
- Converts string booleans and string numbers to proper types
- Strips provider-specific metadata not needed by consumers

**Does not:**
- Make any HTTP calls
- Access cache
- Know the upstream response format

**Key files:** `app/providers/saavn/normaliser.py`

---

### Cache Layer

**Responsibility:** Reduce upstream load and improve response latency.

**Interface:**
```python
class CacheBackend(ABC):
    async def get(self, key: str) -> Any | None: ...
    async def set(self, key: str, value: Any, ttl_seconds: int) -> None: ...
    async def delete(self, key: str) -> None: ...
    async def clear(self) -> None: ...
```

**Implementations:**
- `TTLCacheBackend` — in-process `cachetools.TTLCache` (development / single-instance)
- `RedisCacheBackend` — Redis via `redis.asyncio` (production / multi-instance)

**Key files:** `app/cache/backend.py`, `app/cache/ttl.py`, `app/cache/redis.py`

---

### Circuit Breaker

**Responsibility:** Fast-fail when JioSaavn is degraded, preventing cascade failures.

**States:**
```
         ≥5 failures in 60s              probe success
CLOSED ─────────────────────▶ OPEN ─────────────────▶ CLOSED
  ▲                              │                       
  │         30s timeout          │ probe failure         
  └──────────────────────────────┘ (stays OPEN)          
```

**Configuration:**
| Parameter | Default | Environment Variable |
|---|---|---|
| Failure threshold | 5 | `CB_FAILURE_THRESHOLD` |
| Failure window | 60s | `CB_FAILURE_WINDOW_SECONDS` |
| Recovery timeout | 30s | `CB_RECOVERY_TIMEOUT_SECONDS` |

**Key files:** `app/resilience/circuit_breaker.py`

---

## Key Design Principles

### 1. Provider Abstraction — No JioSaavn in the Router

Routers are completely ignorant of JioSaavn. They call `MusicProvider` methods and return
`Song`, `Album`, `Playlist`, `Artist`, `Lyrics`, and `MediaInfo` models. Swapping the provider
requires zero changes to any router, middleware, or response model.

### 2. No N+1 — Always Bulk Fetch

The single most important performance principle. The provider layer **always** collects all
required song IDs before making upstream calls and fetches them in one `song.getDetails` call
with comma-separated `pids`. A search for 20 songs costs 2 upstream calls, not 21.

```python
# ALWAYS do this
async def search_songs(self, query: str, n: int, p: int) -> list[Song]:
    stubs = await self.client.autocomplete(query)
    song_ids = [s.id for s in stubs.songs.data[:n]]
    details = await self.client.get_songs_bulk(song_ids)  # ONE call
    return [self.normaliser.normalise_song(s) for s in details]

# NEVER do this
async def search_songs_wrong(self, query: str, n: int, p: int) -> list[Song]:
    stubs = await self.client.autocomplete(query)
    songs = []
    for stub in stubs.songs.data[:n]:
        detail = await self.client.get_song(stub.id)  # N separate calls ❌
        songs.append(self.normaliser.normalise_song(detail))
    return songs
```

### 3. Bounded Concurrency

All upstream calls are gated by `asyncio.Semaphore(SAAVN_MAX_CONCURRENT_REQUESTS)`. This prevents
a request burst from fan-out into hundreds of simultaneous upstream calls that trigger rate
limiting or exhaust the connection pool.

When bulk fetching across multiple batches, use:
```python
async with self._semaphore:
    results = await asyncio.gather(*[self._fetch_batch(ids) for ids in batches])
```

### 4. Fail Fast — Circuit Breaker + Short Timeouts

- Upstream request timeout: 5 seconds (configurable via `SAAVN_REQUEST_TIMEOUT_SECONDS`)
- Circuit opens after 5 consecutive failures
- When open: return `503 Service Unavailable` immediately (no upstream call)
- Inform clients via `Retry-After` header based on circuit recovery timeout

### 5. Schema Resilience

JioSaavn's API is undocumented. Every parser must tolerate schema drift:
- `extra='ignore'` on all Pydantic models
- All non-critical fields `Optional` with `None` defaults
- Warning log (not error) when an expected optional field is absent
- Alert on elevated field-missing warning rate

### 6. Media Isolation

Media URLs are ephemeral and legally ambiguous. They are:
- **Never** embedded in `Song` models
- **Never** cached with metadata TTL
- **Fully** isolated behind `MediaResolver`
- **Gracefully degraded** if resolution fails (rest of API continues working)

### 7. Versioned API Surface

All routes are under `/api/v1/`. When breaking changes are needed:
- New routes added at `/api/v2/`
- `/api/v1/` maintained for a deprecation period
- Deprecation communicated via `Deprecation` and `Sunset` response headers

---

## Environment Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `SAAVN_BASE_URL` | `https://www.jiosaavn.com/api.php` | JioSaavn API base URL |
| `SAAVN_MEDIA_KEY` | (none — required in prod) | DES decryption key for media URLs |
| `SAAVN_REQUEST_TIMEOUT_SECONDS` | `5` | Upstream HTTP request timeout |
| `SAAVN_MAX_CONCURRENT_REQUESTS` | `10` | Semaphore size for upstream calls |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated origin allowlist |
| `CACHE_BACKEND` | `memory` | `memory` or `redis` |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis URL (if `CACHE_BACKEND=redis`) |
| `SONG_CACHE_TTL_SECONDS` | `3600` | Song metadata cache TTL |
| `SEARCH_CACHE_TTL_SECONDS` | `300` | Search results cache TTL |
| `LYRICS_CACHE_TTL_SECONDS` | `86400` | Lyrics cache TTL |
| `MEDIA_CACHE_TTL_SECONDS` | `900` | Media URL cache TTL |
| `CB_FAILURE_THRESHOLD` | `5` | Circuit breaker failure count |
| `CB_FAILURE_WINDOW_SECONDS` | `60` | Circuit breaker measurement window |
| `CB_RECOVERY_TIMEOUT_SECONDS` | `30` | Circuit breaker recovery probe interval |
| `LOG_LEVEL` | `INFO` | Logging level |
| `LOG_FORMAT` | `json` | `json` or `pretty` |
