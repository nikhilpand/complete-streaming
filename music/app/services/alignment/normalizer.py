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


# Common Romanized Hindi/Urdu and Punjabi phonetic keywords (excluding English stopword collisions)
_ROMAN_INDIC_KEYWORDS = {
    # Hindi/Urdu high-frequency tokens
    "tum", "hum", "main", "mera", "meri", "mere", "tera", "teri", "tere",
    "kya", "kyun", "kyu", "hai", "hain", "tha", "thi",
    "karna", "karte", "karti", "dil", "ishq", "pyar", "pyaar", "mohabbat",
    "chahiye", "zindagi", "jaan", "saath", "nahi", "nahin", "naa",
    "hota", "hoti", "hote", "jaana", "aana", "rabba", "khuda",
    "chaleya", "kesariya", "ankhiyan", "aankhon", "raatein", "jeena",
    "suno", "dekho", "kuch", "apna", "apni", "apne", "tujhe", "mujhe",
    "raha", "rahi", "rahe", "hona", "hua", "hui", "hue", "duniya",
    # Punjabi high-frequency tokens
    "ve", "vich", "nach", "soch", "munda", "kudi",
    "soniye", "heer", "ranjha", "jatt", "dholna", "tenu", "menu",
    "assi", "tussi", "haye", "channa"
}

_PUNJABI_SPECIFIC_KEYWORDS = {
    "ve", "vich", "nach", "munda", "kudi",
    "soniye", "heer", "ranjha", "jatt", "dholna", "tenu", "menu",
    "assi", "tussi", "channa"
}


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


def is_roman_indic(text: str, threshold: float = 0.18) -> Tuple[bool, str]:
    """
    Detect whether Latin script text is Romanized Hindi or Punjabi (Hinglish/Pinglish).
    Requires at least 2 indicative keyword matches to eliminate single-word noise.
    Returns (is_indic, lang_code).
    """
    words = [re.sub(r"[^\w]", "", w.lower()) for w in text.split()]
    clean_words = [w for w in words if w and len(w) >= 2]
    if not clean_words:
        return False, "en"

    indic_matches = sum(1 for w in clean_words if w in _ROMAN_INDIC_KEYWORDS)
    ratio = indic_matches / len(clean_words)

    if indic_matches >= 2 and ratio >= threshold:
        punjabi_matches = sum(1 for w in clean_words if w in _PUNJABI_SPECIFIC_KEYWORDS)
        if punjabi_matches >= 2 or (punjabi_matches > 0 and punjabi_matches >= indic_matches // 2):
            return True, "pa"
        return True, "hi"

    return False, "en"


def detect_language(text: str, metadata_language: Optional[str] = None) -> str:
    """
    Determine the optimal language code for Whisper transcription/alignment.
    Priority:
    1. Metadata language if explicitly provided and recognizable
    2. Native Devanagari -> 'hi'
    3. Native Gurmukhi -> 'pa'
    4. Latin script with Romanized Hindi/Punjabi heuristics -> 'hi' or 'pa'
    5. Fallback -> 'en'
    """
    if metadata_language:
        meta_norm = metadata_language.strip().lower()
        if meta_norm in ("hi", "hindi", "hin"):
            return "hi"
        if meta_norm in ("pa", "punjabi", "pan"):
            return "pa"
        if meta_norm in ("en", "english", "eng"):
            # Still check if the text is predominantly Devanagari
            if is_devanagari(text):
                return "hi"
            if is_gurmukhi(text):
                return "pa"
            # If metadata says English but text is heavily Roman Hindi, honor Roman Hindi
            is_indic, indic_lang = is_roman_indic(text, threshold=0.25)
            return indic_lang if is_indic else "en"
        if meta_norm in ("ta", "tamil"):
            return "ta"
        if meta_norm in ("te", "telugu"):
            return "te"
        if meta_norm in ("bn", "bengali"):
            return "bn"
        if meta_norm in ("mr", "marathi"):
            return "mr"
        if meta_norm in ("gu", "gujarati"):
            return "gu"

    script = detect_script(text)
    if script == "devanagari":
        return "hi"
    if script == "gurmukhi":
        return "pa"

    # Latin script: analyze for Hinglish / Roman Indic
    is_indic, indic_lang = is_roman_indic(text)
    if is_indic:
        return indic_lang

    return "en"


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
