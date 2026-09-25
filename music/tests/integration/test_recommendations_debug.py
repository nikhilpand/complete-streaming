from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.models import ArtistRef, Song


@pytest.fixture
def client():
    return TestClient(app)


def test_recommendations_debug_endpoint_returns_complete_attribution(client):
    res = client.get("/api/v1/recommendations/debug?user_id=debug_user_1&feed=for_you&limit=5")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    data = body["data"]

    # Verify attribution metadata
    assert data["user_id"] == "debug_user_1"
    assert data["feed"] == "for_you"
    assert "algorithm_version" in data
    assert "candidate_counts_by_generator" in data
    assert isinstance(data["candidate_counts_by_generator"], dict)
    assert "pruned_tracks" in data
    assert isinstance(data["pruned_tracks"], list)
    assert "items" in data


def test_recommendations_debug_with_seeded_tracks_has_score_breakdowns(client):
    from app.routers.recommendations import get_taste_engine
    from sway_taste_engine.models import Track

    eng = get_taste_engine()
    t1 = Track(
        id="debug_tr_1",
        title="Debug Song 1",
        artist_id="art_debug_1",
        artist_name="Debug Artist 1",
        album_name="Debug Album",
        genres=["pop", "romantic"],
        moods=["chill"],
        popularity=0.8,
        energy=0.5,
    )
    t2 = Track(
        id="debug_tr_2",
        title="Debug Song 2",
        artist_id="art_debug_2",
        artist_name="Debug Artist 2",
        album_name="Debug Album 2",
        genres=["rock"],
        moods=["energetic"],
        popularity=0.7,
        energy=0.8,
    )
    eng.seed_catalog([t1, t2])

    res = client.get("/api/v1/recommendations/debug?user_id=debug_user_2&feed=for_you&limit=5")
    assert res.status_code == 200
    data = res.json()["data"]
    assert len(data["items"]) >= 1

    first = data["items"][0]
    assert "score" in first
    assert "attribution" in first
    attr = first["attribution"]
    assert "total" in attr
    assert "components" in attr
    comp = attr["components"]
    for key in ["taste", "session", "similarity", "novelty", "freshness", "popularity", "energy_fit"]:
        assert key in comp


def test_recommendations_debug_reports_pruned_negative_tracks(client):
    from app.routers.recommendations import get_taste_engine

    eng = get_taste_engine()
    prof = eng.store.get_profile("debug_user_neg")
    prof.explicit_negative_tracks.add("blocked_tr_99")
    prof.negative_memory.high_confidence_skips.add("skipped_tr_88")
    eng.store.save_profile(prof)

    res = client.get("/api/v1/recommendations/debug?user_id=debug_user_neg&feed=for_you&limit=5")
    assert res.status_code == 200
    data = res.json()["data"]

    pruned = data["pruned_tracks"]
    reasons = {p["track_id"]: p["reason"] for p in pruned}
    assert "blocked_tr_99" in reasons
    assert reasons["blocked_tr_99"] == "explicit_negative"
    assert "skipped_tr_88" in reasons
    assert reasons["skipped_tr_88"] == "high_confidence_skip"


def test_recommendations_debug_shadow_mode_comparison(client):
    res = client.get("/api/v1/recommendations/debug?user_id=debug_user_shadow&feed=for_you&limit=5&shadow=true")
    assert res.status_code == 200
    data = res.json()["data"]
    assert "shadow_comparison" in data
    shadow = data["shadow_comparison"]
    for key in ["primary_count", "shadow_count", "overlap_count", "jaccard_divergence", "primary_mean_score", "shadow_mean_score", "top_1_match"]:
        assert key in shadow


def test_shadow_mode_comparator_math():
    from app.routers.recommendations import ShadowModeComparator

    primary = [
        {"id": "t1", "score": 0.9},
        {"id": "t2", "score": 0.8},
        {"id": "t3", "score": 0.7},
    ]
    shadow = [
        {"id": "t1", "score": 0.85},
        {"id": "t2", "score": 0.75},
        {"id": "t4", "score": 0.65},
    ]

    result = ShadowModeComparator.compare(primary, shadow)
    assert result["primary_count"] == 3
    assert result["shadow_count"] == 3
    assert result["overlap_count"] == 2  # t1, t2
    # union is 4 (t1, t2, t3, t4), overlap is 2 -> jaccard = 2/4 = 0.5 -> divergence = 0.5
    assert result["jaccard_divergence"] == 0.5
    assert result["top_1_match"] is True
    assert result["primary_mean_score"] == 0.8
    assert result["shadow_mean_score"] == 0.75
