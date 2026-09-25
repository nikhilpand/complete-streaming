# JioSaavn API Endpoint Map

> **Base URL:** `https://www.jiosaavn.com/api.php`  
> **Method:** `GET` for all endpoints  
> **Content-Type (response):** `application/json`  
> **Status:** Community-documented; undocumented and unsupported by JioSaavn.

---

## Universal Query Parameters

These parameters must be included with **every** request. Omitting them may result in malformed responses or HTML instead of JSON.

| Parameter | Value | Notes |
|---|---|---|
| `_format` | `json` | Required for JSON response; default is HTML |
| `_marker` | `0` | Pagination marker; always `0` for non-paginated or first page |
| `api_version` | `4` | API version discriminator; `4` is current stable value |
| `ctx` | `web6dot0` | Client context identifier; `web6dot0` returns full metadata |
| `cc` | `in` | Country code; `in` (India) required for full content access |

> **Note on `ctx`:** Alternative context values (`android`, `ios`, `wap`) exist and may return different response shapes (e.g., different image sizes, field subsets). `web6dot0` is the most complete and the value used by all reviewed community implementations.

---

## Search Endpoints

### General / Multi-Type Search

```
GET https://www.jiosaavn.com/api.php
  ?__call=autocomplete.get
  &query=<search_term>
  &includeMetaTags=1
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

**Response structure:**
```json
{
  "songs": {
    "data": [...],
    "position": 1
  },
  "albums": {
    "data": [...],
    "position": 2
  },
  "artists": {
    "data": [...],
    "position": 3
  },
  "playlists": {
    "data": [...],
    "position": 4
  },
  "topquery": {
    "data": [...],
    "position": 5
  }
}
```

**Use case:** General search returning mixed results across types in a single request.  
**Advantage over `search.getResults`:** One round-trip for all content types.  
**Limitation:** Results are stubs — song objects may not include `encrypted_media_url`; use `song.getDetails` with bulk `pids` for full metadata.

---

### Song-Specific Search

```
GET https://www.jiosaavn.com/api.php
  ?__call=search.getResults
  &q=<search_term>
  &n=<count>
  &p=<page>
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search query (max 200 chars recommended) |
| `n` | integer | Results per page (1–50; default: 20) |
| `p` | integer | Page number, **1-indexed** (first page = `1`) |

**Response:**
```json
{
  "results": [...],
  "total": 1234,
  "start": 1,
  "count": 20
}
```

---

### Album Search

```
GET https://www.jiosaavn.com/api.php
  ?__call=search.getAlbumResults
  &q=<search_term>
  &n=<count>
  &p=<page>
  &_format=json ...
```

Same pagination parameters as `search.getResults`. Returns album objects with `albumid`, `title`, `image`, `artist`, `year`, `song_count`.

---

### Playlist Search

```
GET https://www.jiosaavn.com/api.php
  ?__call=search.getPlaylistResults
  &q=<search_term>
  &n=<count>
  &p=<page>
  &_format=json ...
```

Returns playlist stubs with `listid`, `listname`, `image`, `follower_count`, `song_count`.

---

### Artist Search

```
GET https://www.jiosaavn.com/api.php
  ?__call=search.getArtistResults
  &q=<search_term>
  &n=<count>
  &p=<page>
  &_format=json ...
```

Returns artist objects with `artistid`, `name`, `image`, `isRadioPresent`, `dominantType`.

---

## Song Endpoints

### Get Song Details (Bulk-Capable)

```
GET https://www.jiosaavn.com/api.php
  ?__call=song.getDetails
  &pids=<id1,id2,...,idN>
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

| Parameter | Type | Description |
|---|---|---|
| `pids` | string | Comma-separated song IDs. Up to ~20 IDs per request. |

> ⚠️ **Always use bulk fetching.** Never call this endpoint once per song ID in a loop.  
> Batch up to 20 IDs per call. For larger sets, split into batches with `asyncio.gather()`.

**Response:**
```json
{
  "songs": [
    {
      "id": "aBcDeFgH",
      "title": "Song Title",
      "song": "Song Title (display)",
      "album": "Album Name",
      "album_id": "12345",
      "year": "2023",
      "duration": "245",
      "image": "https://c.saavncdn.com/.../50x50.jpg",
      "has_lyrics": "true",
      "lyrics_id": "12345",
      "encrypted_media_url": "DEnCrYpTeD...",
      "more_info": {
        "artistMap": { ... },
        "label": "T-Series",
        "language": "hindi"
      }
    }
  ]
}
```

**Key fields:**
- `id` — song identifier (alphanumeric, 8 chars typically)
- `encrypted_media_url` — DES-encrypted CDN URL (see [media-delivery.md](media-delivery.md))
- `has_lyrics` — `"true"` / `"false"` (string, not boolean)
- `lyrics_id` — required for lyrics fetch (only present when `has_lyrics = "true"`)
- `image` — thumbnail URL (transform for higher resolution — see Image Resolution below)
- `duration` — duration in seconds as a string

---

## Album Endpoints

### Get Album Details

```
GET https://www.jiosaavn.com/api.php
  ?__call=content.getAlbumDetails
  &albumid=<album_id>
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

| Parameter | Type | Description |
|---|---|---|
| `albumid` | string | JioSaavn album identifier |

**Response includes:** Album metadata (`title`, `name`, `year`, `artist`, `image`, `primary_artists`) plus `list` array containing full song objects (including `encrypted_media_url`).

> Note: Verify that `list` always contains full song objects rather than stubs in your integration test. If stubs are returned, a secondary `song.getDetails` bulk call is required.

---

## Playlist Endpoints

### Get Playlist Details

```
GET https://www.jiosaavn.com/api.php
  ?__call=playlist.getDetails
  &listid=<playlist_id>
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

| Parameter | Type | Description |
|---|---|---|
| `listid` | string | JioSaavn playlist identifier |

**Response includes:** Playlist metadata plus `list` array of songs.

> ⚠️ **Pagination concern:** Large playlists (>50 songs) may return truncated `list`. Verify against a known large playlist. If pagination is needed, the endpoint may accept `n` and `p` parameters — document actual behaviour after testing.

---

## Artist Endpoints

### Get Artist Page Details

```
GET https://www.jiosaavn.com/api.php
  ?__call=artist.getArtistPageDetails
  &artistId=<artist_id>
  &page=<page_number>
  &n_song=<songs_per_page>
  &n_album=<albums_per_page>
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

| Parameter | Type | Description |
|---|---|---|
| `artistId` | string | JioSaavn artist identifier |
| `page` | integer | Page number, **0-indexed** (first page = `0`) |
| `n_song` | integer | Top songs per page (max 50 recommended) |
| `n_album` | integer | Albums per page (max 50 recommended) |

> ⚠️ **Index inconsistency:** Artist pagination is 0-indexed; search pagination is 1-indexed. This is a JioSaavn API inconsistency, not a bug in the implementation. Document it prominently.

**Response includes:** `artistId`, `name`, `image`, `bio`, `dob`, `fb`, `twitter`, `wiki`, `topSongs` (array), `topAlbums` (array), `singles` (array), `dedicated_artist_playlist` (array), `similarArtists` (array).

---

## Lyrics Endpoints

### Get Lyrics

```
GET https://www.jiosaavn.com/api.php
  ?__call=lyrics.getLyrics
  &lyrics_id=<lyrics_id>
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

| Parameter | Type | Description |
|---|---|---|
| `lyrics_id` | string | Lyrics identifier from `song.getDetails` response |

> **Prerequisite:** Lyrics ID is available on the song detail object as `lyrics_id` only when `has_lyrics == "true"`.

**Response:**
```json
{
  "lyrics": "Line 1<br>Line 2<br>...",
  "lyrics_copyright": "© 2023 T-Series",
  "snippet": "First few words..."
}
```

> **Sanitisation required:** Lyrics may contain `<br>` tags, HTML entities (`&amp;`, `&quot;`, etc.), and occasionally Unicode escape sequences. Normalise before returning to clients.

**Caching:** Lyrics are immutable once published. Cache with a TTL of 24 hours or longer. This endpoint is the highest-value cache target in the system.

---

## URL Resolution Endpoint

### Resolve JioSaavn Share URL

```
GET https://www.jiosaavn.com/api.php
  ?__call=webapi.get
  &token=<path_token>
  &type=<content_type>
  &_format=json
  &_marker=0
  &api_version=4
  &ctx=web6dot0
  &cc=in
```

| Parameter | Type | Description |
|---|---|---|
| `token` | string | URL path segment extracted from a JioSaavn share URL |
| `type` | string | One of: `song`, `album`, `playlist`, `artist` |

**Token extraction:**  
For a JioSaavn share URL like `https://www.jiosaavn.com/song/some-song-name/AbCdEfGh`:
- Path: `/song/some-song-name/AbCdEfGh`
- Token: `some-song-name/AbCdEfGh` (everything after the content type prefix)

> ⚠️ **SSRF warning:** The token must be extracted from a user-supplied URL **only after** validating that the URL hostname is `www.jiosaavn.com` or `jiosaavn.com`. Never pass arbitrary user input as the `token` parameter and never fetch arbitrary user-supplied URLs server-side.

---

## Image Resolution

JioSaavn image URLs follow this pattern:
```
https://c.saavncdn.com/.../<hash>-50x50.jpg
```

Replace the size suffix to request higher resolution:
- `50x50` → `150x150` (medium)
- `50x50` → `500x500` (high, recommended)

```python
high_res = image_url.replace("50x50", "500x500")
```

> **Note:** Not all images have all sizes available. Return the original URL as fallback if the high-res URL returns a 404.

---

## Pagination Reference

| Endpoint | Param | Indexing | Default | Max |
|---|---|---|---|---|
| `search.getResults` | `p` | **1-indexed** | `1` | N/A |
| `search.getAlbumResults` | `p` | **1-indexed** | `1` | N/A |
| `search.getPlaylistResults` | `p` | **1-indexed** | `1` | N/A |
| `search.getArtistResults` | `p` | **1-indexed** | `1` | N/A |
| `artist.getArtistPageDetails` | `page` | **0-indexed** | `0` | N/A |
| All search | `n` | N/A | `20` | `50` (cap server-side) |
| `artist.getArtistPageDetails` | `n_song` | N/A | `10` | `50` |
| `artist.getArtistPageDetails` | `n_album` | N/A | `10` | `50` |

---

## Media Quality Suffixes

The decrypted CDN URL from `encrypted_media_url` ends in a quality suffix. Replace to get different bitrates:

| Suffix | Quality | Notes |
|---|---|---|
| `_12.mp4` | 12 kbps | Very low; mobile-low mode |
| `_48.mp4` | 48 kbps | Low quality |
| `_96.mp4` | 96 kbps | Default (value returned from decryption) |
| `_160.mp4` | 160 kbps | Medium quality |
| `_320.mp4` | 320 kbps | Highest available; requires premium on official app |

> ⚠️ **Fragility warning:** This is a string manipulation hack. JioSaavn does not document these suffixes. Higher quality URLs may return 403 for some tracks if the account serving the URL does not have premium access. Always verify the URL is reachable before returning to the client (or let the client handle 403 gracefully).

---

## Endpoint Stability Assessment

| Endpoint | Stability | Notes |
|---|---|---|
| Base URL `api.php` | 🟢 Stable | 5+ years, observed across all implementations |
| `autocomplete.get` | 🟢 Stable | Core search — would break official app if changed |
| `search.getResults` | 🟢 Stable | Core search variant |
| `search.getAlbumResults` | 🟡 Mostly stable | Less used; minor schema variations observed |
| `search.getPlaylistResults` | 🟡 Mostly stable | Same as above |
| `search.getArtistResults` | 🟡 Mostly stable | Same as above |
| `song.getDetails` | 🟢 Stable | Core endpoint |
| `content.getAlbumDetails` | 🟢 Stable | Core endpoint |
| `playlist.getDetails` | 🟢 Stable | Core endpoint |
| `artist.getArtistPageDetails` | 🟢 Stable | Core endpoint |
| `lyrics.getLyrics` | 🟡 Mostly stable | Schema (field names) has varied slightly |
| `webapi.get` | 🟡 Mostly stable | Token format depends on share URL structure |
| `encrypted_media_url` field | 🔴 Unstable | DES key could change; field could be renamed |
| Quality suffix replacement | 🔴 Fragile | No guarantee higher-quality URLs are always available |
| Image size suffix replacement | 🟡 Mostly stable | Works for most images; 404 possible for smaller originals |

---

## Known Quirks and Gotchas

1. **`has_lyrics` is a string:** Returns `"true"` or `"false"` (not boolean `true`/`false`). Always compare as string or normalise in parser.
2. **`duration` is a string:** Returns seconds as a string (e.g., `"245"`). Cast to `int` in parser.
3. **Image URLs return 50x50 by default:** Always upscale in the response normaliser.
4. **Artist page pagination is 0-indexed; everything else is 1-indexed.** This is a JioSaavn inconsistency that bites every implementation at least once.
5. **Song stubs from search don't include `encrypted_media_url`.** Always follow up with `song.getDetails` bulk call.
6. **`cc=in` is required.** Without it, some content returns empty arrays or 403.
7. **The API may return `"null"` (string) for some missing optional fields** rather than JSON `null`. Normalise in parser.
8. **`more_info` nesting varies** between endpoint types (search stubs vs. full song detail). Always access defensively.
