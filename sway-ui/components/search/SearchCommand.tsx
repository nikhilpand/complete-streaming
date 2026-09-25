'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { search } from '@/lib/api/search';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { Artwork } from '@/components/artwork/Artwork';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { SearchResultItem, Song } from '@/lib/api/types';

function toSong(item: SearchResultItem): Song {
  const parts = (item.subtitle || '').split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean);
  const artistName = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
  const albumName = parts.length > 1 ? parts.slice(0, -1).join(' · ') : undefined;
  return {
    id: item.id, provider: item.provider, provider_id: item.provider_id,
    type: 'song', title: item.title, subtitle: item.subtitle,
    artists: [{ id: '', name: artistName, role: 'primary' }],
    album: albumName, artwork_url: item.artwork_url, has_media: true,
  };
}

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Awaited<ReturnType<typeof search>> | null>(null);
  const [loading, setLoading] = useState(false);
  // Map enriched songs by ID for fast lookup
  const [enrichedMap, setEnrichedMap] = useState<Map<string, Song>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
    else { setQuery(''); setResults(null); setEnrichedMap(new Map()); }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setLoading(false); return; }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
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
              className="relative w-full max-w-2xl bg-[--surface-elevated] rounded-[--radius-xl] border border-white/[0.08] shadow-2xl overflow-hidden"
            >
              {/* Input row */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
                <Search className="w-4 h-4 text-[--muted] flex-shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={handleChange}
                  placeholder="Search songs, artists, albums…"
                  className="flex-1 bg-transparent text-[--foreground] placeholder:text-[--muted] text-sm outline-none"
                />
                {loading && <span className="w-3.5 h-3.5 border-2 border-[--muted] border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                <button onClick={() => setOpen(false)} className="text-[--muted] hover:text-[--foreground] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Results */}
              {results && (
                <div className="max-h-[65vh] overflow-y-auto">
                  {/* Songs */}
                  {(results.songs?.length ?? 0) > 0 && (
                    <div className="py-2">
                      <p className="text-[10px] font-semibold text-[--muted] uppercase tracking-widest px-4 py-1.5">Songs</p>
                      {results.songs!.slice(0, 5).map((item) => (
                        <button
                          key={item.id}
                          className="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/[0.04] transition-colors text-left"
                          onClick={() => {
                            audioManager?.init();
                            // Prefer enriched Song (with proper artists, lyrics_id, duration_ms)
                            const song = enrichedMap.get(item.id) ?? toSong(item);
                            usePlayerStore.getState().setCurrentTrack(song);
                            setOpen(false);
                          }}
                        >
                          <Artwork src={item.artwork_url} alt={item.title} size={36} className="rounded-[--radius-xs]" />
                          <div className="min-w-0">
                            <p className="text-sm text-[--foreground] truncate">{item.title}</p>
                            <p className="text-xs text-[--muted] truncate">{item.subtitle}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Artists */}
                  {(results.artists?.length ?? 0) > 0 && (
                    <div className="py-2 border-t border-white/[0.04]">
                      <p className="text-[10px] font-semibold text-[--muted] uppercase tracking-widest px-4 py-1.5">Artists</p>
                      {results.artists!.slice(0, 3).map((item) => (
                        <Link key={item.id} href={`/artist/${item.id}`} onClick={() => setOpen(false)}
                          className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.04] transition-colors"
                        >
                          <Artwork src={item.artwork_url} alt={item.title} size={36} className="rounded-full" />
                          <div>
                            <p className="text-sm text-[--foreground]">{item.title}</p>
                            <p className="text-xs text-[--muted]">Artist</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  {/* Albums */}
                  {(results.albums?.length ?? 0) > 0 && (
                    <div className="py-2 border-t border-white/[0.04]">
                      <p className="text-[10px] font-semibold text-[--muted] uppercase tracking-widest px-4 py-1.5">Albums</p>
                      {results.albums!.slice(0, 3).map((item) => (
                        <Link key={item.id} href={`/album/${item.id}`} onClick={() => setOpen(false)}
                          className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.04] transition-colors"
                        >
                          <Artwork src={item.artwork_url} alt={item.title} size={36} className="rounded-[--radius-xs]" />
                          <div>
                            <p className="text-sm text-[--foreground]">{item.title}</p>
                            <p className="text-xs text-[--muted]">{item.subtitle}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  {/* Nothing */}
                  {!results.songs?.length && !results.artists?.length && !results.albums?.length && (
                    <div className="py-12 text-center text-[--muted] text-sm">No results for &ldquo;{query}&rdquo;</div>
                  )}
                </div>
              )}

              {/* Hints */}
              {!query && (
                <div className="px-4 py-3 text-[10px] text-[--muted] flex gap-4">
                  <span><kbd className="font-mono">↑↓</kbd> navigate</span>
                  <span><kbd className="font-mono">↵</kbd> select</span>
                  <span><kbd className="font-mono">ESC</kbd> close</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
