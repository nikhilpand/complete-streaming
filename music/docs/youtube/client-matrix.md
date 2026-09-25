# YouTube Client & Transport Matrix

## 1. Client Overview

YouTube's Innertube API serves different client personas with divergent authentication, token, and format constraints.

| Client ID | Transport | Audio Only Streams | PO-Token Required | Public Reliability | Current Status in Architecture |
|---|---|---|---|---|---|
| `web` (Desktop) | HTTPS / DASH / HLS | Yes (Formats 140, 251) | Frequently on unpadded web | Moderate | Enabled (via yt-dlp default pipeline) |
| `web_music` | HTTPS / DASH | Yes (Format 141 with auth) | No (standard streams) | Low (standalone) | Fallback in multi-client chain |
| `mweb` (Mobile Web) | HTTPS / HLS | Yes | Increasing enforcement | Moderate | Secondary fallback |
| `android` | Protobuf / HTTPS | High SABR ratio | Often requires Botguard token | Low for standalone audio | Requires fallback chain |
| `ios` | HTTPS / HLS | Yes | Rare PO-token, high SABR | Low for standalone | Fallback chain |
| `tv` / `tv_embedded` | HTTPS / DASH | Yes | Rare PO-token | Moderate | Fallback candidate |

---

## 2. Empirical Verification of Client Combinations

Our live benchmarks in `docs/youtube/research.md` demonstrated:
- Attempting to force an individual client (e.g. `['android']` or `['web_music']`) in isolation resulted in zero audio formats or `Requested format is not available`.
- `yt-dlp`'s integrated default client pipeline (`['default']`) successfully yielded **7 audio formats**, extracting format 251 (Opus @ 146 kbps) and format 140 (M4A @ 130 kbps).

### Architecture Strategy Decision:
1. Primary Strategy: `yt-dlp` optimized extraction profile with format-filtering enabled.
2. Fallback Strategy: Configurable client rotation (`web`, `mweb`, `android`) with maximum retry cap (`MAX_PLAYBACK_ATTEMPTS = 2`).
3. Cycle Prevention: Strategy tracker ensures the engine never enters an infinite fallback loop (`A -> B -> A`).
