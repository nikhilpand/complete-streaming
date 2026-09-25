# YouTube Playback Failure History & Classification

## 1. Chronology of YouTube Ecosystem Disruptions

| Era / Incident | Mechanism | Impact on Third-Party Clients | Remediation / Mitigation |
|---|---|---|---|
| **2021-2022: n-sig / JS Challenge** | Cipher transformations on streaming URLs | HTTP 403 throttling to ~50kbps | JavaScript challenge solver in yt-dlp |
| **2023: SABR (Streaming Audio Bitrate)** | Chunked server-push via WebSockets | Absence of static direct MP4/WebM URLs | Use formats with direct HTTPS URLs (140, 251) |
| **2024: Proof-of-Origin (PO-Token)** | Botguard attestation required on web client | HTTP 403 on format extraction | Multi-client fallback, embedded clients, cookies option |
| **2025: Format Deprecation** | Removal of legacy progressive MP4 audio streams | Disappearance of 256kbps AAC public formats | Dynamic format classifier (no static format_id assumptions) |

---

## 2. Playback Failure Classification Taxonomy (`PlaybackFailureType`)

To prevent ambiguous 500 errors and avoid penalizing the circuit breaker for client-side issues, errors are classified into strict categories:

```
PlaybackFailureType
 ├── NETWORK             (Socket error, DNS failure)
 ├── TIMEOUT             (Upstream read timeout)
 ├── HTTP_403            (GVS signature / forbidden)
 ├── HTTP_404            (Video deleted or not found)
 ├── HTTP_429            (Rate limited by YouTube)
 ├── HTTP_5XX            (YouTube internal error)
 ├── PO_TOKEN_REQUIRED   (Botguard attestation failure)
 ├── SABR_ONLY           (Only chunked streaming available)
 ├── NO_AUDIO_FORMAT     (Video has no compatible audio tracks)
 ├── EXPIRED_URL         (Safety margin triggered; URL expired)
 ├── GEO_RESTRICTION     (Video not available in server country)
 ├── AGE_RESTRICTION     (Content requires authenticated account)
 ├── AUTH_REQUIRED       (Private video)
 ├── COOKIES_REQUIRED    (Bot verification wall)
 ├── PLAYER_FAILURE      (Innertube player script error)
 ├── EXTRACTOR_FAILURE   (yt-dlp internal parsing failure)
 └── UNKNOWN             (Unmapped error)
```

### Circuit Breaker Impact Rule:
- **Penalize Breaker**: `NETWORK`, `TIMEOUT`, `HTTP_429`, `HTTP_5XX`, `PLAYER_FAILURE`.
- **Do NOT Penalize Breaker**: `HTTP_404`, `AGE_RESTRICTION`, `GEO_RESTRICTION`, `AUTH_REQUIRED`, `NO_AUDIO_FORMAT` (these indicate video content properties, not an engine infrastructure outage).
