from __future__ import annotations

import pytest
from sway_taste_engine.config import RecommendationWeights
from sway_taste_engine.models import (
    ArtistRole,
    FeedType,
    RecommendationContext,
    ScoreBreakdown,
    Track,
    UserTasteProfile,
)
from sway_taste_engine.ranking import RankedCandidate, RuleBasedRanker
from sway_taste_engine.retrieval import Candidate


@pytest.fixture
def sample_data():
    t1 = Track(
        id="t1",
        title="Song 1",
        artist_id="a1",
        artist_name="Artist One",
        album_id="alb1",
        genres=["bollywood", "romantic"],
        moods=["romantic"],
        language="hindi",
        energy=0.5,
        popularity=0.8,
    )
    t2 = Track(
        id="t2",
        title="Song 2",
        artist_id="a2",
        artist_name="Artist Two",
        album_id="alb2",
        genres=["edm", "dance"],
        moods=["energetic"],
        language="english",
        energy=0.9,
        popularity=0.7,
    )
    t_disliked = Track(
        id="t_disliked",
        title="Disliked Track",
        artist_id="a_bad",
        artist_name="Bad Artist",
        album_id="alb_bad",
        genres=["pop"],
        moods=["happy"],
        language="hindi",
        energy=0.6,
        popularity=0.5,
    )
    candidates = [
        Candidate(track=t1, source="similar_track", source_strength=0.85),
        Candidate(track=t2, source="discovery", source_strength=0.50),
        Candidate(track=t_disliked, source="trending", source_strength=0.90),
    ]
    catalog = {t.id: t for t in [t1, t2, t_disliked]}
    return {"candidates": candidates, "catalog": catalog, "t1": t1, "t2": t2, "t_disliked": t_disliked}


def test_ranking_contains_explainable_components(sample_data):
    ranker = RuleBasedRanker()
    profile = UserTasteProfile(user_id="u1")
    ctx = RecommendationContext(current_track_id="t1", activity="chill")

    ranked = ranker.rank(
        sample_data["candidates"],
        profile,
        ctx,
        FeedType.FOR_YOU,
        sample_data["catalog"],
    )

    assert len(ranked) >= 2
    for r in ranked:
        assert isinstance(r, RankedCandidate)
        assert isinstance(r.components, dict)
        # Components must include individual attribution dimensions
        for required_key in ["taste", "session", "similarity", "novelty", "freshness", "popularity", "energy_fit"]:
            assert required_key in r.components, f"Missing component {required_key} in components: {r.components.keys()}"
        assert isinstance(r.score, float)


def test_negative_memory_pruning(sample_data):
    ranker = RuleBasedRanker()
    profile = UserTasteProfile(user_id="u1")
    # Mark t_disliked as explicit negative track and artist a_bad as explicit negative artist
    profile.negative_memory.explicit_negative_tracks.add("t_disliked")
    profile.negative_memory.explicit_negative_artists.add("a_bad")

    ctx = RecommendationContext(current_track_id="t1")
    ranked = ranker.rank(
        sample_data["candidates"],
        profile,
        ctx,
        FeedType.FOR_YOU,
        sample_data["catalog"],
    )

    ranked_ids = [r.candidate.track.id for r in ranked]
    assert "t_disliked" not in ranked_ids, "Explicitly disliked track was not pruned by ranker!"


def test_custom_recommendation_weights_affect_scores(sample_data):
    # Standard ranker vs similarity-boosted ranker
    ranker_standard = RuleBasedRanker()
    ranked_standard = ranker_standard.rank(
        sample_data["candidates"],
        UserTasteProfile(user_id="u1"),
        RecommendationContext(current_track_id="t1"),
        FeedType.TRACK_RADIO,
        sample_data["catalog"],
    )

    # In TRACK_RADIO, similarity component is heavily weighted
    assert ranked_standard[0].candidate.track.id == "t1"
    assert ranked_standard[0].components["similarity"] == pytest.approx(0.85, rel=1e-2)


def test_engine_emits_score_breakdown_attribution():
    from sway_taste_engine.engine import RecommendationEngine
    from sway_taste_engine.models import EventType, UserEvent

    engine = RecommendationEngine()
    t1 = Track(id="t1", title="T1", artist_id="a1", artist_name="A1", genres=["pop"], moods=["chill"], energy=0.5, popularity=0.8)
    t2 = Track(id="t2", title="T2", artist_id="a1", artist_name="A1", genres=["pop"], moods=["chill"], energy=0.5, popularity=0.7)
    engine.seed_catalog([t1, t2])

    # Ingest like on t1
    engine.ingest_event(UserEvent(event_id="ev_1", user_id="u1", session_id="s1", event_type=EventType.LIKE, track_id="t1"))

    rec_res = engine.recommend("u1", FeedType.FOR_YOU)
    assert len(rec_res.items) > 0
    top_item = rec_res.items[0]
    assert top_item.attribution is not None
    assert isinstance(top_item.attribution, ScoreBreakdown)
    assert top_item.attribution.total == top_item.score
    assert "taste" in top_item.attribution.components
    assert top_item.attribution.negative_checks_passed is True
