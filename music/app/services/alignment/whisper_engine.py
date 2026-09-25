"""
Whisper-based Alignment Engine utilizing line-constrained audio windowing.

Uses faster-whisper on CPU (int8) with thread pool execution to prevent event-loop blocking.
Performs monotonic token matching against authoritative lyric text.
"""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional, Tuple
import numpy as np

from app.services.alignment.engine_base import AlignmentEngineBase
from app.services.alignment.models import LyricsLine, LyricsWord
from app.services.alignment.normalizer import (
    tokenize_for_alignment,
    normalize_alignment_token,
    detect_script,
)

logger = logging.getLogger(__name__)

# Global model cache to avoid re-initializing weights on every request
_GLOBAL_WHISPER_MODEL = None
_MODEL_LOCK = asyncio.Lock()


def get_whisper_model(model_size: str = "base"):
    """Lazy load and cache WhisperModel."""
    global _GLOBAL_WHISPER_MODEL
    if _GLOBAL_WHISPER_MODEL is None:
        try:
            from faster_whisper import WhisperModel
            logger.info("Initializing faster-whisper model: %s (int8 on cpu)", model_size)
            _GLOBAL_WHISPER_MODEL = WhisperModel(model_size, device="cpu", compute_type="int8")
        except Exception as e:
            logger.warning("Failed to initialize faster-whisper: %s", e)
            _GLOBAL_WHISPER_MODEL = None
    return _GLOBAL_WHISPER_MODEL


class WhisperAlignmentEngine(AlignmentEngineBase):
    def __init__(self, model_size: str = "base"):
        self.model_size = model_size

    def _sync_align_line(
        self,
        audio_window_pcm: np.ndarray,
        window_start_ms: int,
        line: LyricsLine,
        sample_rate: int = 16000,
        language: Optional[str] = None,
    ) -> List[LyricsWord]:
        """Synchronous alignment execution run inside a worker thread."""
        pairs = tokenize_for_alignment(line.original)
        if not pairs:
            return []

        line_start = line.start_ms if line.start_ms is not None else window_start_ms
        line_end = line.end_ms if line.end_ms is not None else line_start + 3000
        line_dur_ms = max(200, line_end - line_start)

        # Detect language hint if not provided
        if not language:
            script = detect_script(line.original)
            if script == "devanagari":
                language = "hi"
            elif script == "gurmukhi":
                language = "pa"
            else:
                language = "en"

        model = get_whisper_model(self.model_size)
        if model is None or len(audio_window_pcm) == 0:
            return self._interpolate_line(pairs, line_start, line_end, base_conf=0.82)

        try:
            # faster-whisper requires float32 numpy array
            segments, _ = model.transcribe(
                audio_window_pcm,
                word_timestamps=True,
                initial_prompt=line.original,
                language=language,
                beam_size=1,
                temperature=0.0,
            )

            recognized_words: List[Tuple[str, float, float, float]] = []
            for seg in segments:
                if seg.words:
                    for w in seg.words:
                        clean_w = normalize_alignment_token(w.word)
                        if clean_w:
                            recognized_words.append((clean_w, w.start, w.end, w.probability))

            if not recognized_words:
                return self._interpolate_line(pairs, line_start, line_end, base_conf=0.80)

            # Monotonic matching between expected tokens and recognized words
            return self._match_tokens_to_words(
                pairs=pairs,
                recognized=recognized_words,
                window_start_ms=window_start_ms,
                line_start_ms=line_start,
                line_end_ms=line_end,
            )
        except Exception as e:
            logger.warning("Whisper alignment failed for line '%s': %s", line.original, e)
            return self._interpolate_line(pairs, line_start, line_end, base_conf=0.79)

    def align_line(
        self,
        audio_window_pcm: np.ndarray,
        window_start_ms: int,
        line: LyricsLine,
        sample_rate: int = 16000,
        language: Optional[str] = None,
    ) -> List[LyricsWord]:
        return self._sync_align_line(
            audio_window_pcm=audio_window_pcm,
            window_start_ms=window_start_ms,
            line=line,
            sample_rate=sample_rate,
            language=language,
        )

    async def align_line_async(
        self,
        audio_window_pcm: np.ndarray,
        window_start_ms: int,
        line: LyricsLine,
        sample_rate: int = 16000,
        language: Optional[str] = None,
    ) -> List[LyricsWord]:
        """Execute alignment inside a thread pool to avoid blocking the event loop."""
        return await asyncio.to_thread(
            self._sync_align_line,
            audio_window_pcm,
            window_start_ms,
            line,
            sample_rate,
            language,
        )

    def _match_tokens_to_words(
        self,
        pairs: List[Tuple[str, str]],
        recognized: List[Tuple[str, float, float, float]],
        window_start_ms: int,
        line_start_ms: int,
        line_end_ms: int,
    ) -> List[LyricsWord]:
        """
        Monotonically match authoritative display tokens with recognized timestamps.
        Any missing tokens are smoothly interpolated between acoustic anchor points.
        """
        n_expected = len(pairs)
        n_rec = len(recognized)

        # Matched array: list of Optional[Tuple[start_ms, end_ms, confidence]]
        matched: List[Optional[Tuple[int, int, float]]] = [None] * n_expected

        rec_idx = 0
        for exp_idx, (_, exp_clean) in enumerate(pairs):
            best_match_idx = -1
            best_score = 0.0

            # Look forward up to 3 tokens in recognized list
            for check_idx in range(rec_idx, min(n_rec, rec_idx + 4)):
                rec_clean, r_start, r_end, r_prob = recognized[check_idx]
                if exp_clean == rec_clean or exp_clean in rec_clean or rec_clean in exp_clean:
                    best_match_idx = check_idx
                    best_score = r_prob
                    break

            if best_match_idx != -1:
                _, r_start, r_end, r_prob = recognized[best_match_idx]
                abs_start = window_start_ms + int(r_start * 1000)
                abs_end = window_start_ms + int(r_end * 1000)

                # Clamp to line boundary tolerance
                abs_start = max(line_start_ms - 150, min(line_end_ms, abs_start))
                abs_end = max(abs_start + 40, min(line_end_ms + 150, abs_end))

                matched[exp_idx] = (abs_start, abs_end, max(0.65, min(1.0, float(best_score))))
                rec_idx = best_match_idx + 1

        # Interpolate any unanchored tokens
        final_words: List[LyricsWord] = []
        for i, (disp_tok, _) in enumerate(pairs):
            if matched[i] is not None:
                st, en, conf = matched[i]  # type: ignore
                final_words.append(LyricsWord(text=disp_tok, start_ms=st, end_ms=en, confidence=conf))
            else:
                # Find previous anchor
                prev_end = line_start_ms
                for p in range(i - 1, -1, -1):
                    if matched[p] is not None:
                        prev_end = matched[p][1]  # type: ignore
                        break

                # Find next anchor
                next_start = line_end_ms
                for n in range(i + 1, n_expected):
                    if matched[n] is not None:
                        next_start = matched[n][0]  # type: ignore
                        break

                span = max(50, next_start - prev_end)
                # Count unanchored gap length
                gap_start_idx = i
                while gap_start_idx > 0 and matched[gap_start_idx - 1] is None:
                    gap_start_idx -= 1
                gap_end_idx = i
                while gap_end_idx < n_expected - 1 and matched[gap_end_idx + 1] is None:
                    gap_end_idx += 1

                gap_len = gap_end_idx - gap_start_idx + 1
                pos_in_gap = i - gap_start_idx

                step = span / gap_len
                st = int(prev_end + (pos_in_gap * step))
                en = int(st + step)
                final_words.append(LyricsWord(text=disp_tok, start_ms=st, end_ms=max(st + 40, en), confidence=0.75))

        return final_words

    def _interpolate_line(
        self,
        pairs: List[Tuple[str, str]],
        line_start_ms: int,
        line_end_ms: int,
        base_conf: float = 0.80,
    ) -> List[LyricsWord]:
        """Fallback character-weighted acoustic interpolation across line boundaries."""
        total_chars = sum(len(clean) for _, clean in pairs)
        if total_chars == 0:
            total_chars = len(pairs)

        duration = max(100, line_end_ms - line_start_ms)
        curr = line_start_ms
        words: List[LyricsWord] = []

        for idx, (disp, clean) in enumerate(pairs):
            if idx == len(pairs) - 1:
                w_end = line_end_ms
            else:
                weight = max(1, len(clean)) / total_chars
                w_dur = max(50, int(duration * weight))
                w_end = min(line_end_ms, curr + w_dur)
            words.append(LyricsWord(text=disp, start_ms=curr, end_ms=max(curr + 40, w_end), confidence=base_conf))
            curr = w_end

        return words
