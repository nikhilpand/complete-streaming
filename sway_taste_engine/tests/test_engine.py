from sway_taste_engine import EventType, FeedType, RecommendationContext, RecommendationEngine, Track, UserEvent

def tr(i,artist,genres=("pop",),mood=("chill",),language="en",energy=.4,popularity=.5):
    return Track(id=i,title=i,artist_id=artist,artist_name=artist,genres=list(genres),moods=list(mood),language=language,energy=energy,popularity=popularity,provider_available={"jiosaavn":True})
def ev(i,kind,track,ratio=1.0):return UserEvent(event_id=i,user_id="u",session_id="s",event_type=kind,track_id=track,completion_ratio=ratio)
def test_like_drives_artist_affinity():
    e=RecommendationEngine();e.seed_catalog([tr("a1","arijit",popularity=.9),tr("a2","arijit",popularity=.7),tr("b1","other",popularity=.8)]);e.ingest_event(ev("1",EventType.LIKE,"a1"));r=e.recommend("u",FeedType.FOR_YOU);assert "a2" in [x.track.id for x in r.items]
def test_dislike_filters_track():
    e=RecommendationEngine();e.seed_catalog([tr("a1","a"),tr("b1","b")]);e.ingest_event(ev("1",EventType.DISLIKE,"a1"));r=e.recommend("u",FeedType.FOR_YOU);assert "a1" not in [x.track.id for x in r.items]
def test_cursor_no_duplicates():
    e=RecommendationEngine();e.seed_catalog([tr(f"t{i}",f"a{i}",popularity=i/20) for i in range(20)]);r1=e.recommend("u",FeedType.TRENDING,RecommendationContext(session_id="s"),5);r2=e.recommend("u",FeedType.TRENDING,RecommendationContext(session_id="s"),5,r1.next_cursor);assert {x.track.id for x in r1.items}.isdisjoint({x.track.id for x in r2.items})
def test_recent_suppressed():
    e=RecommendationEngine();e.seed_catalog([tr("a1","a"),tr("b1","b")]);e.ingest_event(ev("1",EventType.COMPLETED,"a1"));r=e.recommend("u",FeedType.FOR_YOU,RecommendationContext(recent_track_ids=["a1"]));assert "a1" not in [x.track.id for x in r.items]
def test_idempotent():
    e=RecommendationEngine();e.seed_catalog([tr("a","x")]);x=ev("same",EventType.LIKE,"a");assert e.ingest_event(x);assert not e.ingest_event(x)
