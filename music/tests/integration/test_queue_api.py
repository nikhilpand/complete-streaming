from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.models import ArtistRef, Song


@pytest.fixture
def client():
    return TestClient(app)


def test_queue_next_api_returns_sequenced_tracks(client, monkeypatch):
    # Mock song lookup for current_track_id
    mock_song = Song(
        id="s_current",
        provider="saavn",
        provider_id="p_current",
        title="Tu Chahiye",
        artists=[ArtistRef(id="a_atif", name="Atif Aslam", role="singer", provider="saavn", provider_id="p_atif")],
        language="hindi",
        year="2015",
        artwork_url="http://example.com/art.jpg",
        has_media=True,
    )

    from app.routers import songs
    monkeypatch.setattr(songs, "get_song_by_id", lambda song_id: mock_song if song_id == "s_current" else None)

    res = client.get("/api/v1/queue/next?current_track_id=s_current&count=5")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    data = body["data"]
    assert "queue" in data
    assert len(data["queue"]) > 0
    assert data["current_track_id"] == "s_current"
