"""
Unit tests for the Word Synchronization Generation Layer.
"""

import pytest
import numpy as np
from app.services.alignment.models import (
    LyricsLine,
    LyricsWord,
    LyricsDocument,
    SyncType,
    JobStatus,
)
from app.services.alignment.normalizer import (
    tokenize_for_alignment,
    normalize_alignment_token,
    detect_script,
    is_devanagari,
    is_gurmukhi,
)
from app.services.alignment.audio_provider import AudioProvider
from app.services.alignment.validator import AlignmentValidator
from app.services.alignment.whisper_engine import WhisperAlignmentEngine
from app.services.alignment.storage import LyricsStorage


def test_normalizer_tokenization():
    raw_text = 'Kesariya, tera... "ishq" hai pia!'
    pairs = tokenize_for_alignment(raw_text)

    display_words = [d for d, _ in pairs]
    clean_words = [c for _, c in pairs]

    assert "Kesariya," in display_words
    assert "kesariya" in clean_words
    assert '"ishq"' in display_words
    assert "ishq" in clean_words
    assert "pia!" in display_words
    assert "pia" in clean_words


def test_normalizer_script_detection():
    hindi_text = "केसरिया तेरा इश्क़ है पिया"
    punjabi_text = "ਮੇਰਾ ਪੰਜਾਬ"
    english_text = "Blinding Lights by The Weeknd"

    assert is_devanagari(hindi_text) is True
    assert detect_script(hindi_text) == "devanagari"

    assert is_gurmukhi(punjabi_text) is True
    assert detect_script(punjabi_text) == "gurmukhi"

    assert detect_script(english_text) == "latin"


def test_audio_window_slicing():
    # 5 seconds at 16kHz
    dummy_audio = np.zeros(16000 * 5, dtype=np.float32)

    # Slice 1000ms to 3000ms with 200ms padding
    window, actual_start = AudioProvider.slice_window(
        dummy_audio,
        start_ms=1000,
        end_ms=3000,
        sample_rate=16000,
        pad_ms=200,
    )

    assert actual_start == 800  # 1000 - 200
    expected_samples = int((3200 - 800) / 1000.0 * 16000)
    assert len(window) == expected_samples


def test_validator_accepts_clean_alignment():
    line = LyricsLine(
        id=1,
        start_ms=1000,
        end_ms=3000,
        original="Tum hi ho bandhu",
    )
    words = [
        LyricsWord(text="Tum", start_ms=1000, end_ms=1400, confidence=0.92),
        LyricsWord(text="hi", start_ms=1420, end_ms=1800, confidence=0.95),
        LyricsWord(text="ho", start_ms=1820, end_ms=2300, confidence=0.88),
        LyricsWord(text="bandhu", start_ms=2320, end_ms=2980, confidence=0.91),
    ]

    res = AlignmentValidator.validate_line(line, words)
    assert res.is_valid is True
    assert res.confidence_score >= 0.85
    assert res.containment_rate == 1.0
    assert res.monotonicity_rate == 1.0


def test_validator_rejects_out_of_bounds():
    line = LyricsLine(
        id=2,
        start_ms=1000,
        end_ms=2000,
        original="Too far out",
    )
    # Words ending 3 seconds past line boundary
    words = [
        LyricsWord(text="Too", start_ms=1000, end_ms=1500, confidence=0.9),
        LyricsWord(text="far", start_ms=2500, end_ms=3500, confidence=0.9),
        LyricsWord(text="out", start_ms=4000, end_ms=5200, confidence=0.9),
    ]

    res = AlignmentValidator.validate_line(line, words)
    assert res.is_valid is False
    assert "Containment failure" in (res.rejection_reason or "")


def test_validator_rejects_reversed_timestamps():
    line = LyricsLine(
        id=3,
        start_ms=1000,
        end_ms=3000,
        original="Time goes backward",
    )
    # Word 2 starts before Word 1
    words = [
        LyricsWord(text="Time", start_ms=2000, end_ms=2500, confidence=0.9),
        LyricsWord(text="goes", start_ms=1200, end_ms=1600, confidence=0.9),
        LyricsWord(text="backward", start_ms=1000, end_ms=1100, confidence=0.9),
    ]

    res = AlignmentValidator.validate_line(line, words)
    assert res.is_valid is False
    assert "Monotonicity failure" in (res.rejection_reason or "")


def test_whisper_engine_interpolation_fallback():
    engine = WhisperAlignmentEngine()
    pairs = [("Na", "na"), ("jaane", "jaane"), ("kyun", "kyun")]

    words = engine._interpolate_line(pairs, line_start_ms=2000, line_end_ms=4000, base_conf=0.85)

    assert len(words) == 3
    assert words[0].text == "Na"
    assert words[0].start_ms == 2000
    assert words[-1].end_ms == 4000
    assert words[0].end_ms <= words[1].start_ms
    assert words[1].end_ms <= words[2].start_ms


@pytest.mark.asyncio
async def test_storage_repository_roundtrip(tmp_path):
    db_file = tmp_path / "test_lyrics.db"
    store = LyricsStorage(db_path=db_file)
    await store.initialize()

    # Create job
    job = await store.create_job(job_id="job_t1", track_id="song_1", identity_hash="hash_abc")
    assert job.status == JobStatus.QUEUED

    # Update job
    await store.update_job("job_t1", JobStatus.PROCESSING, progress=0.5)
    fetched_job = await store.get_job("job_t1")
    assert fetched_job is not None
    assert fetched_job.status == JobStatus.PROCESSING
    assert fetched_job.progress == 0.5

    # Save lyrics doc
    doc = LyricsDocument(
        id="doc_t1",
        track_id="song_1",
        identity_hash="hash_abc",
        title="Test Song",
        artist="Test Artist",
        duration_ms=180000,
        sync_type=SyncType.DERIVED_WORD,
        confidence=0.94,
        source_provider="alignment_worker",
        lines=[
            LyricsLine(
                id=1,
                start_ms=1000,
                end_ms=2500,
                original="Hello world",
                words=[
                    LyricsWord(text="Hello", start_ms=1000, end_ms=1700, confidence=0.95),
                    LyricsWord(text="world", start_ms=1750, end_ms=2500, confidence=0.93),
                ],
            )
        ],
    )
    await store.save_lyrics(doc)

    retrieved = await store.get_lyrics_by_hash("hash_abc")
    assert retrieved is not None
    assert retrieved.track_id == "song_1"
    assert retrieved.sync_type == SyncType.DERIVED_WORD
    assert len(retrieved.lines) == 1
    assert len(retrieved.lines[0].words) == 2
    assert retrieved.lines[0].words[0].text == "Hello"
