from __future__ import annotations
import os
import tempfile
import threading
from datetime import datetime, timezone, timedelta
import pytest
from sway_taste_engine.models import (
    Track,
    UserEvent,
    EventType,
    UserTasteProfile,
    ArtistRole,
    FeatureValue,
    Bucket,
)
from sway_taste_engine.storage import TasteStore, SQLiteTasteStore, InMemoryStore


def test_taste_store_is_abstract():
    with pytest.raises(TypeError):
        TasteStore()  # type: ignore


@pytest.fixture
def temp_db_path():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield path
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def test_sqlite_store_init_and_wal(temp_db_path):
    store = SQLiteTasteStore(temp_db_path)
    with store._connect() as conn:
        journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert journal_mode.lower() == "wal"


def test_sqlite_track_crud(temp_db_path):
    store = SQLiteTasteStore(temp_db_path)
    track1 = Track(
        id="t1",
        title="Tu Chahiye",
        artists=[
            ArtistRole(id="a1", name="Atif Aslam", role="primary"),
            ArtistRole(id="a2", name="Pritam", role="composer"),
        ],
        album="Bajrangi Bhaijaan",
        duration_ms=272000,
        year=2015,
        language="hindi",
        energy_feature=FeatureValue[float](value=0.55, source="manual", confidence=0.9),
    )
    track2 = Track(
        id="t2",
        title="Jeena Jeena",
        artists=[ArtistRole(id="a1", name="Atif Aslam", role="primary")],
        album="Badlapur",
        duration_ms=229000,
        year=2015,
        language="hindi",
    )

    store.upsert_track(track1)
    store.upsert_tracks([track2])

    fetched1 = store.get_track("t1")
    assert fetched1 is not None
    assert fetched1.id == "t1"
    assert fetched1.title == "Tu Chahiye"
    assert len(fetched1.artists) == 2
    assert fetched1.artists[0].name == "Atif Aslam"
    assert fetched1.artists[1].role == "composer"
    assert fetched1.year == 2015
    assert fetched1.energy_feature.value == 0.55
    assert fetched1.energy_feature.confidence == 0.9

    all_tracks = store.all_tracks()
    assert len(all_tracks) == 2
    assert {t.id for t in all_tracks} == {"t1", "t2"}


def test_sqlite_event_logging_and_deduplication(temp_db_path):
    store = SQLiteTasteStore(temp_db_path)
    now = datetime.now(timezone.utc)
    ev1 = UserEvent(
        event_id="ev_001",
        user_id="user_123",
        account_id="acc_1",
        anonymous_id="anon_1",
        session_id="sess_100",
        track_id="t1",
        event_type=EventType.COMPLETED,
        timestamp=now,
        duration_ms=272000,
        completion_ratio=1.0,
        effective_weight=1.0,
    )

    # First insert succeeds
    assert store.add_event(ev1) is True
    # Duplicate insert fails/deduplicates cleanly
    assert store.add_event(ev1) is False

    events = store.user_events("user_123")
    assert len(events) == 1
    assert events[0].event_id == "ev_001"
    assert events[0].account_id == "acc_1"
    assert events[0].event_type == EventType.COMPLETED

    sess_events = store.session_events_for("sess_100")
    assert len(sess_events) == 1
    assert sess_events[0].track_id == "t1"


def test_sqlite_recent_events_horizon(temp_db_path):
    store = SQLiteTasteStore(temp_db_path)
    now = datetime.now(timezone.utc)

    # Event 5 days ago
    ev_recent = UserEvent(
        event_id="ev_recent",
        user_id="u1",
        track_id="t1",
        event_type=EventType.COMPLETED,
        timestamp=now - timedelta(days=5),
    )
    # Event 40 days ago
    ev_old = UserEvent(
        event_id="ev_old",
        user_id="u1",
        track_id="t2",
        event_type=EventType.COMPLETED,
        timestamp=now - timedelta(days=40),
    )

    store.add_event(ev_recent)
    store.add_event(ev_old)

    # All user events = 2
    assert len(store.user_events("u1")) == 2

    # Events within last 30 days = 1
    recent_30d = store.get_recent_events("u1", days=30)
    assert len(recent_30d) == 1
    assert recent_30d[0].event_id == "ev_recent"


def test_sqlite_profile_persistence_across_instances(temp_db_path):
    store1 = SQLiteTasteStore(temp_db_path)
    profile = store1.get_profile("u1")
    assert profile.user_id == "u1"
    assert profile.total_events == 0

    # Modify profile
    profile.long_term.artist["Atif Aslam"] = Bucket(positive=4.5)
    profile.long_term.genre["romantic"] = Bucket(positive=3.0)
    profile.recent_30d.artist["Atif Aslam"] = Bucket(positive=2.0)
    profile.session_state.session_id = "sess_current"
    profile.negative_memory.explicit_negative_tracks.add("bad_track_1")
    profile.total_events = 15

    store1.save_profile(profile)

    # Open with a completely fresh instance pointing to the same file
    store2 = SQLiteTasteStore(temp_db_path)
    loaded = store2.get_profile("u1")

    assert loaded.user_id == "u1"
    assert loaded.total_events == 15
    assert loaded.long_term.artist_affinity["Atif Aslam"] == 4.5
    assert loaded.recent_30d.artist_affinity["Atif Aslam"] == 2.0
    assert loaded.session_state.session_id == "sess_current"
    assert "bad_track_1" in loaded.negative_memory.explicit_negative_tracks
    # Test backward compatibility accessor
    assert loaded.artist_affinity["Atif Aslam"] == 2.0


def test_sqlite_similarity_edges_indexed_lookup(temp_db_path):
    store = SQLiteTasteStore(temp_db_path)
    edges = [
        ("t1", "t2", 0.92, "collaborative"),
        ("t1", "t3", 0.85, "genre"),
        ("t1", "t4", 0.95, "artist"),
        ("t2", "t5", 0.70, "collaborative"),
    ]
    store.save_similarity_edges(edges)

    top2_t1 = store.get_top_k_similar_tracks("t1", k=2)
    assert len(top2_t1) == 2
    # Should be sorted descending by score: t4 (0.95), then t2 (0.92)
    assert top2_t1[0] == ("t4", 0.95)
    assert top2_t1[1] == ("t2", 0.92)

    top_all_t1 = store.get_top_k_similar_tracks("t1", k=10)
    assert len(top_all_t1) == 3
    assert [target for target, score in top_all_t1] == ["t4", "t2", "t3"]


def test_sqlite_transition_graph(temp_db_path):
    store = SQLiteTasteStore(temp_db_path)
    # Record A -> B transitions
    store.record_transition("track_A", "track_B", completed=True)
    store.record_transition("track_A", "track_B", completed=True)
    store.record_transition("track_A", "track_B", completed=False)  # 1 skip

    # Record A -> C transition
    store.record_transition("track_A", "track_C", completed=True)

    score_ab = store.get_transition_score("track_A", "track_B")
    assert score_ab > 0

    transitions = store.get_transitions_from("track_A", limit=5)
    assert len(transitions) == 2
    # track_B has 2 completed, 1 skipped
    # track_C has 1 completed, 0 skipped
    targets = [target for target, score in transitions]
    assert "track_B" in targets
    assert "track_C" in targets


def test_sqlite_concurrency(temp_db_path):
    store = SQLiteTasteStore(temp_db_path)
    errors = []

    def worker(worker_id: int):
        try:
            for i in range(20):
                tid = f"track_{worker_id}_{i}"
                store.upsert_track(Track(id=tid, title=f"Title {tid}", artists=[]))
                store.add_event(
                    UserEvent(
                        event_id=f"ev_{worker_id}_{i}",
                        user_id=f"u_{worker_id}",
                        track_id=tid,
                        event_type=EventType.COMPLETED,
                    )
                )
                store.save_similarity_edges([(tid, f"sim_{tid}", 0.8, "test")])
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(w,)) for w in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0
    assert len(store.all_tracks()) == 80
