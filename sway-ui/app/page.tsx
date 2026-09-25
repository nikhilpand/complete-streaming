'use client';

import { useState, useEffect } from 'react';
import { getHomeFeed, type HomeShelfData } from '@/lib/api/home';
import { search } from '@/lib/api/search';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/music/SongRow';
import { HorizontalShelf } from '@/components/music/HorizontalShelf';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { artUrl, artistNames } from '@/lib/utils';
import type { Song, SearchResponseData } from '@/lib/api/types';

export default function HomePage() {
  const [shelves, setShelves] = useState<HomeShelfData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const feed = await getHomeFeed(signal);
      if (feed && feed.shelves && feed.shelves.length > 0) {
        setShelves(feed.shelves);
        return;
      }
    } catch {
      // Fallback to search query if home feed is temporarily unavailable
      try {
        const r = await search('top bollywood hits', 20, 1, true, signal);
        if (r && r.songs) {
          const fallbackSongs: Song[] = r.songs.map((s) => ({
            id: s.id,
            provider: s.provider,
            provider_id: s.provider_id,
            type: 'song',
            title: s.title,
            subtitle: s.subtitle,
            artists: [{ id: '', name: s.subtitle || 'Artist', role: 'primary' }],
            artwork_url: s.artwork_url,
            has_media: true,
          }));
          setShelves([
            {
              id: 'fallback_quick_mix',
              type: 'quick_mix',
              title: 'Trending Music',
              subtitle: 'Popular hits right now',
              badge: 'Trending',
              items: fallbackSongs,
            },
          ]);
          return;
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') return;
      }
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

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <ErrorState message={error} onRetry={() => load()} />
      </div>
    );
  }

  const primaryShelf = shelves[0];
  const primarySongs = primaryShelf?.items ?? [];
  const featured = primarySongs[0] ?? null;

  return (
    <div className="px-6 py-10 max-w-7xl mx-auto space-y-14">
      {/* Featured Listening Hero */}
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
            <img
              src={artUrl(featured.artwork_url)}
              alt={featured.title}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[--art-primary] uppercase tracking-widest font-mono font-semibold bg-white/10 px-2 py-0.5 rounded-full">
                {primaryShelf?.badge || 'Featured'}
              </span>
              <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">
                {primaryShelf?.title || 'Quick Mix'}
              </p>
            </div>
            <h1 className="text-5xl font-bold text-[--foreground] leading-none tracking-tight truncate">
              {featured.title}
            </h1>
            <p className="text-[--muted] text-lg">
              {artistNames(featured.artists, featured.subtitle)}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                className="px-6 py-2.5 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                onClick={() => {
                  setQueue(primarySongs, 0);
                  setCurrentTrack(featured);
                }}
              >
                Play Now
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Primary Shelf: Quick Mix Tracklist */}
      {loading ? (
        <section className="space-y-3">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <Skeleton className="w-10 h-10 rounded-[--radius-sm]" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </section>
      ) : primarySongs.length > 0 ? (
        <section className="space-y-1">
          <div className="flex items-center justify-between mb-4 px-1">
            <div>
              <h2 className="text-xl font-semibold text-[--foreground] tracking-tight">
                {primaryShelf.title}
              </h2>
              {primaryShelf.subtitle && (
                <p className="text-xs text-[--muted] mt-0.5">{primaryShelf.subtitle}</p>
              )}
            </div>
            {primaryShelf.badge && (
              <span className="text-[11px] font-medium text-[--muted] px-2.5 py-1 rounded-full bg-white/[0.05]">
                {primaryShelf.badge}
              </span>
            )}
          </div>
          {primarySongs.slice(0, 10).map((s, i) => (
            <SongRow key={s.id} song={s} index={i} context={primarySongs} />
          ))}
        </section>
      ) : null}

      {/* Subsequent Shelves: Because You Listened, Artist Radar, Rediscover, Discover Mix */}
      {!loading &&
        shelves.slice(1).map((shelf) => {
          if (!shelf.items || shelf.items.length === 0) return null;
          return (
            <section key={shelf.id} className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <div>
                  <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">
                    {shelf.title}
                  </h2>
                  {shelf.subtitle && (
                    <p className="text-xs text-[--muted] mt-0.5">{shelf.subtitle}</p>
                  )}
                </div>
                {shelf.badge && (
                  <span className="text-[11px] font-medium text-[--muted] px-2.5 py-1 rounded-full bg-white/[0.05]">
                    {shelf.badge}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {shelf.items.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="group cursor-pointer"
                    onClick={() => {
                      setQueue(shelf.items, shelf.items.findIndex((x) => x.id === item.id));
                      setCurrentTrack(item);
                    }}
                  >
                    <div className="relative aspect-square overflow-hidden rounded-[--radius-lg] bg-[--surface-elevated] mb-3">
                      <img
                        src={artUrl(item.artwork_url)}
                        alt={item.title}
                        className="w-full h-full object-cover transition-transform duration-[--motion-slow] group-hover:scale-105"
                      />
                    </div>
                    <p className="text-sm font-medium text-[--foreground] truncate leading-tight">
                      {item.title}
                    </p>
                    <p className="text-xs text-[--muted] truncate mt-0.5">
                      {artistNames(item.artists, item.subtitle)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
