'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getHomeFeed, type HomeShelfData } from '@/lib/api/home';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/music/SongRow';
import { Artwork } from '@/components/artwork/Artwork';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { artistNames } from '@/lib/utils';
import type { Song } from '@/lib/api/types';

// ─── Persistent client-side recently played list ────────────────────────────
const RECENT_KEY = 'sway_recently_played';
const MAX_RECENT = 20;

function loadRecentlyPlayed(): Song[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentlyPlayed(songs: Song[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(songs.slice(0, MAX_RECENT)));
  } catch {}
}

function addRecentlyPlayed(song: Song): Song[] {
  const prev = loadRecentlyPlayed();
  const filtered = prev.filter((s) => s.id !== song.id);
  const next = [song, ...filtered].slice(0, MAX_RECENT);
  saveRecentlyPlayed(next);
  return next;
}

// ─── Sanitize helper ─────────────────────────────────────────────────────────
const DERIVATIVE_REGEX = /\b(workout|bpm|sped\s*up|speed\s*up|super\s*speed\s*up|slowed|reverb|nightcore|8d(?:\s*audio)?|16d(?:\s*audio)?|karaoke|instrumental|cover|tribute|unplugged(?:\s*remix)?|drum\s*version|piano\s*version|mashup|lo-?fi)\b/i;

function sanitizeShelves(shelves: HomeShelfData[]): HomeShelfData[] {
  return shelves
    .map((s) => {
      const seenKeys = new Set<string>();
      const seenTitles = new Set<string>();
      const validItems = (s.items || []).filter((t) => {
        if (
          !t.artwork_url ||
          t.artwork_url.trim() === '' ||
          !t.title ||
          t.title.toLowerCase().startsWith('track ') ||
          t.title.toLowerCase().startsWith('sample track') ||
          (t as any).artist_name?.toLowerCase() === 'unknown artist' ||
          t.subtitle?.toLowerCase() === 'unknown artist'
        ) return false;
        if (DERIVATIVE_REGEX.test(t.title) || ((t as any).artist_name && DERIVATIVE_REGEX.test((t as any).artist_name))) return false;

        const cleanTitle = t.title.toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();
        const rawArtist = (t as any).artist_name || t.subtitle || '';
        const cleanArtist = rawArtist.toLowerCase().split(/[,·•|&]/)[0].replace(/[^\w\s]/g, '').trim();
        const key = `${cleanTitle}::${cleanArtist}`;
        if (cleanTitle && (seenKeys.has(key) || seenTitles.has(cleanTitle))) return false;
        if (cleanTitle) { seenKeys.add(key); seenTitles.add(cleanTitle); }
        return true;
      });
      return { ...s, items: validItems };
    })
    .filter(
      (s) =>
        s.items.length > 0 &&
        !s.title.toLowerCase().includes('unknown artist') &&
        !s.title.toLowerCase().includes('your artists')
    );
}

// ─── Home Page ────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [shelves, setShelves] = useState<HomeShelfData[]>([]);
  const [feedState, setFeedState] = useState<'cold' | 'seeded' | 'learning' | 'personalized'>('cold');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>([]);

  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);

  // Track the last song we recorded in recently-played so we don't duplicate
  const lastRecordedIdRef = useRef<string | null>(null);
  // Debounce timer for re-fetching home feed after listening
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load recently played from localStorage on mount
  useEffect(() => {
    setRecentlyPlayed(loadRecentlyPlayed());
  }, []);

  // When a track starts playing: add to recently played + schedule home feed refresh
  useEffect(() => {
    if (!currentTrack || currentTrack.id === lastRecordedIdRef.current) return;
    if (status !== 'playing' && status !== 'loading') return;

    lastRecordedIdRef.current = currentTrack.id;
    const updated = addRecentlyPlayed(currentTrack);
    setRecentlyPlayed(updated);

    // Debounce: re-fetch home feed 30s after last track change
    // (gives backend time to process telemetry events and update taste profile)
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      load();
    }, 30_000);
  }, [currentTrack?.id, status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    abortRef.current?.abort();
    const ac = signal ? null : new AbortController();
    if (ac) abortRef.current = ac;
    const sig = signal || ac!.signal;

    setLoading(true);
    setError(null);
    try {
      const feed = await getHomeFeed(sig);
      if (sig.aborted) return;
      if (feed?.shelves?.length > 0) {
        setShelves(feed.shelves);
        if (feed.state) setFeedState(feed.state);
        return;
      }
      throw new Error('No shelves returned');
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') return;
      setError("Couldn't load content. Please try again.");
    } finally {
      if (!sig.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  if (error && !loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <ErrorState message={error} onRetry={() => load()} />
      </div>
    );
  }

  const sanitizedShelves = sanitizeShelves(shelves);
  const primaryShelf = sanitizedShelves[0];
  const primarySongs = primaryShelf?.items ?? [];
  const featured = primarySongs[0] ?? null;

  // Classify subsequent shelves by type for layout decisions
  const subsequentShelves = sanitizedShelves.slice(1);

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 sm:py-10 max-w-7xl mx-auto space-y-10 sm:space-y-14">

      {/* ── Currently Playing Hero (live) ────────────────────────────────── */}
      {currentTrack && (status === 'playing' || status === 'paused' || status === 'loading') && (
        <section className="flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8 text-center sm:text-left
          w-full bg-gradient-to-r from-[--art-wash] to-transparent px-6 py-6 transition-colors duration-[--motion-slow]">
          <div className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-[20px] overflow-hidden flex-shrink-0 shadow-2xl shadow-[--art-primary]/20">
            <Artwork
              src={currentTrack.artwork_url}
              alt={currentTrack.title}
              size={192}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 space-y-1.5 flex-1 w-full">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <span className="inline-flex items-center gap-2 text-[10px] text-[--art-primary] uppercase tracking-widest font-mono font-semibold">
                <span className="w-2 h-2 rounded-full bg-[--art-primary] shadow-[0_0_8px_var(--art-primary)]" />
                {status === 'loading' ? 'Loading' : status === 'paused' ? 'Paused' : 'Now Playing'}
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[--foreground] leading-tight tracking-tight truncate">
              {currentTrack.title}
            </h2>
            <p className="text-[--muted] text-base truncate">
              {artistNames(currentTrack.artists, currentTrack.subtitle)}
              {currentTrack.album && (
                <span className="text-[--muted] opacity-60"> · {currentTrack.album}</span>
              )}
            </p>
          </div>
        </section>
      )}

      {/* ── Recently Played (client-side, instant) ───────────────────────── */}
      {recentlyPlayed.length > 1 && (
        <section className="space-y-3">
          <div className="px-1 flex items-center justify-between border-b border-white/[0.04] pb-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">Recently Played</h2>
              <p className="text-xs text-[--muted] mt-0.5">Picks up where you left off</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[--muted] font-mono">{recentlyPlayed.length} items</span>
            </div>
          </div>
          <div className="flex flex-row md:flex-col gap-3 md:gap-0 overflow-x-auto md:overflow-visible pb-2 md:pb-0 scrollbar-none">
            {recentlyPlayed.slice(0, 8).map((s, i) => (
              <div key={s.id} className="w-32 md:w-auto shrink-0 md:shrink">
                 <div className="block md:hidden group cursor-pointer" onClick={() => { setQueue(recentlyPlayed, i); setCurrentTrack(s, { source: 'recently_played' }); }}>
                   <div className="aspect-square rounded-[12px] overflow-hidden mb-2 relative bg-[--surface-elevated]">
                     <Artwork src={s.artwork_url} alt={s.title} size={128} className="w-full h-full object-cover" />
                   </div>
                   <p className="text-[13px] font-medium text-[--foreground] truncate">{s.title}</p>
                   <p className="text-[11px] text-[--muted] truncate">{artistNames(s.artists)}</p>
                 </div>
                 <div className="hidden md:block">
                   <SongRow song={s} index={i} context={recentlyPlayed} playbackContext={{ source: 'recently_played' }} />
                 </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Feed State Label (personalisation signal) ────────────────────── */}
      {!loading && feedState !== 'cold' && (
        <div className="flex items-center gap-2 px-1">
          <span className="bg-white/[0.05] border border-white/[0.06] px-3 py-1 rounded-full text-[11px] text-[--muted] font-mono">
            {feedState === 'personalized' ? '✦ Personalized for you' :
             feedState === 'learning' ? '◎ Learning your taste' :
             '◌ Getting started'}
          </span>
        </div>
      )}

      {/* ── Featured Hero / Primary Shelf ───────────────────────────────── */}
      {loading ? (
        <>
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8 text-center sm:text-left">
            <Skeleton className="w-44 h-44 sm:w-52 sm:h-52 rounded-[--radius-2xl] flex-shrink-0" />
            <div className="space-y-3 flex-1 w-full flex flex-col items-center sm:items-start">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 sm:h-12 w-3/4 max-w-sm" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-10 w-28 mt-4" />
            </div>
          </div>
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
        </>
      ) : featured ? (
        <>
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8 text-center sm:text-left">
            <div className="relative w-44 h-44 sm:w-52 sm:h-52 rounded-[--radius-2xl] overflow-hidden flex-shrink-0 shadow-2xl">
              <Artwork
                src={featured.artwork_url}
                alt={featured.title}
                size={208}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 space-y-2 w-full">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <span className="text-[10px] text-[--art-primary] uppercase tracking-widest font-mono font-semibold bg-white/10 px-2 py-0.5 rounded-full">
                  {primaryShelf?.badge || 'Featured'}
                </span>
                <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">
                  {primaryShelf?.title || 'Quick Mix'}
                </p>
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[--foreground] leading-tight sm:leading-none tracking-tight truncate">
                {featured.title}
              </h1>
              <p className="text-[--muted] text-base sm:text-lg truncate">
                {artistNames(featured.artists, featured.subtitle)}
              </p>
              <div className="flex items-center justify-center sm:justify-start gap-3 pt-2">
                <button
                  className="px-6 py-2.5 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer min-h-[44px]"
                  onClick={() => {
                    setQueue(primarySongs, 0);
                    setCurrentTrack(featured, { source: primaryShelf.type });
                  }}
                >
                  Play Now
                </button>
              </div>
            </div>
          </div>

          {/* Primary tracklist */}
          <section className="space-y-1">
            <div className="flex items-center justify-between mb-4 px-1 border-b border-white/[0.04] pb-3">
              <div>
                <h2 className="text-xl font-semibold text-[--foreground] tracking-tight">
                  {primaryShelf.title}
                </h2>
                {primaryShelf.subtitle && (
                  <p className="text-xs text-[--muted] mt-0.5">{primaryShelf.subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {primaryShelf.badge && (
                  <span className="text-[11px] font-medium text-[--muted] px-2.5 py-1 rounded-full bg-white/[0.05]">
                    {primaryShelf.badge}
                  </span>
                )}
                <span className="text-xs text-[--muted] font-mono">{primarySongs.slice(0, 10).length} items</span>
              </div>
            </div>
            {primarySongs.slice(0, 10).map((s, i) => (
              <SongRow
                key={s.id}
                song={s}
                index={i}
                context={primarySongs}
                playbackContext={{ source: primaryShelf.type }}
              />
            ))}
          </section>
        </>
      ) : null}

      {/* ── Subsequent Shelves (adaptive layout by type) ─────────────────── */}
      {!loading &&
        subsequentShelves.map((shelf) => {
          if (!shelf.items || shelf.items.length === 0) return null;

          // Song-list shelves (because_you_listened, recently_played, etc.)
          const isSongList = ['because_you_listened', 'recently_played', 'rediscover', 'trending_for_you'].includes(shelf.type);

          return (
            <section key={shelf.id} className="space-y-4">
              <div className="flex items-center justify-between px-1 border-b border-white/[0.04] pb-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">
                    {shelf.title}
                  </h2>
                  {shelf.subtitle && (
                    <p className="text-xs text-[--muted] mt-0.5">{shelf.subtitle}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {shelf.badge && (
                    <span className="text-[11px] font-medium text-[--muted] px-2.5 py-1 rounded-full bg-white/[0.05]">
                      {shelf.badge}
                    </span>
                  )}
                  <span className="text-xs text-[--muted] font-mono">{isSongList ? Math.min(shelf.items.length, 8) : Math.min(shelf.items.length, 6)} items</span>
                </div>
              </div>

              {isSongList ? (
                <div className="space-y-0.5">
                  {shelf.items.slice(0, 8).map((item, i) => (
                    <SongRow
                      key={item.id}
                      song={item}
                      index={i}
                      context={shelf.items}
                      playbackContext={{ source: shelf.type }}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {shelf.items.slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="group cursor-pointer"
                      onClick={() => {
                        setQueue(shelf.items, shelf.items.findIndex((x) => x.id === item.id));
                        setCurrentTrack(item, { source: shelf.type });
                      }}
                    >
                      <div className="relative aspect-square overflow-hidden rounded-[--radius-lg] bg-[--surface-elevated] mb-3">
                        <Artwork
                          src={item.artwork_url}
                          alt={item.title}
                          size={180}
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
              )}
            </section>
          );
        })}
    </div>
  );
}
