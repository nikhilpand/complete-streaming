"""
Abstract base class for Word Alignment Engines.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional
import numpy as np

from app.services.alignment.models import LyricsLine, LyricsWord


class AlignmentEngineBase(ABC):
    @abstractmethod
    def align_line(
        self,
        audio_window_pcm: np.ndarray,
        window_start_ms: int,
        line: LyricsLine,
        sample_rate: int = 16000,
        language: Optional[str] = None,
    ) -> List[LyricsWord]:
        """
        Align words within a single line-constrained audio window.

        Args:
            audio_window_pcm: Sliced audio segment (mono float32 [-1, 1]).
            window_start_ms: Absolute timestamp in track where audio_window_pcm begins.
            line: The lyric line with expected original text and line boundaries.
            sample_rate: Audio sampling rate (default 16000).
            language: Optional language code hint (e.g. 'hi', 'en', 'pa').

        Returns:
            List of LyricsWord with absolute start_ms and end_ms.
        """
        pass
