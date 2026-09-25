from __future__ import annotations

import pytest
from sway_taste_engine.models import ArtistRole, FeatureValue, Track
from sway_taste_engine.retrieval import Candidate, RetrieverRegistry, SimilarTrackRetriever
from sway_taste_engine.similarity import SimilarityEngine
from sway_taste_engine.storage import InMemoryStore


@pytest.fixture
def sample_tracks():
    t_tu_chahiye = Track(
        id="tu_chahiye",
        title="Tu Chahiye",
        artists=[
            ArtistRole(id="a_atif", name="Atif Aslam", role="singer"),
            ArtistRole(id="a_pritam", name="Pritam", role="composer"),
        ],
        album="Bajrangi Bhaijaan",
        year=2015,
        language="hindi",
        genres=["bollywood", "romantic"],
        moods=["romantic", "melancholy"],
        energy=0.45,
    )
    t_jeena_jeena = Track(
        id="jeena_jeena",
        title="Jeena Jeena",
        artists=[
            ArtistRole(id="a_atif", name="Atif Aslam", role="singer"),
            ArtistRole(id="a_sachin", name="Sachin-Jigar", role="composer"),
        ],
        album="Badlapur",
        year=2015,
        language="hindi",
        genres=["bollywood", "romantic"],
        moods=["romantic", "melancholy"],
        energy=0.48,
    )
    t_gerua = Track(
        id="gerua",
        title="Gerua",
        artists=[
            ArtistRole(id="a_arijit", name="Arijit Singh", role="singer"),
            ArtistRole(id="a_pritam", name="Pritam", role="composer"),
        ],
        album="Dilwale",
        year=2015,
        language="hindi",
        genres=["bollywood", "romantic"],
        moods=["romantic"],
        energy=0.52,
    )
    t_edm_club = Track(
        id="edm_banger",
        title="EDM Rave Banger",
        artists=[ArtistRole(id="a_dj", name="DJ Electro", role="producer")],
        album="Club Hits 2023",
        year=2023,
        language="english",
        genres=["edm", "dance"],
        moods=["energetic", "party"],
        energy=0.95,
    )
    return {
        "tu_chahiye": t_tu_chahiye,
        "jeena_jeena": t_jeena_jeena,
        "gerua": t_gerua,
        "edm_club": t_edm_club,
    }


def test_similarity_scoring_high_for_contemporaries(sample_tracks):
    engine = SimilarityEngine()
    t1 = sample_tracks["tu_chahiye"]
    t2 = sample_tracks["jeena_jeena"]
    t3 = sample_tracks["gerua"]
    t_edm = sample_tracks["edm_club"]

    # 1. Tu Chahiye vs Jeena Jeena: same singer (Atif Aslam), same year (2015), same genre/mood/language
    sim_atif = engine.compute_track_similarity(t1, t2)
    assert sim_atif >= 0.75

    # 2. Tu Chahiye vs Gerua: shared composer (Pritam), same year (2015), same genre/mood/language
    sim_pritam = engine.compute_track_similarity(t1, t3)
    assert sim_pritam >= 0.60

    # 3. Tu Chahiye vs EDM club track: different artist, language, year, genre, energy
    sim_edm = engine.compute_track_similarity(t1, t_edm)
    assert sim_edm < 0.25


def test_precomputed_similarity_edges_in_store(sample_tracks):
    engine = SimilarityEngine()
    store = InMemoryStore()
    tracks = list(sample_tracks.values())

    # Build and cache top-K edges in store
    engine.compute_and_store_graph(tracks, store, top_k=2)

    # O(1) indexed lookup for Tu Chahiye
    edges = store.get_top_k_similar_tracks("tu_chahiye", k=2)
    assert len(edges) == 2

    # Top similarity neighbor must be Jeena Jeena (Atif Aslam) or Gerua (Pritam)
    top_neighbor_id, top_score = edges[0]
    assert top_neighbor_id in {"jeena_jeena", "gerua"}
    assert top_score >= 0.60


def test_retriever_uses_precomputed_store_edges(sample_tracks):
    engine = SimilarityEngine()
    store = InMemoryStore()
    tracks = list(sample_tracks.values())
    engine.compute_and_store_graph(tracks, store, top_k=5)

    # SimilarTrackRetriever initialized with store
    retriever = SimilarTrackRetriever(store=store)

    from sway_taste_engine.models import RecommendationContext, UserTasteProfile
    ctx = RecommendationContext(current_track_id="tu_chahiye")
    profile = UserTasteProfile(user_id="user_1")

    candidates = retriever.retrieve(tracks, profile, ctx, limit=5)

    # Must retrieve neighbors without an empty mapping
    assert len(candidates) >= 2
    candidate_ids = [c.track.id for c in candidates]
    assert "jeena_jeena" in candidate_ids
    assert "gerua" in candidate_ids
    assert "edm_banger" not in candidate_ids
