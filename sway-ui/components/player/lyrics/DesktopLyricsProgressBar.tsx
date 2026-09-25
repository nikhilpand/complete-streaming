'use client';

import React, { memo, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { formatSecs } from '@/lib/utils';

interface DesktopLyricsProgressBarProps {
  duration: number;
  seekTo: (time: number) => void;
}

export const DesktopLyricsProgressBar = memo(({
  duration,
  seekTo,
}: DesktopLyricsProgressBarProps) => {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const bufferedTime = usePlayerStore((s) => s.bufferedTime);
  const [isSeeking] = useState(false);
  const [seekVal] = useState(0);

  const currentProgress = duration > 0 ? ((isSeeking ? seekVal : currentTime) / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (bufferedTime / duration) * 100 : 0;

  return (
    <div className="hidden lg:block w-full max-w-[340px] space-y-1.5 pt-1">
      <div
        className="blyrics-progress-track group cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          seekTo(pct * duration);
        }}
      >
        <div className="blyrics-progress-buffered" style={{ width: `${Math.min(100, bufferedProgress)}%` }} />
        <div className="blyrics-progress-fill" style={{ width: `${Math.min(100, currentProgress)}%` }} />
        <div
          className="blyrics-progress-thumb"
          style={{ left: `${Math.min(100, currentProgress)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono font-medium text-white/50 px-0.5">
        <span>{formatSecs(isSeeking ? seekVal : currentTime)}</span>
        <span>-{formatSecs(Math.max(0, duration - (isSeeking ? seekVal : currentTime)))}</span>
      </div>
    </div>
  );
});

DesktopLyricsProgressBar.displayName = 'DesktopLyricsProgressBar';
