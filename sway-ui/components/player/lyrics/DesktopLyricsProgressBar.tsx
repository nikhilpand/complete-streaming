'use client';

import React, { memo, useState, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { formatSecs } from '@/lib/utils';

interface DesktopLyricsProgressBarProps {
  duration: number;
  seekTo: (time: number) => void;
  className?: string;
}

export const DesktopLyricsProgressBar = memo(({
  duration,
  seekTo,
  className,
}: DesktopLyricsProgressBarProps) => {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const bufferedTime = usePlayerStore((s) => s.bufferedTime);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekVal, setSeekVal] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const getPositionFromEvent = useCallback((clientX: number) => {
    if (!trackRef.current || duration <= 0) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * duration;
  }, [duration]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const val = getPositionFromEvent(e.clientX);
    setIsSeeking(true);
    setSeekVal(val);

    const onMouseMove = (ev: MouseEvent) => {
      setSeekVal(getPositionFromEvent(ev.clientX));
    };

    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      const finalVal = getPositionFromEvent(ev.clientX);
      seekTo(finalVal);
      setIsSeeking(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [getPositionFromEvent, seekTo]);

  const currentDisplayTime = isSeeking ? seekVal : currentTime;
  const currentProgress = duration > 0 ? (currentDisplayTime / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (bufferedTime / duration) * 100 : 0;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const step = 5; // 5s step for arrows
    const bigStep = 15; // 15s step for page up/down
    let newTime: number | null = null;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        newTime = Math.max(0, currentDisplayTime - step);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        newTime = Math.min(duration, currentDisplayTime + step);
        break;
      case 'PageDown':
        e.preventDefault();
        newTime = Math.max(0, currentDisplayTime - bigStep);
        break;
      case 'PageUp':
        e.preventDefault();
        newTime = Math.min(duration, currentDisplayTime + bigStep);
        break;
      case 'Home':
        e.preventDefault();
        newTime = 0;
        break;
      case 'End':
        e.preventDefault();
        newTime = duration;
        break;
      default:
        break;
    }

    if (newTime !== null) {
      seekTo(newTime);
    }
  }, [currentDisplayTime, duration, seekTo]);

  return (
    <div className={`hidden lg:flex items-center gap-3 w-full select-none ${className || 'max-w-[380px]'}`}>
      <span className="text-[11px] font-mono font-medium text-white/50 tabular-nums shrink-0 w-8 text-right">
        {formatSecs(currentDisplayTime)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentDisplayTime)}
        aria-valuetext={formatSecs(currentDisplayTime)}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        className={`blyrics-progress-track flex-1 group cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${isSeeking ? 'is-seeking' : ''}`}
      >
        <div className="blyrics-progress-buffered" style={{ width: `${Math.min(100, bufferedProgress)}%` }} />
        <div className="blyrics-progress-fill" style={{ width: `${Math.min(100, currentProgress)}%` }} />
        <div
          className="blyrics-progress-thumb"
          style={{ left: `${Math.min(100, currentProgress)}%` }}
        />
      </div>
      <span className="text-[11px] font-mono font-medium text-white/50 tabular-nums shrink-0 w-8 text-left">
        -{formatSecs(Math.max(0, duration - currentDisplayTime))}
      </span>
    </div>
  );
});

DesktopLyricsProgressBar.displayName = 'DesktopLyricsProgressBar';
