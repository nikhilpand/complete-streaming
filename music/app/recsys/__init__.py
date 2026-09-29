from __future__ import annotations

from typing import Optional

from .config import Settings
from .engine import RecommendationEngine, hash_user
from .quick_picks import QuickPicks
from .store import Store

__all__ = ["Settings", "RecommendationEngine", "QuickPicks", "Store", "build_engine", "hash_user"]


def build_engine(settings: Optional[Settings] = None, saavn=None, ytm=None):
    """Wire real clients. Pass your existing Saavn adapter as `saavn` to reuse it."""
    from .clients.saavn import HttpSaavnClient
    from .clients.ytm import YtmClient
    s = settings or Settings()
    store = Store(s.db_path)
    engine = RecommendationEngine(
        ytm or YtmClient(s.ytm_language, s.ytm_location), saavn or HttpSaavnClient(), store, s)
    return engine, QuickPicks(engine)
