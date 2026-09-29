'use client';

import { useState, useEffect } from 'react';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Shuffle, Clock, Trash2, Edit2, Check, Music2, ArrowDownToLine } from 'lucide-react';
import { getPlaylist } from '@/lib/api/playlists';
import { getSong } from '@/lib/api/songs';
import { usePlayerStore } from '@/store/playerStore';
import { useCustomPlaylists } from '@/store/useCustomPlaylists';
import { SongRow } from '@/components/music/SongRow';
import { Artwork } from '@/components/artwork/Artwork';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCount, formatMs } from '@/lib/utils';
import type { Playlist, Song } from '@/lib/api/types';

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const customPlaylists = useCustomPlaylists((s) => s.playlists);
  const createPlaylist = useCustomPlaylists((s) => s.createPlaylist);
  const renamePlaylist = useCustomPlaylists((s) => s.renamePlaylist);
  const deletePlaylist = useCustomPlaylists((s) => s.deletePlaylist);
  const removeSongFromPlaylist = useCustomPlaylists((s) => s.removeSongFromPlaylist);

  const customPlaylist = customPlaylists.find((p) => p.id === id);
  const isCustom = Boolean(customPlaylist);

  const [remotePlaylist, setRemotePlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(!isCustom);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editing state for custom playlist title
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    if (isCustom || isDeleting || id.startsWith('cp_')) {
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);

    getPlaylist(id, ac.signal)
      .then((res) => {
        if (!ac.signal.aborted) setRemotePlaylist(res);
      })
      .catch((err) => {
        if (!ac.signal.aborted && err?.name !== 'AbortError') {
          setError("Couldn't load this playlist.");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [id, isCustom, isDeleting]);

  // Auto-heal custom playlist tracks if they share the same placeholder/collage artwork
  useEffect(() => {
    if (!isCustom || !customPlaylist || !customPlaylist.songs.length) return;

    const songsToEnrich = customPlaylist.songs.filter(
      (s) => s.id.startsWith('spotify:') || s.provider === 'spotify'
    );
    if (!songsToEnrich.length) return;

    // Detect if tracks share the exact same artwork or have generic playlist album or broken stub
    const firstArt = songsToEnrich[0]?.artwork_url;
    const isUniformArt = songsToEnrich.length > 1 && songsToEnrich.every((s) => s.artwork_url === firstArt);
    const isGenericAlbum = songsToEnrich.some((s) => s.album === customPlaylist.title);
    const isBrokenYtStub = songsToEnrich.some((s) => s.album === 'YouTube Music' || s.artwork_url?.includes('ytimg.com/vi/spotify:'));

    if (isUniformArt || isGenericAlbum || isBrokenYtStub) {
      const ac = new AbortController();
      Promise.allSettled(
        songsToEnrich.map((s) =>
          getSong(s.id, ac.signal).then((fresh) => ({
            id: s.id,
            artwork_url: fresh?.artwork_url,
            album: fresh?.album,
          }))
        )
      ).then((results) => {
        if (ac.signal.aborted) return;
        const freshMap = new Map<string, { artwork_url?: string; album?: string }>();
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.artwork_url) {
            freshMap.set(r.value.id, r.value);
          }
        }
        if (freshMap.size > 0) {
          let hasChanges = false;
          const healed = customPlaylist.songs.map((s) => {
            const fresh = freshMap.get(s.id);
            if (fresh && fresh.artwork_url && (fresh.artwork_url !== s.artwork_url || fresh.album !== s.album)) {
              hasChanges = true;
              return {
                ...s,
                artwork_url: fresh.artwork_url,
                album: fresh.album || s.album,
              };
            }
            return s;
          });
          if (hasChanges) {
            useCustomPlaylists.getState().updatePlaylistSongs(customPlaylist.id, healed);
          }
        }
      });
      return () => ac.abort();
    }
  }, [isCustom, customPlaylist?.id, customPlaylist?.songs]);

  const title = isCustom ? customPlaylist!.title : remotePlaylist?.title || '';
  const songs: Song[] = isCustom ? customPlaylist!.songs : remotePlaylist?.songs ?? [];
  const artworkUrl = isCustom
    ? customPlaylist!.songs.find((s) => s.artwork_url && !s.artwork_url.includes('ytimg.com/vi/spotify:'))?.artwork_url || customPlaylist!.songs[0]?.artwork_url
    : remotePlaylist?.artwork_url;
  const owner = isCustom ? 'You' : remotePlaylist?.owner;
  const songCount = songs.length;

  const totalDurationMs = songs.reduce((acc, s) => acc + (s.duration_ms || 0), 0);

  function handlePlay(idx = 0) {
    if (!songs.length) return;
    setQueue(songs, idx);
    setCurrentTrack(songs[idx], { source: isCustom ? `custom_playlist:${id}` : `playlist:${id}` });
  }

  function handleShuffle() {
    if (!songs.length) return;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0);
    setCurrentTrack(shuffled[0], { source: isCustom ? `custom_playlist:${id}` : `playlist:${id}` });
  }

  function handleSaveTitle() {
    if (titleInput.trim() && isCustom) {
      renamePlaylist(id, titleInput.trim());
    }
    setIsEditingTitle(false);
  }

  function handleDelete() {
    if (isCustom) {
      if (confirm(`Are you sure you want to delete "${title}"?`)) {
        setIsDeleting(true);
        deletePlaylist(id);
        router.push('/library');
      }
    }
  }

  function handleSaveToLibrary() {
    if (!remotePlaylist || !songs.length) return;
    setIsSaving(true);
    const newId = createPlaylist(
      remotePlaylist.title || 'Saved Playlist',
      `Imported from ${remotePlaylist.provider.toUpperCase()} (${remotePlaylist.owner ? `Curated by ${remotePlaylist.owner}` : 'Public Playlist'})`,
      songs
    );
    setSaved(true);
    setIsSaving(false);
    router.push(`/playlist/${newId}`);
  }

  if (isDeleting) return null;

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <ErrorState message={error} onRetry={() => router.refresh()} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 py-6 sm:py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8 mb-8 sm:mb-10 text-center sm:text-left">
        {loading ? (
          <>
            <Skeleton className="w-44 h-44 sm:w-52 sm:h-52 rounded-[--radius-2xl] flex-shrink-0" />
            <div className="space-y-3 flex-1 w-full flex flex-col items-center sm:items-start">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 sm:h-12 w-3/4 max-w-sm" />
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-3 pt-2 justify-center sm:justify-start">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-28" />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-[--radius-2xl] overflow-hidden flex-shrink-0 shadow-2xl bg-[--surface-elevated] flex items-center justify-center">
              {artworkUrl ? (
                <Artwork src={artworkUrl} alt={title} size={208} className="w-full h-full object-cover" />
              ) : (
                <Music2 className="w-16 h-16 text-[--muted]" />
              )}
            </div>

            <div className="min-w-0 space-y-2 w-full">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <p className="text-[10px] text-[--muted] uppercase tracking-widest font-mono">
                  {isCustom ? 'Custom Playlist' : 'Playlist'}
                </p>
                {isCustom && (
                  <span className="text-[9px] font-mono uppercase bg-[--art-primary]/15 text-[--art-accent] px-1.5 py-0.5 rounded">
                    Personal
                  </span>
                )}
              </div>

              {/* Title with edit capability for custom */}
              {isCustom && isEditingTitle ? (
                <div className="flex items-center gap-2 max-w-md">
                  <input
                    type="text"
                    autoFocus
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTitle();
                      if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    className="text-2xl sm:text-3xl font-bold bg-white/[0.08] text-[--foreground] border border-white/20 rounded-[--radius-md] px-3 py-1 outline-none w-full"
                  />
                  <button
                    onClick={handleSaveTitle}
                    className="p-2 rounded-[--radius-md] bg-[--foreground] text-[--surface] hover:opacity-90 transition-opacity cursor-pointer"
                    title="Save title"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center sm:justify-start gap-3 group">
                  <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[--foreground] tracking-tight leading-tight truncate">
                    {title}
                  </h1>
                  {isCustom && (
                    <button
                      onClick={() => {
                        setTitleInput(title);
                        setIsEditingTitle(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-[--muted] hover:text-[--foreground] hover:bg-white/[0.08] transition-all cursor-pointer"
                      title="Rename playlist"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {owner && <p className="text-[--muted] text-sm truncate">By {owner}</p>}

              <p className="text-sm text-[--muted]">
                {songCount} {songCount === 1 ? 'track' : 'tracks'}
                {totalDurationMs > 0 && ` · ${formatMs(totalDurationMs)}`}
                {!isCustom && remotePlaylist?.follower_count ? ` · ${formatCount(remotePlaylist.follower_count)} saves` : ''}
              </p>

              {/* Action buttons */}
              <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 pt-2">
                <button
                  disabled={songs.length === 0}
                  onClick={() => handlePlay(0)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-sm font-semibold hover:opacity-90 transition-opacity min-h-[44px] cursor-pointer disabled:opacity-40"
                >
                  <Play className="w-4 h-4 fill-current" /> Play
                </button>
                <button
                  disabled={songs.length === 0}
                  onClick={handleShuffle}
                  className="flex items-center gap-2 px-5 py-2.5 border border-white/10 text-[--muted] rounded-[--radius-md] text-sm font-medium hover:text-[--foreground] hover:border-white/20 transition-colors min-h-[44px] cursor-pointer disabled:opacity-40"
                >
                  <Shuffle className="w-4 h-4" /> Shuffle
                </button>

                {!isCustom && remotePlaylist && songs.length > 0 && (
                  <button
                    onClick={handleSaveToLibrary}
                    disabled={isSaving || saved}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 rounded-[--radius-md] text-sm font-medium transition-colors min-h-[44px] cursor-pointer disabled:opacity-50"
                    title="Save copy to your library"
                  >
                    {saved ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" /> Saved to Library
                      </>
                    ) : (
                      <>
                        <ArrowDownToLine className="w-4 h-4" /> Save to Library
                      </>
                    )}
                  </button>
                )}

                {isCustom && (
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-[--muted] hover:text-red-400 hover:bg-red-500/10 rounded-[--radius-md] transition-colors cursor-pointer ml-auto"
                    title="Delete playlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Playlist
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tracklist table header */}
      {!loading && songs.length > 0 && (
        <div className="border-b border-white/[0.05] pb-2 mb-2">
          <div className="grid grid-cols-[32px_40px_1fr_auto_36px] sm:grid-cols-[32px_40px_1fr_120px_auto_36px] gap-3 px-3 text-[10px] text-[--muted] uppercase tracking-wider items-center">
            <span>#</span>
            <span />
            <span>Title</span>
            <span className="hidden sm:block">Album</span>
            <span className="text-right"><Clock className="w-3 h-3 inline" /></span>
            <span />
          </div>
        </div>
      )}

      {/* Song rows or Empty state */}
      {!loading && songs.length === 0 ? (
        <EmptyState
          icon={<Music2 className="w-10 h-10" />}
          title="This playlist is empty"
          description={isCustom ? "Search for songs or browse Home and use 'Add to Playlist' to build your collection." : "No songs found in this playlist."}
        />
      ) : (
        <div className="space-y-0.5">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="w-8 h-4 rounded" />
                <Skeleton className="w-10 h-10 rounded-[--radius-sm]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-56" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <Skeleton className="h-3 w-10" />
              </div>
            ))
          ) : (
            songs.map((song, i) => (
              <div key={`${song.id}-${i}`} className="group/custom-row relative flex items-center">
                <div className="flex-1 min-w-0">
                  <SongRow
                    song={song}
                    index={i}
                    context={songs}
                    showAlbum
                    playbackContext={{ source: isCustom ? `custom_playlist:${id}` : `playlist:${id}` }}
                  />
                </div>
                {isCustom && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSongFromPlaylist(id, song.id);
                    }}
                    className="absolute right-12 opacity-0 group-hover/custom-row:opacity-100 p-1 text-[--muted] hover:text-red-400 hover:bg-white/[0.08] rounded transition-all cursor-pointer z-10"
                    title="Remove from playlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
