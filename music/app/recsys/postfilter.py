"""Final passes: remove repeats/blocked/bad versions, keep the language coherent, then diversify
(artist spacing + per-artist cap), mirroring the post-ranking step of large-scale recommenders."""
from __future__ import annotations

from typing import Iterable, Optional

from .models import Candidate
from .text import base_title, primary_artist_key

HARD_DROP_TAGS = {"karaoke", "instrumental", "cover"}


def diversify(cands: list[Candidate], limit: int, min_gap: int, max_per_artist: int) -> list[Candidate]:
    remaining = list(cands)                        # already sorted best-first
    out: list[Candidate] = []
    counts: dict[str, int] = {}
    while remaining and len(out) < limit:
        recent = {primary_artist_key(c.artists) for c in out[-min_gap:]} if min_gap else set()
        pick = None
        for c in remaining:                        # 1) respect gap and cap
            a = primary_artist_key(c.artists)
            if a not in recent and counts.get(a, 0) < max_per_artist:
                pick = c
                break
        if pick is None:                           # 2) relax the gap, keep the cap
            pick = next((c for c in remaining if counts.get(primary_artist_key(c.artists), 0) < max_per_artist), None)
        if pick is None:                           # 3) nothing else: stop rather than spam one artist
            break
        remaining.remove(pick)
        a = primary_artist_key(pick.artists)
        counts[a] = counts.get(a, 0) + 1
        out.append(pick)
    return out


def postfilter(cands: list[Candidate], *, seed: Optional[Candidate] = None,
               served_ids: Iterable[str] = (), served_keys: Iterable[str] = (),
               blocked_ids: Iterable[str] = (), limit: int = 25, min_gap: int = 3,
               max_per_artist: int = 4) -> list[Candidate]:
    served_ids, served_keys, blocked_ids = set(served_ids), set(served_keys), set(blocked_ids)
    seed_tags = base_title(seed.title)[1] if seed and seed.title else frozenset()
    seed_key = seed.key if seed and seed.title else None
    kept: list[Candidate] = []
    seen_keys: set[str] = set()
    for c in cands:
        if seed and ((seed.saavn_id and c.saavn_id == seed.saavn_id) or (seed_key and c.key == seed_key)):
            continue
        if c.saavn_id in served_ids or c.saavn_id in blocked_ids or c.key in served_keys:
            continue
        if (base_title(c.title)[1] & HARD_DROP_TAGS) - seed_tags:
            continue
        if c.key in seen_keys:
            continue
        seen_keys.add(c.key)
        kept.append(c)

    lang = (seed.language or "").lower() if seed else ""
    if lang:                                       # keep radio in the seed's language when we can afford to
        same = [c for c in kept if not c.language or c.language.lower() == lang]
        if len(same) >= min(limit, 8):
            kept = same
    return diversify(kept, limit, min_gap, max_per_artist)
