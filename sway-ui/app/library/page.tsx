'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sparkles, Radio, Heart, Play, Shuffle, Plus, ListMusic, History, Music2, ArrowDownToLine } from 'lucide-react';
import { search } from '@/lib/api/search';
import { getUserTaste, getRecommendations, recommendationToSong } from '@/lib/api/recommendations';
import { useLikedSongs } from '@/store/useLikedSongs';
import { useCustomPlaylists } from '@/store/useCustomPlaylists';
import { useRecentHistory } from '@/store/useRecentHistory';
import { usePlayerStore } from '@/store/playerStore';
import { AlbumCard } from '@/components/music/AlbumCard';
import { ArtistCard } from '@/components/music/ArtistCard';
import { HorizontalShelf } from '@/components/music/HorizontalShelf';
import { SongRow } from '@/components/music/SongRow';
import { Artwork } from '@/components/artwork/Artwork';
import { CreatePlaylistModal } from '@/components/music/CreatePlaylistModal';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Song, SearchResponseData, UserTasteProfile } from '@/lib/api/types';

// Curated queries for the library discover section
const MOODS = [
  { label: 'Romantic', query: 'romantic hindi songs' },
  { label: 'Party', query: 'party anthems bollywood' },
  { label: 'Chill', query: 'lofi chill hindi' },
  { label: 'Sad', query: 'sad hindi songs' },
];

function itemToSong(item: NonNullable<SearchResponseData['songs']>[0]): Song {
  const parts = (item.subtitle || '').split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean);
  const artistName = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
  const albumName = parts.length > 1 ? parts.slice(0, -1).join(' · ') : undefined;
  return {
    id: item.id,
    provider: item.provider,
    provider_id: item.provider_id,
    type: 'song',
    title: item.title,
    subtitle: item.subtitle,
    artists: [{ id: '', name: artistName, role: 'primary' }],
    album: albumName,
    artwork_url: item.artwork_url,
    has_media: true,
  };
}

interface Section {
  label: string;
  songs: Song[];
  albums: NonNullable<SearchResponseData['albums']>;
  artists: NonNullable<SearchResponseData['artists']>;
}

export default function LibraryPage() {
  const [taste, setTaste] = useState<UserTasteProfile | null>(null);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [playlistModalTab, setPlaylistModalTab] = useState<'create' | 'import'>('create');

  const likedSongs = useLikedSongs((s) => s.likedSongs);
  const customPlaylists = useCustomPlaylists((s) => s.playlists);
  const recentHistory = useRecentHistory((s) => s.history);
  const clearHistory = useRecentHistory((s) => s.clearHistory);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activePlaylists = mounted ? customPlaylists : [];
  const activeLikedSongs = mounted ? likedSongs : [];
  const activeHistory = mounted ? recentHistory : [];

  const setQueue = usePlayerStore((s) => s.setQueue);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);

  useEffect(() => {
    const ac = new AbortController();

    async function load() {
      setLoading(true);
      try {
        // Fetch user taste profile and personalized recommendations concurrently
        const [tasteRes, recsRes] = await Promise.allSettled([
          getUserTaste(undefined, ac.signal),
          getRecommendations({ feedType: 'for_you', n: 10, signal: ac.signal }),
        ]);

        if (tasteRes.status === 'fulfilled' && tasteRes.value) {
          setTaste(tasteRes.value);
        }

        if (recsRes.status === 'fulfilled' && recsRes.value?.length) {
          const songs = recsRes.value.map(recommendationToSong);
          setRecommendations(songs);
        }

        // Fetch curated discovery mood shelves
        const picks = MOODS.slice(0, 2);
        const results = await Promise.allSettled(
          picks.map((m) =>
            search(m.query, 12, 1, true, ac.signal).then((r) => ({ ...r, label: m.label }))
          )
        );

        const built: Section[] = results
          .filter(
            (r): r is PromiseFulfilledResult<SearchResponseData & { label: string }> =>
              r.status === 'fulfilled'
          )
          .map((r) => ({
            label: r.value.label,
            songs: r.value.enriched_songs?.length
              ? r.value.enriched_songs
              : (r.value.songs ?? []).map(itemToSong),
            albums: r.value.albums ?? [],
            artists: r.value.artists ?? [],
          }));

        if (!ac.signal.aborted) setSections(built);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => ac.abort();
  }, []);

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 sm:py-10 max-w-7xl mx-auto space-y-10 sm:space-y-14">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">Taste & Library</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-[--foreground] tracking-tight">Your Library</h1>
          <p className="text-[--muted] text-sm">Personal playlists, liked songs, listening history, and taste archetype</p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => {
              setPlaylistModalTab('import');
              setIsCreatingPlaylist(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white/[0.06] border border-white/10 text-[--foreground] rounded-full text-xs font-semibold hover:bg-white/[0.1] transition-colors cursor-pointer shadow-sm"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-400" /> Import
          </button>
          <button
            onClick={() => {
              setPlaylistModalTab('create');
              setIsCreatingPlaylist(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[--foreground] text-[--surface] rounded-full text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" /> New Playlist
          </button>
        </div>
      </div>

      {/* ── Custom Playlists Shelf ──────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1 border-b border-white/[0.04] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
              <ListMusic className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[--foreground] tracking-tight">
                Your Playlists
              </h2>
              <p className="text-xs text-[--muted] mt-0.5">
                {activePlaylists.length} custom {activePlaylists.length === 1 ? 'playlist' : 'playlists'}
              </p>
            </div>
          </div>
        </div>

        {/* Playlists Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {/* Create new tile */}
          <button
            onClick={() => {
              setPlaylistModalTab('create');
              setIsCreatingPlaylist(true);
            }}
            className="group flex flex-col items-center justify-center aspect-square rounded-[--radius-lg] border border-dashed border-white/15 hover:border-white/30 hover:bg-white/[0.02] transition-all p-4 text-center cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-white/[0.05] group-hover:bg-white/[0.1] flex items-center justify-center mb-3 transition-colors">
              <Plus className="w-5 h-5 text-[--muted] group-hover:text-[--foreground]" />
            </div>
            <p className="text-xs font-medium text-[--foreground]">New Playlist</p>
            <p className="text-[10px] text-[--muted] mt-0.5">Create blank</p>
          </button>

          {/* Import playlist tile */}
          <button
            onClick={() => {
              setPlaylistModalTab('import');
              setIsCreatingPlaylist(true);
            }}
            className="group flex flex-col items-center justify-center aspect-square rounded-[--radius-lg] border border-dashed border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-500/[0.03] transition-all p-4 text-center cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 group-hover:bg-emerald-500/20 flex items-center justify-center mb-3 transition-colors">
              <ArrowDownToLine className="w-5 h-5 text-emerald-400 group-hover:text-emerald-300" />
            </div>
            <p className="text-xs font-medium text-[--foreground]">Import Playlist</p>
            <p className="text-[10px] text-[--muted] mt-0.5">Spotify / YT Music</p>
          </button>

          {activePlaylists.map((pl) => (
            <Link
              key={pl.id}
              href={`/playlist/${pl.id}`}
              className="group block cursor-pointer"
            >
              <div className="relative aspect-square overflow-hidden rounded-[--radius-lg] bg-[--surface-elevated] mb-3">
                {pl.songs[0]?.artwork_url ? (
                  <Artwork
                    src={pl.songs[0].artwork_url}
                    alt={pl.title}
                    size={200}
                    className="w-full h-full rounded-[--radius-lg] transition-transform duration-[--motion-slow] group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/[0.03]">
                    <Music2 className="w-10 h-10 text-white/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-[--motion-normal] rounded-[--radius-lg]" />
                {pl.songs.length > 0 && (
                  <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-all duration-[--motion-normal] translate-y-2 group-hover:translate-y-0">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setQueue(pl.songs, 0);
                        setCurrentTrack(pl.songs[0], { source: `custom_playlist:${pl.id}` });
                      }}
                      className="w-10 h-10 rounded-full bg-[--foreground] flex items-center justify-center shadow-xl hover:scale-105 transition-transform"
                      title="Play playlist"
                    >
                      <Play className="w-4 h-4 text-[--surface] fill-current translate-x-0.5" />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-sm font-medium text-[--foreground] truncate leading-tight group-hover:text-[--art-accent] transition-colors">
                {pl.title}
              </p>
              <p className="text-xs text-[--muted] truncate mt-0.5">
                {pl.songs.length} {pl.songs.length === 1 ? 'track' : 'tracks'}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Liked Songs Collection Shelf ──────────────────────────────── */}
      {activeLikedSongs.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1 border-b border-white/[0.04] pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center">
                <Heart className="w-5 h-5 fill-current" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[--foreground] tracking-tight">
                  Liked Songs
                </h2>
                <p className="text-xs text-[--muted] mt-0.5">
                  Your saved favorites · {activeLikedSongs.length} {activeLikedSongs.length === 1 ? 'track' : 'tracks'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setQueue(activeLikedSongs, 0);
                  setCurrentTrack(activeLikedSongs[0], { source: 'liked_songs' });
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[--foreground] text-[--surface] rounded-full text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Play All
              </button>
              <button
                onClick={() => {
                  const shuffled = [...activeLikedSongs].sort(() => Math.random() - 0.5);
                  setQueue(shuffled, 0);
                  setCurrentTrack(shuffled[0], { source: 'liked_songs' });
                }}
                className="flex items-center gap-1.5 px-4 py-2 border border-white/10 text-[--muted] rounded-full text-xs font-medium hover:text-[--foreground] hover:border-white/20 transition-colors cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5" /> Shuffle
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {activeLikedSongs.slice(0, 15).map((song, i) => (
              <SongRow
                key={song.id}
                song={song}
                index={i}
                context={activeLikedSongs}
                playbackContext={{ source: 'liked_songs' }}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Recently Played Shelf ──────────────────────────────── */}
      {activeHistory.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1 border-b border-white/[0.04] pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[--foreground] tracking-tight">
                  Recently Played
                </h2>
                <p className="text-xs text-[--muted] mt-0.5">
                  Listening history · {activeHistory.length} {activeHistory.length === 1 ? 'track' : 'tracks'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const recentSongs = activeHistory.map((h) => h.song);
                  setQueue(recentSongs, 0);
                  setCurrentTrack(recentSongs[0], { source: 'recent_history' });
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[--foreground] text-[--surface] rounded-full text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Play All
              </button>
              <button
                onClick={() => clearHistory()}
                className="px-3 py-1.5 text-xs text-[--muted] hover:text-red-400 transition-colors cursor-pointer"
                title="Clear history"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {activeHistory.slice(0, 10).map((item, i) => (
              <SongRow
                key={`${item.song.id}-${item.playedAt}`}
                song={item.song}
                index={i}
                context={activeHistory.map((h) => h.song)}
                playbackContext={{ source: 'recent_history' }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Taste Profile Persona Banner */}
      {taste && (
        <section className="relative overflow-hidden rounded-[--radius-xl] border border-white/[0.08] bg-[--surface-elevated] p-4 sm:p-6">
          <div className="absolute right-0 top-0 -mr-10 -mt-10 h-44 w-44 rounded-full bg-[--art-accent] opacity-20 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5 sm:gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.08] text-[11px] font-mono text-[--art-accent]">
                  <Sparkles className="w-3 h-3" /> Listening Archetype
                </span>
                <span className="text-[11px] font-mono text-[--muted]">
                  {taste.play_count > 0
                    ? `${taste.play_count} plays analyzed`
                    : 'Personalized Profile Active'}
                </span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-[--foreground] tracking-tight">
                {taste.archetype || 'Atmospheric Explorer'}
              </h2>
              <p className="text-xs text-[--muted] max-w-md leading-relaxed">
                Adaptive listening engine evolving continuously across short-term discovery and long-term artist loyalty.
              </p>
            </div>

            {/* Affinity pills */}
            <div className="flex flex-col gap-2 min-w-[200px]">
              {taste.top_genres?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[--muted]">Top Genres</p>
                  <div className="flex flex-wrap gap-1.5">
                    {taste.top_genres.slice(0, 4).map((g) => (
                      <span
                        key={g}
                        className="px-2.5 py-0.5 rounded-full bg-white/[0.06] text-xs text-[--foreground] capitalize"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {taste.top_moods?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[--muted]">Signature Moods</p>
                  <div className="flex flex-wrap gap-1.5">
                    {taste.top_moods.slice(0, 3).map((m) => (
                      <span
                        key={m}
                        className="px-2.5 py-0.5 rounded-full bg-white/[0.04] text-[11px] text-[--muted] capitalize border border-white/[0.05]"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Personalized Recommendations (For You) */}
      {recommendations.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div>
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[--art-accent]" />
                <h2 className="text-xl font-semibold text-[--foreground] tracking-tight">
                  Made For You
                </h2>
              </div>
              <p className="text-xs text-[--muted] mt-0.5">
                Curated by SWAY Taste Engine based on your listening horizons
              </p>
            </div>
          </div>
          <div className="space-y-1">
            {recommendations.slice(0, 8).map((song, i) => (
              <SongRow
                key={song.id}
                song={song}
                index={i}
                context={recommendations}
                playbackContext={{ source: 'taste_for_you' }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Curated Mood Sections */}
      {loading ? (
        <div className="space-y-12">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-4">
              <Skeleton className="h-6 w-36" />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="aspect-square rounded-[--radius-lg]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        sections.map((sec) => (
          <div key={sec.label} className="space-y-10">
            {sec.songs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">
                    {sec.label} Radio
                  </h2>
                  <span className="text-[11px] font-mono text-[--muted] uppercase tracking-wider">Curated</span>
                </div>
                <div className="space-y-1">
                  {sec.songs.slice(0, 6).map((song, i) => (
                    <SongRow
                      key={song.id}
                      song={song}
                      index={i}
                      context={sec.songs}
                      playbackContext={{ source: `mood:${sec.label}` }}
                    />
                  ))}
                </div>
              </section>
            )}

            {sec.albums.length > 0 && (
              <HorizontalShelf title={`${sec.label} Albums`}>
                {sec.albums.slice(0, 6).map((a) => (
                  <AlbumCard
                    key={a.id}
                    id={a.id}
                    title={a.title}
                    subtitle={a.subtitle}
                    artwork_url={a.artwork_url}
                  />
                ))}
              </HorizontalShelf>
            )}

            {sec.artists.length > 0 && (
              <HorizontalShelf title={`${sec.label} Artists`}>
                {sec.artists.slice(0, 6).map((a) => (
                  <ArtistCard
                    key={a.id}
                    id={a.id}
                    name={a.title}
                    artwork_url={a.artwork_url}
                  />
                ))}
              </HorizontalShelf>
            )}
          </div>
        ))
      )}

      {/* Modal for creating or importing a playlist */}
      <CreatePlaylistModal
        isOpen={isCreatingPlaylist}
        defaultTab={playlistModalTab}
        onClose={() => setIsCreatingPlaylist(false)}
      />
    </div>
  );
}
