# Implementation Plan Audit

> Audit of every factual and architectural claim made in the original implementation plan.
> Each claim is classified and annotated with rationale and recommended action.

---

## Classification Legend

| Label | Meaning |
|---|---|
| ✅ CONFIRMED | Verified across multiple independent community implementations; stable. |
| ⚠️ OBSERVED BUT UNSTABLE | Seen working, but undocumented / could change without notice. |
| ❓ UNVERIFIED | Claimed without evidence; needs validation before relying on it. |
| 🚫 OUTDATED | Was once true; no longer accurate. |
| 💣 DANGEROUS DESIGN | Functional but actively harmful; must not ship as-is. |
| 🐢 PERFORMANCE RISK | Will work but will degrade under load. |
| 🔒 SECURITY RISK | Creates an exploitable attack surface or privacy violation. |
| 🏗️ ARCHITECTURAL RISK | Correct today but creates brittleness, coupling, or lock-in. |

---

## Claim-by-Claim Audit

### 1. Base URL `https://www.jiosaavn.com/api.php`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Observed across every community implementation reviewed (vendz, cyberboysumanjay, naveennamani, anxkhn, sumitkolhe). The endpoint has been stable for 5+ years of independent usage. No version suffix exists; all call multiplexing is done via the `__call` query parameter.

**Action:** Use as-is. Add a configurable `SAAVN_BASE_URL` environment variable as an escape hatch in case JioSaavn rotates the domain.

---

### 2. `__call=autocomplete.get`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Present in every search implementation reviewed. Returns a structured payload including `songs`, `albums`, `artists`, `playlists`, and `topquery` sections. The `query` + `includeMetaTags=1` parameters are well-documented in community code.

**Action:** Use. Prefer over `search.getResults` for general search because it returns multi-type results in a single round-trip.

---

### 3. `__call=search.getResults`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Song-specific paginated search. Accepts `q`, `n` (count), and `p` (page, 1-indexed). Returns a `results` array directly. Observed in multiple implementations including anxkhn and sumitkolhe.

**Action:** Use for paginated song-only search. Always validate `n` server-side (cap at 50).

---

### 4. `__call=song.getDetails`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Accepts a `pids` parameter (comma-separated song IDs). Returns full song metadata including `encrypted_media_url`, `image`, `lyrics_id`, `has_lyrics`, `duration`, `label`, etc. Bulk-fetch capable — fetch up to ~20 IDs per request, eliminating the N+1 pattern seen in naive implementations.

**Action:** Always use bulk `pids` fetching. Never call `song.getDetails` once per song in a loop.

---

### 5. `__call=content.getAlbumDetails`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Accepts `albumid`. Returns album metadata plus a `list` array of songs. Observed in vendz, cyberboysumanjay, and sumitkolhe implementations.

**Action:** Use. Verify that `list` always contains full song objects (not just IDs) to avoid needing secondary fetches.

---

### 6. `__call=playlist.getDetails`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Accepts `listid`. Returns playlist metadata plus song list. Observed in all reviewed implementations. Large playlists may not return all songs in one response — verify pagination behaviour.

**Action:** Use. Add pagination handling for playlists with more than 50 tracks.

---

### 7. `__call=artist.getArtistPageDetails`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Accepts `artistId`, `page` (0-indexed), `n_song`, and `n_album`. Returns artist biography, top songs, albums, and related artists. Observed in sumitkolhe and anxkhn implementations. Page indexing is 0-based (unlike search which is 1-based) — this inconsistency is a known gotcha.

**Action:** Use. Document the 0-based page index discrepancy prominently. Cap `n_song` and `n_album` at 50.

---

### 8. `__call=lyrics.getLyrics`

**Classification:** ✅ CONFIRMED

**Rationale:**  
Accepts `lyrics_id` (available on the song detail object as `lyrics_id` when `has_lyrics=true`). Returns a `lyrics` string. Observed across multiple implementations. Lyrics may contain HTML entities or line breaks as `<br>` tags.

**Action:** Use. Sanitise HTML before returning to clients. Cache aggressively — lyrics do not change.

---

### 9. DES-ECB Key `38346591` for Media URL Decryption

**Classification:** ⚠️ OBSERVED BUT UNSTABLE + 🔒 SECURITY RISK

**Rationale:**  
This hardcoded 8-byte DES key appears verbatim in vendz, cyberboysumanjay, naveennamani, and anxkhn. It has been stable long enough to be considered "public knowledge" in the OSS community, but:

- It is not documented by JioSaavn.
- It was almost certainly extracted via reverse engineering.
- DES-ECB is a broken cipher (no IV, deterministic, 56-bit effective key length).
- The key could change in a server-side update with zero notice to consumers.
- Using it **may constitute circumvention of an access control mechanism** under applicable law (see DMCA §1201 / IT Act equivalents).

The fact that it is widely known does not make it legally safe or technically stable.

**Action:**
- Isolate entirely behind a `MediaResolver` interface.
- Never hardcode in config files — inject via environment variable `SAAVN_MEDIA_KEY`.
- Add a startup health check that validates decryption produces a valid CDN URL.
- If it stops working, the `MediaResolver` implementation is the only component requiring change.
- Document the legal disclaimer prominently.

---

### 10. `allow_origins=['*']` CORS

**Classification:** 💣 DANGEROUS DESIGN + 🔒 SECURITY RISK

**Rationale:**  
Wildcard CORS allows any website in any browser to make credentialed cross-origin requests to the API. While JioSaavn content is not user-personalised (no user accounts in this proxy), the risk surface includes:

- API abuse from browser-hosted scripts (no rate limiting bypass protection).
- If authentication is ever added, wildcard CORS immediately creates credential leakage.
- Browsers will send cookies set on the domain to any requestor.

**Action:**  
- Replace with `CORS_ALLOWED_ORIGINS` environment variable (comma-separated allowlist).
- Default to `http://localhost:3000,http://localhost:5173` in development.
- Reject unrecognised origins with a proper 403, not a silent CORS block.
- Document that wildcard is explicitly disallowed in production.

---

### 11. Per-Request `async with httpx.AsyncClient()`

**Classification:** 🐢 PERFORMANCE RISK

**Rationale:**  
Creating a new `AsyncClient` per request defeats connection pooling. Each request incurs:
- TCP handshake overhead (~1 RTT)
- TLS handshake overhead (~1–2 RTTs)
- DNS resolution (unless OS-cached)

Under modest concurrency (>10 req/s) this causes measurable latency spikes and can exhaust local port ranges under high load.

**Action:**  
- Create a single `httpx.AsyncClient` at application startup (lifespan context manager in FastAPI).
- Share it across all provider calls via dependency injection.
- Configure `limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)`.
- Close the client on application shutdown.

---

### 12. Search → Fetch Every Song Individually

**Classification:** 🐢 PERFORMANCE RISK (N+1 Query Pattern)

**Rationale:**  
`search.getResults` returns song stubs. Multiple implementations (notably cyberboysumanjay) then call `song.getDetails` once per song to get full metadata. For a 20-result search page this creates 21 HTTP requests (1 search + 20 detail fetches) with cumulative latency.

**Action:**  
- Collect all song IDs from the search response.
- Make a single `song.getDetails` call with `pids=id1,id2,...,idN` (comma-separated, up to ~20).
- This collapses 21 requests into 2.
- Enforce a maximum of 20 IDs per bulk fetch to stay within observed server limits.

---

### 13. `download_urls: dict` in Song Model

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
Embedding download URLs inside the canonical `Song` model creates several problems:

- **TTL mismatch:** Song metadata (title, artist, album) is effectively immutable. CDN media URLs expire (typically within hours). Caching both together means either the cache TTL is too short (wasted metadata re-fetches) or too long (stale/broken media URLs served to clients).
- **Responsibility violation:** The `Song` model becomes a leaky abstraction that couples content metadata with ephemeral delivery state.
- **Client confusion:** Clients may store or re-use the URL beyond its valid window.
- **Decryption coupling:** Media URL decryption logic bleeds into the metadata parsing layer.

**Action:**  
- Remove `download_urls` from `Song` entirely.
- Add `has_media: bool` and `lyrics_id: str | None` only.
- Expose media resolution as a separate `/songs/{id}/media` endpoint.
- Return `MediaInfo` objects with an explicit `expires_hint` field.
- Cache metadata and media independently with different TTLs.

---

### 14. No Circuit Breaker

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
Without a circuit breaker, if JioSaavn's API becomes slow or returns errors, every incoming request will block waiting for an upstream timeout. Under load, this exhausts the thread/connection pool and causes cascading failure — the service becomes unavailable due to upstream degradation rather than its own failure.

**Action:**  
- Implement a circuit breaker (e.g., `pybreaker` or custom implementation) wrapping all `SaavnClient` calls.
- States: CLOSED (normal), OPEN (failing fast, no upstream calls), HALF-OPEN (probing).
- Thresholds: open after 5 consecutive failures within 60 seconds; probe after 30 seconds.
- Expose circuit state on the `/health` endpoint.

---

### 15. No Retry Policy

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
JioSaavn's API is an unofficial endpoint. Transient failures (TCP reset, momentary 5xx) are common. Without retries, these become user-visible errors unnecessarily.

**Action:**  
- Implement exponential backoff with jitter: `delay = min(base * 2^attempt + jitter, max_delay)`.
- Retry on: connection errors, `503`, `429` (after honouring `Retry-After` header).
- Do NOT retry on: `400`, `403`, `404` (client errors — retrying is wasteful).
- Maximum 3 retries per request.
- Only retry idempotent operations (all GET requests here qualify).

---

### 16. No Concurrency Limiting

**Classification:** 🐢 PERFORMANCE RISK

**Rationale:**  
Without a semaphore or rate limiter, a burst of incoming requests can fan out into an unbounded number of simultaneous upstream HTTP calls, potentially triggering JioSaavn rate limiting or IP bans. Additionally, unconstrained concurrency can exhaust the `AsyncClient` connection pool.

**Action:**  
- Use `asyncio.Semaphore(max_concurrent=10)` around all upstream HTTP calls in `SaavnClient`.
- Configure `max_concurrent` via environment variable `SAAVN_MAX_CONCURRENT_REQUESTS`.
- Add server-side rate limiting per IP using a sliding window counter (e.g., `slowapi`).

---

### 17. No Cache

**Classification:** 🐢 PERFORMANCE RISK

**Rationale:**  
All queries hit JioSaavn's API on every request. Many queries are highly cacheable:
- Song metadata: immutable, safe to cache for hours or days.
- Search results: cacheable for minutes.
- Lyrics: immutable, safe to cache indefinitely.
- Artist/album pages: cacheable for hours.
- Media URLs: short TTL (~30 minutes), must be cached separately.

**Action:**  
- Add an in-process LRU cache (e.g., `cachetools.TTLCache`) for development.
- Abstract behind a `CacheBackend` interface to swap Redis in production.
- Per-type TTLs: lyrics=24h, songs=1h, albums=1h, search=5min, media=15min.

---

### 18. Unversioned Routes `/search`, `/songs`

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
Unversioned routes make it impossible to introduce breaking changes without disrupting all existing consumers. Any response schema change becomes a silent breaking change.

**Action:**  
- Prefix all routes with `/api/v1/`.
- Document that v1 routes are stable; breaking changes increment the major version.
- Consider OpenAPI schema versioning for contract enforcement.

---

### 19. `get_id_from_url(url)` Fetching Arbitrary URLs

**Classification:** 🔒 SECURITY RISK (Server-Side Request Forgery — SSRF)

**Rationale:**  
If the `url` parameter is accepted from user input and passed to an HTTP client without validation, an attacker can supply internal network addresses:

```
url=http://169.254.169.254/latest/meta-data/  # AWS IMDS
url=http://10.0.0.1/admin
url=file:///etc/passwd
```

This can expose cloud instance metadata, internal service endpoints, or local filesystem content depending on the HTTP client configuration.

**Action:**  
- Validate the URL against an allowlist of hostnames **before** any fetch: `{"www.jiosaavn.com", "jiosaavn.com"}`.
- Reject any non-HTTPS scheme.
- Reject any URL whose resolved IP is in RFC 1918 / loopback / link-local ranges.
- Do not fetch the URL to "extract" an ID — parse the path client-side instead.

---

### 20. No Input Validation / Limits

**Classification:** 🔒 SECURITY RISK

**Rationale:**  
Without input validation:
- A query string of 10,000 characters is forwarded to JioSaavn (proxy-amplified request).
- A comma-separated `pids` with 1,000 IDs triggers a massive bulk fetch.
- Malformed IDs that contain shell metacharacters or SQL injection payloads reach upstream (less critical here, but still bad practice).

**Action:**  
- Maximum query string length: 200 characters.
- Maximum `pids` list: 20 IDs.
- Song/album/artist IDs must match `^[a-zA-Z0-9_-]{1,32}$`.
- Use Pydantic validators for all request models.
- Return `422 Unprocessable Entity` on validation failure, never forward bad input.

---

### 21. No Request IDs or Structured Logging

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
Without request IDs:
- It is impossible to correlate a client-reported error with a server-side log entry.
- Multi-step request traces (search → bulk fetch → decrypt) cannot be assembled.
- Upstream error responses from JioSaavn are silently swallowed or surfaced as generic 500s.

**Action:**  
- Generate a UUID request ID in middleware; attach to every log line and response header (`X-Request-Id`).
- Use structured logging (`structlog` or `python-json-logger`).
- Log fields: `request_id`, `method`, `path`, `status_code`, `duration_ms`, `upstream_calls`, `cache_hit`.
- Never log query parameters without sanitisation (they may contain sensitive tokens).

---

### 22. JioSaavn Coupling Throughout

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
If JioSaavn changes its API, the blast radius is the entire codebase. There is no separation between the API's contract with its clients and the provider's contract with JioSaavn.

**Action:**  
- Define a `MusicProvider` abstract base class with methods:
  - `search(query, page, limit) → SearchResults`
  - `get_song(id) → Song`
  - `get_album(id) → Album`
  - `get_playlist(id) → Playlist`
  - `get_artist(id, page) → Artist`
  - `get_lyrics(lyrics_id) → Lyrics`
  - `resolve_media(song_id) → MediaInfo`
- `SaavnProvider` implements `MusicProvider`.
- Routers depend only on `MusicProvider`, injected via FastAPI dependency.
- Future providers (Spotify, Apple Music, YouTube Music) implement the same interface.

---

### 23. Regex on Arbitrary HTML

**Classification:** 🐢 PERFORMANCE RISK + ⚠️ Fragility

**Rationale:**  
Parsing HTML with regex is inherently fragile — any whitespace change, attribute reorder, or tag addition in the upstream HTML breaks the regex silently (returning `None` or a wrong match). HTML parsing with a proper parser (`BeautifulSoup`, `lxml`) is safer and nearly as fast. However, the need for HTML parsing at all signals an underlying design problem: structured JSON endpoints should be preferred.

**Action:**  
- Prefer `webapi.get` + `type=song` to resolve a URL rather than scraping HTML.
- If HTML scraping is unavoidable, use `lxml` with XPath selectors rather than regex.
- Add integration tests that replay real HTML responses and assert correct extraction.

---

### 24. String Split for ID Extraction

**Classification:** 💣 DANGEROUS DESIGN (Fragile Parser)

**Rationale:**  
Pattern like `url.split('/')[-1]` or `url.split('-')[-1]` for ID extraction is extremely fragile:
- JioSaavn URLs contain slugs with variable segment counts.
- A slug change (e.g., adding a year suffix) silently produces wrong IDs.
- No validation that the extracted string is actually a valid ID format.

**Action:**  
- Use `urllib.parse.urlparse` to extract the path.
- Match the expected path pattern with a named-group regex: `r'/song/(?P<slug>[^/]+)/(?P<id>[a-zA-Z0-9]+)$'`.
- Validate the captured ID against the known JioSaavn ID format.
- Raise a `ValueError` with a descriptive message on mismatch — never return a silently wrong ID.

---

### 25. No Health Endpoints

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
Without health endpoints:
- Load balancers and orchestrators (Kubernetes, ECS) cannot determine if the service is ready.
- Operators have no way to verify upstream connectivity without making a real API call.
- Deployments cannot use readiness probes to avoid routing traffic to unready instances.

**Action:**  
- `GET /health/live` — liveness: returns `200 OK` if the process is running. No dependencies checked.
- `GET /health/ready` — readiness: checks upstream connectivity (lightweight probe to JioSaavn), cache connectivity, circuit breaker state. Returns `200` if all critical dependencies healthy, `503` otherwise.
- `GET /health/startup` — startup: one-time check run at boot (validates DES key, base URL reachability).

---

### 26. No Schema Change Detection

**Classification:** 🏗️ ARCHITECTURAL RISK

**Rationale:**  
JioSaavn's API is undocumented. Response schemas can change silently. Without detection:
- A missing required field causes a `ValidationError` that surfaces as a 500 to the client.
- A renamed field silently produces `None` values without error.
- A schema change in one response type can cascade across all dependent operations.

**Action:**  
- Use Pydantic models with `model_config = ConfigDict(extra='ignore')` so extra fields do not break parsing.
- Make all non-critical fields `Optional` with explicit defaults.
- Emit a structured warning log whenever an expected field is missing from an upstream response.
- Add a monitoring alert on elevated `field_missing` log events.
- Consider a weekly integration test against the live API that validates a known song ID returns the expected schema shape.

---

## Summary Table

| # | Claim | Classification |
|---|---|---|
| 1 | Base URL `api.php` | ✅ CONFIRMED |
| 2 | `autocomplete.get` | ✅ CONFIRMED |
| 3 | `search.getResults` | ✅ CONFIRMED |
| 4 | `song.getDetails` | ✅ CONFIRMED |
| 5 | `content.getAlbumDetails` | ✅ CONFIRMED |
| 6 | `playlist.getDetails` | ✅ CONFIRMED |
| 7 | `artist.getArtistPageDetails` | ✅ CONFIRMED |
| 8 | `lyrics.getLyrics` | ✅ CONFIRMED |
| 9 | DES-ECB key `38346591` | ⚠️ OBSERVED BUT UNSTABLE + 🔒 SECURITY RISK |
| 10 | Wildcard CORS | 💣 DANGEROUS DESIGN + 🔒 SECURITY RISK |
| 11 | Per-request `AsyncClient` | 🐢 PERFORMANCE RISK |
| 12 | N+1 song fetching | 🐢 PERFORMANCE RISK |
| 13 | `download_urls` in Song model | 🏗️ ARCHITECTURAL RISK |
| 14 | No circuit breaker | 🏗️ ARCHITECTURAL RISK |
| 15 | No retry policy | 🏗️ ARCHITECTURAL RISK |
| 16 | No concurrency limiting | 🐢 PERFORMANCE RISK |
| 17 | No cache | 🐢 PERFORMANCE RISK |
| 18 | Unversioned routes | 🏗️ ARCHITECTURAL RISK |
| 19 | Arbitrary URL fetch (SSRF) | 🔒 SECURITY RISK |
| 20 | No input validation | 🔒 SECURITY RISK |
| 21 | No request IDs / structured logging | 🏗️ ARCHITECTURAL RISK |
| 22 | JioSaavn coupling | 🏗️ ARCHITECTURAL RISK |
| 23 | Regex on HTML | 🐢 PERFORMANCE RISK + fragility |
| 24 | String split for ID extraction | 💣 DANGEROUS DESIGN |
| 25 | No health endpoints | 🏗️ ARCHITECTURAL RISK |
| 26 | No schema change detection | 🏗️ ARCHITECTURAL RISK |
