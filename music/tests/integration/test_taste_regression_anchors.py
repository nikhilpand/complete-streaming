from __future__ import annotations

import pytest
from app.models import ArtistRef, SearchItem, SearchResults, Song
from app.services.candidate_builder import CandidateBuilder
from sway_taste_engine.config import QueueWeights
from sway_taste_engine.metadata import extract_track_features
from sway_taste_engine.models import Track, UserTasteProfile
from sway_taste_engine.queue_planner import QueuePlanner
from sway_taste_engine.storage import InMemoryStore


class MockProviderForAnchor:
    def __init__(self):
        self.search_calls: list[str] = []

    async def search(self, query: str, n: int = 20, page: int = 1) -> SearchResults:
        self.search_calls.append(query)
        q_lower = query.lower()

        # Generate realistic contextual songs matching the query
        clean_q = query.replace(" ", "_").replace("-", "_")
        count = max(n, 25)
        songs = []
        for i in range(count):
            songs.append(
                SearchItem(
                    id=f"song_{clean_q}_{i}",
                    provider="saavn",
                    provider_id=f"prov_{clean_q}_{i}",
                    type="song",
                    title=f"Track {query} {i}",
                    subtitle=f"{query} Artist {i}",
                )
            )
        return SearchResults(
            query=query,
            songs=songs,
            albums=[],
            artists=[],
            playlists=[],
            total_songs=len(songs),
            total_albums=0,
            total_artists=0,
            total_playlists=0,
        )

    async def get_song(self, song_id: str) -> Song:
        return Song(
            id=song_id,
            provider="saavn",
            provider_id=f"p_{song_id}",
            title=f"Title for {song_id}",
            artists=[
                ArtistRef(
                    id="a_atif",
                    name="Atif Aslam",
                    role="singer",
                    provider="saavn",
                    provider_id="p_atif",
                )
            ],
            language="hindi",
            year="2015",
            album="Bajrangi Bhaijaan",
            duration_ms=240000,
            has_media=True,
        )


@pytest.mark.asyncio
async def test_tu_chahiye_anchor_candidate_pool_scale_and_quality():
    """
    Deterministic regression anchor for 'Tu Chahiye' (Atif Aslam / Pritam, 2015):
    - Candidate pool must produce >= 150 deduplicated tracks across 7 budgeted generators.
    - Zero hardcoded keyword strings.
    - Captures same artist, composer/soundtrack, and contemporary taste neighbors.
    """
    tu_chahiye = Song(
        id="tu_chahiye",
        provider="saavn",
        provider_id="p_tu_chahiye",
        title="Tu Chahiye",
        artists=[
            ArtistRef(
                id="a_atif",
                name="Atif Aslam",
                role="singer",
                provider="saavn",
                provider_id="p_atif",
            ),
            ArtistRef(
                id="a_pritam",
                name="Pritam",
                role="composer",
                provider="saavn",
                provider_id="p_pritam",
            ),
        ],
        album="Bajrangi Bhaijaan",
        language="hindi",
        year="2015",
        duration_ms=272000,
        has_media=True,
    )

    provider = MockProviderForAnchor()
    store = InMemoryStore()
    builder = CandidateBuilder(provider, taste_store=store)

    candidates, generator_counts = await builder.build_candidates(tu_chahiye)

    # 1. Scale guarantee: at least 150 deduplicated candidates
    assert len(candidates) >= 150, f"Expected >= 150 candidates, got {len(candidates)}"

    # 2. Generator diversity check: provider was queried across multiple axes
    queries_run = provider.search_calls
    assert len(queries_run) >= 7

    # At least one query for artist
    assert any("atif aslam" in q.lower() for q in queries_run)
    # At least one query for soundtrack / album
    assert any("bajrangi bhaijaan" in q.lower() for q in queries_run)
    # At least one query for composer
    assert any("pritam" in q.lower() for q in queries_run)

    # 3. Discovered tracks are auto-persisted into taste store
    persisted_tracks = store.all_tracks()
    assert len(persisted_tracks) >= 150


def test_transition_continuity_anchor_smooth_energy_gradient():
    """
    Deterministic regression anchor for queue continuity:
    A mellow acoustic ballad must transition into compatible ballads
    and prevent abrupt EDM/club banger tempo spikes.
    """
    tu_chahiye_track = Track(
        id="tu_chahiye",
        title="Tu Chahiye",
        artist_id="a_atif",
        artist_name="Atif Aslam",
        moods=["romantic", "mellow"],
        genres=["bollywood", "acoustic"],
        energy=0.35,
        popularity=0.8,
    )

    compatible_ballad = Track(
        id="jeena_jeena",
        title="Jeena Jeena",
        artist_id="a_atif",
        artist_name="Atif Aslam",
        moods=["romantic", "mellow"],
        genres=["bollywood", "acoustic"],
        energy=0.38,
        popularity=0.75,
    )

    contemporary_ballad = Track(
        id="gerua",
        title="Gerua",
        artist_id="a_arijit",
        artist_name="Arijit Singh",
        moods=["romantic"],
        genres=["bollywood"],
        energy=0.45,
        popularity=0.85,
    )

    edm_cliff = Track(
        id="edm_banger",
        title="Ultra Club Bass Drop",
        artist_id="a_dj",
        artist_name="DJ Techno",
        moods=["party", "energetic"],
        genres=["edm", "dance"],
        energy=0.98,
        popularity=0.9,
    )

    planner = QueuePlanner()
    profile = UserTasteProfile(user_id="user_reg")

    ordered = planner.plan_next(
        current_track=tu_chahiye_track,
        candidates=[edm_cliff, contemporary_ballad, compatible_ballad],
        profile=profile,
        count=3,
    )

    # Top tracks must maintain energy smoothness (|diff| <= 0.20)
    top_track = ordered[0]
    second_track = ordered[1]
    assert top_track.id in {"jeena_jeena", "gerua"}
    assert second_track.id in {"jeena_jeena", "gerua"}

    top_energy_diff = abs(top_track.energy - tu_chahiye_track.energy)
    assert top_energy_diff <= 0.15, f"Energy jump too high: {top_energy_diff}"

    # EDM cliff track must rank last
    assert ordered[-1].id == "edm_banger"
