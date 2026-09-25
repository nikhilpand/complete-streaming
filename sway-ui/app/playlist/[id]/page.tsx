'use client';
import { useState, useEffect } from 'react';
import { use } from 'react';
import { Play, Shuffle, Clock } from 'lucide-react';
import { getPlaylist } from '@/lib/api/playlists';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/music/SongRow';
import { Artwork } from '@/components/artwork/Artwork';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { artUrl, formatCount } from '@/lib/utils';
import type { Playlist } from '@/lib/api/types';

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  async function load() {
    setLoading(true); setError(null);
    try { setPlaylist(await getPlaylist(id)); }
    catch { setError("Couldn't load this playlist."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [id]);

  const songs = playlist?.songs ?? [];

  if (error) return <div className="flex items-center justify-center h-screen"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex gap-8 items-end mb-10">
        {loading ? (
          <>
            <Skeleton className="w-52 h-52 rounded-[--radius-2xl] flex-shrink-0" />
            <div className="space-y-3 flex-1">
              <Skeleton className="h-3 w-20" /><Skeleton className="h-12 w-64" />
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-3 pt-2"><Skeleton className="h-10 w-24" /><Skeleton className="h-10 w-28" /></div>
            </div>
          </>
        ) : playlist ? (
          <>
            <div className="w-52 h-52 rounded-[--radius-2xl] overflow-hidden flex-shrink-0 shadow-2xl bg-[--surface-elevated]">
              <Artwork src={playlist.artwork_url} alt={playlist.title} size={208} className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">Playlist</p>
              <h1 className="text-4xl font-bold text-[--foreground] tracking-tight leading-tight">{playlist.title}</h1>
              {playlist.owner && <p className="text-[--muted] text-sm">{playlist.owner}</p>}
              <p className="text-sm text-[--muted]">
                {playlist.song_count ?? songs.length} tracks
                {playlist.follower_count ? ` · ${formatCount(playlist.follower_count)} saves` : ''}
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setQueue(songs, 0);
                    setCurrentTrack(songs[0]);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  <Play className="w-4 h-4 fill-current" /> Play
                </button>
                <button
                  onClick={() => {
                    const s = [...songs].sort(() => Math.random() - 0.5);
                    setQueue(s, 0);
                    setCurrentTrack(s[0]);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 border border-white/10 text-[--muted] rounded-[--radius-md] text-sm font-medium hover:text-[--foreground] transition-colors"
                >
                  <Shuffle className="w-4 h-4" /> Shuffle
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {!loading && songs.length > 0 && (
        <div className="border-b border-white/[0.05] pb-2 mb-2">
          <div className="grid grid-cols-[32px_40px_1fr_auto_36px] gap-3 px-3 text-[10px] text-[--muted] uppercase tracking-wider">
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
          <SongRow key={song.id} song={song} index={i} context={songs} />
        ))}
      </div>
    </div>
  );
}
