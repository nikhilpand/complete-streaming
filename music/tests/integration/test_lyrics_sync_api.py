"""
Integration tests for the Word Synchronization and Lyrics Alignment API endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.services.alignment.models import (
    LyricsDocument,
    LyricsLine,
    LyricsWord,
    SyncType,
)
from app.services.alignment.storage import storage


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


class TestLyricsSyncAPI:
    @pytest.mark.asyncio
    async def test_sync_endpoint_miss(self, client):
        resp = client.get("/api/v1/lyrics/sync/non_existent_track_999")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"] is None

    @pytest.mark.asyncio
    async def test_sync_endpoint_hit_after_storage(self, client):
        # Seed test document directly into storage
        doc = LyricsDocument(
            id="doc_sync_test",
            track_id="track_sync_1",
            identity_hash="hash_sync_1",
            title="Apna Bana Le",
            artist="Arijit Singh",
            duration_ms=260000,
            sync_type=SyncType.DERIVED_WORD,
            confidence=0.96,
            source_provider="alignment_worker",
            lines=[
                LyricsLine(
                    id=1,
                    start_ms=1000,
                    end_ms=3000,
                    original="Tu mera koi na",
                    words=[
                        LyricsWord(text="Tu", start_ms=1000, end_ms=1400, confidence=0.96),
                        LyricsWord(text="mera", start_ms=1450, end_ms=2000, confidence=0.97),
                        LyricsWord(text="koi", start_ms=2050, end_ms=2500, confidence=0.95),
                        LyricsWord(text="na", start_ms=2550, end_ms=3000, confidence=0.98),
                    ],
                )
            ],
        )
        await storage.save_lyrics(doc)

        # Retrieve by track_id
        resp = client.get("/api/v1/lyrics/sync/track_sync_1")
        assert resp.status_code == 200
        res_data = resp.json()
        assert res_data["success"] is True
        assert res_data["data"]["track_id"] == "track_sync_1"
        assert res_data["data"]["sync_type"] == "DERIVED_WORD"
        assert len(res_data["data"]["lines"]) == 1
        assert len(res_data["data"]["lines"][0]["words"]) == 4

        # Retrieve by identity_hash
        resp_hash = client.get("/api/v1/lyrics/sync/any_id?identity_hash=hash_sync_1")
        assert resp_hash.status_code == 200
        assert resp_hash.json()["data"]["identity_hash"] == "hash_sync_1"

    @pytest.mark.asyncio
    async def test_generate_and_poll_job(self, client):
        payload = {
            "title": "Chaleya",
            "artist": "Arijit Singh, Shilpa Rao",
            "duration_ms": 200000,
            "identity_hash": "hash_chaleya_test",
            "lines": [
                {
                    "id": 1,
                    "start_ms": 1000,
                    "end_ms": 3000,
                    "original": "Ishq mein dil bana hai",
                    "words": [],
                }
            ],
        }

        # 1. Trigger generate
        gen_resp = client.post("/api/v1/lyrics/chaleya_track/generate", json=payload)
        assert gen_resp.status_code == 200
        gen_data = gen_resp.json()
        assert gen_data["success"] is True
        job_id = gen_data["data"]["job_id"]
        assert job_id.startswith("job_")

        # 2. Poll job status
        poll_resp = client.get(f"/api/v1/lyrics/jobs/{job_id}")
        assert poll_resp.status_code == 200
        poll_data = poll_resp.json()
        assert poll_data["success"] is True
        assert poll_data["data"]["job_id"] == job_id
        assert poll_data["data"]["status"] in ("QUEUED", "PROCESSING", "COMPLETED", "FAILED")
