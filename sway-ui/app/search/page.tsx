'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search as SearchIcon, Clock, Trash2, X, Sparkles, Compass } from 'lucide-react';
import { search } from '@/lib/api/search';
import { SongRow } from '@/components/music/SongRow';
import { AlbumCard } from '@/components/music/AlbumCard';
import { ArtistCard } from '@/components/music/ArtistCard';
import { PlaylistCard } from '@/components/music/PlaylistCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSearchHistory } from '@/store/useSearchHistory';
import { searchItemToSong, cn } from '@/lib/utils';
import type { SearchResponseData, Song } from '@/lib/api/types';

type Tab = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';

const BROWSE_CATEGORIES = [
  { name: 'Bollywood Hits', query: 'bollywood hits 2024', color: 'from-amber-500/20 via-amber-600/10 to-transparent', border: 'border-amber-500/30' },
  { name: 'Punjabi Pop', query: 'punjabi hits', color: 'from-orange-500/20 via-orange-600/10 to-transparent', border: 'border-orange-500/30' },
  { name: 'Lo-Fi Chill', query: 'lo-fi beats chill', color: 'from-indigo-500/20 via-indigo-600/10 to-transparent', border: 'border-indigo-500/30' },
  { name: 'Romantic Songs', query: 'top romantic hindi songs', color: 'from-rose-500/20 via-rose-600/10 to-transparent', border: 'border-rose-500/30' },
  { name: 'Indie India', query: 'indian indie pop', color: 'from-emerald-500/20 via-emerald-600/10 to-transparent', border: 'border-emerald-500/30' },
  { name: 'Global Hits', query: 'global billboard hot 100', color: 'from-sky-500/20 via-sky-600/10 to-transparent', border: 'border-sky-500/30' },
  { name: 'Desi Hip-Hop', query: 'desi hip hop', color: 'from-purple-500/20 via-purple-600/10 to-transparent', border: 'border-purple-500/30' },
  { name: 'Acoustic / Unplugged', query: 'acoustic unplugged songs', color: 'from-teal-500/20 via-teal-600/10 to-transparent', border: 'border-teal-500/30' },
];

function SearchContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [tab, setTab] = useState<Tab>('all');
  const [results, setResults] = useState<SearchResponseData | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const historyQueries = useSearchHistory((s) => s.queries);
  const addQuery = useSearchHistory((s) => s.addQuery);
  const removeQuery = useSearchHistory((s) => s.removeQuery);
  const clearHistory = useSearchHistory((s) => s.clearHistory);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults(null);
        setLoading(false);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        // enrich=true → get proper Song objects with lyrics_id, duration_ms, artists
        const r = await search(q, 20, 1, true, ac.signal);
        if (!ac.signal.aborted) {
          setResults(r);
          addQuery(q.trim());
        }
      } catch (e: unknown) {
        if ((e as Error)?.name !== 'AbortError') setResults(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [addQuery]
  );

  // Sync with initial URL query param if present
  useEffect(() => {
    if (initialQuery.trim()) {
      setQuery(initialQuery);
      doSearch(initialQuery);
    }
  }, [initialQuery, doSearch]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 280);
  }

  function handleQuickSearch(q: string) {
    setQuery(q);
    doSearch(q);
    inputRef.current?.focus();
  }

  const songs = results?.songs ?? [];
  const artists = results?.artists ?? [];
  const albums = results?.albums ?? [];
  const playlists = results?.playlists ?? [];

  // Map enriched songs by ID for fast lookup
  const enrichedMap = new Map<string, Song>();
  results?.enriched_songs?.forEach((s) => {
    if (s.id) enrichedMap.set(s.id, s);
    if (s.provider_id) enrichedMap.set(s.provider_id, s);
  });

  // Preserve the exact ranking while deduplicating identical song variants
  const DERIVATIVE_REGEX =
    /\b(workout|bpm|sped\s*up|speed\s*up|super\s*speed\s*up|slowed|reverb|nightcore|8d(?:\s*audio)?|16d(?:\s*audio)?|karaoke|instrumental|cover|tribute|unplugged(?:\s*remix)?|drum\s*version|piano\s*version|mashup|lo-?fi)\b/i;
  const qLower = query.toLowerCase();
  const queryHasDeriv = DERIVATIVE_REGEX.test(qLower) || qLower.includes('remix') || qLower.includes('cover');
  const cleanQuery = qLower.replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();

  const seenSongKeys = new Set<string>();
  const seenTitlesCount = new Map<string, number>();
  const songObjects: Song[] = [];

  for (const s of songs) {
    const song = enrichedMap.get(s.id) || enrichedMap.get(s.provider_id) || searchItemToSong(s);
    if (!song.title) continue;

    // Filter derivative songs unless explicitly queried
    if (!queryHasDeriv && (DERIVATIVE_REGEX.test(song.title) || (song.subtitle && DERIVATIVE_REGEX.test(song.subtitle)))) {
      continue;
    }

    const cleanTitle = (song.title || '').toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();
    const rawArtist = song.artists?.[0]?.name || s.subtitle || '';
    const cleanArtist = rawArtist.toLowerCase().split(/[,·•|&]/)[0].replace(/[^\w\s]/g, '').trim();
    const key = `${cleanTitle}::${cleanArtist}`;

    if (cleanTitle && seenSongKeys.has(key)) {
      continue;
    }

    // Deduplicate duplicate titles: if exact match to query, allow only 1! Otherwise at most 2.
    const titleCount = seenTitlesCount.get(cleanTitle) || 0;
    if (cleanTitle && cleanTitle === cleanQuery && titleCount >= 1) {
      continue;
    }
    if (cleanTitle && titleCount >= 2) {
      continue;
    }

    if (cleanTitle) {
      seenSongKeys.add(key);
      seenTitlesCount.set(cleanTitle, titleCount + 1);
    }
    songObjects.push(song);
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'songs', label: 'Songs' },
    { key: 'artists', label: 'Artists' },
    { key: 'albums', label: 'Albums' },
    { key: 'playlists', label: 'Playlists' },
  ];

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 sm:py-10 max-w-6xl mx-auto">
      {/* Input */}
      <div className="relative mb-6 sm:mb-8">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[--muted]" />
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              doSearch(query);
            }
          }}
          placeholder="What do you want to listen to? (Press / to focus)"
          className="w-full bg-[#111118] border border-white/[0.08] rounded-[12px] px-4 py-3 pl-12 pr-12 text-[--foreground] placeholder:text-[--muted] text-sm outline-none focus:border-[--art-primary]/50 focus:ring-2 focus:ring-[--art-primary]/20 transition-all"
        />
        {query && !loading && (
          <button
            onClick={() => {
              setQuery('');
              setResults(null);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[--muted] hover:text-[--foreground] p-1 transition-colors"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[--muted] border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Tabs - horizontally scrollable without wrapping on small screens */}
      {results && (
        <div className="flex gap-2 mb-6 sm:mb-8 overflow-x-auto no-scrollbar py-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap flex-shrink-0 cursor-pointer',
                tab === key
                  ? 'bg-[--art-primary]/20 border border-[--art-primary]/40 text-[--art-primary]'
                  : 'bg-[#111118] border border-white/[0.06] text-[--muted] hover:text-[--foreground] hover:bg-white/[0.03]'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && !results && (
        <div className="space-y-8">
          {Array.from({ length: 2 }).map((_, si) => (
            <div key={si} className="space-y-2">
              <Skeleton className="h-5 w-24" />
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3 px-3 py-2">
                  <Skeleton className="w-10 h-10 rounded-[--radius-sm]" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* When Empty: Recent Searches & Browse Categories */}
      {!loading && !query && (
        <div className="space-y-10 py-2">
          {/* Recent Searches */}
          {historyQueries.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[--muted]" />
                  <h2 className="text-sm font-semibold text-[--foreground]">Recent Searches</h2>
                </div>
                <button
                  onClick={clearHistory}
                  className="text-xs text-[--muted] hover:text-red-400 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear All
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {historyQueries.slice(0, 10).map((q) => (
                  <div
                    key={q}
                    className="inline-flex items-center gap-2 bg-[#111118] border border-white/[0.07] hover:border-white/20 text-xs text-[--foreground] rounded-full px-3 py-1.5 transition-all group"
                  >
                    <button
                      onClick={() => handleQuickSearch(q)}
                      className="cursor-pointer hover:text-[--art-primary] transition-colors"
                    >
                      {q}
                    </button>
                    <button
                      onClick={() => removeQuery(q)}
                      className="text-[--muted] hover:text-[--foreground] transition-colors ml-0.5 cursor-pointer"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Browse Categories */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <Compass className="w-4 h-4 text-[--art-primary]" />
              <h2 className="text-base font-semibold text-[--foreground]">Explore Genres & Moods</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
              {BROWSE_CATEGORIES.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => handleQuickSearch(cat.query)}
                  className={cn(
                    'relative overflow-hidden rounded-[--radius-lg] p-4 text-left transition-all duration-[--motion-normal] hover:scale-[1.02] cursor-pointer border bg-gradient-to-br',
                    cat.color,
                    cat.border,
                    'hover:shadow-lg hover:shadow-black/40'
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[--foreground] tracking-tight">{cat.name}</span>
                    <Sparkles className="w-3.5 h-3.5 text-white/30" />
                  </div>
                  <p className="text-[11px] text-[--muted] line-clamp-1">{cat.query}</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* No results */}
      {!loading && query && results && !songs.length && !artists.length && !albums.length && !playlists.length && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-[--muted]">
          <SearchIcon className="w-16 h-16 mb-4 opacity-40 text-[--muted]" />
          <h2 className="text-lg font-semibold text-[--foreground] mb-2">No results for &ldquo;{query}&rdquo;</h2>
          <p className="text-sm max-w-sm">Check your spelling or try exploring one of the popular categories.</p>
        </div>
      )}

      {/* Results View */}
      {results && query.trim() && (
        <div className="space-y-10">
          {(tab === 'all' || tab === 'songs') && songs.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[--foreground] mb-3 px-1">Songs</h2>
              {songObjects.map((s, i) => (
                <SongRow
                  key={`${s.id}-${i}`}
                  song={s}
                  index={i}
                  context={songObjects}
                  playbackContext={{ source: 'search', query }}
                />
              ))}
            </section>
          )}
          {(tab === 'all' || tab === 'artists') && artists.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[--foreground] mb-4 px-1">Artists</h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {artists.map((a, i) => (
                  <ArtistCard key={`${a.id}-${i}`} id={a.id} name={a.title} artwork_url={a.artwork_url} />
                ))}
              </div>
            </section>
          )}
          {(tab === 'all' || tab === 'albums') && albums.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[--foreground] mb-4 px-1">Albums</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {albums.map((a, i) => (
                  <AlbumCard key={`${a.id}-${i}`} id={a.id} title={a.title} subtitle={a.subtitle} artwork_url={a.artwork_url} />
                ))}
              </div>
            </section>
          )}
          {(tab === 'all' || tab === 'playlists') && playlists.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[--foreground] mb-4 px-1">Playlists</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {playlists.map((p, i) => (
                  <PlaylistCard key={`${p.id}-${i}`} id={p.id} title={p.title} subtitle={p.subtitle} artwork_url={p.artwork_url} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="px-6 py-10 max-w-6xl mx-auto space-y-4">
          <Skeleton className="h-12 w-full rounded-[12px]" />
          <Skeleton className="h-6 w-32" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
