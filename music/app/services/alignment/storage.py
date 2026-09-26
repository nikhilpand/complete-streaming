"""
Persistent storage repository for Word Synchronization and Alignment Jobs.

Supports SQLite via aiosqlite (default) with WAL mode, non-blocking asynchronous access,
and thread-safe connection pooling.
"""

from __future__ import annotations

import json
import os
import aiosqlite
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.services.alignment.models import (
    LyricsDocument,
    AlignmentJob,
    JobStatus,
    SyncType,
)


DEFAULT_DB_PATH = Path("data/lyrics_sync.db")


class LyricsStorage:
    def __init__(self, db_path: str | Path = DEFAULT_DB_PATH):
        self.db_path = Path(db_path)
        self._initialized = False

    async def initialize(self) -> None:
        """Create directory and tables with WAL mode and indices."""
        if self._initialized:
            return

        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA journal_mode = WAL;")
            await db.execute("PRAGMA busy_timeout = 5000;")
            await db.execute("PRAGMA synchronous = NORMAL;")

            await db.execute("""
                CREATE TABLE IF NOT EXISTS lyrics_sync (
                    track_id TEXT PRIMARY KEY,
                    canonical_track_key TEXT,
                    identity_hash TEXT NOT NULL,
                    engine_version TEXT NOT NULL DEFAULT 'v4',
                    provider TEXT,
                    provider_track_id TEXT,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL,
                    duration_ms INTEGER,
                    sync_type TEXT NOT NULL,
                    document_json TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    match_confidence REAL DEFAULT 1.0,
                    timing_confidence REAL DEFAULT 1.0,
                    line_source_confidence REAL DEFAULT 1.0,
                    alignment_confidence REAL DEFAULT 1.0,
                    engine TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)

            # Safe migrations for existing databases
            cursor = await db.execute("PRAGMA table_info(lyrics_sync);")
            cols = {row[1] for row in await cursor.fetchall()}
            if "canonical_track_key" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN canonical_track_key TEXT;")
            if "engine_version" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN engine_version TEXT NOT NULL DEFAULT 'v4';")
            if "provider" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN provider TEXT;")
            if "provider_track_id" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN provider_track_id TEXT;")
            if "match_confidence" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN match_confidence REAL DEFAULT 1.0;")
            if "timing_confidence" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN timing_confidence REAL DEFAULT 1.0;")
            if "line_source_confidence" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN line_source_confidence REAL DEFAULT 1.0;")
            if "alignment_confidence" not in cols:
                await db.execute("ALTER TABLE lyrics_sync ADD COLUMN alignment_confidence REAL DEFAULT 1.0;")

            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_lyrics_identity_hash
                ON lyrics_sync (identity_hash);
            """)

            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_lyrics_canonical_key
                ON lyrics_sync (canonical_track_key);
            """)

            await db.execute("""
                CREATE TABLE IF NOT EXISTS lyrics_jobs (
                    job_id TEXT PRIMARY KEY,
                    track_id TEXT NOT NULL,
                    canonical_track_key TEXT,
                    provider TEXT,
                    provider_track_id TEXT,
                    identity_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress REAL DEFAULT 0.0,
                    error TEXT,
                    sync_type TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)

            # Safe migrations for jobs
            j_cursor = await db.execute("PRAGMA table_info(lyrics_jobs);")
            j_cols = {row[1] for row in await j_cursor.fetchall()}
            if "canonical_track_key" not in j_cols:
                await db.execute("ALTER TABLE lyrics_jobs ADD COLUMN canonical_track_key TEXT;")
            if "provider" not in j_cols:
                await db.execute("ALTER TABLE lyrics_jobs ADD COLUMN provider TEXT;")
            if "provider_track_id" not in j_cols:
                await db.execute("ALTER TABLE lyrics_jobs ADD COLUMN provider_track_id TEXT;")

            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_jobs_identity_status
                ON lyrics_jobs (identity_hash, status);
            """)

            await db.commit()

        self._initialized = True

    async def get_lyrics_by_id(self, track_id: str) -> Optional[LyricsDocument]:
        """Fetch lyrics document by track ID."""
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT document_json FROM lyrics_sync WHERE track_id = ?",
                (track_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return LyricsDocument.model_validate_json(row["document_json"])

    async def get_lyrics_by_hash(self, identity_hash: str) -> Optional[LyricsDocument]:
        """Fetch lyrics document by track identity hash."""
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT document_json FROM lyrics_sync WHERE identity_hash = ? ORDER BY confidence DESC LIMIT 1",
                (identity_hash,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return LyricsDocument.model_validate_json(row["document_json"])

    async def get_lyrics_by_canonical_key(
        self,
        canonical_track_key: str,
        identity_hash: Optional[str] = None,
    ) -> Optional[LyricsDocument]:
        """Fetch lyrics document by canonical track key (e.g. 'youtube:xyz', 'saavn:123') and optional hash."""
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            if identity_hash:
                cursor = await db.execute(
                    """
                    SELECT document_json FROM lyrics_sync
                    WHERE (canonical_track_key = ? OR track_id = ?) AND identity_hash = ?
                    ORDER BY confidence DESC LIMIT 1
                    """,
                    (canonical_track_key, canonical_track_key, identity_hash),
                )
            else:
                cursor = await db.execute(
                    """
                    SELECT document_json FROM lyrics_sync
                    WHERE canonical_track_key = ? OR track_id = ?
                    ORDER BY confidence DESC LIMIT 1
                    """,
                    (canonical_track_key, canonical_track_key),
                )
            row = await cursor.fetchone()
            if not row:
                return None
            return LyricsDocument.model_validate_json(row["document_json"])

    async def save_lyrics(self, doc: LyricsDocument) -> None:
        """Upsert a lyrics document with complete versioned fields."""
        await self.initialize()
        now = datetime.now(timezone.utc).isoformat()
        doc_json = doc.model_dump_json()

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO lyrics_sync (
                    track_id, canonical_track_key, identity_hash, engine_version,
                    provider, provider_track_id, title, artist, duration_ms,
                    sync_type, document_json, confidence, match_confidence,
                    timing_confidence, line_source_confidence, alignment_confidence,
                    engine, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(track_id) DO UPDATE SET
                    canonical_track_key = excluded.canonical_track_key,
                    identity_hash = excluded.identity_hash,
                    engine_version = excluded.engine_version,
                    provider = excluded.provider,
                    provider_track_id = excluded.provider_track_id,
                    title = excluded.title,
                    artist = excluded.artist,
                    duration_ms = excluded.duration_ms,
                    sync_type = excluded.sync_type,
                    document_json = excluded.document_json,
                    confidence = excluded.confidence,
                    match_confidence = excluded.match_confidence,
                    timing_confidence = excluded.timing_confidence,
                    line_source_confidence = excluded.line_source_confidence,
                    alignment_confidence = excluded.alignment_confidence,
                    engine = excluded.engine,
                    updated_at = excluded.updated_at
                WHERE excluded.confidence >= lyrics_sync.confidence
                """,
                (
                    doc.track_id,
                    doc.canonical_track_key or doc.track_id,
                    doc.identity_hash,
                    doc.engine_version,
                    doc.provider,
                    doc.provider_track_id,
                    doc.title,
                    doc.artist,
                    doc.duration_ms,
                    doc.sync_type.value,
                    doc_json,
                    doc.confidence,
                    doc.match_confidence,
                    doc.timing_confidence,
                    doc.line_source_confidence,
                    doc.alignment_confidence,
                    doc.engine_used or "unknown",
                    now,
                    now,
                ),
            )
            await db.commit()

    async def create_job(
        self,
        job_id: str,
        track_id: str,
        identity_hash: str,
        canonical_track_key: Optional[str] = None,
        provider: Optional[str] = None,
        provider_track_id: Optional[str] = None,
    ) -> AlignmentJob:
        """Create and queue a new alignment job."""
        await self.initialize()
        now = datetime.now(timezone.utc).isoformat()
        job = AlignmentJob(
            job_id=job_id,
            track_id=track_id,
            canonical_track_key=canonical_track_key or track_id,
            provider=provider,
            provider_track_id=provider_track_id,
            identity_hash=identity_hash,
            status=JobStatus.QUEUED,
            progress=0.0,
        )

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO lyrics_jobs (
                    job_id, track_id, canonical_track_key, provider, provider_track_id,
                    identity_hash, status, progress, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job.job_id,
                    job.track_id,
                    job.canonical_track_key,
                    job.provider,
                    job.provider_track_id,
                    job.identity_hash,
                    job.status.value,
                    job.progress,
                    now,
                    now,
                ),
            )
            await db.commit()

        return job

    async def get_job(self, job_id: str) -> Optional[AlignmentJob]:
        """Fetch job by ID."""
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM lyrics_jobs WHERE job_id = ?",
                (job_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return AlignmentJob(
                job_id=row["job_id"],
                track_id=row["track_id"],
                canonical_track_key=row["canonical_track_key"] if "canonical_track_key" in row.keys() else row["track_id"],
                provider=row["provider"] if "provider" in row.keys() else None,
                provider_track_id=row["provider_track_id"] if "provider_track_id" in row.keys() else None,
                identity_hash=row["identity_hash"],
                status=JobStatus(row["status"]),
                progress=row["progress"],
                error=row["error"],
                sync_type=SyncType(row["sync_type"]) if row["sync_type"] else None,
                created_at=datetime.fromisoformat(row["created_at"]),
                updated_at=datetime.fromisoformat(row["updated_at"]),
            )

    async def get_active_job_by_hash(self, identity_hash: str) -> Optional[AlignmentJob]:
        """Find if a job is currently queued or processing for the given identity hash."""
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT * FROM lyrics_jobs 
                WHERE identity_hash = ? AND status IN ('QUEUED', 'PROCESSING')
                ORDER BY created_at DESC LIMIT 1
                """,
                (identity_hash,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return AlignmentJob(
                job_id=row["job_id"],
                track_id=row["track_id"],
                canonical_track_key=row["canonical_track_key"] if "canonical_track_key" in row.keys() else row["track_id"],
                provider=row["provider"] if "provider" in row.keys() else None,
                provider_track_id=row["provider_track_id"] if "provider_track_id" in row.keys() else None,
                identity_hash=row["identity_hash"],
                status=JobStatus(row["status"]),
                progress=row["progress"],
                error=row["error"],
                sync_type=SyncType(row["sync_type"]) if row["sync_type"] else None,
                created_at=datetime.fromisoformat(row["created_at"]),
                updated_at=datetime.fromisoformat(row["updated_at"]),
            )

    async def update_job(
        self,
        job_id: str,
        status: JobStatus,
        progress: float = 0.0,
        error: Optional[str] = None,
        sync_type: Optional[SyncType] = None,
    ) -> None:
        """Update job status and progress."""
        await self.initialize()
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                UPDATE lyrics_jobs
                SET status = ?, progress = ?, error = ?, sync_type = ?, updated_at = ?
                WHERE job_id = ?
                """,
                (
                    status.value,
                    progress,
                    error,
                    sync_type.value if sync_type else None,
                    now,
                    job_id,
                ),
            )
            await db.commit()


# Singleton instance for the application
storage = LyricsStorage()
