"""Lightweight ranking on top of fused candidates.

Linear on purpose: transparent, tunable from Settings.rank_weights, and every feature is logged as an
impression so a learned ranker (LightGBM lambdarank on skip/complete labels) can replace it later.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Optional

from .config import Settings
from .models import Candidate
from .store import Store
from .text import artist_keys, base_title

SOFT_PENALTY_TAGS = {"lofi", "slowed", "reverb", "sped up", "8d", "bass boosted", "remix", "mashup", "flip", "dj", "trap"}


@dataclass
class UserProfile:
    artist_affinity: dict = field(default_factory=dict)   # artist key -> -1..1
    lang_pref: dict = field(default_factory=dict)          # language -> 0..1 (sums to 1)
    blocked_ids: set = field(default_factory=set)          # recent early-skips + dislikes
    liked_ids: set = field(default_factory=set)
    recent_ids: list = field(default_factory=list)         # most recent completed/liked, newest first


_KIND_W = {"complete": 1.0, "like": 2.0, "dislike": -3.0}


def build_profile(store: Store, user: Optional[str], s: Settings, now: Optional[float] = None,
                  days: float = 45.0, half_life_days: float = 14.0) -> UserProfile:
    p = UserProfile()
    if not user:
        return p
    now = now or time.time()
    rows = store.user_events(user, now - days * 86400, ("complete", "like", "skip", "dislike"))
    track_w: dict[str, float] = {}
    for ts, tid, kind, pos in rows:            # newest first
        age_d = (now - ts) / 86400
        decay = 0.5 ** (age_d / half_life_days)
        if kind == "skip":
            early = pos < s.early_skip_ms
            w = (-1.0 if early else 0.3) * decay
            if early and age_d <= s.skip_memory_days:
                p.blocked_ids.add(tid)
        else:
            w = _KIND_W[kind] * decay
            if kind == "dislike":
                p.blocked_ids.add(tid)
            if kind == "like":
                p.liked_ids.add(tid)
            if kind in ("complete", "like") and tid not in p.recent_ids:
                p.recent_ids.append(tid)
        track_w[tid] = track_w.get(tid, 0.0) + w
    meta = store.meta_get_many(track_w)
    art: dict[str, float] = {}
    lang: dict[str, float] = {}
    for tid, w in track_w.items():
        m = meta.get(tid)
        if not m:
            continue
        for a in artist_keys(m.get("artists", [])):
            art[a] = art.get(a, 0.0) + w
        if w > 0 and m.get("language"):
            lang[m["language"].lower()] = lang.get(m["language"].lower(), 0.0) + w
    p.artist_affinity = {a: math.tanh(v / 3.0) for a, v in art.items()}
    total = sum(lang.values())
    p.lang_pref = {l: v / total for l, v in lang.items()} if total else {}
    return p


def rank(cands: list[Candidate], seed: Optional[Candidate], profile: UserProfile,
         stats: dict, s: Settings) -> None:
    """Assigns `.score` in place (higher = better)."""
    if not cands:
        return
    w = s.rank_weights
    top = max(c.score for c in cands) or 1.0
    seed_tags = base_title(seed.title)[1] if seed and seed.title else frozenset()
    seed_lang = (seed.language or "").lower() if seed else ""
    for c in cands:
        score = c.score / top
        aff = max((profile.artist_affinity.get(k, 0.0) for k in artist_keys(c.artists)), default=0.0)
        score += w["affinity"] * aff
        lang = (c.language or "").lower()
        if seed_lang and lang:
            score += w["lang_match"] * (1.0 if lang == seed_lang else -1.0)
        score += w["lang_pref"] * profile.lang_pref.get(lang, 0.0)
        st = stats.get(c.saavn_id)
        if st:
            rate = (st["skips"] + 2) / (st["plays"] + 8)      # smoothed early-skip rate, prior 0.25
            score -= w["skip_rate"] * (rate - 0.25)
            score += w["like"] * min(st["likes"], 5) / 5
        if c.saavn_id in profile.liked_ids:
            score += 0.05
        if (base_title(c.title)[1] - seed_tags) & SOFT_PENALTY_TAGS:
            score -= w["version"]
        if c.extra.get("video_type") == "MUSIC_VIDEO_TYPE_UGC":
            score -= w["ugc"]
        c.score = score * (0.7 + 0.3 * c.confidence)
