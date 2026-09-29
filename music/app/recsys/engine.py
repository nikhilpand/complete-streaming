"""SWAY recommendation engine: one pipeline behind radio / next-songs / quick-picks / related.

  retrieve (YTM radio + Saavn reco/station + own graph, parallel, failure-isolated)
    -> fuse (RRF + cross-source agreement)
    -> resolve to playable Saavn ids (persistent identity map, bounded latency)
    -> rank (user affinity, language, skip stats, version penalties)
    -> post-filter (no repeats, coherent language, artist diversity)
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Optional

from .clients.ytm import RadioPage
from .config import Settings
from .fusion import fuse, merge_by_saavn_id
from .infra import TTLCache
from .matching import IdentityResolver
from .models import Candidate
from .postfilter import postfilter
from .ranker import UserProfile, build_profile, rank
from .session import Session, SessionStore
from .sources import Sources
from .store import EVENT_KINDS, Store

log = logging.getLogger("sway.recsys")


@dataclass
class ChipSel:
    id: str = "all"
    playlist_id: Optional[str] = None
    params: Optional[str] = None


def hash_user(raw: Optional[str], salt: str) -> Optional[str]:
    """YTM never sees user ids; our own store only keeps a salted hash."""
    return hashlib.sha256(f"{salt}:{raw}".encode()).hexdigest()[:24] if raw else None


class RecommendationEngine:
    def __init__(self, ytm, saavn, store: Store, settings: Optional[Settings] = None,
                 sessions: Optional[SessionStore] = None):
        self.s = settings or Settings()
        self.store, self.saavn, self.ytm = store, saavn, ytm
        self.sources = Sources(ytm, saavn, store, self.s)
        self.resolver = IdentityResolver(store, saavn, ytm, self.s)
        self.sessions = sessions or SessionStore(self.s.session_ttl_s)
        self._trend_cache = TTLCache(4)

    # ------------------------------------------------------------------ seeds
    async def load_seed(self, track_id: str, title: str = "", artist: str = "") -> Optional[Candidate]:
        tid = (track_id or "").strip()
        if not tid:
            return None
        if tid.startswith(("youtube:", "yt:")):
            vid = tid.split(":", 1)[1]
            seed = Candidate(title=title, artists=[artist] if artist else [], ytm_video_id=vid)
            hit = self.store.identity_get_by_ytm(vid)
            if hit:
                meta = self.store.meta_get(hit[0])
                if meta:
                    seed = Candidate.from_meta(meta)
                    seed.ytm_video_id = vid
                seed.saavn_id = hit[0]
            return seed
        meta = self.store.meta_get(tid)
        seed = Candidate.from_meta(meta) if meta else await self.sources.saavn_song(tid)
        if seed is None:
            seed = Candidate(title=title, artists=[artist] if artist else [])
        seed.saavn_id = tid
        if not seed.ytm_video_id and seed.title:
            seed.ytm_video_id = await self.resolver.to_ytm(seed)
        return seed

    # ------------------------------------------------------------------ retrieval
    async def gather(self, seed: Candidate, *, chip: Optional[ChipSel] = None, cursor=None,
                     include_saavn: bool = True) -> tuple[dict[str, list[Candidate]], Optional[RadioPage]]:
        lists: dict[str, list[Candidate]] = {}
        page: Optional[RadioPage] = None
        tuned = bool(chip and chip.playlist_id)

        async def ytm_part() -> Optional[RadioPage]:
            if cursor is not None:
                p = await self.sources.ytm_continue(cursor)
                if p and p.tracks:
                    return p
            if seed.ytm_video_id:
                return await self.sources.ytm_radio(
                    seed.ytm_video_id, chip.playlist_id if tuned else None, chip.params if tuned else None)
            return None

        async def saavn_parts(sid: str):
            return await asyncio.gather(self.sources.saavn_reco(sid), self.sources.saavn_station(sid))

        want_saavn = include_saavn and not tuned
        if want_saavn and seed.saavn_id:
            page, (reco, station) = await asyncio.gather(ytm_part(), saavn_parts(seed.saavn_id))
            lists["saavn_reco"], lists["saavn_station"] = reco, station
        else:
            page = await ytm_part()
            if want_saavn and seed.ytm_video_id and page and page.tracks:
                if not seed.title and page.tracks[0].ytm_video_id == seed.ytm_video_id:
                    seed.fill_from(page.tracks[0])
                    seed.title, seed.artists = page.tracks[0].title, page.tracks[0].artists
                if await self.resolver.to_saavn(seed):
                    reco, station = await saavn_parts(seed.saavn_id)
                    lists["saavn_reco"], lists["saavn_station"] = reco, station
        if page and page.tracks:
            lists["ytm"] = [t for i, t in enumerate(page.tracks)]
            for i, t in enumerate(lists["ytm"]):
                t.source, t.source_rank = "ytm", i
        if want_saavn and seed.saavn_id:
            g = self.sources.graph(seed.saavn_id)
            if g:
                lists["graph"] = g
        return lists, page

    # ------------------------------------------------------------------ rank pipeline
    async def _resolve_pool(self, pool: list[Candidate]) -> None:
        todo = [asyncio.ensure_future(self.resolver.to_saavn(c)) for c in pool if not c.saavn_id]
        if not todo:
            return
        done, pending = await asyncio.wait(todo, timeout=self.s.resolve_timeout_s)
        for t in pending:
            t.cancel()
        for t in done:
            t.exception()        # mark retrieved; failures just leave the candidate unresolved

    async def rank_pipeline(self, seed: Optional[Candidate], lists: dict[str, list[Candidate]],
                            session: Optional[Session], user: Optional[str], limit: int,
                            profile: Optional[UserProfile] = None, max_per_artist: Optional[int] = None,
                            ) -> list[Candidate]:
        fused = fuse(lists, self.s.source_weights, k=self.s.rrf_k,
                     agreement_bonus=self.s.agreement_bonus, exclude=seed)
        pool = fused[: self.s.resolve_pool]
        await self._resolve_pool(pool)
        pool = merge_by_saavn_id([c for c in pool if c.saavn_id])
        if profile is None:
            profile = build_profile(self.store, user, self.s)
        stats = self.store.track_stats_get_many(c.saavn_id for c in pool)
        rank(pool, seed, profile, stats, self.s)
        pool.sort(key=lambda c: c.score, reverse=True)
        return postfilter(
            pool, seed=seed,
            served_ids=session.served_ids if session else (), served_keys=session.served_keys if session else (),
            blocked_ids=profile.blocked_ids, limit=limit, min_gap=self.s.min_artist_gap,
            max_per_artist=max_per_artist or self.s.max_per_artist)

    async def trending(self, limit: int = 20) -> list[Candidate]:
        hit = self._trend_cache.get("t")
        if hit is None:
            charts, saavn_tr = await asyncio.gather(self.sources.ytm_charts(self.s.ytm_location), self.sources.saavn_trending())
            for i, c in enumerate(charts):
                c.source, c.source_rank = "trending_ytm", i
            lists = {"trending_ytm": charts, "trending_saavn": saavn_tr}
            hit = await self.rank_pipeline(None, lists, None, None, 40)
            if hit:
                self._trend_cache.set("t", hit, self.s.trending_ttl_s)
        return [c.clone() for c in (hit or [])][:limit]

    # ------------------------------------------------------------------ public: radio / next
    def _commit(self, session: Session, tracks: list[Candidate], user: Optional[str]) -> None:
        session.mark_served(tracks)
        for c in tracks:
            self.store.meta_put(c)
        try:
            self.store.log_events([{
                "user": user, "session": session.id, "track_id": c.saavn_id, "kind": "impression",
                "position_ms": i, "organic": False, "source": ",".join(sorted(c.sources))}
                for i, c in enumerate(tracks)])
        except Exception:  # noqa: BLE001 - telemetry must never break serving
            log.exception("impression logging failed")

    async def radio(self, *, track_id: str, user: Optional[str] = None, session_id: Optional[str] = None,
                    limit: int = 25, chip_id: str = "all", chip_playlist_id: Optional[str] = None,
                    chip_params: Optional[str] = None, title: str = "", artist: str = "") -> dict:
        t0 = time.perf_counter()
        seed = await self.load_seed(track_id, title, artist)
        if seed is None:
            raise ValueError("unknown track_id")
        session = self.sessions.get_or_create(session_id, user)
        chip = ChipSel(chip_id, chip_playlist_id, chip_params)
        lists, page = await self.gather(seed, chip=chip)
        session.seed_saavn_id, session.seed_ytm_id, session.chip_id = seed.saavn_id, seed.ytm_video_id, chip_id
        session.cursor = page.cursor if page else None
        tracks = await self.rank_pipeline(seed, lists, session, user, limit)
        used = sorted(lists)
        if not tracks:
            tracks = (await self.trending(limit))[:limit]
            used = ["trending_fallback"]
        self._commit(session, tracks, user)
        return {
            "seed": seed.to_public(),
            "tracks": [t.to_public() for t in tracks],
            "tuning_chips": page.chips if page else [],
            "session_id": session.id,
            "related_browse_id": page.related_browse_id if page else None,
            "sources_used": used,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    async def next_songs(self, *, session_id: Optional[str], current_track_id: str, count: int = 20,
                         user: Optional[str] = None) -> dict:
        """Queue continuation. Uses the radio's continuation token for the YTM part and re-anchors the
        Saavn/graph part on the track that is playing NOW, so the queue follows the listener's drift."""
        session = self.sessions.get(session_id)
        if session is None:
            return await self.radio(track_id=current_track_id, user=user, session_id=session_id, limit=count)
        t0 = time.perf_counter()
        current = await self.load_seed(current_track_id)
        if current is None:
            raise ValueError("unknown track_id")
        lists, page = await self.gather(current, cursor=session.cursor)
        session.cursor = page.cursor if page else None
        tracks = await self.rank_pipeline(current, lists, session, user, count)
        used = sorted(lists)
        if not tracks:
            tracks = (await self.trending(count))
            tracks = [t for t in tracks if t.saavn_id not in session.served_ids][:count]
            used = ["trending_fallback"]
        self._commit(session, tracks, user)
        return {
            "tracks": [t.to_public() for t in tracks],
            "session_id": session.id,
            "sources_used": used,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    # ------------------------------------------------------------------ related hub
    async def related(self, *, track_id: str, user: Optional[str] = None, limit: int = 20) -> dict:
        seed = await self.load_seed(track_id)
        if seed is None:
            raise ValueError("unknown track_id")
        hub: dict = {"you_might_like": [], "similar_artists": [], "other_performances": [], "playlists": []}
        lists: dict[str, list[Candidate]] = {}
        if seed.ytm_video_id:
            r = await self.sources.ytm_related(seed.ytm_video_id)
            hub["similar_artists"] = r.get("similar_artists", [])
            hub["playlists"] = r.get("playlists", [])
            hub["other_performances"] = [c.to_public() for c in r.get("other_performances", [])]
            lists["ytm"] = [c.clone() for c in r.get("you_might_like", [])]
        if seed.saavn_id:
            lists["saavn_reco"] = await self.sources.saavn_reco(seed.saavn_id)
        tracks = await self.rank_pipeline(seed, lists, None, user, limit, max_per_artist=6)
        hub["you_might_like"] = [t.to_public() for t in tracks]
        return hub

    # ------------------------------------------------------------------ feedback
    def record_event(self, *, user: Optional[str], session_id: Optional[str], track_id: str, kind: str,
                     position_ms: int = 0, duration_ms: int = 0, organic: bool = True, source: str = "") -> None:
        if kind not in EVENT_KINDS:
            raise ValueError(f"bad event kind {kind!r}")
        if track_id.startswith(("youtube:", "yt:")):      # normalise to the playable id when we know it
            hit = self.store.identity_get_by_ytm(track_id.split(":", 1)[1])
            if hit:
                track_id = hit[0]
        self.store.log_events([{"user": user, "session": session_id, "track_id": track_id, "kind": kind,
                                "position_ms": position_ms, "duration_ms": duration_ms,
                                "organic": organic, "source": source}])
        self.store.update_stats(track_id, kind, position_ms, self.s.early_skip_ms)
