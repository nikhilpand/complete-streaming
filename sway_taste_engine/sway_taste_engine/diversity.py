from __future__ import annotations
from collections import Counter
from .models import FeedType
from .ranking import RankedCandidate
class DiversityReranker:
    def __init__(self,artist_lambda=.11,album_lambda=.04,genre_lambda=.03,language_lambda=.02): self.artist_lambda=artist_lambda;self.album_lambda=album_lambda;self.genre_lambda=genre_lambda;self.language_lambda=language_lambda
    def rerank(self,ranked,feed,limit):
        selected=[]; a=Counter(); al=Counter(); g=Counter(); l=Counter()
        while ranked and len(selected)<limit:
            best_i=0; best_s=float("-inf")
            for i,item in enumerate(ranked):
                t=item.candidate.track; penalty=self.artist_lambda*a[t.artist_id]+self.album_lambda*al[t.album_id or "_"]+self.genre_lambda*sum(g[x.lower()] for x in t.genres[:3])+self.language_lambda*l[t.language.lower() if t.language else "_"]; s=item.score-penalty
                if s>best_s: best_i=i;best_s=s
            item=ranked.pop(best_i); selected.append(RankedCandidate(item.candidate,best_s,{**item.components,"diversity_adjusted":best_s})); t=item.candidate.track; a[t.artist_id]+=1;al[t.album_id or "_"]+=1
            for x in t.genres[:3]:g[x.lower()]+=1
            l[t.language.lower() if t.language else "_"]+=1
        return selected
