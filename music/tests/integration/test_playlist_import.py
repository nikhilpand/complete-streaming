"""
Integration tests for Spotify and YouTube Music playlist imports.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Playlist, Song, ArtistRef


@pytest.fixture
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_import_playlist_validation(client):
    # Empty URL
    res = client.post("/api/v1/playlists/import", json={"url": "   "})
    assert res.status_code == 400

    # Malicious / disallowed host (SSRF guard)
    res = client.post("/api/v1/playlists/import", json={"url": "https://malicious-site.com/playlist/123"})
    assert res.status_code == 400
    assert "not in allowlist" in res.json().get("error", "").lower() or "invalid" in res.json().get("error", "").lower()


def test_import_youtube_playlist(client):
    mock_playlist = Playlist(
        id="youtube:PLtest12345",
        provider="youtube",
        provider_id="PLtest12345",
        title="Test YouTube Playlist",
        artwork_url="https://i.ytimg.com/vi/test/hqdefault.jpg",
        follower_count=None,
        song_count=2,
        last_updated=None,
        owner="Curator Name",
        perma_url="https://music.youtube.com/playlist?list=PLtest12345",
        songs=[
            Song(
                id="youtube:vid1",
                provider="youtube",
                provider_id="vid1",
                title="Song One",
                artists=[ArtistRef(id="youtube:artist:art1", provider="youtube", provider_id="art1", name="Artist One", role="primary")],
                featured_artists=[],
                has_media=True,
                duration_ms=180000,
            ),
            Song(
                id="youtube:vid2",
                provider="youtube",
                provider_id="vid2",
                title="Song Two",
                artists=[ArtistRef(id="youtube:artist:art2", provider="youtube", provider_id="art2", name="Artist Two", role="primary")],
                featured_artists=[],
                has_media=True,
                duration_ms=210000,
            ),
        ],
    )

    with patch.object(client.app.state.provider.youtube, "get_playlist", new_callable=AsyncMock) as mock_get_pl:
        mock_get_pl.return_value = mock_playlist

        # 1. Via POST /api/v1/playlists/import
        res = client.post(
            "/api/v1/playlists/import",
            json={"url": "https://music.youtube.com/playlist?list=PLtest12345"},
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["id"] == "youtube:PLtest12345"
        assert data["title"] == "Test YouTube Playlist"
        assert len(data["songs"]) == 2

        # 2. Via GET /api/v1/playlists?link=...
        res2 = client.get("/api/v1/playlists?link=https://www.youtube.com/playlist?list=PLtest12345")
        assert res2.status_code == 200
        assert res2.json()["data"]["title"] == "Test YouTube Playlist"

        # 3. Via GET /api/v1/playlists/youtube:PLtest12345
        res3 = client.get("/api/v1/playlists/youtube:PLtest12345")
        assert res3.status_code == 200
        assert res3.json()["data"]["id"] == "youtube:PLtest12345"


def test_import_spotify_playlist(client):
    mock_playlist = Playlist(
        id="spotify:37i9dQZF1DXcBWIGoYBM5M",
        provider="spotify",
        provider_id="37i9dQZF1DXcBWIGoYBM5M",
        title="Today's Top Hits",
        artwork_url="https://i.scdn.co/image/test",
        follower_count=30000000,
        song_count=1,
        last_updated=None,
        owner="Spotify",
        perma_url="https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
        songs=[
            Song(
                id="spotify:track123",
                provider="spotify",
                provider_id="track123",
                title="Pop Anthem",
                artists=[ArtistRef(id="spotify:artist:star", provider="spotify", provider_id="star", name="Super Star", role="primary")],
                featured_artists=[],
                has_media=True,
                duration_ms=200000,
            )
        ],
    )

    with patch.object(client.app.state.provider.spotify, "get_playlist", new_callable=AsyncMock) as mock_get_pl:
        mock_get_pl.return_value = mock_playlist

        # 1. Via POST /api/v1/playlists/import
        res = client.post(
            "/api/v1/playlists/import",
            json={"url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"},
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["id"] == "spotify:37i9dQZF1DXcBWIGoYBM5M"
        assert data["title"] == "Today's Top Hits"
        assert len(data["songs"]) == 1

        # 2. Via GET /api/v1/playlists?link=...
        res2 = client.get("/api/v1/playlists?link=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
        assert res2.status_code == 200
        assert res2.json()["data"]["provider"] == "spotify"

        # 3. Via GET /api/v1/playlists/spotify:37i9dQZF1DXcBWIGoYBM5M
        res3 = client.get("/api/v1/playlists/spotify:37i9dQZF1DXcBWIGoYBM5M")
        assert res3.status_code == 200
        assert res3.json()["data"]["id"] == "spotify:37i9dQZF1DXcBWIGoYBM5M"
