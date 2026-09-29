import asyncio
import time
import unittest

from app.recsys import QuickPicks, Settings
from app.recsys.engine import RecommendationEngine
from app.recsys.graph import build_graph
from app.recsys.ranker import UserProfile, rank
from app.recsys.store import Store
from app.recsys.models import Candidate
from tests.fakes import FakeSaavn, FakeYtm, make_catalog

S = Settings(db_path=":memory:", source_timeout_s=1.0, resolve_timeout_s=1.0, graph_min_weight=1.0)


def build(**kw):
    cat = make_catalog()
    ids = list(cat)
    hindi = [i for i in ids if i.startswith("sh")]
    saavn = FakeSaavn(
        cat,
        reco={"sh0": ["sh3", "sh4", "sh5", "sh6", "sh7", "sh8", "sh9", "sh10"]},
        station={"sh0": ["sh11", "sh12", "sh3"]},
        trending=["sh15", "sh16", "sh17", "sp0", "sh18", "sh19"])
    # YTM radio for the seed: seed first, hindi 1..14, some punjabi, a lofi clone of sh1
    ytm_ids = ["sh0"] + [f"sh{i}" for i in range(1, 15)] + ["sp0", "sp1"]
    ytm = FakeYtm(cat, radio={"vh0": ytm_ids}, charts=["sh15", "sh16", "sh17"], **kw)
    store = Store(":memory:")
    eng = RecommendationEngine(ytm, saavn, store, S)
    return eng, saavn, ytm, store, cat


def run(coro):
    return asyncio.run(coro)


class EngineTests(unittest.TestCase):
    def test_radio_end_to_end(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            r = await eng.radio(track_id="sh0", user="u1", limit=20)
            tracks = r["tracks"]
            ids = [t["id"] for t in tracks]
            self.assertGreaterEqual(len(tracks), 12)
            self.assertNotIn("sh0", ids)                                  # seed never in its own radio
            self.assertEqual(len(ids), len(set(ids)))                     # no duplicates
            self.assertTrue(all(t["playback"] == "saavn" for t in tracks))  # everything playable on Saavn
            self.assertTrue(all(t["language"] == "hindi" for t in tracks))  # punjabi filtered out
            arts = [t["artists"][0] for t in tracks]
            self.assertTrue(all(arts[i] != arts[i + 1] for i in range(len(arts) - 1)))
            # agreement: sh3 is suggested by ytm, saavn reco and saavn station
            sh3 = next(t for t in tracks if t["id"] == "sh3")
            self.assertTrue({"ytm", "saavn_reco", "saavn_station"} <= set(sh3["sources"]))
            self.assertEqual(tracks[0]["id"], "sh3")                       # most-agreed track leads
            self.assertEqual([c["id"] for c in r["tuning_chips"]], ["all", "discover"])
            # identity map persisted for YTM-only tracks
            self.assertIsNotNone(store.identity_get_by_ytm("vh1"))
        run(go())

    def test_identity_cache_avoids_repeat_searches(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            await eng.radio(track_id="sh0", limit=20)
            first = saavn.search_calls
            self.assertGreater(first, 0)
            eng.sources._cache = type(eng.sources._cache)(16)             # drop upstream cache, keep identity map
            eng.sessions = type(eng.sessions)()
            await eng.radio(track_id="sh0", limit=20)
            self.assertEqual(saavn.search_calls, first)                   # zero new Saavn searches
        run(go())

    def test_next_songs_never_repeats_served_and_follows_current_track(self):
        async def go():
            eng, saavn, ytm, store, cat = build(cont={"tok1": ["sh16", "sh17", "sh18", "sh19"]})
            r1 = await eng.radio(track_id="sh0", limit=8)
            sid = r1["session_id"]
            served = {t["id"] for t in r1["tracks"]}
            r2 = await eng.next_songs(session_id=sid, current_track_id=r1["tracks"][0]["id"], count=8)
            got = {t["id"] for t in r2["tracks"]}
            self.assertTrue(got)
            self.assertFalse(got & served)
            self.assertNotIn("sh0", got)
        run(go())

    def test_unresolvable_ytm_tracks_dropped_not_played(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            ghost = Candidate(title="Totally Unknown Zxqv", artists=["Nobody"], ytm_video_id="vGHOST", duration_sec=200)
            ytm.radio_map["vh0"] = ytm.radio_map["vh0"]
            orig = ytm.radio_page

            async def with_ghost(*a, **k):
                p = await orig(*a, **k)
                p.tracks.insert(2, ghost)
                return p
            ytm.radio_page = with_ghost
            r = await eng.radio(track_id="sh0", limit=20)
            self.assertNotIn("vGHOST", [t["ytm_video_id"] for t in r["tracks"]])
            self.assertTrue(store.negative_has("ytm", "vGHOST"))          # negative-cached
        run(go())

    def test_ytm_outage_degrades_to_saavn(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            ytm.fail = True
            r = await eng.radio(track_id="sh0", limit=10)
            self.assertGreater(len(r["tracks"]), 3)
            self.assertNotIn("ytm", r["sources_used"])
            self.assertIn("saavn_reco", r["sources_used"])
        run(go())

    def test_total_outage_returns_empty_not_exception(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            saavn.fail = ytm.fail = True
            r = await eng.radio(track_id="sh0", title="Aakash Ke Paar", artist="Arijit Singh", limit=10)
            self.assertEqual(r["tracks"], [])
        run(go())

    def test_early_skip_blocks_track_for_that_user_only(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            eng.record_event(user="u1", session_id="s", track_id="sh3", kind="skip", position_ms=4000)
            r_u1 = await eng.radio(track_id="sh0", user="u1", limit=20)
            eng.sessions = type(eng.sessions)()
            r_u2 = await eng.radio(track_id="sh0", user="u2", limit=20)
            self.assertNotIn("sh3", [t["id"] for t in r_u1["tracks"]])
            self.assertIn("sh3", [t["id"] for t in r_u2["tracks"]])
        run(go())

    def test_chip_switch_uses_tuned_ytm_only(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            ytm.radio_map[("vh0", "RDATiX")] = ["sh0", "sh13", "sh14", "sh12"]
            r = await eng.radio(track_id="sh0", limit=10, chip_id="discover", chip_playlist_id="RDATiX", chip_params="p")
            self.assertEqual(r["sources_used"], ["ytm"])
            self.assertEqual({t["id"] for t in r["tracks"]}, {"sh13", "sh14", "sh12"})
        run(go())

    def test_youtube_seed_and_bad_event_kind(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            r = await eng.radio(track_id="youtube:vh0", limit=10)
            self.assertGreater(len(r["tracks"]), 3)
            self.assertEqual(r["seed"]["saavn_id"], "sh0")                # seed resolved to a playable id
            with self.assertRaises(ValueError):
                eng.record_event(user="u", session_id=None, track_id="sh1", kind="bogus")
        run(go())

    def test_related_hub(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            h = await eng.related(track_id="sh0")
            self.assertTrue(h["you_might_like"])
            self.assertEqual(h["similar_artists"][0]["name"], "Atif Aslam")
        run(go())


class GraphTests(unittest.TestCase):
    def test_graph_edges_skip_exclusion_and_use_in_radio(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            now = time.time()
            # three users listen a -> b -> c in order; one early-skips "x" in the middle
            for u in ("ua", "ub", "uc"):
                seq = [("sh0", 0), ("sh19", 60), ("x_skipped", 120), ("sh18", 180)]
                for tid, dt in seq:
                    kind, pos = ("skip", 3000) if tid == "x_skipped" else ("complete", 200000)
                    store.log_events([{"ts": now - 3600 + dt, "user": u, "track_id": tid, "kind": kind, "position_ms": pos}])
            for tid in ("sh19", "sh18"):
                store.meta_put(cat[tid])
            n = build_graph(store, S)
            self.assertGreater(n, 0)
            nb = dict(store.neighbors("sh0"))
            self.assertIn("sh19", nb)
            self.assertNotIn("x_skipped", nb)
            self.assertGreater(nb["sh19"], nb["sh18"])                    # nearer in sequence -> stronger
            r = await eng.radio(track_id="sh0", limit=20)
            self.assertIn("graph", r["sources_used"])
        run(go())

    def test_per_user_cap_prevents_one_user_dominating(self):
        store = Store(":memory:")
        now = time.time()
        for rep in range(50):                                             # one user loops the same pair 50x
            for j, tid in enumerate(("a", "b")):
                store.log_events([{"ts": now - 7200 + rep * 10 + j, "user": "solo", "track_id": tid, "kind": "complete", "position_ms": 200000}])
        build_graph(store, Settings(db_path=":memory:", graph_min_weight=1.0, graph_per_user_cap=3.0))
        self.assertLessEqual(dict(store.neighbors("a"))["b"], 3.0)


class RankerTests(unittest.TestCase):
    def test_affinity_language_and_skip_stats(self):
        seed = Candidate(title="Seed", artists=["S"], language="hindi", saavn_id="seed")
        a = Candidate(title="A", artists=["Fav Artist"], language="hindi", saavn_id="a", score=1.0)
        b = Candidate(title="B", artists=["Other"], language="hindi", saavn_id="b", score=1.0)
        c = Candidate(title="C", artists=["Other2"], language="punjabi", saavn_id="c", score=1.0)
        d = Candidate(title="D", artists=["Other3"], language="hindi", saavn_id="d", score=1.0)
        prof = UserProfile(artist_affinity={"fav artist": 0.9})
        stats = {"d": {"plays": 200, "skips": 150, "completes": 50, "likes": 0}}   # globally skipped track
        cands = [a, b, c, d]
        rank(cands, seed, prof, stats, S)
        order = [x.saavn_id for x in sorted(cands, key=lambda x: -x.score)]
        self.assertEqual(order[0], "a")
        self.assertLess(d.score, b.score)                                # skip-heavy track ranks below neutral
        self.assertLess(c.score, b.score)                                # wrong language ranks below same language


class QuickPickTests(unittest.TestCase):
    def test_personalized_diverse_and_excludes_seeds(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            # more radios so every seed has candidates
            for i in (1, 2):
                ytm.radio_map[f"vh{i}"] = [f"sh{i}"] + [f"sh{j}" for j in range(5, 15)]
            ytm.radio_map["vp0"] = ["sp0", "sp1", "sp2", "sp3", "sp4"]
            saavn.reco_map["sh1"] = ["sh8", "sh9", "sh10", "sh11"]
            saavn.reco_map["sp0"] = ["sp1", "sp2", "sp3", "sp4"]
            for tid in ("sh0", "sh1", "sp0", "sh6"):
                store.meta_put(cat[tid])
            now = time.time()
            for tid in ("sh0", "sh0", "sh1", "sp0", "sh6"):
                store.log_events([{"ts": now - 600, "user": eng_user, "track_id": tid, "kind": "complete", "position_ms": 200000}])
            qp = QuickPicks(eng)
            out = await qp.get(user=eng_user, recent_ids=["sh1"], limit=12)
            self.assertEqual(out["mode"].split("+")[0], "personalized")
            ids = [i["id"] for i in out["items"]]
            self.assertLessEqual(len(ids), 12)
            self.assertEqual(len(ids), len(set(ids)))
            seed_ids = {s["id"] for s in out["seeds"]}
            self.assertFalse(seed_ids & set(ids))                          # seeds are not re-recommended
            self.assertEqual(len({s["artists"][0] for s in out["seeds"]}), len(out["seeds"]))   # distinct artists
            from collections import Counter
            self.assertLessEqual(max(Counter(i["artists"][0] for i in out["items"]).values()), 2)
            self.assertTrue(all(i["playback"] == "saavn" for i in out["items"]))
        eng_user = "quser"
        run(go())

    def test_cold_start_uses_trending(self):
        async def go():
            eng, saavn, ytm, store, cat = build()
            out = await QuickPicks(eng).get(user=None, recent_ids=[], limit=6)
            self.assertEqual(out["mode"], "trending")
            self.assertGreaterEqual(len(out["items"]), 4)
            self.assertTrue(all(i["playback"] == "saavn" for i in out["items"]))
        run(go())


if __name__ == "__main__":
    unittest.main()
