from __future__ import annotations

import math
from datetime import datetime, timezone, timedelta
import pytest
from sway_taste_engine.config import DecayConfig
from sway_taste_engine.models import (
    Track,
    ArtistRole,
    UserEvent,
    EventType,
    Bucket,
    UserTasteProfile,
)
from sway_taste_engine.profile import TasteProfileBuilder


@pytest.fixture
def catalog():
    return {
        "t_romantic": Track(
            id="t_romantic",
            title="Tu Chahiye",
            artists=[
                ArtistRole(id="a_atif", name="Atif Aslam", role="singer"),
                ArtistRole(id="a_pritam", name="Pritam", role="composer"),
            ],
            genres=["romantic", "bollywood"],
            moods=["romantic", "melancholy"],
            energy=0.45,
            duration_ms=272000,
        ),
        "t_party": Track(
            id="t_party",
            title="Subha Hone Na De",
            artists=[
                ArtistRole(id="a_pritam", name="Pritam", role="composer"),
            ],
            genres=["dance", "party"],
            moods=["energetic", "party"],
            energy=0.85,
            duration_ms=280000,
        ),
        "t_bad": Track(
            id="t_bad",
            title="Disliked Song",
            artists=[ArtistRole(id="a_bad", name="Bad Artist", role="singer")],
            genres=["pop"],
            energy=0.5,
        ),
    }


def test_dual_horizon_exponential_decay(catalog):
    # Config: 7-day half-life for rolling 30d, 60-day half-life for long-term
    decay_config = DecayConfig(
        rolling_days=30,
        rolling_half_life_days=7.0,
        long_term_half_life_days=60.0,
    )
    builder = TasteProfileBuilder(decay_config=decay_config)
    now = datetime.now(timezone.utc)

    # Event 14 days ago (completed play of Tu Chahiye)
    ev_14d_ago = UserEvent(
        event_id="ev_14",
        user_id="user_1",
        session_id="sess_old",
        event_type=EventType.COMPLETED,
        track_id="t_romantic",
        timestamp=now - timedelta(days=14),
        effective_weight=1.0,
        completion_ratio=1.0,
    )

    profile = builder.build("user_1", [ev_14d_ago], catalog, now=now)

    # 14 days ago with half-life = 7 days => decay factor = 2^(-14/7) = 2^(-2) = 0.25 (75% decay)
    recent_atif = profile.recent_30d.artist["a_atif"].positive
    # 14 days ago with half-life = 60 days => decay factor = 2^(-14/60) = 2^(-0.2333) ~ 0.8506
    long_atif = profile.long_term.artist["a_atif"].positive

    # Check that rolling decayed much faster than long-term
    assert recent_atif < long_atif
    # Expected ratio: recent / long ~ 0.25 / 0.8506 ~ 0.294
    ratio = recent_atif / long_atif
    assert math.isclose(ratio, 0.25 / (2 ** (-14.0 / 60.0)), rel_tol=0.05)


def test_rolling_30d_excludes_events_older_than_30_days(catalog):
    builder = TasteProfileBuilder()
    now = datetime.now(timezone.utc)

    # Event 45 days ago
    ev_45d_ago = UserEvent(
        event_id="ev_45",
        user_id="user_1",
        session_id="sess_very_old",
        event_type=EventType.COMPLETED,
        track_id="t_romantic",
        timestamp=now - timedelta(days=45),
        effective_weight=1.0,
        completion_ratio=1.0,
    )

    profile = builder.build("user_1", [ev_45d_ago], catalog, now=now)

    # Should be absent from recent_30d because > 30 days
    assert "a_atif" not in profile.recent_30d.artist
    # But present in long_term
    assert "a_atif" in profile.long_term.artist
    assert profile.long_term.artist["a_atif"].positive > 0


def test_immediate_negative_memory_isolation(catalog):
    builder = TasteProfileBuilder()
    now = datetime.now(timezone.utc)

    ev_dislike = UserEvent(
        event_id="ev_dislike",
        user_id="user_1",
        session_id="sess_1",
        event_type=EventType.DISLIKE,
        track_id="t_bad",
        timestamp=now,
    )
    ev_skip_fast = UserEvent(
        event_id="ev_skip",
        user_id="user_1",
        session_id="sess_1",
        event_type=EventType.SKIP_LT_10S,
        track_id="t_party",
        timestamp=now,
    )

    profile = builder.build("user_1", [ev_dislike, ev_skip_fast], catalog, now=now)

    # Check negative memory state
    assert "t_bad" in profile.negative_memory.explicit_negative_tracks
    assert "a_bad" in profile.negative_memory.explicit_negative_artists
    assert "t_party" in profile.negative_memory.high_confidence_skips

    # Backward compatibility accessors
    assert "t_bad" in profile.explicit_negative_tracks
    assert "a_bad" in profile.explicit_negative_artists


def test_session_state_updates(catalog):
    builder = TasteProfileBuilder()
    now = datetime.now(timezone.utc)

    ev1 = UserEvent(
        event_id="ev_sess_1",
        user_id="user_1",
        session_id="sess_today",
        event_type=EventType.COMPLETED,
        track_id="t_romantic",
        timestamp=now - timedelta(minutes=10),
    )
    ev2 = UserEvent(
        event_id="ev_sess_2",
        user_id="user_1",
        session_id="sess_today",
        event_type=EventType.COMPLETED,
        track_id="t_party",
        timestamp=now - timedelta(minutes=5),
    )

    profile = builder.build("user_1", [ev1, ev2], catalog, now=now)

    assert profile.session_state.session_id == "sess_today"
    assert "t_romantic" in profile.session_state.recent_tracks
    assert "t_party" in profile.session_state.recent_tracks
    # Mood tracking in session
    assert "romantic" in profile.session_state.active_moods
    assert "energetic" in profile.session_state.active_moods
    # Energy drift tracks recorded energies
    assert len(profile.session_state.energy_drift) == 2
    assert profile.session_state.energy_drift == [0.45, 0.85]
