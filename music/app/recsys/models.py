from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Optional

from .text import artist_keys, base_title, dedupe_key, primary_artist_key

_META_FIELDS = ("title", "artists", "album", "duration_sec", "language", "image", "explicit",
                "year", "ytm_video_id", "saavn_id")


@dataclass
class Candidate:
    title: str
    artists: list[str] = field(default_factory=list)
    album: str = ""
    duration_sec: int = 0
    language: str = ""
    image: str = ""
    explicit: bool = False
    year: str = ""
    ytm_video_id: Optional[str] = None
    saavn_id: Optional[str] = None
    # pipeline state
    source: str = ""
    source_rank: int = 0
    confidence: float = 1.0                     # identity-match confidence (1.0 = native id)
    sources: dict = field(default_factory=dict)  # source name -> best rank
    score: float = 0.0
    extra: dict = field(default_factory=dict)

    @property
    def primary_artist(self) -> str:
        return self.artists[0] if self.artists else ""

    @property
    def key(self) -> str:
        return dedupe_key(self.title, self.artists)

    def clone(self) -> "Candidate":
        return dataclasses.replace(
            self, artists=list(self.artists), sources=dict(self.sources), extra=dict(self.extra))

    def to_meta(self) -> dict:
        return {f: getattr(self, f) for f in _META_FIELDS}

    @classmethod
    def from_meta(cls, d: dict) -> "Candidate":
        return cls(**{f: d[f] for f in _META_FIELDS if f in d})

    def fill_from(self, other: "Candidate") -> None:
        """Fill blanks from another candidate describing the same song."""
        for f in ("album", "language", "image", "year"):
            if not getattr(self, f) and getattr(other, f):
                setattr(self, f, getattr(other, f))
        if not self.duration_sec and other.duration_sec:
            self.duration_sec = other.duration_sec
        if not self.artists and other.artists:
            self.artists = list(other.artists)
        if not self.ytm_video_id and other.ytm_video_id:
            self.ytm_video_id = other.ytm_video_id
        if not self.saavn_id and other.saavn_id:
            self.saavn_id = other.saavn_id
        self.explicit = self.explicit or other.explicit

    def to_public(self) -> dict:
        return {
            "id": self.saavn_id or (f"youtube:{self.ytm_video_id}" if self.ytm_video_id else ""),
            "saavn_id": self.saavn_id,
            "ytm_video_id": self.ytm_video_id,
            "title": self.title,
            "artists": list(self.artists),
            "artist": ", ".join(self.artists),
            "album": self.album,
            "duration": self.duration_sec,
            "language": self.language,
            "image": self.image,
            "explicit": self.explicit,
            "playback": "saavn" if self.saavn_id else "unresolved",
            "match_confidence": round(self.confidence, 3),
            "sources": sorted(self.sources) if self.sources else ([self.source] if self.source else []),
            "score": round(self.score, 4),
        }


def same_song(a: Candidate, b: Candidate) -> bool:
    """Same recording (same version tags) across sources."""
    if a.saavn_id and a.saavn_id == b.saavn_id:
        return True
    if a.ytm_video_id and a.ytm_video_id == b.ytm_video_id:
        return True
    if not a.title or not b.title:
        return False
    ba, ta = base_title(a.title)
    bb, tb = base_title(b.title)
    if ba != bb or ta != tb:
        return False
    ka, kb = artist_keys(a.artists), artist_keys(b.artists)
    if not ka or not kb:
        return True
    return bool(ka & kb) or primary_artist_key(a.artists) == primary_artist_key(b.artists)
