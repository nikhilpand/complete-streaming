'use client';
import { useRef, useCallback, useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';

export function ProgressBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
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
  }, [duration]);

  return (
    <div
      ref={trackRef}
      className="absolute top-0 left-0 right-0 h-4 -translate-y-[2px] flex items-center cursor-pointer group z-50"
      onClick={seek}
      role="slider"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="w-full h-[2px] bg-white/10 group-hover:h-[4px] transition-all">
        <div ref={fillRef} data-art-transition className="h-full bg-[--art-primary]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
