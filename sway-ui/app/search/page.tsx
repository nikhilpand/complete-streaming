'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { search } from '@/lib/api/search';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/music/SongRow';
import { AlbumCard } from '@/components/music/AlbumCard';
import { ArtistCard } from '@/components/music/ArtistCard';
import { PlaylistCard } from '@/components/music/PlaylistCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { searchItemToSong } from '@/lib/utils';
import type { SearchResponseData, Song, SearchResultItem } from '@/lib/api/types';

type Tab = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [results, setResults] = useState<SearchResponseData | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault(); inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setLoading(false); return; }
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    setLoading(true);
    try {
      // enrich=true → get proper Song objects with lyrics_id, duration_ms, artists
      const r = await search(q, 20, 1, true, ac.signal);
      if (!ac.signal.aborted) setResults(r);
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') setResults(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value; setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 280);
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

  // Preserve the exact ranking and full list of songs
  const songObjects: Song[] = songs.map((s) => enrichedMap.get(s.id) || enrichedMap.get(s.provider_id) || searchItemToSong(s));

  const TABS: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'songs', label: 'Songs' },
    { key: 'artists', label: 'Artists' },
    { key: 'albums', label: 'Albums' },
    { key: 'playlists', label: 'Playlists' },
  ];

  return (
    <div className="px-6 py-10 max-w-6xl mx-auto">
      {/* Input */}
      <div className="relative mb-10">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[--muted]" />
        <input
          ref={inputRef}
          value={query} onChange={handleChange}
          placeholder="What do you want to listen to?"
          className="w-full h-12 pl-12 pr-4 bg-[--surface-elevated] border border-white/[0.06] rounded-[--radius-lg] text-[--foreground] placeholder:text-[--muted] text-sm outline-none focus:border-white/10 transition-colors"
        />
        {loading && <span className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[--muted] border-t-transparent rounded-full animate-spin" />}
      </div>

      {/* Tabs */}
      {results && (
        <div className="flex gap-1.5 mb-8">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tab === key ? 'bg-[--foreground] text-[--surface]' : 'text-[--muted] hover:text-[--foreground] hover:bg-[--surface-elevated]'
              }`}
            >{label}</button>
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
                  <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-32" /></div>
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !query && <EmptyState icon={<SearchIcon className="w-10 h-10" />} title="Search for anything" description="Songs, artists, albums, playlists" />}
      {!loading && query && results && !songs.length && !artists.length && !albums.length && !playlists.length && (
        <EmptyState title={`No results for "${query}"`} description="Try a different search term" />
      )}

      {/* Results */}
      {results && (
        <div className="space-y-10">
          {(tab === 'all' || tab === 'songs') && songs.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[--foreground] mb-3 px-1">Songs</h2>
              {songObjects.map((s, i) => <SongRow key={`${s.id}-${i}`} song={s} index={i} context={songObjects} />)}
            </section>
          )}
          {(tab === 'all' || tab === 'artists') && artists.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[--foreground] mb-4 px-1">Artists</h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {artists.map((a, i) => <ArtistCard key={`${a.id}-${i}`} id={a.id} name={a.title} artwork_url={a.artwork_url} />)}
              </div>
            </section>
          )}
          {(tab === 'all' || tab === 'albums') && albums.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[--foreground] mb-4 px-1">Albums</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {albums.map((a, i) => <AlbumCard key={`${a.id}-${i}`} id={a.id} title={a.title} subtitle={a.subtitle} artwork_url={a.artwork_url} />)}
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
