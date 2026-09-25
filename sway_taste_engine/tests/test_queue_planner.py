from __future__ import annotations

import pytest
from sway_taste_engine.config import QueueWeights
from sway_taste_engine.models import ArtistRole, Track, UserTasteProfile
from sway_taste_engine.queue_planner import QueuePlanner
from sway_taste_engine.storage import InMemoryStore


@pytest.fixture
def queue_tracks():
    ballad_1 = Track(
        id="ballad_1",
        title="Tu Chahiye",
        artist_id="atif",
        artist_name="Atif Aslam",
        moods=["romantic", "mellow"],
        genres=["bollywood", "acoustic"],
        energy=0.35,
        popularity=0.8,
    )
    ballad_2 = Track(
        id="ballad_2",
        title="Jeena Jeena",
        artist_id="atif",
        artist_name="Atif Aslam",
        moods=["romantic", "mellow"],
        genres=["bollywood", "acoustic"],
        energy=0.38,
        popularity=0.75,
    )
    ballad_3 = Track(
        id="ballad_3",
        title="Gerua",
        artist_id="arijit",
        artist_name="Arijit Singh",
        moods=["romantic"],
        genres=["bollywood"],
        energy=0.42,
        popularity=0.85,
    )
    edm_banger = Track(
        id="edm_1",
        title="Midnight Festival",
        artist_id="dj_rave",
        artist_name="DJ Rave",
        moods=["energetic", "party"],
        genres=["edm", "dance"],
        energy=0.95,
        popularity=0.7,
    )
    return {
        "current": ballad_1,
        "ballad_atif": ballad_2,
        "ballad_arijit": ballad_3,
        "edm": edm_banger,
    }


def test_queue_transition_prefers_mood_and_energy_continuity(queue_tracks):
    planner = QueuePlanner()
    profile = UserTasteProfile(user_id="user_1")
    current = queue_tracks["current"]
    candidates = [
        queue_tracks["ballad_atif"],
        queue_tracks["ballad_arijit"],
        queue_tracks["edm"],
    ]

    ranked_queue = planner.plan_next(
        current_track=current,
        candidates=candidates,
        profile=profile,
        count=3,
    )

    assert len(ranked_queue) == 3
    # Top selections must be compatible ballads, not abrupt EDM cliff
    top_ids = [t.id for t in ranked_queue]
    assert top_ids[0] in {"ballad_2", "ballad_3"}
    assert top_ids[1] in {"ballad_2", "ballad_3"}
    assert top_ids[2] == "edm_1"


def test_queue_transition_graph_boosts_continuation():
    planner = QueuePlanner()
    store = InMemoryStore()
    profile = UserTasteProfile(user_id="user_1")
    current = Track(id="c", title="Current", artist_id="art_1", moods=["chill"], energy=0.5)
    cand_1 = Track(id="c1", title="Candidate 1", artist_id="art_2", moods=["chill"], energy=0.5)
    cand_2 = Track(id="c2", title="Candidate 2", artist_id="art_3", moods=["chill"], energy=0.5)

    # Without transitions, cand_1 and cand_2 have equal scores
    score_1_before = planner.score_transition(current, cand_1, profile, store=store)
    score_2_before = planner.score_transition(current, cand_2, profile, store=store)
    assert score_1_before == score_2_before

    # Record historical transition: current -> cand_2
    store.record_transition(current.id, cand_2.id)

    # Now cand_2 must have higher transition score and rank first
    score_2_after = planner.score_transition(current, cand_2, profile, store=store)
    assert score_2_after > score_1_before

    ranked = planner.plan_next(current, [cand_1, cand_2], profile, store=store)
    assert ranked[0].id == "c2"
