import asyncio
import json
import unittest

from app.recsys.clients.saavn import _songs_from, normalize_song
from app.recsys.clients.ytm import parse_chips, parse_radio_response, upscale_image
from app.recsys.fusion import fuse
from app.recsys.infra import CircuitBreaker, CircuitOpen, SingleFlight, TTLCache
from app.recsys.matching import match_score
from app.recsys.models import Candidate
from app.recsys.postfilter import postfilter
from app.recsys.text import base_title, dedupe_key, parse_duration


def C(title, artists, **kw):
    return Candidate(title=title, artists=artists, **kw)


class TextTests(unittest.TestCase):
    def test_base_title_strips_movie_tags(self):
        self.assertEqual(base_title('Tum Hi Ho (From "Aashiqui 2")'), ("tum hi ho", frozenset()))

    def test_version_tags(self):
        self.assertEqual(base_title("Kesariya - Lofi")[1], frozenset({"lofi"}))
        self.assertIn("remix", base_title("Lean On (DJ Snake Remix)")[1])
        self.assertEqual(base_title("Live Your Life")[1], frozenset())  # 'live' as a real word, not a version

    def test_dedupe_key_separates_versions(self):
        a = dedupe_key("Kesariya", ["Arijit Singh"])
        b = dedupe_key('Kesariya (From "Brahmastra")', ["Arijit Singh", "Amitabh"])
        c = dedupe_key("Kesariya (Lofi)", ["Arijit Singh"])
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_parse_duration(self):
        self.assertEqual(parse_duration("3:45"), 225)
        self.assertEqual(parse_duration("1:02:03"), 3723)
        self.assertEqual(parse_duration(None), 0)


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.ytm = C("Tum Hi Ho", ["Arijit Singh"], album="Aashiqui 2", duration_sec=262)

    def test_same_recording_scores_high(self):
        s = C('Tum Hi Ho (From "Aashiqui 2")', ["Arijit Singh"], album="Aashiqui 2 (Original Motion Picture Soundtrack)", duration_sec=261)
        self.assertGreaterEqual(match_score(self.ytm, s), 0.9)

    def test_lofi_version_rejected(self):
        s = C("Tum Hi Ho (Lofi)", ["Arijit Singh"], album="Aashiqui 2", duration_sec=262)
        self.assertLess(match_score(self.ytm, s), 0.65)

    def test_wrong_artist_cover_rejected(self):
        s = C("Tum Hi Ho", ["Some Cover Band"], album="Covers", duration_sec=300)
        self.assertLess(match_score(self.ytm, s), 0.65)

    def test_duration_mismatch_lowers_score(self):
        good = C("Tum Hi Ho", ["Arijit Singh"], album="Aashiqui 2", duration_sec=262)
        bad = C("Tum Hi Ho", ["Arijit Singh"], album="Aashiqui 2", duration_sec=330)
        self.assertGreater(match_score(self.ytm, good), match_score(self.ytm, bad))


class FusionTests(unittest.TestCase):
    W = {"ytm": 1.0, "saavn_reco": 0.9}

    def test_agreement_beats_single_source(self):
        ytm = [C("Alpha", ["A"], ytm_video_id="v1"), C("Beta", ["B"], ytm_video_id="v2"), C("Gamma", ["G"], ytm_video_id="v3")]
        sv = [C("Delta", ["D"], saavn_id="s4"), C("Gamma", ["G"], saavn_id="s3")]
        out = fuse({"ytm": ytm, "saavn_reco": sv}, self.W)
        self.assertEqual(out[0].title, "Gamma")             # rank 3 in ytm + rank 2 in saavn beats the rest
        self.assertEqual(set(out[0].sources), {"ytm", "saavn_reco"})
        self.assertEqual((out[0].saavn_id, out[0].ytm_video_id), ("s3", "v3"))  # ids merged
        self.assertEqual(len(out), 4)

    def test_agreement_bonus_is_decisive(self):
        """Plain RRF would rank the lone ytm #1 first; two sources agreeing on a deep-ranked song must overtake it."""
        ytm = [C(f"Filler {i}", [f"F{i}"], ytm_video_id=f"f{i}") for i in range(40)]
        ytm[0] = C("Lonely Top", ["L"], ytm_video_id="top")
        ytm.append(C("Agreed Deep", ["D"], ytm_video_id="deep"))
        saavn = [C(f"SFiller {i}", [f"S{i}"], saavn_id=f"s{i}") for i in range(40)]
        saavn.append(C("Agreed Deep", ["D"], saavn_id="sdeep"))
        with_bonus = fuse({"ytm": ytm, "saavn_reco": saavn}, self.W, agreement_bonus=0.35)
        no_bonus = fuse({"ytm": ytm, "saavn_reco": saavn}, self.W, agreement_bonus=0.0)
        self.assertEqual(with_bonus[0].title, "Agreed Deep")
        self.assertEqual(no_bonus[0].title, "Lonely Top")

    def test_seed_excluded_and_versions_kept_apart(self):
        seed = C("Song", ["X"], saavn_id="s0")
        lists = {"ytm": [C("Song", ["X"], ytm_video_id="v0"), C("Song (Lofi)", ["X"], ytm_video_id="v9")]}
        out = fuse(lists, self.W, exclude=seed)
        self.assertEqual([c.title for c in out], ["Song (Lofi)"])


class PostFilterTests(unittest.TestCase):
    def _many(self):
        out = []
        for i in range(12):
            out.append(C(f"Hindi {i}", [f"HA{i % 3}"], saavn_id=f"h{i}", language="hindi", score=1 - i * 0.01))
        for i in range(4):
            out.append(C(f"Eng {i}", [f"EA{i}"], saavn_id=f"e{i}", language="english", score=0.5))
        return out

    def test_language_coherence_and_no_adjacent_artist(self):
        seed = C("Seed", ["S"], saavn_id="seed", language="hindi")
        out = postfilter(self._many(), seed=seed, limit=10)
        self.assertTrue(all(c.language == "hindi" for c in out))
        pa = [c.artists[0] for c in out]
        self.assertTrue(all(pa[i] != pa[i + 1] for i in range(len(pa) - 1)))

    def test_served_blocked_and_bad_versions_removed(self):
        cands = [C("A", ["a"], saavn_id="1"), C("B", ["b"], saavn_id="2"),
                 C("C (Karaoke)", ["c"], saavn_id="3"), C("D", ["d"], saavn_id="4")]
        out = postfilter(cands, served_ids={"1"}, blocked_ids={"2"}, limit=10)
        self.assertEqual([c.saavn_id for c in out], ["4"])

    def test_artist_cap(self):
        cands = [C(f"T{i}", ["Same"], saavn_id=str(i)) for i in range(10)]
        self.assertEqual(len(postfilter(cands, limit=10, max_per_artist=3)), 3)


class InfraTests(unittest.TestCase):
    def test_breaker_opens_and_recovers(self):
        t = [0.0]
        br = CircuitBreaker("x", threshold=2, cooldown_s=10, clock=lambda: t[0])

        async def boom():
            raise RuntimeError

        async def ok():
            return 1

        async def go():
            for _ in range(2):
                with self.assertRaises(RuntimeError):
                    await br.call(boom)
            self.assertEqual(br.state, "open")
            with self.assertRaises(CircuitOpen):
                await br.call(ok)
            t[0] = 11.0
            self.assertEqual(br.state, "half_open")
            self.assertEqual(await br.call(ok), 1)
            self.assertEqual(br.state, "closed")
        asyncio.run(go())

    def test_singleflight_coalesces(self):
        n = [0]

        async def slow():
            n[0] += 1
            await asyncio.sleep(0.02)
            return "v"

        async def go():
            sf = SingleFlight()
            r = await asyncio.gather(*[sf.do("k", slow) for _ in range(10)])
            self.assertEqual(set(r), {"v"})
        asyncio.run(go())
        self.assertEqual(n[0], 1)

    def test_ttl_cache_expiry_and_stale(self):
        t = [0.0]
        c = TTLCache(clock=lambda: t[0])
        c.set("a", 1, ttl=5)
        self.assertEqual(c.get("a"), 1)
        t[0] = 6
        self.assertIsNone(c.get("a"))
        self.assertEqual(c.get_stale("a"), 1)


class ParserTests(unittest.TestCase):
    @staticmethod
    def _run(text, page_type, vid, artist_nav=True):
        run = {"text": text}
        if artist_nav:
            run["navigationEndpoint"] = {"browseEndpoint": {"browseEndpointContextSupportedConfigs": {
                "browseEndpointContextMusicConfig": {"pageType": page_type}}}}
        return run

    def fixture(self):
        item = lambda vid, title, artist, album: {"playlistPanelVideoRenderer": {
            "videoId": vid, "title": {"runs": [{"text": title}]},
            "longBylineText": {"runs": [self._run(artist, "MUSIC_PAGE_TYPE_ARTIST", vid), {"text": " • "},
                                        self._run(album, "MUSIC_PAGE_TYPE_ALBUM", vid), {"text": " • "}, {"text": "2013"}]},
            "lengthText": {"runs": [{"text": "4:22"}]},
            "thumbnail": {"thumbnails": [{"url": "https://lh3.googleusercontent.com/x=w60-h60-l90-rj"},
                                         {"url": "https://lh3.googleusercontent.com/x=w120-h120-l90-rj"}]},
            "badges": [{"musicInlineBadgeRenderer": {"icon": {"iconType": "MUSIC_EXPLICIT_BADGE"}}}],
            "navigationEndpoint": {"watchEndpoint": {"watchEndpointMusicSupportedConfigs": {
                "watchEndpointMusicConfig": {"musicVideoType": "MUSIC_VIDEO_TYPE_ATV"}}}}}}
        chips = {"chipCloudRenderer": {"chips": [
            {"chipCloudChipRenderer": {"text": {"runs": [{"text": "All"}]}, "isSelected": True}},
            {"chipCloudChipRenderer": {"text": {"runs": [{"text": "Discover"}]}, "navigationEndpoint": {
                "queueUpdateCommand": {"fetchContentsCommand": {"watchEndpoint": {"playlistId": "RDATiXabc", "params": "PP"}}}}}}]}}
        return {"contents": {"singleColumnMusicWatchNextResultsRenderer": {"tabbedRenderer": {"watchNextTabbedResultsRenderer": {"tabs": [
            {"tabRenderer": {"content": {"musicQueueRenderer": {
                "content": {"playlistPanelRenderer": {
                    "contents": [item("vid1", "Tum Hi Ho", "Arijit Singh", "Aashiqui 2"),
                                 {"playlistPanelVideoWrapperRenderer": {"primaryRenderer": item("vid2", "Raabta", "Arijit Singh", "Agent Vinod")["playlistPanelVideoRenderer"] and item("vid2", "Raabta", "Arijit Singh", "Agent Vinod")}}],
                    "continuations": [{"nextRadioContinuationData": {"continuation": "CTOKEN"}}]}},
                "subHeaderChipCloud": chips}}}},
            {"tabRenderer": {"endpoint": {"browseEndpoint": {"browseId": "MPTRt_abc"}}}}]}}}}}

    def test_radio_parse(self):
        body = {"videoId": "vid1"}
        page = parse_radio_response(self.fixture(), body)
        self.assertEqual([t.ytm_video_id for t in page.tracks], ["vid1", "vid2"])
        t = page.tracks[0]
        self.assertEqual((t.title, t.artists, t.album, t.duration_sec), ("Tum Hi Ho", ["Arijit Singh"], "Aashiqui 2", 262))
        self.assertTrue(t.explicit)
        self.assertEqual(t.extra["video_type"], "MUSIC_VIDEO_TYPE_ATV")
        self.assertIn("w544-h544", t.image)
        self.assertEqual(page.cursor.token, "CTOKEN")
        self.assertEqual(page.related_browse_id, "MPTRt_abc")

    def test_chip_parse(self):
        chips = parse_chips(self.fixture())
        self.assertEqual([c["id"] for c in chips], ["all", "discover"])
        self.assertTrue(chips[0]["selected"])
        self.assertEqual((chips[1]["playlist_id"], chips[1]["params"]), ("RDATiXabc", "PP"))

    def test_garbage_response_is_empty_not_error(self):
        page = parse_radio_response({"unexpected": True}, {})
        self.assertEqual(page.tracks, [])

    def test_upscale(self):
        self.assertIn("w544-h544", upscale_image("https://lh3.googleusercontent.com/a=w60-h60-l90-rj"))
        self.assertEqual(upscale_image("https://i.ytimg.com/vi/x/hq.jpg"), "https://i.ytimg.com/vi/x/hq.jpg")


class SaavnParseTests(unittest.TestCase):
    def test_normalize(self):
        c = normalize_song({"id": "abc", "title": "Tum Hi Ho (From &quot;Aashiqui 2&quot;)", "language": "Hindi",
                            "image": "https://c.saavncdn.com/x-150x150.jpg", "explicit_content": "0",
                            "more_info": {"album": "Aashiqui 2", "duration": "262",
                                          "artistMap": {"primary_artists": [{"name": "Arijit Singh"}]}}})
        self.assertEqual((c.saavn_id, c.artists, c.duration_sec, c.language), ("abc", ["Arijit Singh"], 262, "hindi"))
        self.assertIn('"Aashiqui 2"', c.title)
        self.assertIn("500x500", c.image)

    def test_payload_shapes(self):
        self.assertEqual(len(_songs_from([{"id": "1"}, {"id": "2"}])), 2)
        self.assertEqual(len(_songs_from({"results": [{"id": "1"}]})), 1)
        self.assertEqual(len(_songs_from({"0": {"song": {"id": "1"}}, "1": {"song": {"id": "2"}}, "stationid": "x"})), 2)


if __name__ == "__main__":
    unittest.main()
