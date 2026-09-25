from __future__ import annotations
from collections import Counter
from dataclasses import dataclass
from .models import FeedType, RecommendationContext, Track, UserTasteProfile
@dataclass
class Candidate:
    track: Track
    source: str
    source_strength: float = 0.0
    reference_track_id: str | None = None
    reference_artist_id: str | None = None
class Retriever:
    def retrieve(self, tracks, profile, context, limit): raise NotImplementedError
class RecentRetriever(Retriever):
    def retrieve(self, tracks, profile, context, limit):
        recent=set(profile.recent_tracks); counts=Counter(profile.recent_artists); mx=max(counts.values(), default=1); out=[]
        for t in tracks:
            if t.id in recent: continue
            s=counts.get(t.artist_id,0)/mx
            if s>0: out.append(Candidate(t,"recent",s,reference_artist_id=t.artist_id))
        return sorted(out,key=lambda c:c.source_strength,reverse=True)[:limit]
class AffinityRetriever(Retriever):
    def retrieve(self, tracks, profile, context, limit):
        mx=max((b.net for b in profile.artist.values()),default=1.0); out=[]
        for t in tracks:
            b=profile.artist.get(t.artist_id)
            if b and b.net>0: out.append(Candidate(t,"affinity",min(1.0,b.net/max(.1,mx)),reference_artist_id=t.artist_id))
        return sorted(out,key=lambda c:c.source_strength,reverse=True)[:limit]
class SimilarTrackRetriever(Retriever):
    def __init__(self, mapping=None): self.mapping=mapping or {}
    def retrieve(self, tracks, profile, context, limit):
        ref=context.current_track_id or (profile.recent_tracks[0] if profile.recent_tracks else None)
        if not ref:return []
        ix={t.id:t for t in tracks}; out=[]
        for tid,s in sorted(self.mapping.get(ref,{}).items(),key=lambda x:x[1],reverse=True):
            if tid in ix and s>0: out.append(Candidate(ix[tid],"similar_track",float(s),reference_track_id=ref))
        return out[:limit]
class SimilarArtistRetriever(Retriever):
    def __init__(self, mapping=None): self.mapping=mapping or {}
    def retrieve(self, tracks, profile, context, limit):
        ix={t.id:t for t in tracks}; ref=None
        if context.current_track_id in ix: ref=ix[context.current_track_id].artist_id
        if not ref and profile.recent_artists: ref=profile.recent_artists[0]
        if not ref:return []
        sims=self.mapping.get(ref,{}); out=[Candidate(t,"similar_artist",float(sims[t.artist_id]),reference_artist_id=ref) for t in tracks if t.artist_id in sims and t.artist_id!=ref]
        return sorted(out,key=lambda c:c.source_strength,reverse=True)[:limit]
class DiscoveryRetriever(Retriever):
    def retrieve(self, tracks, profile, context, limit):
        genres={k for k,b in sorted(profile.genre.items(),key=lambda x:x[1].net,reverse=True)[:8] if b.net>0}; moods={k for k,b in sorted(profile.mood.items(),key=lambda x:x[1].net,reverse=True)[:6] if b.net>0}; langs={k for k,b in sorted(profile.language.items(),key=lambda x:x[1].net,reverse=True)[:4] if b.net>0}; seen=set(profile.recent_tracks); out=[]
        for t in tracks:
            if t.id in seen: continue
            s=(.35 if genres.intersection(g.lower() for g in t.genres) else 0)+(.25 if moods.intersection(m.lower() for m in t.moods) else 0)+(.20 if t.language and t.language.lower() in langs else 0)+.20*t.popularity
            if s>0: out.append(Candidate(t,"discovery",min(1.0,s)))
        return sorted(out,key=lambda c:c.source_strength,reverse=True)[:limit]
class NewReleaseRetriever(Retriever):
    def retrieve(self, tracks, profile, context, limit):
        artists={k for k,b in sorted(profile.artist.items(),key=lambda x:x[1].net,reverse=True)[:20] if b.net>0}
        out=[Candidate(t,"new_release",.7+.3*t.popularity,reference_artist_id=t.artist_id) for t in tracks if t.artist_id in artists]
        return sorted(out,key=lambda c:((c.track.release_ts or 0),c.track.popularity),reverse=True)[:limit]
class PopularityRetriever(Retriever):
    def retrieve(self, tracks, profile, context, limit): return [Candidate(t,"trending",t.popularity) for t in sorted(tracks,key=lambda x:x.popularity,reverse=True)[:limit]]
class SessionRetriever(Retriever):
    def retrieve(self, tracks, profile, context, limit):
        recent=set(context.recent_track_ids[:10]); ix={t.id:t for t in tracks}; artists={ix[x].artist_id for x in recent if x in ix}; out=[Candidate(t,"session",.8 if t.artist_id in artists else .2,reference_artist_id=t.artist_id) for t in tracks if t.id not in recent]
        return sorted(out,key=lambda c:c.source_strength,reverse=True)[:limit]
class RetrieverRegistry:
    def __init__(self,track_similarity=None,artist_similarity=None):
        self.retrievers={"recent":RecentRetriever(),"affinity":AffinityRetriever(),"similar_track":SimilarTrackRetriever(track_similarity),"similar_artist":SimilarArtistRetriever(artist_similarity),"discovery":DiscoveryRetriever(),"new_release":NewReleaseRetriever(),"trending":PopularityRetriever(),"session":SessionRetriever()}
    def retrieve(self,feed,tracks,profile,context,per_source=150):
        names={FeedType.TRACK_RADIO:["similar_track","similar_artist","session","discovery"],FeedType.ARTIST_RADIO:["similar_artist","affinity","session","discovery"],FeedType.DISCOVER:["discovery","similar_artist","new_release","trending"],FeedType.NEW_RELEASES:["new_release","affinity","discovery"],FeedType.TRENDING:["trending","recent","affinity","discovery"],FeedType.AUTOPLAY:["session","recent","similar_track","similar_artist","affinity"],FeedType.FOR_YOU:["recent","affinity","session","new_release","similar_artist","discovery","trending"]}[feed]
        out=[]
        for name in names: out.extend(self.retrievers[name].retrieve(tracks,profile,context,per_source))
        return out
