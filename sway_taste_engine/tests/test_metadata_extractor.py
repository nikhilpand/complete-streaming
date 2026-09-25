from __future__ import annotations

from typing import Any
import pytest
from sway_taste_engine.metadata import extract_track_features
from sway_taste_engine.models import ArtistRole, FeatureValue, Track


class MockArtist:
    def __init__(self, id: str, name: str, role: str = "primary"):
        self.id = id
        self.name = name
        self.role = role


class MockSong:
    def __init__(
        self,
        id: str,
        title: str,
        artists: list[Any] | None = None,
        album: str | None = None,
        year: int | str | None = None,
        duration_ms: int | None = None,
        language: str | None = None,
        artwork_url: str | None = None,
        extra: dict[str, Any] | None = None,
    ):
        self.id = id
        self.provider_id = id
        self.title = title
        self.artists = artists or []
        self.album = album
        self.year = year
        self.duration_ms = duration_ms
        self.language = language
        self.artwork_url = artwork_url
        self.extra = extra or {}


def test_extract_factual_metadata_and_artist_roles():
    song = MockSong(
        id="saavn:tu_chahiye_123",
        title="Tu Chahiye",
        artists=[
            MockArtist(id="a_atif", name="Atif Aslam", role="singer"),
            MockArtist(id="a_pritam", name="Pritam", role="music"),
            MockArtist(id="a_amitabh", name="Amitabh Bhattacharya", role="lyricist"),
        ],
        album="Bajrangi Bhaijaan",
        year=2015,
        duration_ms=272000,
        language="Hindi",
        artwork_url="https://c.saavncdn.com/123/tu_chahiye_500x500.jpg",
    )

    track = extract_track_features(song)

    assert track.id == "tu_chahiye_123"
    assert track.title == "Tu Chahiye"
    assert track.album == "Bajrangi Bhaijaan"
    assert track.year == 2015
    assert track.duration_ms == 272000
    assert track.language == "hindi"
    assert track.artwork_url == "https://c.saavncdn.com/123/tu_chahiye_500x500.jpg"

    # Multi-artist role parsing
    assert len(track.artists) == 3
    assert track.artists[0].name == "Atif Aslam"
    assert track.artists[0].role in {"singer", "primary"}
    assert track.artists[1].name == "Pritam"
    assert track.artists[1].role == "composer"
    assert track.artists[2].name == "Amitabh Bhattacharya"
    assert track.artists[2].role == "lyricist"

    # Composers and lyricists lists populated
    assert "Pritam" in track.composers
    assert "Amitabh Bhattacharya" in track.lyricists


def test_zero_fake_defaults_unmeasured_provenance():
    song = MockSong(
        id="t_plain",
        title="Plain Track",
        artists=[MockArtist(id="a1", name="Artist One")],
    )

    track = extract_track_features(song)

    # Strictly verify zero synthetic constants (no energy=0.7 or bpm=105)
    assert track.energy is None
    assert track.bpm is None
    assert track.energy_feature.value is None
    assert track.energy_feature.source == "unmeasured"
    assert track.energy_feature.confidence == 0.0

    assert track.bpm_feature.value is None
    assert track.bpm_feature.source == "unmeasured"
    assert track.bpm_feature.confidence == 0.0


def test_title_tag_heuristics_with_explicit_provenance():
    song_party = MockSong(
        id="t_party",
        title="Party On My Mind (Club Remix)",
        artists=[MockArtist(id="a1", name="DJ Test")],
    )

    track_party = extract_track_features(song_party)
    assert "party" in track_party.moods or "energetic" in track_party.moods
    assert "dance" in track_party.genres or "remix" in track_party.genres


def test_dict_input_support():
    raw_dict = {
        "id": "dict_123",
        "title": "Jeena Jeena",
        "artists": [
            {"id": "a_atif", "name": "Atif Aslam", "role": "primary"},
            {"id": "a_sachin", "name": "Sachin-Jigar", "role": "music"},
        ],
        "album": "Badlapur",
        "year": "2015",
        "language": "HINDI",
    }

    track = extract_track_features(raw_dict)
    assert track.id == "dict_123"
    assert track.title == "Jeena Jeena"
    assert track.year == 2015
    assert track.language == "hindi"
    assert "Sachin-Jigar" in track.composers
