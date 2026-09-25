'use client';
import { Play, Pause, SkipBack, SkipForward, List, Mic2, Repeat, Shuffle, Repeat1, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { Artwork } from '@/components/artwork/Artwork';
import { IconButton } from '@/components/ui/IconButton';
import { ProgressBar } from './ProgressBar';
import { VolumeControl } from './VolumeControl';
import { cn, artistNames } from '@/lib/utils';

export function Player() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const isLyricsOpen = usePlayerStore((s) => s.isLyricsOpen);
  const error = usePlayerStore((s) => s.error);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrev = usePlayerStore((s) => s.playPrev);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  if (!currentTrack) return null;

  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;

  const PlayPauseBtn = (
    <IconButton
      sz="lg"
      variant="prominent"
      className="rounded-full w-10 h-10"
      disabled={isLoading}
      onClick={() => {
        if (isPlaying) audioManager?.pause();
        else audioManager?.play().catch(() => {});
      }}
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {isLoading ? (
        <span className="w-4 h-4 border-2 border-[--surface]/40 border-t-[--surface] rounded-full animate-spin" />
      ) : isPlaying ? (
        <Pause className="w-4 h-4 fill-current" />
      ) : (
        <Play className="w-4 h-4 fill-current translate-x-0.5" />
      )}
    </IconButton>
  );

  return (
    <>
      {/* Mini Player - auto hides when FullScreenLyrics is active */}
      <AnimatePresence>
        {!isLyricsOpen && (
          <motion.div
            key="mini"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-[56px] md:bottom-0 left-0 right-0 z-40 h-[80px]"
          >
            <div className="absolute inset-0 bg-[--surface]/90 backdrop-blur-xl border-t border-white/[0.06]" />
            <div className="relative h-full flex flex-col px-4">
              <div className="pt-1">
                <ProgressBar />
              </div>
              <div className="flex-1 flex items-center gap-3 pb-1">
                {/* Track info - click opens full-screen lyrics */}
                <button
                  className="flex items-center gap-3 flex-[1.5] min-w-0 text-left cursor-pointer group"
                  onClick={toggleLyrics}
                  aria-label="Open lyrics player"
                >
                  <Artwork src={currentTrack.artwork_url} alt={currentTrack.title} size={42} className="rounded-[--radius-sm] group-hover:opacity-85 transition-opacity" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[--foreground] group-hover:text-[--art-primary] truncate transition-colors">{currentTrack.title}</p>
                    <p className="text-xs text-[--muted] truncate">{artistNames(currentTrack.artists)}</p>
                  </div>
                </button>

                {/* Center controls */}
                <div className="flex items-center gap-1 flex-1 justify-center">
                  <IconButton sz="sm"
                    onClick={() => usePlayerStore.getState().toggleShuffle()}
                    className={cn(isShuffled && 'text-[--art-primary]')}
                    aria-label="Shuffle"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton sz="sm" onClick={playPrev} aria-label="Previous">
                    <SkipBack className="w-4 h-4 fill-current" />
                  </IconButton>
                  {PlayPauseBtn}
                  <IconButton sz="sm" onClick={playNext} aria-label="Next">
                    <SkipForward className="w-4 h-4 fill-current" />
                  </IconButton>
                  <IconButton sz="sm"
                    onClick={() => usePlayerStore.getState().cycleRepeat()}
                    className={cn(repeatMode !== 'none' && 'text-[--art-primary]')}
                    aria-label="Repeat"
                  >
                    <RepeatIcon className="w-3.5 h-3.5" />
                  </IconButton>
                </div>

                {/* Right controls */}
                <div className="hidden md:flex items-center gap-1 flex-1 justify-end">
                  <IconButton sz="sm" onClick={toggleLyrics} aria-label="Lyrics" title="Lyrics (Full Screen)">
                    <Mic2 className="w-4 h-4 text-[--art-primary]" />
                  </IconButton>
                  <IconButton sz="sm" onClick={toggleQueue} aria-label="Queue"><List className="w-4 h-4" /></IconButton>
                  <VolumeControl />
                </div>
              </div>
            </div>
            {error && (
              <div className="absolute bottom-full left-0 right-0 bg-red-900/80 backdrop-blur-sm text-red-200 text-xs px-4 py-1.5 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => usePlayerStore.getState().setError(null)} className="ml-4 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
