from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_home_feed_returns_discovery_shelves_for_cold_user(client):
    headers = {
        "x-sway-user-id": "new_cold_user_1",
        "x-sway-anon-id": "anon_cold_1",
        "x-sway-session-id": "sess_cold_1",
    }
    res = client.get("/api/v1/home", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    data = body["data"]
    assert "shelves" in data
    assert data.get("state") == "cold"
    shelves = data["shelves"]
    assert len(shelves) >= 4, f"Expected at least 4 shelves, got {len(shelves)}"

    shelf_types = [s["type"] for s in shelves]
    assert "trending" in shelf_types
    assert "discovery" in shelf_types

    for s in shelves:
        assert "title" in s
        assert "badge" in s
        assert "items" in s
        assert len(s["items"]) > 0
        for item in s["items"]:
            # Invariant: Zero fake sample titles
            assert "Sample Track" not in item["title"]
            assert "Artist 0" not in item["artist_name"]


import uuid

def test_home_feed_evolves_after_listening(client):
    uid = f"learning_user_{uuid.uuid4().hex[:8]}"
    headers = {
        "x-sway-user-id": uid,
        "x-sway-anon-id": f"anon_{uid}",
        "x-sway-session-id": f"sess_{uid}",
    }

    # First check cold state
    cold_res = client.get("/api/v1/home", headers=headers)
    assert cold_res.status_code == 200
    assert cold_res.json()["data"]["state"] == "cold"

    # Ingest a completed listening event
    first_track_id = cold_res.json()["data"]["shelves"][0]["items"][0]["id"]
    event_payload = {
        "user_id": uid,
        "track_id": first_track_id,
        "event_type": "completed",
        "position_ms": 180000,
        "duration_ms": 180000,
        "completion_ratio": 1.0,
    }
    evt_res = client.post("/api/v1/recommendations/events", json=event_payload)
    assert evt_res.status_code == 200

    # Next fetch reflects seeded/learning personalization
    res = client.get("/api/v1/home", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["state"] in {"seeded", "learning", "personalized"}
    shelves = data["shelves"]
    shelf_types = [s["type"] for s in shelves]
    assert "quick_mix" in shelf_types
    assert "similarity" in shelf_types


def test_canonical_recommendations_home_endpoint(client):
    headers = {
        "x-sway-user-id": "user_canonical_check",
    }
    res = client.get("/api/v1/recommendations/home", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "shelves" in body["data"]
    assert "state" in body["data"]
