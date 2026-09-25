from sway_taste_engine.diversity import DiversityReranker
from sway_taste_engine.models import FeedType,Track
from sway_taste_engine.ranking import RankedCandidate
from sway_taste_engine.retrieval import Candidate
def mk(i,a,s):return RankedCandidate(Candidate(Track(id=i,title=i,artist_id=a,artist_name=a,provider_available={"jiosaavn":True}),"test",.5),s,{})
def test_artist_diversity():
    out=DiversityReranker().rerank([mk("1","a",1),mk("2","a",.99),mk("3","b",.98)],FeedType.FOR_YOU,3);assert out[1].candidate.track.artist_id=="b"
