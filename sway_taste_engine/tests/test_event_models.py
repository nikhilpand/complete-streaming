"""
Tests for event telemetry, feature provenance, 3-tier identity, and multi-horizon taste models.
Phase 0: Contract Freeze.
"""

from datetime import datetime, timezone
import pytest
from sway_taste_engine.models import (
    EventType,
    FeatureValue,
    ArtistRole,
    Track,
    UserEvent,
    HorizonTasteState,
    SessionTasteState,
    NegativeMemoryState,
    UserTasteProfile,
    ScoreBreakdown,
)


def test_feature_value_provenance():
    # Unmeasured feature has None and 0.0 confidence
    f_unmeasured = FeatureValue[float]()
    assert f_unmeasured.value is None
    assert f_unmeasured.source == "unmeasured"
    assert f_unmeasured.confidence == 0.0

    # Measured feature with provenance
    f_measured = FeatureValue[float](value=0.72, source="audio_dsp", confidence=0.88)
    assert f_measured.value == 0.72
    assert f_measured.source == "audio_dsp"
    assert f_measured.confidence == 0.88


def test_track_feature_provenance_and_zero_fake_defaults():
    # Track created without fake energy or fake bpm
    t = Track(
        id="track_123",
        title="Tu Chahiye",
        artist_id="atif_aslam",
        artist_name="Atif Aslam",
        artists=[
            ArtistRole(id="atif_aslam", name="Atif Aslam", role="singer"),
            ArtistRole(id="pritam", name="Pritam", role="composer"),
        ],
        album_id="bajrangi_bhaijaan",
        album_name="Bajrangi Bhaijaan",
        year=2015,
        duration_ms=273000,
        language="hindi",
        composers=["Pritam"],
    )

    assert t.title == "Tu Chahiye"
    assert len(t.artists) == 2
    assert t.artists[0].role == "singer"
    assert t.artists[1].role == "composer"
    assert t.composers == ["Pritam"]
    assert t.year == 2015

    # Crucial: Unmeasured energy and bpm must be None, NOT fake 0.7 or 105
    assert t.energy is None
    assert t.bpm is None
    assert t.energy_feature.value is None
    assert t.energy_feature.confidence == 0.0


def test_user_event_3_tier_identity_and_milestones():
    # Full 3-tier identity: account_id, anonymous_id (UUID), session_id
    ev = UserEvent(
        event_id="evt_001",
        user_id="user_acct_42",
        account_id="user_acct_42",
        anonymous_id="anon-uuid-550e8400-e29b-41d4-a716-446655440000",
        session_id="sess_20260925_999",
        event_type=EventType.PLAY_30S,
        track_id="track_123",
        position_ms=30000,
        duration_ms=273000,
    )

    assert ev.account_id == "user_acct_42"
    assert ev.anonymous_id.startswith("anon-uuid-")
    assert ev.session_id.startswith("sess_")
    assert ev.event_type == EventType.PLAY_30S

    # Guest user without account_id: user_id falls back to anonymous_id
    guest_ev = UserEvent(
        event_id="evt_002",
        user_id="anon-uuid-1234",
        anonymous_id="anon-uuid-1234",
        session_id="sess_20260925_888",
        event_type=EventType.SKIP_LT_10S,
        track_id="track_999",
        position_ms=4500,
        duration_ms=210000,
    )
    assert guest_ev.account_id is None
    assert guest_ev.user_id == "anon-uuid-1234"
    assert guest_ev.event_type == EventType.SKIP_LT_10S


def test_user_taste_profile_multi_horizon_structure():
    profile = UserTasteProfile(user_id="user_test_1")

    # Verify structured sub-states exist
    assert isinstance(profile.long_term, HorizonTasteState)
    assert isinstance(profile.recent_30d, HorizonTasteState)
    assert isinstance(profile.session_state, SessionTasteState)
    assert isinstance(profile.negative_memory, NegativeMemoryState)

    # Verify backward-compatibility accessors
    profile.artist["atif_aslam"] = profile.artist.get("atif_aslam") or profile._make_bucket()
    profile.artist["atif_aslam"].positive += 3.0
    assert profile.artist["atif_aslam"].positive == 3.0

    # Negative memory isolation
    profile.negative_memory.explicit_negative_tracks.add("bad_track_1")
    assert "bad_track_1" in profile.explicit_negative_tracks


def test_score_breakdown_schema():
    sb = ScoreBreakdown(
        total=0.865,
        components={
            "taste": 0.35,
            "session_fit": 0.22,
            "similarity": 0.20,
            "novelty": 0.05,
            "freshness": 0.045,
        },
        explanation_type="track_similarity",
        explanation_label="Because you listened to Tu Chahiye",
        reference_track_id="track_123",
        reference_artist_id="atif_aslam",
        negative_checks_passed=True,
    )

    assert sb.total == 0.865
    assert sb.components["similarity"] == 0.20
    assert sb.negative_checks_passed is True
    assert sb.reference_track_id == "track_123"
