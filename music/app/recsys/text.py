"""Title / artist normalisation shared by matching, fusion and dedupe."""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable

_BRACKETS = re.compile(r"[\(\[\{]([^\)\]\}]*)[\)\]\}]")

# Words that mark a *different recording/version* of a song. Two tracks that differ in these
# are NOT the same song for our purposes (original vs lofi vs remix vs cover ...).
_TAG_WORDS = [
    "remix", "lofi", "live", "acoustic", "cover", "slowed", "reverb", "instrumental",
    "karaoke", "unplugged", "reprise", "mashup", "sped up", "8d", "bass boosted",
    "flip", "dj", "trap",
]
_alt = "|".join(sorted((re.escape(w) for w in _TAG_WORDS), key=len, reverse=True))
_TAG_RE = re.compile(rf"\b({_alt})\b")
_TAIL_TAG_RE = re.compile(rf"\b({_alt})\s*$")
_SPLIT_ARTISTS = re.compile(r"\s*(?:,|&|/|;|\bfeat\.?\b|\bft\.?\b)\s*", re.I)


def fold(s: str) -> str:
    """casefold, unify punctuation, keep unicode letters (Devanagari/Gurmukhi safe)."""
    s = unicodedata.normalize("NFKC", s or "").casefold()
    s = s.replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"[_\s]+", " ", s).strip()
    s = re.sub(r"\blo fi\b", "lofi", s)
    return s


def _tags(folded: str) -> set[str]:
    return {m.group(1) for m in _TAG_RE.finditer(folded)}


def base_title(title: str) -> tuple[str, frozenset[str]]:
    """('tum hi ho', {}) for 'Tum Hi Ho (From "Aashiqui 2")'; ('kesariya', {'lofi'}) for 'Kesariya - Lofi'."""
    tags: set[str] = set()

    def _grab(m: re.Match) -> str:
        tags.update(_tags(fold(m.group(1))))
        return " "

    stripped = _BRACKETS.sub(_grab, title or "")
    if " - " in stripped:
        head, *tail = stripped.split(" - ")
        for t in tail:
            tags.update(_tags(fold(t)))
        stripped = head
    head_f = fold(stripped)
    m = _TAIL_TAG_RE.search(head_f)
    if m:  # "Song Lofi" / "Song Remix"
        tags.add(m.group(1))
    return head_f, frozenset(tags)


def split_artist_names(names: Iterable[str]) -> list[str]:
    out: list[str] = []
    for n in names or []:
        for part in _SPLIT_ARTISTS.split(n or ""):
            part = part.strip()
            if part:
                out.append(part)
    return out


def artist_keys(names: Iterable[str]) -> set[str]:
    return {k for k in (fold(n) for n in split_artist_names(names)) if k}


def primary_artist_key(names: Iterable[str]) -> str:
    parts = split_artist_names(names)
    return fold(parts[0]) if parts else ""


def dedupe_key(title: str, artists: Iterable[str]) -> str:
    base, tags = base_title(title)
    return f"{base}|{'+'.join(sorted(tags))}|{primary_artist_key(artists)}"


def parse_duration(text) -> int:
    """'3:45' -> 225, '1:02:03' -> 3723, int passthrough."""
    if text is None:
        return 0
    if isinstance(text, (int, float)):
        return int(text)
    parts = str(text).strip().split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return 0
    total = 0
    for n in nums:
        total = total * 60 + n
    return total
