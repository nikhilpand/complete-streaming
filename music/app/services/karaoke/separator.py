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

# Chosen model — Kimberley Jensen Vocal 2 (MDX-Net ONNX, fastest & high vocal fidelity)
DEFAULT_MODEL = "Kim_Vocal_2.onnx"

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
        _separator_error = None
        logger.info("KaraokeEngine: audio-separator loaded model %s", DEFAULT_MODEL)
    except ImportError as e:
        _separator_error = (
            f"audio_separator or dependency missing: {e}. "
            "Run: pip install audio-separator onnx onnx2torch"
        )
        logger.warning("KaraokeEngine: %s", _separator_error)
    except Exception as e:
        _separator_error = f"Failed to load separation model: {e}"
        logger.warning("KaraokeEngine: %s", _separator_error)


# Initialize separator
_try_load_separator()


def get_separator():
    global _separator
    if _separator is None:
        _try_load_separator()
    return _separator


def is_available() -> bool:
    return get_separator() is not None


def get_error() -> Optional[str]:
    get_separator()
    return _separator_error


def separate_stems(audio_path: str, output_prefix: str) -> dict[str, str]:
    """
    Run vocal separation synchronously (called via asyncio.to_thread).

    Returns dict with keys 'vocals' and 'instrumental', values are absolute file paths.
    Raises RuntimeError if separator is not available or separation fails.
    """
    sep = get_separator()
    if sep is None:
        raise RuntimeError(_separator_error or "Separator not available")

    logger.info("KaraokeEngine: separating %s", audio_path)
    output_files = sep.separate(audio_path)
    
    if not output_files or len(output_files) < 2:
        raise RuntimeError(f"Separation returned unexpected outputs: {output_files}")

    # audio-separator returns files in output_dir; identify them
    # Convention: one file contains 'Vocals', other contains 'Instrumental'
    vocals_path = None
    instrumental_path = None
    for f in output_files:
        full_path = str((STEMS_DIR / f).resolve()) if not os.path.isabs(f) else str(Path(f).resolve())
        fname = os.path.basename(f).lower()
        if "vocal" in fname:
            vocals_path = full_path
        elif "instrument" in fname or "no_vocals" in fname or "accompaniment" in fname:
            instrumental_path = full_path

    if not vocals_path or not instrumental_path:
        # Fallback: first=vocals, second=instrumental by convention
        if len(output_files) >= 2:
            f0 = str((STEMS_DIR / output_files[0]).resolve()) if not os.path.isabs(output_files[0]) else str(Path(output_files[0]).resolve())
            f1 = str((STEMS_DIR / output_files[1]).resolve()) if not os.path.isabs(output_files[1]) else str(Path(output_files[1]).resolve())
            vocals_path = f0
            instrumental_path = f1
        else:
            raise RuntimeError(f"Cannot identify vocals/instrumental from: {output_files}")

    return {"vocals": str(vocals_path), "instrumental": str(instrumental_path)}
