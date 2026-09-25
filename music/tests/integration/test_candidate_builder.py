from pathlib import Path
import sys

repo_root = Path(__file__).resolve().parents[3]
taste_engine_dir = repo_root / "sway_taste_engine"
if str(taste_engine_dir) not in sys.path:
    sys.path.insert(0, str(taste_engine_dir))

import pytest
from app.models import ArtistRef, Song, SearchResults, SearchItem, Album
from app.services.candidate_builder import CandidateBuilder, GeneratorBudget
from sway_taste_engine.storage import InMemoryStore
from sway_taste_engine.models import UserTasteProfile, Bucket


class MockProvider:
    provider_name = "mock_provider"

    async def get_artist_songs(self, artist_id: str, *, page: int = 0, n: int = 50) -> list[Song]:
        return [
            Song(
                id=f"atif_song_{i}",
                provider="jiosaavn",
                provider_id=f"atif_song_{i}",
                title=f"Atif Song {i}",
                artists=[ArtistRef(id="a_atif", provider="jiosaavn", provider_id="a_atif", name="Atif Aslam", role="singer")],
                language="hindi",
                duration_ms=250000,
            )
            for i in range(min(n, 45))
        ]

    async def get_album(self, album_id: str) -> Album:
        return Album(
            id=album_id,
            provider="jiosaavn",
            provider_id=album_id,
            title="Bajrangi Bhaijaan",
            artists="Pritam",
            year=2015,
            language="hindi",
            songs=[
                Song(
                    id=f"bb_track_{i}",
                    provider="jiosaavn",
                    provider_id=f"bb_track_{i}",
                    title=f"Bajrangi Track {i}",
                    artists=[ArtistRef(id="a_pritam", provider="jiosaavn", provider_id="a_pritam", name="Pritam", role="composer")],
                    album="Bajrangi Bhaijaan",
                    language="hindi",
                )
                for i in range(12)
            ],
        )

    async def search(
        self,
        query: str,
        *,
        n: int = 20,
        page: int = 1,
        enrich: bool = False,
    ) -> SearchResults:
        # Return synthetic SearchItem items based on query terms
        songs = []
        prefix = query.lower().replace(" ", "_").replace("(", "").replace(")", "")[:12]
        for i in range(n):
            songs.append(
                SearchItem(
                    id=f"{prefix}_{i}",
                    provider="jiosaavn",
                    provider_id=f"{prefix}_{i}",
                    type="song",
                    title=f"{query.title()} Track {i}",
                    subtitle=f"{query.title()} Artist",
                )
            )
        return SearchResults(query=query, songs=songs)


@pytest.fixture
def seed_song():
    return Song(
        id="tu_chahiye_123",
        provider="jiosaavn",
        provider_id="tu_chahiye_123",
        title="Tu Chahiye",
        artists=[
            ArtistRef(id="a_atif", provider="jiosaavn", provider_id="a_atif", name="Atif Aslam", role="singer"),
            ArtistRef(id="a_pritam", provider="jiosaavn", provider_id="a_pritam", name="Pritam", role="composer"),
        ],
        album="Bajrangi Bhaijaan",
        album_id="album_bb_123",
        year="2015",
        duration_ms=272000,
        language="hindi",
    )


@pytest.fixture
def user_profile():
    p = UserTasteProfile(user_id="user_test")
    p.recent_30d.genre["romantic"] = Bucket(positive=3.0)
    p.recent_30d.mood["romantic"] = Bucket(positive=2.5)
    return p


@pytest.mark.asyncio
async def test_candidate_builder_budgets_and_pool_size(seed_song, user_profile):
    provider = MockProvider()
    store = InMemoryStore()
    builder = CandidateBuilder(provider=provider, taste_store=store)

    candidates, attribution = await builder.build_candidates(
        seed_song=seed_song,
        profile=user_profile,
    )

    print("DEBUG ATTRIBUTION:", attribution)
    print("TOTAL CANDIDATES:", len(candidates))

    # 1. Total deduplicated pool size must meet the target budget (>= 150 items)
    assert len(candidates) >= 150

    # 2. Check no duplicates in candidate list
    candidate_ids = [c.id for c in candidates]
    assert len(candidate_ids) == len(set(candidate_ids))

    # 3. Check generator budgets were recorded in attribution
    expected_generators = {
        "same_artist",
        "similar_artists",
        "album_soundtrack",
        "taste_neighbors",
        "collaborative",
        "discovery",
        "exploration",
    }
    assert expected_generators.issubset(set(attribution.keys()))

    # 4. Check each generator respected its quota
    assert attribution["same_artist"] <= 40
    assert attribution["similar_artists"] <= 50
    assert attribution["album_soundtrack"] <= 30
    assert attribution["taste_neighbors"] <= 50
    assert attribution["collaborative"] <= 50
    assert attribution["discovery"] <= 50
    assert attribution["exploration"] <= 30

    # 5. Check discovered tracks were saved to store
    for c in candidates[:10]:
        stored = store.get_track(c.id)
        assert stored is not None
        assert stored.id == c.id
