from datetime import datetime, timezone
from sway_taste_engine.models import EventType, Track, UserEvent
from sway_taste_engine.profile import TasteProfileBuilder
def test_fast_skip_is_stronger_negative():
    t=Track(id="t",title="T",artist_id="a",artist_name="A",provider_available={"jiosaavn":True});b=TasteProfileBuilder();now=datetime.now(timezone.utc)
    a=UserEvent(event_id="a",user_id="u",session_id="s",event_type=EventType.SKIP,track_id="t",completion_ratio=.03,timestamp=now)
    z=UserEvent(event_id="z",user_id="u",session_id="s",event_type=EventType.SKIP,track_id="t",completion_ratio=.95,timestamp=now)
    assert b.build("u",[a],{"t":t},now).track["t"].negative > b.build("u",[z],{"t":t},now).track["t"].negative
