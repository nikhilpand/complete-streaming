"""
Tests for configurable recommendation and queue weights.
Phase 0: Contract Freeze.
"""

import pytest
from sway_taste_engine.config import (
    RecommendationWeights,
    QueueWeights,
    DecayConfig,
    EngineConfig,
)


def test_recommendation_weights_defaults():
    w = RecommendationWeights()
    assert w.like == 2.5
    assert w.save == 2.75
    assert w.completed == 1.0
    assert w.replay == 1.1
    assert w.play_30s == 0.3
    assert w.play_10s == 0.15
    assert w.skip_10_30s == -0.6
    assert w.skip_lt_10s == -1.4
    assert w.dislike == -3.5
    assert w.not_interested == -5.0


def test_queue_weights_defaults():
    qw = QueueWeights()
    assert qw.mood_continuity == 0.30
    assert qw.energy_smoothness == 0.25
    assert qw.artist_affinity == 0.20
    assert qw.transition_graph == 0.15
    assert qw.novelty == 0.10
    assert pytest.approx(sum([
        qw.mood_continuity,
        qw.energy_smoothness,
        qw.artist_affinity,
        qw.transition_graph,
        qw.novelty
    ]), 0.01) == 1.0


def test_decay_config_defaults():
    dc = DecayConfig()
    assert dc.recent_half_life_days == 7.0
    assert dc.long_term_half_life_days == 60.0


def test_engine_config_overrides():
    custom_rec = RecommendationWeights(like=5.0, dislike=-10.0)
    cfg = EngineConfig(recommendation_weights=custom_rec)
    assert cfg.recommendation_weights.like == 5.0
    assert cfg.recommendation_weights.dislike == -10.0
    assert cfg.recommendation_weights.save == 2.75
