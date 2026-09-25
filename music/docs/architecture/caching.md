# SWAY Caching Architecture

## 1. Principles and Hierarchy

In music streaming provider engines, improper caching is the primary source of memory leaks, stale CDN URL playback errors, and unnecessary upstream rate-limiting.

SWAY separates cache domains into distinct semantic tiers:

```
┌─────────────────────────────────────────────────────────────┐
│                       MemoryTTLCache                        │
├──────────────────────────────┬──────────────────────────────┤
│ Metadata Tier                │ Media Tier                   │
│ - Songs (TTL: 3600s)         │ - Media Streams (TTL: 300s)  │
│ - Albums (TTL: 3600s)        │ - Stale Window: 0s (STRICT)  │
│ - Artists (TTL: 3600s)       │ - Never revalidated stale    │
│ - Lyrics (TTL: 86400s)       │ - Independent eviction       │
│ - Stale Window: 60s (SWR)    │                              │
└──────────────────────────────┴──────────────────────────────┘
```

---

## 2. Stale-While-Revalidate (SWR) Protocol

Metadata changes infrequently, but cold cache misses penalize end-user latency. SWAY implements in-memory Stale-While-Revalidate:

```
Client Request
      │
      ▼
Check Cache Entry
      ├───────────────────────┬────────────────────────┬──────────────────────┐
      ▼                       ▼                        ▼                      ▼
 Age <= TTL            TTL < Age <= TTL+Window     Age > TTL+Window       Key Not Found
(FRESH HIT)                 (STALE HIT)                (EXPIRED)              (MISS)
      │                       │                        │                      │
 Return Data             Return Data                   └──────────┬───────────┘
 Immediately             Immediately                              ▼
                              │                              Fetch Upstream
                              ▼                             (Store & Return)
                     Spawn Background Task
                     to Revalidate Upstream
```

### Safety Guarantees
- **No Blocking Revalidation**: The calling client receives the cached data within microseconds without waiting on upstream network I/O.
- **Single Revalidation Flight**: Background refresh is non-blocking and handles transient network failures silently without invalidating existing stale data.
- **Forbidden on Ephemeral URLs**: Media streams (`MediaInfo`) explicitly specify `stale_window=0`. An expired stream URL is NEVER served stale because playing an expired CDN URL results in an immediate playback abort on client media players.

---

## 3. Cache Keys and Namespacing

Cache keys use strict namespacing:

| Resource | Key Format | TTL | Stale Window |
|---|---|---|---|
| Search | `saavn:search:{sha256(query:n:p:enrich)[:16]}` | 300s (5m) | 60s |
| Song | `saavn:song:{provider_id}` | 3600s (1h) | 60s |
| Album | `saavn:album:{provider_id}` | 3600s (1h) | 60s |
| Playlist | `saavn:playlist:{provider_id}` | 600s (10m) | 60s |
| Artist | `saavn:artist:{provider_id}` | 3600s (1h) | 60s |
| Lyrics | `saavn:lyrics:{lyrics_id}` | 86400s (24h) | 3600s |
| Media Streams | `saavn:media:{provider_id}` | 300s (5m) | **0s (Never stale)** |

---

## 4. Batch Cache Interleaving (No N+1)

When `get_songs([id1, id2, ... idN])` is invoked:
1. All IDs are checked against the cache simultaneously.
2. Only uncached IDs are consolidated into an upstream batch request: `pids=uncached1,uncached2`.
3. Upstream results are individually cached.
4. The final result combines cached hits and freshly fetched items, maintaining the caller's requested order.
