# JioSaavn Isolation & Boundary Specification

## 1. Non-Negotiable Isolation Policy

The JioSaavn provider integration within this codebase is **complete, tested (89 passing tests), and strictly frozen**.

All files belonging to JioSaavn are **READ-ONLY**.

Under no circumstances should any of the following occur:
- Rewriting, refactoring, or optimizing existing JioSaavn logic
- Renaming files or reorganizing JioSaavn directory structures
- Changing JioSaavn endpoint behavior or HTTP contract
- Modifying canonical SWAY models used by JioSaavn
- Modifying JioSaavn caching or normalisation behavior
- Replacing any JioSaavn provider implementation code

---

## 2. Inventory of Frozen JioSaavn Assets

The following files constitute the immutable JioSaavn implementation:

### A. Routers (`app/routers/`)
- `app/routers/search.py` — `GET /api/v1/search`
- `app/routers/songs.py` — `GET /api/v1/songs[/{id}, /{id}/media, /{id}/lyrics]`
- `app/routers/albums.py` — `GET /api/v1/albums/{id}`
- `app/routers/playlists.py` — `GET /api/v1/playlists/{id}`
- `app/routers/artists.py` — `GET /api/v1/artists/{id}[/songs, /albums]`
- `app/routers/lyrics.py` — `GET /api/v1/lyrics/{id}`
- `app/routers/health.py` — `GET /health/live`, `/health/ready`, `/metrics`
- `app/routers/__init__.py`

### B. Provider Services & Engine (`app/providers/saavn/`)
- `app/providers/saavn/provider.py` — `SaavnProvider` implementation
- `app/providers/saavn/client.py` — `SaavnClient` HTTP client with retry and jitter
- `app/providers/saavn/parser.py` — Raw JSON defensive parsing & schema drift detection
- `app/providers/saavn/normaliser.py` — Domain model normalization
- `app/providers/saavn/resolver.py` — SSRF-safe URL parsing & host allowlist
- `app/providers/saavn/endpoints.py` — JioSaavn `__call` parameter registry
- `app/providers/saavn/crypto.py` — Isolated DES-ECB media stream decryption
- `app/providers/saavn/__init__.py`

### C. Core Infrastructure (`app/core/`)
- `app/core/cache.py` — `MemoryTTLCache` with Stale-While-Revalidate
- `app/core/circuit_breaker.py` — 3-state Circuit Breaker FSM
- `app/core/concurrency.py` — `ProviderConcurrencyLimiter`
- `app/core/errors.py` — Core provider error hierarchy
- `app/core/http_client.py` — Shared connection-pooled AsyncClient
- `app/core/logging_config.py` — ContextVar request ID & structured formatter
- `app/core/__init__.py`

### D. Models & Configuration
- `app/models.py` — Canonical SWAY models (`Song`, `MediaInfo`, `Album`, `Artist`, `Playlist`, `Lyrics`, `SearchResults`, `APIResponse`)
- `app/config.py` — Pydantic-settings environment variables
- `app/providers/base.py` — `MusicProvider` abstract interface

### E. Existing Test Suites (`tests/`)
- `tests/unit/test_parser.py`
- `tests/unit/test_cache.py`
- `tests/unit/test_circuit_breaker.py`
- `tests/unit/test_normaliser.py`
- `tests/security/test_ssrf.py`
- `tests/integration/test_api.py`
- `tests/property/test_properties.py`
- `tests/performance/test_benchmarks.py`
- `tests/fixtures/song.json`
- `tests/fixtures/search.json`
- `tests/fixtures/lyrics.json`

---

## 3. Extension Rules for YouTube Music

1. **Namespace Isolation**: All YouTube Music code resides strictly in `app/youtube/`.
2. **Route Isolation**: All YouTube Music routes reside strictly under `/api/v1/youtube/*`.
3. **Configuration Isolation**: YouTube settings are defined independently in `app/youtube/config.py`.
4. **App Entry Point Integration (`app/main.py`)**:
   The ONLY permitted modification to `app/main.py` is the additive registration of the YouTube router:
   ```python
   # Additive only:
   from app.youtube.router import router as youtube_router
   app.include_router(youtube_router, prefix="/api/v1/youtube")
   ```
   No existing Saavn routers, lifespan callbacks, or error handlers may be altered.
5. **Lifespan Integration**: If YouTube resources require background startup/shutdown (such as worker pool cleanup), they must execute in their own isolated initialization path without touching `app.state.provider` (which belongs to Saavn).
6. **Regression Verification**: A dedicated regression suite `tests/regression/jiosaavn_unchanged/` must execute the entire JioSaavn test battery and verify zero regressions.
