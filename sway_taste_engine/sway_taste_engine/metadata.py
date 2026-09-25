from __future__ import annotations

import re
from typing import Any, Optional
from .models import ArtistRole, FeatureValue, Track


def clean_track_id(tid: str) -> str:
    """Normalize 'saavn:abc123' to 'abc123'."""
    if not tid:
        return ""
    if ":" in tid:
        return tid.split(":", 1)[1].strip()
    return tid.strip()


def normalize_role(role_raw: str) -> str:
    r = (role_raw or "").lower().strip()
    if r in {"music", "composer", "music_director", "music director"}:
        return "composer"
    if r in {"lyricist", "lyrics", "writer", "author"}:
        return "lyricist"
    if r in {"singer", "primary", "vocalist", "vocals", "main"}:
        return "singer"
    if r in {"featured", "feat", "starring"}:
        return "featured"
    if r in {"producer"}:
        return "producer"
    return "primary"


def extract_year(val: Any) -> Optional[int]:
    if val is None:
        return None
    if isinstance(val, int) and 1900 <= val <= 2100:
        return val
    s = str(val).strip()
    m = re.search(r"\b(19\d\d|20\d\d)\b", s)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None


def extract_track_features(song: Any) -> Track:
    """Extract factual track metadata and feature provenance from raw Song model or dict.

    Never synthesizes fake constants (e.g. energy=0.7 or bpm=105).
    """
    if isinstance(song, dict):
        raw = song
    elif hasattr(song, "model_dump"):
        raw = song.model_dump()
    else:
        raw = {
            "id": getattr(song, "id", ""),
            "provider_id": getattr(song, "provider_id", None),
            "title": getattr(song, "title", ""),
            "subtitle": getattr(song, "subtitle", ""),
            "artists": getattr(song, "artists", []),
            "album": getattr(song, "album", None),
            "album_id": getattr(song, "album_id", None),
            "year": getattr(song, "year", None),
            "release_date": getattr(song, "release_date", None),
            "duration_ms": getattr(song, "duration_ms", None),
            "language": getattr(song, "language", None),
            "artwork_url": getattr(song, "artwork_url", None),
            "extra": getattr(song, "extra", {}),
            "popularity": getattr(song, "popularity", None),
        }

    raw_id = raw.get("provider_id") or raw.get("id") or "unknown"
    track_id = clean_track_id(str(raw_id))

    title = str(raw.get("title") or "Track").strip()
    album_name = raw.get("album")
    if album_name and isinstance(album_name, str):
        album_name = album_name.strip()
    album_id = raw.get("album_id") or (album_name.lower().replace(" ", "_") if album_name else None)

    # 1. Parse Artists and Roles
    artists_raw = raw.get("artists") or []
    parsed_artists: list[ArtistRole] = []
    composers: list[str] = []
    lyricists: list[str] = []

    for a in artists_raw:
        if isinstance(a, dict):
            aid = str(a.get("id") or "")
            aname = str(a.get("name") or "").strip()
            arole = normalize_role(str(a.get("role") or "primary"))
            aimg = a.get("image_url")
        elif hasattr(a, "name"):
            aid = str(getattr(a, "id", "") or "")
            aname = str(getattr(a, "name", "") or "").strip()
            arole = normalize_role(str(getattr(a, "role", "primary") or "primary"))
            aimg = getattr(a, "image_url", None)
        else:
            continue

        if not aname:
            continue

        role_entry = ArtistRole(id=aid, name=aname, role=arole, image_url=aimg)
        parsed_artists.append(role_entry)

        if arole == "composer" and aname not in composers:
            composers.append(aname)
        elif arole == "lyricist" and aname not in lyricists:
            lyricists.append(aname)

    # If artists list was empty but subtitle was present
    if not parsed_artists and raw.get("subtitle"):
        sub = str(raw.get("subtitle")).strip()
        parsed_artists.append(ArtistRole(id="sub_artist", name=sub, role="primary"))

    primary_artist_id = parsed_artists[0].id if parsed_artists else "unknown"
    primary_artist_name = parsed_artists[0].name if parsed_artists else "Unknown Artist"

    # Check extra for explicit composers/lyricists
    extra = raw.get("extra") or {}
    if isinstance(extra, dict):
        if "music" in extra and isinstance(extra["music"], str):
            for c in extra["music"].split(","):
                c = c.strip()
                if c and c not in composers:
                    composers.append(c)
        if "singers" in extra and isinstance(extra["singers"], str):
            for s in extra["singers"].split(","):
                s = s.strip()
                if s and not any(p.name.lower() == s.lower() for p in parsed_artists):
                    parsed_artists.append(ArtistRole(id=f"singer_{s.lower().replace(' ', '_')}", name=s, role="singer"))

    # 2. Year & Language
    year = extract_year(raw.get("year")) or extract_year(raw.get("release_date"))
    raw_lang = raw.get("language")
    language = str(raw_lang).lower().strip() if raw_lang else None

    # 3. Duration
    duration_ms = raw.get("duration_ms")
    if duration_ms is not None:
        try:
            duration_ms = int(duration_ms)
        except (ValueError, TypeError):
            duration_ms = None

    # 4. Artwork
    artwork_url = raw.get("artwork_url")

    # 5. Provenance-guarded Derived Features (ZERO synthetic defaults)
    energy_val = raw.get("energy")
    bpm_val = raw.get("bpm")

    if energy_val is not None:
        try:
            energy_f = float(energy_val)
            energy_feature = FeatureValue[float](value=energy_f, source="direct_input", confidence=1.0)
        except (ValueError, TypeError):
            energy_feature = FeatureValue[float](value=None, source="unmeasured", confidence=0.0)
    else:
        energy_feature = FeatureValue[float](value=None, source="unmeasured", confidence=0.0)

    if bpm_val is not None:
        try:
            bpm_f = float(bpm_val)
            bpm_feature = FeatureValue[float](value=bpm_f, source="direct_input", confidence=1.0)
        except (ValueError, TypeError):
            bpm_feature = FeatureValue[float](value=None, source="unmeasured", confidence=0.0)
    else:
        bpm_feature = FeatureValue[float](value=None, source="unmeasured", confidence=0.0)

    # 6. Title-driven heuristics for genres and moods (with provenance tags)
    genres: list[str] = list(raw.get("genres") or [])
    moods: list[str] = list(raw.get("moods") or [])
    t_lower = title.lower()

    if any(w in t_lower for w in ["bhajan", "aarti", "shiv", "hanuman", "ram", "krishna", "mantra"]):
        if "devotional" not in genres:
            genres.extend(["devotional", "spiritual"])
        if "spiritual" not in moods:
            moods.extend(["peaceful", "spiritual"])
    elif any(w in t_lower for w in ["party", "dance", "remix", "beat", "club", "mashup", "dhol"]):
        if "dance" not in genres:
            genres.extend(["dance", "remix"])
        if "energetic" not in moods:
            moods.extend(["energetic", "party"])
    elif any(w in t_lower for w in ["sad", "judaai", "dard", "roya", "lonely", "broken", "alvida"]):
        if "melancholy" not in moods:
            moods.extend(["melancholy", "emotional"])
    elif any(w in t_lower for w in ["acoustic", "unplugged", "reprise", "piano", "lofi"]):
        if "acoustic" not in genres:
            genres.append("acoustic")
        if "mellow" not in moods:
            moods.append("mellow")

    if not genres:
        genres = ["indian", "bollywood"]
    if not moods:
        moods = ["melodic"]

    popularity = float(raw.get("popularity", 0.5) or 0.5)

    return Track(
        id=track_id,
        title=title,
        artist_id=primary_artist_id,
        artist_name=primary_artist_name,
        artists=parsed_artists,
        album=album_name,
        album_id=album_id,
        album_name=album_name,
        year=year,
        duration_ms=duration_ms,
        language=language,
        composers=composers,
        lyricists=lyricists,
        genres=genres,
        moods=moods,
        popularity=popularity,
        artwork_url=artwork_url,
        energy=energy_feature.value,
        bpm=bpm_feature.value,
        energy_feature=energy_feature,
        bpm_feature=bpm_feature,
    )
