"""
HTTP API for the recommendation engine.   pip install fastapi uvicorn
Run:  uvicorn api:app --reload
Your app calls POST /events on every play/skip/like, and GET /users/{id}/home for the home screen.
"""
from typing import List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from engine import EVENT_WEIGHTS, Engine

app = FastAPI(title="Music Recommendation API")
eng = Engine("music.db")          # one engine per process; use a connection pool with Postgres


class EventIn(BaseModel):
    user_id: str
    track_id: str
    type: str                     # play | play_complete | replay | like | share | add_to_playlist | skip | dislike


class OnboardingIn(BaseModel):
    genres: List[str] = []
    artists: List[str] = []


@app.post("/events")
def post_event(e: EventIn):
    if e.type not in EVENT_WEIGHTS:
        raise HTTPException(400, f"type must be one of {list(EVENT_WEIGHTS)}")
    if e.track_id not in eng.tracks():
        raise HTTPException(404, "unknown track")
    eng.log_event(e.user_id, e.track_id, e.type)
    return {"ok": True}


@app.post("/users/{uid}/onboarding")
def onboarding(uid: str, body: OnboardingIn):
    eng.set_seed_preferences(uid, body.genres, body.artists)
    return {"ok": True}


@app.get("/users/{uid}/recommendations")
def recommendations(uid: str, n: int = 20, mood: Optional[str] = None, genre: Optional[str] = None):
    return eng.recommend(uid, n=min(n, 50), mood=mood, genre=genre)


@app.get("/users/{uid}/home")
def home(uid: str):
    return eng.home_feed(uid)


@app.get("/users/{uid}/taste")
def taste(uid: str):
    return eng.classify_taste(uid)


@app.get("/tracks/{tid}/similar")
def similar(tid: str, n: int = 10):
    if tid not in eng.tracks():
        raise HTTPException(404, "unknown track")
    return eng.similar_tracks(tid, n)


@app.post("/admin/rebuild-similarity")
def rebuild(bg: BackgroundTasks):
    bg.add_task(eng.rebuild_similarity)     # schedule this nightly (cron) in production
    return {"queued": True}
