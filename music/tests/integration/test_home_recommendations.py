"""
Comprehensive integration tests for SWAY Home & Recommendations API.
Validates:
- /api/v1/home and /api/v1/recommendations/home endpoints
- Canonical Song contracts and shelf structure
- Telemetry event ingestion across all milestones & sources
- Search intent signal ingestion
- Progressive evolution of Home feed
- Cross-shelf deduplication
- Queue continuity and anti-clustering
"""

import uuid
import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_01_home_feed_cold_structure_and_contracts(client):
    """Cold user gets complete discovery structure with canonical Song objects."""
    uid = f"cold_user_{uuid.uuid4().hex[:8]}"
    headers = {
        "x-sway-user-id": uid,
        "x-sway-anon-id": f"anon_{uid}",
        "x-sway-session-id": f"sess_{uid}",
    }

    res = client.get("/api/v1/recommendations/home", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    data = body["data"]

    assert data["user_id"] == uid
    assert data["state"] == "cold"
    assert len(data["shelves"]) >= 2

    # Check each shelf and item
    for shelf in data["shelves"]:
        assert shelf["id"]
        assert shelf["type"]
        assert shelf["title"]
        assert "items" in shelf
        assert len(shelf["items"]) > 0

        for item in shelf["items"]:
            assert item["id"]
            assert item["title"]
            assert item["artist_name"]
            assert isinstance(item["artists"], list)
            assert item["has_media"] is True
            assert "Sample Track" not in item["title"]
            assert "Artist 0" not in item["artist_name"]
            assert not item["id"].startswith("track_seed_")


def test_02_both_home_and_recommendations_home_paths_match(client):
    """Both /api/v1/home and /api/v1/recommendations/home return consistent structures."""
    uid = f"alias_user_{uuid.uuid4().hex[:8]}"
    headers = {"x-sway-user-id": uid}

    r1 = client.get("/api/v1/home", headers=headers)
    r2 = client.get("/api/v1/recommendations/home", headers=headers)

    assert r1.status_code == 200
    assert r2.status_code == 200

    d1 = r1.json()["data"]
    d2 = r2.json()["data"]

    assert d1["state"] == d2["state"]
    assert len(d1["shelves"]) == len(d2["shelves"])
    assert [s["type"] for s in d1["shelves"]] == [s["type"] for s in d2["shelves"]]


def test_03_telemetry_milestones_and_search_intent_ingestion(client):
    """POST /api/v1/recommendations/events accepts all milestones and search intent."""
    uid = f"telemetry_user_{uuid.uuid4().hex[:8]}"
    track_id = "test_track_telemetry_123"

    events = [
        {"event_type": "play_started", "position_ms": 0, "source": "search", "query": "arijit romantic"},
        {"event_type": "play_10s", "position_ms": 10000, "source": "search"},
        {"event_type": "play_30s", "position_ms": 30000, "source": "search"},
        {"event_type": "play_50pct", "position_ms": 90000, "duration_ms": 180000, "completion_ratio": 0.5},
        {"event_type": "completed", "position_ms": 180000, "duration_ms": 180000, "completion_ratio": 1.0},
        {"event_type": "skip_lt_10s", "position_ms": 3000, "duration_ms": 180000},
        {"event_type": "skip_10_30s", "position_ms": 15000, "duration_ms": 180000},
        {"event_type": "like"},
        {"event_type": "replay", "position_ms": 180000, "duration_ms": 180000},
    ]

    for ev in events:
        payload = {
            "user_id": uid,
            "track_id": track_id,
            "title": "Arijit Melodic Track",
            "artist": "Arijit Singh",
            **ev,
        }
        res = client.post("/api/v1/recommendations/events", json=payload)
        assert res.status_code == 200
        res_data = res.json()
        assert res_data.get("ok") is True
        assert res_data.get("accepted") is True


def test_04_home_feed_evolution_to_seeded_and_personalized(client):
    """User evolves through states from cold to seeded/learning."""
    uid = f"evolve_user_{uuid.uuid4().hex[:8]}"
    headers = {"x-sway-user-id": uid}

    # Initial: COLD
    r_cold = client.get("/api/v1/home", headers=headers)
    assert r_cold.json()["data"]["state"] == "cold"

    # Play 1: transitions to SEEDED
    first_track = r_cold.json()["data"]["shelves"][0]["items"][0]
    client.post(
        "/api/v1/recommendations/events",
        json={
            "user_id": uid,
            "track_id": first_track["id"],
            "title": first_track["title"],
            "artist": first_track["artist_name"],
            "event_type": "completed",
            "completion_ratio": 1.0,
        },
    )

    r_seeded = client.get("/api/v1/home", headers=headers)
    assert r_seeded.json()["data"]["state"] in {"seeded", "learning"}
    seeded_types = [s["type"] for s in r_seeded.json()["data"]["shelves"]]
    assert "quick_mix" in seeded_types or "similarity" in seeded_types


def test_05_cross_shelf_deduplication(client):
    """Tracks do not duplicate across different shelves on Home."""
    uid = f"dedup_user_{uuid.uuid4().hex[:8]}"
    headers = {"x-sway-user-id": uid}

    res = client.get("/api/v1/home", headers=headers)
    assert res.status_code == 200
    shelves = res.json()["data"]["shelves"]

    seen = set()
    for s in shelves:
        for it in s["items"]:
            assert it["id"] not in seen, f"Track {it['id']} duplicated across shelves"
            seen.add(it["id"])


def test_06_queue_api_anti_clustering(client):
    """Queue transitions avoid same-artist clustering."""
    res = client.get("/api/v1/home")
    first_track_id = res.json()["data"]["shelves"][0]["items"][0]["id"]

    q_res = client.get(f"/api/v1/queue/next?current_track_id={first_track_id}&count=8")
    assert q_res.status_code == 200
    data = q_res.json().get("data", {})
    tracks = data.get("queue", [])
    assert len(tracks) > 0
    if len(tracks) >= 2:
        # Check that consecutive same artist is not violated
        prev_artist = tracks[0].get("artist_name")
        for t in tracks[1:]:
            curr_artist = t.get("artist_name")
            assert curr_artist != prev_artist, f"Queue clustered consecutive same artist: {curr_artist}"
            prev_artist = curr_artist
