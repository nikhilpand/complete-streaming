"""
Unit tests for the normaliser: parser DTO → canonical SWAY models.
"""

import pytest

from app.providers.saavn.normaliser import (
    PROVIDER,
    norm_artist_ref,
    norm_lyrics,
    norm_search,
    norm_song,
)


class TestNormSong:
    def test_id_is_namespaced(self):
        parsed = {
            "id": "test123",
            "title": "Test Song",
            "primary_artists": [],
            "featured_artists": [],
        }
        song = norm_song(parsed)
        assert song.id == f"{PROVIDER}:test123"
        assert song.provider == PROVIDER
        assert song.provider_id == "test123"

    def test_artists_normalised(self):
        parsed = {
            "id": "s1",
            "title": "S1",
            "primary_artists": [
                {"id": "a1", "name": "Artist 1", "role": "singer"},
            ],
            "featured_artists": [],
        }
        song = norm_song(parsed)
        assert len(song.artists) == 1
        assert song.artists[0].id == f"{PROVIDER}:a1"
        assert song.artists[0].name == "Artist 1"

    def test_media_not_in_song(self):
        """Song model must NOT contain download_urls or streams."""
        parsed = {
            "id": "s1",
            "title": "S1",
            "has_media": True,
            "encrypted_media_url": "encrypted",
            "primary_artists": [],
            "featured_artists": [],
        }
        song = norm_song(parsed)
        assert song.has_media is True
        # Verify Song model has no download_urls attribute
        assert not hasattr(song, "download_urls")
        assert not hasattr(song, "streams")

    def test_optional_fields_default_none(self):
        parsed = {
            "id": "minimal",
            "title": "Min",
            "primary_artists": [],
            "featured_artists": [],
        }
        song = norm_song(parsed)
        assert song.album is None
        assert song.duration_ms is None
        assert song.lyrics_id is None


class TestNormSearch:
    def test_search_items_namespaced(self):
        parsed = {
            "query": "test",
            "songs": [
                {"id": "s1", "type": "song", "title": "Song 1"},
            ],
            "albums": [],
            "artists": [],
            "playlists": [],
        }
        result = norm_search(parsed)
        assert result.query == "test"
        assert len(result.songs) == 1
        assert result.songs[0].id == f"{PROVIDER}:s1"
        assert result.songs[0].provider == PROVIDER

    def test_empty_search(self):
        parsed = {"query": "q", "songs": [], "albums": [], "artists": [], "playlists": []}
        result = norm_search(parsed)
        assert result.total_songs == 0


class TestNormLyrics:
    def test_lyrics_normalised(self):
        parsed = {
            "id": "lyr1",
            "plain": "Some lyrics text",
            "snippet": "Some lyrics",
            "copyright_text": "(c) 2024",
        }
        lyrics = norm_lyrics(parsed, "lyr1")
        assert lyrics.id == f"{PROVIDER}:lyr1"
        assert lyrics.provider == PROVIDER
        assert lyrics.plain == "Some lyrics text"
        assert lyrics.synced is None  # JioSaavn doesn't provide synced lyrics
