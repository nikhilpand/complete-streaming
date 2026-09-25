from __future__ import annotations

import pytest
from sway_taste_engine.diversity import DiversityReranker
from sway_taste_engine.models import FeedType, Track
from sway_taste_engine.ranking import RankedCandidate
from sway_taste_engine.retrieval import Candidate


def mk(i: str, a: str, s: float, album: str = ""):
    return RankedCandidate(
        Candidate(
            Track(
                id=i,
                title=i,
                artist_id=a,
                artist_name=a,
                album_id=album or f"alb_{a}",
                provider_available={"jiosaavn": True},
            ),
            "test",
            0.5,
        ),
        s,
        {},
    )


def test_artist_diversity():
    out = DiversityReranker().rerank(
        [mk("1", "a", 1.0), mk("2", "a", 0.99), mk("3", "b", 0.98)],
        FeedType.FOR_YOU,
        3,
    )
    assert out[1].candidate.track.artist_id == "b"


def test_sliding_window_consecutive_artist_limit():
    # 5 tracks of artist 'a' and 5 tracks of artist 'b'
    candidates = [
        mk(f"a_{i}", "a", 1.0 - i * 0.01) for i in range(5)
    ] + [
        mk(f"b_{i}", "b", 0.90 - i * 0.01) for i in range(5)
    ]
    reranker = DiversityReranker(max_consecutive_artist=2)
    out = reranker.rerank(candidates, FeedType.FOR_YOU, 10)

    # Check that no artist appears > 2 times consecutively
    consecutive = 1
    prev_artist = None
    for item in out:
        curr_artist = item.candidate.track.artist_id
        if curr_artist == prev_artist:
            consecutive += 1
            assert consecutive <= 2, f"Artist {curr_artist} appeared {consecutive} times consecutively"
        else:
            consecutive = 1
            prev_artist = curr_artist


def test_sliding_window_album_limit():
    candidates = []
    for a in range(8):
        for i in range(4):
            c = Candidate(
                Track(
                    id=f"t_{a}_{i}",
                    title=f"Track {a}_{i}",
                    artist_id=f"art_{a}_{i}",
                    album_id=f"alb_{a}",
                    provider_available={"jiosaavn": True},
                ),
                "test",
                0.5,
            )
            candidates.append(RankedCandidate(c, 1.0 - i * 0.01, {}))

    reranker = DiversityReranker(max_album_per_window=3, window_size=10)
    out = reranker.rerank(candidates, FeedType.FOR_YOU, 20)

    # Check any window of size 10 has at most 3 tracks of any album
    for w_start in range(len(out) - 10 + 1):
        window = out[w_start:w_start + 10]
        for a in range(8):
            alb_count = sum(1 for x in window if x.candidate.track.album_id == f"alb_{a}")
            assert alb_count <= 3, f"Album alb_{a} appeared {alb_count} times in window of size 10"
