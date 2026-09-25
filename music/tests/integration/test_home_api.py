from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_home_feed_returns_differentiated_shelves(client):
    headers = {
        "x-sway-user-id": "user_premium_1",
        "x-sway-anon-id": "anon_client_1",
        "x-sway-session-id": "sess_home_1",
    }
    res = client.get("/api/v1/home", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    data = body["data"]
    assert "shelves" in data
    shelves = data["shelves"]
    assert len(shelves) >= 4, f"Expected at least 4 shelves, got {len(shelves)}"

    shelf_types = [s["type"] for s in shelves]
    assert "quick_mix" in shelf_types
    for s in shelves:
        assert "title" in s
        assert "badge" in s
        assert "items" in s
        assert len(s["items"]) > 0
