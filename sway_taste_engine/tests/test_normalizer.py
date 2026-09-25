from __future__ import annotations

import pytest
from sway_taste_engine.config import RecommendationWeights
from sway_taste_engine.models import EventType, UserEvent
from sway_taste_engine.normalizer import EventNormalizer


def test_normalizer_identity_resolution():
    normalizer = EventNormalizer()

    # Case 1: Logged-in user with account_id and anon_id
    raw1 = {
        "event_id": "ev_1",
        "account_id": "acc_nikhil",
        "anonymous_id": "anon-uuid-1234",
        "session_id": "sess_001",
        "event_type": "play_completed",
        "track_id": "track_tu_chahiye",
    }
    ev1 = normalizer.normalize(raw1)
    assert ev1.user_id == "acc_nikhil"
    assert ev1.account_id == "acc_nikhil"
    assert ev1.anonymous_id == "anon-uuid-1234"
    assert ev1.event_type == EventType.COMPLETED

    # Case 2: Guest user with only anonymous_id
    raw2 = {
        "event_id": "ev_2",
        "anonymous_id": "anon-uuid-5678",
        "session_id": "sess_002",
        "event_type": "skip_lt_10s",
        "track_id": "track_bad",
    }
    ev2 = normalizer.normalize(raw2)
    assert ev2.user_id == "anon-uuid-5678"
    assert ev2.account_id is None
    assert ev2.anonymous_id == "anon-uuid-5678"
    assert ev2.event_type == EventType.SKIP_LT_10S


def test_normalizer_default_calibrated_weights():
    normalizer = EventNormalizer()

    def get_weight(event_type: str, pos_ms: int = 0, dur_ms: int = 100000) -> float:
        ev = normalizer.normalize({
            "event_id": f"ev_{event_type}",
            "anonymous_id": "anon_1",
            "session_id": "sess_1",
            "event_type": event_type,
            "track_id": "t1",
            "position_ms": pos_ms,
            "duration_ms": dur_ms,
        })
        return ev.effective_weight

    assert get_weight("like") == 2.5
    assert get_weight("save") == 2.75
    assert get_weight("play_completed") == 1.0
    assert get_weight("replay") == 1.1
    assert get_weight("play_30s") == 0.3
    assert get_weight("play_10s") == 0.15
    assert get_weight("skip_10_30s") == -0.6
    assert get_weight("skip_lt_10s") == -1.4
    assert get_weight("dislike") == -3.5
    assert get_weight("not_interested") == -5.0


def test_normalizer_custom_weights():
    custom_weights = RecommendationWeights(
        like=5.0,
        skip_lt_10s=-2.5,
    )
    normalizer = EventNormalizer(weights=custom_weights)

    ev_like = normalizer.normalize({
        "event_id": "ev_custom_like",
        "anonymous_id": "anon_1",
        "session_id": "sess_1",
        "event_type": "like",
        "track_id": "t1",
    })
    assert ev_like.effective_weight == 5.0

    ev_skip = normalizer.normalize({
        "event_id": "ev_custom_skip",
        "anonymous_id": "anon_1",
        "session_id": "sess_1",
        "event_type": "skip_lt_10s",
        "track_id": "t1",
    })
    assert ev_skip.effective_weight == -2.5


def test_normalizer_calculates_completion_ratio():
    normalizer = EventNormalizer()
    ev = normalizer.normalize({
        "event_id": "ev_progress",
        "anonymous_id": "anon_1",
        "session_id": "sess_1",
        "event_type": "progress",
        "track_id": "t1",
        "position_ms": 120000,
        "duration_ms": 240000,
    })
    assert ev.completion_ratio == 0.5
    assert ev.played_ratio == 0.5
