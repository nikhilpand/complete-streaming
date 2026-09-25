from __future__ import annotations
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from .engine import RecommendationEngine
from .models import FeedType, RecommendationContext, RecommendationResponse, Track, UserEvent
class CatalogSeedRequest(BaseModel):tracks:list[Track]=Field(default_factory=list)
class RecommendationRequest(BaseModel):
    user_id:str; feed:FeedType=FeedType.FOR_YOU; context:RecommendationContext=Field(default_factory=RecommendationContext); limit:int=20; cursor:str|None=None
def create_app():
    app=FastAPI(title="SWAY Taste Engine",version="0.1.0"); engine=RecommendationEngine(); app.state.recommendation_engine=engine
    @app.get("/health")
    def health():return {"ok":True,"tracks":len(engine.store.tracks),"users":len(engine.store.profiles)}
    @app.post("/api/v1/catalog/seed")
    def seed(req:CatalogSeedRequest):engine.seed_catalog(req.tracks);return {"ok":True,"count":len(req.tracks)}
    @app.post("/api/v1/events")
    def event(e:UserEvent):return {"accepted":engine.ingest_event(e),"event_id":e.event_id}
    @app.post("/api/v1/profile/{user_id}/rebuild")
    def rebuild(user_id:str):engine.rebuild_profile(user_id);return {"ok":True,"user_id":user_id}
    @app.post("/api/v1/recommendations",response_model=RecommendationResponse)
    def rec(req:RecommendationRequest):
        try:return engine.recommend(req.user_id,req.feed,req.context,req.limit,req.cursor)
        except ValueError as e:raise HTTPException(status_code=400,detail=str(e)) from e
    return app
