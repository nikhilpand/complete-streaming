'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sparkles, Radio } from 'lucide-react';
import { search } from '@/lib/api/search';
import { getUserTaste, getRecommendations, recommendationToSong } from '@/lib/api/recommendations';
import { AlbumCard } from '@/components/music/AlbumCard';
import { ArtistCard } from '@/components/music/ArtistCard';
import { HorizontalShelf } from '@/components/music/HorizontalShelf';
import { SongRow } from '@/components/music/SongRow';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Song, SearchResponseData, UserTasteProfile } from '@/lib/api/types';

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

interface Section {
  label: string;
  songs: Song[];
  albums: NonNullable<SearchResponseData['albums']>;
  artists: NonNullable<SearchResponseData['artists']>;
}

export default function LibraryPage() {
  const [taste, setTaste] = useState<UserTasteProfile | null>(null);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();

    async function load() {
      setLoading(true);
      try {
        // Fetch user taste profile and personalized recommendations concurrently
        const [tasteRes, recsRes] = await Promise.allSettled([
          getUserTaste(undefined, ac.signal),
          getRecommendations({ feedType: 'for_you', n: 10, signal: ac.signal }),
        ]);

        if (tasteRes.status === 'fulfilled' && tasteRes.value) {
          setTaste(tasteRes.value);
        }

        if (recsRes.status === 'fulfilled' && recsRes.value?.length) {
          const songs = recsRes.value.map(recommendationToSong);
          setRecommendations(songs);
        }

        // Fetch curated discovery mood shelves
        const picks = MOODS.slice(0, 2);
        const results = await Promise.allSettled(
          picks.map((m) =>
            search(m.query, 12, 1, true, ac.signal).then((r) => ({ ...r, label: m.label }))
          )
        );

        const built: Section[] = results
          .filter(
            (r): r is PromiseFulfilledResult<SearchResponseData & { label: string }> =>
              r.status === 'fulfilled'
          )
          .map((r) => ({
            label: r.value.label,
            songs: r.value.enriched_songs?.length
              ? r.value.enriched_songs
              : (r.value.songs ?? []).map(itemToSong),
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
        <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">Taste & Library</p>
        <h1 className="text-4xl font-bold text-[--foreground] tracking-tight">Your Library</h1>
        <p className="text-[--muted] text-sm">Personalized taste profile, recommendations, and curated discovery</p>
      </div>

      {/* Taste Profile Persona Banner */}
      {taste && (
        <section className="relative overflow-hidden rounded-[--radius-xl] border border-white/[0.08] bg-[--surface-elevated] p-6">
          <div className="absolute right-0 top-0 -mr-10 -mt-10 h-44 w-44 rounded-full bg-[--art-accent] opacity-20 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.08] text-[11px] font-mono text-[--art-accent]">
                  <Sparkles className="w-3 h-3" /> Listening Archetype
                </span>
                <span className="text-[11px] font-mono text-[--muted]">
                  {taste.play_count > 0
                    ? `${taste.play_count} plays analyzed`
                    : 'Personalized Profile Active'}
                </span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-[--foreground] tracking-tight">
                {taste.archetype || 'Atmospheric Explorer'}
              </h2>
              <p className="text-xs text-[--muted] max-w-md leading-relaxed">
                Adaptive listening engine evolving continuously across short-term discovery and long-term artist loyalty.
              </p>
            </div>

            {/* Affinity pills */}
            <div className="flex flex-col gap-2 min-w-[200px]">
              {taste.top_genres?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[--muted]">Top Genres</p>
                  <div className="flex flex-wrap gap-1.5">
                    {taste.top_genres.slice(0, 4).map((g) => (
                      <span
                        key={g}
                        className="px-2.5 py-0.5 rounded-full bg-white/[0.06] text-xs text-[--foreground] capitalize"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {taste.top_moods?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[--muted]">Signature Moods</p>
                  <div className="flex flex-wrap gap-1.5">
                    {taste.top_moods.slice(0, 3).map((m) => (
                      <span
                        key={m}
                        className="px-2.5 py-0.5 rounded-full bg-white/[0.04] text-[11px] text-[--muted] capitalize border border-white/[0.05]"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Personalized Recommendations (For You) */}
      {recommendations.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div>
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[--art-accent]" />
                <h2 className="text-xl font-semibold text-[--foreground] tracking-tight">
                  Made For You
                </h2>
              </div>
              <p className="text-xs text-[--muted] mt-0.5">
                Curated by SWAY Taste Engine based on your listening horizons
              </p>
            </div>
            <span className="text-xs font-mono text-[--muted] uppercase tracking-wider">
              {recommendations.length} tracks
            </span>
          </div>
          <div className="space-y-1">
            {recommendations.slice(0, 8).map((s, i) => (
              <SongRow key={s.id} song={s} index={i} context={recommendations} />
            ))}
          </div>
        </section>
      )}

      {/* Mood pills */}
      <section className="space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[--muted] px-1">
          Explore by Mood
        </h3>
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
                    <AlbumCard
                      key={a.id}
                      id={a.id}
                      title={a.title}
                      subtitle={a.subtitle}
                      artwork_url={a.artwork_url}
                    />
                  ))}
                </HorizontalShelf>
              )}

              {sec.artists.length > 0 && (
                <HorizontalShelf title={`${sec.label} Artists`}>
                  {sec.artists.slice(0, 5).map((a) => (
                    <ArtistCard
                      key={a.id}
                      id={a.id}
                      name={a.title}
                      artwork_url={a.artwork_url}
                    />
                  ))}
                </HorizontalShelf>
              )}
            </div>
          ))}
    </div>
  );
}
