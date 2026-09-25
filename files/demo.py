"""Seeds a fake catalog + users, then shows taste classification, recs, and the learning loop."""
import os
import random
import time

from engine import Engine

random.seed(7)
if os.path.exists("demo.db"):
    os.remove("demo.db")
eng = Engine("demo.db")

# genre: (energy, valence, danceability, tempo, moods)
G = {
    "pop": (0.70, 0.80, 0.80, 120, ["happy", "party"]), "rock": (0.85, 0.55, 0.50, 135, ["energetic"]),
    "metal": (0.95, 0.30, 0.40, 150, ["aggressive"]), "lofi": (0.25, 0.50, 0.60, 80, ["chill"]),
    "jazz": (0.40, 0.60, 0.50, 100, ["relaxed", "chill"]), "classical": (0.20, 0.40, 0.20, 70, ["calm"]),
    "hiphop": (0.70, 0.60, 0.85, 95, ["confident"]), "edm": (0.90, 0.70, 0.80, 128, ["party"]),
    "rnb": (0.50, 0.60, 0.70, 90, ["romantic"]), "indie": (0.55, 0.50, 0.50, 110, ["mellow"]),
}
jit = lambda x: max(0, min(1, x + random.uniform(-0.08, 0.08)))
for g, (e, v, d, tempo, moods) in G.items():
    for i in range(30):
        eng.add_track({"id": f"{g}{i}", "title": f"{g.title()} Song {i}", "artist": f"{g.title()} Artist {i % 6}",
                       "genre": g, "mood": random.choice(moods), "energy": jit(e), "valence": jit(v),
                       "danceability": jit(d), "tempo": tempo + random.uniform(-8, 8), "year": 2000 + i})

PERSONAS = {  # hidden "true" taste of each fake user
    "rocker1": {"rock", "metal", "indie"}, "rocker2": {"rock", "metal"}, "rocker3": {"metal", "rock", "edm"},
    "chill1": {"lofi", "jazz", "classical"}, "chill2": {"lofi", "jazz"}, "chill3": {"classical", "lofi", "indie"},
    "party1": {"pop", "edm", "hiphop"}, "party2": {"pop", "edm"}, "party3": {"hiphop", "rnb", "pop"},
    "rnb1": {"rnb", "hiphop", "jazz"},
}
all_ids = list(eng.tracks())
now = time.time()
events = []
for u, likes in PERSONAS.items():
    for _ in range(70):
        tid = random.choice([t for t in all_ids if eng.tracks()[t]["genre"] in likes]) \
            if random.random() < 0.85 else random.choice(all_ids)
        ok = eng.tracks()[tid]["genre"] in likes
        et = random.choices(["play_complete", "like", "replay", "skip"], [.55, .2, .1, .15] if ok else [.1, 0, 0, .9])[0]
        events.append((now - random.uniform(0, 30) * 86400, u, tid, et))
for ts, u, tid, et in sorted(events):            # chronological, so time-decay is correct
    eng.log_event(u, tid, et, ts)
eng.rebuild_similarity()
print(f"Seeded {len(all_ids)} tracks, {len(PERSONAS)} users, {len(events)} events\n")

print("=== Taste classifier ===")
for u in ("rocker1", "chill1", "party1"):
    t = eng.classify_taste(u)
    print(f"{u:8} -> {t['archetype']:18} {t['listener_type']:9} div={t['diversity']}  "
          f"genres={t['top_genres']} moods={t['top_moods']}")

print("\n=== Recommendations for rocker1 (exploit = known taste, explore = discovery) ===")
for r in eng.recommend("rocker1", 10, seed=1):
    print(f"  [{r['source']:7}] {r['title']:20} {r['genre']:8} - {r['reason']}")

# ---- learning loop: a brand-new account, onboarding + feedback rounds -------------
print("\n=== New account: cold start -> feedback loop ===")
truth = {"jazz", "lofi", "classical", "rnb"}     # what this new user REALLY likes
eng.set_seed_preferences("new_user", genres=["lofi"])
hit_rates = []
for rnd in range(1, 7):
    recs = eng.recommend("new_user", 10, seed=rnd, now=time.time() + rnd * 2 * 86400)
    hits = 0
    for r in recs:
        ok = r["genre"] in truth
        hits += ok
        eng.log_event("new_user", r["track_id"], "like" if ok else "skip", time.time() + rnd * 2 * 86400)
    hit_rates.append(hits / len(recs))
    ex = [r for r in recs if r["source"] == "explore"]
    print(f"  round {rnd}: hit-rate {hits / len(recs):.0%}   explore picks: "
          f"{[r['genre'] for r in ex]}")
t = eng.classify_taste("new_user")
print(f"  learned taste: {t['top_genres']} | {t['archetype']} | {t['listener_type']} | conf={t['confidence']}")
print(f"  hit-rate first 2 rounds {sum(hit_rates[:2]) / 2:.0%} -> last 2 rounds {sum(hit_rates[-2:]) / 2:.0%}")

print("\n=== Home feed shelves for chill1 ===")
for s in eng.home_feed("chill1")["shelves"]:
    print(f"  {s['title']:24} {[i['title'] for i in s['items'][:3]]}")
print("\nSimilar to Rock Song 0:", [t["title"] for t in eng.similar_tracks("rock0", 4)])
