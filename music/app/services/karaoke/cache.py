"""
SQLite persistence for karaoke job records.
"""
from __future__ import annotations

import aiosqlite
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.services.karaoke.models import KaraokeJobRecord, KaraokeStatus

DEFAULT_DB_PATH = Path("data/karaoke.db")

class KaraokeCache:
    def __init__(self, db_path: str | Path = DEFAULT_DB_PATH):
        self.db_path = Path(db_path)
        self._initialized = False

    async def initialize(self) -> None:
        if self._initialized:
            return
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA journal_mode = WAL;")
            await db.execute("PRAGMA busy_timeout = 5000;")
            await db.execute("PRAGMA synchronous = NORMAL;")
            await db.execute("""
                CREATE TABLE IF NOT EXISTS karaoke_jobs (
                    track_id TEXT PRIMARY KEY,
                    canonical_track_key TEXT,
                    status TEXT NOT NULL,
                    progress REAL DEFAULT 0.0,
                    error TEXT,
                    vocals_path TEXT,
                    instrumental_path TEXT,
                    model_used TEXT,
                    duration_sec REAL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)
            await db.commit()
        self._initialized = True

    async def get(self, track_id: str) -> Optional[KaraokeJobRecord]:
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT * FROM karaoke_jobs WHERE track_id = ?", (track_id,)
            )
            row = await cur.fetchone()
            if not row:
                return None
            return KaraokeJobRecord(
                track_id=row["track_id"],
                canonical_track_key=row["canonical_track_key"],
                status=KaraokeStatus(row["status"]),
                progress=row["progress"],
                error=row["error"],
                vocals_path=row["vocals_path"],
                instrumental_path=row["instrumental_path"],
                model_used=row["model_used"],
                duration_sec=row["duration_sec"],
                created_at=datetime.fromisoformat(row["created_at"]),
                updated_at=datetime.fromisoformat(row["updated_at"]),
            )

    async def upsert(self, rec: KaraokeJobRecord) -> None:
        await self.initialize()
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT INTO karaoke_jobs (
                    track_id, canonical_track_key, status, progress, error,
                    vocals_path, instrumental_path, model_used, duration_sec,
                    created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(track_id) DO UPDATE SET
                    canonical_track_key = excluded.canonical_track_key,
                    status = excluded.status,
                    progress = excluded.progress,
                    error = excluded.error,
                    vocals_path = excluded.vocals_path,
                    instrumental_path = excluded.instrumental_path,
                    model_used = excluded.model_used,
                    duration_sec = excluded.duration_sec,
                    updated_at = excluded.updated_at
            """, (
                rec.track_id,
                rec.canonical_track_key,
                rec.status.value,
                rec.progress,
                rec.error,
                rec.vocals_path,
                rec.instrumental_path,
                rec.model_used,
                rec.duration_sec,
                now,
                now,
            ))
            await db.commit()

karaoke_cache = KaraokeCache()
