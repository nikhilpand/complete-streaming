"""
Hybrid Music Provider for SWAY.

Composes SaavnProvider (fast primary CDN catalogue) with YouTubeProvider (universal catalogue).
Seamlessly handles:
  - Augmented search for songs/artists restricted or delisted on JioSaavn (e.g. Atif Aslam, Coke Studio)
  - Automatic stream fallback when JioSaavn tracks are marked disabled / unavailable
  - Full transparent playback for both saavn:* and youtube:* tracks
"""

from __future__ import annotations

import asyncio
import copy
import difflib
import logging
import math
import re
import time
from collections import Counter
from typing import Optional

from app.core.errors import ProviderError, ProviderNotFound
from app.models import (
    Album,
    Artist,
    ArtistRef,
    Lyrics,
    MediaInfo,
    Playlist,
    SearchItem,
    SearchResults,
    Song,
)
from app.providers.base import MusicProvider
from app.providers.saavn.provider import SaavnProvider
from app.providers.youtube.provider import YouTubeProvider

logger = logging.getLogger(__name__)


def parse_views_to_int(views_raw: Any) -> int:
    """
    Parse view count string (e.g. '373M', '1.2B', '450K', '12,345', '12345 views') or int into an integer.
    """
    if not views_raw:
        return 0
    if isinstance(views_raw, (int, float)):
        return int(views_raw)
    s = str(views_raw).strip().lower()
    m = re.match(r"^([\d\.]+)\s*([kmb])(?:\s*views?)?$", s)
    if m:
        num = float(m.group(1))
        unit = m.group(2)
        if unit == "k":
            return int(num * 1_000)
        elif unit == "m":
            return int(num * 1_000_000)
        elif unit == "b":
            return int(num * 1_000_000_000)
    digits = re.sub(r"[^\d]", "", s)
    if digits:
        try:
            return int(digits)
        except ValueError:
            return 0
    return 0


def normalize_title(title: Optional[str]) -> str:
    """
    Normalize a song title by stripping extraneous version tags, features, and punctuation,
    while preserving distinct version types (remix, slowed, sped up, workout, etc.).
    """
    if not title:
        return ""
    t = str(title).lower()
    # Strip (feat. ...), [feat. ...], {feat ...}
    t = re.sub(r'[\(\[\{]\s*(?:feat|ft|featuring|with)\b[^\)\]\}]*[\)\]\}]', '', t)
    # Strip (from ...), [from ...]
    t = re.sub(r'[\(\[\{]\s*from\b[^\)\]\}]*[\)\]\}]', '', t)
    # Strip (official ...), [official ...]
    t = re.sub(r'[\(\[\{]\s*official\b[^\)\]\}]*[\)\]\}]', '', t)
    # Strip (remastered ...), [remastered ...]
    t = re.sub(r'[\(\[\{]\s*remastered\b[^\)\]\}]*[\)\]\}]', '', t)
    # Strip (lyrics ...), [lyrics ...]
    t = re.sub(r'[\(\[\{]\s*lyrics?\b[^\)\]\}]*[\)\]\}]', '', t)
    # Strip trailing - single, - ep, - original, - remastered, - deluxe, - audio, - video, etc.
    t = re.sub(r'-\s*(?:single|ep|original|remastered|deluxe|audio|video|lyrics?|soundtrack|ost|bonus\s+track)\b.*$', '', t)
    # Strip non-alphanumeric except spaces
    t = re.sub(r'[^\w\s]', ' ', t)
    return " ".join(t.split())


def _clean_str(s: str) -> str:
    """Backwards-compatible wrapper around normalize_title."""
    return normalize_title(s)


def _extract_all_artists(item: SearchItem) -> set[str]:
    """Extract set of all normalized artist names associated with item."""
    artists: set[str] = set()
    extra = item.extra or {}
    raw_artists = [
        extra.get("primary_artists"),
        extra.get("artist"),
        extra.get("singers"),
    ]
    subtitle = item.subtitle or ""
    if subtitle:
        parts = re.split(r'[\u00b7\u2022\u2023\u25e6\u2043\u2219•·|]', subtitle)
        raw_artists.extend(parts)

    for ra in raw_artists:
        if not ra:
            continue
        names = re.split(r'[,;/]|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b', str(ra))
        for n in names:
            cl = re.sub(r'[^\w\s]', ' ', n.lower()).strip()
            cl = " ".join(cl.split())
            if cl and cl not in ("unknown", "unknown artist", "various", "various artists"):
                artists.add(cl)
    return artists


def _extract_item_metadata(item: SearchItem) -> tuple[str, str, str]:
    """
    Extract canonical (clean_title, clean_artist, clean_album) from SearchItem.
    Works consistently across Saavn and YouTube items without lossy heuristics or artist/album inversion.
    """
    title_clean = normalize_title(item.title)
    extra = item.extra or {}
    album = extra.get("album") or ""
    primary_artist = extra.get("primary_artists") or extra.get("artist") or extra.get("singers") or ""

    subtitle = item.subtitle or ""
    if not primary_artist:
        parts = [p.strip() for p in re.split(r'[\u00b7\u2022\u2023\u25e6\u2043\u2219•·|]', subtitle) if p.strip()]
        if len(parts) == 1:
            primary_artist = parts[0]
        elif len(parts) > 1:
            norm_t = title_clean
            norm_alb = normalize_title(album)
            p0_norm = normalize_title(parts[0])
            p_last_norm = normalize_title(parts[-1])

            # If last part matches title, first part is the artist! (e.g. JioSaavn "Ravyn Lenae · Love Me Not")
            if norm_t and (p_last_norm == norm_t or norm_t in p_last_norm):
                primary_artist = parts[0]
                if not album:
                    album = parts[-1]
            # If first part matches title, artist is in the other part!
            elif norm_t and (p0_norm == norm_t or norm_t in p0_norm):
                primary_artist = parts[-1]
                if not album:
                    album = parts[0]
            # If first part matches album, last part is artist! (e.g. "Veer-Zaara · Madan Mohan...")
            elif norm_alb and (p0_norm == norm_alb or norm_alb in p0_norm):
                primary_artist = parts[-1]
            # If last part contains commas or '&', it is almost certainly a list of artists!
            elif "," in parts[-1] or "&" in parts[-1]:
                primary_artist = parts[-1]
                if not album:
                    album = parts[0]
            elif "," in parts[0] or "&" in parts[0]:
                primary_artist = parts[0]
                if not album:
                    album = parts[-1]
            else:
                # Default: first part is primary artist (e.g. Western "Ravyn Lenae · Bird's Eye")
                primary_artist = parts[0]
                if not album:
                    album = parts[-1]

    # Split multi-artist string to take the clean primary artist name
    artist_names = re.split(r'[,;/]|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b', str(primary_artist))
    first_artist = artist_names[0] if artist_names else str(primary_artist)
    clean_artist = re.sub(r'[^\w\s]', ' ', first_artist.lower()).strip()
    clean_artist = " ".join(clean_artist.split())

    clean_album = re.sub(r'[^\w\s]', ' ', str(album).lower()).strip()
    clean_album = " ".join(clean_album.split())

    return title_clean, clean_artist, clean_album


DERIVATIVE_KEYWORDS = (
    "slowed", "reverb", "sped", "speed", "speed up", "sped up",
    "workout", "karaoke", "instrumental", "tribute", "8d", "16d",
    "bass boosted", "nightcore", "ringtone",
)


def _score_relevance(query: str, item: SearchItem, source_rank: int) -> float:
    """
    Multi-feature relevance model explicitly ranking:
      - Exact artist intent
      - Artist phrase & token boundaries
      - Exact title & token boundaries
      - Combined title + artist in query (strictly word/token bounded)
      - Views / popularity boost (from YouTube views and JioSaavn CTR)
      - Derivative junk penalty (slowed, sped up, workout, karaoke demoted unless searched for)
      - Album match
      - Full query token coverage
      - Source rank decay
    """
    q_clean = normalize_title(query)
    q_lower = query.lower()
    t_lower = (item.title or "").lower()
    title_clean, artist_clean, album_clean = _extract_item_metadata(item)
    q_tokens = set(q_clean.split())

    score = 0.0

    # 1. Exact artist intent: query is purely the artist (e.g. "atif aslam" or "arijit singh")
    if q_clean and artist_clean and (q_clean == artist_clean):
        score += 160.0
    elif q_clean and artist_clean and (
        re.search(r"(?:\b|^)" + re.escape(artist_clean) + r"(?:\b|$)", q_clean)
        or re.search(r"(?:\b|^)" + re.escape(q_clean) + r"(?:\b|$)", artist_clean)
    ):
        score += 90.0
    elif q_clean and artist_clean and any(
        len(a_tok) > 2 and a_tok in q_tokens for a_tok in artist_clean.split()
    ):
        score += 70.0

    # 2. Exact title match (e.g. "tu chahiye" or "love me not")
    is_exact_title = bool(q_clean and q_clean == title_clean)
    if is_exact_title:
        score += 140.0
        # Verbatim title match (without stripping "(From ...)" or movie tags) gets an extra boost
        raw_t_clean = " ".join(re.sub(r'[^\w\s]', ' ', (item.title or '').lower()).split())
        if q_clean == raw_t_clean:
            score += 35.0
    elif q_clean and title_clean and (
        re.search(r"(?:\b|^)" + re.escape(q_clean) + r"(?:\b|$)", title_clean)
    ):
        score += 75.0
    elif q_clean and title_clean and (
        re.search(r"(?:\b|^)" + re.escape(title_clean) + r"(?:\b|$)", q_clean)
    ):
        score += 55.0

    # 3. Combined title + artist in query (e.g. "tu chahiye atif aslam" or "love me not ravyn lenae")
    if title_clean and artist_clean:
        title_matches_q = (
            (len(title_clean) >= 3 and bool(re.search(r"(?:\b|^)" + re.escape(title_clean) + r"(?:\b|$)", q_clean)))
            or any(t in q_tokens for t in title_clean.split() if len(t) > 2)
        )
        artist_matches_q = (
            (len(artist_clean) >= 3 and bool(re.search(r"(?:\b|^)" + re.escape(artist_clean) + r"(?:\b|$)", q_clean)))
            or any(a in q_tokens for a in artist_clean.split() if len(a) > 2)
        )
        if title_matches_q and artist_matches_q:
            score += 110.0

    # 4. Popularity & views weighting (YouTube views + JioSaavn CTR)
    extra = item.extra or {}
    views = parse_views_to_int(extra.get("views"))
    if views > 0:
        score += min(110.0, math.log10(views + 1) * 13.0)

    ctr = extra.get("ctr")
    if isinstance(ctr, (int, float)) and ctr > 0:
        score += min(70.0, math.log10(ctr + 1) * 15.0)

    # 4b. Native provider baseline bonus: prefer high-quality native JioSaavn streams and metadata
    if item.provider == "saavn":
        score += 20.0

    # 5. Demote derivative junk (slowed, sped up, workout, karaoke, etc.) unless query requested it
    query_has_deriv = any(kw in q_lower for kw in DERIVATIVE_KEYWORDS)
    if not query_has_deriv:
        if any(kw in t_lower for kw in DERIVATIVE_KEYWORDS):
            score -= 250.0
        elif "cover" in t_lower and "cover" not in q_lower:
            score -= 200.0
        elif "remix" in t_lower and "remix" not in q_lower:
            score -= 200.0
        elif ("lirik" in t_lower or "lyrics video" in t_lower) and "lyric" not in q_lower:
            score -= 100.0

    # 6. Album match - do not double-boost if exact title match already matched and album is just the title
    if q_clean and album_clean and not (is_exact_title and album_clean == title_clean):
        if q_clean == album_clean:
            score += 40.0
        elif re.search(r"(?:\b|^)" + re.escape(q_clean) + r"(?:\b|$)", album_clean):
            score += 20.0

    # 7. Fuzzy title match fallback
    if title_clean:
        ratio = difflib.SequenceMatcher(None, q_clean, title_clean).ratio()
        if ratio > 0.72:
            score += ratio * 60.0

    # 8. Query token coverage across all metadata
    q_tokens_list = [t for t in q_clean.split() if len(t) > 1]
    title_tokens = set(title_clean.split())
    artist_tokens = set(artist_clean.split())
    album_tokens = set(album_clean.split()) if not (is_exact_title and album_clean == title_clean) else set()
    all_tokens = title_tokens | artist_tokens | album_tokens

    if q_tokens_list:
        matched = 0
        for qt in q_tokens_list:
            if qt in artist_tokens:
                score += 35.0
                matched += 1
            elif qt in title_tokens:
                score += 30.0
                matched += 1
            elif qt in album_tokens:
                score += 15.0
                matched += 1
            else:
                best = max([difflib.SequenceMatcher(None, qt, tok).ratio() for tok in all_tokens] or [0.0])
                if best >= 0.80:
                    score += best * 20.0
                    matched += 1

        if matched == len(q_tokens_list):
            score += 40.0

    # 9. Source rank preference (decay with position)
    score += max(0.0, 15.0 - (source_rank * 1.0))

    return score


def _rank_and_merge(
    query: str,
    saavn_songs: list[SearchItem],
    yt_songs: list[SearchItem],
    n: int,
) -> list[SearchItem]:
    """
    Rank and merge search items from multiple providers.

    Multi-tier deduplication:
      - Filters out derivative alterations (sped up, slowed, workout, covers) unless specifically queried
      - Provider ID & ISRC O(1) deduplication
      - Canonical (title, artist) pair O(1) deduplication
      - Title deduplication: restricts duplicate same-title songs so top hits dominate without spamming same tracks
      - Bounded secondary fuzzy pass
    """
    # Pass 1: Match JioSaavn items with YouTube items to inherit view counts.
    # When JioSaavn already has a matching track, enrich it with YouTube's view count
    # and mark the YouTube duplicate so JioSaavn remains the preferred high-bitrate version.
    matched_yt_ids: set[str] = set()
    for s_item in saavn_songs:
        st_clean, sa_clean, _ = _extract_item_metadata(s_item)
        s_artists = _extract_all_artists(s_item)
        if sa_clean:
            s_artists.add(sa_clean)

        for y_item in yt_songs:
            if y_item.id in matched_yt_ids:
                continue
            yt_clean, ya_clean, _ = _extract_item_metadata(y_item)
            y_artists = _extract_all_artists(y_item)
            if ya_clean:
                y_artists.add(ya_clean)

            if st_clean and yt_clean and st_clean == yt_clean:
                # Same title: require artists to overlap or match so distinct compositions/artists are not falsely conflated
                has_artist_match = bool(
                    (s_artists & y_artists)
                    or (sa_clean and ya_clean and (sa_clean in ya_clean or ya_clean in sa_clean))
                )
                if has_artist_match:
                    if not s_item.extra:
                        s_item.extra = {}
                    y_views = (y_item.extra or {}).get("views")
                    if y_views and not s_item.extra.get("views"):
                        s_item.extra["views"] = y_views
                    matched_yt_ids.add(y_item.id)
                    break

    scored_candidates: list[tuple[float, SearchItem]] = []
    for i, item in enumerate(saavn_songs):
        scored_candidates.append((_score_relevance(query, item, i), item))
    for j, item in enumerate(yt_songs):
        if item.id in matched_yt_ids:
            continue
        scored_candidates.append((_score_relevance(query, item, j), item))

    # Sort descending by score; break ties in favor of saavn
    scored_candidates.sort(key=lambda x: (x[0], 1 if x[1].provider == "saavn" else 0), reverse=True)

    merged: list[SearchItem] = []
    seen_provider_ids: set[str] = set()
    seen_isrcs: set[str] = set()
    seen_canonical_pairs: set[tuple[str, str]] = set()
    seen_titles_count: Counter[str] = Counter()
    seen_titles_to_artists: dict[str, set[str]] = {}
    recent_fuzzy_window: list[tuple[str, str]] = []

    q_clean = normalize_title(query)
    q_lower = query.lower()
    query_has_deriv = any(kw in q_lower for kw in DERIVATIVE_KEYWORDS)

    for score, item in scored_candidates:
        # Filter derivative junk unless specifically queried
        if not query_has_deriv:
            t_low = (item.title or "").lower()
            if (
                any(kw in t_low for kw in DERIVATIVE_KEYWORDS)
                or ("remix" in t_low and "remix" not in q_lower)
                or ("cover" in t_low and "cover" not in q_lower)
            ):
                continue

        # Tier 1a: Exact Provider ID (O(1))
        prov_key = f"{item.provider}:{item.provider_id}"
        if item.id in seen_provider_ids or prov_key in seen_provider_ids:
            continue

        # Tier 1b: Exact ISRC Recording ID (O(1))
        extra = item.extra or {}
        isrc = extra.get("isrc")
        if isrc and isrc in seen_isrcs:
            continue

        t_clean, a_clean, _ = _extract_item_metadata(item)
        pair_key = (t_clean, a_clean)

        # Tier 1c: Exact Canonical (title, artist) pair (O(1))
        if t_clean and a_clean and pair_key in seen_canonical_pairs:
            continue

        # Tier 1d: Exact title match with overlapping or matching artists (O(1))
        item_artists = _extract_all_artists(item)
        if a_clean:
            item_artists.add(a_clean)

        if t_clean and t_clean in seen_titles_to_artists:
            existing_artists = seen_titles_to_artists[t_clean]
            # If artist is missing or any artist overlaps
            if not a_clean or not existing_artists:
                continue
            if a_clean in existing_artists or any(
                a_clean == ea or a_clean in ea or ea in a_clean
                for ea in existing_artists
            ):
                continue
            if item_artists & existing_artists:
                continue

        # Cap exact title match to 1 when query is exact title
        if t_clean and t_clean == q_clean and seen_titles_count[t_clean] >= 1:
            continue

        # Cap duplicate titles in general to 1 unless it's a huge distinct hit (> 20M views)
        if t_clean and seen_titles_count[t_clean] >= 1:
            views = parse_views_to_int((item.extra or {}).get("views"))
            if seen_titles_count[t_clean] >= 2 or views < 20000000:
                continue

        # Tier 2: Bounded secondary fuzzy pass (at most 25 recent items)
        is_dup = False
        if t_clean and len(t_clean) > 5:
            for rt, ra in recent_fuzzy_window:
                if len(rt) > 5 and difflib.SequenceMatcher(None, t_clean, rt).ratio() >= 0.90:
                    if not a_clean or not ra or a_clean == ra or a_clean in ra or ra in a_clean:
                        is_dup = True
                        break

        if is_dup:
            continue

        seen_provider_ids.add(item.id)
        seen_provider_ids.add(prov_key)
        if isrc:
            seen_isrcs.add(isrc)
        if t_clean and a_clean:
            seen_canonical_pairs.add(pair_key)
        if t_clean:
            seen_titles_count[t_clean] += 1
            seen_titles_to_artists.setdefault(t_clean, set()).update(item_artists or {a_clean})
            recent_fuzzy_window.append((t_clean, a_clean))
            if len(recent_fuzzy_window) > 25:
                recent_fuzzy_window.pop(0)

        merged.append(item)
        if len(merged) >= n:
            break

    return merged


class HybridMusicProvider(MusicProvider):
    """
    Unified provider coordinating JioSaavn and YouTube Music.
    """

    provider_name: str = "hybrid"

    def __init__(
        self,
        saavn_provider: SaavnProvider,
        youtube_provider: YouTubeProvider,
    ) -> None:
        self.saavn = saavn_provider
        self.youtube = youtube_provider
        self._search_cache: dict[str, tuple[float, SearchResults]] = {}
        self._cache_ttl = 90.0  # 90 seconds query cache
        self._inflight_searches: dict[str, asyncio.Task[SearchResults]] = {}

    def _store_cache(self, key: str, res: SearchResults, ts: float) -> None:
        if len(self._search_cache) > 500:
            self._search_cache.clear()
        self._search_cache[key] = (ts, copy.deepcopy(res))

    # ── Search ───────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        q_clean = query.strip()
        cache_key = f"{q_clean.lower()}:{n}:{page}:{enrich}"
        now = time.time()

        # 1. Cache hit -> return isolated deep copy to prevent cross-request mutations
        if cache_key in self._search_cache:
            ts, cached_res = self._search_cache[cache_key]
            if now - ts < self._cache_ttl:
                return copy.deepcopy(cached_res)

        # 2. In-flight request coalescing -> wait on existing task if active
        if cache_key in self._inflight_searches:
            task = self._inflight_searches[cache_key]
            if not task.done():
                try:
                    res = await task
                    return copy.deepcopy(res)
                except Exception:
                    # In-flight task failed; fall through to fresh execution
                    pass

        # 3. Create fresh search execution task and register in _inflight_searches
        loop = asyncio.get_running_loop()
        search_task = loop.create_task(
            self._execute_search(
                query=query,
                q_clean=q_clean,
                n=n,
                page=page,
                enrich=enrich,
                cache_key=cache_key,
            )
        )
        self._inflight_searches[cache_key] = search_task

        try:
            res = await search_task
            return copy.deepcopy(res)
        finally:
            if self._inflight_searches.get(cache_key) is search_task:
                self._inflight_searches.pop(cache_key, None)

    async def _execute_search(
        self,
        query: str,
        q_clean: str,
        n: int,
        page: int,
        enrich: bool,
        cache_key: str,
    ) -> SearchResults:
        now = time.time()

        # Very short queries (<= 2 chars): fast provider-primary (Saavn) first
        if len(q_clean) <= 2:
            try:
                res = await self.saavn.search(query, n=n, page=page, enrich=enrich)
                self._store_cache(cache_key, res, now)
                return res
            except Exception as e:
                logger.warning("Saavn short query search failed: %s", e)

        # Full hybrid search: run Saavn + YouTube concurrently with 5.0s timeout on YouTube
        saavn_task = self.saavn.search(query, n=n, page=page, enrich=enrich)
        yt_task = asyncio.wait_for(
            self.youtube.search(query, n=min(n, 12), page=page),
            timeout=5.0,
        )

        saavn_res, yt_res = await asyncio.gather(saavn_task, yt_task, return_exceptions=True)

        if isinstance(saavn_res, Exception):
            logger.warning("Saavn search failed for query %r: %s", query, saavn_res)
            saavn_results = SearchResults(
                query=query, songs=[], albums=[], artists=[], playlists=[],
                total_songs=0, total_albums=0, total_artists=0, total_playlists=0,
            )
        else:
            saavn_results = saavn_res

        yt_songs: list[SearchItem] = []
        yt_albums: list[SearchItem] = []
        yt_artists: list[SearchItem] = []
        if not isinstance(yt_res, Exception) and yt_res:
            if yt_res.songs:
                yt_songs = yt_res.songs
            if yt_res.albums:
                yt_albums = yt_res.albums
            if yt_res.artists:
                yt_artists = yt_res.artists

        if saavn_results.songs or yt_songs:
            saavn_results.songs = _rank_and_merge(query, saavn_results.songs, yt_songs, n=n)
            saavn_results.total_songs = len(saavn_results.songs)

        # Merge YouTube albums if available
        if yt_albums:
            seen_alb = {normalize_title(a.title) for a in saavn_results.albums if a.title}
            for alb in yt_albums:
                norm_a = normalize_title(alb.title)
                if norm_a and norm_a not in seen_alb:
                    seen_alb.add(norm_a)
                    saavn_results.albums.append(alb)
            saavn_results.total_albums = len(saavn_results.albums)

        # Merge YouTube artists if available
        if yt_artists:
            seen_art = {normalize_title(art.title) for art in saavn_results.artists if art.title}
            for art in yt_artists:
                norm_a = normalize_title(art.title)
                if norm_a and norm_a not in seen_art:
                    seen_art.add(norm_a)
                    saavn_results.artists.append(art)
            saavn_results.total_artists = len(saavn_results.artists)

        # Canonical enrichment without fabricated/synthetic fallback Song models
        if enrich and saavn_results.songs:
            existing_enriched = {
                s.id: s for s in (saavn_results.enriched_songs or []) if isinstance(s, Song)
            }
            existing_by_pid = {
                s.provider_id: s for s in (saavn_results.enriched_songs or []) if isinstance(s, Song)
            }

            resolved_map: dict[str, Song] = dict(existing_enriched)

            enrich_candidates = saavn_results.songs[:n]
            unresolved_yt: list[SearchItem] = [
                item for item in enrich_candidates
                if item.provider == "youtube" and item.id not in resolved_map and item.provider_id not in existing_by_pid
            ]
            unresolved_saavn: list[SearchItem] = [
                item for item in enrich_candidates
                if item.provider == "saavn" and item.id not in resolved_map and item.provider_id not in existing_by_pid
            ]

            async def _resolve_yt(item: SearchItem) -> None:
                try:
                    song = await self.youtube.get_song(item.provider_id)
                    if song:
                        resolved_map[item.id] = song
                except Exception as ex:
                    logger.debug("Canonical YouTube resolution omitted for %s: %s", item.id, ex)

            async def _resolve_saavn(item: SearchItem) -> None:
                try:
                    song = await self.saavn.get_song(item.provider_id)
                    if song:
                        resolved_map[item.id] = song
                except Exception as ex:
                    logger.debug("Canonical Saavn resolution omitted for %s: %s", item.id, ex)

            tasks = [_resolve_yt(item) for item in unresolved_yt]
            if unresolved_saavn:
                tasks.extend([_resolve_saavn(item) for item in unresolved_saavn[:5]])

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

            # Only genuine canonical Song objects returned by the provider are retained
            saavn_results.enriched_songs = [
                resolved_map[item.id]
                for item in saavn_results.songs
                if item.id in resolved_map
            ]

        self._store_cache(cache_key, saavn_results, now)
        return saavn_results

    # ── Song Metadata ─────────────────────────────────────────────────────────

    async def get_song(self, song_id: str) -> Song:
        sid = song_id.strip()
        if sid.startswith("youtube:") or sid.startswith("yt:"):
            return await self.youtube.get_song(sid)

        clean_saavn_id = sid[6:] if sid.startswith("saavn:") else sid
        try:
            return await self.saavn.get_song(clean_saavn_id)
        except ProviderNotFound:
            # Fallback check YouTube
            try:
                return await self.youtube.get_song(sid)
            except Exception:
                raise ProviderNotFound(f"Song not found: {sid}", provider="hybrid")

    async def get_songs(self, song_ids: list[str]) -> list[Song]:
        saavn_ids: list[tuple[int, str]] = []
        yt_ids: list[tuple[int, str]] = []

        for idx, sid in enumerate(song_ids):
            clean_s = sid.strip()
            if clean_s.startswith("youtube:") or clean_s.startswith("yt:"):
                yt_ids.append((idx, clean_s))
            else:
                if clean_s.startswith("saavn:"):
                    clean_s = clean_s[6:]
                saavn_ids.append((idx, clean_s))

        results: list[Optional[Song]] = [None] * len(song_ids)

        if saavn_ids:
            s_res = await self.saavn.get_songs([sid for _, sid in saavn_ids])
            for (idx, _), song in zip(saavn_ids, s_res):
                results[idx] = song

        if yt_ids:
            yt_res = await self.youtube.get_songs([sid for _, sid in yt_ids])
            for (idx, _), song in zip(yt_ids, yt_res):
                results[idx] = song

        return [r for r in results if r is not None]

    # ── Media Stream Resolution ───────────────────────────────────────────────

    async def resolve_media(self, song: Song) -> Optional[MediaInfo]:
        if song.provider == "youtube" or song.id.startswith(("youtube:", "yt:")):
            return await self.youtube.resolve_media(song)

        # Primary: JioSaavn (clean saavn: prefix from song id if present)
        saavn_song = song
        if song.id.startswith("saavn:"):
            saavn_song = copy.copy(song)
            saavn_song.id = song.id[6:]

        try:
            media = await self.saavn.resolve_media(saavn_song)
            if media and media.streams:
                return media
        except Exception as exc:
            logger.warning("Saavn media resolution failed for %s: %s", song.id, exc)

        # Fallback to YouTube if JioSaavn has no streams or is disabled
        artist_str = ", ".join(a.name for a in song.artists if a.name)
        logger.info("JioSaavn streams unavailable for '%s'. Resolving via YouTube fallback...", song.title)
        return await self.youtube.resolve_by_query(song.title, artist_str)

    # ── Pass-throughs ─────────────────────────────────────────────────────────

    async def resolve_url(self, url: str):
        if "youtube.com" in url or "youtu.be" in url:
            return await self.youtube.resolve_url(url)
        return await self.saavn.resolve_url(url)

    async def get_lyrics(self, lyrics_id: str) -> Lyrics:
        clean_lid = lyrics_id.strip()
        if clean_lid.startswith("youtube:") or clean_lid.startswith("yt:"):
            return await self.youtube.get_lyrics(clean_lid)
        if clean_lid.startswith("saavn:"):
            clean_lid = clean_lid[6:]
        return await self.saavn.get_lyrics(clean_lid)

    async def get_album(self, album_id: str) -> Album:
        return await self.saavn.get_album(album_id)

    async def get_playlist(self, playlist_id: str) -> Playlist:
        return await self.saavn.get_playlist(playlist_id)

    async def get_artist(self, artist_id: str) -> Artist:
        return await self.saavn.get_artist(artist_id)

    async def get_artist_songs(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Song]:
        return await self.saavn.get_artist_songs(artist_id, page=page, n=n)

    async def get_artist_albums(
        self, artist_id: str, *, page: int = 0, n: int = 50
    ) -> list[Album]:
        return await self.saavn.get_artist_albums(artist_id, page=page, n=n)

    async def health_check(self) -> dict:
        return await self.saavn.health_check()

    # ── Candidate Discovery (YouTube Music Integration) ───────────────────────

    async def get_radio_candidates(self, video_id: str, limit: int = 20) -> list[Song]:
        try:
            return await self.youtube.get_radio_candidates(video_id, limit=limit)
        except Exception as e:
            logger.debug("HybridMusicProvider.get_radio_candidates error: %s", e)
            return []

    async def get_related_candidates(self, video_id: str, limit: int = 20) -> list[Song]:
        try:
            return await self.youtube.get_related_candidates(video_id, limit=limit)
        except Exception as e:
            logger.debug("HybridMusicProvider.get_related_candidates error: %s", e)
            return []

    async def get_artist_candidates(self, artist_name_or_id: str, limit: int = 20) -> list[Song]:
        try:
            return await self.youtube.get_artist_candidates(artist_name_or_id, limit=limit)
        except Exception as e:
            logger.debug("HybridMusicProvider.get_artist_candidates error: %s", e)
            return []

