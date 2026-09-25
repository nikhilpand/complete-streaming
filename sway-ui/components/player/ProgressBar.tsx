'use client';
import { useRef, useCallback, useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { formatSecs } from '@/lib/utils';

export function ProgressBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Direct DOM updates on audioManager timeupdate for ultra-smooth 144fps playback with 0 React re-renders
  useEffect(() => {
    if (!audioManager) return;
    return audioManager.subscribe((ev) => {
      if (ev.type === 'timeupdate') {
        const d = ev.duration || duration;
        if (d > 0) {
          const p = Math.min(100, Math.max(0, (ev.currentTime / d) * 100));
          if (fillRef.current) fillRef.current.style.width = `${p}%`;
          if (thumbRef.current) thumbRef.current.style.left = `calc(${p}% - 6px)`;
        }
      }
    });
  }, [duration]);

  const seek = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!trackRef.current || !duration) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = ratio * duration;
    usePlayerStore.getState().seekTo(time);
    if (fillRef.current) fillRef.current.style.width = `${ratio * 100}%`;
    if (thumbRef.current) thumbRef.current.style.left = `calc(${ratio * 100}% - 6px)`;
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
          <div ref={fillRef} className="h-full bg-[--art-primary] rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div
          ref={thumbRef}
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
