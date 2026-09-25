'use client';
import { useState, useEffect } from 'react';
import { search } from '@/lib/api/search';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { AlbumCard } from '@/components/music/AlbumCard';
import { ArtistCard } from '@/components/music/ArtistCard';
import { SongRow } from '@/components/music/SongRow';
import { HorizontalShelf } from '@/components/music/HorizontalShelf';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { artUrl } from '@/lib/utils';
import type { SearchResponseData, Song } from '@/lib/api/types';

const QUERIES = ['bollywood hits 2024', 'trending india', 'top hindi songs', 'arijit singh'];

/**
 * Converts a raw SearchResultItem into a minimal Song shape.
 * Only used as fallback when enriched_songs are unavailable.
 * subtitle format from JioSaavn is typically "Artist · Album".
 */
function itemToSong(item: NonNullable<SearchResponseData['songs']>[0]): Song {
  const parts = (item.subtitle || '').split('·').map((s) => s.trim());
  const artistName = parts[1] || parts[0] || '';
  const albumName = parts[0] || '';
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

export default function HomePage() {
  const [data, setData] = useState<SearchResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
      // enrich=true → backend returns enriched_songs with full Song objects
      // (proper artists, lyrics_id, duration_ms, album, etc.)
      const r = await search(q, 20, 1, true, signal);
      if (!signal?.aborted) setData(r);
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') return;
      setError('Couldn\'t load content. Make sure the SWAY backend is running at http://localhost:8000');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, []);

  if (error) return (
    <div className="flex items-center justify-center h-screen">
      <ErrorState message={error} onRetry={load} />
    </div>
  );

  // Prefer enriched_songs (full Song objects) over raw search results
  const songObjects: Song[] = data?.enriched_songs?.length
    ? data.enriched_songs
    : (data?.songs ?? []).map(itemToSong);

  const albums = data?.albums ?? [];
  const artists = data?.artists ?? [];
  const featured = data?.enriched_songs?.[0] ?? (data?.songs?.[0] ? itemToSong(data.songs[0]) : null);

  return (
    <div className="px-6 py-10 max-w-7xl mx-auto space-y-14">
      {/* Hero */}
      {loading ? (
        <div className="flex gap-8 items-end">
          <Skeleton className="w-52 h-52 rounded-[--radius-2xl] flex-shrink-0" />
          <div className="space-y-3 flex-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-12 w-80" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-10 w-28 mt-4" />
          </div>
        </div>
      ) : featured ? (
        <div className="flex gap-8 items-end">
          <div className="relative w-52 h-52 rounded-[--radius-2xl] overflow-hidden flex-shrink-0 shadow-2xl">
            <img src={artUrl(featured.artwork_url)} alt={featured.title} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">Featured</p>
            <h1 className="text-5xl font-bold text-[--foreground] leading-none tracking-tight truncate">{featured.title}</h1>
            <p className="text-[--muted] text-lg">
              {featured.artists?.map((a) => a.name).filter(Boolean).join(', ') || featured.subtitle}
            </p>
            <button
              className="mt-4 px-6 py-2.5 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
              onClick={() => {
                audioManager?.init();
                setQueue(songObjects, 0);
                setCurrentTrack(featured);
              }}
            >
              Play Now
            </button>
          </div>
        </div>
      ) : null}

      {/* Song list */}
      {loading ? (
        <section className="space-y-3">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <Skeleton className="w-10 h-10 rounded-[--radius-sm]" />
              <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-32" /></div>
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </section>
      ) : songObjects.length > 0 ? (
        <section className="space-y-1">
          <h2 className="text-xl font-semibold text-[--foreground] tracking-tight mb-4 px-1">Trending Now</h2>
          {songObjects.slice(0, 12).map((s, i) => (
            <SongRow key={s.id} song={s} index={i} context={songObjects} />
          ))}
        </section>
      ) : null}

      {/* Albums */}
      {!loading && albums.length > 0 ? (
        <HorizontalShelf title="Albums">
          {albums.slice(0, 6).map((a) => (
            <AlbumCard key={a.id} id={a.id} title={a.title} subtitle={a.subtitle} artwork_url={a.artwork_url} />
          ))}
        </HorizontalShelf>
      ) : null}

      {/* Artists */}
      {!loading && artists.length > 0 ? (
        <HorizontalShelf title="Artists">
          {artists.slice(0, 6).map((a) => (
            <ArtistCard key={a.id} id={a.id} name={a.title} artwork_url={a.artwork_url} />
          ))}
        </HorizontalShelf>
      ) : null}
    </div>
  );
}
