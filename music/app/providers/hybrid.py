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
import difflib
import logging
import re
import time
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


def _clean_str(s: str) -> str:
    # Remove metadata in brackets like (From "Film"), [Official], etc.
    s = re.sub(r"[\(\[\{].*?[\)\]\}]", "", s)
    return re.sub(r"[^\w\s]", " ", s.lower()).strip()


def _extract_item_metadata(item: SearchItem) -> tuple[str, str, str]:
    """
    Extract canonical (clean_title, clean_artist, clean_album) from SearchItem.
    Works consistently across Saavn and YouTube items without lossy heuristics.
    """
    title_clean = _clean_str(item.title)
    extra = item.extra or {}
    album = extra.get("album") or ""
    primary_artist = extra.get("primary_artists") or extra.get("artist") or ""

    subtitle = item.subtitle or ""
    if not primary_artist:
        if item.provider == "youtube":
            primary_artist = subtitle.split(",")[0].strip()
        else:
            # JioSaavn subtitle format: "Album · Artist" or "Artist"
            parts = [p.strip() for p in re.split(r"[·•|]", subtitle) if p.strip()]
            if len(parts) > 1:
                if not album:
                    album = parts[0]
                primary_artist = parts[-1].split(",")[0].strip()
            elif len(parts) == 1:
                primary_artist = parts[0].split(",")[0].strip()

    return title_clean, _clean_str(primary_artist), _clean_str(album)


def _score_relevance(query: str, item: SearchItem, source_rank: int) -> float:
    """
    Multi-feature relevance model explicitly ranking:
      - Exact artist intent
      - Artist phrase & prefix
      - Exact title & prefix
      - Combined title + artist in query
      - Album match
      - Full query token coverage
      - Source rank decay
    """
    q_clean = _clean_str(query)
    title_clean, artist_clean, album_clean = _extract_item_metadata(item)

    score = 0.0

    # 1. Exact artist intent: query is purely the artist (e.g. "atif aslam" or "arijit singh")
    if q_clean and artist_clean and (q_clean == artist_clean):
        score += 160.0
    elif q_clean and artist_clean and (artist_clean.startswith(q_clean) or q_clean.startswith(artist_clean)):
        score += 90.0
    elif q_clean and artist_clean and (artist_clean in q_clean or q_clean in artist_clean):
        score += 70.0

    # 2. Exact title match (e.g. "tu chahiye")
    if q_clean and q_clean == title_clean:
        score += 140.0
    elif q_clean and title_clean.startswith(q_clean):
        score += 75.0
    elif q_clean and q_clean in title_clean:
        score += 55.0

    # 3. Combined title + artist in query (e.g. "tu chahiye atif aslam" or "tu chahiye atif")
    if title_clean and artist_clean:
        title_in_q = any(t in q_clean for t in title_clean.split() if len(t) > 2)
        artist_in_q = any(a in q_clean for a in artist_clean.split() if len(a) > 2)
        if title_in_q and artist_in_q:
            score += 110.0

    # 4. Album match
    if q_clean and album_clean:
        if q_clean == album_clean:
            score += 50.0
        elif q_clean in album_clean:
            score += 30.0

    # 5. Fuzzy title match fallback
    if title_clean:
        ratio = difflib.SequenceMatcher(None, q_clean, title_clean).ratio()
        if ratio > 0.72:
            score += ratio * 60.0

    # 6. Query token coverage across all metadata
    q_tokens = [t for t in q_clean.split() if len(t) > 1]
    title_tokens = set(title_clean.split())
    artist_tokens = set(artist_clean.split())
    album_tokens = set(album_clean.split())
    all_tokens = title_tokens | artist_tokens | album_tokens

    if q_tokens:
        matched = 0
        for qt in q_tokens:
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

        if matched == len(q_tokens):
            score += 40.0

    # 7. Source rank preference (decay with position)
    score += max(0.0, 15.0 - (source_rank * 1.0))

    return score


def _rank_and_merge(
    query: str,
    saavn_songs: list[SearchItem],
    yt_songs: list[SearchItem],
    n: int,
) -> list[SearchItem]:
    scored_candidates: list[tuple[float, SearchItem]] = []
    for i, item in enumerate(saavn_songs):
        scored_candidates.append((_score_relevance(query, item, i), item))
    for j, item in enumerate(yt_songs):
        scored_candidates.append((_score_relevance(query, item, j), item))

    # Sort descending by score
    scored_candidates.sort(key=lambda x: x[0], reverse=True)

    # O(1) canonical deduplication with bounded fuzzy fallback
    merged: list[SearchItem] = []
    seen_provider_ids: set[str] = set()
    seen_isrcs: set[str] = set()
    seen_canonical_pairs: set[tuple[str, str]] = set()
    recent_fingerprints: list[tuple[str, str]] = []

    for score, item in scored_candidates:
        # 1. Exact provider ID
        prov_key = f"{item.provider}:{item.provider_id}"
        if item.id in seen_provider_ids or prov_key in seen_provider_ids:
            continue

        extra = item.extra or {}
        isrc = extra.get("isrc")
        if isrc and isrc in seen_isrcs:
            continue

        t_clean, a_clean, _ = _extract_item_metadata(item)
        pair_key = (t_clean, a_clean)

        # 2. Canonical (title, artist) pair
        if t_clean and a_clean and pair_key in seen_canonical_pairs:
            continue

        # 3. Bounded fuzzy check against recent items
        is_dup = False
        if t_clean:
            for rt, ra in recent_fingerprints:
                if t_clean == rt:
                    if not a_clean or not ra or a_clean in ra or ra in a_clean:
                        is_dup = True
                        break
                elif len(t_clean) > 5 and len(rt) > 5:
                    ratio = difflib.SequenceMatcher(None, t_clean, rt).ratio()
                    if ratio >= 0.90:
                        if not a_clean or not ra or a_clean == ra:
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
        recent_fingerprints.append((t_clean, a_clean))
        if len(recent_fingerprints) > 25:
            recent_fingerprints.pop(0)

        merged.append(item)
        if len(merged) >= n:
            break

    return merged


def search_item_to_canonical_song(item: SearchItem) -> Song:
    """
    Canonical transformation from SearchItem to a complete Song without lossy mock fields.
    """
    extra = item.extra or {}
    subtitle = item.subtitle or ""

    if item.provider == "youtube":
        artist_names = [a.strip() for a in subtitle.split(",") if a.strip()] or ["YouTube Music"]
        album_name = extra.get("album") or "YouTube Music"
    else:
        parts = [p.strip() for p in re.split(r"[·•|]", subtitle) if p.strip()]
        if len(parts) > 1:
            album_name = parts[0]
            artist_names = [a.strip() for a in parts[-1].split(",") if a.strip()]
        elif len(parts) == 1:
            album_name = extra.get("album") or "Single"
            artist_names = [a.strip() for a in parts[0].split(",") if a.strip()]
        else:
            album_name = extra.get("album") or "Single"
            artist_names = ["Artist"]

    artists = [
        ArtistRef(
            id=f"{item.provider}:artist:{name.lower().replace(' ', '_')}",
            provider=item.provider,
            provider_id=name.lower().replace(" ", "_"),
            name=name,
            role="primary" if idx == 0 else "featured",
        )
        for idx, name in enumerate(artist_names or ["Artist"])
    ]

    return Song(
        id=item.id,
        provider=item.provider,
        provider_id=item.provider_id,
        title=item.title,
        artists=artists,
        featured_artists=[],
        album=album_name,
        album_id=extra.get("album_id"),
        duration_ms=extra.get("duration_ms"),
        artwork_url=item.artwork_url,
        language=extra.get("language"),
        year=str(extra.get("year")) if extra.get("year") else None,
        release_date=extra.get("release_date"),
        label=extra.get("label") or ("YouTube Music" if item.provider == "youtube" else "JioSaavn"),
        copyright_text=extra.get("copyright_text"),
        has_lyrics=bool(extra.get("has_lyrics", False)),
        lyrics_id=extra.get("lyrics_id"),
        has_media=True,
        is_explicit=bool(extra.get("is_explicit", False)),
        perma_url=item.perma_url,
    )


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

        if cache_key in self._search_cache:
            ts, cached_res = self._search_cache[cache_key]
            if now - ts < self._cache_ttl:
                return cached_res

        # Very short queries (<= 2 chars): fast provider-primary (Saavn) first
        if len(q_clean) <= 2:
            try:
                res = await self.saavn.search(query, n=n, page=page, enrich=enrich)
                self._search_cache[cache_key] = (now, res)
                return res
            except Exception as e:
                logger.warning("Saavn short query search failed: %s", e)

        # Full hybrid search: run Saavn + YouTube concurrently with 2.5s timeout on YouTube
        saavn_task = self.saavn.search(query, n=n, page=page, enrich=enrich)
        yt_task = asyncio.wait_for(
            self.youtube.search(query, n=min(n, 12), page=page),
            timeout=2.5,
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
        if not isinstance(yt_res, Exception) and yt_res and yt_res.songs:
            yt_songs = yt_res.songs

        if saavn_results.songs or yt_songs:
            saavn_results.songs = _rank_and_merge(query, saavn_results.songs, yt_songs, n=n)
            saavn_results.total_songs = len(saavn_results.songs)

        # Keep enriched_songs in sync when enrich is requested
        if enrich and saavn_results.songs:
            existing_enriched = {s.id: s for s in (saavn_results.enriched_songs or [])}
            new_enriched: list[Song] = []
            yt_enrich_tasks: list[tuple[int, SearchItem]] = []

            for idx, s_item in enumerate(saavn_results.songs):
                if s_item.id in existing_enriched:
                    new_enriched.append(existing_enriched[s_item.id])
                elif s_item.provider == "youtube":
                    new_enriched.append(search_item_to_canonical_song(s_item))
                    yt_enrich_tasks.append((idx, s_item))
                else:
                    new_enriched.append(search_item_to_canonical_song(s_item))

            if yt_enrich_tasks:
                async def _enrich_yt(index: int, item: SearchItem):
                    try:
                        resolved = await self.youtube.get_song(item.provider_id)
                        if resolved:
                            new_enriched[index] = resolved
                    except Exception as ex:
                        logger.debug("Could not enrich YouTube song %s: %s", item.id, ex)

                await asyncio.gather(*[_enrich_yt(idx, item) for idx, item in yt_enrich_tasks])

            saavn_results.enriched_songs = new_enriched

        if len(self._search_cache) > 500:
            self._search_cache.clear()
        self._search_cache[cache_key] = (now, saavn_results)

        return saavn_results

    # ── Song Metadata ─────────────────────────────────────────────────────────

    async def get_song(self, song_id: str) -> Song:
        sid = song_id.strip()
        if sid.startswith("youtube:") or sid.startswith("yt:"):
            return await self.youtube.get_song(sid)

        try:
            return await self.saavn.get_song(sid)
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
            if sid.startswith("youtube:") or sid.startswith("yt:"):
                yt_ids.append((idx, sid))
            else:
                saavn_ids.append((idx, sid))

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
        if song.provider == "youtube" or song.id.startswith("youtube:"):
            return await self.youtube.resolve_media(song)

        # Primary: JioSaavn
        try:
            media = await self.saavn.resolve_media(song)
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
        if lyrics_id.startswith("youtube:") or lyrics_id.startswith("yt:"):
            return await self.youtube.get_lyrics(lyrics_id)
        return await self.saavn.get_lyrics(lyrics_id)

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
