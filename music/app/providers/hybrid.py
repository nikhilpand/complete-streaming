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


def _score_relevance(query: str, item: SearchItem, source_rank: int) -> float:
    q = query.lower().strip()
    q_clean = _clean_str(query)
    title = item.title.lower().strip()
    title_clean = _clean_str(item.title)
    subtitle = (item.subtitle or "").lower().strip()
    sub_clean = _clean_str(subtitle)
    full_clean = f"{title_clean} {sub_clean}"

    score = 0.0

    # 1. Title phrase matches
    if q_clean and q_clean == title_clean:
        score += 120.0
    elif q_clean and title_clean.startswith(q_clean):
        score += 70.0
    elif q_clean and q_clean in title_clean:
        score += 50.0
    elif q_clean and q_clean in full_clean:
        score += 35.0
    else:
        ratio = difflib.SequenceMatcher(None, q_clean or q, title_clean or title).ratio()
        if ratio > 0.70:
            score += ratio * 80.0

    # 2. Token-level matching (exact or fuzzy)
    q_tokens = [t for t in q_clean.split() if len(t) > 1]
    title_tokens = [t for t in title_clean.split() if len(t) > 1]
    sub_tokens = [t for t in sub_clean.split() if len(t) > 1]

    if q_tokens:
        matched = 0
        for qt in q_tokens:
            if any(qt == tt for tt in title_tokens):
                score += 30.0
                matched += 1
            elif any(qt == st for st in sub_tokens):
                score += 20.0
                matched += 1
            else:
                best_t = max([difflib.SequenceMatcher(None, qt, tt).ratio() for tt in title_tokens] or [0.0])
                best_s = max([difflib.SequenceMatcher(None, qt, st).ratio() for st in sub_tokens] or [0.0])
                best = max(best_t, best_s)
                if best >= 0.78:
                    score += best * 25.0
                    matched += 1

        if matched == len(q_tokens):
            score += 40.0

    # 3. Provider source rank preference (decay with position)
    score += max(0.0, 15.0 - (source_rank * 1.2))

    return score


def _norm_info(item: SearchItem) -> tuple[str, set[str]]:
    clean_t = _clean_str(item.title)
    sub = (item.subtitle or "").lower()
    a_tokens = set(re.findall(r"\w+", sub))
    return clean_t, a_tokens


def _is_duplicate(t1: str, a1: set[str], t2: str, a2: set[str]) -> bool:
    if not t1 or not t2:
        return False
    ratio = difflib.SequenceMatcher(None, t1, t2).ratio()
    if t1 == t2 or ratio >= 0.88:
        if a1 and a2:
            return any(len(tok) > 2 for tok in a1.intersection(a2))
        return True
    return False


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

    # Deduplicate matching tracks
    merged: list[SearchItem] = []
    seen: list[tuple[str, set[str], SearchItem]] = []
    for score, item in scored_candidates:
        t, a = _norm_info(item)
        dup = False
        for st, sa, sitem in seen:
            if _is_duplicate(t, a, st, sa):
                dup = True
                break
        if not dup:
            seen.append((t, a, item))
            merged.append(item)
            if len(merged) >= n:
                break

    return merged


def _search_item_to_song(item: SearchItem) -> Song:
    raw_artists = (item.subtitle or "YouTube Music").split(",")
    artists = [
        ArtistRef(
            id=f"youtube:artist:{a.strip().lower().replace(' ', '_')}",
            provider="youtube",
            provider_id=a.strip().lower().replace(" ", "_"),
            name=a.strip(),
            role="primary",
        )
        for a in raw_artists
        if a.strip()
    ]
    if not artists:
        artists = [
            ArtistRef(
                id="youtube:artist:unknown",
                provider="youtube",
                provider_id="unknown",
                name="YouTube Music",
                role="primary",
            )
        ]
    extra = item.extra or {}
    return Song(
        id=item.id,
        provider="youtube",
        provider_id=item.provider_id,
        title=item.title,
        artists=artists,
        featured_artists=[],
        album=extra.get("album") or "YouTube Music",
        album_id=None,
        duration_ms=extra.get("duration_ms"),
        artwork_url=item.artwork_url,
        language=None,
        year=None,
        release_date=None,
        label="YouTube Music",
        copyright_text=None,
        has_lyrics=False,
        lyrics_id=None,
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

    # ── Search ───────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        # Run Saavn and YouTube searches concurrently in parallel
        saavn_task = self.saavn.search(query, n=n, page=page, enrich=enrich)
        yt_task = self.youtube.search(query, n=min(n, 12), page=page)

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

        if yt_songs:
            saavn_results.songs = _rank_and_merge(query, saavn_results.songs, yt_songs, n=n)
            saavn_results.total_songs = len(saavn_results.songs)

        # Keep enriched_songs in sync when enrich is requested
        if enrich and saavn_results.songs:
            existing_enriched = {s.id: s for s in (saavn_results.enriched_songs or [])}
            new_enriched: list[Song] = []
            for s_item in saavn_results.songs:
                if s_item.id in existing_enriched:
                    new_enriched.append(existing_enriched[s_item.id])
                elif s_item.provider == "youtube":
                    new_enriched.append(_search_item_to_song(s_item))
                else:
                    new_enriched.append(
                        Song(
                            id=s_item.id,
                            provider=s_item.provider,
                            provider_id=s_item.provider_id,
                            title=s_item.title,
                            artists=[
                                ArtistRef(
                                    id="",
                                    provider=s_item.provider,
                                    provider_id="",
                                    name=s_item.subtitle or "Artist",
                                    role="primary",
                                )
                            ],
                            artwork_url=s_item.artwork_url,
                            has_media=True,
                        )
                    )
            saavn_results.enriched_songs = new_enriched

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
