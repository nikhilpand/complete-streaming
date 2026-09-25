'use client';
import { useRef, useCallback } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { formatSecs } from '@/lib/utils';

export function ProgressBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seek = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!trackRef.current || !duration) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = ratio * duration;
    audioManager?.seek(time);
    usePlayerStore.getState().setCurrentTime(time);
  }, [duration]);

  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-[10px] text-[--muted] tabular-nums w-7 text-right flex-shrink-0">
        {formatSecs(currentTime)}
      </span>
      <div
        ref={trackRef}
        className="relative flex-1 h-8 flex items-center cursor-pointer group"
        onClick={seek}
        role="slider"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="w-full h-[3px] bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-[--art-primary] rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[--foreground] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
      <span className="text-[10px] text-[--muted] tabular-nums w-7 flex-shrink-0">
        {duration > 0 ? formatSecs(duration) : '--:--'}
      </span>
    </div>
  );
}
