'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { search } from '@/lib/api/search';
import { AlbumCard } from '@/components/music/AlbumCard';
import { ArtistCard } from '@/components/music/ArtistCard';
import { HorizontalShelf } from '@/components/music/HorizontalShelf';
import { SongRow } from '@/components/music/SongRow';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Song, SearchResponseData } from '@/lib/api/types';

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
    id: item.id, provider: item.provider, provider_id: item.provider_id,
    type: 'song', title: item.title, subtitle: item.subtitle,
    artists: [{ id: '', name: artistName, role: 'primary' }],
    album: albumName, artwork_url: item.artwork_url, has_media: true,
  };
}

interface Section {
  label: string;
  songs: Song[];
  albums: NonNullable<SearchResponseData['albums']>;
  artists: NonNullable<SearchResponseData['artists']>;
}

export default function LibraryPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();

    async function load() {
      setLoading(true);
      try {
        // Fetch 2 moods in parallel
        const picks = MOODS.slice(0, 2);
        const results = await Promise.allSettled(
          picks.map((m) => search(m.query, 12, 1, true, ac.signal).then((r) => ({ ...r, label: m.label })))
        );
        const built: Section[] = results
          .filter((r): r is PromiseFulfilledResult<SearchResponseData & { label: string }> => r.status === 'fulfilled')
          .map((r) => ({
            label: r.value.label,
            songs: r.value.enriched_songs?.length ? r.value.enriched_songs : (r.value.songs ?? []).map(itemToSong),
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
    <div className="px-6 py-10 max-w-7xl mx-auto space-y-14">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">Discover</p>
        <h1 className="text-4xl font-bold text-[--foreground] tracking-tight">Library</h1>
        <p className="text-[--muted] text-sm">Explore moods, genres, and artists</p>
      </div>

      {/* Mood pills */}
      <section>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <Link
              key={m.label}
              href={`/search?q=${encodeURIComponent(m.query)}`}
              className="px-4 py-2 rounded-[--radius-sm] bg-[--surface-elevated] text-[--foreground] text-sm font-medium hover:bg-[--surface-elevated-hover] transition-colors"
            >
              {m.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Dynamic sections */}
      {loading
        ? Array.from({ length: 2 }).map((_, i) => (
            <section key={i} className="space-y-4">
              <Skeleton className="h-5 w-32" />
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-3 px-3 py-2">
                    <Skeleton className="w-10 h-10 rounded-[--radius-sm]" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        : sections.map((sec) => (
            <div key={sec.label} className="space-y-8">
              {sec.songs.length > 0 && (
                <section className="space-y-1">
                  <h2 className="text-xl font-semibold text-[--foreground] tracking-tight mb-4 px-1">
                    {sec.label}
                  </h2>
                  {sec.songs.slice(0, 8).map((s, i) => (
                    <SongRow key={s.id} song={s} index={i} context={sec.songs} />
                  ))}
                </section>
              )}

              {sec.albums.length > 0 && (
                <HorizontalShelf title={`${sec.label} Albums`}>
                  {sec.albums.slice(0, 5).map((a) => (
                    <AlbumCard key={a.id} id={a.id} title={a.title} subtitle={a.subtitle} artwork_url={a.artwork_url} />
                  ))}
                </HorizontalShelf>
              )}

              {sec.artists.length > 0 && (
                <HorizontalShelf title={`${sec.label} Artists`}>
                  {sec.artists.slice(0, 5).map((a) => (
                    <ArtistCard key={a.id} id={a.id} name={a.title} artwork_url={a.artwork_url} />
                  ))}
                </HorizontalShelf>
              )}
            </div>
          ))}
    </div>
  );
}
