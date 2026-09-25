"""
Deterministic Alignment Quality Validator.

Evaluates:
- Line boundary containment (word timestamps must remain within line limits)
- Monotonic progression (no time reversals)
- Duration sanity (no zero-duration or ridiculously long words)
- Token coverage (all display words must have valid timings)
- Overall confidence score (must be >= MIN_CONFIDENCE, default 0.78)
"""

from __future__ import annotations

from typing import List, Tuple
from pydantic import BaseModel, Field

from app.services.alignment.models import LyricsLine, LyricsWord


class ValidationResult(BaseModel):
    is_valid: bool
    confidence_score: float = Field(ge=0.0, le=1.0)
    containment_rate: float = Field(ge=0.0, le=1.0)
    monotonicity_rate: float = Field(ge=0.0, le=1.0)
    coverage_rate: float = Field(ge=0.0, le=1.0)
    rejection_reason: str | None = None


class AlignmentValidator:
    MIN_CONFIDENCE_THRESHOLD: float = 0.78
    BOUNDARY_TOLERANCE_MS: int = 250
    MIN_WORD_DURATION_MS: int = 40
    MAX_WORD_DURATION_MS: int = 5000

    @classmethod
    def validate_line(
        cls,
        line: LyricsLine,
        words: List[LyricsWord],
        min_confidence: float = MIN_CONFIDENCE_THRESHOLD,
    ) -> ValidationResult:
        """Validate alignment of a single line."""
        if not words:
            return ValidationResult(
                is_valid=False,
                confidence_score=0.0,
                containment_rate=0.0,
                monotonicity_rate=0.0,
                coverage_rate=0.0,
                rejection_reason="No words provided",
            )

        line_start = line.start_ms if line.start_ms is not None else 0
        line_end = line.end_ms if line.end_ms is not None else line_start + 4000
        line_duration = max(100, line_end - line_start)

        # 1. Boundary containment
        containment_hits = 0
        min_allowed_start = max(0, line_start - cls.BOUNDARY_TOLERANCE_MS)
        max_allowed_end = line_end + cls.BOUNDARY_TOLERANCE_MS

        for w in words:
            if w.start_ms >= min_allowed_start and w.end_ms <= max_allowed_end:
                containment_hits += 1

        containment_rate = containment_hits / len(words)

        # 2. Monotonicity & duration sanity
        monotonic_hits = 0
        prev_end = min_allowed_start
        duration_hits = 0
        acoustic_conf_sum = 0.0

        for idx, w in enumerate(words):
            acoustic_conf_sum += w.confidence
            dur = w.end_ms - w.start_ms

            # Sanity check duration
            if cls.MIN_WORD_DURATION_MS <= dur <= max(cls.MAX_WORD_DURATION_MS, line_duration):
                duration_hits += 1

            # Check forward progression (allowing minor 50ms overlap for diphthongs/slurs)
            if w.start_ms >= prev_end - 50 and w.end_ms >= w.start_ms:
                monotonic_hits += 1
            prev_end = w.end_ms

        monotonicity_rate = monotonic_hits / len(words)
        duration_rate = duration_hits / len(words)
        avg_acoustic_conf = acoustic_conf_sum / len(words)

        # 3. Token coverage: line.original word count vs words len
        expected_tokens = [t for t in line.original.split() if t.strip()]
        expected_count = len(expected_tokens)
        if expected_count > 0:
            coverage_rate = min(1.0, len(words) / expected_count)
        else:
            coverage_rate = 1.0

        # Composite score calculation
        # Weights: acoustic 35%, containment 30%, monotonicity 20%, duration 10%, coverage 5%
        composite_score = (
            (avg_acoustic_conf * 0.35)
            + (containment_rate * 0.30)
            + (monotonicity_rate * 0.20)
            + (duration_rate * 0.10)
            + (coverage_rate * 0.05)
        )
        composite_score = max(0.0, min(1.0, round(composite_score, 4)))

        rejection_reason = None
        if containment_rate < 0.80:
            rejection_reason = f"Containment failure: {containment_rate:.1%} within boundaries"
        elif monotonicity_rate < 0.80:
            rejection_reason = f"Monotonicity failure: {monotonicity_rate:.1%} progression"
        elif composite_score < min_confidence:
            rejection_reason = f"Composite confidence {composite_score:.2f} below threshold {min_confidence:.2f}"

        is_valid = rejection_reason is None

        return ValidationResult(
            is_valid=is_valid,
            confidence_score=composite_score,
            containment_rate=round(containment_rate, 4),
            monotonicity_rate=round(monotonicity_rate, 4),
            coverage_rate=round(coverage_rate, 4),
            rejection_reason=rejection_reason,
        )

    @classmethod
    def validate_document(
        cls,
        lines: List[LyricsLine],
        min_confidence: float = MIN_CONFIDENCE_THRESHOLD,
    ) -> Tuple[bool, float, List[str]]:
        """
        Validate all lines of an aligned document.
        Returns (is_overall_valid, aggregate_confidence, list_of_errors).
        """
        if not lines:
            return False, 0.0, ["No lines in document"]

        valid_count = 0
        total_confidence = 0.0
        errors: List[str] = []

        active_lines = [l for l in lines if not l.is_instrumental and l.words]
        if not active_lines:
            return False, 0.0, ["No active synchronized lines"]

        for l in active_lines:
            res = cls.validate_line(l, l.words, min_confidence)
            total_confidence += res.confidence_score
            if res.is_valid:
                valid_count += 1
            else:
                errors.append(f"Line {l.id} ('{l.original}'): {res.rejection_reason}")

        pass_rate = valid_count / len(active_lines)
        aggregate_confidence = round(total_confidence / len(active_lines), 4)

        # 90% of active lines must pass validation
        is_overall_valid = pass_rate >= 0.90 and aggregate_confidence >= min_confidence

        return is_overall_valid, aggregate_confidence, errors
