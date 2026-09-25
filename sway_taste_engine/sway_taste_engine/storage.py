from __future__ import annotations

import json
import sqlite3
from abc import ABC, abstractmethod
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from threading import RLock
from typing import Generator

from .models import Track, UserEvent, UserTasteProfile, EventType


class TasteStore(ABC):
    """Abstract interface for SWAY Taste & Recommendation data persistence."""

    @abstractmethod
    def upsert_track(self, track: Track) -> None:
        """Upsert a single track and its metadata/features."""
        ...

    @abstractmethod
    def upsert_tracks(self, tracks: list[Track]) -> None:
        """Batch upsert tracks."""
        ...

    @abstractmethod
    def get_track(self, track_id: str) -> Track | None:
        """Retrieve a track by ID."""
        ...

    @abstractmethod
    def all_tracks(self) -> list[Track]:
        """Retrieve all known tracks."""
        ...

    @abstractmethod
    def add_event(self, event: UserEvent) -> bool:
        """Record a user telemetry event. Returns True if stored, False if duplicate."""
        ...

    @abstractmethod
    def user_events(self, user_id: str) -> list[UserEvent]:
        """Retrieve all events recorded for a given user."""
        ...

    @abstractmethod
    def get_recent_events(self, user_id: str, days: int = 30) -> list[UserEvent]:
        """Retrieve events for a user within the specified past day horizon."""
        ...

    @abstractmethod
    def session_events_for(self, session_id: str) -> list[UserEvent]:
        """Retrieve events associated with a specific session ID."""
        ...

    @abstractmethod
    def get_profile(self, user_id: str) -> UserTasteProfile:
        """Retrieve a user taste profile or return a default empty profile."""
        ...

    @abstractmethod
    def save_profile(self, profile: UserTasteProfile) -> None:
        """Persist a user taste profile."""
        ...

    @abstractmethod
    def save_similarity_edges(self, edges: list[tuple[str, str, float, str]]) -> None:
        """Batch upsert similarity graph edges: (from_track_id, to_track_id, score, source)."""
        ...

    @abstractmethod
    def get_top_k_similar_tracks(self, track_id: str, k: int = 20) -> list[tuple[str, float]]:
        """O(1) query returning top-K similar track IDs and scores, sorted descending by score."""
        ...

    @abstractmethod
    def record_transition(self, from_track_id: str, to_track_id: str, completed: bool = True) -> None:
        """Record a sequential transition from track A to track B."""
        ...

    @abstractmethod
    def get_transition_score(self, from_track_id: str, to_track_id: str) -> float:
        """Calculate transition affinity score between track A and track B."""
        ...

    @abstractmethod
    def get_transitions_from(self, from_track_id: str, limit: int = 20) -> list[tuple[str, float]]:
        """Retrieve the top transition targets from track A with scores."""
        ...


class InMemoryStore(TasteStore):
    """Thread-safe in-memory store for unit tests and local mock execution."""

    def __init__(self) -> None:
        self._lock = RLock()
        self.tracks: dict[str, Track] = {}
        self.events: dict[str, UserEvent] = {}
        self.events_by_user: dict[str, list[str]] = defaultdict(list)
        self.session_events: dict[str, list[str]] = defaultdict(list)
        self.profiles: dict[str, UserTasteProfile] = {}
        # similarity_edges: from_track_id -> {to_track_id: (score, source)}
        self.similarity_edges: dict[str, dict[str, tuple[float, str]]] = defaultdict(dict)
        # transitions: from_track_id -> to_track_id -> {"completed": int, "skipped": int}
        self.transitions: dict[str, dict[str, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: {"completed": 0, "skipped": 0})
        )

    def upsert_track(self, track: Track) -> None:
        with self._lock:
            self.tracks[track.id] = track

    def upsert_tracks(self, tracks: list[Track]) -> None:
        with self._lock:
            for track in tracks:
                self.tracks[track.id] = track

    def get_track(self, track_id: str) -> Track | None:
        with self._lock:
            return self.tracks.get(track_id)

    def all_tracks(self) -> list[Track]:
        with self._lock:
            return list(self.tracks.values())

    def add_event(self, event: UserEvent) -> bool:
        with self._lock:
            if event.event_id in self.events:
                return False
            self.events[event.event_id] = event
            self.events_by_user[event.user_id].append(event.event_id)
            if event.session_id:
                self.session_events[event.session_id].append(event.event_id)
            return True

    def user_events(self, user_id: str) -> list[UserEvent]:
        with self._lock:
            return [self.events[eid] for eid in self.events_by_user.get(user_id, [])]

    def get_recent_events(self, user_id: str, days: int = 30) -> list[UserEvent]:
        with self._lock:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            res = []
            for eid in self.events_by_user.get(user_id, []):
                ev = self.events[eid]
                ts = ev.timestamp
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if ts >= cutoff:
                    res.append(ev)
            return res

    def session_events_for(self, session_id: str) -> list[UserEvent]:
        with self._lock:
            return [self.events[eid] for eid in self.session_events.get(session_id, [])]

    def get_profile(self, user_id: str) -> UserTasteProfile:
        with self._lock:
            if user_id not in self.profiles:
                self.profiles[user_id] = UserTasteProfile(user_id=user_id)
            return self.profiles[user_id]

    def save_profile(self, profile: UserTasteProfile) -> None:
        with self._lock:
            self.profiles[profile.user_id] = profile

    def save_similarity_edges(self, edges: list[tuple[str, str, float, str]]) -> None:
        with self._lock:
            for from_id, to_id, score, source in edges:
                self.similarity_edges[from_id][to_id] = (score, source)

    def get_top_k_similar_tracks(self, track_id: str, k: int = 20) -> list[tuple[str, float]]:
        with self._lock:
            targets = self.similarity_edges.get(track_id, {})
            # Sort by score descending
            sorted_items = sorted(targets.items(), key=lambda item: item[1][0], reverse=True)
            return [(target_id, score_source[0]) for target_id, score_source in sorted_items[:k]]

    def record_transition(self, from_track_id: str, to_track_id: str, completed: bool = True) -> None:
        with self._lock:
            stats = self.transitions[from_track_id][to_track_id]
            if completed:
                stats["completed"] += 1
            else:
                stats["skipped"] += 1

    def get_transition_score(self, from_track_id: str, to_track_id: str) -> float:
        with self._lock:
            stats = self.transitions.get(from_track_id, {}).get(to_track_id)
            if not stats:
                return 0.0
            comp = stats["completed"]
            skip = stats["skipped"]
            total = comp + skip
            if total == 0:
                return 0.0
            # Continuity score: completions weighted positively, skips penalized
            raw = (comp - 0.75 * skip) / total
            return max(0.0, min(1.0, (raw + 1.0) / 2.0))

    def get_transitions_from(self, from_track_id: str, limit: int = 20) -> list[tuple[str, float]]:
        with self._lock:
            targets = self.transitions.get(from_track_id, {})
            scored = []
            for target_id in targets:
                score = self.get_transition_score(from_track_id, target_id)
                scored.append((target_id, score))
            scored.sort(key=lambda x: x[1], reverse=True)
            return scored[:limit]


class SQLiteTasteStore(TasteStore):
    """Production-grade SQLite persistence store for SWAY recommendations.

    Configured with WAL mode, non-blocking busy timeouts, atomic transactions,
    and indexed tables for sub-millisecond retrieval.
    """

    def __init__(self, db_path: str = "music_recs.db", timeout: float = 5.0) -> None:
        self.db_path = db_path
        self.timeout = timeout
        self._catalog_cache: dict[str, Track] | None = None
        self._init_db()

    @contextmanager
    def _connect(self) -> Generator[sqlite3.Connection, None, None]:
        conn = sqlite3.connect(
            self.db_path,
            timeout=self.timeout,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA busy_timeout = 5000;")
            conn.execute("PRAGMA synchronous = NORMAL;")

            # 1. Tracks
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tracks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    album TEXT,
                    year INTEGER,
                    language TEXT,
                    duration_ms INTEGER,
                    data_json TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

            # 2. Event Telemetry
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS event_telemetry (
                    event_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    account_id TEXT,
                    anonymous_id TEXT,
                    session_id TEXT,
                    track_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    duration_ms INTEGER,
                    completion_ratio REAL,
                    effective_weight REAL,
                    data_json TEXT NOT NULL
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_event_user_ts ON event_telemetry(user_id, timestamp);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_event_session ON event_telemetry(session_id);"
            )

            # 3. Taste Profiles
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS taste_profiles (
                    user_id TEXT PRIMARY KEY,
                    profile_json TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

            # 4. Similarity Edges (Precomputed top-K graph)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS similarity_edges (
                    from_track_id TEXT NOT NULL,
                    to_track_id TEXT NOT NULL,
                    score REAL NOT NULL,
                    source TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (from_track_id, to_track_id)
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_similarity_lookup ON similarity_edges(from_track_id, score DESC);"
            )

            # 5. Track Transitions (A -> B sequence continuations)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS track_transitions (
                    from_track_id TEXT NOT NULL,
                    to_track_id TEXT NOT NULL,
                    count_completed INTEGER DEFAULT 0,
                    count_skipped INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (from_track_id, to_track_id)
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_transitions_lookup ON track_transitions(from_track_id);"
            )

    def upsert_track(self, track: Track) -> None:
        self.upsert_tracks([track])

    def upsert_tracks(self, tracks: list[Track]) -> None:
        if not tracks:
            return
        if self._catalog_cache is not None:
            for t in tracks:
                self._catalog_cache[t.id] = t
        rows = [
            (
                t.id,
                t.title,
                t.album,
                t.year,
                t.language,
                t.duration_ms,
                t.model_dump_json(),
            )
            for t in tracks
        ]
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO tracks (id, title, album, year, language, duration_ms, data_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    album=excluded.album,
                    year=excluded.year,
                    language=excluded.language,
                    duration_ms=excluded.duration_ms,
                    data_json=excluded.data_json,
                    updated_at=CURRENT_TIMESTAMP;
                """,
                rows,
            )

    def get_track(self, track_id: str) -> Track | None:
        if self._catalog_cache is not None and track_id in self._catalog_cache:
            return self._catalog_cache[track_id]
        with self._connect() as conn:
            row = conn.execute(
                "SELECT data_json FROM tracks WHERE id = ?;", (track_id,)
            ).fetchone()
            if not row:
                return None
            track = Track.model_validate_json(row["data_json"])
            if self._catalog_cache is not None:
                self._catalog_cache[track_id] = track
            return track

    def all_tracks(self) -> list[Track]:
        if self._catalog_cache is not None:
            return list(self._catalog_cache.values())
        with self._connect() as conn:
            rows = conn.execute("SELECT data_json FROM tracks;").fetchall()
            tracks = [Track.model_validate_json(r["data_json"]) for r in rows]
            self._catalog_cache = {t.id: t for t in tracks}
            return tracks

    @property
    def tracks(self) -> dict[str, Track]:
        if self._catalog_cache is None:
            self.all_tracks()
        return self._catalog_cache or {}

    def add_event(self, event: UserEvent) -> bool:
        ts_str = event.timestamp.isoformat()
        data_json = event.model_dump_json()
        try:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO event_telemetry (
                        event_id, user_id, account_id, anonymous_id, session_id,
                        track_id, event_type, timestamp, duration_ms, completion_ratio,
                        effective_weight, data_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        event.event_id,
                        event.user_id,
                        event.account_id,
                        event.anonymous_id,
                        event.session_id,
                        event.track_id,
                        event.event_type.value if hasattr(event.event_type, "value") else str(event.event_type),
                        ts_str,
                        event.duration_ms,
                        event.completion_ratio,
                        event.effective_weight,
                        data_json,
                    ),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def user_events(self, user_id: str) -> list[UserEvent]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT data_json FROM event_telemetry WHERE user_id = ? ORDER BY timestamp ASC;",
                (user_id,),
            ).fetchall()
            return [UserEvent.model_validate_json(r["data_json"]) for r in rows]

    def get_recent_events(self, user_id: str, days: int = 30) -> list[UserEvent]:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT data_json FROM event_telemetry
                WHERE user_id = ? AND timestamp >= ?
                ORDER BY timestamp ASC;
                """,
                (user_id, cutoff),
            ).fetchall()
            return [UserEvent.model_validate_json(r["data_json"]) for r in rows]

    def session_events_for(self, session_id: str) -> list[UserEvent]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT data_json FROM event_telemetry WHERE session_id = ? ORDER BY timestamp ASC;",
                (session_id,),
            ).fetchall()
            return [UserEvent.model_validate_json(r["data_json"]) for r in rows]

    def get_profile(self, user_id: str) -> UserTasteProfile:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT profile_json FROM taste_profiles WHERE user_id = ?;", (user_id,)
            ).fetchone()
            if not row:
                return UserTasteProfile(user_id=user_id)
            return UserTasteProfile.model_validate_json(row["profile_json"])

    def save_profile(self, profile: UserTasteProfile) -> None:
        data_json = profile.model_dump_json()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO taste_profiles (user_id, profile_json, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    profile_json=excluded.profile_json,
                    updated_at=CURRENT_TIMESTAMP;
                """,
                (profile.user_id, data_json),
            )

    def save_similarity_edges(self, edges: list[tuple[str, str, float, str]]) -> None:
        if not edges:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO similarity_edges (from_track_id, to_track_id, score, source, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(from_track_id, to_track_id) DO UPDATE SET
                    score=excluded.score,
                    source=excluded.source,
                    updated_at=CURRENT_TIMESTAMP;
                """,
                edges,
            )

    def get_top_k_similar_tracks(self, track_id: str, k: int = 20) -> list[tuple[str, float]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT to_track_id, score FROM similarity_edges
                WHERE from_track_id = ?
                ORDER BY score DESC
                LIMIT ?;
                """,
                (track_id, k),
            ).fetchall()
            return [(r["to_track_id"], float(r["score"])) for r in rows]

    def record_transition(self, from_track_id: str, to_track_id: str, completed: bool = True) -> None:
        col = "count_completed" if completed else "count_skipped"
        with self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO track_transitions (from_track_id, to_track_id, {col}, updated_at)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(from_track_id, to_track_id) DO UPDATE SET
                    {col} = {col} + 1,
                    updated_at = CURRENT_TIMESTAMP;
                """,
                (from_track_id, to_track_id),
            )

    def get_transition_score(self, from_track_id: str, to_track_id: str) -> float:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT count_completed, count_skipped FROM track_transitions
                WHERE from_track_id = ? AND to_track_id = ?;
                """,
                (from_track_id, to_track_id),
            ).fetchone()
            if not row:
                return 0.0
            comp = row["count_completed"]
            skip = row["count_skipped"]
            total = comp + skip
            if total == 0:
                return 0.0
            raw = (comp - 0.75 * skip) / total
            return max(0.0, min(1.0, (raw + 1.0) / 2.0))

    def get_transitions_from(self, from_track_id: str, limit: int = 20) -> list[tuple[str, float]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT to_track_id, count_completed, count_skipped FROM track_transitions
                WHERE from_track_id = ?;
                """,
                (from_track_id,),
            ).fetchall()
            scored = []
            for r in rows:
                comp = r["count_completed"]
                skip = r["count_skipped"]
                total = comp + skip
                if total > 0:
                    raw = (comp - 0.75 * skip) / total
                    score = max(0.0, min(1.0, (raw + 1.0) / 2.0))
                    scored.append((r["to_track_id"], score))
            scored.sort(key=lambda x: x[1], reverse=True)
            return scored[:limit]
