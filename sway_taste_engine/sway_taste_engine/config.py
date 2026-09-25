"""
Configuration models for the SWAY Taste & Recommendation Platform.
Decouples all algorithmic prior weights, decay parameters, and queue transitions
from algorithm logic.
"""

from __future__ import annotations
from pydantic import BaseModel, Field


class RecommendationWeights(BaseModel):
    """
    Calibrated prior telemetry event weights.
    Positive events reinforce taste affinity; negative events penalize or prune.
    """
    like: float = 2.5
    save: float = 2.75
    completed: float = 1.0
    replay: float = 1.1
    play_30s: float = 0.3
    play_10s: float = 0.15
    skip_10_30s: float = -0.6
    skip_lt_10s: float = -1.4
    dislike: float = -3.5
    not_interested: float = -5.0


class QueueWeights(BaseModel):
    """
    Sequence continuation weights for Next Queue optimization (A -> B).
    Ensures energy smoothness, mood continuity, and transition graph reinforcement.
    """
    mood_continuity: float = 0.30
    energy_smoothness: float = 0.25
    artist_affinity: float = 0.20
    transition_graph: float = 0.15
    novelty: float = 0.10


class DecayConfig(BaseModel):
    """
    Multi-horizon exponential half-life time decay parameters (in days).
    """
    rolling_days: int = 30
    rolling_half_life_days: float = 7.0
    recent_half_life_days: float = 7.0
    long_term_half_life_days: float = 60.0


class EngineConfig(BaseModel):
    """
    Root configuration for recommendation engine instances.
    """
    recommendation_weights: RecommendationWeights = Field(default_factory=RecommendationWeights)
    queue_weights: QueueWeights = Field(default_factory=QueueWeights)
    decay_config: DecayConfig = Field(default_factory=DecayConfig)
    candidate_target_pool: int = 300
    candidate_min_pool: int = 150
    candidate_max_pool: int = 500
