'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Clock, History, Trash2, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { search } from '@/lib/api/search';
import { usePlayerStore } from '@/store/playerStore';
import { useSearchHistory } from '@/store/useSearchHistory';
import { Artwork } from '@/components/artwork/Artwork';
import Link from 'next/link';
import { searchItemToSong, cn } from '@/lib/utils';
import type { Song, SearchResultItem } from '@/lib/api/types';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

type SelectableItem =
  | { type: 'song'; item: SearchResultItem }
  | { type: 'artist'; item: SearchResultItem }
  | { type: 'album'; item: SearchResultItem }
  | { type: 'playlist'; item: SearchResultItem }
  | { type: 'history'; queryText: string };

export function SearchCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Awaited<ReturnType<typeof search>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  // Map enriched songs by ID for fast lookup
  const [enrichedMap, setEnrichedMap] = useState<Map<string, Song>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const historyQueries = useSearchHistory((s) => s.queries);
  const addQuery = useSearchHistory((s) => s.addQuery);
  const removeQuery = useSearchHistory((s) => s.removeQuery);
  const clearHistory = useSearchHistory((s) => s.clearHistory);

  useOverlayHistory(open, () => setOpen(false), 'search');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !open && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setQuery('');
      setResults(null);
      setEnrichedMap(new Map());
      setSelectedIndex(-1);
    }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null);
      setLoading(false);
      setSelectedIndex(-1);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setSelectedIndex(-1);
    try {
      // enrich=true → backend returns enriched_songs with full Song objects
      const r = await search(q, 8, 1, true, ac.signal);
      if (!ac.signal.aborted) {
        setResults(r);
        // Build a quick-lookup map for song playback
        const map = new Map<string, Song>();
        r.enriched_songs?.forEach((s) => map.set(s.id, s));
        setEnrichedMap(map);
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') setResults(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 280);
  };

  const DERIVATIVE_REGEX = useMemo(
    () =>
      /\b(workout|bpm|sped\s*up|speed\s*up|super\s*speed\s*up|slowed|reverb|nightcore|8d(?:\s*audio)?|16d(?:\s*audio)?|karaoke|instrumental|cover|tribute|unplugged(?:\s*remix)?|drum\s*version|piano\s*version|mashup|lo-?fi)\b/i,
    []
  );

  const uniqueSongs = useMemo(() => {
    if (!results?.songs?.length) return [];
    const qLower = query.toLowerCase();
    const queryHasDeriv = DERIVATIVE_REGEX.test(qLower) || qLower.includes('remix') || qLower.includes('cover');
    const cleanQuery = qLower.replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();

    const seenKeys = new Set<string>();
    const seenTitlesCount = new Map<string, number>();

    return results.songs.filter((item) => {
      if (!item.title) return false;
      if (!queryHasDeriv && (DERIVATIVE_REGEX.test(item.title) || (item.subtitle && DERIVATIVE_REGEX.test(item.subtitle)))) {
        return false;
      }
      const cleanTitle = (item.title || '').toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();
      const cleanArtist = (item.subtitle || '').toLowerCase().split(/[,·•|&]/)[0].replace(/[^\w\s]/g, '').trim();
      const key = `${cleanTitle}::${cleanArtist}`;
      if (cleanTitle && seenKeys.has(key)) return false;

      const titleCount = seenTitlesCount.get(cleanTitle) || 0;
      if (cleanTitle && cleanTitle === cleanQuery && titleCount >= 1) return false;
      if (cleanTitle && titleCount >= 2) return false;

      if (cleanTitle) {
        seenKeys.add(key);
        seenTitlesCount.set(cleanTitle, titleCount + 1);
      }
      return true;
    }).slice(0, 5);
  }, [results, query, DERIVATIVE_REGEX]);

  const topArtists = useMemo(() => (results?.artists || []).slice(0, 3), [results]);
  const topAlbums = useMemo(() => (results?.albums || []).slice(0, 3), [results]);
  const topPlaylists = useMemo(() => (results?.playlists || []).slice(0, 3), [results]);

  const selectableItems = useMemo<SelectableItem[]>(() => {
    if (query.trim()) {
      const items: SelectableItem[] = [];
      uniqueSongs.forEach((item) => items.push({ type: 'song', item }));
      topArtists.forEach((item) => items.push({ type: 'artist', item }));
      topAlbums.forEach((item) => items.push({ type: 'album', item }));
      topPlaylists.forEach((item) => items.push({ type: 'playlist', item }));
      return items;
    }
    return historyQueries.slice(0, 6).map((q) => ({ type: 'history', queryText: q }));
  }, [query, uniqueSongs, topArtists, topAlbums, topPlaylists, historyQueries]);

  const handleSelect = useCallback(
    (item: SelectableItem) => {
      if (item.type === 'song') {
        const song = enrichedMap.get(item.item.id) ?? searchItemToSong(item.item);
        addQuery(query.trim() || item.item.title);
        usePlayerStore.getState().setCurrentTrack(song, { source: 'search', query: query.trim() || item.item.title });
        setOpen(false);
      } else if (item.type === 'artist') {
        addQuery(query.trim() || item.item.title);
        router.push(`/artist/${item.item.id}`);
        setOpen(false);
      } else if (item.type === 'album') {
        addQuery(query.trim() || item.item.title);
        router.push(`/album/${item.item.id}`);
        setOpen(false);
      } else if (item.type === 'playlist') {
        addQuery(query.trim() || item.item.title);
        router.push(`/playlist/${item.item.id}`);
        setOpen(false);
      } else if (item.type === 'history') {
        setQuery(item.queryText);
        addQuery(item.queryText);
        doSearch(item.queryText);
      }
    },
    [addQuery, query, enrichedMap, router, doSearch]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!selectableItems.length) return;
      setSelectedIndex((prev) => (prev + 1) % selectableItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!selectableItems.length) return;
      setSelectedIndex((prev) => (prev <= 0 ? selectableItems.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < selectableItems.length) {
        handleSelect(selectableItems[selectedIndex]);
      } else if (query.trim()) {
        addQuery(query.trim());
        if (selectableItems.length > 0 && selectableItems[0].type === 'song') {
          handleSelect(selectableItems[0]);
        } else {
          router.push(`/search?q=${encodeURIComponent(query.trim())}`);
          setOpen(false);
        }
      }
    }
  };

  return (
    <>
      {/* Trigger button in sidebar/topbar — always rendered */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="search-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[50] flex items-start justify-center pt-16 px-4"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-2xl bg-[--surface-elevated] rounded-[--radius-xl] border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Input row */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
                <Search className="w-4 h-4 text-[--muted] flex-shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Search songs, artists, albums… (↑↓ navigate, ↵ select)"
                  className="flex-1 bg-transparent text-[--foreground] placeholder:text-[--muted] text-sm outline-none"
                  role="combobox"
                  aria-expanded={Boolean(results || historyQueries.length)}
                  aria-autocomplete="list"
                />
                {loading && <span className="w-3.5 h-3.5 border-2 border-[--muted] border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                <button
                  onClick={() => setOpen(false)}
                  className="text-[--muted] hover:text-[--foreground] transition-colors p-1 rounded-sm"
                  aria-label="Close search"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content area: History when empty query, Results when query present */}
              <div ref={listRef} className="max-h-[65vh] overflow-y-auto">
                {/* Recent Searches */}
                {!query.trim() && historyQueries.length > 0 && (
                  <div className="py-2.5">
                    <div className="flex items-center justify-between px-4 py-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[--muted] uppercase tracking-widest">
                        <History className="w-3 h-3" />
                        <span>Recent Searches</span>
                      </div>
                      <button
                        onClick={clearHistory}
                        className="text-[11px] text-[--muted] hover:text-red-400 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" /> Clear
                      </button>
                    </div>
                    {historyQueries.slice(0, 6).map((q, idx) => {
                      const isSelected = selectedIndex === idx;
                      return (
                        <div
                          key={`hist-${q}`}
                          className={cn(
                            'group flex items-center justify-between px-4 py-2 hover:bg-white/[0.04] transition-colors cursor-pointer',
                            isSelected && 'bg-white/[0.07]'
                          )}
                          onClick={() => handleSelect({ type: 'history', queryText: q })}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Clock className="w-3.5 h-3.5 text-[--muted]" />
                            <span className="text-sm text-[--foreground] truncate">{q}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <ArrowRight className="w-3.5 h-3.5 text-[--muted] opacity-0 group-hover:opacity-100 transition-opacity" />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeQuery(q);
                              }}
                              className="text-[--muted] hover:text-[--foreground] p-1 rounded transition-colors"
                              title="Remove from history"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Search Results */}
                {results && query.trim() && (
                  <>
                    {/* Songs */}
                    {uniqueSongs.length > 0 && (
                      <div className="py-2">
                        <p className="text-[10px] font-semibold text-[--muted] uppercase tracking-widest px-4 py-1.5">Songs</p>
                        {uniqueSongs.map((item, idx) => {
                          const itemIndex = idx;
                          const isSelected = selectedIndex === itemIndex;
                          return (
                            <button
                              key={`${item.id}-${idx}`}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-2 hover:bg-white/[0.04] transition-colors text-left cursor-pointer',
                                isSelected && 'bg-white/[0.08] ring-1 ring-[--art-primary]/40'
                              )}
                              onClick={() => handleSelect({ type: 'song', item })}
                            >
                              <Artwork src={item.artwork_url} alt={item.title} size={36} className="rounded-[--radius-xs]" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-[--foreground] truncate">{item.title}</p>
                                <p className="text-xs text-[--muted] truncate">{item.subtitle}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Artists */}
                    {topArtists.length > 0 && (
                      <div className="py-2 border-t border-white/[0.04]">
                        <p className="text-[10px] font-semibold text-[--muted] uppercase tracking-widest px-4 py-1.5">Artists</p>
                        {topArtists.map((item, idx) => {
                          const itemIndex = uniqueSongs.length + idx;
                          const isSelected = selectedIndex === itemIndex;
                          return (
                            <button
                              key={`${item.id}-${idx}`}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-2 hover:bg-white/[0.04] transition-colors text-left cursor-pointer',
                                isSelected && 'bg-white/[0.08] ring-1 ring-[--art-primary]/40'
                              )}
                              onClick={() => handleSelect({ type: 'artist', item })}
                            >
                              <Artwork src={item.artwork_url} alt={item.title} size={36} className="rounded-full" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-[--foreground] truncate">{item.title}</p>
                                <p className="text-xs text-[--muted]">Artist</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Albums */}
                    {topAlbums.length > 0 && (
                      <div className="py-2 border-t border-white/[0.04]">
                        <p className="text-[10px] font-semibold text-[--muted] uppercase tracking-widest px-4 py-1.5">Albums</p>
                        {topAlbums.map((item, idx) => {
                          const itemIndex = uniqueSongs.length + topArtists.length + idx;
                          const isSelected = selectedIndex === itemIndex;
                          return (
                            <button
                              key={`${item.id}-${idx}`}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-2 hover:bg-white/[0.04] transition-colors text-left cursor-pointer',
                                isSelected && 'bg-white/[0.08] ring-1 ring-[--art-primary]/40'
                              )}
                              onClick={() => handleSelect({ type: 'album', item })}
                            >
                              <Artwork src={item.artwork_url} alt={item.title} size={36} className="rounded-[--radius-xs]" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-[--foreground] truncate">{item.title}</p>
                                <p className="text-xs text-[--muted] truncate">{item.subtitle}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Playlists */}
                    {topPlaylists.length > 0 && (
                      <div className="py-2 border-t border-white/[0.04]">
                        <p className="text-[10px] font-semibold text-[--muted] uppercase tracking-widest px-4 py-1.5">Playlists</p>
                        {topPlaylists.map((item, idx) => {
                          const itemIndex = uniqueSongs.length + topArtists.length + topAlbums.length + idx;
                          const isSelected = selectedIndex === itemIndex;
                          return (
                            <button
                              key={`${item.id}-${idx}`}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-2 hover:bg-white/[0.04] transition-colors text-left cursor-pointer',
                                isSelected && 'bg-white/[0.08] ring-1 ring-[--art-primary]/40'
                              )}
                              onClick={() => handleSelect({ type: 'playlist', item })}
                            >
                              <Artwork src={item.artwork_url} alt={item.title} size={36} className="rounded-[--radius-xs]" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-[--foreground] truncate">{item.title}</p>
                                <p className="text-xs text-[--muted] truncate">{item.subtitle}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Nothing */}
                    {!uniqueSongs.length && !topArtists.length && !topAlbums.length && !topPlaylists.length && (
                      <div className="py-12 text-center text-[--muted] text-sm">No results for &ldquo;{query}&rdquo;</div>
                    )}
                  </>
                )}
              </div>

              {/* Footer Hints */}
              <div className="px-4 py-2.5 text-[10px] text-[--muted] flex items-center justify-between border-t border-white/[0.04] bg-white/[0.02]">
                <div className="flex gap-4">
                  <span><kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
                  <span><kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded">↵</kbd> select</span>
                  <span><kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded">ESC</kbd> close</span>
                </div>
                {query.trim() && (
                  <Link
                    href={`/search?q=${encodeURIComponent(query.trim())}`}
                    onClick={() => {
                      addQuery(query.trim());
                      setOpen(false);
                    }}
                    className="hover:text-[--foreground] transition-colors flex items-center gap-1"
                  >
                    <span>View all results</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
