"""
Ultra-hardcore, extreme edge-case test suite for Sway Taste Engine.

Covers:
  - normalizer.py: Extreme unicode, scripts, emoji, nested/malformed brackets,
    derivative track fuzzing, 3-tier identity resolution, division-by-zero,
    boundary timestamps, and canonical key consistency.
  - mix_planner.py: Pathological catalogs (empty, single-track, 1000s of tracks,
    single-artist monopolization, corrupted artwork/IDs, explicit negatives,
    composition-level deduplication across and within shelves).
  - queue_planner.py: Extreme energy transitions (NaN/None/boundary), missing features,
    negative memory filtering, anti-clustering across surfaces, candidate pool exhaustion.
  - profile.py & metadata.py: Rapid event ingestion, stage transitions (cold -> warm -> mature),
    half-life decay extremes, high-confidence skip thresholds, factual feature extraction.
  - storage.py: SQLite SQL-injection resilience, malformed strings, batch stress, idempotency.
"""

from __future__ import annotations

import math
import os
import tempfile
from datetime import datetime, timedelta, timezone
import pydantic
import pytest

from sway_taste_engine import (
    EventType,
    FeedType,
    PersonalizationState,
    RecommendationContext,
    RecommendationEngine,
    SQLiteTasteStore,
    Track,
    UserEvent,
)
from sway_taste_engine.config import DecayConfig, QueueWeights, RecommendationWeights
from sway_taste_engine.metadata import clean_track_id, extract_track_features, extract_year, normalize_role
from sway_taste_engine.mix_planner import MixPlanner, get_track_canonical_key
from sway_taste_engine.models import ArtistRole, UserTasteProfile, utcnow
from sway_taste_engine.normalizer import (
    DERIVATIVE_PATTERNS,
    EventNormalizer,
    canonical_song_key,
    extract_artists,
    is_derivative_track,
    normalize_artist,
    normalize_title,
)
from sway_taste_engine.profile import TasteProfileBuilder
from sway_taste_engine.queue_planner import QueuePlanner


# ============================================================================
# 1. NORMALIZER HARDCORE EDGE CASES & FUZZING
# ============================================================================


class TestNormalizerHardcore:
    """Extreme edge case tests for title and artist normalization."""

    def test_normalize_title_none_empty_whitespace(self):
        assert normalize_title(None) == ""
        assert normalize_title("") == ""
        assert normalize_title("   \t\n  \r\n  ") == ""
        assert normalize_title("\u00a0\u200b\u200c\u200d") == ""

    def test_normalize_title_multilingual_scripts(self):
        # Arabic
        arabic = normalize_title("حبيبي (Official Video)")
        assert "official" not in arabic
        assert len(arabic) > 0

        # Japanese
        japanese = normalize_title("残酷な天使のテーゼ [Remastered 2020]")
        assert "remastered" not in japanese
        assert len(japanese) > 0

        # Chinese
        chinese = normalize_title("夜曲 (feat. 歌手)")
        assert "夜曲" in chinese
        assert "feat" not in chinese

        # Cyrillic
        cyrillic = normalize_title("Катюша - Deluxe Audio")
        assert "катюша" in cyrillic
        assert "deluxe" not in cyrillic

        # Devanagari with version tags stripped
        hindi = normalize_title("गाने (From Aashiqui 2)")
        assert "aashiqui" not in hindi
        assert len(hindi) > 0

    def test_normalize_title_emojis_and_special_chars(self):
        raw = "🔥🎶 Dilbar (Official Music Video) 💃✨"
        cleaned = normalize_title(raw)
        assert "dilbar" in cleaned
        assert "official" not in cleaned
        # Punctuation/symbols stripped into clean spaces
        assert not any(p in cleaned for p in "[](){}-_!@#$%^&*")

    def test_normalize_title_nested_and_broken_brackets(self):
        # Deeply nested brackets
        raw = "Song Title ((([feat. Drake] (from Movie) [official audio] {remastered 2024}))))"
        norm = normalize_title(raw)
        assert norm == "song title"

        # Unclosed brackets
        assert "song title" in normalize_title("Song Title (feat. Drake")
        assert "song title" in normalize_title("Song Title [Official")
        assert "song title" in normalize_title("Song Title {Lyrics")

        # Multi-dash sequences
        raw_dash = "Main Title - Single - Remastered - Deluxe - 2020 - Audio"
        norm_dash = normalize_title(raw_dash)
        assert norm_dash == "main title"

    def test_normalize_title_massive_string(self):
        giant = "A" * 10000 + " (Official Video) - Single"
        norm = normalize_title(giant)
        assert len(norm) == 10000
        assert norm.isupper() is False

    def test_extract_artists_separator_variations(self):
        dots = ["\u00b7", "\u2022", "\u2023", "\u25e6", "\u2043", "\u2219", "•", "·", "|"]
        for d in dots:
            raw = f"Arijit Singh {d} Pritam {d} Amitabh Bhattacharya"
            artists = extract_artists(raw)
            assert "arijit singh" in artists

    def test_extract_artists_disambiguation_with_title_and_album(self):
        # Case: "Artist · Title" format in subtitle
        arts1 = extract_artists(
            artist_name="",
            subtitle="Ravyn Lenae · Love Me Not",
            title="Love Me Not",
            album="Bird's Eye",
        )
        assert "ravyn lenae" in arts1
        assert "love me not" not in arts1

        # Case: "Title · Artist" format in subtitle
        arts2 = extract_artists(
            artist_name="",
            subtitle="Love Me Not · Ravyn Lenae",
            title="Love Me Not",
            album="Bird's Eye",
        )
        assert "ravyn lenae" in arts2
        assert "love me not" not in arts2

        # Case: "Album · Artist" format in subtitle
        arts3 = extract_artists(
            artist_name="",
            subtitle="Veer-Zaara · Madan Mohan",
            title="Tere Liye",
            album="Veer-Zaara",
        )
        assert "madan mohan" in arts3
        assert "veer zaara" not in arts3

    def test_extract_artists_blacklisted_and_junk(self):
        junk_list = ["sub artist", "unknown", "unknown artist", "none", "null", "track 01"]
        for junk in junk_list:
            assert extract_artists(junk) == []

    def test_canonical_song_key_invariance(self):
        # Order of artists in raw string should yield the exact same canonical key
        key1 = canonical_song_key("Tum Hi Ho", "Arijit Singh, Mithoon")
        key2 = canonical_song_key("Tum Hi Ho", "Mithoon, Arijit Singh")
        assert key1 == key2

        # Subtitle vs artist_name normalization
        key3 = canonical_song_key("Tum Hi Ho", "", subtitle="Arijit Singh · Mithoon")
        assert key3[0] == "tum hi ho"


class TestDerivativePatternExclusion:
    """Stress tests for detecting derivative / altered uploads."""

    DERIVATIVE_TEST_CASES = [
        ("Kesariya - Sped Up", "Pritam"),
        ("Kesariya (Speed Up Version)", "Pritam"),
        ("Tum Hi Ho (Slowed + Reverb)", "Arijit Singh"),
        ("Channa Mereya (Slowed)", "Pritam"),
        ("Apna Bana Le [Reverb]", "Arijit Singh"),
        ("Raataan Lambiyan - 8D Audio", "Tanishk Bagchi"),
        ("Raataan Lambiyan (16D Audio)", "Tanishk Bagchi"),
        ("Pasoori - Nightcore", "Ali Sethi"),
        ("Believer - Workout Remix", "Imagine Dragons"),
        ("Shape of You (128 BPM Workout)", "Ed Sheeran"),
        ("140 bpm cardio mix", "Fitness"),
        ("Kal Ho Naa Ho (Karaoke Version)", "Shankar-Ehsaan-Loy"),
        ("Tum Hi Ho (Instrumental)", "Mithoon"),
        ("Pee Loon (Cover)", "Acoustic Singer"),
        ("Ilahi (Tribute to Ranbir)", "Various"),
        ("Kabira (Unplugged Remix)", "Pritam"),
        ("Dheere Dheere (Drum Version)", "Yo Yo Honey Singh"),
        ("Subhanallah (Piano Version)", "Pritam"),
        ("Bollywood Mashup 2024", "DJ Chetas"),
        ("Chaiyya Chaiyya (Lo-Fi Flip)", "Lofi Music"),
        ("Tera Yaar Hoon Main (Lofi Mix)", "Chillhop"),
    ]

    @pytest.mark.parametrize("title,artist", DERIVATIVE_TEST_CASES)
    def test_all_derivatives_detected(self, title, artist):
        assert is_derivative_track(title, artist) is True, f"Failed to detect derivative: {title} by {artist}"

    def test_legitimate_tracks_not_flagged(self):
        legitimate = [
            ("Speed of Sound", "Coldplay"),  # "speed" alone doesn't trigger "sped up" or "speed up"
            ("Godspeed", "Frank Ocean"),
            ("Cover Me In Sunshine", "P!nk"),  # "cover" alone doesn't trigger cover version
            ("Under Cover of Darkness", "The Strokes"),
            ("Cover Girl", "Big Time Rush"),
            ("Night Changes", "One Direction"),  # "night" doesn't trigger "nightcore"
            ("Piano Man", "Billy Joel"),  # "piano" doesn't trigger "piano version"
            ("Rolling in the Deep", "Adele"),
            ("Starboy", "The Weeknd"),
            ("Die For You", "The Weeknd"),
        ]
        for title, artist in legitimate:
            assert is_derivative_track(title, artist) is False, f"Falsely flagged legitimate track: {title}"


class TestEventNormalizerHardcore:
    """Edge cases for EventNormalizer telemetry ingestion."""

    def test_identity_fallback_when_all_ids_missing(self):
        norm = EventNormalizer()
        raw = {"event_type": "play_completed", "track_id": "t1"}
        ev = norm.normalize(raw)
        assert ev.user_id.startswith("anon-")
        assert ev.anonymous_id == ev.user_id
        assert ev.account_id is None

    def test_division_by_zero_safe(self):
        norm = EventNormalizer()
        # Zero duration safely computes without ZeroDivisionError
        ev0 = norm.normalize({
            "event_id": "ev_0",
            "user_id": "u1",
            "event_type": "progress",
            "position_ms": 5000,
            "duration_ms": 0,
        })
        assert ev0.completion_ratio is None or ev0.completion_ratio == 0.0

    def test_negative_values_rejected_by_model(self):
        norm = EventNormalizer()
        # Negative duration/position triggers strict Pydantic validation
        with pytest.raises(pydantic.ValidationError):
            norm.normalize({
                "event_id": "ev_neg",
                "user_id": "u1",
                "event_type": "progress",
                "position_ms": -500,
                "duration_ms": -1000,
            })

    def test_position_greater_than_duration_clamped(self):
        norm = EventNormalizer()
        ev = norm.normalize({
            "event_id": "ev_clamp",
            "user_id": "u1",
            "event_type": "progress",
            "position_ms": 250000,
            "duration_ms": 200000,
        })
        assert ev.completion_ratio == 1.0

    def test_malformed_timestamp_string_fallback(self):
        norm = EventNormalizer()
        ev = norm.normalize({
            "event_id": "ev_ts",
            "user_id": "u1",
            "event_type": "like",
            "timestamp": "this_is_not_an_iso_timestamp",
        })
        assert isinstance(ev.timestamp, datetime)
        assert ev.timestamp.tzinfo is not None

    def test_unknown_event_type_fallback(self):
        norm = EventNormalizer()
        ev = norm.normalize({
            "event_id": "ev_unk",
            "user_id": "u1",
            "event_type": "alien_telemetry_event_v999",
        })
        assert ev.event_type == EventType.PROGRESS


# ============================================================================
# 2. MIX PLANNER HARDCORE CATALOG & COMPOSITION DEDUPLICATION
# ============================================================================


class TestMixPlannerPathological:
    """Stress testing home feed planning under edge and pathological catalog states."""

    @pytest.fixture
    def planner(self):
        return MixPlanner()

    @pytest.fixture
    def empty_profile(self):
        return UserTasteProfile(user_id="test_user", personalization_state=PersonalizationState.COLD)

    def _make_track(self, tid: str, artist: str = "Arijit Singh", title: str = "Song", pop: float = 0.8) -> Track:
        return Track(
            id=tid,
            title=f"{title} {tid}",
            artist_id=artist.lower().replace(" ", "_"),
            artist_name=artist,
            artists=[ArtistRole(id=artist.lower().replace(" ", "_"), name=artist, role="primary")],
            album="Test Album",
            duration_ms=210000,
            popularity=pop,
            artwork_url=f"https://c.saavncdn.com/{tid}.jpg",
            genres=["pop"],
            moods=["chill"],
            energy=0.6,
            provider_available={"saavn": True},
        )

    def test_empty_catalog_returns_empty_shelves(self, planner, empty_profile):
        shelves = planner.plan_home_feed(empty_profile, [])
        assert shelves == []

    def test_single_track_catalog(self, planner, empty_profile):
        single = self._make_track("t1")
        shelves = planner.plan_home_feed(empty_profile, [single])
        assert len(shelves) > 0
        total_items = sum(len(s.items) for s in shelves)
        assert total_items == 1
        assert shelves[0].items[0].id == "t1"

    def test_single_artist_monopolization_capped(self, planner, empty_profile):
        # 50 tracks all by the exact same artist
        catalog = [self._make_track(f"t_{i}", artist="Arijit Singh", pop=float(i) / 50.0) for i in range(50)]
        shelves = planner.plan_home_feed(empty_profile, catalog, limit_per_shelf=10)
        # Every shelf must strictly cap the artist at max_per_artist (2)
        for shelf in shelves:
            assert len(shelf.items) <= 2
            for item in shelf.items:
                assert item.artist_name == "Arijit Singh"

    def test_zero_derivative_leakage_into_shelves(self, planner, empty_profile):
        derivatives = [
            self._make_track("d1", "Arijit Singh", "Tum Hi Ho (Sped Up)"),
            self._make_track("d2", "Pritam", "Kesariya - Slowed + Reverb"),
            self._make_track("d3", "Tanishk Bagchi", "Raataan Lambiyan - 8D Audio"),
            self._make_track("d4", "Various", "Bollywood Workout 130 BPM"),
        ]
        legitimate = [
            self._make_track("l1", "Arijit Singh", "Tum Hi Ho"),
            self._make_track("l2", "Pritam", "Kesariya"),
            self._make_track("l3", "Tanishk Bagchi", "Raataan Lambiyan"),
        ]
        catalog = derivatives + legitimate
        shelves = planner.plan_home_feed(empty_profile, catalog)
        all_planned_ids = [item.id for s in shelves for item in s.items]

        # Derivatives must be 100% excluded
        for d in derivatives:
            assert d.id not in all_planned_ids

        # Legitimate tracks must be included
        assert "l1" in all_planned_ids

    def test_strict_cross_shelf_and_within_shelf_deduplication(self, planner, empty_profile):
        # Create catalog with duplicate titles, duplicate canonical keys, and distinct IDs
        catalog = []
        for i in range(30):
            catalog.append(self._make_track(f"unique_{i}", artist=f"Artist {i % 10}", title=f"Track {i}"))

        # Add duplicate songs with different IDs
        duplicate_dup1 = self._make_track("dup_1", artist="Artist 0", title="Track 0")
        duplicate_dup2 = self._make_track("dup_2", artist="Artist 0", title="Track 0 (Remastered)")
        catalog.extend([duplicate_dup1, duplicate_dup2])

        shelves = planner.plan_home_feed(empty_profile, catalog, limit_per_shelf=8)

        seen_ids = set()
        seen_keys = set()
        seen_titles = set()

        for shelf in shelves:
            for item in shelf.items:
                assert item.id not in seen_ids, f"Duplicate ID: {item.id}"
                seen_ids.add(item.id)

                key = get_track_canonical_key(item)
                assert key not in seen_keys, f"Duplicate canonical song key: {key}"
                seen_keys.add(key)

                norm_t = normalize_title(item.title)
                assert norm_t not in seen_titles, f"Duplicate normalized title: {norm_t}"
                seen_titles.add(norm_t)

    def test_unplayable_and_missing_artwork_filtered(self, planner, empty_profile):
        bad_tracks = [
            Track(id="unplayable_1", title="No Media", artist_id="a1", artist_name="A1", artwork_url="https://c.jpg", provider_available={"saavn": False}),
            Track(id="no_art_1", title="No Art", artist_id="a2", artist_name="A2", artwork_url="", provider_available={"saavn": True}),
            Track(id="debug_1", title="Debug Track", artist_id="a3", artist_name="A3", artwork_url="https://c.jpg", provider_available={"saavn": True}),
            Track(id="sample_1", title="Sample Track 1", artist_id="a4", artist_name="A4", artwork_url="https://c.jpg", provider_available={"saavn": True}),
        ]
        good_track = self._make_track("good_1", "Real Artist", "Real Song")
        shelves = planner.plan_home_feed(empty_profile, bad_tracks + [good_track])
        planned_ids = [item.id for s in shelves for item in s.items]
        assert planned_ids == ["good_1"]

    def test_large_catalog_stress_performance(self, planner, empty_profile):
        large_catalog = [
            self._make_track(f"stress_{i}", artist=f"Artist {i % 25}", title=f"Title {i}", pop=float(i % 100) / 100.0)
            for i in range(2000)
        ]
        start_ts = datetime.now()
        shelves = planner.plan_home_feed(empty_profile, large_catalog, limit_per_shelf=10)
        duration_sec = (datetime.now() - start_ts).total_seconds()

        assert len(shelves) > 0
        assert duration_sec < 2.0, f"Mix planning took too long: {duration_sec}s for 2000 tracks"


# ============================================================================
# 3. QUEUE PLANNER HARDCORE SEQUENCE CONTINUITY & CONSTRAINTS
# ============================================================================


class TestQueuePlannerHardcore:
    """Extreme edge case tests for QueuePlanner."""

    @pytest.fixture
    def queue_planner(self):
        return QueuePlanner()

    @pytest.fixture
    def profile(self):
        return UserTasteProfile(user_id="queue_user")

    def _track(self, tid: str, artist: str, title: str = "", energy: float | None = 0.5, moods=None, genres=None) -> Track:
        return Track(
            id=tid,
            title=title or f"Song {tid}",
            artist_id=artist.lower().replace(" ", "_"),
            artist_name=artist,
            energy=energy,
            moods=moods or ["chill"],
            genres=genres or ["pop"],
            artwork_url="https://c.jpg",
            provider_available={"saavn": True},
        )

    def test_missing_and_extreme_energies(self, queue_planner, profile):
        curr = self._track("curr", "Artist A", energy=None)
        cands = [
            self._track("c1", "Artist B", energy=None),
            self._track("c2", "Artist C", energy=0.0),
            self._track("c3", "Artist D", energy=1.0),
        ]
        seq = queue_planner.plan_next(curr, cands, profile, count=3)
        assert len(seq) == 3
        assert {t.id for t in seq} == {"c1", "c2", "c3"}

    def test_negative_memory_tracks_strictly_excluded(self, queue_planner, profile):
        curr = self._track("curr", "Artist A", energy=0.5)
        bad_track = self._track("bad_1", "Artist B", energy=0.5)
        good_track = self._track("good_1", "Artist C", energy=0.5)

        profile.explicit_negative_tracks.add("bad_1")
        profile.negative_memory.high_confidence_skips.add("bad_1")

        seq = queue_planner.plan_next(curr, [bad_track, good_track], profile, count=5)
        assert seq == [good_track]

    def test_derivative_candidate_excluded_unless_current_is_derivative(self, queue_planner, profile):
        curr_original = self._track("orig_curr", "Arijit Singh", title="Tum Hi Ho", energy=0.5)
        deriv_cand = self._track("deriv_cand", "Atif Aslam", title="Woh Lamhe (Sped Up)", energy=0.5)
        clean_cand = self._track("clean_cand", "Pritam", title="Kesariya", energy=0.5)

        # When current is original, derivative candidate must be excluded
        seq1 = queue_planner.plan_next(curr_original, [deriv_cand, clean_cand], profile, count=5)
        assert deriv_cand not in seq1
        assert clean_cand in seq1

        # When current track IS derivative, derivative candidates are permitted
        curr_derivative = self._track("curr_deriv", "Arijit Singh", title="Tum Hi Ho (Slowed + Reverb)", energy=0.5)
        seq2 = queue_planner.plan_next(curr_derivative, [deriv_cand, clean_cand], profile, count=5)
        assert deriv_cand in seq2

    def test_surface_specific_anti_clustering(self, queue_planner, profile):
        curr = self._track("curr", "Arijit Singh")
        cands = [
            self._track("a1", "Arijit Singh"),
            self._track("a2", "Arijit Singh"),
            self._track("a3", "Arijit Singh"),
            self._track("b1", "Mohit Chauhan"),
            self._track("b2", "KK"),
        ]

        # In "queue" mode: first pick cannot be the same artist when alternates exist
        seq_queue = queue_planner.plan_next(curr, cands, profile, count=5, surface="queue")
        assert seq_queue[0].artist_name != "Arijit Singh"

        # In "artist_radio" mode: consecutive same artist can be up to 3
        seq_radio = queue_planner.plan_next(curr, cands, profile, count=5, surface="artist_radio")
        assert len(seq_radio) == 5

    def test_cyclical_and_identical_candidate_exhaustion(self, queue_planner, profile):
        curr = self._track("curr", "Artist A", title="Song Curr")
        dup1 = self._track("curr", "Artist A", title="Song Curr")
        dup2 = self._track("saavn:curr", "Artist A", title="Song Curr")
        seq = queue_planner.plan_next(curr, [dup1, dup2], profile, count=5)
        assert seq == []


# ============================================================================
# 4. PROFILE EVOLUTION & METADATA HARDCORE
# ============================================================================


class TestProfileEvolutionAndMetadata:
    """Stress tests for taste profile building, time decay, and metadata extraction."""

    def test_stage_evolution_cold_to_warm_to_mature(self):
        builder = TasteProfileBuilder()
        catalog = {
            f"t_{i}": Track(
                id=f"t_{i}",
                title=f"Song {i}",
                artist_id="arijit_singh",
                artist_name="Arijit Singh",
                artwork_url="https://c.jpg",
                genres=["bollywood"],
                moods=["romantic"],
            )
            for i in range(50)
        }

        # 0 events -> COLD
        p0 = builder.build("u1", [], catalog)
        assert p0.personalization_state == PersonalizationState.COLD

        # 3 play events -> WARM / LEARNING / SEEDED
        events_warm = [
            UserEvent(event_id=f"e_{i}", user_id="u1", event_type=EventType.COMPLETED, track_id=f"t_{i}")
            for i in range(3)
        ]
        p_warm = builder.build("u1", events_warm, catalog)
        assert p_warm.personalization_state in (PersonalizationState.SEEDED, PersonalizationState.LEARNING)

        # 25 events -> PERSONALIZED / MATURE
        events_mature = [
            UserEvent(event_id=f"e_{i}", user_id="u1", event_type=EventType.COMPLETED, track_id=f"t_{i}")
            for i in range(25)
        ]
        p_mature = builder.build("u1", events_mature, catalog)
        assert p_mature.personalization_state == PersonalizationState.PERSONALIZED

    def test_high_confidence_skip_detection(self):
        builder = TasteProfileBuilder()
        catalog = {
            "skip_track": Track(
                id="skip_track",
                title="Skipped Song",
                artist_id="annoying_artist",
                artist_name="Annoying Artist",
                artwork_url="https://c.jpg",
            )
        }
        skip_events = [
            UserEvent(event_id=f"s_{i}", user_id="u1", event_type=EventType.SKIP_LT_10S, track_id="skip_track")
            for i in range(3)
        ]
        profile = builder.build("u1", skip_events, catalog)
        assert "skip_track" in profile.negative_memory.high_confidence_skips

    def test_half_life_decay_extremes(self):
        builder = TasteProfileBuilder(half_life_days=7.0)
        f_today = builder._decay_factor(0.0, 7.0)
        assert f_today == 1.0

        f_7d = builder._decay_factor(7.0, 7.0)
        assert pytest.approx(f_7d, rel=1e-3) == 0.5

        f_70d = builder._decay_factor(70.0, 7.0)
        assert f_70d < 0.001

        f_future = builder._decay_factor(-5.0, 7.0)
        assert f_future == 1.0

    def test_extract_track_features_resilience(self):
        t_empty = extract_track_features({})
        assert t_empty.id == "unknown"
        assert t_empty.title == "Track"

        t_none = extract_track_features({
            "id": None,
            "title": None,
            "artists": None,
            "extra": None,
            "duration_ms": None,
        })
        assert t_none.title == "Track"

        assert extract_year(2024) == 2024
        assert extract_year("2024") == 2024
        assert extract_year("Release Date: 15-08-2021") == 2021
        assert extract_year("invalid") is None
        assert extract_year(1850) is None
        assert extract_year(2150) is None


# ============================================================================
# 5. SQLITE STORAGE RESILIENCE & SQL INJECTION
# ============================================================================


class TestSQLiteStorageHardcore:
    """Stress tests and SQL injection payloads on SQLiteTasteStore."""

    @pytest.fixture
    def temp_db_path(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        yield path
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    @pytest.fixture
    def store(self, temp_db_path):
        return SQLiteTasteStore(temp_db_path)

    def test_sql_injection_in_track_and_user_ids(self, store):
        injection_ids = [
            "'; DROP TABLE tracks; --",
            "' OR '1'='1",
            "admin'--",
            "1; SELECT * FROM sqlite_master;",
            "\" OR \"\"=\"",
        ]
        for inj in injection_ids:
            t = Track(
                id=inj,
                title=f"Injected Title {inj}",
                artist_id="injected_artist",
                artist_name="Injected Artist",
                artwork_url="https://c.jpg",
                provider_available={"saavn": True},
            )
            store.upsert_track(t)
            retrieved = store.get_track(inj)
            assert retrieved is not None
            assert retrieved.id == inj

        all_tracks = store.all_tracks()
        assert len(all_tracks) == len(injection_ids)

    def test_idempotent_event_logging(self, store):
        ev = UserEvent(
            event_id="unique_ev_123",
            user_id="user_1",
            event_type=EventType.LIKE,
            track_id="track_1",
        )
        assert store.add_event(ev) is True
        assert store.add_event(ev) is False

    def test_large_batch_tracks_upsert(self, store):
        tracks = [
            Track(
                id=f"batch_t_{i}",
                title=f"Batch Song {i}",
                artist_id=f"artist_{i % 10}",
                artist_name=f"Artist {i % 10}",
                artwork_url="https://c.jpg",
                popularity=float(i % 100) / 100.0,
            )
            for i in range(500)
        ]
        store.upsert_tracks(tracks)
        all_retrieved = store.all_tracks()
        assert len(all_retrieved) == 500
