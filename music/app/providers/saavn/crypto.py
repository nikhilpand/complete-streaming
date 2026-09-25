"""
Media URL crypto — isolated from all other logic.

The community-documented DES decryption is:
  Algorithm: DES (Data Encryption Standard)
  Mode:      ECB (Electronic Codebook)
  Padding:   PKCS5
  Key:       from settings.MEDIA_DES_KEY (default "38346591")

IMPORTANT DESIGN NOTE:
  This is an OPTIONAL best-effort capability.
  If it fails (wrong key, changed algorithm, field gone), we return
  empty streams — we do NOT crash the Song or album endpoint.

  The key is externalized to settings so it can be changed without
  code modification if JioSaavn rotates it.

SECURITY NOTE:
  The community-documented key and algorithm are public knowledge
  across dozens of OSS projects. This does not constitute novel
  circumvention — but operators should monitor for validity changes.
"""

from __future__ import annotations

import base64
import logging
import re

from app.config import settings
from app.models import MediaStream

logger = logging.getLogger(__name__)

# Quality suffix → (bitrate_kbps, label)
_QUALITY_MAP: list[tuple[str, int, str]] = [
    ("_12", 12, "12kbps"),
    ("_48", 48, "48kbps"),
    ("_96", 96, "96kbps"),
    ("_160", 160, "160kbps"),
    ("_320", 320, "320kbps"),
]

_QUALITY_SUFFIX_RE = re.compile(r"_\d+\.mp4$")


def _decrypt_url(encrypted: str) -> str | None:
    """
    DES-ECB decrypt a JioSaavn encrypted_media_url.

    Returns the decrypted URL string, or None on any failure.
    Failures are logged at WARNING level but do not propagate.
    """
    try:
        import pyDes  # optional dependency

        key = settings.MEDIA_DES_KEY.encode("ascii")
        cipher = pyDes.des(key, pyDes.ECB, pad=None, padmode=pyDes.PAD_PKCS5)
        raw_bytes = base64.b64decode(encrypted)
        decrypted = cipher.decrypt(raw_bytes)
        return decrypted.decode("utf-8").strip()
    except ImportError:
        logger.warning("pyDes not installed — media resolution unavailable")
        return None
    except Exception as exc:
        logger.warning("Media URL decryption failed: %s", exc)
        return None


def build_streams(encrypted: str, *, has_320: bool = True) -> list[MediaStream]:
    """
    Decrypt the encrypted URL and build MediaStream objects for each quality.

    Returns empty list on any failure — callers should treat this as
    'media unavailable' and continue normally.
    """
    if not encrypted:
        return []

    base_url = _decrypt_url(encrypted)
    if not base_url:
        return []

    if not _QUALITY_SUFFIX_RE.search(base_url):
        logger.warning("Decrypted URL does not end with expected quality suffix")
        return []

    streams: list[MediaStream] = []
    for suffix, bitrate, label in _QUALITY_MAP:
        if label == "320kbps" and not has_320:
            continue
        url = _QUALITY_SUFFIX_RE.sub(f"{suffix}.mp4", base_url)
        streams.append(MediaStream(
            quality=label,
            url=url,
            mime_type="audio/mp4",
            bitrate_kbps=bitrate,
        ))

    return streams
