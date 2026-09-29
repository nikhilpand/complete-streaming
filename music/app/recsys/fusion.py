"""Reciprocal Rank Fusion across candidate sources, with a cross-source agreement bonus.

A song suggested by BOTH the YouTube Music co-listening graph and JioSaavn's own recommender is the
strongest precision signal we have, so agreement multiplies the score.
"""
from __future__ import annotations

from typing import Optional

from .models import Candidate, same_song


def fuse(lists: dict[str, list[Candidate]], weights: dict[str, float], *, k: int = 30,
         agreement_bonus: float = 0.35, exclude: Optional[Candidate] = None,
         default_weight: float = 0.5) -> list[Candidate]:
    groups: list[Candidate] = []
    by_sid: dict[str, Candidate] = {}
    by_vid: dict[str, Candidate] = {}

    def find(c: Candidate) -> Optional[Candidate]:
        if c.saavn_id and c.saavn_id in by_sid:
            return by_sid[c.saavn_id]
        if c.ytm_video_id and c.ytm_video_id in by_vid:
            return by_vid[c.ytm_video_id]
        for g in groups:
            if same_song(g, c):
                return g
        return None

    def register(g: Candidate) -> None:
        if g.saavn_id:
            by_sid[g.saavn_id] = g
        if g.ytm_video_id:
            by_vid[g.ytm_video_id] = g

    for source, items in lists.items():
        w = weights.get(source, default_weight)
        for rank, raw in enumerate(items):
            c = raw.clone()
            contrib = w / (k + rank + 1)
            g = find(c)
            if g is None:
                c.source, c.source_rank, c.score, c.sources = source, rank, contrib, {source: rank}
                groups.append(c)
                register(c)
                continue
            if source in g.sources:              # same source repeating a song: barely count it
                g.score += contrib * 0.2
                g.sources[source] = min(g.sources[source], rank)
            else:
                g.score += contrib
                g.sources[source] = rank
            g.fill_from(c)
            register(g)

    for g in groups:
        g.score *= 1.0 + agreement_bonus * (len(g.sources) - 1)

    if exclude is not None:
        groups = [g for g in groups if not same_song(g, exclude)]
    groups.sort(key=lambda g: g.score, reverse=True)
    return groups


def merge_by_saavn_id(cands: list[Candidate]) -> list[Candidate]:
    """After identity resolution two YTM tracks can map to one Saavn track; keep one, sum evidence."""
    out: dict[str, Candidate] = {}
    for c in cands:
        cur = out.get(c.saavn_id)
        if cur is None:
            out[c.saavn_id] = c
        else:
            keep, drop = (c, cur) if c.score > cur.score else (cur, c)
            keep.score += drop.score * 0.5
            for s, r in drop.sources.items():
                keep.sources[s] = min(keep.sources.get(s, r), r)
            keep.fill_from(drop)
            out[c.saavn_id] = keep
    return list(out.values())
