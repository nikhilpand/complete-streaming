"""
Ultra-hardcore test suite for search ranking, multi-feature relevance scoring,
and hybrid provider deduplication / view inheritance.

Covers:
  - parse_views_to_int: Boundary values, suffix parsing (K, M, B), malformed strings,
    whitespace variations, commas, floats.
  - _score_relevance:
      * Exact artist intent (+160)
      * Exact title match (+140) and verbatim title boost (+35)
      * Combined title + artist in query (+110)
      * Logarithmic scaling for YouTube views and JioSaavn CTR
      * Native provider bonus (+20 for Saavn)
      * Derivative penalties (-250 for slowed/workout/etc., -200 for cover/remix)
      * Preserving derivatives when explicitly searched (e.g. "slowed")
      * Full query token coverage (+40)
      * Source rank decay
  - _rank_and_merge:
      * YouTube view inheritance to JioSaavn canonical version
      * Non-inheritance when titles match but artists differ
      * Provider tie-breaking (Saavn wins equal score)
      * Strict multi-tier deduplication (Provider ID, ISRC, canonical pair, overlapping artists)
      * Exact query title cap (1 duplicate max)
      * Mega-hit duplicate exception (> 20M views)
      * Large candidate stress merge (1000s of items)
"""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock
import pytest

from app.models import ArtistRef, SearchItem, SearchResults, Song
from app.providers.hybrid import (
    HybridMusicProvider,
    _extract_all_artists,
    _extract_item_metadata,
    _rank_and_merge,
    _score_relevance,
    normalize_title,
    parse_views_to_int,
)


# ============================================================================
# 1. PARSE VIEWS TO INT BOUNDARY TESTS
# ============================================================================


class TestParseViewsToIntHardcore:
    """Boundary and fuzzing tests for view string parsing."""

    def test_none_and_empty(self):
        assert parse_views_to_int(None) == 0
        assert parse_views_to_int("") == 0
        assert parse_views_to_int("   ") == 0

    def test_direct_numeric_types(self):
        assert parse_views_to_int(0) == 0
        assert parse_views_to_int(12345) == 12345
        assert parse_views_to_int(999999999999) == 999999999999
        assert parse_views_to_int(450.75) == 450
        assert parse_views_to_int(-50) == -50

    def test_abbreviated_suffixes(self):
        # K, M, B
        assert parse_views_to_int("450K") == 450_000
        assert parse_views_to_int("450k") == 450_000
        assert parse_views_to_int("1.5M") == 1_500_000
        assert parse_views_to_int("373m") == 373_000_000
        assert parse_views_to_int("1.2B") == 1_200_000_000
        assert parse_views_to_int("2b") == 2_000_000_000

    def test_whitespace_and_views_suffix(self):
        assert parse_views_to_int("  373M views  ") == 373_000_000
        assert parse_views_to_int("100K view") == 100_000
        assert parse_views_to_int(" 12,345,678 views ") == 12_345_678

    def test_malformed_and_garbage_strings(self):
        assert parse_views_to_int("views") == 0
        assert parse_views_to_int("???") == 0
        assert parse_views_to_int("N/A") == 0
        assert parse_views_to_int("NaN") == 0
        assert parse_views_to_int("null") == 0
        assert parse_views_to_int("no views yet") == 0


# ============================================================================
# 2. MULTI-FEATURE RELEVANCE SCORING
# ============================================================================


class TestScoreRelevanceHardcore:
    """Extreme scoring tests verifying algorithmic weights and boundary behaviors."""

    def _item(
        self,
        title: str,
        artist: str = "",
        subtitle: str = "",
        provider: str = "saavn",
        album: str = "",
        views=None,
        ctr=None,
    ) -> SearchItem:
        extra = {}
        if album:
            extra["album"] = album
        if artist:
            extra["primary_artists"] = artist
        if views is not None:
            extra["views"] = views
        if ctr is not None:
            extra["ctr"] = ctr

        return SearchItem(
            id=f"{provider}:{title.lower().replace(' ', '_')}",
            provider=provider,
            provider_id=title.lower().replace(' ', '_'),
            type="song",
            title=title,
            subtitle=subtitle or f"{album or 'Album'} · {artist or 'Artist'}",
            extra=extra,
        )

    def test_exact_artist_intent(self):
        # Query purely matching artist
        item_artist = self._item("Whatever", artist="Atif Aslam")
        score_exact = _score_relevance("Atif Aslam", item_artist, 0)
        # Should get +160 exact artist boost + token coverage + rank bonus
        assert score_exact > 200.0

        # Query matching unrelated artist
        item_other = self._item("Whatever", artist="Neha Kakkar")
        score_other = _score_relevance("Atif Aslam", item_other, 0)
        assert score_exact > score_other + 150.0

    def test_exact_title_match_and_verbatim_boost(self):
        item_verbatim = self._item("Tu Chahiye", artist="Atif Aslam")
        item_verbatim.title = "Tu Chahiye"

        item_with_movie = self._item("Tu Chahiye (From Bajrangi Bhaijaan)", artist="Atif Aslam")

        # Verbatim title should beat title with extra "(From ...)" tags
        s_verbatim = _score_relevance("Tu Chahiye", item_verbatim, 0)
        s_movie = _score_relevance("Tu Chahiye", item_with_movie, 0)
        assert s_verbatim > s_movie

    def test_combined_title_and_artist_intent(self):
        target = self._item("Tu Chahiye", artist="Atif Aslam")
        only_title = self._item("Tu Chahiye", artist="Shafqat Amanat Ali")
        only_artist = self._item("Pehli Nazar Mein", artist="Atif Aslam")

        q = "Tu Chahiye Atif Aslam"
        s_target = _score_relevance(q, target, 0)
        s_title = _score_relevance(q, only_title, 0)
        s_artist = _score_relevance(q, only_artist, 0)

        # Target matching both title and artist should decisively win
        assert s_target > s_title + 80.0
        assert s_target > s_artist + 80.0

    def test_views_logarithmic_scaling_and_bounds(self):
        base_item = self._item("Common Song", artist="Artist")

        # 0 views
        s_0 = _score_relevance("Common Song", self._item("Common Song", views=0), 0)
        # 10K views
        s_10k = _score_relevance("Common Song", self._item("Common Song", views=10_000), 0)
        # 10M views
        s_10m = _score_relevance("Common Song", self._item("Common Song", views=10_000_000), 0)
        # 1B views
        s_1b = _score_relevance("Common Song", self._item("Common Song", views=1_000_000_000), 0)
        # 100B views (extreme edge case)
        s_100b = _score_relevance("Common Song", self._item("Common Song", views=100_000_000_000), 0)

        assert s_10k > s_0
        assert s_10m > s_10k
        assert s_1b >= s_10m
        # Must be capped at max 110.0 boost, so 100B doesn't grow unboundedly
        assert pytest.approx(s_100b - s_0, abs=1.0) == 110.0

    def test_jiosaavn_ctr_logarithmic_scaling(self):
        s_0 = _score_relevance("Song", self._item("Song", ctr=0), 0)
        s_5k = _score_relevance("Song", self._item("Song", ctr=5000), 0)
        s_huge = _score_relevance("Song", self._item("Song", ctr=10_000_000), 0)

        assert s_5k > s_0
        # CTR is capped at min(70.0, ...)
        assert pytest.approx(s_huge - s_0, abs=1.0) == 70.0

    def test_native_provider_baseline_bonus(self):
        s_saavn = _score_relevance("Song", self._item("Song", provider="saavn"), 0)
        s_yt = _score_relevance("Song", self._item("Song", provider="youtube"), 0)
        assert pytest.approx(s_saavn - s_yt, abs=0.1) == 20.0

    def test_derivative_track_demotion_unless_searched(self):
        normal_item = self._item("Tum Hi Ho", artist="Arijit Singh")
        slowed_item = self._item("Tum Hi Ho (Slowed + Reverb)", artist="Arijit Singh")
        remix_item = self._item("Tum Hi Ho (Remix)", artist="Arijit Singh")
        cover_item = self._item("Tum Hi Ho (Cover)", artist="Arijit Singh")
        workout_item = self._item("Tum Hi Ho (Workout Mix)", artist="Arijit Singh")

        # 1. Generic query: "tum hi ho" -> All derivatives heavily penalized
        q_clean = "tum hi ho"
        s_norm = _score_relevance(q_clean, normal_item, 0)
        assert s_norm > _score_relevance(q_clean, slowed_item, 0) + 200.0
        assert s_norm > _score_relevance(q_clean, remix_item, 0) + 180.0
        assert s_norm > _score_relevance(q_clean, cover_item, 0) + 180.0
        assert s_norm > _score_relevance(q_clean, workout_item, 0) + 200.0

        # 2. Explicit derivative query: "tum hi ho slowed" -> Slowed track must NOT be penalized
        q_slowed = "tum hi ho slowed"
        s_slowed_wanted = _score_relevance(q_slowed, slowed_item, 0)
        assert s_slowed_wanted > _score_relevance(q_slowed, normal_item, 0)

        # 3. Explicit cover query: "tum hi ho cover" -> Cover track must NOT be penalized
        q_cover = "tum hi ho cover"
        s_cover_wanted = _score_relevance(q_cover, cover_item, 0)
        assert s_cover_wanted > 100.0

    def test_legitimate_titles_with_speed_and_cover_not_penalized(self):
        # "Speed of Sound" by Coldplay must NOT receive a -250 derivative junk penalty when searching "Coldplay hits"
        speed_item = self._item("Speed of Sound", artist="Coldplay")
        s_speed = _score_relevance("Coldplay hits", speed_item, 0)
        assert s_speed > 0.0, f"Speed of Sound was falsely penalized: {s_speed}"

        # "Cover Me In Sunshine" by P!nk must NOT receive a -200 cover penalty when searching "P!nk hits"
        pink_item = self._item("Cover Me In Sunshine", artist="P!nk")
        s_pink = _score_relevance("P!nk hits", pink_item, 0)
        assert s_pink > 0.0, f"Cover Me In Sunshine was falsely penalized: {s_pink}"

        # "Recovery" by Eminem (contains 'cover') must NOT receive a cover penalty
        eminem_item = self._item("Recovery", artist="Eminem")
        s_eminem = _score_relevance("Eminem hits", eminem_item, 0)
        assert s_eminem > 0.0, f"Recovery was falsely penalized: {s_eminem}"

        # "Undercover Martyn" by Two Door Cinema Club
        tdcc_item = self._item("Undercover Martyn", artist="Two Door Cinema Club")
        s_tdcc = _score_relevance("Two Door Cinema Club", tdcc_item, 0)
        assert s_tdcc > 0.0, f"Undercover Martyn was falsely penalized: {s_tdcc}"

    def test_source_rank_decay(self):
        item = self._item("Song")
        s_rank0 = _score_relevance("Song", item, 0)
        s_rank5 = _score_relevance("Song", item, 5)
        s_rank20 = _score_relevance("Song", item, 20)

        assert s_rank0 > s_rank5 > s_rank20
        # Decay is max(0.0, 15.0 - rank)
        assert pytest.approx(s_rank0 - s_rank5, abs=0.1) == 5.0
        assert pytest.approx(s_rank5 - s_rank20, abs=0.1) == 10.0


# ============================================================================
# 3. RANK AND MERGE & VIEW INHERITANCE HARDCORE TESTS
# ============================================================================


class TestRankAndMergeHardcore:
    """Extreme tests for merging, deduplication, and YouTube view inheritance."""

    def _saavn_item(self, tid: str, title: str, artist: str = "", views=None, album: str = "") -> SearchItem:
        alb = album or f"Album {tid}"
        return SearchItem(
            id=f"saavn:{tid}",
            provider="saavn",
            provider_id=tid,
            type="song",
            title=title,
            subtitle=f"{alb} · {artist}" if artist else alb,
            extra={"album": alb, "primary_artists": artist, "views": views},
        )

    def _yt_item(self, vid: str, title: str, artist: str = "", views="100M") -> SearchItem:
        return SearchItem(
            id=f"youtube:{vid}",
            provider="youtube",
            provider_id=vid,
            type="song",
            title=title,
            subtitle=f"{artist} - Topic",
            extra={"primary_artists": artist, "views": views},
        )

    def test_youtube_view_inheritance_and_canonical_priority(self):
        # JioSaavn has the canonical 320kbps track with 0 recorded views
        saavn_track = self._saavn_item("kesariya_saavn", "Kesariya", "Pritam, Arijit Singh", views=0)
        # YouTube has the official audio video with 500M views
        yt_track = self._yt_item("kesariya_yt", "Kesariya", "Pritam, Arijit Singh", views="500M")

        results = _rank_and_merge("Kesariya", [saavn_track], [yt_track], n=10)

        # 1. Only 1 version must survive
        assert len(results) == 1
        winner = results[0]

        # 2. JioSaavn version must win (inherits views + native provider bonus)
        assert winner.provider == "saavn"
        assert winner.id == "saavn:kesariya_saavn"

        # 3. View count was inherited
        assert winner.extra.get("views") == "500M"

    def test_view_inheritance_prevented_when_artists_differ(self):
        # Two different mega-hits (> 20M views) sharing the generic title "Hold On"
        chord_track = self._saavn_item("hold_on_chord", "Hold On", "Chord Overstreet", views=25_000_000, album="Hold On Single")
        bieber_yt = self._yt_item("hold_on_bieber", "Hold On", "Justin Bieber", views="500M")

        # Under a broad query (not the exact title "Hold On"), both survive because artists differ and both > 20M views
        results = _rank_and_merge("pop acoustic hits", [chord_track], [bieber_yt], n=10)

        # Both songs survive because their artists are completely distinct and both are > 20M hits
        assert len(results) == 2
        artists_in_results = {r.extra.get("primary_artists") for r in results}
        assert "Chord Overstreet" in artists_in_results
        assert "Justin Bieber" in artists_in_results

        # Chord Overstreet's track must NOT have inherited Justin Bieber's views
        chord_res = next(r for r in results if r.id == "saavn:hold_on_chord")
        assert chord_res.extra.get("views") == 25_000_000

    def test_equal_score_tie_breaking(self):
        saavn_track = self._saavn_item("t1", "Same Song", "Same Artist")
        yt_track = self._yt_item("t2", "Same Song", "Same Artist")

        # Force identical mock relevance score
        results = _rank_and_merge("Same Song", [saavn_track], [yt_track], n=10)
        assert len(results) == 1
        assert results[0].provider == "saavn"

    def test_multi_tier_deduplication(self):
        # Duplicate 1: Exact provider ID duplicate
        s1 = self._saavn_item("id_100", "Song Alpha", "Artist A")
        s1_dup = self._saavn_item("id_100", "Song Alpha", "Artist A")

        # Duplicate 2: ISRC duplicate
        s2 = self._saavn_item("id_101", "Song Beta", "Artist B")
        s2.extra["isrc"] = "USRC12345678"
        s2_isrc_dup = self._saavn_item("id_102", "Song Beta (Deluxe)", "Artist B")
        s2_isrc_dup.extra["isrc"] = "USRC12345678"

        # Duplicate 3: Canonical (title, artist) pair
        s3 = self._saavn_item("id_103", "Song Gamma", "Artist C")
        s3_pair_dup = self._saavn_item("id_104", "Song Gamma", "Artist C")

        results = _rank_and_merge(
            "Song",
            [s1, s1_dup, s2, s2_isrc_dup, s3, s3_pair_dup],
            [],
            n=10,
        )

        surviving_ids = [r.id for r in results]
        assert surviving_ids == ["saavn:id_100", "saavn:id_101", "saavn:id_103"]

    def test_same_title_exact_query_cap(self):
        # Query is "tum hi ho"
        # 3 different tracks with title "Tum Hi Ho" but different artists
        tracks = [
            self._saavn_item("t1", "Tum Hi Ho", "Arijit Singh"),
            self._saavn_item("t2", "Tum Hi Ho", "Other Singer"),
            self._saavn_item("t3", "Tum Hi Ho", "Third Singer"),
        ]
        results = _rank_and_merge("Tum Hi Ho", tracks, [], n=10)
        # When query is exact title, exact title match is capped to 1 so the top definitive hit dominates
        assert len(results) == 1
        assert results[0].id == "saavn:t1"

    def test_mega_hit_duplicate_exception(self):
        # Two distinct songs with identical title but distinct non-overlapping artists
        # When both are massive hits (> 20M views), both are allowed under general queries
        mega1 = self._saavn_item("m1", "Photograph", "Ed Sheeran", views=500_000_000)
        mega2 = self._saavn_item("m2", "Photograph", "Nickelback", views=100_000_000)
        small3 = self._saavn_item("m3", "Photograph", "Indie Band", views=50_000)

        results = _rank_and_merge("great songs", [mega1, mega2, small3], [], n=10)
        # Mega 1 and Mega 2 allowed (>20M views, no artist overlap), but small3 capped
        titles_photograph = [r for r in results if normalize_title(r.title) == "photograph"]
        assert len(titles_photograph) == 2

    def test_large_candidate_stress_merge_performance(self):
        saavn_list = [
            self._saavn_item(f"s_{i}", f"Title {i}", f"Artist {i % 20}", views=i * 1000)
            for i in range(500)
        ]
        yt_list = [
            self._yt_item(f"yt_{j}", f"Title {j}", f"Artist {j % 20}", views=f"{j}M")
            for j in range(500)
        ]

        import time
        t0 = time.perf_counter()
        merged = _rank_and_merge("Title", saavn_list, yt_list, n=20)
        t_elapsed = time.perf_counter() - t0

        assert len(merged) == 20
        assert t_elapsed < 0.25, f"Merging 1000 items took {t_elapsed:.4f}s"
