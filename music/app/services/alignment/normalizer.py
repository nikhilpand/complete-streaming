"""
Multilingual Text Normalizer for Word Synchronization.

Maintains dual representation:
- Display lyrics: Original punctuation, capitalization, and native script are preserved.
- Alignment tokens: Lowercased, diacritics normalized, punctuation stripped for acoustic matching.
"""

from __future__ import annotations

import re
import unicodedata
from typing import List, Tuple


# Regex patterns
_PUNCTUATION_RE = re.compile(r"^[^\w\s]+|[^\w\s]+$")
_WHITESPACE_RE = re.compile(r"\s+")
_CLEAN_TOKEN_RE = re.compile(r"[^\w\s\u0900-\u097F\u0A00-\u0A7F']+")


def is_devanagari(text: str) -> bool:
    """Check if text contains Devanagari characters (Hindi, Marathi, etc.)."""
    return any("\u0900" <= ch <= "\u097F" for ch in text)


def is_gurmukhi(text: str) -> bool:
    """Check if text contains Gurmukhi characters (Punjabi)."""
    return any("\u0A00" <= ch <= "\u0A7F" for ch in text)


def detect_script(text: str) -> str:
    """Detect primary script of the lyric text."""
    if is_devanagari(text):
        return "devanagari"
    if is_gurmukhi(text):
        return "gurmukhi"
    return "latin"


def normalize_alignment_token(token: str) -> str:
    """
    Normalize an individual word token for alignment matching:
    - Unicode NFC normalization
    - Lowercase
    - Strip leading/trailing non-alphanumeric punctuation while keeping internal apostrophes
    """
    norm = unicodedata.normalize("NFC", token).strip()
    norm = _PUNCTUATION_RE.sub("", norm)
    norm = _CLEAN_TOKEN_RE.sub("", norm)
    return norm.lower()


def tokenize_for_alignment(line_text: str) -> List[Tuple[str, str]]:
    """
    Tokenize a lyric line into (display_token, alignment_token) pairs.
    Blank/empty tokens are omitted.

    Example:
        'Kesariya, tera ishq hai!' -> [
            ('Kesariya,', 'kesariya'),
            ('tera', 'tera'),
            ('ishq', 'ishq'),
            ('hai!', 'hai')
        ]
    """
    raw_tokens = _WHITESPACE_RE.split(line_text.strip())
    results: List[Tuple[str, str]] = []

    for raw in raw_tokens:
        clean = normalize_alignment_token(raw)
        if clean:
            results.append((raw, clean))
        elif raw.strip():
            # In rare cases of solo punctuation (e.g. '♪' or '-'), preserve as display only
            results.append((raw, raw.strip()))

    return results


def normalize_line_text(line_text: str) -> str:
    """Create normalized space-delimited string for acoustic model prompt or CTC target."""
    pairs = tokenize_for_alignment(line_text)
    return " ".join(clean for _, clean in pairs if clean)
