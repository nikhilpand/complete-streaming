from __future__ import annotations
import hashlib, uuid
from .cursors import decode_cursor, encode_cursor
from .diversity import DiversityReranker
from .models import (
    FeedType,
    RecommendationContext,
    RecommendationExplanation,
    RecommendationItem,
    RecommendationResponse,
    ScoreBreakdown,
)
from .profile import TasteProfileBuilder
from .ranking import RuleBasedRanker
from .retrieval import RetrieverRegistry
from .storage import InMemoryStore
class RecommendationEngine:
    ALGORITHM_VERSION="sway-rec-v1"; PROFILE_VERSION="profile-v1"
    def __init__(self, store=None, track_similarity=None, artist_similarity=None):
        self.store = store or InMemoryStore()
        self.profile_builder = TasteProfileBuilder()
        self.retrievers = RetrieverRegistry(track_similarity, artist_similarity, store=self.store)
        self.ranker = RuleBasedRanker()
        self.diversity = DiversityReranker()
    def ingest_event(self,event):
        ok=self.store.add_event(event)
        if ok:self.rebuild_profile(event.user_id)
        return ok
    def rebuild_profile(self, user_id):
        catalog = getattr(self.store, "tracks", None)
        if catalog is None or not isinstance(catalog, dict):
            catalog = {t.id: t for t in self.store.all_tracks()}
        self.store.save_profile(self.profile_builder.build(user_id, self.store.user_events(user_id), catalog))
    def seed_catalog(self,tracks):self.store.upsert_tracks(tracks)
    def _explanation(self,c):
        labels={"recent":"Based on your recent listening","affinity":"From an artist you listen to","similar_track":"Similar to a track you played","similar_artist":"From a related artist","discovery":"A discovery near your taste","new_release":"A new release near your taste","trending":"Trending music that matches your taste","session":"Fits your current listening session"}; typ={"recent":"recent","affinity":"artist_affinity","similar_track":"similar_track","similar_artist":"similar_artist","discovery":"discovery","new_release":"new_release","trending":"personalized_trending","session":"session"}.get(c.source,"recommendation")
        return RecommendationExplanation(type=typ,label=labels.get(c.source,"Recommended for you"),reference_track_id=c.reference_track_id,reference_artist_id=c.reference_artist_id)
    def _seed(self,user_id,feed,ctx):return hashlib.sha256(f"{user_id}|{feed.value}|{ctx.session_id or ''}|{ctx.current_track_id or ''}".encode()).hexdigest()[:16]
    def recommend(self,user_id,feed,context=None,limit=20,cursor=None):
        ctx=context or RecommendationContext(); limit=max(1,min(100,limit)); profile=self.store.get_profile(user_id); tracks=self.store.all_tracks(); ix={t.id:t for t in tracks}; seed=self._seed(user_id,feed,ctx); seen=set()
        if cursor:
            state=decode_cursor(cursor)
            if state.get("seed")!=seed or state.get("feed")!=feed.value:raise ValueError("Cursor does not belong to this feed/session")
            seen=set(state.get("seen",[]))
        candidates=self.retrievers.retrieve(feed,tracks,profile,ctx,250)
        merged={}
        for c in candidates:
            if c.track.id not in seen and (c.track.id not in merged or c.source_strength>merged[c.track.id].source_strength):merged[c.track.id]=c
        ranked=self.ranker.rank(list(merged.values()),profile,ctx,feed,ix); reranked=self.diversity.rerank(ranked,feed,min(len(ranked),max(limit*5,100)))
        page=reranked[:limit]; items=[]; new_seen=list(seen)
        for idx,r in enumerate(page,1):
            rid=f"rec_{uuid.uuid4().hex[:16]}"
            explanation = self._explanation(r.candidate)
            attribution = ScoreBreakdown(
                total=round(r.score, 6),
                components={k: round(v, 6) for k, v in r.components.items()},
                explanation_type=explanation.type,
                explanation_label=explanation.label,
                reference_track_id=explanation.reference_track_id,
                reference_artist_id=explanation.reference_artist_id,
                negative_checks_passed=True,
            )
            items.append(
                RecommendationItem(
                    recommendation_id=rid,
                    track=r.candidate.track,
                    rank=idx,
                    score=round(r.score, 6),
                    source=r.candidate.source,
                    explanation=explanation,
                    attribution=attribution,
                )
            )
            new_seen.append(r.candidate.track.id)
        next_cursor=encode_cursor({"seed":seed,"feed":feed.value,"seen":new_seen[-500:]}) if len(page)==limit else None
        profile.recent_recommendations=[x.track.id for x in items]+profile.recent_recommendations[:100]; self.store.save_profile(profile)
        return RecommendationResponse(feed=feed,items=items,next_cursor=next_cursor,algorithm_version=self.ALGORITHM_VERSION,profile_version=self.PROFILE_VERSION)
