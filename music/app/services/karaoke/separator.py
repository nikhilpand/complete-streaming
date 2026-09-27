"""
Vocal separation wrapper.

Loads the MelBand RoFormer model via audio-separator.
Model weights are downloaded to data/models/ on first use.
The Separator instance is loaded ONCE at module level (singleton).

Fallback: if audio_separator is not installed, all calls raise KaraokeUnavailable.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Directory where model weights are stored (never committed to git)
MODELS_DIR = Path("data/models")
STEMS_DIR = Path("data/karaoke")

# Chosen model — Kim MelBand RoFormer (best vocal quality, MIT license compatible)
# audio-separator model name: 'mel_band_roformer_kim_vocals.ckpt'
# (available via audio-separator's bundled model zoo)
DEFAULT_MODEL = "mel_band_roformer_kim_vocals_kj.ckpt"

_separator = None
_separator_available = False
_separator_error: Optional[str] = None


def _try_load_separator():
    global _separator, _separator_available, _separator_error
    try:
        from audio_separator.separator import Separator  # type: ignore
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        STEMS_DIR.mkdir(parents=True, exist_ok=True)
        sep = Separator(
            model_file_dir=str(MODELS_DIR),
            output_dir=str(STEMS_DIR),
            output_format="mp3",
            normalization_threshold=0.9,
            amplification_threshold=0.6,
            log_level=logging.WARNING,
        )
        # Download / verify the model; this blocks but only runs once
        sep.load_model(model_filename=DEFAULT_MODEL)
        _separator = sep
        _separator_available = True
        logger.info("KaraokeEngine: audio-separator loaded model %s", DEFAULT_MODEL)
    except ImportError:
        _separator_error = (
            "audio_separator is not installed. "
            "Run: pip install audio-separator"
        )
        logger.warning("KaraokeEngine: %s", _separator_error)
    except Exception as e:
        _separator_error = f"Failed to load separation model: {e}"
        logger.warning("KaraokeEngine: %s", _separator_error)


# Lazy-load: don't fail startup if model is unavailable
_try_load_separator()


def is_available() -> bool:
    return _separator_available


def get_error() -> Optional[str]:
    return _separator_error


def separate_stems(audio_path: str, output_prefix: str) -> dict[str, str]:
    """
    Run vocal separation synchronously (called via asyncio.to_thread).

    Returns dict with keys 'vocals' and 'instrumental', values are absolute file paths.
    Raises RuntimeError if separator is not available or separation fails.
    """
    if not _separator_available or _separator is None:
        raise RuntimeError(_separator_error or "Separator not available")

    logger.info("KaraokeEngine: separating %s", audio_path)
    output_files = _separator.separate(audio_path)
    
    if not output_files or len(output_files) < 2:
        raise RuntimeError(f"Separation returned unexpected outputs: {output_files}")

    # audio-separator returns files in output_dir; identify them
    # Convention: one file contains 'Vocals', other contains 'Instrumental'
    vocals_path = None
    instrumental_path = None
    for f in output_files:
        fname = os.path.basename(f).lower()
        if "vocal" in fname:
            vocals_path = f
        elif "instrument" in fname or "no_vocals" in fname or "accompaniment" in fname:
            instrumental_path = f

    if not vocals_path or not instrumental_path:
        # Fallback: first=vocals, second=instrumental by convention
        if len(output_files) >= 2:
            vocals_path = output_files[0]
            instrumental_path = output_files[1]
        else:
            raise RuntimeError(f"Cannot identify vocals/instrumental from: {output_files}")

    return {"vocals": str(vocals_path), "instrumental": str(instrumental_path)}
