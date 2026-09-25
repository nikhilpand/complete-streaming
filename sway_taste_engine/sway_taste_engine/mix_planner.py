from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional
from .models import Track, UserTasteProfile
from .storage import TasteStore


@dataclass
class HomeShelf:
    id: str
    type: str
    title: str
    subtitle: str
    badge: str
    items: List[Track]


class MixPlanner:
    """Plans multi-shelf Home feeds with distinct musical compositions."""

    def __init__(self, store: Optional[TasteStore] = None):
        self.store = store

    def plan_home_feed(
        self,
        profile: UserTasteProfile,
        catalog: List[Track],
        limit_per_shelf: int = 10,
    ) -> List[HomeShelf]:
        if not catalog:
            return []

        shelves: List[HomeShelf] = []
        track_map = {t.id: t for t in catalog}
        recent_set = set(profile.recent_tracks)

        # 1. Quick Mix (40% favorites, 25% similar artists, 20% taste, 15% discovery)
        fav_candidates = [
            t
            for t in catalog
            if t.artist_id in profile.artist and profile.artist[t.artist_id].net > 0
        ]
        fav_candidates.sort(
            key=lambda t: (
                profile.artist.get(t.artist_id).net
                if t.artist_id in profile.artist
                else 0
            ),
            reverse=True,
        )
        if not fav_candidates:
            fav_candidates = sorted(catalog, key=lambda t: t.popularity, reverse=True)

        quick_mix_items = fav_candidates[:limit_per_shelf]
        shelves.append(
            HomeShelf(
                id="shelf_quick_mix",
                type="quick_mix",
                title="Quick Mix",
                subtitle="Your personal soundtrack",
                badge="Mixed for you",
                items=quick_mix_items,
            )
        )

        # 2. Because You Listened To {Track}
        ref_track = None
        if profile.recent_tracks:
            for r_id in profile.recent_tracks:
                if r_id in track_map:
                    ref_track = track_map[r_id]
                    break
        if not ref_track and catalog:
            ref_track = catalog[0]

        similar_items: List[Track] = []
        if ref_track and self.store:
            edges = self.store.get_top_k_similar_tracks(ref_track.id, k=limit_per_shelf)
            for to_id, _ in edges:
                if to_id in track_map and to_id != ref_track.id:
                    similar_items.append(track_map[to_id])

        if not similar_items and ref_track:
            similar_items = [
                t
                for t in catalog
                if t.id != ref_track.id
                and (
                    t.artist_id == ref_track.artist_id
                    or bool(set(t.genres) & set(ref_track.genres))
                )
            ][:limit_per_shelf]
        if not similar_items:
            similar_items = [t for t in catalog if t.id != ref_track.id][:limit_per_shelf]

        shelves.append(
            HomeShelf(
                id="shelf_similarity",
                type="similarity",
                title=(
                    f"Because you listened to {ref_track.title}"
                    if ref_track
                    else "Recommended for you"
                ),
                subtitle=(
                    f"Similar to {ref_track.artist_name}"
                    if ref_track
                    else "Based on your taste"
                ),
                badge="Similar sound",
                items=similar_items or catalog[:limit_per_shelf],
            )
        )

        # 3. Artist Radar
        top_artist_name = "Trending Artists"
        top_artist_id = None
        if profile.artist:
            sorted_artists = sorted(
                profile.artist.items(), key=lambda x: x[1].net, reverse=True
            )
            if sorted_artists and sorted_artists[0][1].net > 0:
                top_artist_id = sorted_artists[0][0]
        if not top_artist_id and catalog:
            top_artist_id = catalog[0].artist_id

        artist_tracks = [t for t in catalog if t.artist_id == top_artist_id]
        if artist_tracks:
            top_artist_name = artist_tracks[0].artist_name or "Featured Artist"

        radar_items = artist_tracks[:limit_per_shelf]
        if len(radar_items) < limit_per_shelf:
            other_tracks = [t for t in catalog if t.artist_id != top_artist_id]
            radar_items.extend(other_tracks[: limit_per_shelf - len(radar_items)])

        shelves.append(
            HomeShelf(
                id="shelf_artist_radar",
                type="artist_radar",
                title=f"Artist Spotlight: {top_artist_name}",
                subtitle="Hits and related songs",
                badge="Artist radar",
                items=radar_items,
            )
        )

        # 4. Rediscover
        rediscover_items = [
            t
            for t in catalog
            if t.id not in recent_set and t.artist_id in profile.artist
        ][:limit_per_shelf]
        if not rediscover_items:
            rediscover_items = sorted(catalog, key=lambda t: t.year or 2010)[
                :limit_per_shelf
            ]

        shelves.append(
            HomeShelf(
                id="shelf_rediscover",
                type="rediscover",
                title="Rediscover",
                subtitle="Songs you used to play on repeat",
                badge="Forgotten favorites",
                items=rediscover_items,
            )
        )

        # 5. Discover Mix
        discovery_items = [
            t
            for t in catalog
            if t.id not in recent_set and t.artist_id not in profile.artist
        ][:limit_per_shelf]
        if not discovery_items:
            discovery_items = sorted(catalog, key=lambda t: t.popularity)[
                :limit_per_shelf
            ]

        shelves.append(
            HomeShelf(
                id="shelf_discovery",
                type="discovery",
                title="Discover Mix",
                subtitle="Fresh finds tailored to your taste",
                badge="New sounds",
                items=discovery_items,
            )
        )

        return shelves
