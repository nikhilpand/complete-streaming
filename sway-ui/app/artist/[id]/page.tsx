'use client';
import { useState, useEffect, useCallback } from 'react';
import { use } from 'react';
import { Play, Shuffle } from 'lucide-react';
import { getArtist } from '@/lib/api/artists';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/music/SongRow';
import { AlbumCard } from '@/components/music/AlbumCard';
import { Artwork } from '@/components/artwork/Artwork';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatCount } from '@/lib/utils';
import type { Artist } from '@/lib/api/types';

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setArtist(await getArtist(id)); }
    catch { setError("Couldn't load this artist."); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const topSongs = artist?.top_songs ?? [];
  const topAlbums = artist?.top_albums ?? [];
  const singles = artist?.singles ?? [];

  if (error) return <div className="flex items-center justify-center h-screen"><ErrorState message={error} onRetry={load} /></div>;

  return (
<div className="flex flex-col">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8 px-4 sm:px-6 md:px-8 pt-8 sm:pt-12 pb-6 text-center sm:text-left">
        {loading ? (
          <>
            <Skeleton className="w-32 h-32 sm:w-40 sm:h-40 rounded-full flex-shrink-0" />
            <div className="space-y-3 flex-1 flex flex-col items-center sm:items-start">
              <Skeleton className="h-8 sm:h-10 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </>
        ) : artist ? (
          <>
            <div className="w-32 h-32 sm:w-[160px] sm:h-[160px] rounded-full overflow-hidden flex-shrink-0 shadow-2xl bg-[--surface-elevated] ring-1 ring-white/10">
              <Artwork src={artist.image_url} alt={artist.name} size={160} className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 space-y-2">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[--foreground] tracking-tight truncate">{artist.name}</h1>
              {((artist.follower_count ?? 0) > 0 || (artist.fan_count ?? 0) > 0) && (
                <p className="text-[--muted] text-sm">
                  {formatCount(artist.follower_count || artist.fan_count || 0)} followers
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Actions */}
      <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 flex items-center justify-center sm:justify-start gap-3">
        <button
          disabled={loading || !topSongs.length}
          onClick={() => {
            setQueue(topSongs, 0);
            setCurrentTrack(topSongs[0]);
          }}
          className="flex items-center gap-2 px-6 py-2.5 bg-[--foreground] text-[--surface] rounded-[10px] text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer"
        >
          <Play className="w-4 h-4 fill-current" /> Play
        </button>
        <button
          disabled={loading || !topSongs.length}
          onClick={() => {
            const s = [...topSongs].sort(() => Math.random() - 0.5);
            setQueue(s, 0);
            setCurrentTrack(s[0]);
          }}
          className="flex items-center gap-2 px-5 py-2.5 border border-white/10 text-[--muted] rounded-[10px] text-sm font-medium hover:text-[--foreground] hover:border-white/20 transition-colors disabled:opacity-40 cursor-pointer"
        >
          <Shuffle className="w-4 h-4" /> Shuffle
        </button>
      </div>

      <div className="px-4 sm:px-6 md:px-8 space-y-10 sm:space-y-12 pb-12">
        {/* Popular */}
        <section>
          <div className="border-b border-white/[0.04] pb-3 mb-4">
            <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">Top Songs</h2>
          </div>
          {loading ? Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <Skeleton className="w-8 h-4 rounded" />
              <Skeleton className="w-10 h-10 rounded-[--radius-sm]" />
              <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-24" /></div>
              <Skeleton className="h-3 w-10" />
            </div>
          )) : topSongs.map((s, i) => <SongRow key={s.id} song={s} index={i} context={topSongs} />)}
        </section>

        {!loading && topAlbums.length > 0 && (
          <section>
            <div className="border-b border-white/[0.04] pb-3 mb-4">
              <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">Albums</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {topAlbums.map((a) => (
                <AlbumCard key={a.id} id={a.id} title={a.title}
                  subtitle={typeof a.artists === 'string' ? a.artists : ''}
                  artwork_url={a.artwork_url}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && singles.length > 0 && (
          <section>
            <div className="border-b border-white/[0.04] pb-3 mb-4">
              <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">Singles</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {singles.map((a) => (
                <AlbumCard key={a.id} id={a.id} title={a.title}
                  subtitle={typeof a.artists === 'string' ? a.artists : ''}
                  artwork_url={a.artwork_url}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

