'use client';
import { useState, useEffect } from 'react';
import { use } from 'react';
import { Play, Shuffle } from 'lucide-react';
import { getArtist } from '@/lib/api/artists';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { SongRow } from '@/components/music/SongRow';
import { AlbumCard } from '@/components/music/AlbumCard';
import { HorizontalShelf } from '@/components/music/HorizontalShelf';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { artUrl, formatCount } from '@/lib/utils';
import type { Artist } from '@/lib/api/types';

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  async function load() {
    setLoading(true); setError(null);
    try { setArtist(await getArtist(id)); }
    catch { setError("Couldn't load this artist."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [id]);

  const topSongs = artist?.top_songs ?? [];
  const topAlbums = artist?.top_albums ?? [];
  const singles = artist?.singles ?? [];

  if (error) return <div className="flex items-center justify-center h-screen"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div>
      {/* Hero */}
      <div className="relative h-72 md:h-80 bg-[--surface-elevated] overflow-hidden">
        {artist?.image_url && (
          <img src={artUrl(artist.image_url)} alt={artist.name} className="w-full h-full object-cover object-top opacity-50" />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 30%, var(--surface))' }} />
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6">
          {loading ? (
            <><Skeleton className="h-12 w-48 mb-2" /><Skeleton className="h-4 w-32" /></>
          ) : artist ? (
            <>
              <h1 className="text-5xl font-bold text-[--foreground] tracking-tight">{artist.name}</h1>
              {((artist.follower_count ?? 0) > 0 || (artist.fan_count ?? 0) > 0) && (
                <p className="text-[--muted] text-sm mt-1">
                  {formatCount(artist.follower_count || artist.fan_count || 0)} followers
                </p>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-5 flex items-center gap-3">
        <button
          disabled={loading || !topSongs.length}
          onClick={() => {
            audioManager?.init();
            setQueue(topSongs, 0);
            setCurrentTrack(topSongs[0]);
          }}
          className="flex items-center gap-2 px-5 py-2.5 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Play className="w-4 h-4 fill-current" /> Play
        </button>
        <button
          disabled={loading || !topSongs.length}
          onClick={() => {
            audioManager?.init();
            const s = [...topSongs].sort(() => Math.random() - 0.5);
            setQueue(s, 0);
            setCurrentTrack(s[0]);
          }}
          className="flex items-center gap-2 px-5 py-2.5 border border-white/10 text-[--muted] rounded-[--radius-md] text-sm font-medium hover:text-[--foreground] transition-colors disabled:opacity-40"
        >
          <Shuffle className="w-4 h-4" /> Shuffle
        </button>
      </div>

      <div className="px-6 space-y-12 pb-12">
        {/* Popular */}
        <section>
          <h2 className="text-lg font-semibold text-[--foreground] mb-3 tracking-tight">Popular</h2>
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
          <HorizontalShelf title="Albums">
            {topAlbums.map((a) => (
              <AlbumCard key={a.id} id={a.id} title={a.title}
                subtitle={typeof a.artists === 'string' ? a.artists : ''}
                artwork_url={a.artwork_url}
              />
            ))}
          </HorizontalShelf>
        )}

        {!loading && singles.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-[--foreground] mb-3 tracking-tight">Singles</h2>
            {singles.map((s, i) => <SongRow key={s.id} song={s} index={i} context={singles} />)}
          </section>
        )}
      </div>
    </div>
  );
}
