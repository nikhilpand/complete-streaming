"""
Integration tests for API endpoints using TestClient.

Uses respx to mock upstream JioSaavn HTTP calls.
Verifies the full request lifecycle:
  HTTP request → router → provider → cache → client → (mocked upstream)
"""

import json
import pathlib

import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient

from app.main import create_app

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def _load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


class TestHealthEndpoints:
    def test_liveness(self, client):
        resp = client.get("/health/live")
        assert resp.status_code == 200
        assert resp.json()["status"] == "alive"

    def test_readiness(self, client):
        resp = client.get("/health/ready")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("ready", "degraded")
        assert "provider" in data


class TestSearchEndpoint:
    @respx.mock
    def test_search_returns_results(self, client):
        fixture = _load_fixture("search.json")
        respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(200, json=fixture)
        )

        resp = client.get("/api/v1/search", params={"q": "arijit"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "songs" in data["data"]
        assert len(data["data"]["songs"]) > 0

    @respx.mock
    def test_search_with_enrichment(self, client):
        search_fixture = _load_fixture("search.json")
        song_fixture = _load_fixture("song.json")

        # Mock search call
        respx.get("https://www.jiosaavn.com/api.php", params__contains={"__call": "autocomplete.get"}).mock(
            return_value=Response(200, json=search_fixture)
        )
        s1 = dict(song_fixture, id="search_song1")
        s2 = dict(song_fixture, id="search_song2")
        # Mock batch song call
        respx.get("https://www.jiosaavn.com/api.php", params__contains={"__call": "song.getDetails"}).mock(
            return_value=Response(200, json={"search_song1": s1, "search_song2": s2})
        )

        resp = client.get("/api/v1/search", params={"q": "arijit", "enrich": "true"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "enriched_songs" in data["data"]
        assert len(data["data"]["enriched_songs"]) > 0


    def test_search_missing_query(self, client):
        resp = client.get("/api/v1/search")
        assert resp.status_code == 422  # FastAPI validation

    def test_search_empty_query(self, client):
        resp = client.get("/api/v1/search", params={"q": ""})
        assert resp.status_code == 422


class TestSongsEndpoint:
    @respx.mock
    def test_get_song_by_id(self, client):
        fixture = _load_fixture("song.json")
        # song.getDetails returns the song directly or as a dict
        respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(200, json=fixture)
        )

        resp = client.get("/api/v1/songs/test123")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["provider_id"] == "test123"
        assert data["data"]["provider"] == "saavn"
        # Verify media URLs are NOT in the response
        assert "download_urls" not in data["data"]
        assert "streams" not in data["data"]

    def test_songs_no_id_or_link(self, client):
        resp = client.get("/api/v1/songs")
        assert resp.status_code == 400

    def test_songs_invalid_id(self, client):
        # Special chars that fail the ID regex validator
        resp = client.get("/api/v1/songs/invalid!@id")
        assert resp.status_code == 400


class TestLyricsEndpoint:
    @respx.mock
    def test_get_lyrics(self, client):
        fixture = _load_fixture("lyrics.json")
        respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(200, json=fixture)
        )

        resp = client.get("/api/v1/lyrics/lyrics789")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "lyrics" not in data["data"] or data["data"].get("plain") is not None


class TestErrorHandling:
    @respx.mock
    def test_upstream_timeout(self, client):
        import httpx as _httpx
        respx.get("https://www.jiosaavn.com/api.php").mock(
            side_effect=_httpx.ReadTimeout("timeout")
        )

        resp = client.get("/api/v1/songs/test123")
        # After retries exhausted → 503
        assert resp.status_code in (503, 504)
        data = resp.json()
        assert data["success"] is False
        assert "error_code" in data

    @respx.mock
    def test_upstream_500(self, client):
        respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(500, text="Internal Server Error")
        )

        resp = client.get("/api/v1/songs/test123")
        assert resp.status_code in (502, 503)
        data = resp.json()
        assert data["success"] is False
