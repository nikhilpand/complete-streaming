"""YouTube Music (InnerTune) client used ONLY as a taste graph: radio, chips, related, charts.

Raw `next` requests follow the pattern documented in the ytmusicapi community
(RDAMVM<videoId> playlist, params "wAEB", continuation token per page). The response parser here is
our own so a ytmusicapi refactor can't break us; only `YTMusic._send_request` is relied upon.
Response shapes are undocumented -> record real responses as fixtures (see tests) and run a canary.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

from ..models import Candidate
from ..text import parse_duration

_ARTIST_PAGES = {"MUSIC_PAGE_TYPE_ARTIST", "MUSIC_PAGE_TYPE_USER_CHANNEL"}
_ALBUM_PAGE = "MUSIC_PAGE_TYPE_ALBUM"


@dataclass
class RadioCursor:
    token: str
    body: dict
    kind: str = "nextRadioContinuationData"


@dataclass
class RadioPage:
    tracks: list[Candidate] = field(default_factory=list)
    chips: list[dict] = field(default_factory=list)
    cursor: Optional[RadioCursor] = None
    related_browse_id: Optional[str] = None
    lyrics_browse_id: Optional[str] = None

    def clone(self) -> "RadioPage":
        return RadioPage([t.clone() for t in self.tracks], [dict(c) for c in self.chips],
                         self.cursor, self.related_browse_id, self.lyrics_browse_id)


# ------------------------------------------------------------------ parsing helpers
def _walk(obj: Any) -> Iterator[dict]:
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _runs_text(node: Optional[dict]) -> str:
    if not node:
        return ""
    if "simpleText" in node:
        return node["simpleText"]
    return "".join(r.get("text", "") for r in node.get("runs", []))


def _page_type(run: dict) -> str:
    try:
        return run["navigationEndpoint"]["browseEndpoint"]["browseEndpointContextSupportedConfigs"][
            "browseEndpointContextMusicConfig"]["pageType"]
    except (KeyError, TypeError):
        return ""


def upscale_image(url: str, size: int = 544) -> str:
    if url and ("googleusercontent" in url or "ggpht" in url):
        return re.sub(r"=w\d+-h\d+[^&]*$|=s\d+[^&]*$", f"=w{size}-h{size}-l90-rj", url)
    return url


def parse_panel_item(item: dict) -> Optional[Candidate]:
    r = item.get("playlistPanelVideoRenderer")
    if r is None:
        wrapper = item.get("playlistPanelVideoWrapperRenderer") or {}
        r = (wrapper.get("primaryRenderer") or {}).get("playlistPanelVideoRenderer")
    if not r or not r.get("videoId"):
        return None
    runs = (r.get("longBylineText") or {}).get("runs", [])
    artists, album = [], ""
    for run in runs:
        pt = _page_type(run)
        if pt in _ARTIST_PAGES:
            artists.append(run.get("text", ""))
        elif pt == _ALBUM_PAGE:
            album = run.get("text", "")
    if not artists:  # fallback: "Artist1 & Artist2 • Album • 2013"
        parts = _runs_text(r.get("longBylineText")).split(" • ")
        if parts and parts[0]:
            artists = [a.strip() for a in re.split(r",|&", parts[0]) if a.strip()]
        if len(parts) > 1 and not parts[1].strip().isdigit():
            album = album or parts[1].strip()
    thumbs = (r.get("thumbnail") or {}).get("thumbnails", [])
    vtype = ""
    try:
        vtype = r["navigationEndpoint"]["watchEndpoint"]["watchEndpointMusicSupportedConfigs"][
            "watchEndpointMusicConfig"]["musicVideoType"]
    except (KeyError, TypeError):
        pass
    return Candidate(
        title=_runs_text(r.get("title")),
        artists=artists,
        album=album,
        duration_sec=parse_duration(_runs_text(r.get("lengthText"))),
        image=upscale_image(thumbs[-1]["url"]) if thumbs else "",
        explicit="MUSIC_EXPLICIT_BADGE" in json.dumps(r.get("badges", [])),
        ytm_video_id=r["videoId"],
        extra={"video_type": vtype},
    )


def parse_chips(response: dict) -> list[dict]:
    """Radio tuner chips (subHeaderChipCloud). Shape is discovered generically because YTM A/B-tests it."""
    chips: list[dict] = []
    for node in _walk(response):
        if "chipCloudChipRenderer" not in node:
            continue
        r = node["chipCloudChipRenderer"]
        label = _runs_text(r.get("text")) or r.get("accessibilityData", {}).get("label", "")
        endpoint: dict = {}
        for sub in _walk(r):
            if isinstance(sub.get("watchEndpoint"), dict):
                endpoint = sub["watchEndpoint"]
                break
        if not label:
            continue
        chips.append({
            "id": re.sub(r"\W+", "_", label.strip().lower()).strip("_") or "chip",
            "label": label.strip(),
            "selected": bool(r.get("isSelected")),
            "playlist_id": endpoint.get("playlistId"),
            "params": endpoint.get("params"),
        })
    return chips


def parse_radio_response(response: dict, body: dict) -> RadioPage:
    panel: Optional[dict] = None
    queue: dict = {}
    try:
        queue = response["contents"]["singleColumnMusicWatchNextResultsRenderer"]["tabbedRenderer"][
            "watchNextTabbedResultsRenderer"]["tabs"][0]["tabRenderer"]["content"]["musicQueueRenderer"]
        panel = queue["content"]["playlistPanelRenderer"]
    except (KeyError, IndexError, TypeError):
        pass
    if panel is None:
        panel = (response.get("continuationContents") or {}).get("playlistPanelContinuation")
    page = RadioPage()
    if not panel:
        return page
    for item in panel.get("contents", []):
        c = parse_panel_item(item)
        if c:
            page.tracks.append(c)
    for cont in panel.get("continuations", []) or []:
        for kind in ("nextRadioContinuationData", "nextContinuationData"):
            if kind in cont and cont[kind].get("continuation"):
                page.cursor = RadioCursor(cont[kind]["continuation"], body, kind)
                break
        if page.cursor:
            break
    if queue:
        page.chips = parse_chips(queue)
    tabs = []
    try:
        tabs = response["contents"]["singleColumnMusicWatchNextResultsRenderer"]["tabbedRenderer"][
            "watchNextTabbedResultsRenderer"]["tabs"]
    except (KeyError, TypeError):
        pass
    for tab in tabs[1:]:
        tr = tab.get("tabRenderer", {})
        bid = (tr.get("endpoint") or {}).get("browseEndpoint", {}).get("browseId")
        if bid and bid.startswith("MPTR"):
            page.related_browse_id = bid
        elif bid and bid.startswith("MPLY"):
            page.lyrics_browse_id = bid
    return page


def build_radio_body(video_id: str, playlist_id: Optional[str] = None, params: Optional[str] = None) -> dict:
    return {
        "enablePersistentPlaylistPanel": True,
        "isAudioOnly": True,
        "tunerSettingValue": "AUTOMIX_SETTING_NORMAL",
        "videoId": video_id,
        "playlistId": playlist_id or f"RDAMVM{video_id}",
        "params": params or "wAEB",
        "watchEndpointMusicSupportedConfigs": {"watchEndpointMusicConfig": {
            "hasPersistentPlaylistPanel": True, "musicVideoType": "MUSIC_VIDEO_TYPE_ATV"}},
    }


def song_from_ytmusicapi(d: dict) -> Candidate:
    """Adapts ytmusicapi's parsed song dicts (search / watch playlist / related)."""
    thumbs = d.get("thumbnail") or d.get("thumbnails") or []
    album = d.get("album")
    return Candidate(
        title=d.get("title", ""),
        artists=[a["name"] for a in (d.get("artists") or []) if isinstance(a, dict) and a.get("name")],
        album=(album.get("name", "") if isinstance(album, dict) else (album or "")),
        duration_sec=int(d.get("duration_seconds") or parse_duration(d.get("length") or d.get("duration"))),
        image=upscale_image(thumbs[-1]["url"]) if thumbs and isinstance(thumbs[-1], dict) else "",
        explicit=bool(d.get("isExplicit")),
        year=str(d.get("year") or ""),
        ytm_video_id=d.get("videoId"),
        extra={"video_type": d.get("videoType", "")},
    )


# ------------------------------------------------------------------ client
class YtmClient:
    def __init__(self, language: str = "en", location: str = "IN", yt: Any = None):
        self._language, self._location, self._yt = language, location, yt

    def _client(self):
        if self._yt is None:
            from ytmusicapi import YTMusic  # lazy: keeps import cost/failure out of app start
            self._yt = YTMusic(language=self._language, location=self._location)
        return self._yt

    async def search_song(self, query: str, limit: int = 5) -> list[Candidate]:
        res = await asyncio.to_thread(lambda: self._client().search(query, filter="songs", limit=limit, ignore_spelling=True))
        return [song_from_ytmusicapi(r) for r in res if r.get("videoId")]

    async def radio_page(self, video_id: str, playlist_id: Optional[str] = None,
                         params: Optional[str] = None, limit: int = 50) -> RadioPage:
        body = build_radio_body(video_id, playlist_id, params)
        try:
            resp = await asyncio.to_thread(lambda: self._client()._send_request("next", body))
            page = parse_radio_response(resp, body)
            if page.tracks:
                return page
        except Exception:
            pass  # fall through to the library's own (slower, 25-50 tracks) implementation
        wp = await asyncio.to_thread(lambda: self._client().get_watch_playlist(videoId=video_id, radio=True, limit=limit))
        page = RadioPage(tracks=[song_from_ytmusicapi(t) for t in wp.get("tracks", []) if t.get("videoId")])
        page.related_browse_id = wp.get("related")
        page.lyrics_browse_id = wp.get("lyrics")
        return page

    async def radio_continue(self, cursor: RadioCursor) -> RadioPage:
        extra = f"&ctoken={cursor.token}&continuation={cursor.token}"
        resp = await asyncio.to_thread(lambda: self._client()._send_request("next", cursor.body, extra))
        return parse_radio_response(resp, cursor.body)

    async def charts(self, country: str = "IN") -> list[Candidate]:
        try:
            data = await asyncio.to_thread(lambda: self._client().get_charts(country=country))
            videos = data.get("videos") if isinstance(data, dict) else None
            songs = []
            if isinstance(videos, dict):
                songs = videos.get("items") or []
            elif isinstance(videos, list) and videos:
                first_pl = videos[0].get("playlistId")
                if first_pl:
                    pl = await asyncio.to_thread(lambda: self._client().get_playlist(first_pl, limit=30))
                    songs = pl.get("tracks") or []
            if not songs and isinstance(data, dict):
                songs_data = data.get("songs")
                if isinstance(songs_data, dict):
                    songs = songs_data.get("items") or []
                elif isinstance(songs_data, list):
                    songs = songs_data
            if songs:
                return [song_from_ytmusicapi(s) for s in songs if isinstance(s, dict) and s.get("videoId")]
        except Exception:
            pass
        try:
            return await self.search_song("Top Trending Songs India", limit=25)
        except Exception:
            return []

    async def related(self, video_id: str, related_browse_id: Optional[str] = None) -> dict:
        def _go():
            yt = self._client()
            bid = related_browse_id or yt.get_watch_playlist(videoId=video_id).get("related")
            return yt.get_song_related(bid) if bid else []
        shelves = await asyncio.to_thread(_go)
        out = {"you_might_like": [], "similar_artists": [], "other_performances": [], "playlists": []}
        for shelf in shelves or []:
            title = (shelf.get("title") or "").lower()
            contents = shelf.get("contents") or []
            if "might also like" in title or "you might" in title:
                out["you_might_like"] = [song_from_ytmusicapi(c) for c in contents if c.get("videoId")]
            elif "similar artists" in title or "fans might also like" in title:
                out["similar_artists"] = [
                    {"name": c.get("title"), "browse_id": c.get("browseId"), "subscribers": c.get("subscribers"),
                     "image": (c.get("thumbnails") or [{}])[-1].get("url")} for c in contents if c.get("browseId")]
            elif "other performances" in title or "other versions" in title:
                out["other_performances"] = [song_from_ytmusicapi(c) for c in contents if c.get("videoId")]
            elif "playlist" in title:
                out["playlists"] = [
                    {"title": c.get("title"), "playlist_id": c.get("playlistId"),
                     "image": (c.get("thumbnails") or [{}])[-1].get("url")} for c in contents if c.get("playlistId")]
        return out
