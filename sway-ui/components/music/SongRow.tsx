'use client';
import { Play, Pause, MoreHorizontal } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { Artwork } from '@/components/artwork/Artwork';
import { cn, formatMs, artistNames } from '@/lib/utils';
import type { Song } from '@/lib/api/types';

interface Props {
  song: Song;
  index?: number;
  context?: Song[];
  showAlbum?: boolean;
  playbackContext?: { source?: string; query?: string };
}

export function SongRow({ song, index, context, showAlbum = true, playbackContext }: Props) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const isCurrent = currentTrack?.id === song.id;
  const isPlaying = isCurrent && status === 'playing';
  const isLoading = isCurrent && status === 'loading';

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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
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

      <span className="text-[--muted] text-xs tabular-nums w-12 sm:w-14 text-right flex-shrink-0">
        {song.duration_ms ? formatMs(song.duration_ms) : '—'}
      </span>

      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className="opacity-60 md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-full hover:bg-white/10 text-[--muted] hover:text-[--foreground] transition-opacity cursor-pointer shrink-0"
        aria-label="More options"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </div>
  );
}
