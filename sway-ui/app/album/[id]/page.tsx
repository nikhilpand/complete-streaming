'use client';
import { useState, useEffect } from 'react';
import { use } from 'react';
import { Play, Shuffle, Clock } from 'lucide-react';
import { getAlbum } from '@/lib/api/albums';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/music/SongRow';
import { Artwork } from '@/components/artwork/Artwork';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Album } from '@/lib/api/types';

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  async function load() {
    setLoading(true); setError(null);
    try { setAlbum(await getAlbum(id)); }
    catch { setError("Couldn't load this album."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [id]);

  const songs = album?.songs ?? [];

  function handlePlay(idx = 0) {
    if (!songs.length) return;
    setQueue(songs, idx);
    setCurrentTrack(songs[idx]);
  }
  function handleShuffle() {
    if (!songs.length) return;
    const s = [...songs].sort(() => Math.random() - 0.5);
    setQueue(s, 0);
    setCurrentTrack(s[0]);
  }

  if (error) return <div className="flex items-center justify-center h-screen"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 py-6 sm:py-10">
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8 mb-8 sm:mb-10 text-center sm:text-left">
        {loading ? (
          <>
            <Skeleton className="w-44 h-44 sm:w-52 sm:h-52 rounded-[--radius-2xl] flex-shrink-0" />
            <div className="space-y-3 flex-1 w-full flex flex-col items-center sm:items-start">
              <Skeleton className="h-3 w-16" /><Skeleton className="h-10 sm:h-12 w-3/4 max-w-sm" />
              <Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-24" />
              <div className="flex gap-3 pt-2 justify-center sm:justify-start"><Skeleton className="h-10 w-24" /><Skeleton className="h-10 w-28" /></div>
            </div>
          </>
        ) : album ? (
          <>
            <div className="w-40 h-40 sm:w-[180px] sm:h-[180px] rounded-[--radius-xl] overflow-hidden flex-shrink-0 shadow-2xl shadow-black/50 bg-[--surface-elevated]">
              <Artwork src={album.artwork_url} alt={album.title} size={180} className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 space-y-2 w-full">
              <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">Album</p>
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[--foreground] tracking-tight leading-tight truncate">{album.title}</h1>
              <p className="text-[--muted] text-base truncate">{typeof album.artists === 'string' ? album.artists : ''}</p>
              <p className="text-sm text-[--muted]">
                {album.year && <>{album.year} · </>}
                {album.song_count ?? songs.length} tracks
                {album.language && <> · {album.language}</>}
              </p>
              <div className="flex flex-wrap justify-center sm:justify-start gap-3 pt-2">
                <button onClick={() => handlePlay()} className="flex items-center gap-2 px-6 py-2.5 bg-[--foreground] text-[--surface] rounded-[10px] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer">
                  <Play className="w-4 h-4 fill-current" /> Play
                </button>
                <button onClick={handleShuffle} className="flex items-center gap-2 px-5 py-2.5 border border-white/10 text-[--muted] rounded-[10px] text-sm font-medium hover:text-[--foreground] hover:border-white/20 transition-colors cursor-pointer">
                  <Shuffle className="w-4 h-4" /> Shuffle
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {!loading && songs.length > 0 && (
        <div className="border-b border-white/[0.05] pb-2 mb-2">
          <div className="grid grid-cols-[32px_40px_1fr_auto_36px] gap-2.5 sm:gap-3 px-2.5 sm:px-3 text-[10px] text-[--muted] uppercase tracking-wider">
            <span>#</span><span /><span>Title</span><span><Clock className="w-3 h-3" /></span><span />
          </div>
        </div>
      )}

      <div className="space-y-0.5">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="w-8 h-4 rounded" />
              <Skeleton className="w-10 h-10 rounded-[--radius-sm]" />
              <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-56" /><Skeleton className="h-3 w-36" /></div>
              <Skeleton className="h-3 w-10" />
            </div>
          ))
        ) : songs.map((song, i) => (
          <SongRow key={song.id} song={song} index={i} context={songs} showAlbum={false} />
        ))}
      </div>
    </div>
  );
}
