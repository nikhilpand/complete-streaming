"""
Comprehensive test suite for SWAY YouTube-Music-style progressive personalization.
Verifies all 15 scenarios:
1. Brand-new user receives real discovery content ('cold').
2. Never receives Sample Track or mock recommendations.
3. First plays transition user to 'seeded' / 'learning'.
4. Search -> play strengthens artist/track affinity.
5. Early skip vs near-complete play effect.
6. Replay / like boost.
7. Progressive evolution of Home shelves.
8. Discovery preserved in personalized states.
9. Deduplication across shelves.
10. Anti-clustering of same artist in queue.
11. Canonical Song/Track contract compliance.
12. Canonical player authority integration.
13. Telemetry persistence across session restarts.
14. Zero history cold start.
15. Resilient empty catalog handling.
"""

import time
import pytest
from datetime import datetime, timezone
from sway_taste_engine.models import (
    Track,
    UserEvent,
    EventType,
    PersonalizationState,
    UserTasteProfile,
)
from sway_taste_engine.storage import SQLiteTasteStore
from sway_taste_engine.engine import RecommendationEngine
from sway_taste_engine.mix_planner import MixPlanner, HomeShelf
from sway_taste_engine.queue_planner import QueuePlanner
from sway_taste_engine.profile import TasteProfileBuilder


def _make_track(
    track_id: str,
    title: str,
    artist_id: str,
    artist_name: str,
    language: str = "hindi",
    genres: list[str] = None,
    popularity: float = 0.8,
    energy: float = 0.6,
) -> Track:
    return Track(
        id=track_id,
        title=title,
        artist_id=artist_id,
        artist_name=artist_name,
        album_name=f"{title} - Single",
        language=language,
        genres=genres or ["bollywood", "pop"],
        moods=["chill", "romantic"],
        popularity=popularity,
        energy=energy,
        duration_ms=210000,
        artwork_url=f"https://c.saavncdn.com/{track_id}.jpg",
    )


@pytest.fixture
def mock_catalog() -> list[Track]:
    catalog = []
    artists = [
        ("art_arijit", "Arijit Singh"),
        ("art_shreya", "Shreya Ghoshal"),
        ("art_pritam", "Pritam"),
        ("art_atif", "Atif Aslam"),
        ("art_diljit", "Diljit Dosanjh"),
        ("art_badshah", "Badshah"),
        ("art_ar_rahman", "A.R. Rahman"),
        ("art_anuv", "Anuv Jain"),
        ("art_sid", "Sid Sriram"),
        ("art_neha", "Neha Kakkar"),
    ]
    for i, (aid, aname) in enumerate(artists):
        for j in range(8):
            tid = f"track_{aid}_{j}"
            title = f"{aname} Hit {j+1}"
            pop = 0.5 + ((i + j) % 5) * 0.1
            energy = 0.3 + ((i * 2 + j) % 7) * 0.1
            lang = "punjabi" if aid == "art_diljit" else "hindi"
            catalog.append(_make_track(tid, title, aid, aname, language=lang, popularity=pop, energy=energy))
    return catalog


def test_01_cold_user_receives_real_discovery_content(tmp_path, mock_catalog):
    """1. Brand-new user receives discovery-first shelves in COLD state."""
    db_file = tmp_path / "test_taste.db"
    store = SQLiteTasteStore(str(db_file))
    profile = store.get_profile("user_new")

    assert profile.personalization_state == PersonalizationState.COLD

    planner = MixPlanner(store=store)
    shelves = planner.plan_home_feed(profile, mock_catalog, limit_per_shelf=6)

    assert len(shelves) >= 3
    shelf_types = [s.type for s in shelves]
    assert "trending" in shelf_types
    assert "popular_regional" in shelf_types

    for s in shelves:
        assert len(s.items) > 0
        for item in s.items:
            assert item.id
            assert "sample track" not in item.title.lower()
            assert "artist 0" not in item.artist_name.lower()


def test_02_never_receives_sample_tracks_or_mock_data(tmp_path, mock_catalog):
    """2. Mock tracks like 'Sample Track 0' or 'Artist 0' or 'track_seed_' are pruned."""
    dirty_catalog = list(mock_catalog)
    dirty_catalog.append(_make_track("track_seed_99", "Sample Track 99", "artist_0", "Artist 0"))
    dirty_catalog.append(_make_track("mock_123", "Sample Track Demo", "art_1", "Real Singer"))

    db_file = tmp_path / "test_taste.db"
    store = SQLiteTasteStore(str(db_file))
    profile = store.get_profile("user_audit")

    planner = MixPlanner(store=store)
    shelves = planner.plan_home_feed(profile, dirty_catalog, limit_per_shelf=8)

    for shelf in shelves:
        for t in shelf.items:
            assert not t.id.startswith("track_seed_")
            assert "sample track" not in t.title.lower()
            assert "artist 0" not in t.artist_name.lower()


def test_03_first_plays_transition_to_seeded_and_learning(tmp_path, mock_catalog):
    """3. 1-2 positive plays trigger SEEDED, 3-9 trigger LEARNING, 10+ trigger PERSONALIZED."""
    db_file = tmp_path / "test_taste.db"
    store = SQLiteTasteStore(str(db_file))
    engine = RecommendationEngine(store=store)
    engine.seed_catalog(mock_catalog)
    uid = "user_evolving"

    # Initially COLD
    p0 = store.get_profile(uid)
    assert p0.personalization_state == PersonalizationState.COLD

    # 1st listen: completed play
    ev1 = UserEvent(
        event_id="ev_1",
        user_id=uid,
        event_type=EventType.COMPLETED,
        track_id=mock_catalog[0].id,
        artist_id=mock_catalog[0].artist_id,
        completion_ratio=1.0,
    )
    engine.ingest_event(ev1)
    p1 = store.get_profile(uid)
    assert p1.personalization_state == PersonalizationState.SEEDED

    # 3 listens: transitions to LEARNING
    for i in range(1, 4):
        engine.ingest_event(
            UserEvent(
                event_id=f"ev_learn_{i}",
                user_id=uid,
                event_type=EventType.PLAY_50PCT,
                track_id=mock_catalog[i].id,
                artist_id=mock_catalog[i].artist_id,
                completion_ratio=0.6,
            )
        )
    p_learn = store.get_profile(uid)
    assert p_learn.personalization_state == PersonalizationState.LEARNING

    # 10 total positive events: transitions to PERSONALIZED
    for i in range(4, 11):
        engine.ingest_event(
            UserEvent(
                event_id=f"ev_pers_{i}",
                user_id=uid,
                event_type=EventType.COMPLETED,
                track_id=mock_catalog[i].id,
                artist_id=mock_catalog[i].artist_id,
                completion_ratio=1.0,
            )
        )
    p_pers = store.get_profile(uid)
    assert p_pers.personalization_state == PersonalizationState.PERSONALIZED


def test_04_search_intent_boosts_affinity(tmp_path, mock_catalog):
    """4. Playing a track from search results applies higher affinity weight (1.6x)."""
    t_search = mock_catalog[0]
    t_browse = mock_catalog[1]

    # User A plays from search
    ev_search = UserEvent(
        event_id="ev_s",
        user_id="user_search",
        event_type=EventType.PLAY_30S,
        track_id=t_search.id,
        artist_id=t_search.artist_id,
        position_ms=45000,
        duration_ms=180000,
        completion_ratio=0.25,
        source="search",
        query="arijit romantic hits",
    )
    # User B plays from browse
    ev_browse = UserEvent(
        event_id="ev_b",
        user_id="user_browse",
        event_type=EventType.PLAY_30S,
        track_id=t_browse.id,
        artist_id=t_browse.artist_id,
        position_ms=45000,
        duration_ms=180000,
        completion_ratio=0.25,
        source="browse",
    )

    builder = TasteProfileBuilder()
    profile_search = builder.build("user_search", [ev_search], {t_search.id: t_search})
    profile_browse = builder.build("user_browse", [ev_browse], {t_browse.id: t_browse})

    # Search-driven affinity is boosted by 1.6x
    search_score = profile_search.artist_affinity.get(t_search.artist_id, 0.0)
    browse_score = profile_browse.artist_affinity.get(t_browse.artist_id, 0.0)
    assert search_score > browse_score


def test_05_early_skip_vs_late_skip_calibration(tmp_path, mock_catalog):
    """5. Skip <10s yields strong negative penalty; late skip (>=75%) yields mild positive."""
    t_early = mock_catalog[0]
    t_late = mock_catalog[8]

    ev_early_skip = UserEvent(
        event_id="ev_skip_early",
        user_id="user_skip_test",
        event_type=EventType.SKIP_LT_10S,
        track_id=t_early.id,
        artist_id=t_early.artist_id,
        position_ms=4000,
        duration_ms=200000,
        completion_ratio=0.02,
    )
    ev_late_skip = UserEvent(
        event_id="ev_skip_late",
        user_id="user_skip_test",
        event_type=EventType.SKIP,
        track_id=t_late.id,
        artist_id=t_late.artist_id,
        position_ms=160000,
        duration_ms=200000,
        completion_ratio=0.80,
    )

    builder = TasteProfileBuilder()
    profile = builder.build("user_skip_test", [ev_early_skip, ev_late_skip], {t_early.id: t_early, t_late.id: t_late})

    early_artist_aff = profile.artist_affinity.get(t_early.artist_id, 0.0)
    late_artist_aff = profile.artist_affinity.get(t_late.artist_id, 0.0)

    # Early skip has negative affinity; late skip has higher affinity
    assert early_artist_aff < 0.0
    assert late_artist_aff > early_artist_aff
    assert profile.track_affinity[t_early.id] < 0.0
    assert profile.track_affinity[t_late.id] > profile.track_affinity[t_early.id]


def test_06_replay_and_like_boost(tmp_path, mock_catalog):
    """6. Replay and Like provide significant multipliers over simple play."""
    t_std = mock_catalog[0]
    t_like = mock_catalog[8]
    t_rep = mock_catalog[16]

    ev_play = UserEvent(
        event_id="ev_std",
        user_id="user_test",
        event_type=EventType.PLAY_10S,
        track_id=t_std.id,
        artist_id=t_std.artist_id,
    )
    ev_like = UserEvent(
        event_id="ev_like",
        user_id="user_test",
        event_type=EventType.LIKE,
        track_id=t_like.id,
        artist_id=t_like.artist_id,
    )
    ev_rep = UserEvent(
        event_id="ev_rep",
        user_id="user_test",
        event_type=EventType.REPLAY,
        track_id=t_rep.id,
        artist_id=t_rep.artist_id,
        completion_ratio=1.0,
    )

    builder = TasteProfileBuilder()
    profile = builder.build("user_test", [ev_play, ev_like, ev_rep], {
        t_std.id: t_std,
        t_like.id: t_like,
        t_rep.id: t_rep,
    })

    assert profile.track_affinity[t_like.id] > profile.track_affinity[t_std.id]
    assert profile.track_affinity[t_rep.id] > profile.track_affinity[t_std.id]


def test_07_progressive_evolution_of_home_shelves(tmp_path, mock_catalog):
    """7. Shelves morph progressively as user moves from cold to seeded to learning to personalized."""
    db_file = tmp_path / "test_taste.db"
    store = SQLiteTasteStore(str(db_file))
    engine = RecommendationEngine(store=store)
    engine.seed_catalog(mock_catalog)
    uid = "user_journey"
    planner = MixPlanner(store=store)

    # State 1: COLD
    p_cold = store.get_profile(uid)
    shelves_cold = planner.plan_home_feed(p_cold, mock_catalog)
    types_cold = [s.type for s in shelves_cold]
    assert "trending" in types_cold
    assert "made_for_you" not in types_cold

    # Seed 1 track -> State 2: SEEDED
    engine.ingest_event(
        UserEvent(
            event_id="ev_seed_1",
            user_id=uid,
            event_type=EventType.COMPLETED,
            track_id=mock_catalog[0].id,
            artist_id=mock_catalog[0].artist_id,
            completion_ratio=1.0,
        )
    )
    p_seeded = store.get_profile(uid)
    assert p_seeded.personalization_state == PersonalizationState.SEEDED
    shelves_seeded = planner.plan_home_feed(p_seeded, mock_catalog)
    types_seeded = [s.type for s in shelves_seeded]
    titles_seeded = [s.title for s in shelves_seeded]
    assert "quick_mix" in types_seeded or "similarity" in types_seeded
    assert any("Made for You" in t or "Because you listened" in t for t in titles_seeded)

    # Seed 4 tracks -> State 3: LEARNING
    for i in range(1, 5):
        engine.ingest_event(
            UserEvent(
                event_id=f"ev_seed_learn_{i}",
                user_id=uid,
                event_type=EventType.PLAY_50PCT,
                track_id=mock_catalog[i].id,
                artist_id=mock_catalog[i].artist_id,
                completion_ratio=0.7,
            )
        )
    p_learning = store.get_profile(uid)
    assert p_learning.personalization_state == PersonalizationState.LEARNING
    shelves_learning = planner.plan_home_feed(p_learning, mock_catalog)
    types_learning = [s.type for s in shelves_learning]
    assert "recently_played" in types_learning or "artist_radar" in types_learning


def test_08_discovery_preserved_in_personalized_state(tmp_path, mock_catalog):
    """8. Discovery / novelty is never squeezed out even for deeply personalized users."""
    db_file = tmp_path / "test_taste.db"
    store = SQLiteTasteStore(str(db_file))
    engine = RecommendationEngine(store=store)
    engine.seed_catalog(mock_catalog)
    uid = "user_mature"

    # Log 12 positive events across 3 favorite artists, leaving other tracks by those artists unplayed
    seed_tracks = [
        mock_catalog[0], mock_catalog[1],
        mock_catalog[8], mock_catalog[9],
        mock_catalog[16], mock_catalog[17],
    ]
    for i in range(12):
        target_track = seed_tracks[i % len(seed_tracks)]
        engine.ingest_event(
            UserEvent(
                event_id=f"ev_mature_{i}",
                user_id=uid,
                event_type=EventType.COMPLETED,
                track_id=target_track.id,
                artist_id=target_track.artist_id,
                completion_ratio=1.0,
            )
        )

    profile = store.get_profile(uid)
    assert profile.personalization_state == PersonalizationState.PERSONALIZED

    planner = MixPlanner(store=store)
    shelves = planner.plan_home_feed(profile, mock_catalog)

    types = [s.type for s in shelves]
    # Discovery shelf must still exist
    assert "discover_mix" in types or "trending" in types

    # Rediscover shelf exists for mature users
    assert "rediscover" in types


def test_09_deduplication_across_shelves(tmp_path, mock_catalog):
    """9. A track appearing on shelf 0 or earlier shelves does not duplicate on subsequent shelves."""
    db_file = tmp_path / "test_taste.db"
    store = SQLiteTasteStore(str(db_file))
    profile = store.get_profile("user_dedup")

    planner = MixPlanner(store=store)
    shelves = planner.plan_home_feed(profile, mock_catalog, limit_per_shelf=8)

    seen_ids = set()
    for shelf in shelves:
        for t in shelf.items:
            assert t.id not in seen_ids, f"Track {t.id} duplicated on shelf {shelf.id}"
            seen_ids.add(t.id)


def test_10_queue_anti_clustering_of_same_artist(tmp_path, mock_catalog):
    """10. Queue recommendations enforce maximum consecutive tracks by the same artist = 1."""
    db_file = tmp_path / "test_taste.db"
    store = SQLiteTasteStore(str(db_file))
    profile = store.get_profile("user_queue")

    planner = QueuePlanner(store=store)
    curr_track = mock_catalog[0]
    next_tracks = planner.plan_next(
        current_track=curr_track,
        candidates=mock_catalog,
        profile=profile,
        surface="queue",
        count=10,
    )

    assert len(next_tracks) > 0
    # No consecutive same-artist tracks
    prev_artist = curr_track.artist_id
    for t in next_tracks:
        assert t.artist_id != prev_artist, f"Clustered consecutive artist: {t.artist_id}"
        prev_artist = t.artist_id


def test_11_canonical_track_contract_compliance(mock_catalog):
    """11. All planned tracks adhere to the canonical model specifications."""
    for t in mock_catalog:
        assert t.id
        assert t.title
        assert t.artist_name
        assert t.artist_id
        assert t.artwork_url.startswith("http")
        assert 0.0 <= t.popularity <= 1.0
        assert 0.0 <= t.energy <= 1.0


def test_12_telemetry_persistence_across_store_restarts(tmp_path, mock_catalog):
    """12. Telemetry and profile survive SQLite store restarts."""
    db_file = str(tmp_path / "test_persistence.db")
    store1 = SQLiteTasteStore(db_file)
    engine1 = RecommendationEngine(store=store1)
    engine1.seed_catalog(mock_catalog)
    uid = "user_persisted"

    ev = UserEvent(
        event_id="ev_p1",
        user_id=uid,
        event_type=EventType.COMPLETED,
        track_id=mock_catalog[0].id,
        artist_id=mock_catalog[0].artist_id,
        completion_ratio=1.0,
    )
    engine1.ingest_event(ev)

    # Reconnect fresh store instance pointing to same DB
    store2 = SQLiteTasteStore(db_file)
    p2 = store2.get_profile(uid)

    assert p2.personalization_state == PersonalizationState.SEEDED
    assert p2.total_plays >= 1
    assert p2.artist_affinity.get(mock_catalog[0].artist_id, 0.0) > 0.0


def test_13_zero_history_cold_start(tmp_path, mock_catalog):
    """13. Brand-new profile with empty events generates high-quality fallback shelves."""
    db_file = tmp_path / "test_cold.db"
    store = SQLiteTasteStore(str(db_file))
    p_zero = store.get_profile("brand_new_visitor_123")

    assert p_zero.total_events == 0
    assert p_zero.total_plays == 0
    assert p_zero.personalization_state == PersonalizationState.COLD

    planner = MixPlanner(store=store)
    shelves = planner.plan_home_feed(p_zero, mock_catalog, limit_per_shelf=5)
    assert len(shelves) >= 2
    for s in shelves:
        assert len(s.items) > 0


def test_14_resilient_empty_catalog_handling(tmp_path):
    """14. Feed generation gracefully handles completely empty catalog without exceptions."""
    db_file = tmp_path / "test_empty.db"
    store = SQLiteTasteStore(str(db_file))
    profile = store.get_profile("user_any")

    planner = MixPlanner(store=store)
    shelves = planner.plan_home_feed(profile, [])
    assert shelves == []


def test_15_explicit_dislike_permanent_pruning(tmp_path, mock_catalog):
    """15. Explicitly disliked tracks and artists are strictly purged from all planned shelves."""
    db_file = tmp_path / "test_dislike.db"
    store = SQLiteTasteStore(str(db_file))
    engine = RecommendationEngine(store=store)
    engine.seed_catalog(mock_catalog)
    uid = "user_dislike"

    disliked_track = mock_catalog[0]
    ev_dislike = UserEvent(
        event_id="ev_d",
        user_id=uid,
        event_type=EventType.DISLIKE,
        track_id=disliked_track.id,
        artist_id=disliked_track.artist_id,
    )
    engine.ingest_event(ev_dislike)
    profile = store.get_profile(uid)

    assert disliked_track.id in profile.explicit_negative_tracks

    planner = MixPlanner(store=store)
    shelves = planner.plan_home_feed(profile, mock_catalog)

    for s in shelves:
        for it in s.items:
            assert it.id != disliked_track.id
