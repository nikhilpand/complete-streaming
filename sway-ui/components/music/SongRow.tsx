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
}

export function SongRow({ song, index, context, showAlbum = true }: Props) {
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
    setCurrentTrack(song);
    usePlayerStore.setState({ isLyricsOpen: true });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      className={cn(
        'group flex items-center gap-3 px-3 py-2 rounded-[--radius-md] cursor-pointer transition-colors duration-[--motion-fast]',
        'hover:bg-[--surface-elevated]',
        isCurrent && 'bg-[--surface-elevated]'
      )}
    >
      {/* Index / state indicator */}
      <div className="w-8 flex-shrink-0 flex items-center justify-center">
        {isLoading ? (
          <span className="w-3 h-3 rounded-full border-2 border-[--art-primary] border-t-transparent animate-spin inline-block" />
        ) : isPlaying ? (
          <span className="flex gap-[2px] items-end h-4">
            {[1,2,3].map((i) => (
              <span key={i} className="w-[2px] bg-[--art-primary] rounded-full animate-pulse"
                style={{ height: `${8 + i * 3}px`, animationDelay: `${i * 0.12}s` }} />
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

      <Artwork src={song.artwork_url} alt={song.title} size={40} className="rounded-[--radius-sm]" />

      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium truncate', isCurrent ? 'text-[--art-primary]' : 'text-[--foreground]')}>
          {song.title}
          {song.is_explicit && (
            <span className="ml-1.5 text-[9px] font-mono px-1 py-0.5 rounded-[2px] bg-[--surface-overlay,#222] text-[--muted] align-middle">E</span>
          )}
        </p>
        <p className="text-xs text-[--muted] truncate">{artistNames(song.artists)}</p>
      </div>

      {showAlbum && song.album && (
        <p className="hidden lg:block text-xs text-[--muted] truncate max-w-[140px]">{song.album}</p>
      )}

      <span className="text-xs text-[--muted] tabular-nums w-9 text-right flex-shrink-0">
        {song.duration_ms ? formatMs(song.duration_ms) : '—'}
      </span>

      <button
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[--muted] hover:text-[--foreground] transition"
        aria-label="More options"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </div>
  );
}
