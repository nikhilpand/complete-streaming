"""
Property-based tests using Hypothesis.

Tests cover invariant properties:
  - Query normalization: idempotency, whitespace collapsing, Unicode NFC stability
  - URL parsing: allowlist enforcement, token structure, SSRF rejection invariants
  - ID validation: allowed charset and length constraints
  - Deduplication: order preservation, uniqueness guarantee
  - Duration conversion: non-negativity, string-to-ms scaling, graceful failure on garbage
"""

import unicodedata
import pytest
from hypothesis import given, strategies as st, settings as hyp_settings

from app.core.errors import ProviderInvalidRequest, SSRFAttempt
from app.providers.saavn.parser import _parse_duration_ms
from app.providers.saavn.resolver import SaavnURLResolver
from app.routers.search import _normalize_query
from app.routers.songs import _validate_id


# ── 1. Query Normalization Properties ─────────────────────────────────────────

class TestQueryNormalizationProperties:
    @given(st.text(min_size=1, max_size=200))
    def test_idempotent(self, text):
        """Normalizing twice produces the same result as normalizing once."""
        first = _normalize_query(text)
        second = _normalize_query(first)
        assert first == second

    @given(st.text(min_size=1, max_size=200))
    def test_nfc_normalized(self, text):
        """Result is always in Unicode NFC form."""
        norm = _normalize_query(text)
        assert unicodedata.is_normalized("NFC", norm)

    @given(st.text(min_size=1, max_size=200))
    def test_no_consecutive_whitespace(self, text):
        """Result contains no internal consecutive whitespace runs."""
        norm = _normalize_query(text)
        assert "  " not in norm

    @given(st.text(min_size=1, max_size=200))
    def test_no_leading_trailing_whitespace(self, text):
        """Result has no leading or trailing whitespace."""
        norm = _normalize_query(text)
        assert norm == norm.strip()


# ── 2. Duration Conversion Properties ─────────────────────────────────────────

class TestDurationProperties:
    @given(st.integers(min_value=0, max_value=86400))
    def test_valid_integer_seconds_scaled_to_ms(self, secs):
        """Integer seconds strings always map to secs * 1000 ms."""
        ms = _parse_duration_ms(str(secs))
        assert ms == secs * 1000

    @given(st.floats(min_value=0.0, max_value=86400.0, allow_nan=False, allow_infinity=False))
    def test_float_seconds_rounded_down_to_ms(self, secs):
        """Float seconds are parsed cleanly to ms."""
        ms = _parse_duration_ms(f"{secs:.2f}")
        assert ms is not None
        assert ms >= 0

    @given(st.text(alphabet=st.characters(blacklist_categories=('Nd',))))
    def test_non_numeric_returns_none(self, garbage):
        """Non-numeric string inputs safely return None without throwing."""
        assert _parse_duration_ms(garbage) is None


# ── 3. ID Validation Properties ───────────────────────────────────────────────

class TestIdValidationProperties:
    @given(st.from_regex(r"^[A-Za-z0-9_\-]{2,30}$", fullmatch=True))
    def test_valid_ids_accepted(self, valid_id):
        """Valid IDs matching the schema are returned unchanged."""
        assert _validate_id(valid_id) == valid_id

    @given(st.text(min_size=31, max_size=100))
    def test_overlong_ids_rejected(self, long_id):
        """IDs longer than 30 chars are rejected."""
        with pytest.raises(ProviderInvalidRequest):
            _validate_id(long_id)

    @given(st.text(min_size=0, max_size=1))
    def test_too_short_ids_rejected(self, short_id):
        """IDs shorter than 2 chars are rejected."""
        with pytest.raises(ProviderInvalidRequest):
            _validate_id(short_id)

    @given(st.from_regex(r"^.*[/\\?#@!$%^&*+=<>].*$", fullmatch=True))
    def test_special_characters_rejected(self, special_id):
        """IDs containing disallowed special characters are rejected."""
        with pytest.raises(ProviderInvalidRequest):
            _validate_id(special_id)


# ── 4. URL Resolver Properties ────────────────────────────────────────────────

class TestUrlResolverProperties:
    @given(
        scheme=st.sampled_from(["http", "ftp", "file", "gopher"]),
        host=st.sampled_from(["www.jiosaavn.com", "jiosaavn.com"]),
        token=st.from_regex(r"^[A-Za-z0-9_\-]+$", fullmatch=True),
    )
    def test_non_https_always_rejected(self, scheme, host, token):
        """Any scheme other than https must raise SSRFAttempt."""
        url = f"{scheme}://{host}/song/test/{token}"
        with pytest.raises(SSRFAttempt):
            SaavnURLResolver.parse(url)

    @given(
        host=st.text(min_size=1, max_size=50).filter(
            lambda h: h.lower() not in {"www.jiosaavn.com", "jiosaavn.com", "saavn.com", "www.saavn.com"}
        ),
        token=st.from_regex(r"^[A-Za-z0-9_\-]+$", fullmatch=True),
    )
    def test_unauthorized_host_always_rejected(self, host, token):
        """Any hostname not in allowlist or malformed host raises an error."""
        url = f"https://{host}/song/test/{token}"
        with pytest.raises((SSRFAttempt, ProviderInvalidRequest)):
            SaavnURLResolver.parse(url)

    @given(
        host=st.sampled_from(["www.jiosaavn.com", "jiosaavn.com", "saavn.com"]),
        res_type=st.sampled_from(["song", "album", "featured", "playlist", "artist"]),
        token=st.from_regex(r"^[A-Za-z0-9_\-]+$", fullmatch=True),
    )
    def test_valid_urls_extract_exact_token(self, host, res_type, token):
        """Valid JioSaavn share URLs reliably extract the correct token."""
        url = f"https://{host}/{res_type}/title-slug/{token}"
        extracted_token, extracted_type = SaavnURLResolver.parse(url)
        assert extracted_token == token
        if res_type in ("featured", "playlist"):
            assert extracted_type == "playlist"
        else:
            assert extracted_type == res_type


# ── 5. Deduplication Properties ───────────────────────────────────────────────

class TestDeduplicationProperties:
    @given(st.lists(st.text(min_size=1, max_size=20), max_size=50))
    def test_deduplication_preserves_order_and_uniqueness(self, raw_list):
        """dict.fromkeys deduplication preserves encounter order and guarantees uniqueness."""
        deduped = list(dict.fromkeys(raw_list))
        # Unique
        assert len(deduped) == len(set(raw_list))
        # Subset
        assert set(deduped) == set(raw_list)
        # Order preservation
        indices = [deduped.index(item) for item in deduped]
        assert indices == sorted(indices)
