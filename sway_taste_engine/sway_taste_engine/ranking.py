from __future__ import annotations
import math,time
from dataclasses import dataclass
from .models import FeedType, RecommendationContext, Track, UserTasteProfile
from .retrieval import Candidate
@dataclass
class RankedCandidate:
    candidate: Candidate
    score: float
    components: dict[str,float]
class RuleBasedRanker:
    VERSION="rule-v1"
    FEED_WEIGHTS={
        FeedType.FOR_YOU:{"taste":.26,"session":.15,"similarity":.12,"novelty":.07,"freshness":.06,"popularity":.04,"playability":.06},
        FeedType.DISCOVER:{"taste":.18,"session":.10,"similarity":.18,"novelty":.18,"freshness":.09,"popularity":.03,"playability":.05},
        FeedType.AUTOPLAY:{"taste":.23,"session":.23,"similarity":.16,"novelty":.04,"freshness":.03,"popularity":.02,"playability":.09},
        FeedType.TRACK_RADIO:{"taste":.12,"session":.10,"similarity":.30,"novelty":.09,"freshness":.04,"popularity":.03,"playability":.06},
        FeedType.ARTIST_RADIO:{"taste":.20,"session":.12,"similarity":.24,"novelty":.10,"freshness":.04,"popularity":.03,"playability":.06},
        FeedType.NEW_RELEASES:{"taste":.27,"session":.06,"similarity":.08,"novelty":.09,"freshness":.30,"popularity":.03,"playability":.06},
        FeedType.TRENDING:{"taste":.20,"session":.08,"similarity":.08,"novelty":.04,"freshness":.10,"popularity":.35,"playability":.06},
    }
    def _affinity(self,p,t):
        artist=max(0.0,p.artist.get(t.artist_id).net if t.artist_id in p.artist else 0.0); genre=max(0.0,max((p.genre[g.lower()].net for g in t.genres if g.lower() in p.genre),default=0.0)); lang=max(0.0,p.language[t.language.lower()].net if t.language and t.language.lower() in p.language else 0.0); mood=max(0.0,max((p.mood[m.lower()].net for m in t.moods if m.lower() in p.mood),default=0.0)); den=max(1.0,max((b.net for b in p.artist.values()),default=1.0)); return min(1.0,(.50*artist+.22*genre+.12*lang+.16*mood)/den),{"artist_affinity":artist,"genre_affinity":genre,"language_affinity":lang,"mood_affinity":mood}
    def _novelty(self,p,t):
        if t.id in p.recent_tracks:return 0.0
        b=p.track.get(t.id); return .25 if b and b.count>0 else 1.0
    def _session_fit(self,ctx,t,ix):
        best=0.0
        for tid in ctx.recent_track_ids[:10]:
            r=ix.get(tid)
            if not r:continue
            v=(.45 if r.artist_id==t.artist_id else 0)+(.25 if set(r.genres)&set(t.genres) else 0)+(.12 if r.language and r.language==t.language else 0)+(.10 if set(r.moods)&set(t.moods) else 0)
            if r.energy is not None and t.energy is not None:v+=max(0.0,.08-abs(r.energy-t.energy)*.16)
            best=max(best,v)
        return best
    def rank(self,candidates,p,ctx,feed,ix):
        w=self.FEED_WEIGHTS[feed]; mx=max((c.track.popularity for c in candidates),default=1.0); recent=set(p.recent_tracks+ctx.recent_track_ids[:20]); out=[]
        duplicate_counts={}
        for c in candidates: duplicate_counts[c.track.id]=duplicate_counts.get(c.track.id,0)+1
        for c in candidates:
            t=c.track
            if not t.playable or t.id in p.explicit_negative_tracks or t.artist_id in p.explicit_negative_artists or t.id in recent:continue
            taste,parts=self._affinity(p,t); session=self._session_fit(ctx,t,ix); sim=max(0.0,min(1.0,c.source_strength)) if c.source in {"similar_track","similar_artist"} else 0.0; nov=self._novelty(p,t); fresh=.25 if t.release_ts is None else math.exp(-max(0.0,(time.time()-t.release_ts)/86400)/120.0); pop=t.popularity/max(.0001,mx); repeat=.45 if t.id in recent else 0.0; repeat+=.20 if t.id in p.recent_recommendations else 0.0; neg=min(.9,max(0.0,(p.track.get(t.id).negative if t.id in p.track else 0.0))*.08)
            target=ctx.energy_preference if ctx.energy_preference is not None else (0.85 if ctx.activity=="workout" else .35 if ctx.activity=="focus" else p.recent_energy or p.long_term_energy or .5); energy=1.0-abs(t.energy-target) if t.energy is not None else .5
            score=w["taste"]*taste+w["session"]*session+w["similarity"]*sim+w["novelty"]*nov*max(.15,ctx.novelty_preference)+w["freshness"]*fresh+w["popularity"]*pop+w["playability"]*1.0+0.05*energy+0.03*c.source_strength+min(.12,.03*duplicate_counts[t.id])-repeat-neg
            parts.update({"taste":taste,"session":session,"similarity":sim,"novelty":nov,"freshness":fresh,"popularity":pop,"playability":1.0,"energy_fit":energy,"repeat_penalty":repeat,"negative_penalty":neg})
            out.append(RankedCandidate(c,score,parts))
        return sorted(out,key=lambda x:x.score,reverse=True)
