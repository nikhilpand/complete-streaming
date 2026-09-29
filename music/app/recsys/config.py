"""Tunables for the SWAY recommendation engine. Everything is overridable via env or constructor."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _f(name: str, default: float) -> float:
    return float(os.getenv(name, default))


@dataclass(frozen=True)
class Settings:
    # storage / privacy
    db_path: str = field(default_factory=lambda: os.getenv("SWAY_RECS_DB", "sway_recs.db"))
    user_salt: str = field(default_factory=lambda: os.getenv("SWAY_USER_SALT", "change-me-in-prod"))

    # YTM locale (Indian results)
    ytm_language: str = "en"
    ytm_location: str = "IN"

    # latency budgets
    source_timeout_s: float = field(default_factory=lambda: _f("SWAY_SOURCE_TIMEOUT", 2.5))
    resolve_timeout_s: float = field(default_factory=lambda: _f("SWAY_RESOLVE_TIMEOUT", 1.6))
    resolve_concurrency: int = 8
    resolve_pool: int = 40          # how many fused candidates we try to map to Saavn

    # identity matching thresholds
    accept_conf: float = 0.80
    probable_conf: float = 0.65
    negative_ttl_s: int = 3 * 24 * 3600

    # caches
    radio_cache_ttl_s: int = 900
    reco_cache_ttl_s: int = 900
    quick_picks_ttl_s: int = 600
    trending_ttl_s: int = 1800
    session_ttl_s: int = 6 * 3600

    # fusion
    rrf_k: int = 30
    agreement_bonus: float = 0.35   # multiplier per extra agreeing source
    source_weights: dict = field(default_factory=lambda: {
        "ytm": 1.0, "saavn_reco": 0.9, "saavn_station": 0.7,
        "graph": 1.1, "trending_ytm": 0.5, "trending_saavn": 0.5,
    })

    # ranking weights (linear now; swap for a learned ranker once skip data exists)
    rank_weights: dict = field(default_factory=lambda: {
        "affinity": 0.25, "lang_match": 0.20, "lang_pref": 0.10,
        "skip_rate": 0.60, "like": 0.05, "version": 0.20, "ugc": 0.30,
    })

    # feedback semantics
    early_skip_ms: int = 30_000
    skip_memory_days: float = 2.0

    # post-filter
    min_artist_gap: int = 3
    max_per_artist: int = 4

    # graph
    graph_session_gap_s: int = 1800
    graph_window: int = 4
    graph_min_weight: float = 2.0
    graph_per_user_cap: float = 3.0
    graph_max_neighbors: int = 50

    def __post_init__(self) -> None:
        env = (os.getenv("ENVIRONMENT") or os.getenv("SWAY_ENV") or "").strip().lower()
        if env == "production":
            if not self.user_salt or self.user_salt == "change-me-in-prod":
                raise RuntimeError(
                    "SWAY_USER_SALT must be configured with a secure non-default secret in production."
                )
