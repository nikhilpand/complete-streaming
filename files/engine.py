"""
Music recommendation engine (account-based, database-backed).

Components
  1. Taste profile   - per-user, time-decayed, updated on every event, stored in DB
  2. Taste classifier- archetype (Chill Seeker, Headbanger...), listener type, top genres/moods
  3. Hybrid ranker   - content-based + item-item collaborative filtering + popularity
  4. Discovery       - Thompson-sampling bandit per (user, genre) that learns which
                       *new* genres the user actually likes, and feeds back into taste
Only the standard library is needed. Swap sqlite3 for psycopg2 to use Postgres.
"""
import json
import math
import random
import sqlite3
import time
from collections import defaultdict

DAY = 86400
HALF_LIFE_DAYS = 30          # how fast old listening fades from the taste profile
DIMS = ("genre", "mood", "artist")

# implicit feedback -> weight. >= 1.0 counts as a positive signal, <= -1.0 as negative
EVENT_WEIGHTS = {
    "play": 0.3, "play_complete": 1.0, "replay": 1.5, "like": 2.0, "share": 1.5,
    "add_to_playlist": 2.5, "skip": -0.7, "dislike": -3.0,
}

ARCHETYPES = {  # (energy, valence, danceability, tempo/200)
    "Energy Junkie":     (0.90, 0.60, 0.70, 0.65),
    "Feel-Good Groover": (0.70, 0.85, 0.85, 0.60),
    "Chill Seeker":      (0.30, 0.50, 0.45, 0.40),
    "Melancholic Soul":  (0.40, 0.20, 0.40, 0.45),
    "Focus & Ambient":   (0.20, 0.40, 0.25, 0.35),
    "Headbanger":        (0.95, 0.35, 0.50, 0.75),
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, created_ts REAL);
CREATE TABLE IF NOT EXISTS tracks(
  id TEXT PRIMARY KEY, title TEXT, artist TEXT, genre TEXT, mood TEXT,
  energy REAL, valence REAL, danceability REAL, tempo REAL, year INT);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, track_id TEXT,
  type TEXT, weight REAL, ts REAL);
CREATE INDEX IF NOT EXISTS ix_ev_user ON events(user_id, ts);
CREATE INDEX IF NOT EXISTS ix_ev_track ON events(track_id);
CREATE TABLE IF NOT EXISTS user_taste(user_id TEXT PRIMARY KEY, profile TEXT, updated_ts REAL);
CREATE TABLE IF NOT EXISTS item_sim(a TEXT, b TEXT, sim REAL, PRIMARY KEY(a, b));
CREATE TABLE IF NOT EXISTS explore_arms(
  user_id TEXT, arm TEXT, alpha REAL DEFAULT 1, beta REAL DEFAULT 1, PRIMARY KEY(user_id, arm));
CREATE TABLE IF NOT EXISTS recs_served(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, track_id TEXT,
  source TEXT, ts REAL, outcome REAL);
CREATE INDEX IF NOT EXISTS ix_served ON recs_served(user_id, track_id);
"""


def _new_profile():
    return {"genre": {}, "mood": {}, "artist": {}, "audio": [0.0] * 4, "audio_w": 0.0, "n": 0}


def _audio(t):
    return [t["energy"], t["valence"], t["danceability"], min(t["tempo"] / 200.0, 1.0)]


class Engine:
    def __init__(self, path="music.db"):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self._tcache = None
        self._sim = None

    # ------------------------------------------------------------------ data
    def add_user(self, uid):
        self.db.execute("INSERT OR IGNORE INTO users VALUES(?,?)", (uid, time.time()))
        self.db.commit()

    def add_track(self, t):
        self.db.execute(
            "INSERT OR REPLACE INTO tracks VALUES(:id,:title,:artist,:genre,:mood,"
            ":energy,:valence,:danceability,:tempo,:year)", t)
        self.db.commit()
        self._tcache = None

    def tracks(self):
        if self._tcache is None:
            self._tcache = {r["id"]: dict(r) for r in self.db.execute("SELECT * FROM tracks")}
        return self._tcache

    # -------------------------------------------------------- taste profile
    def _profile(self, uid, now):
        """Load the profile and decay it forward to `now`."""
        r = self.db.execute("SELECT profile, updated_ts FROM user_taste WHERE user_id=?",
                            (uid,)).fetchone()
        if not r:
            return _new_profile(), now
        p = json.loads(r["profile"])
        f = 0.5 ** (max(0.0, now - r["updated_ts"]) / (HALF_LIFE_DAYS * DAY))
        for d in DIMS:
            p[d] = {k: v * f for k, v in p[d].items() if abs(v * f) > 1e-4}
        p["audio"] = [a * f for a in p["audio"]]
        p["audio_w"] *= f
        return p, max(now, r["updated_ts"])

    def _save_profile(self, uid, p, ts):
        self.db.execute("INSERT OR REPLACE INTO user_taste VALUES(?,?,?)",
                        (uid, json.dumps(p), ts))

    def log_event(self, uid, track_id, etype, ts=None):
        """Record a listening event, update the taste profile and the discovery bandit."""
        ts = ts or time.time()
        w = EVENT_WEIGHTS[etype]
        t = self.tracks()[track_id]
        self.add_user(uid)
        self.db.execute("INSERT INTO events(user_id,track_id,type,weight,ts) VALUES(?,?,?,?,?)",
                        (uid, track_id, etype, w, ts))
        p, pts = self._profile(uid, ts)
        for d in DIMS:
            p[d][t[d]] = p[d].get(t[d], 0.0) + w
        if w > 0:
            p["audio"] = [a + w * x for a, x in zip(p["audio"], _audio(t))]
            p["audio_w"] += w
        p["n"] += 1
        self._save_profile(uid, p, pts)
        self._feedback_to_bandit(uid, track_id, w, ts)
        self.db.commit()

    def set_seed_preferences(self, uid, genres=(), artists=()):
        """Onboarding (like YT Music's 'pick artists you like') to fix cold start."""
        self.add_user(uid)
        p, ts = self._profile(uid, time.time())
        for g in genres:
            p["genre"][g] = p["genre"].get(g, 0) + 3.0
        for a in artists:
            p["artist"][a] = p["artist"].get(a, 0) + 3.0
            for t in self.tracks().values():
                if t["artist"] == a:
                    p["mood"][t["mood"]] = p["mood"].get(t["mood"], 0) + 0.3
                    p["genre"][t["genre"]] = p["genre"].get(t["genre"], 0) + 0.5
        p["n"] += 3 * (len(genres) + len(artists))
        self._save_profile(uid, p, ts)
        self.db.commit()

    # ------------------------------------------------------ taste classifier
    @staticmethod
    def _diversity(p, n_genres):
        pos = [v for v in p["genre"].values() if v > 0]
        s = sum(pos)
        if len(pos) < 2 or s <= 0:
            return 0.0
        h = -sum(v / s * math.log(v / s) for v in pos)
        return h / math.log(max(n_genres, 2))

    def _n_genres(self):
        return len({t["genre"] for t in self.tracks().values()})

    def classify_taste(self, uid):
        p, _ = self._profile(uid, time.time())
        top = lambda d, k=3: [x for x, v in sorted(p[d].items(), key=lambda kv: -kv[1])[:k] if v > 0]
        div = self._diversity(p, self._n_genres())
        listener = "explorer" if div > 0.65 else "loyalist" if div < 0.40 else "balanced"
        arche, scores = None, {}
        if p["audio_w"] > 0:
            avg = [a / p["audio_w"] for a in p["audio"]]
            raw = {k: math.exp(-3 * math.dist(avg, c)) for k, c in ARCHETYPES.items()}
            z = sum(raw.values())
            scores = {k: round(v / z, 3) for k, v in sorted(raw.items(), key=lambda kv: -kv[1])}
            arche = next(iter(scores))
        return {
            "archetype": arche, "archetype_scores": scores,
            "listener_type": listener, "diversity": round(div, 2),
            "top_genres": top("genre"), "top_moods": top("mood", 2), "top_artists": top("artist"),
            "confidence": round(min(1.0, p["n"] / 25), 2),
        }

    # ---------------------------------------------------- item similarity (CF)
    def rebuild_similarity(self, top_k=50, cap_items=200):
        """Item-item co-listening similarity. Run nightly / after big data changes."""
        rows = self.db.execute(
            "SELECT user_id, track_id FROM events GROUP BY user_id, track_id "
            "HAVING SUM(weight) >= 1.0").fetchall()
        by_user, cnt = defaultdict(list), defaultdict(int)
        for r in rows:
            by_user[r["user_id"]].append(r["track_id"])
            cnt[r["track_id"]] += 1
        co = defaultdict(float)
        for items in by_user.values():
            items = items[:cap_items]
            damp = 1.0 / math.log(2 + len(items))     # heavy listeners count less
            for i, a in enumerate(items):
                for b in items[i + 1:]:
                    co[(a, b)] += damp
                    co[(b, a)] += damp
        nb = defaultdict(list)
        for (a, b), c in co.items():
            nb[a].append((b, c / math.sqrt(cnt[a] * cnt[b])))
        self.db.execute("DELETE FROM item_sim")
        self.db.executemany(
            "INSERT INTO item_sim VALUES(?,?,?)",
            [(a, b, s) for a, lst in nb.items()
             for b, s in sorted(lst, key=lambda x: -x[1])[:top_k]])
        self.db.commit()
        self._sim = None

    def _similarity(self):
        if self._sim is None:
            self._sim = defaultdict(dict)
            for r in self.db.execute("SELECT a,b,sim FROM item_sim"):
                self._sim[r["a"]][r["b"]] = r["sim"]
        return self._sim

    # ------------------------------------------------------ discovery bandit
    def _arms(self, uid):
        return {r["arm"]: (r["alpha"], r["beta"]) for r in
                self.db.execute("SELECT arm,alpha,beta FROM explore_arms WHERE user_id=?", (uid,))}

    def _feedback_to_bandit(self, uid, track_id, w, ts):
        if -1.0 < w < 1.0:
            return                                    # weak signal, ignore
        r = self.db.execute(
            "SELECT id, source FROM recs_served WHERE user_id=? AND track_id=? "
            "AND outcome IS NULL ORDER BY ts DESC LIMIT 1", (uid, track_id)).fetchone()
        if not r:
            return
        reward = 1.0 if w >= 1.0 else 0.0
        self.db.execute("UPDATE recs_served SET outcome=? WHERE id=?", (reward, r["id"]))
        if r["source"] == "explore":
            arm = self.tracks()[track_id]["genre"]
            self.db.execute("INSERT OR IGNORE INTO explore_arms(user_id,arm) VALUES(?,?)", (uid, arm))
            self.db.execute("UPDATE explore_arms SET alpha=alpha+?, beta=beta+? "
                            "WHERE user_id=? AND arm=?", (reward, 1 - reward, uid, arm))

    # -------------------------------------------------------- recommendations
    def recommend(self, uid, n=20, mood=None, genre=None, explore_ratio=None, seed=None,
                  now=None, log=True):
        rng = random.Random(seed)
        now = now or time.time()
        p, _ = self._profile(uid, now)
        tracks = self.tracks()
        conf = min(1.0, p["n"] / 25)

        # what the user already knows / rejected / was just shown
        agg = {r["track_id"]: r["s"] for r in self.db.execute(
            "SELECT track_id, SUM(weight) s FROM events WHERE user_id=? GROUP BY track_id", (uid,))}
        blocked = {t for t, s in agg.items() if s >= 1.0 or s <= -1.0}
        blocked |= {r["track_id"] for r in self.db.execute(
            "SELECT track_id FROM recs_served WHERE user_id=? AND ts>?", (uid, now - DAY))}
        cands = {tid: t for tid, t in tracks.items() if tid not in blocked
                 and (not mood or t["mood"] == mood) and (not genre or t["genre"] == genre)}
        if not cands:
            return []

        pop_raw = {r["track_id"]: r["c"] for r in self.db.execute(
            "SELECT track_id, COUNT(*) c FROM events WHERE weight>=1 GROUP BY track_id")}
        pmax = math.log1p(max(pop_raw.values(), default=1))
        pop = lambda tid: math.log1p(pop_raw.get(tid, 0)) / pmax if pmax else 0.0

        mx = {d: max((abs(v) for v in p[d].values()), default=1.0) or 1.0 for d in DIMS}
        aff = lambda d, k: max(-1.0, min(1.0, p[d].get(k, 0.0) / mx[d]))
        avg = [a / p["audio_w"] for a in p["audio"]] if p["audio_w"] > 0 else None
        close = lambda t: 0.5 if avg is None else \
            1 - sum(abs(x - y) for x, y in zip(avg, _audio(t))) / 4

        # collaborative filtering: neighbours of tracks the user liked
        sim, cf, why = self._similarity(), defaultdict(float), {}
        for tid, s in agg.items():
            if s >= 1.0 and tid in sim:
                strength = min(s, 5.0) / 5.0
                for c, sv in sim[tid].items():
                    if c in cands:
                        cf[c] += sv * strength
                        if sv * strength >= why.get(c, (0, None))[0]:
                            why[c] = (sv * strength, tid)
        cfmax = max(cf.values(), default=1.0) or 1.0

        w_cont, w_cf, w_pop = 0.35 + 0.25 * conf, 0.10 + 0.30 * conf, 0.55 * (1 - conf) + 0.05
        exploit, explore = [], []
        arms = self._arms(uid)
        theta = {}
        for tid, t in cands.items():
            content = (0.45 * aff("genre", t["genre"]) + 0.15 * aff("mood", t["mood"])
                       + 0.20 * aff("artist", t["artist"]) + 0.20 * close(t))
            score = w_cont * content + w_cf * cf.get(tid, 0) / cfmax + w_pop * pop(tid)
            if aff("genre", t["genre"]) > -0.3 or aff("mood", t["mood"]) > -0.3:
                exploit.append((score, tid))
            # exploration candidate: a genre the user hasn't settled into yet
            g = t["genre"]
            if aff("genre", g) < 0.5 and aff("genre", g) > -0.3:
                if g not in theta:
                    a, b = arms.get(g, (1.0, 1.0))
                    theta[g] = rng.betavariate(a, b)         # Thompson sample
                novel = 1.0 if t["artist"] not in p["artist"] else 0.0
                explore.append((0.5 * theta[g] + 0.3 * close(t) + 0.1 * pop(tid) + 0.1 * novel, tid))
        exploit.sort(reverse=True)
        explore.sort(reverse=True)

        if explore_ratio is None:
            lt = self.classify_taste(uid)["listener_type"]
            explore_ratio = {"explorer": 0.30, "balanced": 0.20, "loyalist": 0.12}[lt]
            if conf < 0.5:
                explore_ratio = max(explore_ratio, 0.30)   # still learning this user
        k = min(round(n * explore_ratio), len(explore))

        def pick(ranked, limit, per_artist, per_genre, taken):
            out, ac, gc = [], defaultdict(int), defaultdict(int)
            for s, tid in ranked:
                t = tracks[tid]
                if tid in taken or ac[t["artist"]] >= per_artist or gc[t["genre"]] >= per_genre:
                    continue
                out.append((s, tid)); taken.add(tid)
                ac[t["artist"]] += 1; gc[t["genre"]] += 1
                if len(out) == limit:
                    break
            return out

        taken = set()
        ex_list = pick(explore, k, 1, max(2, math.ceil(k / 2)), taken)
        ep_list = pick(exploit, n - len(ex_list), 2, n, taken)
        interval = max(2, n // max(len(ex_list), 1))
        ordered, ei, xi = [], iter(ex_list), iter(ep_list)
        for idx in range(n):
            src = "explore" if ex_list and (idx + 1) % interval == 0 else "exploit"
            nxt = next(ei if src == "explore" else xi, None)
            if nxt is None:
                src = "exploit" if src == "explore" else "explore"
                nxt = next(xi if src == "exploit" else ei, None)
            if nxt is None:
                break
            ordered.append((src, nxt[0], nxt[1]))

        out = []
        for src, score, tid in ordered:
            t = tracks[tid]
            if src == "explore":
                reason = f"Something new: try {t['genre']}"
            elif tid in why:
                reason = f"Because you liked {tracks[why[tid][1]]['title']}"
            elif aff("genre", t["genre"]) > 0.4:
                reason = f"Matches your {t['genre']} taste"
            else:
                reason = "Popular right now"
            out.append({"track_id": tid, "title": t["title"], "artist": t["artist"],
                        "genre": t["genre"], "mood": t["mood"], "source": src,
                        "score": round(score, 3), "reason": reason})
        if log:
            self.db.executemany(
                "INSERT INTO recs_served(user_id,track_id,source,ts) VALUES(?,?,?,?)",
                [(uid, o["track_id"], o["source"], now) for o in out])
            self.db.commit()
        return out

    def similar_tracks(self, track_id, n=10):
        """'Up next' / radio: co-listening neighbours, padded with audio similarity."""
        tracks, seed = self.tracks(), self.tracks()[track_id]
        sc = {c: 2 * s for c, s in self._similarity().get(track_id, {}).items()}
        for tid, t in tracks.items():
            if tid != track_id:
                d = sum(abs(x - y) for x, y in zip(_audio(seed), _audio(t))) / 4
                sc[tid] = sc.get(tid, 0) + (1 - d) + (0.3 if t["genre"] == seed["genre"] else 0)
        return [tracks[t] for t, _ in sorted(sc.items(), key=lambda kv: -kv[1])[:n]]

    def home_feed(self, uid):
        """YouTube-Music-style shelves for the home screen."""
        taste = self.classify_taste(uid)
        shelves = [{"title": "Mixed for you", "items": self.recommend(uid, 10)},
                   {"title": "Discover something new",
                    "items": self.recommend(uid, 6, explore_ratio=1.0)}]
        for g in taste["top_genres"][:2]:
            shelves.append({"title": f"More {g}", "items": self.recommend(uid, 6, genre=g,
                                                                          explore_ratio=0.0)})
        if taste["top_moods"]:
            m = taste["top_moods"][0]
            shelves.append({"title": f"Your {m} mood",
                            "items": self.recommend(uid, 6, mood=m, explore_ratio=0.0)})
        return {"taste": taste, "shelves": [s for s in shelves if s["items"]]}
