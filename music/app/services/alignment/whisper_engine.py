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
from app.services.alignment.models import LyricsLine, LyricsWord, WordTimingType
from app.services.alignment.normalizer import (
    tokenize_for_alignment,
    normalize_alignment_token,
    detect_script,
    detect_language,
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

    def align_track(
        self,
        audio_pcm: np.ndarray,
        lines: List[LyricsLine],
        sample_rate: int = 16000,
        language: Optional[str] = None,
    ) -> Tuple[List[LyricsLine], bool, float]:
        """
        Two-stage alignment across the full track:
        Stage A: Coarse full-track transcription and acoustic anchor extraction.
        Stage B: Monotonic constrained dynamic sequence alignment to authoritative lyric lines.
        Stage C: Word timestamp generation tagged as ACOUSTIC_ANCHOR, INTERPOLATED, or UNCERTAIN.
        Stage D: Validation & anchor rate verification. Rejects fake precision if anchor rate < 60%.

        Returns: (aligned_lines, is_valid_word_sync, anchor_rate)
        """
        if len(audio_pcm) == 0 or not lines:
            return lines, False, 0.0

        sample_text = " ".join(l.original for l in lines[:10] if not l.is_instrumental)
        lang_code = detect_language(sample_text, language)

        model = get_whisper_model(self.model_size)
        if model is None:
            # Fallback interpolation for all lines
            fallback_lines: List[LyricsLine] = []
            for line in lines:
                if line.is_instrumental or not line.original.strip():
                    fallback_lines.append(line.model_copy(update={"words": []}))
                    continue
                pairs = tokenize_for_alignment(line.original)
                st = line.start_ms if line.start_ms is not None else 0
                en = line.end_ms if line.end_ms is not None else st + 3000
                words = self._interpolate_line(pairs, st, en, base_conf=0.75)
                fallback_lines.append(line.model_copy(update={"words": words}))
            return fallback_lines, False, 0.0

        try:
            # Stage A: Full-track coarse audio transcription with word-level timestamps
            segments, _ = model.transcribe(
                audio_pcm,
                word_timestamps=True,
                language=lang_code,
                beam_size=1,
                temperature=0.0,
            )

            all_recognized: List[Tuple[str, int, int, float]] = []
            for seg in segments:
                if seg.words:
                    for w in seg.words:
                        clean_w = normalize_alignment_token(w.word)
                        if clean_w:
                            start_ms = int(w.start * 1000)
                            end_ms = int(w.end * 1000)
                            all_recognized.append((clean_w, start_ms, end_ms, float(w.probability)))

            # Stage B & C: Monotonic alignment against lines
            aligned_lines: List[LyricsLine] = []
            total_words = 0
            anchor_words = 0
            max_unanchored_span = 0

            rec_cursor = 0
            n_rec = len(all_recognized)

            for line in lines:
                if line.is_instrumental or not line.original.strip():
                    aligned_lines.append(line.model_copy(update={"words": []}))
                    continue

                pairs = tokenize_for_alignment(line.original)
                if not pairs:
                    aligned_lines.append(line.model_copy(update={"words": []}))
                    continue

                line_start = line.start_ms if line.start_ms is not None else 0
                line_end = line.end_ms if line.end_ms is not None else line_start + 3000

                # Window search with expanded ±1500ms acoustic context
                matched_line_words: List[Optional[Tuple[int, int, float]]] = [None] * len(pairs)
                curr_span = 0

                for p_idx, (_, exp_clean) in enumerate(pairs):
                    best_rec_idx = -1
                    best_prob = 0.0

                    # Monotonically scan forward in recognized words within plausible temporal range
                    scan_idx = rec_cursor
                    while scan_idx < n_rec and all_recognized[scan_idx][1] < line_start - 2000:
                        scan_idx += 1

                    for cand_idx in range(scan_idx, min(n_rec, scan_idx + 8)):
                        r_clean, r_st, r_en, r_prob = all_recognized[cand_idx]
                        if r_st > line_end + 2500:
                            break

                        if exp_clean == r_clean or exp_clean in r_clean or r_clean in exp_clean:
                            best_rec_idx = cand_idx
                            best_prob = r_prob
                            break

                    if best_rec_idx != -1 and best_prob >= 0.35:
                        _, r_st, r_en, _ = all_recognized[best_rec_idx]
                        clamped_st = max(line_start - 150, min(line_end, r_st))
                        clamped_en = max(clamped_st + 40, min(line_end + 150, r_en))
                        matched_line_words[p_idx] = (clamped_st, clamped_en, max(0.60, min(1.0, best_prob)))
                        rec_cursor = best_rec_idx + 1
                        curr_span = 0
                    else:
                        curr_span += 1
                        if curr_span > max_unanchored_span:
                            max_unanchored_span = curr_span

                # Build line words with timing types
                line_words: List[LyricsWord] = []
                for i, (disp_tok, _) in enumerate(pairs):
                    total_words += 1
                    if matched_line_words[i] is not None:
                        st, en, conf = matched_line_words[i]  # type: ignore
                        line_words.append(
                            LyricsWord(
                                text=disp_tok,
                                start_ms=st,
                                end_ms=en,
                                confidence=conf,
                                timing_type=WordTimingType.ACOUSTIC_ANCHOR,
                            )
                        )
                        anchor_words += 1
                    else:
                        # Find previous anchor
                        prev_end = line_start
                        for p in range(i - 1, -1, -1):
                            if matched_line_words[p] is not None:
                                prev_end = matched_line_words[p][1]  # type: ignore
                                break

                        # Find next anchor
                        next_start = line_end
                        for n in range(i + 1, len(pairs)):
                            if matched_line_words[n] is not None:
                                next_start = matched_line_words[n][0]  # type: ignore
                                break

                        span = max(50, next_start - prev_end)
                        gap_start_idx = i
                        while gap_start_idx > 0 and matched_line_words[gap_start_idx - 1] is None:
                            gap_start_idx -= 1
                        gap_end_idx = i
                        while gap_end_idx < len(pairs) - 1 and matched_line_words[gap_end_idx + 1] is None:
                            gap_end_idx += 1

                        gap_len = gap_end_idx - gap_start_idx + 1
                        pos_in_gap = i - gap_start_idx
                        step = span / gap_len
                        st = int(prev_end + (pos_in_gap * step))
                        en = int(st + step)

                        t_type = (
                            WordTimingType.INTERPOLATED
                            if gap_len <= 3 and span <= 4000
                            else WordTimingType.UNCERTAIN
                        )
                        conf = 0.70 if t_type == WordTimingType.INTERPOLATED else 0.45

                        line_words.append(
                            LyricsWord(
                                text=disp_tok,
                                start_ms=st,
                                end_ms=max(st + 40, en),
                                confidence=conf,
                                timing_type=t_type,
                            )
                        )

                aligned_lines.append(line.model_copy(update={"words": line_words}))

            anchor_rate = anchor_words / max(1, total_words)
            # Rejection rule: anchor_rate < 0.60 or excessive unanchored span
            is_valid = anchor_rate >= 0.60 and max_unanchored_span <= 6

            return aligned_lines, is_valid, round(anchor_rate, 4)

        except Exception as e:
            logger.warning("Two-stage Whisper alignment failed: %s", e)
            return lines, False, 0.0

    def _sync_align_line(
        self,
        audio_window_pcm: np.ndarray,
        window_start_ms: int,
        line: LyricsLine,
        sample_rate: int = 16000,
        language: Optional[str] = None,
    ) -> List[LyricsWord]:
        """Synchronous single-line window alignment fallback."""
        pairs = tokenize_for_alignment(line.original)
        if not pairs:
            return []

        line_start = line.start_ms if line.start_ms is not None else window_start_ms
        line_end = line.end_ms if line.end_ms is not None else line_start + 3000

        lang_code = detect_language(line.original, language)

        model = get_whisper_model(self.model_size)
        if model is None or len(audio_window_pcm) == 0:
            return self._interpolate_line(pairs, line_start, line_end, base_conf=0.82)

        try:
            segments, _ = model.transcribe(
                audio_window_pcm,
                word_timestamps=True,
                initial_prompt=line.original,
                language=lang_code,
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
        n_expected = len(pairs)
        n_rec = len(recognized)
        matched: List[Optional[Tuple[int, int, float]]] = [None] * n_expected

        rec_idx = 0
        for exp_idx, (_, exp_clean) in enumerate(pairs):
            best_match_idx = -1
            best_score = 0.0

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

                abs_start = max(line_start_ms - 150, min(line_end_ms, abs_start))
                abs_end = max(abs_start + 40, min(line_end_ms + 150, abs_end))

                matched[exp_idx] = (abs_start, abs_end, max(0.65, min(1.0, float(best_score))))
                rec_idx = best_match_idx + 1

        final_words: List[LyricsWord] = []
        for i, (disp_tok, _) in enumerate(pairs):
            if matched[i] is not None:
                st, en, conf = matched[i]  # type: ignore
                final_words.append(
                    LyricsWord(
                        text=disp_tok,
                        start_ms=st,
                        end_ms=en,
                        confidence=conf,
                        timing_type=WordTimingType.ACOUSTIC_ANCHOR,
                    )
                )
            else:
                prev_end = line_start_ms
                for p in range(i - 1, -1, -1):
                    if matched[p] is not None:
                        prev_end = matched[p][1]  # type: ignore
                        break

                next_start = line_end_ms
                for n in range(i + 1, n_expected):
                    if matched[n] is not None:
                        next_start = matched[n][0]  # type: ignore
                        break

                span = max(50, next_start - prev_end)
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

                t_type = (
                    WordTimingType.INTERPOLATED
                    if gap_len <= 3 and span <= 3500
                    else WordTimingType.UNCERTAIN
                )
                conf = 0.72 if t_type == WordTimingType.INTERPOLATED else 0.45

                final_words.append(
                    LyricsWord(
                        text=disp_tok,
                        start_ms=st,
                        end_ms=max(st + 40, en),
                        confidence=conf,
                        timing_type=t_type,
                    )
                )

        return final_words

    def _interpolate_line(
        self,
        pairs: List[Tuple[str, str]],
        line_start_ms: int,
        line_end_ms: int,
        base_conf: float = 0.80,
    ) -> List[LyricsWord]:
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
            words.append(
                LyricsWord(
                    text=disp,
                    start_ms=curr,
                    end_ms=max(curr + 40, w_end),
                    confidence=base_conf,
                    timing_type=WordTimingType.INTERPOLATED,
                )
            )
            curr = w_end

        return words
