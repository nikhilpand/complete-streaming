from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set
from .models import PersonalizationState, Track, UserTasteProfile
from .storage import TasteStore

# Contemporary Indian artist clusters for natural expansion
CONTEMPORARY_ARTISTS: dict[str, list[str]] = {
    "atif aslam": ["Arijit Singh", "Mohit Chauhan", "KK", "Mustafa Zahid", "Armaan Malik"],
    "arijit singh": ["Atif Aslam", "Mohit Chauhan", "Jubin Nautiyal", "Papon", "Armaan Malik"],
    "pritam": ["Vishal-Shekhar", "Sachin-Jigar", "Shankar-Ehsaan-Loy", "Mithoon", "A.R. Rahman"],
    "a.r. rahman": ["Pritam", "Amit Trivedi", "Shankar-Ehsaan-Loy", "Ajay-Atul", "Harris Jayaraj"],
    "shreya ghoshal": ["Sunidhi Chauhan", "Neeti Mohan", "Monali Thakur", "Shalmali Kholgade"],
    "diljit dosanjh": ["Karan Aujla", "AP Dhillon", "Sidhu Moose Wala", "Guru Randhawa", "Amrinder Gill"],
    "kk": ["Mohit Chauhan", "Atif Aslam", "Shaan", "Lucky Ali", "Papon"],
}


@dataclass
class HomeShelf:
    id: str
    type: str
    title: str
    subtitle: Optional[str] = None
    badge: Optional[str] = None
    reason: Optional[str] = None
    items: List[Track] = field(default_factory=list)


class MixPlanner:
    """Plans multi-shelf Home feeds that progressively evolve with user behavior."""

    def __init__(self, store: Optional[TasteStore] = None):
        self.store = store

    def _pick_tracks(
        self,
        candidates: List[Track],
        limit: int = 10,
        max_per_artist: int = 3,
        exclude_ids: Optional[Set[str]] = None,
    ) -> List[Track]:
        """Deduplicate candidates, respect artist diversity caps, and exclude used tracks."""
        result: List[Track] = []
        artist_counts: Counter[str] = Counter()
        seen_ids: Set[str] = set(exclude_ids) if exclude_ids is not None else set()

        for t in candidates:
            if t.id in seen_ids:
                continue
            aid = t.artist_id or (t.artist_name.lower().strip() if t.artist_name else "unknown")
            if artist_counts[aid] >= max_per_artist:
                continue
            result.append(t)
            seen_ids.add(t.id)
            artist_counts[aid] += 1
            if len(result) >= limit:
                break

        return result

    def plan_home_feed(
        self,
        profile: UserTasteProfile,
        catalog: List[Track],
        limit_per_shelf: int = 10,
    ) -> List[HomeShelf]:
        if not catalog:
            return []

        # Filter unplayable, mock/fixture, and explicitly negative tracks
        playable_catalog = [
            t
            for t in catalog
            if t.playable
            and not (t.title and "sample track" in t.title.lower())
            and not (t.artist_name and "artist 0" in t.artist_name.lower())
            and not (t.id and t.id.startswith("track_seed_"))
            and t.id not in profile.explicit_negative_tracks
            and t.artist_id not in profile.explicit_negative_artists
            and t.id not in profile.negative_memory.high_confidence_skips
        ]
        if not playable_catalog:
            return []

        track_map = {t.id: t for t in playable_catalog}
        state = profile.personalization_state
        shelves: List[HomeShelf] = []
        used_ids: Set[str] = set()

        if state == PersonalizationState.COLD:
            # ── COLD START: Discovery-first, high variety, zero fake data ──

            # 1. Trending Now
            trending_candidates = sorted(playable_catalog, key=lambda t: t.popularity, reverse=True)
            trending_items = self._pick_tracks(trending_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
            if trending_items:
                used_ids.update(t.id for t in trending_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_trending",
                        type="trending",
                        title="Trending Now",
                        subtitle="Top hits right now across SWAY",
                        badge="Trending",
                        reason="trending",
                        items=trending_items,
                    )
                )

            # 2. Popular in India / Regional Hits
            regional_langs = {"hindi", "punjabi", "urdu", "bhojpuri", "marathi", "tamil", "telugu"}
            regional_genres = {"bollywood", "desi", "filmi", "pop"}
            regional_candidates = [
                t for t in playable_catalog
                if (t.language and t.language.lower() in regional_langs)
                or any(g.lower() in regional_genres for g in t.genres)
            ]
            regional_candidates.sort(key=lambda t: t.popularity, reverse=True)
            if not regional_candidates:
                regional_candidates = trending_candidates
            regional_items = self._pick_tracks(regional_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
            if regional_items:
                used_ids.update(t.id for t in regional_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_popular_india",
                        type="popular_regional",
                        title="Popular in India",
                        subtitle="Most played Hindi & regional hits",
                        badge="Popular",
                        reason="popular",
                        items=regional_items,
                    )
                )

            # 3. New Releases
            new_candidates = sorted(
                playable_catalog,
                key=lambda t: (t.release_ts or 0.0, t.year or 0, t.popularity),
                reverse=True,
            )
            new_items = self._pick_tracks(new_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
            if new_items:
                used_ids.update(t.id for t in new_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_new_releases",
                        type="new_releases",
                        title="New Releases",
                        subtitle="Fresh songs just landed",
                        badge="New",
                        reason="new_releases",
                        items=new_items,
                    )
                )

            # 4. Discover Something New
            discover_candidates = sorted(
                playable_catalog,
                key=lambda t: (1.0 - abs(t.popularity - 0.5)),
                reverse=True,
            )
            discover_items = self._pick_tracks(discover_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
            if discover_items:
                used_ids.update(t.id for t in discover_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_discovery",
                        type="discovery",
                        title="Discover Something New",
                        subtitle="Eclectic gems to jumpstart your taste",
                        badge="Discovery",
                        reason="exploration",
                        items=discover_items,
                    )
                )

            # 5. Chill & Melodic Picks
            chill_candidates = [
                t for t in playable_catalog
                if (t.energy is not None and t.energy < 0.65)
                or any(m.lower() in {"chill", "romantic", "acoustic", "melancholy"} for m in t.moods)
                or any(g.lower() in {"acoustic", "indie", "ambient", "sufi"} for g in t.genres)
            ]
            chill_candidates.sort(key=lambda t: t.popularity, reverse=True)
            if not chill_candidates:
                chill_candidates = playable_catalog
            chill_items = self._pick_tracks(chill_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
            if chill_items:
                used_ids.update(t.id for t in chill_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_chill_picks",
                        type="curated",
                        title="Chill & Melodic",
                        subtitle="Atmospheric and acoustic favorites",
                        badge="Curated",
                        reason="curated",
                        items=chill_items,
                    )
                )

        else:
            # ── SEEDED / LEARNING / PERSONALIZED: Progressively personalized ──

            # Resolve reference track and top artist
            ref_track: Optional[Track] = None
            if profile.recent_tracks:
                for r_id in profile.recent_tracks:
                    if r_id in track_map:
                        ref_track = track_map[r_id]
                        break
            if not ref_track and playable_catalog:
                # Top track with positive affinity
                for tid, b in sorted(profile.recent_30d.track.items(), key=lambda x: x[1].positive, reverse=True):
                    if tid in track_map and b.positive > 0:
                        ref_track = track_map[tid]
                        break

            top_artist_name = "Your Artists"
            top_artist_id = None
            if profile.artist:
                sorted_artists = sorted(profile.artist.items(), key=lambda x: x[1].net, reverse=True)
                if sorted_artists and sorted_artists[0][1].net > 0:
                    top_artist_id = sorted_artists[0][0]
                    # Find artist name
                    for t in playable_catalog:
                        if t.artist_id == top_artist_id or (t.artist_name and t.artist_name.lower() == top_artist_id.lower()):
                            top_artist_name = t.artist_name
                            break

            # 1. Made for You (Personalized Quick Mix)
            quick_candidates: List[Track] = []
            # Favorite artist tracks
            fav_artist_tracks = [
                t for t in playable_catalog
                if t.artist_id in profile.artist and profile.artist[t.artist_id].net > 0
            ]
            fav_artist_tracks.sort(
                key=lambda t: profile.artist[t.artist_id].net if t.artist_id in profile.artist else 0,
                reverse=True,
            )
            quick_candidates.extend(fav_artist_tracks)

            # Contemporaries of listened artists
            listened_artist_names = [
                t.artist_name.lower().strip() for t in fav_artist_tracks if t.artist_name
            ]
            contemporary_names: Set[str] = set()
            for aname in listened_artist_names[:3]:
                for c in CONTEMPORARY_ARTISTS.get(aname, []):
                    contemporary_names.add(c.lower())

            if contemporary_names:
                contemp_tracks = [
                    t for t in playable_catalog
                    if t.artist_name and t.artist_name.lower().strip() in contemporary_names
                ]
                contemp_tracks.sort(key=lambda t: t.popularity, reverse=True)
                quick_candidates.extend(contemp_tracks)

            # Augment with trending
            trending_candidates = sorted(playable_catalog, key=lambda t: t.popularity, reverse=True)
            quick_candidates.extend(trending_candidates)

            quick_badge = "Early Mix" if state == PersonalizationState.SEEDED else "Mixed for you"
            quick_subtitle = (
                "Your taste is starting to take shape"
                if state == PersonalizationState.SEEDED
                else "Tailored to your recent listening"
                if state == PersonalizationState.LEARNING
                else "Your daily personal soundtrack"
            )

            quick_items = self._pick_tracks(quick_candidates, limit=limit_per_shelf, max_per_artist=3, exclude_ids=used_ids)
            if quick_items:
                used_ids.update(t.id for t in quick_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_quick_mix",
                        type="quick_mix",
                        title="Made for You",
                        subtitle=quick_subtitle,
                        badge=quick_badge,
                        reason="mix",
                        items=quick_items,
                    )
                )

            # 2. Because you listened to {RefTrack}
            if ref_track:
                similar_candidates: List[Track] = []
                if self.store is not None:
                    edges = self.store.get_top_k_similar_tracks(ref_track.id, k=limit_per_shelf * 2)
                    for to_id, _ in edges:
                        if to_id in track_map and to_id != ref_track.id:
                            similar_candidates.append(track_map[to_id])

                # Augment with genre/mood/artist contemporaries
                genre_matches = [
                    t for t in playable_catalog
                    if t.id != ref_track.id
                    and (
                        t.artist_id == ref_track.artist_id
                        or bool(set(t.genres) & set(ref_track.genres))
                        or bool(set(t.moods) & set(ref_track.moods))
                    )
                ]
                genre_matches.sort(key=lambda t: t.popularity, reverse=True)
                similar_candidates.extend(genre_matches)

                sim_items = self._pick_tracks(similar_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
                if len(sim_items) < limit_per_shelf:
                    fallback_sim = [
                        t for t in playable_catalog
                        if t.id != ref_track.id and t.id not in used_ids
                    ]
                    more = self._pick_tracks(fallback_sim, limit=limit_per_shelf - len(sim_items), max_per_artist=2, exclude_ids=used_ids)
                    sim_items.extend(more)

                if sim_items:
                    used_ids.update(t.id for t in sim_items)
                    shelves.append(
                        HomeShelf(
                            id="shelf_similarity",
                            type="similarity",
                            title=f"Because you listened to {ref_track.title}",
                            subtitle=f"Similar sound to {ref_track.artist_name}",
                            badge="Similar sound",
                            reason="recent_track",
                            items=sim_items,
                        )
                    )

            # 3. More from {TopArtist} (Artist Radar)
            if top_artist_id or (fav_artist_tracks and fav_artist_tracks[0].artist_name):
                radar_candidates: List[Track] = []
                # Direct artist tracks
                if top_artist_id:
                    artist_tracks = [t for t in playable_catalog if t.artist_id == top_artist_id]
                    radar_candidates.extend(artist_tracks)

                # Related artists
                top_lower = top_artist_name.lower().strip()
                rel_names = {c.lower() for c in CONTEMPORARY_ARTISTS.get(top_lower, [])}
                if rel_names:
                    rel_tracks = [t for t in playable_catalog if t.artist_name and t.artist_name.lower().strip() in rel_names]
                    rel_tracks.sort(key=lambda t: t.popularity, reverse=True)
                    radar_candidates.extend(rel_tracks)

                radar_items = self._pick_tracks(radar_candidates, limit=limit_per_shelf, max_per_artist=4, exclude_ids=used_ids)
                if len(radar_items) < limit_per_shelf:
                    fallback_radar = [
                        t for t in playable_catalog
                        if t.id not in used_ids
                    ]
                    more_radar = self._pick_tracks(fallback_radar, limit=limit_per_shelf - len(radar_items), max_per_artist=3, exclude_ids=used_ids)
                    radar_items.extend(more_radar)

                if radar_items:
                    used_ids.update(t.id for t in radar_items)
                    shelves.append(
                        HomeShelf(
                            id="shelf_artist_radar",
                            type="artist_radar",
                            title=f"More from {top_artist_name}",
                            subtitle="Hits and related songs",
                            badge="Artist radar",
                            reason="artist_affinity",
                            items=radar_items,
                        )
                    )

            # 4. Recently Played (For LEARNING and PERSONALIZED)
            if state in {PersonalizationState.LEARNING, PersonalizationState.PERSONALIZED} and profile.recent_tracks:
                recent_items: List[Track] = []
                seen_recent_ids: Set[str] = set()
                for tid in profile.recent_tracks:
                    if tid in track_map and tid not in seen_recent_ids:
                        recent_items.append(track_map[tid])
                        seen_recent_ids.add(tid)
                    if len(recent_items) >= limit_per_shelf:
                        break

                if recent_items:
                    shelves.append(
                        HomeShelf(
                            id="shelf_recently_played",
                            type="recently_played",
                            title="Recently Played",
                            subtitle="Pick up where you left off",
                            badge="Recent",
                            reason="history",
                            items=recent_items,
                        )
                    )

            # 5. Rediscover (For PERSONALIZED)
            if state == PersonalizationState.PERSONALIZED:
                recent_set = set(profile.recent_tracks[:15])
                rediscover_candidates = [
                    t for t in playable_catalog
                    if t.id not in recent_set
                    and t.artist_id in profile.artist
                    and profile.artist[t.artist_id].positive > 0
                ]
                rediscover_items = self._pick_tracks(rediscover_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
                if rediscover_items:
                    used_ids.update(t.id for t in rediscover_items)
                    shelves.append(
                        HomeShelf(
                            id="shelf_rediscover",
                            type="rediscover",
                            title="Rediscover",
                            subtitle="Past favorites you haven't played in a while",
                            badge="Forgotten favorites",
                            reason="rediscover",
                            items=rediscover_items,
                        )
                    )

            # 6. Trending (Always included for grounding)
            trending_candidates = sorted(playable_catalog, key=lambda t: t.popularity, reverse=True)
            trending_items = self._pick_tracks(trending_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
            if trending_items:
                used_ids.update(t.id for t in trending_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_trending",
                        type="trending",
                        title="Trending Now",
                        subtitle="Popular music across SWAY",
                        badge="Trending",
                        reason="trending",
                        items=trending_items,
                    )
                )

            # 7. Controlled Exploration / Discover Something New (Preserve discovery!)
            fav_artists = {aid for aid, b in profile.artist.items() if b.net > 0}
            fav_genres = {gid for gid, b in profile.genre.items() if b.net > 0}

            discover_candidates = [
                t for t in playable_catalog
                if t.artist_id not in fav_artists
            ]
            discover_candidates.sort(key=lambda t: t.popularity, reverse=True)
            if not discover_candidates:
                discover_candidates = playable_catalog

            discover_items = self._pick_tracks(discover_candidates, limit=limit_per_shelf, max_per_artist=2, exclude_ids=used_ids)
            if discover_items:
                used_ids.update(t.id for t in discover_items)
                shelves.append(
                    HomeShelf(
                        id="shelf_discovery",
                        type="discovery",
                        title="Discover Something New" if state != PersonalizationState.PERSONALIZED else "Discover Something Different",
                        subtitle="Controlled exploration beyond your usual rotation",
                        badge="Discovery",
                        reason="exploration",
                        items=discover_items,
                    )
                )

        return shelves
