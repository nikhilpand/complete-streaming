from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

# Ensure sway_taste_engine is on path
repo_root = Path(__file__).resolve().parents[3]
taste_engine_dir = repo_root / "sway_taste_engine"
if str(taste_engine_dir) not in sys.path:
    sys.path.insert(0, str(taste_engine_dir))

from app.models import Song
from app.providers.base import MusicProvider
from sway_taste_engine.metadata import clean_track_id, extract_track_features
from sway_taste_engine.models import Track, UserTasteProfile
from sway_taste_engine.normalizer import canonical_song_key, is_derivative_track
from sway_taste_engine.storage import TasteStore

logger = logging.getLogger(__name__)


@dataclass
class GeneratorBudget:
    same_artist: int = 40
    similar_artists: int = 50
    album_soundtrack: int = 30
    taste_neighbors: int = 50
    collaborative: int = 50
    discovery: int = 50
    exploration: int = 30
    ytm_radio: int = 30
    ytm_related: int = 30
    ytm_artist: int = 30


# Pre-mapped contemporary artist clusters for high-affinity Indian music genres
CONTEMPORARY_ARTISTS: dict[str, list[str]] = {
    "atif aslam": ["Arijit Singh", "Mohit Chauhan", "KK", "Mustafa Zahid", "Armaan Malik"],
    "arijit singh": ["Atif Aslam", "Mohit Chauhan", "Jubin Nautiyal", "Papon", "Armaan Malik"],
    "pritam": ["Vishal-Shekhar", "Sachin-Jigar", "Shankar-Ehsaan-Loy", "Mithoon", "A.R. Rahman"],
    "a.r. rahman": ["Pritam", "Amit Trivedi", "Shankar-Ehsaan-Loy", "Ajay-Atul", "Harris Jayaraj"],
    "shreya ghoshal": ["Sunidhi Chauhan", "Neeti Mohan", "Monali Thakur", "Shalmali Kholgade"],
    "diljit dosanjh": ["Karan Aujla", "AP Dhillon", "Sidhu Moose Wala", "Guru Randhawa", "Amrinder Gill"],
}


class CandidateBuilder:
    """Multi-generator candidate retrieval pipeline with strict generator budgeting.

    Aggregates candidates across distinct generators:
    1. same_artist (budget 40)
    2. similar_artists (budget 50)
    3. album_soundtrack (budget 30)
    4. taste_neighbors (budget 50)
    5. collaborative (budget 50)
    6. discovery (budget 50)
    7. exploration (budget 30)
    8. ytm_radio (budget 30)
    9. ytm_related (budget 30)
    10. ytm_artist (budget 30)

    Guarantees a diversified candidate pool of 150–400 deduplicated tracks.
    """

    def __init__(
        self,
        provider: MusicProvider,
        taste_store: TasteStore,
        budget: Optional[GeneratorBudget] = None,
    ) -> None:
        self.provider = provider
        self.taste_store = taste_store
        self.budget = budget or GeneratorBudget()
        self._seed_video_cache: dict[str, str] = {}
        self._used_seeds: set[str] = set()

    async def build_candidates(
        self,
        seed_song: Optional[Song] = None,
        profile: Optional[UserTasteProfile] = None,
    ) -> Tuple[List[Track], Dict[str, int]]:
        """Concurrently retrieve candidates across generators with exact quota enforcement."""
        tasks = [
            self._gen_same_artist(seed_song),
            self._gen_similar_artists(seed_song, profile),
            self._gen_album_soundtrack(seed_song),
            self._gen_taste_neighbors(seed_song, profile),
            self._gen_collaborative(seed_song),
            self._gen_discovery(seed_song, profile),
            self._gen_exploration(seed_song, profile),
            self._gen_ytm_radio(seed_song, profile),
            self._gen_ytm_related(seed_song, profile),
            self._gen_ytm_artist(seed_song, profile),
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        generator_names = [
            "same_artist",
            "similar_artists",
            "album_soundtrack",
            "taste_neighbors",
            "collaborative",
            "discovery",
            "exploration",
            "ytm_radio",
            "ytm_related",
            "ytm_artist",
        ]

        budgets = [
            self.budget.same_artist,
            self.budget.similar_artists,
            self.budget.album_soundtrack,
            self.budget.taste_neighbors,
            self.budget.collaborative,
            self.budget.discovery,
            self.budget.exploration,
            self.budget.ytm_radio,
            self.budget.ytm_related,
            self.budget.ytm_artist,
        ]

        dedup_tracks: Dict[str, Track] = {}
        seen_canonical_keys: Dict[tuple[str, str], str] = {}
        attribution: Dict[str, int] = {name: 0 for name in generator_names}

        seed_c_key = None
        seed_is_derivative = False
        if seed_song:
            seed_artist = getattr(seed_song, "subtitle", "") or (seed_song.artists[0].name if getattr(seed_song, "artists", None) else "")
            seed_c_key = canonical_song_key(
                title=getattr(seed_song, "title", ""),
                artist_name=seed_artist,
                fallback_id=getattr(seed_song, "id", ""),
                album=getattr(seed_song, "album", ""),
            )
            seed_is_derivative = is_derivative_track(getattr(seed_song, "title", ""), seed_artist)
            if seed_c_key[0]:
                seen_canonical_keys[seed_c_key] = getattr(seed_song, "id", "")

        for name, budget_limit, res in zip(generator_names, budgets, results):
            if isinstance(res, Exception):
                logger.warning("Candidate generator %s failed: %s", name, res)
                continue
            if not isinstance(res, list):
                continue

            count = 0
            for item in res:
                if count >= budget_limit:
                    break
                # item can be Song or Track
                track = extract_track_features(item) if not isinstance(item, Track) else item
                if not track.id:
                    continue

                # Exclude seed track itself
                if seed_song and clean_track_id(track.id) == clean_track_id(getattr(seed_song, "id", "")):
                    continue

                # Exclude derivative uploads (workout, sped up, slowed, karaoke) unless seed song is itself derivative
                if not seed_is_derivative and is_derivative_track(track.title, track.artist_name):
                    continue

                # Negative memory filtering
                if profile and (
                    track.id in profile.explicit_negative_tracks
                    or track.artist_id in profile.explicit_negative_artists
                    or track.id in profile.negative_memory.high_confidence_skips
                ):
                    continue

                # Unplayable filtering
                if not track.playable:
                    continue

                # Exclude mock / fake fixture tracks
                if (
                    (track.title and "sample track" in track.title.lower())
                    or (track.artist_name and "artist 0" in track.artist_name.lower())
                    or (track.id and track.id.startswith("track_seed_"))
                ):
                    continue

                c_key = canonical_song_key(
                    title=track.title,
                    artist_name=track.artist_name,
                    fallback_id=track.id,
                    album=track.album,
                )

                if track.id not in dedup_tracks and (not c_key[0] or c_key not in seen_canonical_keys):
                    dedup_tracks[track.id] = track
                    if c_key[0]:
                        seen_canonical_keys[c_key] = track.id
                    count += 1
                else:
                    existing_id = track.id if track.id in dedup_tracks else (seen_canonical_keys.get(c_key) if c_key[0] else None)
                    if existing_id and existing_id in dedup_tracks:
                        existing = dedup_tracks[existing_id]
                        if not existing.composers and track.composers:
                            existing.composers = track.composers
                        if not existing.artwork_url and track.artwork_url:
                            existing.artwork_url = track.artwork_url
                        if track.provider_available:
                            existing.provider_available.update(track.provider_available)

            attribution[name] = count

        candidate_list = list(dedup_tracks.values())

        # Persist discovered tracks to SQLite
        try:
            self.taste_store.upsert_tracks(candidate_list)
        except Exception as ex:
            logger.warning("Failed to batch upsert candidate tracks to taste store: %s", ex)

        return candidate_list, attribution


    async def _safe_search(self, query: str, n: int) -> List[Any]:
        try:
            res = await self.provider.search(query, n=n)
            return res.songs or []
        except Exception as e:
            logger.debug("Provider search failed for query '%s': %s", query, e)
            return []

    async def _gen_same_artist(self, seed: Optional[Song]) -> List[Song]:
        if not seed:
            return []
        artist_id = ""
        artist_name = ""
        if hasattr(seed, "artists") and seed.artists:
            first = seed.artists[0]
            artist_id = getattr(first, "id", "") or ""
            artist_name = getattr(first, "name", "") or ""
        elif hasattr(seed, "subtitle") and seed.subtitle:
            artist_name = seed.subtitle

        if not artist_name:
            return []

        songs: List[Song] = []
        if artist_id and hasattr(self.provider, "get_artist_songs"):
            try:
                songs = await self.provider.get_artist_songs(artist_id, n=self.budget.same_artist)
            except Exception as e:
                logger.debug("get_artist_songs failed for artist_id %s: %s", artist_id, e)

        if len(songs) < self.budget.same_artist:
            needed = self.budget.same_artist - len(songs)
            search_songs = await self._safe_search(f"{artist_name} songs", n=needed)
            songs.extend(search_songs)

        return songs[: self.budget.same_artist]

    async def _gen_similar_artists(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> List[Song]:
        artist_name = ""
        if seed and hasattr(seed, "artists") and seed.artists:
            artist_name = seed.artists[0].name.lower().strip()

        # Find contemporary artists
        contemporaries = CONTEMPORARY_ARTISTS.get(artist_name, [])
        if not contemporaries and profile:
            # Fall back to top artists from profile
            top_profile_artists = sorted(
                profile.recent_30d.artist.items(),
                key=lambda x: x[1].positive,
                reverse=True,
            )
            contemporaries = [name for name, _ in top_profile_artists[:3]]

        if not contemporaries:
            contemporaries = ["Arijit Singh", "Atif Aslam", "Mohit Chauhan"]

        quota_per_artist = max(10, self.budget.similar_artists // len(contemporaries))
        subtasks = [self._safe_search(f"{a} top hits", n=quota_per_artist) for a in contemporaries]
        results = await asyncio.gather(*subtasks, return_exceptions=True)

        merged: List[Song] = []
        for r in results:
            if isinstance(r, list):
                merged.extend(r)
        return merged[: self.budget.similar_artists]

    async def _gen_album_soundtrack(self, seed: Optional[Song]) -> List[Song]:
        if not seed:
            return []
        songs: List[Song] = []

        # 1. Album tracklist
        album_id = getattr(seed, "album_id", None)
        if album_id and hasattr(self.provider, "get_album"):
            try:
                alb = await self.provider.get_album(album_id)
                if alb and alb.songs:
                    songs.extend(alb.songs)
            except Exception as e:
                logger.debug("get_album failed for album %s: %s", album_id, e)

        # 2. Composer soundtrack search
        composers = []
        if hasattr(seed, "artists"):
            for a in seed.artists:
                if getattr(a, "role", None) in {"composer", "music"} and a.name:
                    composers.append(a.name)

        if getattr(seed, "album", None):
            alb_songs = await self._safe_search(f"{seed.album} songs", n=15)
            songs.extend(alb_songs)

        if composers:
            c_songs = await self._safe_search(f"{composers[0]} soundtrack songs", n=15)
            songs.extend(c_songs)

        return songs[: self.budget.album_soundtrack]

    async def _gen_taste_neighbors(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> List[Song]:
        lang = getattr(seed, "language", "hindi") or "hindi"
        queries: List[str] = []

        if profile:
            top_genres = sorted(
                profile.recent_30d.genre.items(),
                key=lambda x: x[1].positive,
                reverse=True,
            )
            top_moods = sorted(
                profile.recent_30d.mood.items(),
                key=lambda x: x[1].positive,
                reverse=True,
            )
            for g, _ in top_genres[:2]:
                queries.append(f"{g} {lang} songs")
            for m, _ in top_moods[:2]:
                queries.append(f"{m} {lang} songs")

        if not queries:
            queries = [f"romantic {lang} songs", f"melodic {lang} hits"]

        subtasks = [self._safe_search(q, n=25) for q in queries[:2]]
        results = await asyncio.gather(*subtasks, return_exceptions=True)

        merged: List[Song] = []
        for r in results:
            if isinstance(r, list):
                merged.extend(r)
        return merged[: self.budget.taste_neighbors]

    async def _gen_collaborative(self, seed: Optional[Song]) -> List[Song]:
        if not seed:
            return []
        seed_id = clean_track_id(getattr(seed, "id", "") or getattr(seed, "provider_id", ""))
        if not seed_id:
            return []

        # 1. Look up cached top-K similarity edges
        similar_edges = self.taste_store.get_top_k_similar_tracks(seed_id, k=self.budget.collaborative)
        # 2. Look up sequence transition graph
        transitions = self.taste_store.get_transitions_from(seed_id, limit=self.budget.collaborative)

        track_ids = list(dict.fromkeys([t[0] for t in similar_edges] + [t[0] for t in transitions]))

        cached_songs: List[Song] = []
        for tid in track_ids[: self.budget.collaborative]:
            t = self.taste_store.get_track(tid)
            if t:
                # Convert Track to Song for uniform list
                cached_songs.append(
                    Song(
                        id=t.id,
                        provider="jiosaavn",
                        provider_id=t.id,
                        title=t.title,
                        artists=[
                            {"id": a.id, "name": a.name, "role": a.role, "image_url": a.image_url}
                            for a in t.artists
                        ]
                        if t.artists
                        else [{"id": t.artist_id, "name": t.artist_name, "role": "primary"}],
                        album=t.album,
                        album_id=t.album_id,
                        year=t.year,
                        duration_ms=t.duration_ms,
                        language=t.language,
                        artwork_url=t.artwork_url,
                    )
                )

        if len(cached_songs) < self.budget.collaborative:
            # Fallback to contemporary search if graph is cold
            fallback = await self._safe_search(f"{seed.title} remix radio", n=self.budget.collaborative - len(cached_songs))
            cached_songs.extend(fallback)

        return cached_songs[: self.budget.collaborative]

    async def _gen_discovery(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> List[Song]:
        lang = getattr(seed, "language", "hindi") or "hindi"
        queries = [
            f"trending {lang} songs 2024",
            f"top {lang} hits",
        ]
        subtasks = [self._safe_search(q, n=25) for q in queries]
        results = await asyncio.gather(*subtasks, return_exceptions=True)

        merged: List[Song] = []
        for r in results:
            if isinstance(r, list):
                merged.extend(r)
        return merged[: self.budget.discovery]

    async def _gen_exploration(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> List[Song]:
        lang = getattr(seed, "language", "hindi") or "hindi"
        queries = [
            f"indie {lang} acoustic hits",
            f"viral {lang} new releases",
        ]
        subtasks = [self._safe_search(q, n=15) for q in queries]
        results = await asyncio.gather(*subtasks, return_exceptions=True)

        merged: List[Song] = []
        for r in results:
            if isinstance(r, list):
                merged.extend(r)
        return merged[: self.budget.exploration]

    async def _resolve_video_id_for_seed(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> Optional[str]:
        # 1. From seed song
        if seed:
            if getattr(seed, "provider", None) == "youtube" and getattr(seed, "provider_id", None):
                return seed.provider_id
            sid = getattr(seed, "id", "") or ""
            if sid.startswith(("youtube:", "yt:")):
                return clean_track_id(sid)
            if sid and sid in self._seed_video_cache:
                return self._seed_video_cache[sid]

            # Try to resolve youtube videoId for non-youtube seed
            if getattr(seed, "title", None):
                art = ""
                if getattr(seed, "artists", None) and seed.artists:
                    first = seed.artists[0]
                    art = getattr(first, "name", "") if hasattr(first, "name") else str(first)
                elif getattr(seed, "subtitle", None):
                    art = seed.subtitle
                q = f"{seed.title} {art}".strip()
                try:
                    yt_provider = getattr(self.provider, "youtube", None)
                    if yt_provider and hasattr(yt_provider, "search"):
                        res = await yt_provider.search(q, n=1)
                        if res and res.songs:
                            vid = res.songs[0].provider_id
                            if vid:
                                self._seed_video_cache[sid] = vid
                                return vid
                except Exception as e:
                    logger.debug("Failed to resolve seed video ID from query %r: %s", q, e)

        # 2. From recent successful tracks in profile (avoiding recently used seeds)
        if profile:
            for tid in profile.recent_tracks:
                if tid not in self._used_seeds and tid.startswith(("youtube:", "yt:")):
                    self._used_seeds.add(tid)
                    return clean_track_id(tid)
            for tid, b in sorted(profile.recent_30d.track.items(), key=lambda x: x[1].positive, reverse=True):
                if b.positive > 0 and tid not in self._used_seeds and tid.startswith(("youtube:", "yt:")):
                    self._used_seeds.add(tid)
                    return clean_track_id(tid)

        return None

    async def _gen_ytm_radio(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> List[Song]:
        if not hasattr(self.provider, "get_radio_candidates"):
            return []
        try:
            vid = await self._resolve_video_id_for_seed(seed, profile)
            if not vid:
                return []
            return await self.provider.get_radio_candidates(vid, limit=self.budget.ytm_radio)
        except Exception as e:
            logger.debug("CandidateBuilder._gen_ytm_radio failed: %s", e)
            return []

    async def _gen_ytm_related(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> List[Song]:
        if not hasattr(self.provider, "get_related_candidates"):
            return []
        try:
            vid = await self._resolve_video_id_for_seed(seed, profile)
            if not vid:
                return []
            return await self.provider.get_related_candidates(vid, limit=self.budget.ytm_related)
        except Exception as e:
            logger.debug("CandidateBuilder._gen_ytm_related failed: %s", e)
            return []

    async def _gen_ytm_artist(
        self, seed: Optional[Song], profile: Optional[UserTasteProfile]
    ) -> List[Song]:
        if not hasattr(self.provider, "get_artist_candidates"):
            return []
        try:
            artist_target = ""
            if seed and hasattr(seed, "artists") and seed.artists:
                first = seed.artists[0]
                artist_target = getattr(first, "name", "") if hasattr(first, "name") else str(first)
            elif seed and getattr(seed, "subtitle", None):
                artist_target = seed.subtitle
            elif profile and profile.recent_30d.artist:
                sorted_artists = sorted(profile.recent_30d.artist.items(), key=lambda x: x[1].positive, reverse=True)
                for aid, b in sorted_artists:
                    if aid not in self._used_seeds and b.positive > 0:
                        self._used_seeds.add(aid)
                        artist_target = aid
                        break
            elif profile and profile.long_term.artist:
                sorted_artists = sorted(profile.long_term.artist.items(), key=lambda x: x[1].positive, reverse=True)
                for aid, b in sorted_artists:
                    if aid not in self._used_seeds and b.positive > 0:
                        self._used_seeds.add(aid)
                        artist_target = aid
                        break

            if not artist_target:
                return []
            return await self.provider.get_artist_candidates(artist_target, limit=self.budget.ytm_artist)
        except Exception as e:
            logger.debug("CandidateBuilder._gen_ytm_artist failed: %s", e)
            return []

