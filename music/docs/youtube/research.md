# YouTube Music API Research & Capabilities

## 1. Research Epistemology & Evidence Classification

To ensure high reliability, all findings are categorized according to empirical evidence:

- **[CONFIRMED]**: Verified directly against live Google/YouTube infrastructure with automated tests.
- **[OBSERVED]**: Replicated under specific test executions; subject to geographical or network variability.
- **[LIBRARY-SUPPORTED]**: Explicitly provided by `ytmusicapi` (1.12.3) or `yt-dlp` (2026.8.19) core APIs.
- **[UNSTABLE]**: Works intermittently; known to trigger bot detection, captcha, or format unavailability.
- **[VERSION-DEPENDENT]**: Dependent on specific upstream extractor versions and Innertube API builds.
- **[UNAVAILABLE]**: Not supported without authenticated user sessions or impossible via public Innertube.
- **[INFERRED]**: Architectural deduction based on observed protocol behavior.

---

## 2. Catalog & Discovery (`ytmusicapi`)

### Supported Operations

| Capability | Status | Endpoint / Call | Notes |
|---|---|---|---|
| **Song Search** | `[CONFIRMED]` | `yt.search(q, filter='songs')` | Returns videoId, title, artists, album, duration, thumbnails. |
| **Album Search** | `[CONFIRMED]` | `yt.search(q, filter='albums')` | Returns browseId, title, artists, year, thumbnails. |
| **Artist Search** | `[CONFIRMED]` | `yt.search(q, filter='artists')` | Returns browseId (channelId), name, subscribers. |
| **Playlist Search** | `[CONFIRMED]` | `yt.search(q, filter='playlists')` | Returns browseId (VL...), title, author, item count. |
| **Album Details** | `[CONFIRMED]` | `yt.get_album(browse_id)` | Returns album metadata, full track list, track numbers, duration. |
| **Artist Profile** | `[CONFIRMED]` | `yt.get_artist(channel_id)` | Returns name, description, subscriber count, top songs, albums, singles. |
| **Artist Albums** | `[CONFIRMED]` | `yt.get_artist_albums(channel_id, params)` | Paginated album listings. Note: `params` extracted from `get_artist`. |
| **Playlist Details** | `[CONFIRMED]` | `yt.get_playlist(playlist_id, limit)` | Returns playlist metadata, author, tracks with pagination. |
| **Watch / Radio** | `[CONFIRMED]` | `yt.get_watch_playlist(video_id)` | Generates dynamic 50-track radio mix based on seed song. |
| **Lyrics** | `[CONFIRMED]` | `yt.get_lyrics(lyrics_browse_id)` | Returns plain text, source copyright, and `hasTimestamps` flag. |

### Architectural Reality: Synchronous Execution
- `[CONFIRMED]`: `ytmusicapi` is completely synchronous, utilizing Python `requests` under the hood.
- Calling `ytmusicapi` directly inside an `async def` FastAPI route blocks the event loop, causing severe latency spikes under concurrent loads.
- **Mandate**: All `ytmusicapi` operations must execute in a bounded worker pool (`YouTubeCatalogExecutor` backed by `ThreadPoolExecutor` or `asyncio.to_thread`).

---

## 3. Schema Drift & Brittleness

- `[OBSERVED]`: YouTube frequently updates Innertube response keys, moves metadata under different nested renderer nodes (e.g. `musicResponsiveListItemRenderer`), or reorganizes artist browse tabs.
- `[CONFIRMED]`: Silent failures where code defaults missing keys to `None` cause downstream data corruption.
- **Mitigation**: Implement `YouTubeSchemaMonitor` that validates critical required structural fields (e.g. `videoId`, `title`) and raises `YouTubeSchemaChanged` on contract breaches.
