"""Deterministic fake upstreams + a synthetic Indian-music catalog for offline tests."""
from __future__ import annotations

from app.recsys.clients.ytm import RadioCursor, RadioPage
from app.recsys.models import Candidate
from app.recsys.text import fold

WORDS = ["Aakash", "Barsaat", "Chandni", "Dilkash", "Ehsaas", "Fitoor", "Gulaab", "Hawa", "Ishq", "Jugnu",
         "Khwaab", "Lehron", "Mausam", "Nazar", "Oasis", "Parinda", "Qayamat", "Raahein", "Sitare", "Tanhai"]
HINDI_ARTISTS = ["Arijit Singh", "Shreya Ghoshal", "Atif Aslam", "Jubin Nautiyal", "Neha Kakkar", "Sonu Nigam"]
PUNJABI_ARTISTS = ["AP Dhillon", "Diljit Dosanjh"]


def make_catalog():
    """20 hindi songs (6 artists round-robin) + 5 punjabi. Saavn ids sh#/sp#, YTM ids vh#/vp#."""
    saavn: dict[str, Candidate] = {}
    for i in range(20):
        saavn[f"sh{i}"] = Candidate(
            title=f'{WORDS[i]} Ke Paar (From "Film {i}")', artists=[HINDI_ARTISTS[i % 6]], album=f"Film {i}",
            duration_sec=200 + i * 7, language="hindi", saavn_id=f"sh{i}")
    for i in range(5):
        saavn[f"sp{i}"] = Candidate(
            title=f"{WORDS[i]} Punjabi Vibe", artists=[PUNJABI_ARTISTS[i % 2]], album=f"Punjabi EP {i}",
            duration_sec=180 + i * 5, language="punjabi", saavn_id=f"sp{i}")
    return saavn


def ytm_version(c: Candidate) -> Candidate:
    """How YTM would describe the same song: cleaner title, its own id, no language, no Saavn id."""
    base = c.title.split(" (From")[0]
    vid = "v" + c.saavn_id[1:]
    return Candidate(title=base, artists=list(c.artists), album=c.album, duration_sec=c.duration_sec,
                     ytm_video_id=vid, extra={"video_type": "MUSIC_VIDEO_TYPE_ATV"})


class FakeSaavn:
    def __init__(self, catalog, reco=None, station=None, trending=None):
        self.catalog, self.reco_map, self.station_map, self.trending_ids = catalog, reco or {}, station or {}, trending or []
        self.search_calls = 0
        self.fail = False

    def _chk(self):
        if self.fail:
            raise RuntimeError("saavn down")

    async def search_songs(self, query, limit=5):
        self._chk()
        self.search_calls += 1
        toks = set(fold(query).split())
        scored = []
        for c in self.catalog.values():
            hay = set(fold(c.title + " " + " ".join(c.artists)).split())
            s = len(toks & hay) / max(len(toks), 1)
            if s > 0:
                scored.append((s, c))
        scored.sort(key=lambda x: -x[0])
        return [c.clone() for _, c in scored[:limit]]

    async def get_song(self, sid):
        self._chk()
        c = self.catalog.get(sid)
        return c.clone() if c else None

    async def recommendations(self, sid, limit=20):
        self._chk()
        return [self.catalog[i].clone() for i in self.reco_map.get(sid, [])][:limit]

    async def station_songs(self, sid, limit=20):
        self._chk()
        return [self.catalog[i].clone() for i in self.station_map.get(sid, [])][:limit]

    async def trending(self, language="hindi", limit=30):
        self._chk()
        return [self.catalog[i].clone() for i in self.trending_ids][:limit]


class FakeYtm:
    def __init__(self, catalog, radio=None, charts=None, cont=None):
        self.catalog = catalog
        self.radio_map = radio or {}       # vid -> [saavn ids in YTM order]
        self.chart_ids = charts or []
        self.cont_map = cont or {}         # token -> [saavn ids]
        self.fail = False
        self.radio_calls = 0

    def _chk(self):
        if self.fail:
            raise RuntimeError("ytm down")

    async def search_song(self, query, limit=5):
        self._chk()
        toks = set(fold(query).split())
        scored = []
        for c in self.catalog.values():
            hay = set(fold(c.title + " " + " ".join(c.artists)).split())
            s = len(toks & hay) / max(len(toks), 1)
            if s > 0:
                scored.append((s, ytm_version(c)))
        scored.sort(key=lambda x: -x[0])
        return [c for _, c in scored[:limit]]

    async def radio_page(self, vid, playlist_id=None, params=None, limit=50):
        self._chk()
        self.radio_calls += 1
        ids = self.radio_map.get((vid, playlist_id), self.radio_map.get(vid, []))
        page = RadioPage(tracks=[ytm_version(self.catalog[i]) if i in self.catalog else i for i in ids])
        page.chips = [{"id": "all", "label": "All", "selected": True, "playlist_id": None, "params": None},
                      {"id": "discover", "label": "Discover", "selected": False, "playlist_id": "RDATiX", "params": "p"}]
        if self.cont_map:
            page.cursor = RadioCursor("tok1", {"videoId": vid})
        return page

    async def radio_continue(self, cursor):
        self._chk()
        ids = self.cont_map.get(cursor.token, [])
        return RadioPage(tracks=[ytm_version(self.catalog[i]) for i in ids])

    async def charts(self, country="IN"):
        self._chk()
        return [ytm_version(self.catalog[i]) for i in self.chart_ids]

    async def related(self, vid, related_browse_id=None):
        self._chk()
        return {"you_might_like": [ytm_version(self.catalog[i]) for i in self.radio_map.get(vid, [])[:5]],
                "similar_artists": [{"name": "Atif Aslam", "browse_id": "UC1"}],
                "other_performances": [], "playlists": []}
