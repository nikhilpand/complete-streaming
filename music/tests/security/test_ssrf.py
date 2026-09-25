"""
Unit tests for the SSRF-safe URL resolver.
"""

import pytest

from app.core.errors import ProviderInvalidRequest, SSRFAttempt
from app.providers.saavn.resolver import SaavnURLResolver


class TestSaavnURLResolver:
    # ── Valid URLs ─────────────────────────────────────────────────────────

    def test_valid_song_url(self):
        token, rtype = SaavnURLResolver.parse(
            "https://www.jiosaavn.com/song/tum-hi-ho/I9DTxvJNRQA_"
        )
        assert token == "I9DTxvJNRQA_"
        assert rtype == "song"

    def test_valid_album_url(self):
        token, rtype = SaavnURLResolver.parse(
            "https://www.jiosaavn.com/album/aashiqui-2/abc123"
        )
        assert token == "abc123"
        assert rtype == "album"

    def test_valid_playlist_url(self):
        token, rtype = SaavnURLResolver.parse(
            "https://www.jiosaavn.com/featured/best-of-arijit/xyz"
        )
        assert token == "xyz"
        assert rtype == "playlist"

    def test_valid_artist_url(self):
        token, rtype = SaavnURLResolver.parse(
            "https://www.jiosaavn.com/artist/arijit-singh/LlRWpHzy3Hk_"
        )
        assert token == "LlRWpHzy3Hk_"
        assert rtype == "artist"

    def test_saavn_com_domain(self):
        token, _ = SaavnURLResolver.parse(
            "https://www.saavn.com/song/test/abc123"
        )
        assert token == "abc123"

    # ── SSRF attacks ──────────────────────────────────────────────────────

    def test_rejects_http(self):
        with pytest.raises(SSRFAttempt, match="Only https://"):
            SaavnURLResolver.parse(
                "http://www.jiosaavn.com/song/test/abc"
            )

    def test_rejects_localhost(self):
        with pytest.raises(SSRFAttempt, match="not in allowlist"):
            SaavnURLResolver.parse(
                "https://localhost/song/test/abc"
            )

    def test_rejects_private_ip(self):
        with pytest.raises(SSRFAttempt, match="not in allowlist"):
            SaavnURLResolver.parse(
                "https://192.168.1.1/song/test/abc"
            )

    def test_rejects_arbitrary_domain(self):
        with pytest.raises(SSRFAttempt, match="not in allowlist"):
            SaavnURLResolver.parse(
                "https://evil.com/song/test/abc"
            )

    def test_rejects_file_scheme(self):
        with pytest.raises(SSRFAttempt, match="Only https://"):
            SaavnURLResolver.parse(
                "file:///etc/passwd"
            )

    def test_rejects_ftp(self):
        with pytest.raises(SSRFAttempt, match="Only https://"):
            SaavnURLResolver.parse(
                "ftp://jiosaavn.com/song/test/abc"
            )

    def test_rejects_no_hostname(self):
        with pytest.raises(SSRFAttempt, match="no hostname"):
            SaavnURLResolver.parse("https:///song/test/abc")

    # ── Invalid URLs ──────────────────────────────────────────────────────

    def test_rejects_short_path(self):
        with pytest.raises(ProviderInvalidRequest, match="at least 2 path"):
            SaavnURLResolver.parse("https://www.jiosaavn.com/song")

    def test_rejects_too_long(self):
        long_url = "https://www.jiosaavn.com/song/" + "a" * 3000
        with pytest.raises(ProviderInvalidRequest, match="too long"):
            SaavnURLResolver.parse(long_url)
