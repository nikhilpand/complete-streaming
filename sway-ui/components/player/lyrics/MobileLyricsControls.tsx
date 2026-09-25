'use client';

import React, { memo } from 'react';
import {
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Loader2,
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';

interface MobileLyricsControlsProps {
  duration: number;
  seekTo: (time: number) => void;
  pillBg?: string;
  pillActive?: string;
}

export const MobileLyricsControls = memo(({
  duration,
  seekTo,
  pillBg = 'var(--art-pill-bg, rgba(25, 30, 42, 0.65))',
  pillActive = 'var(--art-pill-active, rgba(255, 255, 255, 0.22))',
}: MobileLyricsControlsProps) => {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const status = usePlayerStore((s) => s.status);
  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const repeat = repeatMode === 'none' ? 'off' : repeatMode;

  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const playPrev = usePlayerStore((s) => s.playPrev);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const playNext = usePlayerStore((s) => s.playNext);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  const currentProgress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="lg:hidden fixed bottom-3 left-3 right-3 z-[250] flex flex-col items-center gap-2 max-w-md mx-auto pointer-events-auto">
      {/* Mobile Mini Scrub Bar */}
      <div
        className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden relative cursor-pointer active:h-2.5 transition-all"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          seekTo(pct * duration);
        }}
      >
        <div
          className="h-full bg-white rounded-full transition-all"
          style={{ width: `${Math.min(100, currentProgress)}%` }}
        />
      </div>

      {/* Mobile Glass Controls Pill */}
      <div
        className="blyrics-controls-pill w-full flex items-center justify-between px-5 py-2 shadow-2xl backdrop-blur-3xl border border-white/10"
        style={{ background: pillBg }}
      >
        <button type="button" onClick={toggleShuffle} aria-label="Shuffle" className="p-1 cursor-pointer">
          <Shuffle size={18} color={isShuffled ? 'white' : 'rgba(255,255,255,0.4)'} />
        </button>
        <button type="button" onClick={playPrev} aria-label="Previous" className="p-1 cursor-pointer">
          <SkipBack size={21} color="white" />
        </button>
        <button
          type="button"
          onClick={togglePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="blyrics-play-btn"
          style={{ background: pillActive }}
        >
          {isLoading ? (
            <Loader2 size={20} className="animate-spin text-white" />
          ) : isPlaying ? (
            <Pause size={20} color="white" />
          ) : (
            <Play size={20} fill="white" color="white" className="ml-0.5" />
          )}
        </button>
        <button type="button" onClick={playNext} aria-label="Next" className="p-1 cursor-pointer">
          <SkipForward size={21} color="white" />
        </button>
        <button type="button" onClick={cycleRepeat} aria-label="Repeat" className="p-1 cursor-pointer">
          {repeat === 'one' ? (
            <Repeat1 size={18} color="white" />
          ) : (
            <Repeat size={18} color={repeat === 'off' ? 'rgba(255,255,255,0.4)' : 'white'} />
          )}
        </button>
      </div>
    </div>
  );
});

MobileLyricsControls.displayName = 'MobileLyricsControls';
