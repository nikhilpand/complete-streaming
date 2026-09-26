"""
Ultra-hardcore edge case and security fuzzing test suite for API endpoints.

Covers:
  - Unicode, Non-ASCII, and Emoji Queries on /search
  - Boundary validations on query parameters (min/max length, min/max count, negative pages)
  - Malicious SQL Injection payloads on /songs, /albums, /artists, /playlists
  - Path traversal and XSS injection attempts
  - Corrupted and malformed IDs (special characters, empty strings, colons)
  - Telemetry fuzzing on /recommendations/events (huge strings, negative timestamps, unknown events)
  - Queue router edge inputs and non-existent seeds
  - SSRF protection against private networks and metadata endpoints
"""

from __future__ import annotations

import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from app.main import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


# ============================================================================
# 1. SEARCH ENDPOINT: UNICODE, EMOJIS, AND QUERY BOUNDARIES
# ============================================================================


class TestSearchEndpointHardcore:
    """Hardcore boundary and unicode tests for /api/v1/search."""

    @respx.mock
    def test_unicode_and_emoji_queries_succeed(self, client):
        # Mock upstream Saavn API response
        respx.get("https://www.jiosaavn.com/api.php").mock(
            return_value=Response(200, json={"results": []})
        )

        unicode_queries = [
            "🔥🎶 अरिजित सिंह 🎵❤️",
            "مرحبا بالعالم",
            "русский рок",
            "日本語の曲",
            "夜曲 周杰伦",
            "Chaiyya Chaiyya 💥🚂",
        ]
        for q in unicode_queries:
            resp = client.get("/api/v1/search", params={"q": q})
            assert resp.status_code == 200, f"Failed on query: {q}"
            data = resp.json()
            assert data["success"] is True

    def test_whitespace_only_query_returns_400(self, client):
        resp = client.get("/api/v1/search", params={"q": "     "})
        assert resp.status_code == 400
        data = resp.json()
        assert data["success"] is False
        assert "cannot be empty" in data["error"].lower()

    def test_empty_query_returns_422(self, client):
        resp = client.get("/api/v1/search", params={"q": ""})
        assert resp.status_code == 422

    def test_excessive_length_query_returns_422(self, client):
        giant_query = "a" * 201
        resp = client.get("/api/v1/search", params={"q": giant_query})
        assert resp.status_code == 422

    def test_query_parameter_bounds_n_and_page(self, client):
        # n < 1
        resp1 = client.get("/api/v1/search", params={"q": "arijit", "n": 0})
        assert resp1.status_code == 422

        resp2 = client.get("/api/v1/search", params={"q": "arijit", "n": -5})
        assert resp2.status_code == 422

        # n > 50
        resp3 = client.get("/api/v1/search", params={"q": "arijit", "n": 51})
        assert resp3.status_code == 422

        # page < 1
        resp4 = client.get("/api/v1/search", params={"q": "arijit", "page": 0})
        assert resp4.status_code == 422

        resp5 = client.get("/api/v1/search", params={"q": "arijit", "page": -1})
        assert resp5.status_code == 422


# ============================================================================
# 2. MALICIOUS INJECTIONS & CORRUPTED IDS
# ============================================================================


class TestMaliciousPayloadsAndCorruptedIDs:
    """Security tests verifying injection payloads are safely rejected."""

    SQL_INJECTIONS = [
        "'; DROP TABLE songs; --",
        "' OR '1'='1",
        "admin'--",
        "\" OR \"\"=\"",
        "1; SELECT * FROM sqlite_master;",
    ]

    PATH_TRAVERSALS = [
        "../../../../etc/passwd",
        "..\\..\\windows\\system32\\cmd.exe",
        "/etc/shadow",
    ]

    XSS_PAYLOADS = [
        "<script>alert('xss')</script>",
        "<img src=x onerror=alert(1)>",
        "javascript:alert(1)",
    ]

    MALFORMED_IDS = [
        "yt:!@#$%^&*()",
        "saavn:   ",
        "::::",
        "a",  # shorter than 2 chars
        "b" * 35,  # longer than 30 chars
    ]

    @pytest.mark.parametrize("payload", SQL_INJECTIONS + PATH_TRAVERSALS + XSS_PAYLOADS + MALFORMED_IDS)
    def test_songs_endpoint_rejects_malicious_id(self, client, payload):
        resp = client.get("/api/v1/songs", params={"id": payload})
        assert resp.status_code == 400
        data = resp.json()
        assert data["success"] is False
        assert data["error_code"] == "PROVIDER_INVALID_REQUEST"

    @pytest.mark.parametrize("payload", SQL_INJECTIONS + PATH_TRAVERSALS)
    def test_albums_endpoint_rejects_malicious_id(self, client, payload):
        resp = client.get(f"/api/v1/albums/{payload}")
        assert resp.status_code in (400, 404, 422)
        assert resp.status_code != 500

    @pytest.mark.parametrize("payload", SQL_INJECTIONS + PATH_TRAVERSALS)
    def test_artists_endpoint_rejects_malicious_id(self, client, payload):
        resp = client.get(f"/api/v1/artists/{payload}")
        assert resp.status_code in (400, 404, 422)
        assert resp.status_code != 500

    @pytest.mark.parametrize("payload", SQL_INJECTIONS + PATH_TRAVERSALS)
    def test_playlists_endpoint_rejects_malicious_id(self, client, payload):
        resp = client.get(f"/api/v1/playlists/{payload}")
        assert resp.status_code in (400, 404, 422)
        assert resp.status_code != 500

    @pytest.mark.parametrize("payload", SQL_INJECTIONS + PATH_TRAVERSALS)
    def test_lyrics_endpoint_rejects_malicious_id(self, client, payload):
        resp = client.get(f"/api/v1/lyrics/{payload}")
        assert resp.status_code in (400, 404, 422)
        assert resp.status_code != 500


# ============================================================================
# 3. TELEMETRY / EVENT INGESTION FUZZING
# ============================================================================


class TestTelemetryFuzzing:
    """Stress tests on /api/v1/recommendations/events."""

    def test_fuzzed_telemetry_payload(self, client):
        payload = {
            "user_id": "'; DROP TABLE event_log; --",
            "track_id": "track_test_123",
            "event_type": "alien_event_type_unknown",
            "session_id": "sess_" + "X" * 1000,
            "title": "A" * 5000,
            "artist": "B" * 5000,
            "position_ms": 10000,
            "duration_ms": 200000,
            "completion_ratio": 0.05,
            "metadata": {"nested_attack": {"payload": "' OR '1'='1"}},
        }
        resp = client.post("/api/v1/recommendations/events", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True

    def test_empty_body_telemetry(self, client):
        resp = client.post("/api/v1/recommendations/events", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True

    def test_negative_values_telemetry(self, client):
        payload = {
            "user_id": "user_neg",
            "track_id": "t_neg",
            "event_type": "play",
            "position_ms": -500,
            "duration_ms": -1000,
        }
        # Ingestion handles gracefully without 500 internal server error
        resp = client.post("/api/v1/recommendations/events", json=payload)
        assert resp.status_code in (200, 422)
        assert resp.status_code != 500


# ============================================================================
# 4. QUEUE ROUTER EDGE INPUTS
# ============================================================================


class TestQueueRouterEdgeCases:
    """Edge cases for /api/v1/queue/next."""

    def test_nonexistent_current_track_id(self, client):
        resp = client.get("/api/v1/queue/next?current_track_id=completely_nonexistent_id&count=5")
        # Returns 200 with fallback or 404, never 500
        assert resp.status_code in (200, 404)
        assert resp.status_code != 500

    def test_zero_or_extreme_count(self, client):
        resp_zero = client.get("/api/v1/queue/next?current_track_id=track_1&count=0")
        assert resp_zero.status_code in (200, 400, 404, 422)
        assert resp_zero.status_code != 500

        resp_high = client.get("/api/v1/queue/next?current_track_id=track_1&count=1000")
        assert resp_high.status_code in (200, 400, 404, 422)
        assert resp_high.status_code != 500


# ============================================================================
# 5. SSRF ATTACKS ON URL RESOLUTION
# ============================================================================


class TestSSRFAttacksOnURLResolution:
    """Security tests ensuring SSRF attacks via url parameter are rejected."""

    SSRF_URLS = [
        "http://localhost:8000/api/v1/admin",
        "http://127.0.0.1:8000/metrics",
        "http://169.254.169.254/latest/meta-data/",
        "https://169.254.169.254/latest/meta-data/",
        "file:///etc/passwd",
        "ftp://internal.corp/secret.key",
        "https://evil-site.com/song/fake/123",
        "http://www.jiosaavn.com/song/test/123",  # non-https
    ]

    @pytest.mark.parametrize("bad_url", SSRF_URLS)
    def test_ssrf_urls_rejected(self, client, bad_url):
        resp = client.get("/api/v1/songs", params={"url": bad_url})
        assert resp.status_code in (400, 403, 422)
        data = resp.json()
        assert data["success"] is False
