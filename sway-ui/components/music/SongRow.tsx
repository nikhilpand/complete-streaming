'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import Link from 'next/link';
import {
  Play,
  MoreHorizontal,
  Heart,
  ListPlus,
  CornerDownRight,
  Copy,
  Check,
  FolderPlus,
  ExternalLink,
  Download,
  Loader2,
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { useLikedSongs } from '@/store/useLikedSongs';
import { AddToPlaylistModal } from '@/components/music/AddToPlaylistModal';
import { Artwork } from '@/components/artwork/Artwork';
import { cn, formatMs, artistNames } from '@/lib/utils';
import { downloadSong, type DownloadStatus } from '@/lib/download';
import type { Song } from '@/lib/api/types';

interface Props {
  song: Song;
  index?: number;
  context?: Song[];
  showAlbum?: boolean;
  playbackContext?: { source?: string; query?: string };
}

function SongRowComponent({ song, index, context, showAlbum = true, playbackContext }: Props) {
  const isCurrent = usePlayerStore((s) => s.currentTrack?.id === song.id);
  const isPlaying = usePlayerStore((s) => (s.currentTrack?.id === song.id ? s.status === 'playing' : false));
  const isLoading = usePlayerStore((s) => (s.currentTrack?.id === song.id ? s.status === 'loading' : false));
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  const isLiked = useLikedSongs((s) => s.isLiked(song.id));
  const toggleLike = useLikedSongs((s) => s.toggleLike);

  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  function handleClick() {
    if (isCurrent && status !== 'error') {
      usePlayerStore.getState().togglePlayPause();
      return;
    }
    if (context) {
      const idx = context.findIndex((s) => s.id === song.id);
      setQueue(context, idx >= 0 ? idx : 0);
    }
    setCurrentTrack(song, playbackContext);
  }

  const handlePlayNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const { queue, queueIndex } = usePlayerStore.getState();
    if (!queue.length) {
      setQueue([song], 0);
      setCurrentTrack(song, playbackContext);
    } else {
      const nextIndex = queueIndex + 1;
      const filtered = queue.filter((s, i) => i === queueIndex || s.id !== song.id);
      const insertAt = nextIndex <= filtered.length ? nextIndex : filtered.length;
      const updated = [...filtered.slice(0, insertAt), song, ...filtered.slice(insertAt)];
      usePlayerStore.getState().setQueue(updated, queueIndex);
    }
    setMenuOpen(false);
  }, [song, playbackContext, setQueue, setCurrentTrack]);

  const handleAddToQueue = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    addToQueue(song);
    setMenuOpen(false);
  }, [song, addToQueue]);

  const handleAddToPlaylist = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setIsPlaylistModalOpen(true);
  }, []);

  const handleToggleLike = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleLike(song);
    setMenuOpen(false);
  }, [song, toggleLike]);

  const handleCopyLink = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const url = typeof window !== 'undefined'
      ? `${window.location.origin}/song/${encodeURIComponent(song.id)}`
      : '';
    if (navigator.clipboard && url) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          setMenuOpen(false);
        }, 1200);
      }).catch(() => setMenuOpen(false));
    } else {
      setMenuOpen(false);
    }
  }, [song]);

  const handleDownload = useCallback(async (e: React.MouseEvent, quality: 'best' | 'fast' = 'best') => {
    e.stopPropagation();
    try {
      await downloadSong(song, (s) => setDownloadStatus(s), quality);
    } catch {
      // Handled
    }
  }, [song]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Play ${song.title}`}
      onClick={handleClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      className={cn(
        'group flex items-center gap-3 px-3 py-2 rounded-[10px] hover:bg-white/[0.04] transition-colors cursor-pointer select-none',
        isCurrent && 'bg-white/[0.06]'
      )}
    >
      {/* Index / state indicator */}
      <div className="w-6 sm:w-8 flex-shrink-0 flex items-center justify-center">
        {isLoading ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-[--art-primary] border-t-transparent animate-spin inline-block" />
        ) : isPlaying ? (
          <span className="flex gap-[2px] items-end h-4">
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-[2px] bg-[--art-primary] rounded-full animate-pulse"
                style={{ height: `${8 + i * 3}px`, animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </span>
        ) : (
          <>
            <span className="text-xs text-[--muted] group-hover:hidden tabular-nums">
              {index !== undefined ? index + 1 : ''}
            </span>
            <Play className="w-3.5 h-3.5 text-[--foreground] hidden group-hover:block fill-current" />
          </>
        )}
      </div>

      <Artwork src={song.artwork_url} alt={song.title} size={42} className="w-[42px] h-[42px] rounded-[--radius-sm] object-cover shrink-0" />

      <div className="flex-1 min-w-0 pr-1">
        <p className={cn('text-[13px] font-medium truncate leading-snug', isCurrent ? 'text-[--art-primary]' : 'text-[--foreground]')}>
          {song.title}
          {song.is_explicit && (
            <span className="ml-1.5 text-[9px] font-mono bg-white/10 text-[--muted] px-1 py-0.5 rounded-[3px] align-middle">E</span>
          )}
        </p>
        <p className="text-[11px] text-[--muted] truncate mt-0.5">{artistNames(song.artists)}</p>
      </div>

      {showAlbum && song.album && (
        <p className="hidden md:block text-[11px] text-[--muted] truncate max-w-[120px] lg:max-w-[160px] shrink-0">{song.album}</p>
      )}

      {/* Heart quick-action */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleLike(song);
        }}
        className={cn(
          "p-1.5 rounded-full hover:bg-white/10 transition-all cursor-pointer shrink-0 hidden sm:inline-flex",
          isLiked ? "text-rose-500 hover:text-rose-400 opacity-100" : "opacity-0 group-hover:opacity-100 text-white/40 hover:text-white/80"
        )}
        aria-label={isLiked ? "Unlike song" : "Like song"}
      >
        <Heart className={cn("w-3.5 h-3.5", isLiked && "fill-current")} />
      </button>

      {/* Download quick-action */}
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
        className={cn(
          "p-1.5 rounded-full hover:bg-white/10 transition-all cursor-pointer shrink-0 hidden md:inline-flex",
          downloadStatus !== 'idle' ? "opacity-100 text-white/80" : "opacity-0 group-hover:opacity-100 text-white/40 hover:text-white/80"
        )}
        aria-label="Download audio"
        title={
          downloadStatus === 'complete'
            ? 'Downloaded!'
            : downloadStatus === 'resolving' || downloadStatus === 'downloading'
            ? 'Downloading...'
            : 'Download audio (320kbps)'
        }
      >
        {downloadStatus === 'resolving' || downloadStatus === 'downloading' ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[--art-primary]" />
        ) : downloadStatus === 'complete' ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
      </button>

      <span className="text-[--muted] text-xs tabular-nums w-12 sm:w-14 text-right flex-shrink-0">
        {song.duration_ms ? formatMs(song.duration_ms) : '—'}
      </span>

      {/* More actions dropdown menu */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
          className={cn(
            "p-1.5 rounded-full hover:bg-white/10 transition-all cursor-pointer shrink-0",
            menuOpen
              ? "opacity-100 bg-white/10 text-white"
              : "opacity-60 md:opacity-0 md:group-hover:opacity-100 text-[--muted] hover:text-[--foreground]"
          )}
          aria-label="More options"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1.5 z-50 min-w-[180px] bg-[#14141e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Play Next */}
            <button
              onClick={handlePlayNext}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer"
            >
              <CornerDownRight className="w-3.5 h-3.5 text-white/50" />
              <span>Play Next</span>
            </button>

            {/* Add to Queue */}
            <button
              onClick={handleAddToQueue}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer"
            >
              <ListPlus className="w-3.5 h-3.5 text-white/50" />
              <span>Add to Queue</span>
            </button>

            {/* Add to Playlist */}
            <button
              onClick={handleAddToPlaylist}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-white/50" />
              <span>Add to Playlist...</span>
            </button>

            {/* Like / Unlike */}
            <button
              onClick={handleToggleLike}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer"
            >
              <Heart className={cn("w-3.5 h-3.5", isLiked ? "fill-rose-500 text-rose-500" : "text-white/50")} />
              <span>{isLiked ? 'Remove from Liked' : 'Save to Liked Songs'}</span>
            </button>

            <div className="h-[1px] bg-white/[0.06] my-1" />

            {/* Download Studio 320k */}
            <button
              onClick={(e) => handleDownload(e, 'best')}
              disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
              className="w-full flex items-center justify-between px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                {downloadStatus === 'resolving' || downloadStatus === 'downloading' ? (
                  <Loader2 className="w-3.5 h-3.5 text-white/70 animate-spin" />
                ) : downloadStatus === 'complete' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-white/50" />
                )}
                <span>Download Audio</span>
              </div>
              <span className="text-[10px] text-white/40 font-mono bg-white/5 px-1.5 py-0.5 rounded">320k</span>
            </button>

            {/* Fast Download 160k */}
            <button
              onClick={(e) => handleDownload(e, 'fast')}
              disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
              className="w-full flex items-center justify-between px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <Download className="w-3.5 h-3.5 text-white/50" />
                <span>Fast Download</span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded">2x Fast</span>
            </button>

            {/* View Song Details */}
            <Link
              href={`/song/${encodeURIComponent(song.id)}`}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-white/50" />
              <span>View Song Details</span>
            </Link>

            {/* Copy Link */}
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors text-left cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Link Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-white/50" />
                  <span>Copy Song Link</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <AddToPlaylistModal
        song={song}
        isOpen={isPlaylistModalOpen}
        onClose={() => setIsPlaylistModalOpen(false)}
      />
    </div>
  );
}

export const SongRow = memo(SongRowComponent);

