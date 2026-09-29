"""SQLite persistence: identity map, negative cache, track metadata, events, item graph, stats.

Point lookups are sub-millisecond on a local WAL database, so they are called synchronously.
Use Postgres/Redis behind the same interface when you scale past one box.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Iterable, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS identity(
  saavn_id TEXT NOT NULL, ytm_video_id TEXT NOT NULL, confidence REAL NOT NULL, updated_at REAL NOT NULL,
  PRIMARY KEY(saavn_id, ytm_video_id));
CREATE INDEX IF NOT EXISTS idx_identity_ytm ON identity(ytm_video_id);
CREATE TABLE IF NOT EXISTS negative(kind TEXT NOT NULL, key TEXT NOT NULL, expires_at REAL NOT NULL, PRIMARY KEY(kind,key));
CREATE TABLE IF NOT EXISTS track_meta(saavn_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, user TEXT, session TEXT, track_id TEXT NOT NULL,
  kind TEXT NOT NULL, position_ms INTEGER DEFAULT 0, duration_ms INTEGER DEFAULT 0,
  organic INTEGER DEFAULT 1, source TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user, ts);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS track_stats(
  saavn_id TEXT PRIMARY KEY, plays INTEGER DEFAULT 0, skips INTEGER DEFAULT 0,
  completes INTEGER DEFAULT 0, likes INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS graph_edges(a TEXT NOT NULL, b TEXT NOT NULL, weight REAL NOT NULL, PRIMARY KEY(a,b));
CREATE INDEX IF NOT EXISTS idx_graph_a ON graph_edges(a, weight DESC);
CREATE TABLE IF NOT EXISTS idempotent_events(
  event_id TEXT PRIMARY KEY, user_hash TEXT, created_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS idx_idempotent_events_created ON idempotent_events(created_at);
"""

EVENT_KINDS = {"impression", "play_start", "complete", "skip", "like", "unlike", "dislike"}


class Store:
    def __init__(self, path: str = ":memory:"):
        self._c = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._lock = threading.RLock()
        with self._lock:
            self._c.execute("PRAGMA journal_mode=WAL")
            self._c.execute("PRAGMA synchronous=NORMAL")
            self._c.executescript(_SCHEMA)

    # ---- helpers
    def _q(self, sql: str, args: Iterable = ()):
        with self._lock:
            return self._c.execute(sql, tuple(args)).fetchall()

    def _x(self, sql: str, args: Iterable = ()):
        with self._lock:
            self._c.execute(sql, tuple(args))

    def _many(self, sql: str, rows: list):
        if not rows:
            return
        with self._lock:
            self._c.execute("BEGIN")
            try:
                self._c.executemany(sql, rows)
                self._c.execute("COMMIT")
            except Exception:
                self._c.execute("ROLLBACK")
                raise

    def close(self):
        with self._lock:
            self._c.close()

    # ---- identity map (YTM videoId <-> Saavn id), permanent
    def identity_get_by_ytm(self, vid: str) -> Optional[tuple[str, float]]:
        r = self._q("SELECT saavn_id, confidence FROM identity WHERE ytm_video_id=? ORDER BY confidence DESC LIMIT 1", (vid,))
        return (r[0][0], r[0][1]) if r else None

    def identity_get_by_saavn(self, sid: str) -> Optional[tuple[str, float]]:
        r = self._q("SELECT ytm_video_id, confidence FROM identity WHERE saavn_id=? ORDER BY confidence DESC LIMIT 1", (sid,))
        return (r[0][0], r[0][1]) if r else None

    def identity_put(self, saavn_id: str, vid: str, confidence: float) -> None:
        self._x("INSERT INTO identity(saavn_id,ytm_video_id,confidence,updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(saavn_id,ytm_video_id) DO UPDATE SET confidence=excluded.confidence, updated_at=excluded.updated_at",
                (saavn_id, vid, confidence, time.time()))

    def negative_has(self, kind: str, key: str) -> bool:
        r = self._q("SELECT expires_at FROM negative WHERE kind=? AND key=?", (kind, key))
        return bool(r) and r[0][0] > time.time()

    def negative_put(self, kind: str, key: str, ttl_s: float) -> None:
        self._x("INSERT INTO negative(kind,key,expires_at) VALUES(?,?,?) "
                "ON CONFLICT(kind,key) DO UPDATE SET expires_at=excluded.expires_at", (kind, key, time.time() + ttl_s))

    # ---- track metadata (so graph neighbours / history can be hydrated without upstream calls)
    def meta_put(self, cand) -> None:
        if not cand.saavn_id:
            return
        self._x("INSERT INTO track_meta(saavn_id,data,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(saavn_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                (cand.saavn_id, json.dumps(cand.to_meta(), ensure_ascii=False), time.time()))

    def meta_get(self, saavn_id: str) -> Optional[dict]:
        r = self._q("SELECT data FROM track_meta WHERE saavn_id=?", (saavn_id,))
        return json.loads(r[0][0]) if r else None

    def meta_get_many(self, ids: Iterable[str]) -> dict[str, dict]:
        ids = list(ids)
        out: dict[str, dict] = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            rows = self._q(f"SELECT saavn_id, data FROM track_meta WHERE saavn_id IN ({','.join('?' * len(chunk))})", chunk)
            out.update({sid: json.loads(d) for sid, d in rows})
        return out

    # ---- events
    def log_events(self, rows: list[dict]) -> None:
        now = time.time()
        self._many(
            "INSERT INTO events(ts,user,session,track_id,kind,position_ms,duration_ms,organic,source) VALUES(?,?,?,?,?,?,?,?,?)",
            [(r.get("ts", now), r.get("user"), r.get("session"), r["track_id"], r["kind"], int(r.get("position_ms", 0) or 0),
              int(r.get("duration_ms", 0) or 0), 1 if r.get("organic", True) else 0, r.get("source", "")) for r in rows])

    def update_stats(self, track_id: str, kind: str, position_ms: int, early_skip_ms: int) -> None:
        plays = skips = completes = likes = 0
        if kind == "complete":
            plays, completes = 1, 1
        elif kind == "skip":
            plays = 1
            skips = 1 if position_ms < early_skip_ms else 0
        elif kind == "like":
            likes = 1
        else:
            return
        self._x("INSERT INTO track_stats(saavn_id,plays,skips,completes,likes) VALUES(?,?,?,?,?) "
                "ON CONFLICT(saavn_id) DO UPDATE SET plays=plays+excluded.plays, skips=skips+excluded.skips, "
                "completes=completes+excluded.completes, likes=likes+excluded.likes",
                (track_id, plays, skips, completes, likes))

    def track_stats_get_many(self, ids: Iterable[str]) -> dict[str, dict]:
        ids = [i for i in ids if i]
        out: dict[str, dict] = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            rows = self._q("SELECT saavn_id,plays,skips,completes,likes FROM track_stats WHERE saavn_id IN "
                           f"({','.join('?' * len(chunk))})", chunk)
            out.update({r[0]: {"plays": r[1], "skips": r[2], "completes": r[3], "likes": r[4]} for r in rows})
        return out

    def user_events(self, user: str, since: float, kinds: Iterable[str]) -> list[tuple]:
        kinds = list(kinds)
        return self._q(
            "SELECT ts, track_id, kind, position_ms FROM events WHERE user=? AND ts>=? AND kind IN "
            f"({','.join('?' * len(kinds))}) ORDER BY ts DESC", [user, since, *kinds])

    def iter_graph_events(self, since: float):
        return self._q(
            "SELECT user, ts, track_id, kind, position_ms, organic FROM events "
            "WHERE ts>=? AND user IS NOT NULL AND kind IN ('complete','like','skip') ORDER BY user, ts", (since,))

    # ---- item graph
    def replace_edges(self, edges: list[tuple[str, str, float]]) -> None:
        with self._lock:
            self._c.execute("BEGIN")
            try:
                self._c.execute("DELETE FROM graph_edges")
                self._c.executemany("INSERT INTO graph_edges(a,b,weight) VALUES(?,?,?)", edges)
                self._c.execute("COMMIT")
            except Exception:
                self._c.execute("ROLLBACK")
                raise

    def neighbors(self, saavn_id: str, limit: int = 30) -> list[tuple[str, float]]:
        return [(r[0], r[1]) for r in self._q(
            "SELECT b, weight FROM graph_edges WHERE a=? ORDER BY weight DESC LIMIT ?", (saavn_id, limit))]

    # ---- idempotency
    def check_and_record_event(self, event_id: str, user_hash: Optional[str] = None, ttl_s: int = 86400) -> bool:
        """Atomically record event_id. Returns True if newly recorded, False if already seen within ttl_s."""
        now = time.time()
        with self._lock:
            self._c.execute("DELETE FROM idempotent_events WHERE created_at < ?", (now - ttl_s,))
            try:
                self._c.execute(
                    "INSERT INTO idempotent_events(event_id, user_hash, created_at) VALUES(?,?,?)",
                    (event_id, user_hash, now)
                )
                return True
            except sqlite3.IntegrityError:
                return False
