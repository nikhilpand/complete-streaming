# SWAY Provider Layer Architecture

## 1. Provider Abstraction Philosophy

The fundamental design requirement of the SWAY Music Engine is **provider neutrality**:

```
                       SWAY Music Engine Core
                                 │
                                 ▼
                     MusicProvider (Abstract Base)
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
   SaavnProvider          YouTubeProvider         FutureProvider
   (app.providers.saavn)   (app.providers.yt)      (app.providers.*)
```

No consumer in the SWAY ecosystem ever directly imports or references `app.providers.saavn` or specific JioSaavn details. The engine consumes only the abstract interface defined in `app.providers.base.MusicProvider`.

---

## 2. The Abstract Interface Contract

`MusicProvider` defines the asynchronous contract:

| Method | Signature | Semantics |
|---|---|---|
| `search` | `(query: str, *, n: int = 20, page: int = 1, enrich: bool = False) -> SearchResults` | Lightweight listings by default; optional bounded enrichment. |
| `get_song` | `(song_id: str) -> Song` | Single canonical song metadata. Never embeds media streams. |
| `get_songs` | `(song_ids: list[str]) -> list[Song]` | Batch fetch. Batches uncached IDs in 1 upstream call. |
| `get_album` | `(album_id: str) -> Album` | Album metadata + tracklist. |
| `get_playlist` | `(playlist_id: str) -> Playlist` | Playlist metadata + tracks. |
| `get_artist` | `(artist_id: str) -> Artist` | Artist profile + top highlights. |
| `get_artist_songs` | `(artist_id: str, *, page: int, n: int) -> list[Song]` | Independent paginated track listing (no N+1). |
| `get_artist_albums` | `(artist_id: str, *, page: int, n: int) -> list[Album]` | Independent paginated album listing. |
| `get_lyrics` | `(lyrics_id: str) -> Lyrics` | Standalone lyrics retrieval. |
| `resolve_media` | `(song: Song) -> MediaInfo \| None` | Short-TTL CDN stream resolution. |
| `resolve_url` | `(url: str) -> Song \| Album \| Playlist \| Artist` | SSRF-safe URL parsing and resolution. |
| `health_check` | `() -> dict` | Non-blocking status reporting (circuit breaker, cache). |

---

## 3. Data Flow Pipeline

Every provider implementation enforces strict data transformation stages:

```
Upstream JSON / Wire Format
            │
            ▼
     Provider Parser
 (app.providers.saavn.parser)
   - Validates required identity fields
   - Detects schema breakage (raises ProviderSchemaChanged)
   - Tolerates optional missing/null fields
   - Decodes HTML entities and scales image resolutions
            │
            ▼
    Intermediate DTO
            │
            ▼
   Provider Normaliser
(app.providers.saavn.normaliser)
   - Enforces provider ID namespacing (`saavn:12345`)
   - Normalizes artists and sub-entities
   - Separates media availability from stream resolution
            │
            ▼
   Canonical SWAY Models
    (app.models.Song, Album, etc.)
```

---

## 4. Multi-Provider Interchangeability

Every canonical model retains origin identity via:
- `provider`: Unique provider string identifier (e.g. `"saavn"`)
- `provider_id`: The raw identifier within that provider ecosystem (e.g. `"aRZbUYD7"`)
- `id`: The globally namespaced canonical ID (`"saavn:aRZbUYD7"`)

This design allows:
1. Multi-provider aggregators to merge results without key collisions.
2. Dynamic routing of stream requests based on ID prefix.
3. Provider swap-outs without modifying database schemas or frontend clients.
