"""
Unit tests for the JioSaavn response parser.

Tests cover:
  - Normal song parsing
  - Missing optional fields (should not raise)
  - Missing required 'id' field (should raise ProviderSchemaChanged)
  - String boolean conversion
  - HTML entity unescaping
  - Image URL upgrade
  - Duration conversion
  - Multi-song response shapes (list, dict-of-dicts, songs-key wrapper)
  - Search response parsing
  - Lyrics parsing
  - Album parsing with malformed tracks (partial failure tolerance)
"""

import json
import pathlib

import pytest

from app.core.errors import ProviderBadResponse, ProviderSchemaChanged
from app.providers.saavn.parser import (
    _html_clean,
    _hi_res_image,
    _parse_duration_ms,
    _str_bool,
    parse_album_raw,
    parse_lyrics_raw,
    parse_search_raw,
    parse_song_raw,
    parse_songs_response,
)

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"


def _load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


# ── Helper tests ──────────────────────────────────────────────────────────────


class TestHelpers:
    def test_str_bool_true(self):
        assert _str_bool("true") is True
        assert _str_bool("True") is True
        assert _str_bool(True) is True

    def test_str_bool_false(self):
        assert _str_bool("false") is False
        assert _str_bool("") is False
        assert _str_bool(False) is False
        assert _str_bool(None) is False

    def test_html_clean(self):
        assert _html_clean("Arijit &amp; Singh") == "Arijit & Singh"
        assert _html_clean("&quot;Hello&quot;") == '"Hello"'
        assert _html_clean("It&#039;s") == "It's"
        assert _html_clean(None) is None
        assert _html_clean("") is None

    def test_hi_res_image(self):
        assert _hi_res_image("https://c.saavncdn.com/123/50x50.jpg") == \
               "https://c.saavncdn.com/123/500x500.jpg"
        assert _hi_res_image("https://c.saavncdn.com/123/150x150.jpg") == \
               "https://c.saavncdn.com/123/500x500.jpg"
        assert _hi_res_image(None) is None

    def test_parse_duration_ms(self):
        assert _parse_duration_ms("262") == 262000
        assert _parse_duration_ms("0") == 0
        assert _parse_duration_ms(None) is None
        assert _parse_duration_ms("abc") is None


# ── Song parsing ──────────────────────────────────────────────────────────────


class TestSongParser:
    def test_parse_normal_song(self):
        raw = _load_fixture("song.json")
        result = parse_song_raw(raw)

        assert result["id"] == "test123"
        assert result["title"] == "Tum Hi Ho"
        assert result["album"] == "Aashiqui 2"
        assert result["duration_ms"] == 262000
        assert result["has_lyrics"] is True
        assert result["lyrics_id"] == "lyrics789"
        assert result["is_320kbps"] is True
        assert result["has_media"] is True
        assert "500x500" in result["image"]
        assert len(result["primary_artists"]) == 1
        assert result["primary_artists"][0]["name"] == "Arijit Singh"
        assert len(result["featured_artists"]) == 1

    def test_missing_required_id_raises(self):
        raw = {"song": "Test", "album": "Test Album"}
        with pytest.raises(ProviderSchemaChanged):
            parse_song_raw(raw)

    def test_missing_optional_fields(self):
        """Parser should tolerate missing optional fields."""
        raw = {"id": "minimal_song"}
        result = parse_song_raw(raw)
        assert result["id"] == "minimal_song"
        assert result["title"] == ""
        assert result["album"] is None
        assert result["duration_ms"] is None
        assert result["has_lyrics"] is False
        assert result["primary_artists"] == []

    def test_not_a_dict_raises(self):
        with pytest.raises(ProviderBadResponse):
            parse_song_raw("not a dict")

    def test_html_entities_cleaned(self):
        raw = {
            "id": "html_test",
            "song": "It&#039;s &amp; &quot;Good&quot;",
        }
        result = parse_song_raw(raw)
        assert result["title"] == 'It\'s & "Good"'


# ── Multi-song response parsing ──────────────────────────────────────────────


class TestSongsResponse:
    def test_parse_dict_with_songs_key(self):
        raw = {
            "songs": [
                {"id": "s1", "song": "Song 1"},
                {"id": "s2", "song": "Song 2"},
            ]
        }
        result = parse_songs_response(raw)
        assert len(result) == 2
        assert result[0]["id"] == "s1"

    def test_parse_list(self):
        raw = [
            {"id": "s1", "song": "Song 1"},
            {"id": "s2", "song": "Song 2"},
        ]
        result = parse_songs_response(raw)
        assert len(result) == 2

    def test_parse_dict_keyed_by_id(self):
        raw = {
            "s1": {"id": "s1", "song": "Song 1"},
            "s2": {"id": "s2", "song": "Song 2"},
        }
        result = parse_songs_response(raw)
        assert len(result) == 2

    def test_parse_single_song_dict(self):
        raw = {"id": "single", "song": "Only Song"}
        result = parse_songs_response(raw)
        assert len(result) == 1

    def test_parse_none(self):
        assert parse_songs_response(None) == []

    def test_malformed_songs_skipped(self):
        """Malformed songs in batch are skipped, not crash the whole batch."""
        raw = [
            {"id": "good", "song": "Good Song"},
            {"not_a_song": True},  # missing id
            {"id": "also_good", "song": "Also Good"},
        ]
        result = parse_songs_response(raw)
        assert len(result) == 2


# ── Search parsing ────────────────────────────────────────────────────────────


class TestSearchParser:
    def test_parse_search(self):
        raw = _load_fixture("search.json")
        result = parse_search_raw(raw, "arijit")

        assert result["query"] == "arijit"
        assert len(result["songs"]) == 2
        assert result["songs"][0]["id"] == "search_song1"
        assert result["songs"][0]["type"] == "song"
        assert len(result["albums"]) == 1
        assert len(result["artists"]) == 1
        assert len(result["playlists"]) == 1
        # Image should be upgraded
        assert "500x500" in result["songs"][0]["image"]

    def test_empty_search(self):
        result = parse_search_raw({}, "empty")
        assert result["query"] == "empty"
        assert result["songs"] == []
        assert result["albums"] == []

    def test_search_not_dict_raises(self):
        with pytest.raises(ProviderBadResponse):
            parse_search_raw("not a dict", "q")


# ── Lyrics parsing ────────────────────────────────────────────────────────────


class TestLyricsParser:
    def test_parse_lyrics(self):
        raw = _load_fixture("lyrics.json")
        result = parse_lyrics_raw(raw, "lyrics789")

        assert result["id"] == "lyrics789"
        assert "Meri aashiqui ab tum hi ho" in result["plain"]
        assert result["snippet"] == "Meri aashiqui ab tum hi ho"
        assert "Mithoon" in result["copyright_text"]

    def test_lyrics_not_dict_raises(self):
        with pytest.raises(ProviderBadResponse):
            parse_lyrics_raw([], "id")


# ── Album parsing ─────────────────────────────────────────────────────────────


class TestAlbumParser:
    def test_parse_album(self):
        raw = {
            "albumid": "alb1",
            "title": "Test Album",
            "year": "2023",
            "language": "hindi",
            "image": "https://c.saavncdn.com/123/50x50.jpg",
            "perma_url": "https://www.jiosaavn.com/album/test/abc",
            "primary_artists": "Artist 1",
            "list_count": "3",
            "songs": [
                {"id": "s1", "song": "S1"},
                {"id": "s2", "song": "S2"},
            ],
        }
        result = parse_album_raw(raw)
        assert result["id"] == "alb1"
        assert result["title"] == "Test Album"
        assert len(result["songs"]) == 2
        assert "500x500" in result["image"]

    def test_album_missing_id_raises(self):
        with pytest.raises(ProviderSchemaChanged):
            parse_album_raw({"title": "No ID"})

    def test_album_malformed_tracks_tolerated(self):
        """Malformed tracks in an album should be skipped, not crash parsing."""
        raw = {
            "albumid": "alb_partial",
            "title": "Partial",
            "songs": [
                {"id": "ok_song", "song": "OK"},
                {"bad": True},  # missing id — will be skipped
            ],
        }
        result = parse_album_raw(raw)
        assert len(result["songs"]) == 1
        assert result["songs"][0]["id"] == "ok_song"
