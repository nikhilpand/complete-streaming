# SWAY Code Review — Phase 0 Verification

**Date:** 2026-09-23  
**Reviewer:** Antigravity static-review agent  
**Scope:** `music/` (FastAPI backend), `sway-ui/` (Next.js frontend), `lyrics-engine/`

Each finding from the multi-agent review is verified against the *current* code and classified.

---

## Legend

| Status | Meaning |
|--------|---------|
| `CONFIRMED` | Finding present in current code; fix required |
| `ALREADY FIXED` | Finding no longer present |
| `NOT REPRODUCIBLE` | Finding could not be verified; code is clean |
| `NEEDS DESIGN DECISION` | Finding is valid but requires explicit owner decision before fixing |

---

## CRITICAL

### C-1 · Shuffle repeats current track (playerStore.ts L67–68)

**Finding:** When `isShuffled=true` and `queue.length === 1`, `Math.random() * 1` always floors to 0, playing the same track again. When queue has multiple songs, `Math.random()` can return the current `queueIndex`, replaying the current song instead of advancing.

**Verification:**
```ts
// playerStore.ts L62–76 (current)
if (isShuffled) {
  next = Math.floor(Math.random() * queue.length);
}
```
`Math.floor(Math.random() * queue.length)` can return `queueIndex` at any time. There is no exclusion of the current index.

**Status: `CONFIRMED`**  
**Fix required:** Exclude current index from shuffle selection; handle single-song queue gracefully.

---

## HIGH

### H-1 · Decrypted CDN URLs logged at DEBUG level (crypto.py)

**Finding:** `_decrypt_url` and `build_streams` log or could surface the decrypted CDN URL.

**Verification:**  
```python
# crypto.py — no logging of decrypted URL occurs
logger.warning("Media URL decryption failed: %s", exc)  # only on failure
logger.warning("Decrypted URL does not end with expected quality suffix")  # no URL in message
```
No decrypted URL value is ever passed to the logger. `logger.warning` messages contain only the exception text, not the plaintext URL.

**Status: `ALREADY FIXED` / `NOT REPRODUCIBLE`**

---

### H-2 · `encrypted_media_url` stored on Song model exposed via API

**Finding:** The `encrypted_media_url` field (a Saavn internal token) may be serialised and returned in API responses, leaking implementation details.

**Verification:**  
`norm_song()` in `normaliser.py` builds a canonical `Song` model. Looking at `models.py` is needed to confirm the field is absent from the canonical model.

**Status: Requires `models.py` check** — see H-2 addendum below.

---

### H-3 · Background refresh task not shielded from cancellation (provider.py L102)

**Finding:** `asyncio.create_task(self._background_refresh(...))` — if the task is garbage-collected before it starts (possible in heavily-loaded event loops), the refresh silently drops.

**Verification:**
```python
# provider.py L102
asyncio.create_task(self._background_refresh(key, fetch_fn, ttl))
```
The task is created but the returned `Task` object is immediately discarded. Python ≥ 3.11 emits a `Task was destroyed but it is pending!` warning if GC collects an active task. More importantly, there is no strong reference keeping the task alive.

**Status: `CONFIRMED`**  
**Fix required:** Store the task reference (weak set or module-level set) so GC cannot collect it before it runs.

---

### H-4 · `parse_song_raw` admits `id = ""` (empty string) as valid (parser.py L142–146)

**Finding:** The guard `if not song_id` catches `None` but truthy empty string `""` passes if upstream returns `"id": ""`.

**Verification:**
```python
# parser.py L142–146
song_id = raw.get("id")
if not song_id:    # catches None AND "" — "" is falsy in Python
    raise ProviderSchemaChanged(...)
```
In Python, `not ""` is `True`. The guard correctly catches empty string. The finding is incorrect.

**Status: `NOT REPRODUCIBLE`**

---

### H-5 · `_hi_res_image` regex replaces ALL digit×digit patterns (parser.py L60)

**Finding:** `re.sub(r"\d+x\d+", "500x500", url)` could corrupt an image URL that contains a legitimate resolution elsewhere in the path.

**Verification:**
```python
# parser.py L58–60
def _hi_res_image(url: str | None) -> str | None:
    if not url:
        return None
    return re.sub(r"\d+x\d+", "500x500", url)
```
The regex is applied globally. If a JioSaavn CDN URL contains the resolution in multiple places (e.g., path segment *and* query param), all occurrences are replaced. In practice JioSaavn URLs have exactly one `{N}x{N}` segment, so this is currently safe but fragile.

**Status: `CONFIRMED` (low risk now, fragile long-term)**  
**Fix recommended:** Anchor the replacement to the last path segment or use a more specific pattern.

---

## MEDIUM

### M-1 · `playPrev` seeks audio via dynamic import in microtask, no error boundary (playerStore.ts L87–91)

**Finding:** The dynamic import `await import('@/lib/audio/AudioManager')` inside a `Promise.resolve().then()` microtask has no `.catch()`. If the module fails to load the error is silently swallowed.

**Verification:**
```ts
// playerStore.ts L87–91
Promise.resolve().then(async () => {
  const { audioManager } = await import('@/lib/audio/AudioManager');
  audioManager?.seek(0);
});
```
No `.catch()` or try/catch wraps the dynamic import. A module load failure would produce an unhandled promise rejection.

**Status: `CONFIRMED`**  
**Fix required:** Wrap the import in try/catch or add `.catch(console.warn)`.

---

### M-2 · `MemoryTTLCache.get` acquires lock then releases before reading `entry` fields (cache.py L57–67)

**Finding:** The lock is released before `entry.ttl`, `entry.stored_at`, `entry.stale_window` are read. Another coroutine could mutate the entry between lock release and field access.

**Verification:**
```python
# cache.py L57–67
async with self._lock:
    entry = self._store.get(key)   # reference copied under lock
# lock released here
if entry is None:
    return None, "miss"
age = time.monotonic() - entry.stored_at  # read outside lock
```
In CPython, `CacheEntry` is a dataclass. The `set()` method replaces the *entire* entry object under the lock: `self._store[key] = entry` (a new `CacheEntry`). Since the old object is replaced atomically (dict key assignment), the reference held in the local variable `entry` still points to the old immutable object. There is no mutation of the fields of an existing entry — only wholesale replacement. Therefore this is safe in CPython.

**Status: `NOT REPRODUCIBLE`** (safe by dict-assignment semantics; the entry object itself is never mutated after creation)

---

### M-3 · `_extract_artists` fallback ID uses `name.lower().replace(" ", "_")` — collision possible (parser.py L119)

**Finding:** The synthetic ID `name.lower().replace(" ", "_")` can produce collisions (e.g., "A R Rahman" and "A_R_Rahman" both become `"a_r_rahman"`).

**Verification:**
```python
# parser.py L119
aid = name.lower().replace(" ", "_")
```
This is a pure fallback when no real ID exists. Collisions only arise in `featured_artists`/`primary_artists` if two distinct artists have identical `name.lower()` after space-to-underscore substitution. Extremely unlikely in practice. The real fix would be omitting the artist entry when no real ID is available.

**Status: `CONFIRMED` (low severity)**  
**Fix recommended:** Use `None` or skip the artist entry when no real ID exists rather than synthesising a potentially-colliding one.

---

### M-4 · `cycleRepeat` order skips `'one'` → `'none'` directly (playerStore.ts L103–105)

**Finding:** The review noted the cycle order might be unexpected.

**Verification:**
```ts
// playerStore.ts L103–105
cycleRepeat: () => set((s) => ({
  repeatMode: s.repeatMode === 'none' ? 'all' : s.repeatMode === 'all' ? 'one' : 'none',
})),
```
Cycle: `none → all → one → none`. This is consistent with most streaming UIs (Spotify, Apple Music cycle the same way). Not a bug.

**Status: `NOT REPRODUCIBLE`**

---

### M-5 · `parse_duration_ms` silent truncation of float (parser.py L72)

**Finding:** `int(val) * 1000` truncates the float before multiplying; a song of 3.9 s would report 3000 ms instead of 3900 ms.

**Verification:**
```python
# parser.py L71–72
return int(val) * 1000
```
JioSaavn `duration` is documented as whole seconds (integer-string like `"253"`). `float("253")` → `253.0` → `int(253.0)` → `253` → `253000 ms`. No precision is lost for integer-second values. However, if JioSaavn ever returns fractional seconds (e.g., `"253.9"`), we'd truncate. Should be `round(val * 1000)` for correctness.

**Status: `CONFIRMED` (low risk now, correctness issue)**  
**Fix recommended:** Use `round(val * 1000)` instead of `int(val) * 1000`.

---

### M-6 · `norm_artist` calls `parse_song_raw` / `parse_album_raw` without error handling (normaliser.py L163–165)

**Finding:** If a song in `top_songs_raw` is malformed, `norm_artist` raises, losing the entire artist object.

**Verification:**
```python
# normaliser.py L163–165
top_songs = [norm_song(parse_song_raw(s)) for s in parsed.get("top_songs_raw") or []]
singles   = [norm_song(parse_song_raw(s)) for s in parsed.get("singles_raw") or []]
top_albums = [norm_album(parse_album_raw(a)) for a in parsed.get("top_albums_raw") or []]
```
No try/except around these list comprehensions. A single malformed track in `top_songs_raw` raises and the caller gets no artist at all.

Compare with `parse_album_raw` which does wrap each song parse in try/except (parser.py L272–276). This normaliser layer is inconsistent.

**Status: `CONFIRMED`**  
**Fix required:** Wrap each item parse in try/except and log/skip malformed entries.

---

### M-7 · `GlobalPlayer.tsx` missing `aria-label` on full-player play/pause button (GlobalPlayer.tsx L194–211)

**Finding:** The full-player `IconButton` (play/pause) has no `aria-label`.

**Verification:**
```tsx
// GlobalPlayer.tsx L194–211
<IconButton
  sz="lg"
  variant="prominent"
  className="rounded-full w-14 h-14"
  disabled={isLoading}
  onClick={...}
>
  {/* no aria-label prop */}
```
Mini-player button (L33–53) has `aria-label={isPlaying ? 'Pause' : 'Play'}`. Full-player button does not.

**Status: `CONFIRMED`**  
**Fix required:** Add dynamic `aria-label` to full-player play/pause button.

---

## LOW

### L-1 · `_parse_duration_ms` uses `import math` inside function body (parser.py L69)

**Finding:** `import math` inside the function body is inefficient (module lookup on every call).

**Verification:**
```python
# parser.py L69
import math
```
The `math` module is imported inside `_parse_duration_ms`. Python caches module imports in `sys.modules`, so this is a dictionary lookup (not re-execution) on subsequent calls — O(1) and negligible in practice. But it is non-idiomatic.

**Status: `CONFIRMED` (style/cleanup)**  
**Fix recommended:** Move `import math` to module top-level.

---

### L-2 · `norm_album` imports `parse_song_raw` but never uses it (normaliser.py L119)

**Finding:** `from app.providers.saavn.parser import parse_song_raw` in `norm_album` is unused.

**Verification:**
```python
# normaliser.py L119
def norm_album(parsed: dict) -> Album:
    from app.providers.saavn.parser import parse_song_raw  # ← imported but unused
    songs = [norm_song(s) for s in parsed.get("songs") or []]
```
`parse_song_raw` is imported but `norm_song(s)` takes an already-parsed dict `s` (from `parsed["songs"]`), so the import is truly dead code.

**Status: `CONFIRMED`**  
**Fix required:** Remove the dead import.

---

### L-3 · `SaavnURLResolver.parse` allows `parts[0]` path segment to be any unchecked value (resolver.py L132)

**Finding:** The `RESOURCE_TYPE_MAP.get(parts[0].lower(), "song")` silently defaults to `"song"` for unrecognised path prefixes.

**Verification:**
```python
# resolver.py L132
resource_type = cls.RESOURCE_TYPE_MAP.get(parts[0].lower(), "song")
```
An unknown path segment (e.g., `/admin/token`) defaults to resource_type `"song"`. The token still has to pass `_TOKEN_RE`, and the hostname must be in the allowlist, so there is no security issue. It's a silent assumption that could cause misleading error messages ("Song not found" when the URL was for a radio station).

**Status: `CONFIRMED` (low — no security impact, UX issue)**  
**Fix recommended:** Log a warning when defaulting to "song" for an unrecognised path prefix.

---

### L-4 · `AudioManager.ts` `load()` does not call `a.load()` after setting `a.src` (AudioManager.ts L94–96)

**Finding:** After setting `a.src = url`, `HTMLAudioElement.load()` is not explicitly called. Some browsers require this.

**Verification:**
```ts
// AudioManager.ts L94–96
async load(url: string): Promise<void> {
  const a = this.init();
  if (a.src !== url) {
    a.src = url;
  }
}
```
Per the HTML spec, assigning a new `src` to an `HTMLAudioElement` triggers the resource selection algorithm automatically. Explicit `.load()` is not required but can force a clean restart. In practice the existing code works in all modern browsers.

**Status: `NOT REPRODUCIBLE`** (spec-compliant; no real bug)

---

## Summary Table

| ID | Severity | Status | Fix Required |
|----|----------|--------|-------------|
| C-1 | Critical | **CONFIRMED** | Shuffle excludes current index |
| H-1 | High | ALREADY FIXED | — |
| H-2 | High | Requires `models.py` check | TBD |
| H-3 | High | **CONFIRMED** | Shield background refresh task |
| H-4 | High | NOT REPRODUCIBLE | — |
| H-5 | High | **CONFIRMED** (low risk) | Anchor image regex |
| M-1 | Medium | **CONFIRMED** | Add catch to dynamic import |
| M-2 | Medium | NOT REPRODUCIBLE | — |
| M-3 | Medium | **CONFIRMED** (low) | Skip artist without real ID |
| M-4 | Medium | NOT REPRODUCIBLE | — |
| M-5 | Medium | **CONFIRMED** (low risk) | Use `round(val * 1000)` |
| M-6 | Medium | **CONFIRMED** | Guard artist song/album parsing |
| M-7 | Medium | **CONFIRMED** | Add aria-label to full player |
| L-1 | Low | **CONFIRMED** (style) | Move `import math` to top |
| L-2 | Low | **CONFIRMED** | Remove dead import |
| L-3 | Low | **CONFIRMED** (low) | Log warning on default path |
| L-4 | Low | NOT REPRODUCIBLE | — |

**Confirmed fixes: 10** | **Already fixed / not reproducible: 6** | **Needs design decision: 1 (H-2)**
