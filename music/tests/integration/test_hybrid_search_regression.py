from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock
import pytest

from app.models import ArtistRef, SearchItem, SearchResults, Song
from app.providers.hybrid import HybridMusicProvider, _score_relevance, _rank_and_merge


@pytest.fixture
def mock_saavn():
    provider = MagicMock()
    provider.search = AsyncMock()
    provider.get_song = AsyncMock()
    provider.get_songs = AsyncMock()
    return provider


@pytest.fixture
def mock_youtube():
    provider = MagicMock()
    provider.search = AsyncMock()
    provider.get_song = AsyncMock()
    provider.get_songs = AsyncMock()
    provider.resolve_media = AsyncMock()
    return provider


@pytest.fixture
def hybrid_provider(mock_saavn, mock_youtube):
    return HybridMusicProvider(saavn_provider=mock_saavn, youtube_provider=mock_youtube)


@pytest.mark.asyncio
async def test_tu_chahiye_search_intent_and_ranking(hybrid_provider, mock_saavn, mock_youtube):
    """
    Search intent for 'Tu Chahiye Atif Aslam':
    The canonical track by Atif Aslam must rank at position 0,
    beating generic tracks that only match one keyword.
    """
    tu_chahiye_target = SearchItem(
        id="saavn:tu_chahiye_real",
        provider="saavn",
        provider_id="tu_chahiye_real",
        type="song",
        title="Tu Chahiye",
        subtitle="Bajrangi Bhaijaan · Atif Aslam, Pritam",
        extra={"album": "Bajrangi Bhaijaan", "primary_artists": "Atif Aslam"},
    )
    unrelated_track = SearchItem(
        id="saavn:random_tu",
        provider="saavn",
        provider_id="random_tu",
        type="song",
        title="Tu Hi Mera",
        subtitle="Jannat 2 · Shafqat Amanat Ali",
        extra={"album": "Jannat 2", "primary_artists": "Shafqat Amanat Ali"},
    )

    mock_saavn.search.return_value = SearchResults(
        query="Tu Chahiye Atif Aslam",
        songs=[unrelated_track, tu_chahiye_target],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=2,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )
    mock_youtube.search.return_value = SearchResults(
        query="Tu Chahiye Atif Aslam",
        songs=[],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=0,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )

    results = await hybrid_provider.search("Tu Chahiye Atif Aslam", n=10)
    assert len(results.songs) == 2
    assert results.songs[0].id == "saavn:tu_chahiye_real"


@pytest.mark.asyncio
async def test_atif_aslam_artist_intent_ranks_artist_tracks_above_unrelated(hybrid_provider, mock_saavn, mock_youtube):
    """
    When searching for 'Atif Aslam', tracks where Atif Aslam is the primary artist
    must rank above tracks where the artist's name is merely a keyword in an unrelated title.
    """
    artist_track = SearchItem(
        id="yt:aadat",
        provider="youtube",
        provider_id="aadat_vid",
        type="song",
        title="Aadat",
        subtitle="Atif Aslam",
        extra={"primary_artists": "Atif Aslam"},
    )
    title_only_match = SearchItem(
        id="saavn:atif_tribute",
        provider="saavn",
        provider_id="tribute_vid",
        type="song",
        title="Atif Aslam Mashup 2024",
        subtitle="DJ Remix King · Various Artists",
        extra={"primary_artists": "DJ Remix King"},
    )

    mock_saavn.search.return_value = SearchResults(
        query="Atif Aslam",
        songs=[title_only_match],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )
    mock_youtube.search.return_value = SearchResults(
        query="Atif Aslam",
        songs=[artist_track],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )

    results = await hybrid_provider.search("Atif Aslam", n=10)
    assert results.songs[0].id == "yt:aadat"
    assert results.songs[1].id == "saavn:atif_tribute"


@pytest.mark.asyncio
async def test_youtube_only_results_when_saavn_empty(hybrid_provider, mock_saavn, mock_youtube):
    """
    When JioSaavn returns no results for a restricted track/artist,
    hybrid search serves YouTube results with preserved youtube:* provider IDs.
    """
    yt_song = SearchItem(
        id="youtube:tajdar_e_haram",
        provider="youtube",
        provider_id="tajdar_e_haram",
        type="song",
        title="Tajdar-e-Haram",
        subtitle="Atif Aslam, Coke Studio",
    )

    mock_saavn.search.return_value = SearchResults(
        query="Tajdar-e-Haram",
        songs=[],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=0,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )
    mock_youtube.search.return_value = SearchResults(
        query="Tajdar-e-Haram",
        songs=[yt_song],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )

    results = await hybrid_provider.search("Tajdar-e-Haram", n=5)
    assert len(results.songs) == 1
    assert results.songs[0].id == "youtube:tajdar_e_haram"
    assert results.songs[0].provider == "youtube"


@pytest.mark.asyncio
async def test_mixed_saavn_youtube_deduplication(hybrid_provider, mock_saavn, mock_youtube):
    """
    When both Saavn and YouTube return the same track,
    deduplication identifies the duplicate via ISRC or canonical (title, artist)
    and retains only a single entry.
    """
    saavn_item = SearchItem(
        id="saavn:jeena_jeena",
        provider="saavn",
        provider_id="jeena_jeena",
        type="song",
        title="Jeena Jeena",
        subtitle="Badlapur · Atif Aslam",
        extra={"album": "Badlapur", "primary_artists": "Atif Aslam", "isrc": "INS171500012"},
    )
    yt_duplicate = SearchItem(
        id="youtube:jeena_jeena_yt",
        provider="youtube",
        provider_id="jeena_jeena_yt",
        type="song",
        title="Jeena Jeena (Official Video)",
        subtitle="Atif Aslam",
        extra={"isrc": "INS171500012"},
    )

    mock_saavn.search.return_value = SearchResults(
        query="Jeena Jeena",
        songs=[saavn_item],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )
    mock_youtube.search.return_value = SearchResults(
        query="Jeena Jeena",
        songs=[yt_duplicate],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )

    results = await hybrid_provider.search("Jeena Jeena", n=5)
    # Deduplication must merge them into 1 song
    assert len(results.songs) == 1


@pytest.mark.asyncio
async def test_provider_failure_graceful_degradation(hybrid_provider, mock_saavn, mock_youtube):
    """
    If one provider fails with an exception or times out,
    the hybrid provider gracefully serves results from the healthy provider.
    """
    mock_saavn.search.side_effect = RuntimeError("Saavn network timeout")
    yt_song = SearchItem(
        id="youtube:survivor_song",
        provider="youtube",
        provider_id="survivor_song",
        type="song",
        title="Survivor Song",
        subtitle="Destiny",
    )
    mock_youtube.search.return_value = SearchResults(
        query="survivor",
        songs=[yt_song],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )

    results = await hybrid_provider.search("survivor", n=5)
    assert len(results.songs) == 1
    assert results.songs[0].id == "youtube:survivor_song"


@pytest.mark.asyncio
async def test_enriched_youtube_song_resolution(hybrid_provider, mock_saavn, mock_youtube):
    """
    When enrich=True is requested, YouTube search items are resolved through
    YouTubeProvider.get_song() to produce rich canonical Song objects.
    """
    yt_search_item = SearchItem(
        id="youtube:yt_song_1",
        provider="youtube",
        provider_id="yt_song_1",
        type="song",
        title="Enriched Track",
        subtitle="Real Artist",
    )
    canonical_yt_song = Song(
        id="youtube:yt_song_1",
        provider="youtube",
        provider_id="yt_song_1",
        title="Enriched Track",
        artists=[ArtistRef(id="youtube:artist:real_artist", provider="youtube", provider_id="real_artist", name="Real Artist", role="primary")],
        duration_ms=215000,
        artwork_url="https://i.ytimg.com/vi/yt_song_1/hqdefault.jpg",
        has_media=True,
    )

    mock_saavn.search.return_value = SearchResults(
        query="enriched",
        songs=[],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=0,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )
    mock_youtube.search.return_value = SearchResults(
        query="enriched",
        songs=[yt_search_item],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )
    mock_youtube.get_song.return_value = canonical_yt_song

    results = await hybrid_provider.search("enriched", n=5, enrich=True)
    assert len(results.songs) == 1
    assert results.enriched_songs is not None
    assert len(results.enriched_songs) == 1
    enriched = results.enriched_songs[0]
    assert enriched.duration_ms == 215000
    assert enriched.artists[0].name == "Real Artist"
    mock_youtube.get_song.assert_awaited_once_with("yt_song_1")


@pytest.mark.asyncio
async def test_search_query_cache(hybrid_provider, mock_saavn, mock_youtube):
    """
    Repeated search queries within TTL are served from in-memory cache
    without making redundant calls to upstream providers.
    """
    mock_saavn.search.return_value = SearchResults(
        query="cached query",
        songs=[SearchItem(id="saavn:cached_1", provider="saavn", provider_id="c1", type="song", title="Cached 1")],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=1,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )
    mock_youtube.search.return_value = SearchResults(
        query="cached query",
        songs=[],
        albums=[],
        artists=[],
        playlists=[],
        total_songs=0,
        total_albums=0,
        total_artists=0,
        total_playlists=0,
    )

    # First call - cache miss
    res1 = await hybrid_provider.search("cached query", n=5)
    assert len(res1.songs) == 1
    assert mock_saavn.search.await_count == 1

    # Second call - cache hit
    res2 = await hybrid_provider.search("cached query", n=5)
    assert len(res2.songs) == 1
    # Upstream call count must still be 1
    assert mock_saavn.search.await_count == 1
