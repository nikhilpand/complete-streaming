# Media Delivery — Mechanism, Risk, and Design Response

> This document describes how JioSaavn media URLs are obtained and decrypted, the risks this
> creates, and the architectural pattern adopted in this project to isolate and contain those risks.

---

## Current State

JioSaavn song detail responses (via `song.getDetails`) include an `encrypted_media_url` field
containing a Base64-encoded ciphertext. Multiple independent community implementations decrypt this
ciphertext using:

- **Algorithm:** DES (Data Encryption Standard)
- **Mode:** ECB (Electronic Codebook — no IV)
- **Padding:** PKCS#5
- **Key:** `38346591` (8 bytes, ASCII)
- **Encoding:** Base64 (decode before decrypt)

The decrypted result is a CDN URL pointing to an AAC audio stream, typically ending in `_96.mp4`
(96 kbps). This URL can be manipulated by replacing the quality suffix to request higher bitrates
(see [endpoint-map.md](endpoint-map.md) — Media Quality Suffixes).

### Decryption Reference (Python)

```python
import base64
from Crypto.Cipher import DES

MEDIA_KEY = b"38346591"  # Must come from env var, not hardcoded

def decrypt_media_url(encrypted_b64: str) -> str:
    """
    Decrypt a JioSaavn encrypted_media_url.
    Returns a CDN URL string, or raises ValueError on failure.
    
    WARNING: This mechanism is community-documented and may break without notice.
    Verify behaviour in integration tests before each release.
    """
    cipher = DES.new(MEDIA_KEY, DES.MODE_ECB)
    ciphertext = base64.b64decode(encrypted_b64)
    decrypted = cipher.decrypt(ciphertext)
    # Remove PKCS5 padding
    pad_len = decrypted[-1]
    if not (1 <= pad_len <= 8):
        raise ValueError(f"Invalid PKCS5 padding byte: {pad_len}")
    url = decrypted[:-pad_len].decode("utf-8")
    if not url.startswith("https://"):
        raise ValueError(f"Decrypted value is not a CDN URL: {url[:30]!r}")
    return url
```

> ⚠️ Never hardcode `MEDIA_KEY` in source. Inject via `SAAVN_MEDIA_KEY` environment variable.
> Fall back to the community default only in development mode with an explicit warning log.

---

## Security Boundary

> [!CAUTION]
> **This mechanism may constitute circumvention of a technical access control measure.**
>
> DES-ECB was used by JioSaavn to encrypt CDN URLs — even if weakly. Using a reverse-engineered
> key to decrypt these URLs **may** violate:
> - **DMCA §1201** (anti-circumvention, USA)
> - **IT Act §66** (computer access without authorisation, India)
> - **JioSaavn Terms of Service** (automated access, scraping, circumvention)
>
> The fact that the key is widely known in the open-source community does not establish legality.
> **This application must not build its core identity or business model around this mechanism.**
> It must be isolated, documented, and replaceable.

---

## Design Response

The project treats media resolution as a **separately bounded, explicitly fragile** capability:

### 1. MediaResolver Interface

All media URL resolution is behind a `MediaResolver` abstract interface:

```python
from abc import ABC, abstractmethod
from app.models.media import MediaInfo

class MediaResolver(ABC):
    @abstractmethod
    async def resolve(self, song_id: str, encrypted_media_url: str) -> MediaInfo:
        """
        Resolve an encrypted media URL to a list of quality-ordered streams.
        
        Raises:
            MediaResolutionError: if decryption fails or CDN URL is invalid.
        """
        ...
```

The `SaavnDESMediaResolver` class implements this interface using the community-documented DES
approach. If the mechanism changes, **only this class requires replacement**.

### 2. Song Model Isolation

`download_urls` is **never embedded inside the canonical `Song` model.**

```python
# CORRECT
class Song(BaseModel):
    id: str
    title: str
    artist: str
    album: str
    duration_seconds: int
    image_url: str
    has_media: bool           # True if encrypted_media_url is present
    lyrics_id: str | None     # For lyrics fetch
    # NO download_urls, NO encrypted_media_url, NO streams

# WRONG (never do this)
class Song(BaseModel):
    ...
    download_urls: dict       # ❌ TTL mismatch, decryption coupling
    encrypted_media_url: str  # ❌ Internal implementation detail leaked
```

### 3. Separate Endpoint and Lifecycle

Media resolution is exposed as a distinct endpoint:

```
GET /api/v1/songs/{song_id}/media
```

This endpoint:
- Accepts `quality` query parameter (`96`, `160`, `320` — defaults to `96`)
- Calls `MediaResolver.resolve()` internally
- Returns `MediaInfo` (not embedded in `Song`)
- Is cached with a **short TTL** (15 minutes, configurable via `MEDIA_CACHE_TTL_SECONDS`)
- Is never cached alongside song metadata

### 4. Cache TTL Separation

| Resource | Cache TTL | Rationale |
|---|---|---|
| `Song` metadata | 60 minutes | Immutable; title/artist/album don't change |
| `Album` metadata | 60 minutes | Immutable |
| Lyrics | 24 hours | Immutable |
| Search results | 5 minutes | Freshness matters |
| `MediaInfo` / media URLs | 15 minutes | CDN URLs expire; short TTL required |

Storing `MediaInfo` alongside `Song` with a 60-minute TTL would serve expired CDN URLs.
Storing both with a 15-minute TTL would cause unnecessary metadata re-fetches.

---

## MediaInfo Model

```python
from datetime import datetime
from pydantic import BaseModel

class MediaStream(BaseModel):
    quality: str          # Human-readable: "96kbps", "160kbps", "320kbps"
    url: str              # CDN URL to the audio stream
    mime_type: str        # Always "audio/mp4" for JioSaavn AAC streams
    bitrate_kbps: int     # Numeric: 96, 160, 320
    
class MediaInfo(BaseModel):
    song_id: str          # References Song.id
    provider: str         # "saavn" — for future multi-provider support
    streams: list[MediaStream]  # Ordered lowest to highest quality
    resolved_at: datetime # UTC timestamp of resolution
    expires_hint: datetime | None  # Best-effort CDN URL expiry estimate
    
    @property
    def best_stream(self) -> MediaStream | None:
        """Return the highest-quality available stream."""
        return self.streams[-1] if self.streams else None
    
    @property
    def default_stream(self) -> MediaStream | None:
        """Return the 96kbps stream (default quality)."""
        return next((s for s in self.streams if s.bitrate_kbps == 96), None)
```

### Example Response

```json
{
  "song_id": "aBcDeFgH",
  "provider": "saavn",
  "streams": [
    {
      "quality": "96kbps",
      "url": "https://aac.saavncdn.com/.../song_96.mp4",
      "mime_type": "audio/mp4",
      "bitrate_kbps": 96
    },
    {
      "quality": "160kbps",
      "url": "https://aac.saavncdn.com/.../song_160.mp4",
      "mime_type": "audio/mp4",
      "bitrate_kbps": 160
    },
    {
      "quality": "320kbps",
      "url": "https://aac.saavncdn.com/.../song_320.mp4",
      "mime_type": "audio/mp4",
      "bitrate_kbps": 320
    }
  ],
  "resolved_at": "2024-01-15T10:30:00Z",
  "expires_hint": "2024-01-15T11:00:00Z"
}
```

---

## Failure Modes and Handling

| Failure | Detection | Response |
|---|---|---|
| DES key changed | `ValueError` from decryptor; decrypted value fails URL validation | `503 Service Unavailable` with `X-Media-Resolution: failed` header; `Song` endpoint still works |
| CDN URL expired | Client reports 403/404 on stream URL | Client should retry `/media` endpoint; server should not cache 15min if CDN returns 403 |
| Field `encrypted_media_url` missing | `has_media=false` on Song; no `/media` route needed | Return `404` from `/media` endpoint |
| Field renamed by JioSaavn | Parser finds no `encrypted_media_url` | Log structured warning; `has_media=false`; alert on elevated warning rate |
| Algorithm changed | Decryption produces garbage (URL validation fails) | `503` from `/media`; `Song` unaffected; alert on `MediaResolutionError` spike |

---

## Startup Validation

At application startup, the health check (`GET /health/startup`) validates the media resolver:

```python
async def validate_media_resolver(resolver: MediaResolver, test_song_id: str) -> bool:
    """
    Attempt to resolve media for a known test song.
    Logs a WARNING (not an error) if resolution fails — the app can still serve
    metadata even without media resolution.
    """
    try:
        info = await resolver.resolve(test_song_id, known_encrypted_url)
        if not info.streams:
            logger.warning("media_resolver_validation_failed", reason="no_streams")
            return False
        logger.info("media_resolver_validation_ok", stream_count=len(info.streams))
        return True
    except Exception as e:
        logger.warning("media_resolver_validation_failed", error=str(e))
        return False
```

> **Media resolution failure is non-fatal.** The application can serve song metadata, albums,
> playlists, artists, and lyrics even if media resolution is broken. Only the `/songs/{id}/media`
> endpoint degrades. This is by design.

---

## Important Warning for Implementors

> [!WARNING]
> **Verify current behaviour before every deployment.**
>
> The community-documented DES key (`38346591`), field name (`encrypted_media_url`), and algorithm
> (DES-ECB PKCS5) were accurate as of the last verified date but are:
>
> - **Not documented** by JioSaavn
> - **Not guaranteed** to remain stable
> - **Not officially sanctioned** for use
>
> Before each production deployment, run the media resolution integration test against the live API
> with a known song ID. If the test fails:
>
> 1. Check community forums and GitHub issues for reports of a key change.
> 2. Update `SAAVN_MEDIA_KEY` environment variable if a new key is identified.
> 3. If the mechanism has fundamentally changed, update `SaavnDESMediaResolver` only.
> 4. The `Song`, `Album`, `Playlist`, and `Artist` endpoints remain unaffected.
