# Security Threat Model

> Threat model for the SWAY music provider API service.
> Scope: the SWAY API process, its dependencies, and its communication with the JioSaavn upstream.
> Out of scope: end-user device security, JioSaavn's own security posture.

---

## Methodology

Each threat is documented with:
- **Threat:** What the attacker does
- **Impact:** What happens if the attack succeeds
- **Likelihood:** Relative probability (Low / Medium / High)
- **Mitigation:** Controls implemented or required
- **Residual risk:** Risk remaining after mitigation

---

## Threat 1 — Server-Side Request Forgery (SSRF)

**Category:** Injection / Broken Access Control

### Threat
The application accepts JioSaavn URLs from user input (e.g., `GET /api/v1/resolve?url=...`) and
fetches them server-side to extract content IDs. An attacker supplies a crafted URL pointing to:
- `http://169.254.169.254/latest/meta-data/` — AWS EC2 Instance Metadata Service (IMDS)
- `http://10.0.0.1/admin` — internal VPC service
- `file:///etc/passwd` — local filesystem (if the HTTP client supports file URIs)
- `http://localhost:6379/` — internal Redis, databases

### Impact
- **Cloud credential theft:** IMDS access can yield IAM role credentials, enabling full cloud account compromise.
- **Internal network scanning:** Internal services (databases, admin panels) reachable without authentication.
- **Data exfiltration:** Contents of internal services returned in API response body.

### Likelihood
**High** — this is a well-known attack against proxy APIs. Automated scanners probe for it.

### Mitigation

```python
from urllib.parse import urlparse
import ipaddress

ALLOWED_HOSTNAMES = frozenset({"www.jiosaavn.com", "jiosaavn.com"})
PRIVATE_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # Link-local (IMDS)
    ipaddress.ip_network("::1/128"),           # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),          # IPv6 ULA
]

def validate_saavn_url(url: str) -> str:
    """
    Validate that a user-supplied URL is a legitimate JioSaavn URL.
    Returns the validated URL or raises ValueError.
    Must be called BEFORE any HTTP fetch.
    """
    parsed = urlparse(url)
    
    if parsed.scheme != "https":
        raise ValueError(f"Only HTTPS URLs allowed; got: {parsed.scheme!r}")
    
    if parsed.hostname not in ALLOWED_HOSTNAMES:
        raise ValueError(f"Hostname not in allowlist: {parsed.hostname!r}")
    
    # Resolve hostname and check for private IP
    import socket
    try:
        resolved_ip = socket.gethostbyname(parsed.hostname)
        ip_obj = ipaddress.ip_address(resolved_ip)
        for private_range in PRIVATE_RANGES:
            if ip_obj in private_range:
                raise ValueError(f"URL resolves to private IP: {resolved_ip}")
    except socket.gaierror:
        raise ValueError(f"Cannot resolve hostname: {parsed.hostname!r}")
    
    return url
```

**Additional control:** Do not expose a generic URL-fetch endpoint. Extract the ID from the URL
path client-side using `urllib.parse` — no server-side HTTP fetch required for ID extraction.

### Residual Risk
**Low** — after hostname allowlisting and DNS-level private IP checks, SSRF attack surface is
minimal. The remaining risk is DNS rebinding (attacker controls DNS TTL); mitigate by pinning
resolved IPs or using a library like `ssrf-guard`.

---

## Threat 2 — Input Validation Bypass / Resource Exhaustion

**Category:** Injection / Denial of Service

### Threat
An attacker submits:
- Query strings of 100,000+ characters (proxy-amplified to upstream)
- Comma-separated `pids` with 10,000 song IDs (triggers massive bulk fetch)
- Malformed IDs containing special characters (`../`, `%00`, `<script>`)
- Deeply nested or cyclical JSON in request body

### Impact
- **Upstream rate limiting:** JioSaavn bans the server IP.
- **Memory exhaustion:** Enormous responses fill server memory.
- **Slow query DoS:** Long-running upstream calls exhaust the connection pool.
- **Log injection:** Unvalidated strings written to logs containing newlines or control chars.

### Likelihood
**Medium** — common in publicly-exposed APIs.

### Mitigation

```python
from pydantic import BaseModel, Field
import re

SONG_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{1,32}$')

class SearchRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=200)
    n: int = Field(default=20, ge=1, le=50)
    p: int = Field(default=1, ge=1, le=100)

class SongDetailRequest(BaseModel):
    ids: str = Field(..., description="Comma-separated song IDs")
    
    @field_validator("ids")
    @classmethod
    def validate_ids(cls, v: str) -> str:
        id_list = [i.strip() for i in v.split(",")]
        if len(id_list) > 20:
            raise ValueError("Maximum 20 song IDs per request")
        for song_id in id_list:
            if not SONG_ID_PATTERN.match(song_id):
                raise ValueError(f"Invalid song ID format: {song_id!r}")
        return ",".join(id_list)
```

Global request body size limit configured at the ASGI server level:
```python
app.add_middleware(RequestSizeLimitMiddleware, max_size_bytes=64 * 1024)  # 64KB
```

### Residual Risk
**Low** — Pydantic validation + server-side limits reduce attack surface to near-zero.

---

## Threat 3 — CORS Misconfiguration

**Category:** Broken Access Control

### Threat
Wildcard CORS (`Access-Control-Allow-Origin: *`) allows any website to make browser-based
cross-origin requests to this API. An attacker hosts a malicious page that:
- Scrapes the API for music content without restriction
- Uses the API as a relay for upstream abuse (any browser becomes a bot)
- If cookies or auth are ever added: exfiltrates authenticated responses to arbitrary origins

### Impact
- **Content abuse:** Unlimited automated browser-based access with no attribution.
- **Credential leakage (future risk):** If authentication is added later, wildcard CORS becomes
  an immediate credential theft vector.
- **IP reputation:** Mass abuse from browser clients attributed to the server IP.

### Likelihood
**High for abuse** — automated scripts target unprotected APIs.  
**Low for credential theft** — no user authentication currently.

### Mitigation

```python
import os
from fastapi.middleware.cors import CORSMiddleware

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

# Explicit rejection of wildcard in production
if "*" in CORS_ALLOWED_ORIGINS and os.environ.get("ENVIRONMENT") == "production":
    raise RuntimeError(
        "Wildcard CORS origin ('*') is not allowed in production. "
        "Set CORS_ALLOWED_ORIGINS to an explicit allowlist."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=False,   # Never True without explicit auth implementation
    allow_methods=["GET"],     # API is read-only
    allow_headers=["X-Request-Id"],
)
```

### Residual Risk
**Low** — environment-variable allowlist with production guard prevents wildcard deployment.

---

## Threat 4 — Upstream Dependency Failure / Availability Attack

**Category:** Availability / Supply Chain

### Threat
JioSaavn's unofficial API:
- Becomes slow (timeouts > 5s) due to upstream degradation
- Returns 429 (rate limiting) due to high request volume
- Returns 5xx errors due to upstream deployment issues
- Is intentionally blocked/shut down

Without protection, all incoming requests block waiting for upstream, exhaust connection pools,
and cause cascading service failure.

### Impact
- **Service unavailability:** All endpoints return 503 or timeout.
- **Resource exhaustion:** Thread/connection pool exhausted by blocked requests.
- **Retry storms:** Clients retry aggressively, amplifying upstream load.

### Likelihood
**Medium** — unofficial APIs degrade periodically. JioSaavn has no SLA obligation to this service.

### Mitigation

**Circuit Breaker:**
```
CLOSED ──[5 failures/60s]──▶ OPEN ──[30s]──▶ HALF-OPEN
                                               │
                              [probe fails]◀───┤
                              [probe ok]──▶ CLOSED
```

When OPEN: return `503` with `Retry-After: 30` header immediately. No upstream call made.

**Graceful Degradation:**
- When circuit is open, return cached responses if available (even stale).
- Cache TTL extension during degradation: serve stale content with `X-Cache: stale` header.

**Rate Limiting (upstream protection):**
- Server-side sliding window: 100 req/IP/minute.
- Return `429 Too Many Requests` with `Retry-After` before forwarding to upstream.

**Client-side retry guidance:**
```json
{
  "error": "upstream_unavailable",
  "message": "JioSaavn API is temporarily unavailable",
  "retry_after_seconds": 30
}
```

### Residual Risk
**Low-Medium** — circuit breaker prevents cascade; cache reduces upstream dependency. If JioSaavn
permanently shuts down the unofficial API, the service requires a provider replacement.

---

## Threat 5 — Sensitive Data Logging

**Category:** Information Disclosure

### Threat
Request logging captures:
- JioSaavn session cookies (if any are used)
- Authorization headers
- The DES decryption key if injected into logs
- Full query parameters (which may contain content tokens)
- User IP addresses (PII in some jurisdictions)

### Impact
- **Key exposure:** `SAAVN_MEDIA_KEY` written to log files, accessible to log aggregators,
  third-party log services, or attackers with log access.
- **Privacy violation:** User search queries and IPs logged without disclosure.
- **Token leakage:** JioSaavn auth tokens exposed in upstream request logs.

### Likelihood
**Medium** — default logging configurations often log headers and query params.

### Mitigation

```python
import structlog

# Custom processor to scrub sensitive fields
def scrub_sensitive(logger, method, event_dict):
    SENSITIVE_KEYS = {"authorization", "cookie", "x-api-key", "media_key", "token"}
    for key in list(event_dict.keys()):
        if key.lower() in SENSITIVE_KEYS:
            event_dict[key] = "[REDACTED]"
    return event_dict

structlog.configure(
    processors=[
        scrub_sensitive,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
```

**Request logging policy:**
- Log: `method`, `path` (no query string), `status_code`, `duration_ms`, `request_id`
- Do NOT log: query parameters, request body, response body, cookies, auth headers
- IP addresses: log only first 3 octets (e.g., `192.168.1.xxx`) or use a hash

### Residual Risk
**Low** — structured logging with scrubbing and field allowlisting prevents accidental exposure.

---

## Threat 6 — Retry Storms and Exponential Amplification

**Category:** Availability

### Threat
When JioSaavn returns `429` or `503`, naive retry logic immediately retries N times. Under load:
- 100 incoming requests × 3 retries = 300 upstream calls within seconds
- If all fail, clients retry again → 900 upstream calls
- Exponential amplification triggers a ban or extended rate limiting

### Impact
- **IP ban:** JioSaavn blocks the server IP entirely.
- **Amplified load:** What started as degraded performance becomes complete unavailability.
- **Thundering herd:** Multiple server instances retry simultaneously without coordination.

### Likelihood
**Medium** — likely during any upstream degradation event.

### Mitigation

```python
import random
import asyncio

async def fetch_with_retry(client, params, max_retries=3):
    RETRYABLE_STATUS = {429, 503, 502, 504}
    NON_RETRYABLE_STATUS = {400, 401, 403, 404, 422}
    
    for attempt in range(max_retries + 1):
        try:
            response = await client.get(params=params)
            
            if response.status_code in NON_RETRYABLE_STATUS:
                raise ClientError(response.status_code)  # Don't retry
            
            if response.status_code in RETRYABLE_STATUS:
                if attempt == max_retries:
                    raise UpstreamError(response.status_code)
                
                # Respect Retry-After if present
                retry_after = response.headers.get("Retry-After")
                base_delay = float(retry_after) if retry_after else (2 ** attempt)
                # Add full jitter to prevent thundering herd
                delay = random.uniform(0, min(base_delay, 30.0))
                await asyncio.sleep(delay)
                continue
            
            return response
            
        except httpx.ConnectError:
            if attempt == max_retries:
                raise
            delay = random.uniform(0, min(2 ** attempt, 10.0))
            await asyncio.sleep(delay)
    
    raise UpstreamError("Max retries exceeded")
```

**Circuit breaker synergy:** After the circuit opens, retries are skipped entirely — the fast-fail
path prevents retry amplification at the cost of serving cached/degraded responses.

### Residual Risk
**Low** — exponential backoff + jitter + circuit breaker + Retry-After respect minimises storm risk.

---

## Threat 7 — Cache Poisoning

**Category:** Integrity

### Threat
A malformed, truncated, or attacker-influenced upstream response is stored in cache and served to
all subsequent users:
- JioSaavn returns an unexpected response format (e.g., HTML error page stored as "song data")
- A network error mid-response stores a partial JSON object
- An upstream redirect is followed to a malicious server (if SSRF is not mitigated)

### Impact
- **Data integrity:** All cache users receive corrupt/malicious data.
- **Denial of service:** Cache poisoned with error responses prevents legitimate access.
- **XSS (future risk):** If malicious strings are stored and served unescaped.

### Likelihood
**Low** — requires either upstream compromise or partial network failure coinciding with a cache write.

### Mitigation

```python
async def get_and_cache_song(self, song_id: str) -> Song | None:
    raw = await self.client.get_song(song_id)
    
    # Parse and validate BEFORE caching
    try:
        parsed = SaavnSongParser.parse(raw)  # Pydantic validation
        song = self.normaliser.normalise(parsed)
    except ValidationError as e:
        # Log the validation error and DO NOT cache
        logger.warning("upstream_validation_failed", song_id=song_id, error=str(e))
        raise UpstreamSchemaError(f"Response validation failed: {e}")
    
    # Only cache after successful validation
    await self.cache.set(f"song:{song_id}", song.model_dump(), ttl=SONG_TTL)
    return song
```

**Additional control:** Cache keys include a schema version hash. If the Pydantic model changes,
all cached entries for the previous version are automatically invalidated.

### Residual Risk
**Low** — validation before write means only structurally correct data enters the cache.

---

## Threat 8 — Cryptographic Key Exposure

**Category:** Sensitive Data Exposure

### Threat
The DES decryption key (`38346591`) is:
- Hardcoded in source code and visible in version control history
- Committed to public GitHub repositories (already the case for all reviewed OSS projects)
- Included in Docker images built from the source
- Logged accidentally (if `SAAVN_MEDIA_KEY` env var value appears in startup logs)

### Impact
- **Key exfiltration:** Trivially available to anyone reading the codebase.
- **Media circumvention:** Enables decryption of JioSaavn media URLs outside this service.
- **Legal risk:** Documented evidence of key use for circumvention.

### Likelihood
**High for exposure** — the key is already widely public.  
**N/A for operational impact** — the key is already public knowledge; this threat is primarily
about legal posture and operational hygiene, not confidentiality.

### Mitigation

```python
# config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    saavn_media_key: str = Field(
        ...,  # No default — must be explicitly configured
        description="DES key for JioSaavn media URL decryption. "
                    "Inject via SAAVN_MEDIA_KEY environment variable. "
                    "Do not commit to source control.",
    )
    
    model_config = ConfigDict(env_file=".env", env_file_encoding="utf-8")
```

**Startup validation:**
```python
@app.on_event("startup")
async def validate_config():
    settings = get_settings()
    if settings.saavn_media_key == "38346591":
        logger.warning(
            "media_key_is_default",
            message="SAAVN_MEDIA_KEY is the community-default key. "
                    "This is publicly known. Ensure this is intentional.",
        )
    if not settings.saavn_media_key:
        raise RuntimeError("SAAVN_MEDIA_KEY must be set.")
```

**Git hygiene:**
- `.env` in `.gitignore`
- `.env.example` with placeholder: `SAAVN_MEDIA_KEY=your_key_here`
- Pre-commit hook scans for the literal string `38346591` in tracked files
- GitHub secret scanning enabled on repository

**Important acknowledgement:** The key `38346591` is already public knowledge across the OSS
community (visible in vendz, cyberboysumanjay, naveennamani, and anxkhn repositories). The
confidentiality of the key is not achievable; this threat is managed through operational hygiene
(no hardcoding, env var injection) and legal posture (isolate behind `MediaResolver`, document
the risk, do not build core product identity on this mechanism).

### Residual Risk
**Low (operational)** — env var injection, git hygiene, and startup validation prevent
accidental hardcoding.  
**Medium (legal)** — use of the key remains legally ambiguous regardless of how it is stored.
This residual risk is accepted and documented; see [media-delivery.md](../research/media-delivery.md).

---

## Threat Summary

| # | Threat | Likelihood | Impact | Mitigation Status |
|---|---|---|---|---|
| 1 | SSRF via user-supplied URL | High | Critical | ✅ Hostname allowlist + IP range check |
| 2 | Input validation bypass / DoS | Medium | High | ✅ Pydantic validators + size limits |
| 3 | CORS misconfiguration | High | Medium | ✅ Env-var allowlist + prod guard |
| 4 | Upstream dependency failure | Medium | High | ✅ Circuit breaker + graceful degrade |
| 5 | Sensitive data logging | Medium | High | ✅ Structured log scrubbing |
| 6 | Retry storms | Medium | High | ✅ Exp backoff + jitter + CB |
| 7 | Cache poisoning | Low | Medium | ✅ Validate before cache write |
| 8 | Crypto key exposure | High | Low-Med | ✅ Env var / ⚠️ Legal risk remains |

---

## Controls Not In Scope (Deferred)

| Control | Rationale for Deferral |
|---|---|
| Authentication / API keys | No user data; add if abusive traffic is observed |
| mTLS between components | Single-service deployment; add on microservice split |
| WAF / DDoS protection | Handled at infrastructure layer (CDN / load balancer) |
| Penetration testing | Recommended before any public launch |
| GDPR / data residency | No user PII collected currently; revisit if auth is added |
