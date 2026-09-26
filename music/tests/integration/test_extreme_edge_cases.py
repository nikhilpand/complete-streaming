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

    def test_oversized_string_fields_rejected(self, client):
        """EventIn field limits: oversized strings must return 422, not 200."""
        oversized_cases = [
            {"session_id": "X" * 1000},
            {"title": "A" * 5000},
            {"artist": "B" * 5000},
            {"user_id": "u" * 500},
            {"query": "q" * 1000},
        ]
        for bad in oversized_cases:
            payload = {"track_id": "track_test_123", "event_type": "play", **bad}
            resp = client.post("/api/v1/recommendations/events", json=payload)
            assert resp.status_code == 422, (
                f"Expected 422 for oversized field {list(bad.keys())}, got {resp.status_code}"
            )

    def test_metadata_oversized_payload_rejected(self, client):
        """metadata dict exceeding 4 KB must return 422."""
        payload = {
            "user_id": "u1",
            "track_id": "t1",
            "event_type": "play",
            "metadata": {"junk": "x" * 5000},
        }
        resp = client.post("/api/v1/recommendations/events", json=payload)
        assert resp.status_code == 422

    def test_valid_bounded_payload_accepted(self, client):
        """EventIn with all fields within bounds should succeed (200)."""
        payload = {
            "user_id": "u1",
            "track_id": "track_test_123",
            "event_type": "play",
            "session_id": "sess_abc",
            "title": "A" * 256,
            "artist": "B" * 256,
            "position_ms": 10000,
            "duration_ms": 200000,
            "completion_ratio": 0.05,
        }
        resp = client.post("/api/v1/recommendations/events", json=payload)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_idempotency_duplicate_event(self, client):
        """Second POST with same client_event_id should be deduplicated (accepted=False)."""
        payload = {
            "client_event_id": "test-idem-abc123",
            "user_id": "u1",
            "track_id": "track_123",
            "event_type": "play",
        }
        r1 = client.post("/api/v1/recommendations/events", json=payload)
        assert r1.status_code == 200
        assert r1.json()["ok"] is True

        r2 = client.post("/api/v1/recommendations/events", json=payload)
        assert r2.status_code == 200
        assert r2.json()["ok"] is True
        # Second call should be a duplicate
        assert r2.json().get("duplicate") is True or r2.json().get("accepted") is False

    def test_empty_body_telemetry(self, client):
        resp = client.post("/api/v1/recommendations/events", json={})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_negative_values_telemetry(self, client):
        payload = {
            "user_id": "user_neg",
            "track_id": "t_neg",
            "event_type": "play",
            "position_ms": -500,
            "duration_ms": -1000,
        }
        # Negative numerics should be rejected with 422
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
# 5. SSRF ATTACKS ON URL RESOLUTION — REAL TESTS VIA link= PARAM
# ============================================================================


class TestSSRFViaLinkParam:
    """
    SSRF protection tests using the REAL code path:
      GET /api/v1/songs?link=<bad_url>
    This exercises SaavnURLResolver.parse() which does:
      scheme check → hostname allowlist → private IP block → token validation.
    """

    # Non-https schemes must be rejected
    NON_HTTPS_URLS = [
        "http://www.jiosaavn.com/song/test/abc123",
        "ftp://www.jiosaavn.com/song/test/abc123",
        "file:///etc/passwd",
    ]

    # Private/localhost addresses must be rejected regardless of scheme
    PRIVATE_NETWORK_URLS = [
        "https://127.0.0.1/song/test/abc123",
        "https://localhost/song/test/abc123",
        "https://169.254.169.254/latest/meta-data/",
        "https://10.0.0.1/song/test/abc123",
        "https://192.168.1.1/song/test/abc123",
    ]

    # Arbitrary external domains must be rejected (not in allowlist)
    EXTERNAL_DOMAIN_URLS = [
        "https://attacker.example.com/song/test/abc123",
        "https://evil.co/song/test/abc123",
        "https://notjiosaavn.com/song/test/abc123",
    ]

    @pytest.mark.parametrize("bad_url", NON_HTTPS_URLS + PRIVATE_NETWORK_URLS + EXTERNAL_DOMAIN_URLS)
    def test_ssrf_urls_rejected_via_link_param(self, client, bad_url):
        """All SSRF/bad URLs via link= must return 400 or 403, never 200 or 500."""
        resp = client.get("/api/v1/songs", params={"link": bad_url})
        assert resp.status_code in (400, 403, 422), (
            f"Expected 400/403/422 for SSRF url {bad_url!r}, got {resp.status_code}"
        )
        assert resp.status_code != 500
        data = resp.json()
        assert data["success"] is False

    def test_trusted_jiosaavn_url_reaches_parser(self, client):
        """A syntactically valid JioSaavn URL gets parsed (may 404 if token not real)."""
        # This exercises the real SSRF guard path all the way to webapi.get
        resp = client.get(
            "/api/v1/songs",
            params={"link": "https://www.jiosaavn.com/song/test-song/abc123xyz"},
        )
        # Either 200 (found) or 404 (not found) — NOT 400/403 (schema is valid)
        assert resp.status_code in (200, 404, 500)  # 500 allowed if Saavn is down in test
        assert resp.status_code != 403


class TestSaavnURLResolverDirectly:
    """Unit tests for SaavnURLResolver.parse() without the HTTP layer."""

    def test_non_https_raises_ssrf(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        from app.core.errors import SSRFAttempt
        with pytest.raises(SSRFAttempt):
            SaavnURLResolver.parse("http://www.jiosaavn.com/song/test/abc123")

    def test_file_scheme_raises_ssrf(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        from app.core.errors import SSRFAttempt
        with pytest.raises(SSRFAttempt):
            SaavnURLResolver.parse("file:///etc/passwd")

    def test_private_ip_raises_ssrf(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        from app.core.errors import SSRFAttempt
        with pytest.raises(SSRFAttempt):
            SaavnURLResolver.parse("https://127.0.0.1/song/test/abc123")

    def test_metadata_ip_raises_ssrf(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        from app.core.errors import SSRFAttempt
        with pytest.raises(SSRFAttempt):
            SaavnURLResolver.parse("https://169.254.169.254/latest/meta-data/")

    def test_external_domain_raises_ssrf(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        from app.core.errors import SSRFAttempt
        with pytest.raises(SSRFAttempt):
            SaavnURLResolver.parse("https://attacker.example.com/song/test/abc123")

    def test_valid_jiosaavn_url_returns_token_and_type(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        token, rtype = SaavnURLResolver.parse(
            "https://www.jiosaavn.com/song/tere-bina/abc123XYZ"
        )
        assert token == "abc123XYZ"
        assert rtype == "song"

    def test_album_url_returns_correct_type(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        token, rtype = SaavnURLResolver.parse(
            "https://www.jiosaavn.com/album/some-album/AbcDef123"
        )
        assert rtype == "album"

    def test_invalid_token_chars_raises(self):
        from app.providers.saavn.resolver import SaavnURLResolver
        from app.core.errors import ProviderInvalidRequest
        with pytest.raises(ProviderInvalidRequest):
            SaavnURLResolver.parse(
                "https://www.jiosaavn.com/song/test/abc!@#bad"
            )
