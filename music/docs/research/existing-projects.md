# Existing JioSaavn API Implementations — Comparative Survey

> A structured analysis of five community JioSaavn API projects. Each project is evaluated across
> architecture, runtime, HTTP client, endpoint discovery, parsing, error handling, caching,
> concurrency, URL resolution, media handling, security, maintenance quality, and bottlenecks.

---

## 1. `vendz/jiosaavn-api`

### Overview
Flask-based synchronous Python proxy. One of the earlier independent implementations. Simple, readable codebase — single `app.py` with minimal abstraction. Good starting point for understanding the raw API surface, but unsuitable as a production reference.

### Architecture
- **Runtime:** CPython + Flask (WSGI, synchronous)
- **Structure:** Monolithic — all routes, business logic, and HTTP calls in a single file or minimal module split
- **Dependency injection:** None — global state pattern
- **Testing:** None observed

### HTTP Client
- **Library:** `requests` (synchronous, blocking)
- **Pooling:** `requests.Session` not used persistently — creates new connections per logical operation
- **Timeouts:** Not configured — unbounded wait on upstream

### Endpoint Discovery
- Uses `__call=autocomplete.get` for search
- Uses `__call=webapi.get` with `token` + `type` for URL resolution (one of the cleaner URL-to-ID approaches)
- Uses standard base URL `https://www.jiosaavn.com/api.php`
- Universal params: `_format=json`, `_marker=0`, `api_version=4`, `ctx=web6dot0`

### Parsing Approach
- Direct dict access on JSON responses (`response['songs']`, etc.)
- Minimal defensive coding — `KeyError` on schema drift
- No Pydantic or dataclass layer; raw dicts propagated to response

### Error Handling
- Bare `try/except Exception` blocks in some routes
- No typed error hierarchy
- HTTP errors from upstream silently produce empty results or 500s
- No distinction between "JioSaavn returned 404" and "network error"

### Caching
- **None.** Every request hits JioSaavn.

### Concurrency
- WSGI threading model (Flask dev server: single-threaded by default)
- Under gunicorn: worker-per-request, no async
- No rate limiting

### URL Resolution
- Uses `webapi.get` + `token` (extracted from JioSaavn share URLs) — cleaner than HTML scraping
- Token extraction via string manipulation on the URL path

### Media Handling
- Decrypts `encrypted_media_url` using `pyDes` library
- Key: `38346591` (DES-ECB, PKCS5 padding)
- Hardcoded key in source
- Returns decrypted URL inline in song response — no separation of media from metadata
- Quality suffix replacement (`_96.mp4` → `_320.mp4`) done via string replace — fragile

### Security
- No CORS configuration (or wildcard in some forks)
- No input validation
- No SSRF protection
- DES key hardcoded in source
- No rate limiting

### Maintenance Quality
- Infrequent commits
- Minimal documentation
- No issue templates
- Requirements file present but not pinned

### Key Bottlenecks
1. Synchronous blocking I/O — one slow JioSaavn call blocks the entire Flask worker
2. No connection reuse
3. No cache — repeated identical queries each hit JioSaavn
4. No bulk song fetching — individual `song.getDetails` calls if needed

---

## 2. `cyberboysumanjay/JioSaavnAPI`

### Overview
The most-forked JioSaavn API implementation. Flask-based, synchronous, and the de facto reference for the community. Comprehensive endpoint coverage. Widely studied — most security and performance issues in the ecosystem trace back to patterns copied from this project.

### Architecture
- **Runtime:** CPython + Flask (WSGI, synchronous)
- **Structure:** Better modularised than vendz — separate files for routes, helpers, and config
- **Dependency injection:** None — module-level imports and helper functions
- **Testing:** Minimal

### HTTP Client
- **Library:** `requests`
- **Pooling:** No persistent session; new connection objects per operation
- **Timeouts:** Inconsistently applied

### Endpoint Discovery
- Full coverage: `autocomplete.get`, `search.getResults`, `search.getAlbumResults`, `search.getArtistResults`, `song.getDetails`, `content.getAlbumDetails`, `playlist.getDetails`, `artist.getArtistPageDetails`, `lyrics.getLyrics`
- Most complete endpoint map of any reviewed implementation

### Parsing Approach
- Direct dict access on JSON
- **HTML scraping for some operations:** Regex applied to raw JioSaavn page HTML to extract tokens or IDs when the JSON endpoint is insufficient
- String split for ID extraction from URLs: `url.split('/')[-1]` — fragile (see audit item #24)
- No schema validation layer

### Error Handling
- Some try/except blocks with generic `Exception`
- Returns `{}` or `[]` on errors in several places — silently swallows failures
- No HTTP status code propagation from upstream

### Caching
- **None.**

### Concurrency
- Single-threaded Flask dev server
- No async, no semaphore, no rate limiting
- Under production gunicorn: synchronous workers

### URL Resolution
- **Fragile HTML parsing approach:**
  - Fetches the JioSaavn song page HTML
  - Applies regex to extract the `window.__INITIAL_DATA__` JSON blob
  - Parses the blob to find the song ID
  - This breaks on any HTML structure change
- Also supports `webapi.get` token approach for direct share links

### Media Handling
- DES-ECB decryption with key `38346591`
- Uses `pyDes` library
- Hardcoded key
- Quality variants produced by string suffix replacement
- Download URLs returned inline with song metadata — TTL mismatch problem

### Security
- CORS: wildcard `*` in most forks
- No input validation or length limits
- SSRF risk: fetches user-supplied URLs server-side without allowlist validation
- No rate limiting
- DES key visible in source

### Maintenance Quality
- High fork count but moderate maintenance activity on primary repo
- Good README with API documentation
- Known issues remain open for extended periods
- Requirements not pinned — version drift risk in forks

### Key Bottlenecks
1. **N+1 problem (critical):** Search returns song stubs → each stub triggers a separate `song.getDetails` call. A 10-result search = 11 HTTP requests to JioSaavn.
2. Synchronous blocking — one slow call blocks worker
3. HTML scraping breaks on any upstream layout change
4. No cache — every search term re-fetched
5. String-split ID extraction silently produces wrong IDs on URL format changes

---

## 3. `naveennamani/JioSaavnAPI`

### Overview
FastAPI-based implementation — the first in this survey to use an async framework. Uses Pydantic for response models, enabling automatic OpenAPI/Swagger documentation. Better code organisation than the Flask implementations, but still uses synchronous `requests` instead of `httpx`, partially negating the async benefit.

### Architecture
- **Runtime:** CPython + FastAPI (ASGI, but I/O is partially blocking due to `requests`)
- **Structure:** Modular — separate router files, service functions, Pydantic models
- **Dependency injection:** FastAPI's `Depends()` used for some components
- **Testing:** Minimal — some basic route tests

### HTTP Client
- **Library:** `requests` (synchronous) — **critical mismatch with async runtime**
- **Issue:** Calling blocking `requests.get()` inside an async FastAPI handler blocks the event loop. Under load, this serialises all I/O despite the async framework.
- **Pooling:** No persistent session

### Endpoint Discovery
- Good coverage: search, song details, albums, playlists, artists, lyrics
- Does not implement all `search.*` variants (album/artist search missing in some versions)

### Parsing Approach
- Pydantic models for responses — first implementation to enforce typed output
- `Optional` fields used for some uncertain schema elements
- Still uses dict access for internal processing before Pydantic serialisation

### Error Handling
- FastAPI exception handlers registered
- More structured than Flask implementations
- HTTP status codes propagated more correctly
- Some upsteam error conditions still produce generic 500s

### Caching
- **None.**

### Concurrency
- ASGI event loop, but blocked by synchronous `requests` calls
- Effective concurrency: near-zero while I/O is in-flight
- No rate limiting, no semaphore

### URL Resolution
- Similar token-based approach via `webapi.get`
- Some path string manipulation

### Media Handling
- DES-ECB with the same community key
- Uses `pycryptodome` or `pyDes` (varies by fork)
- Same TTL mismatch issue — media URLs in song response

### Security
- CORS: varies — some configurations still use wildcard
- Input validation: Pydantic provides some (field type coercion), but no explicit length/pattern constraints on query parameters
- No explicit SSRF protection

### Maintenance Quality
- Clean, readable codebase
- Swagger docs auto-generated via FastAPI — excellent for endpoint discovery
- README well-maintained
- Smaller community than cyberboysumanjay fork

### Key Bottlenecks
1. **Blocking `requests` inside async handlers** — event loop starvation under load
2. No connection pooling
3. N+1 pattern still present in some search handlers
4. No cache

---

## 4. `anxkhn/jiosaavn-api`

### Overview
The most architecturally sophisticated Python implementation reviewed. FastAPI + `httpx.AsyncClient` + Pydantic v2 + `pydantic-settings`. Introduces a `CryptoService` class for DES logic, modular routers, and environment-based configuration. Closest to production-ready Python architecture, but still missing circuit breaker, persistent cache, and connection pooling.

### Architecture
- **Runtime:** CPython + FastAPI (ASGI, fully async)
- **Structure:** Clean layered structure:
  - `routers/` — FastAPI route definitions
  - `services/` — business logic (`SongService`, `SearchService`, etc.)
  - `clients/` — HTTP client wrappers
  - `models/` — Pydantic models
  - `config.py` — `pydantic-settings` based configuration
- **Dependency injection:** FastAPI `Depends()` used throughout
- **Testing:** Present, but coverage incomplete

### HTTP Client
- **Library:** `httpx.AsyncClient` — correct choice for async FastAPI
- **Pooling:** **Per-request `async with httpx.AsyncClient()`** — connection pool destroyed after each request. This is the key remaining performance issue.
- **Fix:** Instantiate at startup, inject via `Depends(get_http_client)`

### Endpoint Discovery
- Comprehensive: all major `__call` values covered
- Configurable base URL via `pydantic-settings`
- Universal params applied via a shared request builder

### Parsing Approach
- Pydantic v2 models with `model_config = ConfigDict(extra='ignore')`
- Field aliases for camelCase → snake_case mapping
- Robust against extra/unexpected fields
- Validators used for some field transformations

### Error Handling
- Custom exception classes (`SaavnAPIError`, `NotFoundError`, etc.)
- FastAPI exception handlers return structured JSON error responses
- Upstream HTTP errors mapped to appropriate HTTP status codes
- Still some cases where upstream error details are not propagated

### Caching
- **None.** In-memory LRU noted as a TODO in some versions.

### Concurrency
- Fully async — multiple requests served concurrently
- No semaphore on upstream calls — unbounded concurrency to JioSaavn
- No rate limiting
- No circuit breaker

### URL Resolution
- `webapi.get` + `token` approach
- Token extraction via `urllib.parse` — cleaner than string split

### Media Handling
- `CryptoService` class encapsulates DES logic — better separation than other implementations
- Key injected via environment variable `SAAVN_DECRYPT_KEY` — best practice in this survey
- Still returns media URLs in song response — TTL mismatch not solved
- Quality variants via suffix replacement

### Security
- CORS: configurable via settings — better than wildcard default
- Input validation: Pydantic enforces types, but no explicit length limits on query strings
- SSRF: some allowlist checking added but not comprehensive
- Crypto key from env var — correct approach

### Maintenance Quality
- Most actively maintained Python implementation
- Good README with Docker setup
- Issues addressed promptly
- Pinned requirements with `poetry.lock`
- Type hints throughout

### Key Bottlenecks
1. **Per-request `httpx.AsyncClient`** — TCP/TLS handshake overhead on every request
2. No cache — identical queries always hit upstream
3. No circuit breaker — upstream degradation causes full service degradation
4. No concurrency cap on upstream calls

---

## 5. `sumitkolhe/jiosaavn-api` (TypeScript / Bun)

### Overview
The most feature-complete and production-deployed implementation in this survey. Written in TypeScript, running on the Bun runtime, deployed at `saavn.dev`. Clean service layer, proper separation of concerns, full endpoint coverage including all search variants. Not directly usable as a Python reference, but the architecture and route design are the gold standard in this ecosystem.

### Architecture
- **Runtime:** Bun (JavaScript/TypeScript runtime with native HTTP)
- **Structure:** Clean MVC-style:
  - `routes/` — Hono router definitions
  - `services/` — `SongService`, `AlbumService`, `PlaylistService`, `ArtistService`, `LyricsService`, `SearchService`
  - `models/` — TypeScript interfaces for all entities
  - `lib/` — `CryptoLib`, `HttpClient`, `config`
- **Dependency injection:** Module imports (TypeScript module system)
- **Testing:** Jest/Bun test suite

### HTTP Client
- **Library:** Native Bun fetch / `node:https`
- **Pooling:** Bun manages connection pooling natively — no per-request client creation issue
- **Timeouts:** Configured globally

### Endpoint Discovery
- Most complete: all `search.*` variants, `song.getDetails` (bulk), `content.getAlbumDetails`, `playlist.getDetails`, `artist.getArtistPageDetails`, `lyrics.getLyrics`, `webapi.get`
- Pagination fully implemented for all paginated endpoints

### Parsing Approach
- TypeScript interfaces enforce response structure at compile time
- Zod validation in some versions for runtime schema enforcement
- Mapper functions transform raw API responses to clean model types
- Handles optional fields explicitly

### Error Handling
- Structured error types with HTTP status mappings
- Upstream errors surfaced with context
- Request validation via Zod before upstream calls

### Caching
- In-memory caching with `lru-cache` or similar
- Per-type TTLs configured
- Cache bypass header support in some versions

### Concurrency
- Bun's async model handles concurrency natively
- Service calls use `Promise.all` for parallel fetching — avoids N+1 correctly
- No explicit upstream rate limiting

### URL Resolution
- `webapi.get` token approach — clean, no HTML scraping
- `urllib` equivalent (URL parsing API) for token extraction from JioSaavn share URLs

### Media Handling
- DES decryption via Node.js `crypto` module (built-in, no third-party dep)
- Key configurable via environment variable
- Quality variants via URL suffix replacement
- **Media URLs returned separately from metadata** in some route designs — architectural improvement

### Security
- CORS configured via environment variable — not wildcard
- Input validation via Zod — length limits present
- Rate limiting via middleware in some versions
- DES key from env var

### Maintenance Quality
- Actively maintained, production-deployed at `saavn.dev`
- Full README with API docs, examples
- Pinned dependencies
- Docker + deployment documentation
- OpenAPI spec included

### Key Bottlenecks
1. No circuit breaker on upstream JioSaavn calls (observed in public version)
2. In-memory cache not shared across instances — horizontal scaling requires Redis
3. No explicit upstream concurrency cap

---

## Cross-Project Patterns and Lessons

### Universal Anti-Patterns

| Anti-Pattern | vendz | cyberboy | naveennamani | anxkhn | sumitkolhe |
|---|---|---|---|---|---|
| No cache | ✗ | ✗ | ✗ | ✗ | Partial |
| N+1 song fetching | ✗ | ✗ | ✗ | Partial fix | ✅ Fixed |
| DES key hardcoded | ✗ | ✗ | ✗ | ✅ Env var | ✅ Env var |
| Wildcard CORS | ✗ | ✗ | Partial | Configurable | Configurable |
| No input validation | ✗ | ✗ | Partial | Partial | ✅ Zod |
| No circuit breaker | ✗ | ✗ | ✗ | ✗ | ✗ |
| Sync HTTP in async | N/A | N/A | ✗ | ✅ Fixed | N/A |
| Per-request client | N/A | N/A | N/A | ✗ | N/A |
| Media in Song model | ✗ | ✗ | ✗ | ✗ | Partial |

### The N+1 Problem — Critical Path

Every Python implementation suffers from this in at least one code path:

```
search("arijit singh") 
  → JioSaavn returns 20 song stubs (no encrypted_media_url, limited metadata)
  → for song in stubs:
      song_detail = get_song_details(song.id)  # 20 separate HTTP calls
  → return combined results
```

Total: **21 HTTP calls** for a single search query.

**Correct approach** (as demonstrated by sumitkolhe and the bulk `pids` parameter):

```
search("arijit singh")
  → JioSaavn returns 20 song stubs  
  → ids = [s.id for s in stubs]
  → details = get_song_details_bulk(pids=",".join(ids))  # 1 HTTP call
  → return merged results
```

Total: **2 HTTP calls.** A 10.5× reduction in upstream traffic.

### Recommended Stack (Python)

Based on this survey, the recommended Python implementation stack is:

- **Framework:** FastAPI (ASGI, async-native, Pydantic v2 built-in)
- **HTTP Client:** `httpx.AsyncClient` — shared instance, lifespan-managed
- **Validation:** Pydantic v2 with explicit field validators and length constraints
- **Configuration:** `pydantic-settings` with `.env` file support
- **Crypto:** `pycryptodome` (`Crypto.Cipher.DES`) — avoid `pyDes` (pure Python, slow)
- **Cache:** `cachetools.TTLCache` (in-process) → Redis (production)
- **Circuit Breaker:** `pybreaker` or custom `asyncio` implementation
- **Logging:** `structlog` with JSON output
- **Observability:** Prometheus metrics via `prometheus-fastapi-instrumentator`
