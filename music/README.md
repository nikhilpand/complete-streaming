# SWAY Saavn Provider

A production-grade, async FastAPI service wrapping the JioSaavn internal API.  
Designed as a **provider plugin** for the SWAY music engine — not a standalone app.

## Architecture

```
SWAY Music Engine
        │
        ▼
 MusicProvider (ABC)
        │
   ┌────┼────┐
   ▼    ▼    ▼
 Saavn  YT  Future
```

JioSaavn is **one provider**. The SWAY engine imports `MusicProvider`, not `SaavnProvider`.

## Quick Start

```bash
# Install
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env (CORS origins, etc.)

# Run
python -m uvicorn app.main:app --reload --port 8000

# Test
pip install -r requirements-dev.txt
pytest -v
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/search?q=...` | Search songs, albums, artists, playlists |
| `GET` | `/api/v1/songs/{id}` | Song metadata |
| `GET` | `/api/v1/songs?id=a,b,c` | Bulk songs (max 20, ONE upstream call) |
| `GET` | `/api/v1/songs?link=...` | Song by JioSaavn URL |
| `GET` | `/api/v1/songs/{id}/media` | Resolve streaming URLs (separate from metadata) |
| `GET` | `/api/v1/songs/{id}/lyrics` | Song lyrics via lyrics_id |
| `GET` | `/api/v1/albums/{id}` | Album with tracklist |
| `GET` | `/api/v1/albums?link=...` | Album by URL |
| `GET` | `/api/v1/playlists/{id}` | Playlist with songs |
| `GET` | `/api/v1/playlists?link=...` | Playlist by URL |
| `GET` | `/api/v1/artists/{id}` | Artist metadata |
| `GET` | `/api/v1/artists/{id}/songs` | Paginated artist songs |
| `GET` | `/api/v1/artists/{id}/albums` | Paginated artist albums |
| `GET` | `/api/v1/lyrics/{id}` | Lyrics by lyrics_id |
| `GET` | `/health/live` | Liveness (no upstream calls) |
| `GET` | `/health/ready` | Readiness (circuit breaker state) |
| `GET` | `/metrics` | Operational metrics |

## Key Design Decisions

### Song ≠ Media
`Song` model carries **metadata only**. Streaming URLs are resolved separately via `GET /songs/{id}/media` and cached with a short TTL (5 min). This prevents stale CDN URLs from contaminating long-lived song cache entries.

### No N+1
Search returns lightweight results. Full details require explicit follow-up calls. Bulk song fetch uses ONE upstream request (`pids=a,b,c`), not N.

### Bounded Concurrency
`asyncio.Semaphore` limits concurrent upstream requests (default: 5). Search enrichment never fires 20 simultaneous upstream calls.

### Circuit Breaker
CLOSED → OPEN → HALF_OPEN cycle. If JioSaavn fails repeatedly, all requests get fast 503s instead of slow timeouts.

### Cache with Stale-While-Revalidate
Cache returns stale data immediately while refreshing in the background. Different TTLs per resource type. Media URLs get short TTL with NO stale window.

### SSRF Protection
User-supplied URLs are validated locally (scheme, hostname allowlist, path format) before any upstream request. Never fetches arbitrary URLs.

### Retry with Backoff
Only retryable errors (408, 502, 503, 504, timeouts) are retried. Exponential backoff + jitter prevents retry storms. Non-retryable errors (400, 401, 403, 404) propagate immediately.

## Project Structure

```
app/
├── main.py                     # FastAPI app factory + lifespan
├── config.py                   # All settings from env
├── models.py                   # Canonical SWAY models
├── core/
│   ├── cache.py                # TTL cache + stale-while-revalidate
│   ├── circuit_breaker.py      # CLOSED/OPEN/HALF_OPEN
│   ├── concurrency.py          # Semaphore-backed limiter
│   ├── errors.py               # Error hierarchy → HTTP status
│   ├── http_client.py          # Shared httpx.AsyncClient factory
│   └── logging_config.py       # Request ID + structured logging
├── providers/
│   ├── base.py                 # MusicProvider ABC
│   └── saavn/
│       ├── provider.py         # SaavnProvider (implements MusicProvider)
│       ├── client.py           # HTTP client with retry + CB
│       ├── parser.py           # Raw JSON → intermediate dicts
│       ├── normaliser.py       # Intermediate → canonical models
│       ├── endpoints.py        # __call parameter registry
│       ├── resolver.py         # SSRF-safe URL validator
│       └── crypto.py           # Optional media URL decryption
├── routers/
│   ├── search.py
│   ├── songs.py
│   ├── albums.py
│   ├── playlists.py
│   ├── artists.py
│   ├── lyrics.py
│   └── health.py
docs/
├── research/
│   ├── plan-audit.md
│   ├── existing-projects.md
│   ├── endpoint-map.md
│   └── media-delivery.md
├── architecture/
│   └── overview.md
└── security/
    └── threat-model.md
tests/
├── unit/
├── integration/
└── security/
```

## SWAY Integration

```python
from app.providers.base import MusicProvider
from app.providers.saavn.provider import SaavnProvider

# The engine only knows about MusicProvider
provider: MusicProvider = build_saavn_provider()

# All operations are provider-agnostic
results = await provider.search("arijit singh")
song = await provider.get_song("some_id")
media = await provider.resolve_media(song)
```

## Environment Variables

See [`.env.example`](.env.example) for all configurable values.

## License

Private — for SWAY music engine internal use.
